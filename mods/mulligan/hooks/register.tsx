// mulligan: a do-over for shell commands. Before Claude runs a Bash command
// that destroys files (the same classifier last-look uses: rm -r, find
// -delete, xargs rm, git clean, git reset --hard, git checkout or restore over
// changes, git worktree remove, a redirect over a file), it saves what that
// command can destroy: the paths it names, or git's tracked changes as a
// commit object (`git stash create`, which moves no ref), or the untracked
// files, or the whole project when the targets are only known as it runs.
// /mulligan lists them and puts one back after a confirm press.
//
// Saved before the tool runs, into a pending archive; kept only once the
// command really ran (a hold beneath that refuses it leaves no snapshot). Ten
// per project, in slots under ~/.claude/mulligan/<project key>/, reused in
// turn: nothing is ever deleted with rm. A restore writes files back over what
// is there and deletes nothing newer, then tells Claude to re-read.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MulliganSnapshot } from '../types'
import { classify } from './classify'
import { agoWords, clean, isEmpty, oneLine, planFor, projectKey, restoreNote, scopeWords, shown, sizeWords, treePlan } from './plan'
import type { Plan } from './plan'

const SNAPSHOTS = { plugin: 'mulligan', key: 'snapshots' } as const
const BAND = { plugin: 'mulligan', key: 'band' } as const
const VIEW = { plugin: 'mulligan', key: 'view' } as const
const snapshots = atom(SNAPSHOTS, [])
const band = atom(BAND, null)
const view = atom(VIEW, { kind: 'list', confirm: 0 })

/** Snapshots kept per project, and so the archive slots. */
export const KEEP = 10
const BAND_MS = 8_000
const PANE = 'mulligan'
const TAR_MS = 20_000
const DIFF_FILES = 50
/** Origins that are the person: typed, the phone bridge, the desktop app's box. */
const PERSON = new Set(['composer', 'bridge', 'sdk'])
/** git never takes the index lock for us, never prompts, and speaks C. */
const ENV = { LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
const SHA = /^[0-9a-f]{40,64}$/

export type Settings = { always: RegExp | undefined; ignore: RegExp | undefined; capBytes: number }

/** The person's settings: patterns that do not compile are left out, the cap clamped. */
export function readSettings(options: Record<string, unknown>): Settings {
  const pattern = (v: unknown) => {
    if (typeof v !== 'string' || v.trim() === '' || v.length > 500) return undefined
    try {
      return new RegExp(v, 'i')
    } catch {
      return undefined
    }
  }
  const mb = typeof options.capMB === 'number' && Number.isFinite(options.capMB) ? Math.min(5_000, Math.max(1, options.capMB)) : 200
  return { always: pattern(options.always), ignore: pattern(options.ignore), capBytes: Math.round(mb * 1_000_000) }
}

type Index = { v: 1; next: number; snapshots: MulliganSnapshot[] }
type Where = { root: string; cwd: string; home: string | undefined; base: string }
type Pending = { command: string; plan: Plan; sha?: string; archive?: string; bytes: number; where: Where }
type Prepared = { pending?: Pending; skip?: { text: string; tone: 'subtle' | 'warning' } }

let settings: Settings = readSettings({})

// The switch (`enabled`, which /config and the modmyclaude hub flip): off, Mulligan saves
// nothing before any command and draws no band. The do-overs it already saved stay, and
// /mulligan restore still puts one back: they are the person's files, and turning the
// switch on just to reach them would start saving again, which can reuse the oldest slot.
// The engine reloads the mod with the new value; the config.set hook below is the same
// switch at once.
let isOn = true
const OFF_TEXT = 'Mulligan is off. /mods or /config turns it on.'

/** Index writes one at a time: Claude can run two commands at once. */
let chain: Promise<unknown> = Promise.resolve()

/** Runs `work` after every index write before it; a failure never blocks the next one. */
function queued<T>(work: () => Promise<T>): Promise<T> {
  const done = chain.then(work)
  chain = done.catch(() => undefined)
  return done
}
let pendingCount = 0

function debug($: EngineInterface, error: unknown): void {
  $.ui.log(`mulligan: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
}

function run($: EngineInterface, argv: string[], cwd: string, stdin?: string, timeoutMs = 15_000) {
  return $.process.run(argv, { cwd, env: ENV, timeoutMs, ...(stdin === undefined ? {} : { stdin }) })
}

async function whereNow($: EngineInterface): Promise<Where | null> {
  const [root, cwd, config, home] = await Promise.all([$.session.root(), $.session.cwd(), $.env.get('CLAUDE_CONFIG_DIR'), $.env.get('HOME')])
  const dir = config ? config.replace(/\/+$/, '') : home ? `${home.replace(/\/+$/, '')}/.claude` : undefined
  if (dir === undefined) return null
  return { root, cwd, home: home || undefined, base: `${dir}/mulligan/${projectKey(root)}` }
}

async function isGitAt($: EngineInterface, root: string): Promise<boolean> {
  try {
    const r = await run($, ['git', 'rev-parse', '--is-inside-work-tree'], root)
    return r.exitCode === 0 && r.stdout.trim() === 'true'
  } catch {
    return false
  }
}

/** The project's snapshot list, from its folder; empty when there is none or it does not read. */
async function readIndex($: EngineInterface, base: string): Promise<Index> {
  try {
    const parsed = JSON.parse(await $.fs.read(`${base}/index.json`)) as Partial<Index>
    if (parsed.v !== 1 || typeof parsed.next !== 'number' || !Array.isArray(parsed.snapshots)) throw new Error('not an index')
    return { v: 1, next: parsed.next, snapshots: parsed.snapshots.filter(s => typeof s?.n === 'number').slice(-KEEP) }
  } catch {
    return { v: 1, next: 1, snapshots: [] }
  }
}

async function sizeOf($: EngineInterface, base: string, name: string): Promise<number> {
  try {
    return (await $.fs.list(base)).find(entry => entry.name === name)?.size ?? 0
  } catch {
    return 0
  }
}

/** Empties one of our own archives: the API has no delete, and an empty file costs nothing. */
async function emptyArchive($: EngineInterface, base: string, name: string): Promise<void> {
  if (!/^(?:slot-\d|pending-\d+)\.tar$/.test(name)) return
  await $.fs.write(`${base}/${name}`, '').catch(() => undefined)
}

/**
 * Before the command runs: what it can destroy, saved into a pending archive
 * (and a git object). A skip says why nothing was saved, when that is news.
 */
async function prepare($: EngineInterface, command: string): Promise<Prepared> {
  if (settings.ignore?.test(command)) return {}
  const where = await whereNow($)
  if (where === null) return {}
  const isGit = await isGitAt($, where.root)
  let plan = planFor(classify(command, where.home === undefined ? {} : { home: where.home }), where.cwd, where.root, isGit)
  if (settings.always?.test(command)) plan = { ...treePlan(isGit), outside: plan?.outside ?? [], notes: plan?.notes ?? [] }
  if (plan === null) return {}
  const cmd = oneLine(clean(command), 48)
  if (isEmpty(plan.scope)) {
    return plan.outside.length > 0 ? { skip: { text: `mulligan: no do-over for "${cmd}": ${clean(plan.outside[0]!)} is outside the project.`, tone: 'subtle' } } : {}
  }
  const { root, base } = where
  let sha: string | undefined
  if (plan.scope.isTracked) {
    const made = await run($, ['git', 'stash', 'create'], root).catch(() => undefined)
    sha = made?.exitCode === 0 ? made.stdout.trim() : undefined
    if (!sha) {
      // Nothing changed since the last commit: HEAD is the tracked files' state.
      const head = await run($, ['git', 'rev-parse', '--verify', 'HEAD'], root).catch(() => undefined)
      sha = head?.exitCode === 0 ? head.stdout.trim() : undefined
    }
    if (sha !== undefined && !SHA.test(sha)) sha = undefined
  }

  // The files to copy: the whole tree without git; else the untracked ones and the named paths that exist.
  const isWholeTree = plan.scope.isTree && !plan.scope.isTracked
  const files: string[] = []
  if (!isWholeTree) {
    if (plan.scope.isUntracked) {
      const listed = await run($, ['git', 'ls-files', '--others', '--exclude-standard', '-z', '--', '.'], root).catch(() => undefined)
      if (listed?.exitCode === 0) files.push(...listed.stdout.split('\0').filter(name => name !== ''))
    }
    for (const path of plan.scope.paths) {
      if (await $.fs.exists(path).catch(() => false)) files.push(shown(path, root))
    }
  }
  let archive: string | undefined
  let bytes = 0
  if (isWholeTree || files.length > 0) {
    const name = `pending-${++pendingCount}.tar`
    await run($, ['mkdir', '-p', base], root)
    const argv = isWholeTree
      ? ['tar', '-cf', `${base}/${name}`, '--exclude=.git', '--exclude=node_modules', '.']
      : ['tar', '-cf', `${base}/${name}`, '--exclude=.git', '--null', '-T', '-']
    let ok = false
    try {
      const made = await run($, argv, root, isWholeTree ? undefined : `${files.join('\0')}\0`, TAR_MS)
      ok = made.exitCode === 0
    } catch {
      ok = false // too slow: too big
    }
    bytes = ok ? await sizeOf($, base, name) : 0
    if (!ok || bytes > settings.capBytes) {
      await emptyArchive($, base, name)
      const why = ok ? `too big to save (${sizeWords(bytes)})` : 'could not be saved'
      if (sha === undefined) return { skip: { text: `mulligan: ${why}; "${cmd}" runs without a do-over.`, tone: 'warning' } }
      plan = { ...plan, notes: [...plan.notes, `the files it names were ${why}`] }
      bytes = 0
    } else {
      archive = name
    }
  }
  if (sha === undefined && archive === undefined) return {} // nothing there to lose (a redirect to a new file)
  return { pending: { command, plan, ...(sha === undefined ? {} : { sha }), ...(archive === undefined ? {} : { archive }), bytes, where } }
}

/** After the command ran: the pending snapshot takes its slot, the oldest gives way. */
async function commit($: EngineInterface, p: Pending): Promise<MulliganSnapshot> {
  const { base, root } = p.where
  const index = await readIndex($, base)
  const n = index.next
  const slot = `slot-${(n - 1) % KEEP}.tar`
  if (p.archive !== undefined) {
    const moved = await run($, ['mv', '-f', `${base}/${p.archive}`, `${base}/${slot}`], root)
    if (moved.exitCode !== 0) throw new Error(`could not keep the snapshot: ${moved.stderr.trim()}`)
  }
  const snap: MulliganSnapshot = {
    n,
    at: await $.clock.now(),
    command: oneLine(clean(p.command), 160),
    scope: scopeWords(p.plan.scope, root),
    ...(p.sha === undefined ? {} : { sha: p.sha }),
    ...(p.archive === undefined ? {} : { archive: slot }),
    bytes: p.bytes,
  }
  const kept = [...index.snapshots, snap].slice(-KEEP)
  for (const old of index.snapshots) {
    if (!kept.includes(old) && old.archive !== undefined && old.archive !== snap.archive) await emptyArchive($, base, old.archive)
  }
  await $.fs.write(`${base}/index.json`, JSON.stringify({ v: 1, next: n + 1, snapshots: kept } satisfies Index))
  await update($, snapshots, () => kept)
  return snap
}

async function showBand($: EngineInterface, text: string, tone: 'subtle' | 'warning'): Promise<void> {
  const until = (await $.clock.now()) + BAND_MS
  await update($, band, () => ({ text, tone, until }))
  $.clock.after(BAND_MS, () => {
    void update($, band, b => (b !== null && b.until <= until ? null : b)).catch(() => undefined)
  })
}

async function findSnapshot($: EngineInterface, n: number): Promise<{ where: Where; snap: MulliganSnapshot } | null> {
  const where = await whereNow($)
  if (where === null) return null
  const snap = (await readIndex($, where.base)).snapshots.find(s => s.n === n)
  return snap === undefined ? null : { where, snap }
}

/** Puts snapshot n back: files written over what is there, nothing newer deleted; Claude is told. */
async function restore($: EngineInterface, n: number): Promise<string> {
  const found = await findSnapshot($, n)
  if (found === null) return `mulligan: there is no snapshot ${n} for this project.`
  const { where, snap } = found
  const problems: string[] = []
  if (snap.sha !== undefined && SHA.test(snap.sha)) {
    const r = await run($, ['git', 'restore', '--overlay', `--source=${snap.sha}`, '--worktree', '--', '.'], where.root).catch(() => undefined)
    if (r?.exitCode !== 0) problems.push(`tracked files (${oneLine(r?.stderr ?? 'git did not answer', 80)})`)
  }
  if (snap.archive !== undefined) {
    if ((await sizeOf($, where.base, snap.archive)) === 0) problems.push('its files (the archive is gone)')
    else {
      const r = await run($, ['tar', '-xf', `${where.base}/${snap.archive}`], where.root, undefined, 60_000).catch(() => undefined)
      if (r?.exitCode !== 0) problems.push(`files (${oneLine(r?.stderr ?? 'tar did not finish', 80)})`)
    }
  }
  try {
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: restoreNote(snap.command, n) }] } })
  } catch (error) {
    debug($, error)
  }
  return problems.length === 0 ? `mulligan: restored #${n} (${snap.scope}). Claude was told to re-read files.` : `mulligan: #${n} restored in part; not put back: ${problems.join('; ')}.`
}

/** What differs now from snapshot n: tracked files through git, copied files one by one. */
async function diffLines($: EngineInterface, n: number): Promise<string[]> {
  const found = await findSnapshot($, n)
  if (found === null) return [`There is no snapshot ${n} for this project.`]
  const { where, snap } = found
  const lines: string[] = []
  if (snap.sha !== undefined && SHA.test(snap.sha)) {
    const r = await run($, ['git', 'diff', '--name-status', snap.sha, '--', '.'], where.root).catch(() => undefined)
    const words: Record<string, string> = { M: 'changed', D: 'deleted', A: 'new since', T: 'changed' }
    for (const line of (r?.exitCode === 0 ? r.stdout : '').split('\n').filter(Boolean).slice(0, 100)) {
      const [status = '', path = ''] = line.split('\t')
      lines.push(`${words[status[0] ?? ''] ?? 'differs'}: ${path}`)
    }
  }
  if (snap.archive !== undefined && (await sizeOf($, where.base, snap.archive)) > 0) {
    const file = `${where.base}/${snap.archive}`
    const listed = await run($, ['tar', '-tf', file], where.root).catch(() => undefined)
    const entries = (listed?.exitCode === 0 ? listed.stdout : '').split('\n').filter(name => name !== '' && !name.endsWith('/'))
    for (const entry of entries.slice(0, DIFF_FILES)) {
      const path = `${where.root}/${entry.replace(/^\.\//, '')}`
      if (!(await $.fs.exists(path).catch(() => false))) {
        lines.push(`deleted: ${entry.replace(/^\.\//, '')}`)
        continue
      }
      const then = await run($, ['tar', '-xOf', file, '--', entry], where.root).catch(() => undefined)
      const now = await $.fs.read(path).catch(() => undefined)
      if (then?.exitCode === 0 && now !== undefined && then.stdout !== now) lines.push(`changed: ${entry.replace(/^\.\//, '')}`)
    }
    if (entries.length > DIFF_FILES) lines.push(`and ${entries.length - DIFF_FILES} more files not compared`)
  }
  return lines.length > 0 ? lines : ['Nothing differs: the files it holds are as they were.']
}

async function openPane($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.open({ id: PANE, title: 'mulligan', focus: true, closeOnEscape: true })).isPlaced
  } catch {
    return false
  }
}

/** The list as the project's folder has it (another session in this project may have added one). */
async function syncList($: EngineInterface): Promise<void> {
  const where = await whereNow($)
  if (where === null) return
  const list = (await readIndex($, where.base)).snapshots
  await update($, snapshots, () => list)
}

/** /mulligan: answers in the pane and toasts, never text Claude reads. */
async function command($: EngineInterface, args: string, origin: string): Promise<void> {
  const [verb = '', arg = ''] = args.trim().split(/\s+/)
  const action = verb.toLowerCase()
  const n = Number(arg)
  // Off, a restore is the one word that still runs.
  if (!isOn && action !== 'restore') return $.ui.toast(OFF_TEXT)
  await syncList($)
  if (action === '' || action === 'list') {
    await update($, view, () => ({ kind: 'list' as const, confirm: 0 }))
    if (!(await openPane($))) $.ui.toast(`mulligan: ${(await read($, snapshots)).length} do-overs for this project; the list draws in a pane, which only the terminal and the desktop app have.`)
    return
  }
  if (!Number.isInteger(n) || n < 1 || !(await read($, snapshots)).some(s => s.n === n)) {
    return $.ui.toast(`mulligan: there is no snapshot ${oneLine(clean(arg), 12) || '(none given)'} for this project.${isOn ? ' /mulligan lists them.' : ''}`)
  }
  if (action === 'restore') {
    await update($, view, () => ({ kind: 'list' as const, confirm: n }))
    if (!(await openPane($))) $.ui.toast('mulligan: a restore waits on a confirm in a pane, which only the terminal and the desktop app have.')
    return
  }
  if (action === 'diff') {
    const lines = await diffLines($, n)
    await update($, view, () => ({ kind: 'diff' as const, n, lines }))
    if (!(await openPane($))) $.ui.toast(`mulligan: #${n} differs in ${lines.length} place${lines.length === 1 ? '' : 's'}; the list draws in a pane.`)
    return
  }
  if (action === 'drop') {
    if (!PERSON.has(origin)) return $.ui.toast('mulligan: /mulligan drop runs only when you type it yourself.')
    const where = await whereNow($)
    if (where === null) return
    await queued(async () => {
      const index = await readIndex($, where.base)
      const gone = index.snapshots.find(s => s.n === n)
      if (gone?.archive !== undefined) await emptyArchive($, where.base, gone.archive)
      const kept = index.snapshots.filter(s => s.n !== n)
      await $.fs.write(`${where.base}/index.json`, JSON.stringify({ v: 1, next: index.next, snapshots: kept } satisfies Index))
      await update($, snapshots, () => kept)
    })
    return $.ui.toast(`mulligan: dropped #${n}.`)
  }
  $.ui.toast(`mulligan: unknown command "${oneLine(clean(verb), 24)}". /mulligan lists; restore <n>, diff <n>, drop <n>.`)
}

export const register: Register = (on, options) => {
  settings = readSettings(options)
  isOn = options.enabled !== false

  // Never touches a snapshot: the switch only stops new ones and the band.
  on('config.set', { key: 'mulligan.enabled' }, async ($, e, next) => {
    const set = await next(e)
    if (set.deny === undefined && typeof set.value === 'boolean') {
      isOn = set.value
      $.ui.invalidate('ui.render')
    }
    return set
  })

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'mulligan',
        description: 'List the do-overs saved before destructive commands, and put one back',
        argumentHint: '[restore <n> | diff <n> | drop <n>]',
        immediate: true,
      })
    } catch (error) {
      debug($, error)
    }
    return next(e)
  })

  // Saved before the tool runs; kept once it ran. The tool runs exactly once whatever happens here.
  // Off, no snapshot: the call passes as it came. One taken before a switch mid-command is still
  // kept (its files are already saved), without a band.
  on('tool.call', async ($, e, next) => {
    if (!isOn || e.tool !== 'Bash') return next(e)
    let prepared: Prepared = {}
    try {
      prepared = await prepare($, e.command)
    } catch (error) {
      debug($, error)
    }
    const ran = await next(e)
    try {
      const { pending, skip } = prepared
      if (ran.deny !== undefined) {
        // Held or refused beneath: the command never ran, so there is nothing to undo.
        if (pending?.archive !== undefined) await emptyArchive($, pending.where.base, pending.archive)
      } else if (pending !== undefined) {
        const snap = await queued(() => commit($, pending))
        const cmd = oneLine(clean(e.command), 40)
        const extra = [...pending.plan.notes, ...pending.plan.outside.map(path => `${clean(path)} is outside the project, not saved`)]
        await showBand($, `mulligan: saved a do-over before "${cmd}" (${snap.scope}) · /mulligan restore ${snap.n}${extra.length ? ` · ${extra.join('; ')}` : ''}`, extra.length ? 'warning' : 'subtle')
      } else if (skip !== undefined) {
        await showBand($, skip.text, skip.tone)
      }
    } catch (error) {
      debug($, error)
    }
    return ran
  })

  // One line under the other bands, for a few seconds after a snapshot or a skip.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isOn) return next(e)
    const below = await next(e)
    const b = await read($, band)
    if (b === null || (await $.clock.now()) >= b.until || (e.surface !== 'terminal' && e.surface !== 'desktop')) return below
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        <Text key="mulligan" dimColor={b.tone === 'subtle'} color={b.tone === 'warning' ? 'warning' : undefined}>
          {b.text}
        </Text>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, snapshots)
    const v = await read($, view)
    const now = await $.clock.now()
    // A restore waits on this press, on or off.
    const confirm = (s: MulliganSnapshot) => (
      <Box key="confirm" flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
        <Text key="ask">{`Put back ${clean(s.scope)} as it was before #${s.n}? Files it holds are written over what is there now; nothing newer is deleted.`}</Text>
        <Box key="choices" flexDirection="row" gap={2}>
          <Button
            key="yes"
            label="Yes, restore"
            onPress={async () => {
              const said = await restore($, s.n)
              await update($, view, () => ({ kind: 'list' as const, confirm: 0 }))
              $.ui.toast(said)
            }}
          />
          <Button key="cancel" label="Cancel" autoFocus onPress={() => void update($, view, () => ({ kind: 'list' as const, confirm: 0 }))} />
        </Box>
      </Box>
    )
    if (!isOn) {
      const asked = v.kind === 'list' ? list.find(s => s.n === v.confirm) : undefined
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text key="off" dimColor>
            {OFF_TEXT}
          </Text>
          {asked === undefined ? null : confirm(asked)}
        </Box>
      )
    }
    if (v.kind === 'diff') {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text key="title" bold>{`#${v.n} against the files now`}</Text>
          {v.lines.map((line, i) => (
            <Text key={`diff-${i}`}>{clean(line)}</Text>
          ))}
          <Button key="back" label="Back to the list" onPress={() => void update($, view, () => ({ kind: 'list' as const, confirm: 0 }))} />
        </Box>
      )
    }
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text key="title" bold>
          {list.length === 0 ? 'No do-overs yet for this project' : `${list.length} do-over${list.length === 1 ? '' : 's'} for this project`}
        </Text>
        {[...list].reverse().map(s => (
          <Box key={`snap-${s.n}`} flexDirection="column">
            <Box key="line" flexDirection="row" gap={1}>
              <Box key="n" width={4} flexShrink={0}>
                <Text dimColor>{`#${s.n}`}</Text>
              </Box>
              <Box key="command" flexGrow={1} flexShrink={1} minWidth={8}>
                <Text wrap="truncate-end">{clean(s.command)}</Text>
              </Box>
              <Box key="buttons" flexShrink={0} flexDirection="row" gap={1}>
                <Button key="restore" label="Restore" onPress={() => void update($, view, () => ({ kind: 'list' as const, confirm: s.n }))} />
                <Button
                  key="diff"
                  label="Diff"
                  onPress={async () => {
                    const lines = await diffLines($, s.n)
                    await update($, view, () => ({ kind: 'diff' as const, n: s.n, lines }))
                  }}
                />
              </Box>
            </Box>
            <Text key="about" dimColor>{`    ${clean(s.scope)}${s.bytes > 0 ? ` · ${sizeWords(s.bytes)}` : ''} · ${agoWords(now - s.at)}`}</Text>
            {v.confirm === s.n ? confirm(s) : null}
          </Box>
        ))}
        <Text key="note" dimColor>
          Files in this project only: a database, a remote or anything outside the folder is not covered.
        </Text>
      </Box>
    )
  })

  on('command.run', { command: 'mulligan' }, async ($, e) => {
    try {
      await command($, e.args, e.origin.kind)
    } catch (error) {
      debug($, error)
      $.ui.toast('mulligan: that command failed, and nothing changed.')
    }
    return {}
  })
}
