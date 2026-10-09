// noted: turns your corrections into permanent rules, without duplicates.
//
// prompt.submit  a keyword pre-filter (detect.ts) picks prompts that read like
//                a correction; only those reach one small-model call, after the
//                prompt has entered, so the turn is never held up or changed.
// AbovePrompt    the band: the proposed rule with Save to project / Save
//                globally / Edit / Skip, or Replace old rule on a conflict.
// /rules         the rules noted learned, with dates, each removable.
//
// Files: only ./CLAUDE.md and ~/.claude/CLAUDE.md are read, and they are
// written only from a button press (or `/rules remove <n>`).

import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, SessionMessage } from 'claude-code'

import type { NotedBand, NotedExisting, NotedLearned, NotedScope } from '../types'
import { looksLikeCorrection } from './detect'
import { buildPrompt, MAX_REPLY_TOKENS, MODEL, parseVerdict, SYSTEM, TIMEOUT_MS } from './model'
import {
  appendRule,
  cleanRule,
  houseRules,
  MAX_RULE_CHARS,
  removeRule,
  replaceRule,
  sameRule,
} from './rules'

type Dollar = EngineInterface

const band = atom({ plugin: 'noted', key: 'band' } as const, null)

/** Where the learned rules and their dates are kept, across sessions. */
const STORE_KEY = 'learned'
const MAX_LEARNED = 500

/** Prompts written by the person (terminal, phone, desktop app), not by tools or peers. */
const PERSON = new Set(['composer', 'bridge', 'sdk'])

// ---------------------------------------------------------------- the files

type File = { path: string; label: string }

const trimEnd = (dir: string) => dir.replace(/[\\/]+$/, '')

async function projectFile($: Dollar): Promise<File> {
  return { path: `${trimEnd(await $.session.root())}/CLAUDE.md`, label: './CLAUDE.md' }
}

/** ~/.claude/CLAUDE.md, or CLAUDE_CONFIG_DIR's, as Claude Code itself reads it. */
async function globalFile($: Dollar): Promise<File | undefined> {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  if (config) return { path: `${trimEnd(config)}/CLAUDE.md`, label: `${trimEnd(config)}/CLAUDE.md` }
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  return home ? { path: `${trimEnd(home)}/.claude/CLAUDE.md`, label: '~/.claude/CLAUDE.md' } : undefined
}

function fileFor($: Dollar, scope: NotedScope): Promise<File | undefined> {
  return scope === 'project' ? projectFile($) : globalFile($)
}

type Read = { ok: true; text: string } | { ok: false; reason: string }

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The file's text: '' when it does not exist yet. Anything else that keeps
 * it from being read whole is a failure, so a write never clobbers a file
 * it could not read.
 */
async function readText($: Dollar, path: string): Promise<Read> {
  try {
    if (!(await $.fs.exists(path))) return { ok: true, text: '' }
    const text = await $.fs.read(path)
    // A replacement character means bytes that were not UTF-8: writing the
    // text back would change them, so leave the file alone.
    if (text.includes('\uFFFD')) return { ok: false, reason: 'it holds bytes that are not UTF-8 text' }
    return { ok: true, text }
  } catch (err) {
    return { ok: false, reason: reasonOf(err) }
  }
}

/** Every House rule in the two files, project first. Unreadable files add none. */
async function existingRules($: Dollar): Promise<NotedExisting[]> {
  const out: NotedExisting[] = []
  for (const scope of ['project', 'global'] as const) {
    const file = await fileFor($, scope)
    if (!file) continue
    const got = await readText($, file.path)
    if (got.ok) out.push(...houseRules(got.text).map(text => ({ text, scope, path: file.path, label: file.label })))
  }
  return out
}

// ---------------------------------------------------------- the learned list

function isLearned(v: unknown): v is NotedLearned {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.rule === 'string' &&
    (o.scope === 'project' || o.scope === 'global') &&
    typeof o.path === 'string' &&
    typeof o.addedAt === 'string'
  )
}

async function loadLearned($: Dollar): Promise<NotedLearned[]> {
  const value = await $.store.get(STORE_KEY)
  return Array.isArray(value) ? value.filter(isLearned) : []
}

async function remember($: Dollar, rule: string, scope: NotedScope, path: string): Promise<void> {
  const addedAt = new Date(await $.clock.now()).toISOString()
  const entry: NotedLearned = { id: crypto.randomUUID(), rule, scope, path, addedAt }
  await $.store.set(STORE_KEY, [...(await loadLearned($)), entry].slice(-MAX_LEARNED))
}

async function forget($: Dollar, drop: (l: NotedLearned) => boolean): Promise<void> {
  await $.store.set(STORE_KEY, (await loadLearned($)).filter(l => !drop(l)))
}

/**
 * The learned rules that apply here (this project's file and the global
 * one) and are still in their file, oldest first. Ones the person deleted
 * by hand are dropped from the list; an unreadable file keeps its own.
 */
async function learnedHere($: Dollar): Promise<NotedLearned[]> {
  const files = [await projectFile($), await globalFile($)].filter((f): f is File => f !== undefined)
  const paths = new Set(files.map(f => f.path))
  const here = (await loadLearned($)).filter(l => paths.has(l.path))

  const rulesIn = new Map<string, string[] | null>()
  for (const path of paths) {
    const got = await readText($, path)
    rulesIn.set(path, got.ok ? houseRules(got.text) : null)
  }
  const isPresent = (l: NotedLearned) => {
    const rules = rulesIn.get(l.path)
    return rules === null || rules === undefined || rules.some(r => sameRule(r, l.rule))
  }
  const gone = new Set(here.filter(l => !isPresent(l)).map(l => l.id))
  if (gone.size > 0) await forget($, l => gone.has(l.id))
  return here.filter(l => !gone.has(l.id)).sort((a, b) => a.addedAt.localeCompare(b.addedAt))
}

function day(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'an unknown date'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ------------------------------------------------------------------ learning

/** The text of the assistant message the prompt answered, or ''. */
function previousAssistant(messages: readonly SessionMessage[], prompt: string): string {
  // Start just before the prompt itself, in case the new turn already wrote.
  const needle = prompt.trim().slice(0, 200)
  let i = messages.length - 1
  for (let j = messages.length - 1; j >= 0; j--) {
    const m = messages[j]
    if (m?.role === 'user' && needle !== '' && m.text.includes(needle)) {
      i = j - 1
      break
    }
  }
  for (; i >= 0; i--) {
    const m = messages[i]
    if (m?.role === 'assistant' && m.text.trim() !== '') return m.text
  }
  return ''
}

const notice = (text: string, isError = false): NotedBand => ({ kind: 'notice', text, isError })

let hasSaidNoBand = false
let hasSaidNoModel = false

/** One model call: the correction becomes a proposal, an "already a rule", or nothing. */
async function learn($: Dollar, correction: string): Promise<void> {
  const surfaces = await $.session.surfaces()
  if (surfaces.length === 0) return // headless: nobody to show a band to
  if (!surfaces.some(s => s === 'terminal' || s === 'desktop')) {
    if (!hasSaidNoBand) $.ui.log('noted: its band shows in the terminal and the desktop app only, so corrections made here are not captured.')
    hasSaidNoBand = true
    return
  }
  // Never pull a rule out from under the person while they are editing it.
  const shown = await read($, band)
  if (shown?.kind === 'proposal' && shown.isEditing) return

  const tail = previousAssistant(await $.session.messages(), correction)
  const existing = await existingRules($)
  let reply: Awaited<ReturnType<Dollar['model']['complete']>>
  try {
    reply = await $.model.complete({
      model: MODEL,
      system: SYSTEM,
      prompt: buildPrompt(correction, tail, existing.map(r => r.text)),
      maxTokens: MAX_REPLY_TOKENS,
      effort: 'low',
      timeoutMs: TIMEOUT_MS,
    })
  } catch (err) {
    // Refused before sending (the alias blocked on Bedrock, Vertex or a
    // gateway): say so once rather than going quiet for the whole session.
    if (!hasSaidNoModel) $.ui.log(`noted: the ${MODEL} model is not available here (${reasonOf(err)}), so corrections are not turned into rules.`)
    hasSaidNoModel = true
    return
  }
  if (!reply.isAnswered) {
    $.ui.log(`noted: no rule this time (${reply.reason})`, { to: 'debug' })
    return
  }
  const verdict = parseVerdict(reply.text, existing.length)
  if (verdict === undefined) {
    $.ui.log('noted: the model answered off-format; nothing proposed', { to: 'debug' })
    return
  }
  const rule = verdict.rule
  if (rule === null) return

  const same =
    existing.find(r => sameRule(r.text, rule)) ??
    (verdict.duplicateOf === null ? undefined : existing[verdict.duplicateOf])
  const conflict = verdict.conflictsWith === null ? null : (existing[verdict.conflictsWith] ?? null)
  const next: NotedBand = same
    ? notice(`already a rule in ${same.label}: ${same.text}`)
    : { kind: 'proposal', rule, conflict, isEditing: false, note: null }
  // The person may have started editing an earlier proposal while the model ran.
  await update($, band, now => (now?.kind === 'proposal' && now.isEditing ? now : next))
}

// ------------------------------------------------------------------- actions

// One file edit at a time: a second press while one runs is ignored.
let isBusy = false
async function exclusive(work: () => Promise<void>): Promise<void> {
  if (isBusy) return
  isBusy = true
  try {
    await work()
  } finally {
    isBusy = false
  }
}

async function proposal($: Dollar) {
  const shown = await read($, band)
  return shown?.kind === 'proposal' ? shown : undefined
}

function save($: Dollar, scope: NotedScope): Promise<void> {
  return exclusive(async () => {
    const shown = await proposal($)
    if (!shown) return
    const file = await fileFor($, scope)
    if (!file) {
      await update($, band, () => notice('cannot find your home folder, so ~/.claude/CLAUDE.md is out of reach. Nothing was saved.', true))
      return
    }
    const got = await readText($, file.path)
    if (!got.ok) {
      await update($, band, () => notice(`could not read ${file.label} (${got.reason}). Nothing was saved.`, true))
      return
    }
    const same = houseRules(got.text).find(r => sameRule(r, shown.rule))
    if (same) {
      await update($, band, () => notice(`already a rule in ${file.label}: ${same}`))
      return
    }
    try {
      await $.fs.write(file.path, appendRule(got.text, shown.rule))
    } catch (err) {
      await update($, band, () => notice(`could not write ${file.label} (${reasonOf(err)}). Nothing was saved.`, true))
      return
    }
    await remember($, shown.rule, scope, file.path)
    await update($, band, () => notice(`saved to ${file.label}: ${shown.rule}`))
  })
}

function replaceOld($: Dollar): Promise<void> {
  return exclusive(async () => {
    const shown = await proposal($)
    if (!shown?.conflict) return
    const old = shown.conflict
    const label = old.label
    const got = await readText($, old.path)
    if (!got.ok) {
      await update($, band, () => notice(`could not read ${label} (${got.reason}). Nothing was changed.`, true))
      return
    }
    const replaced = replaceRule(got.text, old.text, shown.rule)
    if (replaced === null) {
      // The old rule went away meanwhile: nothing to contradict any more.
      await update($, band, () => ({ ...shown, conflict: null, note: `The old rule is no longer in ${label}; save the new one instead.` }))
      return
    }
    try {
      await $.fs.write(old.path, replaced)
    } catch (err) {
      await update($, band, () => notice(`could not write ${label} (${reasonOf(err)}). Nothing was changed.`, true))
      return
    }
    await forget($, l => l.path === old.path && sameRule(l.rule, old.text))
    await remember($, shown.rule, old.scope, old.path)
    await update($, band, () => notice(`replaced the old rule in ${label}: ${shown.rule}`))
  })
}

async function finishEdit($: Dollar, value: string): Promise<void> {
  const rule = cleanRule(value)
  const tooLong = rule.length > MAX_RULE_CHARS
  await update($, band, shown => {
    if (shown?.kind !== 'proposal') return shown
    if (rule === '') return { ...shown, isEditing: false }
    if (tooLong) return { ...shown, isEditing: false, note: `A rule is kept under ${MAX_RULE_CHARS} characters; the edit was not kept.` }
    return { ...shown, rule, isEditing: false, note: null }
  })
}

/** Removes a learned rule from its file and the list; says what happened. */
async function removeLearned($: Dollar, item: NotedLearned): Promise<string> {
  const label = item.scope === 'project' ? './CLAUDE.md' : ((await globalFile($))?.label ?? item.path)
  const got = await readText($, item.path)
  if (!got.ok) return `Could not read ${label} (${got.reason}). Nothing was removed.`
  const removed = removeRule(got.text, item.rule)
  if (removed !== null) {
    try {
      await $.fs.write(item.path, removed)
    } catch (err) {
      return `Could not write ${label} (${reasonOf(err)}). Nothing was removed.`
    }
  }
  await forget($, l => l.id === item.id)
  return removed === null ? `"${item.rule}" was no longer in ${label}; dropped it from the list.` : `Removed from ${label}: ${item.rule}`
}

async function showRules($: Dollar, message: string | null): Promise<NotedLearned[]> {
  const items = await learnedHere($)
  const globalLabel = (await globalFile($))?.label ?? '~/.claude/CLAUDE.md'
  await update($, band, (): NotedBand => ({ kind: 'rules', items, globalLabel, message }))
  return items
}

function pressRemove($: Dollar, id: string): Promise<void> {
  return exclusive(async () => {
    const item = (await learnedHere($)).find(l => l.id === id)
    await showRules($, item ? await removeLearned($, item) : 'That rule was already gone.')
  })
}

function listText(items: readonly NotedLearned[], globalLabel: string): string {
  if (items.length === 0) {
    return 'No house rules learned yet. When you correct Claude ("no, use pnpm"), noted proposes a rule above the prompt.'
  }
  const rows = items.map(
    (l, i) => `${i + 1}. ${l.rule} (${l.scope === 'project' ? './CLAUDE.md' : globalLabel}, added ${day(l.addedAt)})`,
  )
  return [
    'House rules learned by noted:',
    '',
    ...rows,
    '',
    'Remove one with its button above the prompt, or with `/rules remove <number>`.',
  ].join('\n')
}

// ------------------------------------------------------------------ register

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'rules',
        description: 'List the house rules noted learned, with dates, and remove one',
        argumentHint: '[remove <number>]',
        immediate: true,
      })
    } catch (err) {
      $.ui.log(`noted: could not register /rules (${reasonOf(err)})`, { to: 'debug' })
    }
    return next(e)
  })

  // Observes only: the prompt goes through untouched, and any failure here
  // lets it through too (the .catch passes it on, or replays what it got).
  on('prompt.submit', async ($, e, next) => {
    const isCorrection = PERSON.has(e.origin.kind) && looksLikeCorrection(e.text)
    const entered = await next(e)
    if (entered.drop !== undefined) return entered

    try {
      // A one-line notice ("saved", "already a rule") lasts until the next prompt.
      const shown = await read($, band)
      if (shown?.kind === 'notice') await update($, band, () => null)
      if (isCorrection) await learn($, e.text)
    } catch (err) {
      $.ui.log(`noted: ${reasonOf(err)}`, { to: 'debug' })
    }
    return entered
  }).catch(($, e, next) => next(e))

  // `/rules` lists (in the transcript and in the band); `/rules remove <n>`
  // removes by number, for surfaces without the band.
  on('command.run', { command: 'rules' }, async ($, e) => {
    const args = e.args.trim()
    if (args === '') {
      const items = await showRules($, null)
      const globalLabel = (await globalFile($))?.label ?? '~/.claude/CLAUDE.md'
      return { text: listText(items, globalLabel) }
    }
    const remove = /^(?:remove|rm|delete)\s+(\d+)$/i.exec(args)
    if (!remove) return { text: 'Usage: `/rules` to list, `/rules remove <number>` to remove one.' }
    const item = (await learnedHere($))[Number(remove[1]) - 1]
    if (!item) return { text: `There is no rule ${remove[1]}. Run \`/rules\` to see the list.` }
    let text = 'noted is busy with another edit; try again in a moment.'
    await exclusive(async () => {
      text = await removeLearned($, item)
    })
    if ((await read($, band))?.kind === 'rules') await showRules($, text)
    return { text }
  }).catch(() => ({ text: 'noted: /rules failed; the debug log (claude --debug) says why.' }))

  // The band, drawn above whatever other mods draw there (next(e) beneath),
  // never in place of it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if (e.props.hasSurvey) return next(e)
    const shown = await read($, band)
    if (shown === null) return next(e)
    const ui = $.ui.resolve(e)
    const { Box } = ui
    const below = await next(e)
    return (
      <Box flexDirection="column">
        <Box key="noted" flexDirection="column">
          {bandTree($, ui, shown)}
        </Box>
        {below}
      </Box>
    )
  })
}

// ---------------------------------------------------------------- the band

// Texts the tests address sit in keyed Boxes: a Text carries no key of its
// own. File-writing buttons have no hotkey, so a stray key in a focused band
// never writes a file.
function bandTree($: Dollar, ui: Elements['terminal' | 'desktop'], shown: NotedBand) {
  const { Box, Text, Button, Input } = ui
  const close = () => update($, band, () => null)
  const setEditing = (isEditing: boolean) =>
    update($, band, b => (b?.kind === 'proposal' ? { ...b, isEditing } : b))

  if (shown.kind === 'notice') {
    return (
      <Box flexDirection="row" gap={1}>
        <Box key="notice" flexShrink={1}>
          <Text color={shown.isError ? 'error' : undefined}>Noted: {shown.text}</Text>
        </Box>
        <Button key="ok" label="OK" hotkey="o" role="dismiss" onPress={close} />
      </Box>
    )
  }

  if (shown.kind === 'rules') {
    return (
      <Box flexDirection="column">
        <Text bold>House rules learned by noted</Text>
        {shown.items.length === 0 && (
          <Text dimColor>None yet. Correct Claude ("no, use pnpm") and save the rule it proposes.</Text>
        )}
        {shown.items.map((l, i) => (
          <Box flexDirection="row" gap={1}>
            <Button key={`remove-${l.id}`} label="Remove" dimColor onPress={() => pressRemove($, l.id)} />
            <Box flexShrink={1}>
              <Text>
                {i + 1}. {l.rule}{' '}
              </Text>
              <Text dimColor>
                ({l.scope === 'project' ? './CLAUDE.md' : shown.globalLabel}, added {day(l.addedAt)})
              </Text>
            </Box>
          </Box>
        ))}
        {shown.message !== null && (
          <Box key="message">
            <Text dimColor>{shown.message}</Text>
          </Box>
        )}
        <Button key="done" label="Done" hotkey="d" role="dismiss" onPress={close} />
      </Box>
    )
  }

  const conflict = shown.conflict
  return (
    <Box flexDirection="column">
      <Text bold>Noted - save this as a house rule?</Text>
      {shown.isEditing ? (
        <Input
          key="rule-input"
          label="Rule: "
          value={shown.rule}
          submitLabel="keep"
          autoFocus
          onSubmit={value => finishEdit($, value)}
        />
      ) : (
        <Box key="rule">
          <Text>{shown.rule}</Text>
        </Box>
      )}
      {conflict !== null && (
        <Box key="conflict">
          <Text color="warning">
            Conflicts with a rule in {conflict.label}: {conflict.text}
          </Text>
        </Box>
      )}
      {shown.note !== null && (
        <Box key="note">
          <Text dimColor>{shown.note}</Text>
        </Box>
      )}
      {shown.isEditing ? (
        <Box flexDirection="row" gap={1}>
          <Button key="cancel-edit" label="Cancel edit" onPress={() => setEditing(false)} />
        </Box>
      ) : (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {conflict !== null ? (
            <Button key="replace" label="Replace old rule" variant="primary" onPress={() => replaceOld($)} />
          ) : (
            [
              <Button key="save-project" label="Save to project" variant="primary" onPress={() => save($, 'project')} />,
              <Button key="save-global" label="Save globally" onPress={() => save($, 'global')} />,
            ]
          )}
          <Button key="edit" label="Edit" hotkey="e" onPress={() => setEditing(true)} />
          <Button key="skip" label="Skip" hotkey="s" role="dismiss" onPress={close} />
        </Box>
      )}
    </Box>
  )
}
