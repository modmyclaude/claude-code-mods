// footprints: a live file tree beside the chat that shows where Claude has been.
//
// Hooks watch what Claude reads (Read, Glob, Grep, @-mentions), edits (Edit,
// Write, MultiEdit, NotebookEdit) and changes from the shell (Bash, checked
// with `git status` before and after). The marks live in $.state; a Pane
// draws them over the project's file list, and the status line counts edits.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, ToolCallResult } from 'claude-code'

import type { FootprintsMark as Mark, FootprintsTree as Tree } from '../types'
import {
  BIG_FOLDER,
  HEADER_SEPARATOR,
  MAX_FILES,
  MAX_ROWS,
  MAX_STATS,
  MAX_WALK_DIRS,
  SKIP_DIRS,
  applyShell,
  buildRows,
  countMarks,
  endEdit,
  headerParts,
  isEditing,
  isTouched,
  looksLikeCommit,
  markRead,
  normalize,
  orNothing,
  parseNulList,
  parsePorcelain,
  relativeTo,
  settleEdits,
  shellChanges,
  shimmerParts,
  startEdit,
  statusText,
  toAbs,
  type Counts,
  type HeaderPart,
  type Porcelain,
  type Repo,
  type Row,
  type Stat,
} from './model'

type Engine = EngineInterface

const PANE = 'footprints'
const SHIMMER_MS = 120
/** A git snapshot slower than this pauses shell tracking for the session. */
const SLOW_GIT_MS = 2000
const SLOW_GIT_LINE = 'Footprints: shell tracking paused, git status is slow in this repo'
const MAX_OUTSIDE = 50

const MARKS = { plugin: 'footprints', key: 'marks' } as const
const TREE = { plugin: 'footprints', key: 'tree' } as const
const marksAtom = atom(MARKS, {})
const touchedOnlyAtom = atom({ plugin: 'footprints', key: 'touchedOnly' } as const, false)
const phaseAtom = atom({ plugin: 'footprints', key: 'phase' } as const, 0)
const SHELL_PAUSED = { plugin: 'footprints', key: 'shellPaused' } as const
const shellPausedAtom = atom(SHELL_PAUSED, false)

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// Module state a reload may lose without harm: the shimmer's timer, the last
// status text sent, each root's real path, and the drawn rows by state version.
let shimmer: Timer | undefined
let lastStatus: string | undefined | null = null
const realRoots = new Map<string, string>()
const repos = new Map<string, Repo | null>() // per root; null = not a git work tree
let cache: { key: string; view: View } | undefined

// Bookkeeping never gets in the way of a tool call: a failure here is dropped.
const quietly = <T,>(work: Promise<T>): Promise<T | undefined> => work.catch(() => undefined)

const succeeded = (ran: ToolCallResult): boolean => ran.deny === undefined && ran.isError !== true

/** One field of a tool's record, when it is there (records differ per tool and build). */
const field = (value: unknown, name: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[name] : undefined

// ---------------------------------------------------------------- where we are

/** The session's project root, and its real path when a link leads there (macOS /tmp). */
async function rootsOf($: Engine): Promise<{ root: string; realRoot: string }> {
  const root = normalize(await $.session.root(), '/')
  let realRoot = realRoots.get(root)
  if (realRoot === undefined) {
    realRoot = (await $.fs.stat(root, { resolve: true }).catch(() => undefined))?.realPath ?? root
    realRoots.set(root, realRoot)
  }
  return { root, realRoot }
}

/** An absolute path in the root's own spelling, so one file has one mark. */
async function canonical($: Engine, path: string): Promise<string> {
  const abs = normalize(path, path.startsWith('/') ? '/' : await $.session.cwd())
  const { root, realRoot } = await rootsOf($)
  if (realRoot === root || relativeTo(abs, [root]) !== undefined) return abs
  const rel = relativeTo(abs, [realRoot])
  return rel === undefined ? abs : rel === '' ? root : `${root}/${rel}`
}

// ---------------------------------------------------------------- marks and status

function refreshStatus($: Engine, marks: Record<string, Mark>): void {
  const text = statusText(countMarks(marks))
  if (text === lastStatus) return
  lastStatus = text
  $.ui.status(text)
}

async function changeMark($: Engine, path: string, change: (mark: Mark | undefined) => Mark): Promise<void> {
  const marks = await update($, marksAtom, current => {
    const next = { ...current }
    const mark = orNothing(change(next[path]))
    if (mark) next[path] = mark
    else delete next[path]
    return next
  })
  refreshStatus($, marks)
}

async function recordRead($: Engine, tool: string, target: string): Promise<void> {
  const path = await canonical($, target)
  if (path === (await rootsOf($)).root) return // searching the whole project marks nothing
  // Glob and Grep take a folder or a file; only the kind is looked up, never the contents.
  const isDir = tool !== 'Read' && (await $.fs.stat(path).catch(() => undefined))?.kind === 'dir'
  await changeMark($, path, mark => markRead(mark, isDir))
}

// ---------------------------------------------------------------- shimmer

function startShimmer($: Engine): void {
  try {
    shimmer ??= $.clock.every(SHIMMER_MS, () => void quietly(tick($)))
  } catch {
    // no animation is better than a stuck edit mark
  }
}

function stopShimmer(): void {
  shimmer?.cancel()
  shimmer = undefined
}

/** One frame: the only place the timer stops, so a call that never reported back cannot leave it running. */
async function tick($: Engine): Promise<void> {
  if (!Object.values(await read($, marksAtom)).some(isEditing)) return stopShimmer()
  // Frames matter only to a pane on screen: no state writes while it is closed or behind a tab.
  const isShown = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)
  if (isShown) await update($, phaseAtom, phase => (phase + 1) % 10000)
}

// ---------------------------------------------------------------- git and the disk
// The only places footprints looks at the disk: read-only git commands, folder
// listings and stats. Names and timestamps only; no file's contents are read.

async function repoOf($: Engine, root: string): Promise<Repo | null> {
  const known = repos.get(root)
  if (known !== undefined) return known
  const out = await $.process
    .run(['git', '-C', root, 'rev-parse', '--show-toplevel', '--show-prefix'], { timeoutMs: 5000 })
    .catch(() => undefined)
  const [top, prefix = ''] = out?.exitCode === 0 ? out.stdout.split('\n') : []
  const repo = top ? { root, top, prefix } : null
  repos.set(root, repo)
  return repo
}

/** Read-only, and without the index lock, so it never races the model's own git. */
async function gitStatus($: Engine, repo: Repo): Promise<Porcelain | null> {
  const out = await $.process.run(
    ['git', '--no-optional-locks', '-C', repo.root, 'status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--no-renames'],
    { timeoutMs: SLOW_GIT_MS + 1000 },
  )
  return out.exitCode === 0 && !out.isStdoutTruncated ? parsePorcelain(out.stdout) : null
}

/**
 * A snapshot on the clock. One that takes over SLOW_GIT_MS, or times out, pauses
 * shell tracking for the rest of the session, so a big repo never taxes every
 * Bash call; reads and edits are still tracked.
 */
async function timedStatus($: Engine, repo: Repo): Promise<Porcelain | null> {
  const startedAt = await $.clock.now()
  const status = await gitStatus($, repo).catch(() => null)
  if ((await $.clock.now()) - startedAt > SLOW_GIT_MS) await pauseShell($)
  return status
}

/** Pauses once, and says so once, however many calls find git slow at the same time. */
async function pauseShell($: Engine): Promise<void> {
  const held = await $.state.get(SHELL_PAUSED)
  if (held.value === true) return
  const { isSet } = await $.state.set(SHELL_PAUSED, true, { ifVersion: held.version })
  if (isSet) $.ui.log(SLOW_GIT_LINE)
}

/** mtime or absence of each path (relative to git's top), at most MAX_STATS of them. */
async function statAll($: Engine, repo: Repo, paths: readonly string[]): Promise<Record<string, Stat>> {
  const stats: Record<string, Stat> = {}
  await Promise.all(
    paths.slice(0, MAX_STATS).map(async path => {
      const abs = `${repo.top}/${path}`
      try {
        stats[path] = { exists: true, mtimeMs: (await $.fs.stat(abs)).mtimeMs }
      } catch {
        // a stat can fail for reasons other than absence; only a confirmed absence counts
        if (!(await $.fs.exists(abs).catch(() => true))) stats[path] = { exists: false }
      }
    }),
  )
  return stats
}

/** The project's files: git's list (tracked + untracked, .gitignore honoured), else a capped walk. */
async function scanTree($: Engine, root: string, repo: Repo | null): Promise<Tree> {
  if (repo) {
    const out = await $.process
      .run(['git', '-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { timeoutMs: 15000 })
      .catch(() => undefined)
    if (out?.exitCode === 0) {
      const files = parseNulList(out.stdout)
      const tree: Tree = { root, files: files.slice(0, MAX_FILES), source: 'git', total: files.length }
      if (out.isStdoutTruncated || files.length > MAX_FILES) {
        tree.note = `showing ${Math.min(files.length, MAX_FILES)} files of a longer list`
      }
      return tree
    }
  }
  return walkTree($, root)
}

/** Outside git: list folders breadth first, skipping SKIP_DIRS, up to MAX_WALK_DIRS of them. */
async function walkTree($: Engine, root: string): Promise<Tree> {
  const files: string[] = []
  const queue: string[] = ['']
  let total = 0
  let listed = 0
  while (queue.length > 0 && listed < MAX_WALK_DIRS) {
    const rel = queue.shift() as string
    listed++
    const entries = await $.fs.list(rel === '' ? root : `${root}/${rel}`).catch(() => [])
    for (const entry of entries) {
      const path = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.kind === 'dir') {
        if (!SKIP_DIRS.has(entry.name)) queue.push(path)
      } else {
        total++
        if (files.length < MAX_FILES) files.push(path)
      }
    }
  }
  const tree: Tree = { root, files, source: 'walk', total }
  if (queue.length > 0) tree.note = `listed the first ${MAX_WALK_DIRS} folders only`
  else if (total > MAX_FILES) tree.note = `showing ${MAX_FILES} of ${total} files`
  return tree
}

// ---------------------------------------------------------------- the tree

async function paneIsOpen($: Engine): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

async function rescan($: Engine): Promise<void> {
  repos.clear() // a `git init` since the last look counts
  const { root, realRoot } = await rootsOf($)
  const tree = await scanTree($, root, await repoOf($, root))
  if (realRoot !== root) tree.realRoot = realRoot
  await $.state.set(TREE, tree)
}

async function openPane($: Engine): Promise<boolean> {
  const opened = await $.ui.open({ id: PANE, title: 'Footprints' })
  if (!opened.isPlaced) $.ui.toast(`Footprints cannot show its pane here: ${opened.reason}`)
  await quietly(rescan($))
  return opened.isPlaced
}

// ---------------------------------------------------------------- the shell

type Watch = { repo: Repo; before: Porcelain; startedAt: number }

async function beforeShell($: Engine): Promise<Watch | undefined> {
  if (await read($, shellPausedAtom)) return undefined
  // Nothing to show yet (no pane, no edit): skip git; tracking starts with the first edit or the pane.
  const hasEdits = Object.values(await read($, marksAtom)).some(mark => mark.edited === true)
  if (!hasEdits && !(await paneIsOpen($))) return undefined
  const repo = await repoOf($, (await rootsOf($)).root)
  if (!repo) return undefined
  const before = await timedStatus($, repo)
  if (!before || (await read($, shellPausedAtom))) return undefined
  return { repo, before, startedAt: await $.clock.now() }
}

async function afterShell($: Engine, watch: Watch, command: string, ran: ToolCallResult): Promise<void> {
  const { repo, before, startedAt } = watch
  const after = await timedStatus($, repo)
  if (!after) return
  const paths = [...new Set([...Object.keys(before.dirty), ...Object.keys(after.dirty)])]
  const changes = Object.entries(shellChanges(before.dirty, after.dirty, await statAll($, repo, paths), startedAt))
  // A commit moved HEAD; a `git commit` that failed (nothing staged, a hook said no) did not.
  const isCommit =
    after.head !== null &&
    after.head !== before.head &&
    (looksLikeCommit(command) || field(field(ran.result, 'gitOperation'), 'commit') !== undefined)
  if (changes.length > 0 || isCommit) {
    const { root } = await rootsOf($)
    const topRelative = (abs: string): string | undefined => {
      const rel = relativeTo(abs, [root])
      return rel !== undefined ? repo.prefix + rel : relativeTo(abs, [repo.top])
    }
    const marks = await update($, marksAtom, current => {
      const next = { ...current }
      for (const [path, change] of changes) {
        const abs = toAbs(repo, path)
        next[abs] = applyShell(next[abs], change)
      }
      if (isCommit) {
        for (const [abs, mark] of Object.entries(next)) {
          const rel = topRelative(abs)
          const isClean = rel !== undefined && after.dirty[rel] === undefined
          if (mark.edited && isClean && !isEditing(mark)) next[abs] = { ...mark, committed: true }
        }
      }
      return next
    })
    refreshStatus($, marks)
  }
  // A commit or a checkout can change the file list; keep an open pane honest.
  if (after.head !== before.head && (await paneIsOpen($))) await rescan($)
}

// ---------------------------------------------------------------- the pane's model

type View = { counts: Counts; rows: Row[]; outside: [string, Mark][] }

/** Rows and counts for the pane, rebuilt only when the marks, the tree or the mode changed. */
function viewOf(tree: Tree | null, marks: Record<string, Mark>, touchedOnly: boolean, key: string): View {
  if (cache?.key === key) return cache.view
  const roots = tree ? [tree.root, ...(tree.realRoot ? [tree.realRoot] : [])] : []
  const inside: Record<string, Mark> = {}
  const outside: [string, Mark][] = []
  for (const [abs, mark] of Object.entries(marks)) {
    const rel = relativeTo(abs, roots)
    if (rel !== undefined) inside[rel] = mark
    else if (isTouched(mark)) outside.push([abs, mark])
  }
  outside.sort(([a], [b]) => (a < b ? -1 : 1))
  // Touched-only with nothing touched here yet says so, rather than listing collapsed folders.
  const isBlank = touchedOnly && !Object.values(inside).some(isTouched)
  const rows = tree && !isBlank ? buildRows(tree.files, inside, { touchedOnly, maxRows: MAX_ROWS, bigFolder: BIG_FOLDER }) : []
  const view = { counts: countMarks(marks), rows, outside }
  cache = { key, view }
  return view
}

const PART_COLOR: Record<HeaderPart['kind'], string> = {
  read: 'suggestion',
  edited: 'warning',
  new: 'text',
  deleted: 'inactive',
  committed: 'success',
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'footprints',
      description: 'Show where Claude has been: a live file tree beside the chat',
      argumentHint: '[touched]',
    })
    // An edit in flight when the module reloaded cannot report back here.
    const marks = await update($, marksAtom, settleEdits)
    refreshStatus($, marks)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      // A fresh conversation starts with a clean trail.
      stopShimmer()
      await $.state.set(MARKS, {})
      refreshStatus($, {})
    }
    return next(e)
  })

  on('command.run', { command: 'footprints' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'touched') {
      const isOn = await update($, touchedOnlyAtom, value => !value)
      if (!(await paneIsOpen($))) await openPane($)
      return { text: isOn ? 'Footprints: touched files only.' : 'Footprints: all files.' }
    }
    if (arg !== '') return { text: 'Usage: /footprints opens the pane; /footprints touched toggles touched-only.' }
    const isPlaced = await openPane($)
    return isPlaced ? { text: 'Footprints pane open. Press t in it, or /footprints touched, for touched files only.' } : {}
  })

  // An observer, never a guard: whatever happens in here, the call goes on.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool) // Glob, Grep and MultiEdit are not in every build's table
    const args = e as unknown as Record<string, unknown>

    if (READ_TOOLS.has(tool)) {
      const target = typeof args.file_path === 'string' ? args.file_path : args.path
      const ran = await next(e)
      if (typeof target === 'string' && succeeded(ran)) await quietly(recordRead($, tool, target))
      return ran
    }

    if (EDIT_TOOLS.has(tool)) {
      const target = tool === 'NotebookEdit' ? args.notebook_path : args.file_path
      const path = typeof target === 'string' ? await quietly(canonical($, target)) : undefined
      if (path === undefined) return next(e)
      const id = e.tool_use_id
      await quietly(changeMark($, path, mark => startEdit(mark, id)))
      startShimmer($)
      let outcome: 'failed' | 'edited' | 'created' = 'failed'
      try {
        const ran = await next(e)
        if (succeeded(ran) && field(ran.result, 'staged') !== true) {
          outcome = tool === 'Write' && field(ran.result, 'type') === 'create' ? 'created' : 'edited'
        }
        return ran
      } finally {
        // the shimmer stops itself on its next frame once no edit is running
        await quietly(changeMark($, path, mark => endEdit(mark, id, outcome)))
      }
    }

    if (tool === 'Bash') {
      const command = typeof args.command === 'string' ? args.command : ''
      const watch = await quietly(beforeShell($))
      const ran = await next(e)
      // A denied call ran nothing; one the tool held read-only changed nothing.
      if (watch && ran.deny === undefined && ran.isReadOnly !== true) {
        await quietly(afterShell($, watch, command, ran))
      }
      return ran
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // An @-mentioned file is read into the conversation without a Read call: it counts as read too.
  on('prompt.mention', async ($, e, next) => {
    const attached = await next(e)
    if (attached.deny === undefined && attached.type !== null) await quietly(recordRead($, 'Read', e.path))
    return attached
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [marksRead, treeRead, touchedOnly, phase] = await Promise.all([
      $.state.get(MARKS),
      $.state.get(TREE),
      read($, touchedOnlyAtom),
      read($, phaseAtom),
    ])
    const tree = treeRead.value ?? null
    const view = viewOf(tree, marksRead.value ?? {}, touchedOnly, `${marksRead.version}:${treeRead.version}:${touchedOnly}`)

    /** A name styled by what Claude did to it: blue read, amber edited (shimmering while it runs), green committed. */
    const name = (label: string, mark: Mark | undefined, isUntouched: boolean) => {
      if (isEditing(mark)) {
        const [head, band, tail] = shimmerParts(label, phase)
        return (
          <Text color="warning">
            <Text dimColor>{head}</Text>
            <Text bold>{band}</Text>
            <Text dimColor>{tail}</Text>
          </Text>
        )
      }
      if (mark?.deleted) return <Text strikethrough dimColor>{label}</Text>
      if (mark?.committed) return <Text color="success">{label}</Text>
      if (mark?.edited) return <Text color="warning">{label}</Text>
      if (mark?.read) return <Text color="suggestion">{label}</Text>
      return <Text dimColor={isUntouched}>{label}</Text>
    }

    const tags = (mark: Mark | undefined) => (
      <Text>
        {mark?.isNew ? <Text bold> new</Text> : ''}
        {mark?.viaShell ? <Text dimColor> (shell)</Text> : ''}
      </Text>
    )

    const drawRow = (row: Row) => {
      if (row.kind === 'cut') {
        return (
          <Box key="cut">
            <Text dimColor>{`... ${row.count} more rows not shown${touchedOnly ? '' : ' - press t for touched only'}`}</Text>
          </Box>
        )
      }
      const indent = '  '.repeat(row.depth)
      if (row.kind === 'hidden') {
        return (
          <Box>
            <Text dimColor wrap="truncate-end">{`${indent}  + ${row.count} untouched file${row.count === 1 ? '' : 's'}`}</Text>
          </Box>
        )
      }
      if (row.kind === 'dir') {
        return (
          <Box key={`d:${row.path}`}>
            <Text wrap="truncate-end" bold={row.isTouched} dimColor={!row.isTouched}>
              {`${indent}${row.isOpen ? '▾' : '▸'} `}
              {name(`${row.name}/`, row.mark, !row.isTouched)}
              {row.isOpen ? '' : <Text dimColor>{` ${row.files}`}</Text>}
            </Text>
          </Box>
        )
      }
      return (
        <Box key={`f:${row.path}`}>
          <Text wrap="truncate-end">
            {`${indent}  `}
            {name(row.name, row.mark, !isTouched(row.mark))}
            {tags(row.mark)}
          </Text>
        </Box>
      )
    }

    const rootName = tree ? (tree.root.split('/').filter(Boolean).pop() ?? tree.root) : ''

    return (
      <Box flexDirection="column">
        <Box key="header">
          <Text wrap="truncate-end">
            {headerParts(view.counts).map((part, at) => (
              <Text>
                {at > 0 ? <Text dimColor>{HEADER_SEPARATOR}</Text> : ''}
                <Text color={PART_COLOR[part.kind]}>{part.text}</Text>
              </Text>
            ))}
          </Text>
        </Box>
        <Box key="controls" flexDirection="row" gap={2}>
          <Button
            key="touched"
            hotkey="t"
            plain
            label={touchedOnly ? 'show all files' : 'touched only'}
            onPress={() => update($, touchedOnlyAtom, value => !value)}
          />
          {tree ? (
            <Text dimColor wrap="truncate-end">{`${rootName}${tree.source === 'walk' ? ' (not a git repo)' : ''}`}</Text>
          ) : (
            ''
          )}
        </Box>
        {tree?.note ? (
          <Box key="note">
            <Text dimColor wrap="truncate-end">{tree.note}</Text>
          </Box>
        ) : (
          ''
        )}
        {view.rows.length === 0 ? (
          <Box key="empty">
            <Text dimColor>{!tree ? 'Reading the file list...' : touchedOnly ? 'Nothing touched yet.' : 'No files here.'}</Text>
          </Box>
        ) : (
          ''
        )}
        {view.rows.map(drawRow)}
        {view.outside.length > 0 ? (
          <Box key="outside" flexDirection="column" marginTop={1}>
            <Text dimColor>{tree ? `outside ${rootName}` : 'touched so far'}</Text>
            {view.outside.slice(0, MAX_OUTSIDE).map(([abs, mark]) => (
              <Box key={`o:${abs}`}>
                <Text wrap="truncate-start">
                  {name(abs, mark, false)}
                  {tags(mark)}
                </Text>
              </Box>
            ))}
            {view.outside.length > MAX_OUTSIDE ? <Text dimColor>{`... ${view.outside.length - MAX_OUTSIDE} more`}</Text> : ''}
          </Box>
        ) : (
          ''
        )}
      </Box>
    )
  })
}
