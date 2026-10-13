// chapters: /chapters turns a diff into a review you read in order. One model
// call (two for a big diff) writes short chapters, each with what changed, why
// it matters, a risk mark and one question to check; a pane walks them with the
// matching hunks beside each. It only reads and explains: it never applies,
// reverts or sends anything. "ask Claude" fills your prompt box; you send it.
//
// The diff comes from read-only git plumbing (diff-index, diff-tree,
// merge-base, ls-files) with optional locks off, so it never touches the
// index under Claude; outside git, from the last turn's own file edits.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register } from 'claude-code'

import type { ChaptersChapter, ChaptersReview } from '../types'
import { batches, changedLines, editDiff, hunksFor, isSecretFile, newFileDiff, parseDiff } from './diff'
import type { FileDiff, Hunk } from './diff'
import { MAX_INPUT, MAX_TOKENS, MODEL, RISK_MARK, SYSTEM, TIMEOUT_MS, askText, bandWords, buildPrompt, costWords, parseReply, progressWords, sanitize } from './review'

const review = atom({ plugin: 'chapters', key: 'review' } as const, null as ChaptersReview | null)

const PANE = 'chapters'
/** Origins that are the person: typed, the phone bridge, the desktop app's box. */
const PERSON = new Set(['composer', 'bridge', 'sdk'])
const ENV = { LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
/** git's empty tree: what an unborn branch's changes are compared with. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const MAX_NEW_FILES = 30
const MAX_NEW_FILE_CHARS = 60_000
const HUNKS_SHOWN = 6
const HUNK_LINES = 80

type Settings = { model: string; base: string }

export function readSettings(options: Record<string, unknown>): Settings {
  const word = (v: unknown, fallback: string) => (typeof v === 'string' && /^[\w.:@/-]{1,100}$/.test(v.trim()) && !v.trim().startsWith('-') ? v.trim() : fallback)
  return { model: word(options.model, MODEL), base: word(options.base, 'main') }
}

/** A Claude edit, kept to show a review outside git (or of the last turn). */
type Edit = { path: string; diff: string }

let settings: Settings = readSettings({})
let files: FileDiff[] = []
let turnEdits: Edit[] = []
let lastTurnEdits: Edit[] = []
let isWriting = false

// The switch (`enabled`, which /config and the modmyclaude hub flip): off, Chapters calls no
// model, draws no line or pane and notes nothing (the flip reloads the mod, which would drop
// what it noted anyway). A review being written when it goes off never asks the model again
// and never draws. The engine reloads the mod with
// the new value; the config.set hook below is the same switch at once.
let isOn = true
/** How often the switch went off: a review begun before the latest time is dropped. */
let offs = 0
const OFF_TEXT = 'Chapters is off. /mods or /config turns it on.'
const STOPPED = 'the review stopped when Chapters was switched off; /chapters writes a new one'

function debug($: EngineInterface, text: string): void {
  $.ui.log(`chapters: ${text}`, { to: 'debug' })
}

function git($: EngineInterface, args: string[], root: string) {
  return $.process.run(['git', ...args], { cwd: root, env: ENV, timeoutMs: 15_000 })
}

function relative(path: string, root: string): string {
  const base = root.replace(/\/+$/, '')
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
}

/** A hunk short enough to draw, its header's counts made true for the lines kept. */
export function shortHunk(hunk: Hunk, max = HUNK_LINES): string {
  const lines = hunk.text.split('\n')
  if (lines.length - 1 <= max) return hunk.text
  const kept = lines.slice(1, max + 1)
  const old = kept.filter(l => l.startsWith(' ') || l.startsWith('-')).length
  const now = kept.filter(l => l.startsWith(' ') || l.startsWith('+')).length
  const oldStart = /^@@ -(\d+)/.exec(lines[0]!)?.[1] ?? '1'
  return [`@@ -${oldStart},${old} +${hunk.newStart},${now} @@`, ...kept].join('\n')
}

/**
 * A diff as read, whole files only: output cut at the read limit (4 MiB) ends mid-file, so the
 * torn last file is dropped, never reviewed as if whole, and the cut is said.
 */
export function wholeFiles(stdout: string, isTruncated: boolean): { text: string; isCut: boolean } {
  if (!isTruncated) return { text: stdout, isCut: false }
  const at = stdout.lastIndexOf('\ndiff --git ')
  return { text: at > 0 ? stdout.slice(0, at) : '', isCut: true }
}

/** The diff for a scope, through read-only git; an error in words when it cannot be read. */
async function gitDiff($: EngineInterface, root: string, scope: 'changes' | 'staged' | 'branch', base: string): Promise<{ text: string; words: string; isCut: boolean } | { error: string }> {
  if (scope === 'branch') {
    const mb = await git($, ['merge-base', base, 'HEAD'], root).catch(() => undefined)
    const sha = mb?.exitCode === 0 ? mb.stdout.trim() : ''
    if (!/^[0-9a-f]{40,64}$/.test(sha)) return { error: `there is no common point with ${base} to compare with` }
    const d = await git($, ['diff-tree', '-p', '--no-color', '-r', '-M', sha, 'HEAD'], root).catch(() => undefined)
    if (d?.exitCode !== 0) return { error: 'git could not read the branch' }
    return { ...wholeFiles(d.stdout, d.isStdoutTruncated), words: `this branch against ${base}` }
  }
  const head = await git($, ['rev-parse', '--verify', 'HEAD'], root).catch(() => undefined)
  const against = head?.exitCode === 0 ? 'HEAD' : EMPTY_TREE
  const args = ['diff-index', '-p', '--no-color', '-M', ...(scope === 'staged' ? ['--cached'] : []), against, '--']
  const d = await git($, args, root).catch(() => undefined)
  if (d?.exitCode !== 0) return { error: 'git could not read the changes' }
  const read = wholeFiles(d.stdout, d.isStdoutTruncated)
  let text = read.text
  if (scope === 'changes') {
    // New files git does not track yet are part of what changed: each as a whole addition.
    const listed = await git($, ['ls-files', '--others', '--exclude-standard', '-z'], root).catch(() => undefined)
    const names = listed?.exitCode === 0 ? listed.stdout.split('\0').filter(Boolean).slice(0, MAX_NEW_FILES) : []
    for (const name of names) {
      // A secrets file is never read: its name is all the review gets.
      if (isSecretFile(name)) {
        text += `\ndiff --git a/${name} b/${name}\nnew file`
        continue
      }
      const content = await $.fs.read(`${root.replace(/\/+$/, '')}/${name}`).catch(() => undefined)
      if (content === undefined || content.includes('\0') || content.length > MAX_NEW_FILE_CHARS) continue
      text += `\n${newFileDiff(name, content)}`
    }
  }
  return { text, words: scope === 'staged' ? 'staged changes' : 'uncommitted changes', isCut: read.isCut }
}

async function complete($: EngineInterface, prompt: string): Promise<ModelCompleteResult | null> {
  const ask = { system: SYSTEM, prompt, maxTokens: MAX_TOKENS, effort: 'low', timeoutMs: TIMEOUT_MS } as const
  try {
    return await $.model.complete({ ...ask, model: settings.model })
  } catch (refusal) {
    // The haiku alias can be refused (a gateway): the environment may name the provider's small model.
    const other = settings.model === MODEL ? ((await $.env.get('ANTHROPIC_DEFAULT_HAIKU_MODEL').catch(() => undefined)) ?? (await $.env.get('ANTHROPIC_SMALL_FAST_MODEL').catch(() => undefined))) : undefined
    if (!other) {
      debug($, `model refused: ${String(refusal)}`)
      return null
    }
    try {
      return await $.model.complete({ ...ask, model: other })
    } catch (again) {
      debug($, `model refused: ${String(again)}`)
      return null
    }
  }
}

/** One or two calls, each retried once on a reply that does not read; the chapters in order. */
async function write($: EngineInterface, diff: FileDiff[], isLive: () => boolean): Promise<{ chapters: ChaptersChapter[]; left: number } | null> {
  const { texts, left } = batches(diff, MAX_INPUT)
  const all: ChaptersChapter[] = []
  for (let i = 0; i < texts.length; i++) {
    const notes: string[] = []
    if (texts.length > 1) notes.push(`This is part ${i + 1} of 2 of the diff; review only this part.`)
    if (left > 0 && i === texts.length - 1) notes.push(`${left} more changed files were not sent (too long).`)
    const prompt = buildPrompt(texts[i]!, notes.length ? notes.join(' ') : null)
    let chapters: ChaptersChapter[] | null = null
    for (let attempt = 0; attempt < 2 && chapters === null; attempt++) {
      if (!isLive()) return null
      const result = await complete($, prompt)
      if (result === null) return all.length > 0 ? { chapters: all, left } : null
      chapters = result.isAnswered ? parseReply(result.text) : null
    }
    if (chapters) all.push(...chapters)
  }
  return all.length > 0 ? { chapters: all, left } : null
}

/** Builds the review for `scope` and draws it as it goes: loading, then the chapters or why there are none. */
async function build($: EngineInterface, scope: string, base: string): Promise<void> {
  if (isWriting || !isOn) return
  isWriting = true
  const at = offs
  // Switched off since it began: it asks the model nothing more and draws nothing.
  const isLive = () => offs === at
  try {
    const root = await $.session.root()
    const isGit = await git($, ['rev-parse', '--is-inside-work-tree'], root).then(
      r => r.exitCode === 0 && r.stdout.trim() === 'true',
      () => false,
    )
    let words: string
    let isCut = false
    if (scope === 'last' || !isGit) {
      if (scope !== 'last' && scope !== 'changes') return void (await fail($, 'this project is not a git repository; /chapters last reviews the last turn\'s edits'))
      files = parseDiff(lastTurnEdits.map(e => e.diff).join('\n'))
      words = "the last turn's edits"
    } else {
      const got = await gitDiff($, root, scope as 'changes' | 'staged' | 'branch', base)
      if ('error' in got) return void (await fail($, got.error))
      files = parseDiff(got.text)
      words = got.words
      isCut = got.isCut
    }
    await update($, review, r => (r ? { ...r, scope: words } : r))
    if (files.length === 0) {
      return void (await fail($, isCut ? `the diff of ${words} is too long to read: its first file alone is past 4 MB` : `nothing to review in ${words}`))
    }
    const written = await write($, files, isLive)
    if (!isLive()) return
    if (written === null) return void (await fail($, 'no review this time: the model did not answer in the shape asked for'))
    await update($, review, () => ({ status: 'ready' as const, scope: words, chapters: written.chapters, at: 0, left: written.left, ...(isCut ? { isCut } : {}) }))
  } finally {
    // A review dropped by the switch gave up its lock then: a newer one may hold it now.
    if (offs === at) isWriting = false
  }
}

async function fail($: EngineInterface, reason: string): Promise<void> {
  await update($, review, r => ({ status: 'failed' as const, scope: r?.scope ?? '', chapters: [], at: 0, left: 0, reason }))
}

async function openPane($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.open({ id: PANE, title: 'chapters', focus: true, closeOnEscape: true })).isPlaced
  } catch {
    return false
  }
}

async function isPaneShown($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(p => p.id === PANE && p.isShown)
  } catch {
    return false
  }
}

/** Fills the prompt box with the chapter's question, after any draft there; never sends it. */
async function ask($: EngineInterface, n: number, chapter: ChaptersChapter): Promise<void> {
  const text = askText(n, chapter)
  let draft = ''
  try {
    draft = (await $.prompt.read()).text
  } catch {
    draft = ''
  }
  try {
    const filled = await $.prompt.fill({ text: draft.trim() === '' ? text : `\n\n${text}`, mode: draft.trim() === '' ? 'replace' : 'append' })
    $.ui.toast(filled.isFilled ? 'chapters: the question is in your prompt box. Send it when you want.' : `chapters: ${text}`)
  } catch {
    $.ui.toast(`chapters: ${text}`)
  }
}

export const register: Register = (on, options) => {
  settings = readSettings(options)
  isOn = options.enabled !== false

  on('config.set', { key: 'chapters.enabled' }, async ($, e, next) => {
    const set = await next(e)
    if (set.deny === undefined && typeof set.value === 'boolean') {
      if (isOn && !set.value) {
        // The review under way is dropped with its lock; its loading line says why.
        offs += 1
        isWriting = false
        await update($, review, r => (r?.status === 'loading' ? { status: 'failed' as const, scope: r.scope, chapters: [], at: 0, left: 0, reason: STOPPED } : r)).catch(error => debug($, String(error)))
      }
      isOn = set.value
      $.ui.invalidate('ui.render')
    }
    return set
  })

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'chapters',
        description: 'A readable review of your changes, in chapters with risk marks',
        argumentHint: '[staged | branch [base] | last]',
        immediate: true,
      })
    } catch (error) {
      debug($, String(error))
    }
    return next(e)
  })

  // Claude's own edits this turn, for a review outside git or of the last turn.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!isOn || ran.deny !== undefined || ran.isError) return ran
    try {
      const input = e as unknown as Record<string, unknown>
      const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
      const root = await $.session.root()
      const path = str(input.file_path) ?? str(input.notebook_path)
      if (path !== undefined) {
        const name = relative(path, root)
        if (e.tool === 'Edit') turnEdits.push({ path: name, diff: editDiff(name, str(input.old_string) ?? '', str(input.new_string) ?? '') })
        else if (e.tool === 'Write') turnEdits.push({ path: name, diff: newFileDiff(name, str(input.content) ?? '') })
        else if (e.tool === 'NotebookEdit') turnEdits.push({ path: name, diff: newFileDiff(name, str(input.new_source) ?? '') })
      }
    } catch (error) {
      debug($, String(error))
    }
    return ran
  })

  on('turn.start', ($, e, next) => {
    turnEdits = []
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined && turnEdits.length > 0) {
      lastTurnEdits = turnEdits
      turnEdits = []
    }
    return next(e)
  })

  // /chapters [staged | branch [base] | last]: a model call is the person's to start.
  on('command.run', { command: 'chapters' }, async ($, e) => {
    if (!isOn) {
      $.ui.toast(OFF_TEXT)
      return {}
    }
    try {
      const [verb = '', arg = ''] = e.args.trim().split(/\s+/)
      const word = verb.toLowerCase()
      if (word === '' && (await read($, review))?.status === 'ready') {
        if (!(await openPane($))) $.ui.toast('chapters: the review draws in a pane, which only the terminal and the desktop app have.')
        return {}
      }
      if (!PERSON.has(e.origin.kind)) {
        $.ui.toast('chapters: a new review runs only when you type /chapters yourself.')
        return {}
      }
      const scope = word === '' || word === 'new' ? 'changes' : word
      if (!['changes', 'staged', 'branch', 'last'].includes(scope)) {
        $.ui.toast('chapters: /chapters, /chapters staged, /chapters branch [base], or /chapters last.')
        return {}
      }
      const base = scope === 'branch' ? readSettings({ base: arg || settings.base }).base : settings.base
      await update($, review, () => ({ status: 'loading' as const, scope: '', chapters: [], at: 0, left: 0 }))
      if (!(await openPane($))) $.ui.toast('chapters: writing the review; it draws in a pane, which only the terminal and the desktop app have.')
      $.clock.after(0, () => void build($, scope, base).catch(error => debug($, String(error))))
    } catch (error) {
      debug($, String(error))
      $.ui.toast('chapters: that command failed, and nothing changed.')
    }
    return {}
  })

  // One dim line while a review waits unread and its pane is not on screen.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isOn) return next(e)
    const below = await next(e)
    const r = await read($, review)
    const words = r?.status === 'ready' ? bandWords(r.chapters) : null
    if (words === null || (e.surface !== 'terminal' && e.surface !== 'desktop') || (await isPaneShown($))) return below
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        <Text key="chapters" dimColor wrap="truncate-end">
          {words}
        </Text>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Code, Text } = $.ui.resolve(e)
    if (!isOn) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text key="off" dimColor>
            {OFF_TEXT}
          </Text>
        </Box>
      )
    }
    const r = await read($, review)
    if (r === null || r.status !== 'ready') {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text key="state" dimColor={r?.status !== 'failed'}>
            {r === null ? 'No review yet. /chapters reviews your changes.' : r.status === 'loading' ? `Writing the review${r.scope ? ` of ${r.scope}` : ''}...` : sanitize(r.reason, 240)}
          </Text>
        </Box>
      )
    }
    const at = Math.min(r.at, r.chapters.length - 1)
    const chapter = r.chapters[at]!
    const risk = RISK_MARK[chapter.risk]
    const hunks = chapter.files.flatMap(f => hunksFor(files, f.path, f.lines).map(hunk => ({ path: f.path, hunk }))).slice(0, HUNKS_SHOWN)
    const go = (to: number, markRead = false) => () =>
      void update($, review, cur => {
        if (cur === null || cur.status !== 'ready') return cur
        const chapters = markRead ? cur.chapters.map((c, i) => (i === cur.at ? { ...c, isRead: true } : c)) : cur.chapters
        return { ...cur, chapters, at: Math.max(0, Math.min(chapters.length - 1, to)) }
      })
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text key="title" bold>{`${sanitize(r.scope, 60)} · ${progressWords(r.chapters)}`}</Text>
        {r.chapters.map((c, i) => (
          <Box key={`toc-${i}`} flexDirection="row" gap={1}>
            <Box key="mark" width={1} flexShrink={0}>
              <Text color={RISK_MARK[c.risk].color}>{RISK_MARK[c.risk].mark}</Text>
            </Box>
            <Box key="name" flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end" bold={i === at} dimColor={c.isRead && i !== at}>{`${i + 1}. ${c.title}`}</Text>
            </Box>
            <Box key="read" width={6} flexShrink={0}>
              <Text dimColor>{c.isRead ? 'read' : ''}</Text>
            </Box>
          </Box>
        ))}
        <Box key="chapter" flexDirection="column" marginTop={1}>
          <Text key="heading" bold>{`Chapter ${at + 1} of ${r.chapters.length}: ${chapter.title}`}</Text>
          <Text key="what">{`What: ${chapter.what}`}</Text>
          {chapter.why ? <Text key="why">{`Why it matters: ${chapter.why}`}</Text> : null}
          <Text key="risk" color={risk.color}>{`${risk.mark} ${risk.word}${chapter.riskWhy ? `: ${chapter.riskWhy}` : ''}`}</Text>
          {chapter.question ? <Text key="question">{`Check: ${chapter.question}`}</Text> : null}
        </Box>
        {hunks.map(({ path, hunk }, i) => (
          <Box key={`hunk-${i}`} flexDirection="column" marginTop={1}>
            <Text key="path" dimColor>
              {path}
            </Text>
            <Code key="code" source={shortHunk(hunk)} format="diff" path={path} />
          </Box>
        ))}
        <Box key="buttons" flexDirection="row" gap={2} marginTop={1}>
          <Button key="prev" label="prev" onPress={go(at - 1)} />
          <Button key="next" label="next" onPress={go(at + 1)} />
          <Button key="read" label="mark read" onPress={go(at + 1, true)} />
          <Button key="ask" label="ask Claude" onPress={() => void ask($, at + 1, chapter)} />
        </Box>
        <Text key="note" dimColor wrap="wrap">
          {`${r.isCut ? 'The diff was too long to read in full: the files past the first 4 MB are not in this review. ' : ''}${r.left > 0 ? `${r.left} changed files were too long to send and are not in this review. ` : ''}It reads and explains only: nothing is applied or sent. ${changedLines(files)} changed lines; ${costWords()}.`}
        </Text>
      </Box>
    )
  })
}
