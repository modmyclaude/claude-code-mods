// Pure logic for footprints: paths, git output, mark transitions, counts and
// the tree's rows. Nothing here touches `$`, so every rule is unit-tested.
import type { FootprintsMark as Mark } from '../types'

/** Rows the pane draws at most; the rest is one "more" line. */
export const MAX_ROWS = 400
/** An untouched folder with more files than this starts collapsed. */
export const BIG_FOLDER = 40
/** File systems with 1 s timestamps can stamp a change up to 1 s early. */
export const MTIME_SLACK_MS = 1000
/** Files kept from a scan; the rest is counted, not stored. */
export const MAX_FILES = 20000
/** Folders a walk outside git lists before it stops. */
export const MAX_WALK_DIRS = 400
/** Over this many folders a project opens in touched-only view, the full tree one press away. */
export const BIG_TREE_FOLDERS = 50
/** Dirty paths a Bash call stats at most. */
export const MAX_STATS = 400
/** Skipped by the walk outside git, where there is no .gitignore to ask. */
export const SKIP_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git', '.hg', '.svn', '__pycache__', '.venv', '.next', '.cache'])

// ---------------------------------------------------------------- paths

/** An absolute, '/'-separated path with no '.', '..' or trailing slash. */
export function normalize(path: string, cwd: string): string {
  const joined = path.startsWith('/') ? path : `${cwd}/${path}`
  const parts: string[] = []
  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

/** `abs` relative to the first root it lies under ('' for a root itself). */
export function relativeTo(abs: string, roots: readonly string[]): string | undefined {
  for (const root of roots) {
    if (abs === root) return ''
    const base = root.endsWith('/') ? root : `${root}/`
    if (abs.startsWith(base)) return abs.slice(base.length)
  }
  return undefined
}

// ---------------------------------------------------------------- drawing

/**
 * Text safe to draw. A file name may legally hold control characters, and the
 * engine refuses a whole tree that carries one, so ANSI sequences are dropped
 * and every other C0, DEL or C1 character is shown as U+FFFD.
 */
export function clean(text: string): string {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '') // CSI: colors, cursor moves
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC: titles, links
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '\uFFFD')
}

// ---------------------------------------------------------------- git output

/** The project root inside a git work tree: git's top and the root's prefix under it. */
export type Repo = { root: string; top: string; prefix: string }

/** A path git printed (relative to its top) as an absolute path, in the root's spelling when under it. */
export function toAbs(repo: Repo, path: string): string {
  return path.startsWith(repo.prefix) ? `${repo.root}/${path.slice(repo.prefix.length)}` : `${repo.top}/${path}`
}

/** What `git status --porcelain=v2 -z --branch` says, paths relative to the top. */
export type Porcelain = {
  /** The commit HEAD names; null before the first commit. */
  head: string | null
  /** Each dirty path's two-letter XY code, `??` for an untracked file. */
  dirty: Record<string, string>
}

export function parsePorcelain(stdout: string): Porcelain {
  let head: string | null = null
  const dirty: Record<string, string> = {}
  const entries = stdout.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? ''
    const kind = entry.slice(0, 2)
    if (entry.startsWith('# branch.oid ')) {
      const oid = entry.slice('# branch.oid '.length)
      head = oid === '(initial)' ? null : oid
    } else if (kind === '1 ' || kind === 'u ' || kind === '2 ') {
      // ordinary, unmerged and renamed entries carry 8, 10 and 9 fields before the path
      const path = afterFields(entry, kind === '1 ' ? 8 : kind === 'u ' ? 10 : 9)
      if (path !== undefined) dirty[path] = entry.slice(2, 4)
      if (kind === '2 ') i++ // a rename's original path follows as its own entry
    } else if (kind === '? ') {
      dirty[entry.slice(2)] = '??'
    }
  }
  return { head, dirty }
}

/** What follows the first `n` space-separated fields (a path may hold spaces). */
function afterFields(entry: string, n: number): string | undefined {
  let at = 0
  for (let i = 0; i < n; i++) {
    at = entry.indexOf(' ', at) + 1
    if (at === 0) return undefined
  }
  return entry.slice(at)
}

/** The NUL-separated paths `git ls-files -z` prints, each once. */
export function parseNulList(stdout: string): string[] {
  return [...new Set(stdout.split('\0').filter(path => path !== ''))]
}

/** True when a simple command of the line runs `git ... commit`. */
export function looksLikeCommit(command: string): boolean {
  return command.split(/[;&|\n()]+/).some(part => {
    const words = part.trim().split(/\s+/)
    const git = words.findIndex(word => word === 'git' || word.endsWith('/git'))
    return git >= 0 && words.slice(git + 1).includes('commit')
  })
}

// ---------------------------------------------------------------- shell changes

export type ShellChange = 'edited' | 'new' | 'deleted'
export type Stat = { exists: false } | { exists: true; mtimeMs: number }

/**
 * Which paths a Bash command changed, from git's dirty lists before and after
 * it and each path's stat after it. Paths are relative to the git top.
 *
 * A file that still exists counts only when its mtime falls inside the
 * command's run: staging, committing or a soft reset moves a path between
 * git's lists without touching the file, and that is not a change.
 */
export function shellChanges(
  before: Record<string, string>,
  after: Record<string, string>,
  stats: Record<string, Stat>,
  startedAt: number,
): Record<string, ShellChange> {
  const changes: Record<string, ShellChange> = {}
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const stat = stats[path]
    if (stat === undefined) continue // not looked at (past the stat cap)
    const was = before[path]
    const is = after[path]
    if (!stat.exists) {
      // gone now: news only if it was still there when the command started
      if (was === undefined || !was.includes('D')) changes[path] = 'deleted'
      continue
    }
    const appeared = was === undefined && is !== undefined && (is === '??' || is[0] === 'A')
    if (stat.mtimeMs >= startedAt - MTIME_SLACK_MS) changes[path] = appeared ? 'new' : 'edited'
    else if (appeared) changes[path] = 'new' // a move (git mv) keeps the old mtime
  }
  return changes
}

/**
 * The paths to stat after a Bash call: first those whose git status moved
 * (appeared, cleared or changed code), then the ones dirty and unchanged, so a
 * tree with hundreds of dirty files never pushes the command's own work past
 * the stat cap.
 */
export function statOrder(before: Record<string, string>, after: Record<string, string>): string[] {
  const all = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  return [...all.filter(path => before[path] !== after[path]), ...all.filter(path => before[path] === after[path])]
}

// ---------------------------------------------------------------- marks

/** True for a mark that says anything at all. */
export function isTouched(mark: Mark | undefined): boolean {
  return mark !== undefined && Object.keys(mark).some(key => key !== 'isDir')
}

/** Undefined for an empty mark, so the store keeps no "untouched" entries. */
export function orNothing(mark: Mark): Mark | undefined {
  return isTouched(mark) ? mark : undefined
}

export function markRead(mark: Mark | undefined, isDir: boolean): Mark {
  return isDir ? { ...mark, read: true, isDir: true } : { ...mark, read: true }
}

export function startEdit(mark: Mark | undefined, id: string): Mark {
  return { ...mark, editing: [...(mark?.editing ?? []).filter(other => other !== id), id] }
}

/** An edit call ended: `failed` (denied, errored, held for review), or it wrote. */
export function endEdit(mark: Mark | undefined, id: string, outcome: 'failed' | 'edited' | 'created'): Mark {
  const next: Mark = { ...mark }
  const still = (next.editing ?? []).filter(other => other !== id)
  if (still.length > 0) next.editing = still
  else delete next.editing
  if (outcome !== 'failed') {
    next.edited = true
    delete next.committed
    delete next.deleted
    delete next.viaShell // an edit tool touched it, so it is no longer shell-only
    if (outcome === 'created') next.isNew = true
  }
  return next
}

/** A shell change on a mark; a file created this session and then deleted leaves no trace (read aside). */
export function applyShell(mark: Mark | undefined, change: ShellChange): Mark {
  if (change === 'deleted' && mark?.isNew) return mark.read ? { read: true } : {}
  const next: Mark = { ...mark }
  const isShellOnly = next.edited !== true || next.viaShell === true
  next.edited = true
  delete next.committed
  if (change === 'deleted') next.deleted = true
  else delete next.deleted
  if (change === 'new') next.isNew = true
  if (isShellOnly) next.viaShell = true
  return next
}

/** Drops every in-flight edit (a reload cannot finish the old module's calls). */
export function settleEdits(marks: Record<string, Mark>): Record<string, Mark> {
  const next: Record<string, Mark> = {}
  for (const [path, mark] of Object.entries(marks)) {
    const { editing: _dropped, ...rest } = mark
    const kept = orNothing(rest)
    if (kept) next[path] = kept
  }
  return next
}

export function isEditing(mark: Mark | undefined): boolean {
  return (mark?.editing?.length ?? 0) > 0
}

// ---------------------------------------------------------------- counts

export type Counts = { read: number; edited: number; isNew: number; deleted: number; committed: number }

/** Files only (a searched folder is not a file read); new, deleted and committed are kinds of edited. */
export function countMarks(marks: Record<string, Mark>): Counts {
  const counts: Counts = { read: 0, edited: 0, isNew: 0, deleted: 0, committed: 0 }
  for (const mark of Object.values(marks)) {
    if (mark.isDir) continue
    if (mark.read) counts.read++
    if (mark.edited) counts.edited++
    if (mark.edited && mark.isNew) counts.isNew++
    if (mark.edited && mark.deleted) counts.deleted++
    if (mark.edited && mark.committed) counts.committed++
  }
  return counts
}

export type HeaderPart = { kind: 'read' | 'edited' | 'new' | 'deleted' | 'committed'; text: string }

/** "read 12 · edited 4 · new 1", then deleted and committed when there are any. */
export function headerParts(counts: Counts): HeaderPart[] {
  const parts: HeaderPart[] = [
    { kind: 'read', text: `read ${counts.read}` },
    { kind: 'edited', text: `edited ${counts.edited}` },
    { kind: 'new', text: `new ${counts.isNew}` },
  ]
  if (counts.deleted > 0) parts.push({ kind: 'deleted', text: `deleted ${counts.deleted}` })
  if (counts.committed > 0) parts.push({ kind: 'committed', text: `committed ${counts.committed}` })
  return parts
}

export const HEADER_SEPARATOR = ' · '

export function headerText(counts: Counts): string {
  return headerParts(counts).map(part => part.text).join(HEADER_SEPARATOR)
}

/** The status line: the edited count, or nothing before the first edit. */
export function statusText(counts: Counts): string | undefined {
  return counts.edited > 0 ? `edited ${counts.edited}` : undefined
}

// ---------------------------------------------------------------- tree rows

/** How many folders a file list spans: every ancestor of every file, the root itself not counted. */
export function folderCount(files: readonly string[]): number {
  const dirs = new Set<string>()
  for (const path of files) {
    const parts = path.split('/').filter(part => part !== '')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  return dirs.size
}

export type Row =
  | { kind: 'dir'; depth: number; name: string; path: string; isOpen: boolean; files: number; isTouched: boolean; mark?: Mark }
  | { kind: 'file'; depth: number; name: string; path: string; mark?: Mark }
  | { kind: 'hidden'; depth: number; count: number }
  | { kind: 'cut'; count: number }

export type Layout = { touchedOnly: boolean; maxRows: number; bigFolder: number }

type Dir = { dirs: Map<string, Dir>; files: Set<string>; size: number; isTouched: boolean }

const newDir = (): Dir => ({ dirs: new Map(), files: new Set(), size: 0, isTouched: false })

function dirAt(root: Dir, parts: readonly string[]): Dir {
  let dir = root
  for (const part of parts) {
    let child = dir.dirs.get(part)
    if (!child) {
      child = newDir()
      dir.dirs.set(part, child)
    }
    dir = child
  }
  return dir
}

const byName = (a: string, b: string): number => {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0
}

/**
 * The rows of the tree: folders first, then files, each sorted by name.
 *
 * `marks` is keyed by path relative to the root. A touched folder (it holds a
 * touched file, or was searched) is always open. Otherwise a folder is open
 * when it is small, and in touched-only mode never; touched-only mode also
 * folds each folder's untouched files into one "hidden" row.
 */
export function buildRows(files: readonly string[], marks: Readonly<Record<string, Mark>>, layout: Layout): Row[] {
  const root = newDir()
  const addFile = (path: string): void => {
    const parts = path.split('/').filter(part => part !== '')
    const name = parts.pop()
    if (name !== undefined) dirAt(root, parts).files.add(name)
  }
  for (const path of files) addFile(path)
  for (const [path, mark] of Object.entries(marks)) {
    if (path === '') continue
    if (mark.isDir) dirAt(root, path.split('/').filter(part => part !== ''))
    else addFile(path) // a touched file shows even where the scan did not list it
  }

  const tally = (dir: Dir, prefix: string): void => {
    dir.size = dir.files.size
    dir.isTouched = isTouched(marks[prefix.slice(0, -1)])
    for (const name of dir.files) if (isTouched(marks[prefix + name])) dir.isTouched = true
    for (const [name, child] of dir.dirs) {
      tally(child, `${prefix}${name}/`)
      dir.size += child.size
      if (child.isTouched) dir.isTouched = true
    }
  }
  tally(root, '')

  const rows: Row[] = []
  let cut = 0
  const push = (row: Row): void => {
    if (rows.length < layout.maxRows) rows.push(row)
    else cut++
  }
  const walk = (dir: Dir, prefix: string, depth: number): void => {
    for (const name of [...dir.dirs.keys()].sort(byName)) {
      const child = dir.dirs.get(name) as Dir
      const path = prefix + name
      const isOpen = child.isTouched || (!layout.touchedOnly && child.size <= layout.bigFolder)
      const mark = marks[path]
      push({ kind: 'dir', depth, name, path, isOpen, files: child.size, isTouched: child.isTouched, ...(mark ? { mark } : {}) })
      if (isOpen) walk(child, `${path}/`, depth + 1)
    }
    let hidden = 0
    for (const name of [...dir.files].sort(byName)) {
      const path = prefix + name
      const mark = marks[path]
      if (layout.touchedOnly && !isTouched(mark)) {
        hidden++
        continue
      }
      push({ kind: 'file', depth, name, path, ...(mark ? { mark } : {}) })
    }
    if (hidden > 0) push({ kind: 'hidden', depth, count: hidden })
  }
  walk(root, '', 0)
  if (cut > 0) rows.push({ kind: 'cut', count: cut })
  return rows
}

// ---------------------------------------------------------------- shimmer

/** The name split around a bright band that slides one cell per frame. */
export function shimmerParts(name: string, phase: number, band = 3): [string, string, string] {
  const span = name.length + band
  const start = Math.max(0, (phase % span) - band)
  const end = Math.min(name.length, (phase % span))
  return [name.slice(0, start), name.slice(start, end), name.slice(end)]
}
