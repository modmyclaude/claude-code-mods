// What a shell command changed, from git snapshots taken before and after it.
//
// Every git call here is read-only plumbing, run with --no-optional-locks:
// rev-parse, diff-index, ls-files, hash-object (without -w), show, cat-file,
// and diff --no-index for an untracked file. Porcelain `git diff <commit>`
// is avoided on purpose: it refreshes and rewrites .git/index (taking
// index.lock) whenever files are stat-dirty. Nothing is staged or written.

import type { PlayByPlayStep } from '../types'
import { applyHunks, isBinary, parseGitDiff, type FileDiff } from './diff'
import { bareStep, binaryNote, stepFromTexts } from './steps'

/** `$.process.run`'s shape, narrowed to what is read here (a test can fake it). */
export type Run = (
  argv: readonly string[],
  init?: { cwd?: string; stdin?: string },
) => Promise<{ exitCode: number; stdout: string; isStdoutTruncated: boolean }>

/** Git's empty tree: the base in a repository with no commit yet. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
/** Changed files looked at per command; past it one "more" step stands in. */
export const MAX_SHELL_FILES = 25
/** Above this many untracked files their contents are not hashed. */
const MAX_HASHED = 500

/** Output options shared by diff-index and diff --no-index, so both parse alike. */
const DIFF = [
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--no-relative',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '-M',
  '--ignore-submodules',
]

/** The working tree as git sees it, against a fixed base commit. */
export type Snapshot = {
  root: string
  /** The session folder's place in the repository (`src/`), '' at its root. */
  prefix: string
  /** HEAD when the command started, kept for the after-snapshot so a commit
   * made by the command does not hide what it changed. */
  base: string
  files: FileDiff[]
  /** Untracked, unignored paths and their blob hash (null: not hashed). */
  untracked: Map<string, string | null>
}

function git(run: Run, root: string, args: readonly string[], stdin?: string) {
  return run(['git', '--no-optional-locks', '-c', 'core.quotepath=off', ...args], {
    cwd: root,
    ...(stdin !== undefined ? { stdin } : {}),
  })
}

/** Why there is no snapshot: not in a repository, or more pending than can be read whole. */
export type NoSnapshot = 'not-a-repo' | 'too-large'

/**
 * Snapshots the repository the session runs in, in two or three git calls
 * (three or four the first time, to find the repository). `at` reuses a
 * first snapshot's root and base, so the two compare like for like.
 */
export async function snapshot(
  run: Run,
  at?: Pick<Snapshot, 'root' | 'prefix' | 'base'>,
): Promise<Snapshot | NoSnapshot> {
  let where = at
  if (where === undefined) {
    // One call: root, prefix and HEAD. With no commit yet git fails on HEAD
    // but still prints the first two; outside a repository it prints nothing.
    const top = await run(['git', '--no-optional-locks', 'rev-parse', '--show-toplevel', '--show-prefix', 'HEAD'])
    const [root = '', prefix = '', head = ''] = top.stdout.split('\n')
    if (root === '') return 'not-a-repo'
    where = { root, prefix, base: top.exitCode === 0 && /^[0-9a-f]{40,64}$/.test(head) ? head : EMPTY_TREE }
  }
  const diff = await git(run, where.root, ['diff-index', '-p', ...DIFF, where.base, '--'])
  if (diff.isStdoutTruncated) return 'too-large'
  if (diff.exitCode !== 0) return 'not-a-repo'
  const listed = await git(run, where.root, ['ls-files', '--others', '--exclude-standard', '-z'])
  if (listed.isStdoutTruncated) return 'too-large'
  if (listed.exitCode !== 0) return 'not-a-repo'
  const paths = listed.stdout.split('\0').filter(path => path !== '')
  const untracked = new Map<string, string | null>(paths.map(path => [path, null]))
  if (paths.length > 0 && paths.length <= MAX_HASHED && !paths.some(path => path.includes('\n'))) {
    const hashed = await git(
      run,
      where.root,
      ['hash-object', '--no-filters', '--stdin-paths'],
      `${paths.join('\n')}\n`,
    )
    const hashes = hashed.stdout.split('\n').filter(line => line !== '')
    if (hashed.exitCode === 0 && hashes.length === paths.length) {
      paths.forEach((path, index) => untracked.set(path, hashes[index] ?? null))
    }
  }
  return { ...where, files: parseGitDiff(diff.stdout), untracked }
}

/** Git's blob id for a text: the hash `git hash-object` prints for its bytes. */
export async function blobHash(text: string): Promise<string> {
  const body = new TextEncoder().encode(text)
  const head = new TextEncoder().encode(`blob ${body.length}\0`)
  const all = new Uint8Array(head.length + body.length)
  all.set(head)
  all.set(body, head.length)
  const digest = await crypto.subtle.digest('SHA-1', all)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** What a path held in a snapshot. */
type State =
  | { kind: 'text'; text: string }
  | { kind: 'absent' }
  | { kind: 'binary'; bytes?: number | null; hash?: string | null }
  | { kind: 'untracked'; hash: string | null }
  | { kind: 'unknown' }

export type ShellOptions = {
  /** The path as steps show it, from a repository-relative one. */
  display: (path: string) => string
  /** The last text a file tool gave a file, by shown path (to diff an untracked file). */
  known: (file: string) => string | undefined
}

/** The steps a command made, comparing the snapshots taken around it. */
export async function shellSteps(
  run: Run,
  before: Snapshot,
  after: Snapshot,
  options: ShellOptions,
): Promise<PlayByPlayStep[]> {
  // Base contents, read once each per command: the text, a binary file (and
  // its size), null when the base has no such path, undefined when unreadable.
  type Base = string | { binary: number | null; hash: string | null } | null | undefined
  const baseTexts = new Map<string, Promise<Base>>()
  const readBase = async (path: string): Promise<Base> => {
    const spec = `${before.base}:${path}`
    const shown = await git(run, before.root, ['show', spec])
    if (shown.exitCode !== 0) return null
    if (shown.isStdoutTruncated || isBinary(shown.stdout)) {
      if (!isBinary(shown.stdout)) return undefined
      // One call for its blob id and size: "<id> blob <size>".
      const check = await git(run, before.root, ['cat-file', '--batch-check'], `${spec}\n`)
      const [hash = '', type = '', size = ''] = check.stdout.trim().split(' ')
      const ok = check.exitCode === 0 && type === 'blob'
      return { binary: ok && /^\d+$/.test(size) ? Number(size) : null, hash: ok ? hash : null }
    }
    return shown.stdout
  }
  const base = (path: string) => {
    let text = baseTexts.get(path)
    if (text === undefined) {
      text = readBase(path)
      baseTexts.set(path, text)
    }
    return text
  }
  const fromBase = (read: Base, absent: State): State =>
    read === undefined
      ? { kind: 'unknown' }
      : read === null
        ? absent
        : typeof read === 'string'
          ? { kind: 'text', text: read }
          : { kind: 'binary', bytes: read.binary, hash: read.hash }

  const stateOf = async (snap: Snapshot, path: string): Promise<State> => {
    const entry = snap.files.find(file => file.newPath === path)
    if (entry !== undefined) {
      if (entry.binary) return { kind: 'binary' }
      const from = entry.oldPath === null ? '' : await base(entry.oldPath)
      if (typeof from === 'string') return { kind: 'text', text: applyHunks(from, entry.hunks) }
      return from !== null && from !== undefined ? { kind: 'binary' } : { kind: 'unknown' }
    }
    if (snap.files.some(file => file.oldPath === path)) return { kind: 'absent' }
    if (snap.untracked.has(path)) return { kind: 'untracked', hash: snap.untracked.get(path) ?? null }
    return fromBase(await base(path), { kind: 'absent' })
  }

  // An untracked file had no earlier copy in git; a file tool may have left
  // us one, trusted only when its hash matches what was on disk.
  const earlier = async (path: string, hash: string | null): Promise<State> => {
    const text = options.known(options.display(path))
    if (text !== undefined && hash !== null && (await blobHash(text)) === hash) return { kind: 'text', text }
    return { kind: 'untracked', hash }
  }

  // An untracked file now on disk, read through git so no file is opened here.
  const current = async (path: string): Promise<State> => {
    const shown = await git(run, after.root, ['diff', ...DIFF.filter(arg => arg !== '-M'), '--no-index', '--', '/dev/null', path])
    if (shown.exitCode > 1 || shown.isStdoutTruncated) return { kind: 'unknown' }
    const [file] = parseGitDiff(shown.stdout)
    if (file?.binary) return { kind: 'binary' }
    return { kind: 'text', text: applyHunks('', file?.hunks ?? []) }
  }

  // Paths whose section of the diff changed, or whose untracked file did.
  const candidates = new Set<string>()
  const beforeRaw = new Set(before.files.map(file => file.raw))
  const afterRaw = new Set(after.files.map(file => file.raw))
  const touch = (file: FileDiff) => {
    if (file.oldPath !== null) candidates.add(file.oldPath)
    if (file.newPath !== null) candidates.add(file.newPath)
  }
  for (const file of after.files) if (!beforeRaw.has(file.raw)) touch(file)
  for (const file of before.files) if (!afterRaw.has(file.raw)) touch(file)
  const untracked = [...new Set([...before.untracked.keys(), ...after.untracked.keys()])].sort()
  for (const path of untracked) {
    const was = before.untracked.get(path)
    const now = after.untracked.get(path)
    if (before.untracked.has(path) !== after.untracked.has(path) || (was !== null && now !== null && was !== now)) {
      candidates.add(path)
    }
  }

  type Change = { path: string; was: State; now: State }
  const changes: Change[] = []
  const paths = [...candidates]
  for (const path of paths.slice(0, MAX_SHELL_FILES)) {
    let was = await stateOf(before, path)
    let now = await stateOf(after, path)
    if (was.kind === 'untracked') was = await earlier(path, was.hash)
    if (now.kind === 'untracked') now = await current(path)
    // Untracked before and after: git's own hashes settle it.
    const wasHash = before.untracked.get(path)
    const nowHash = after.untracked.get(path)
    const rehashed = wasHash != null && nowHash != null && wasHash !== nowHash
    if (!rehashed && !(await differs(was, now))) continue
    changes.push({ path, was, now })
  }

  // Pair a removed path with an added one into a rename: git's own pairing
  // first (a staged `git mv`), then identical content (a plain `mv`).
  const renames = new Map<string, string>() // new path -> old path
  const renamedAway = new Set<string>()
  const pair = (to: string, from: string) => {
    renames.set(to, from)
    renamedAway.add(from)
  }
  const isGone = (change: Change) => change.now.kind === 'absent' && change.was.kind !== 'absent'
  for (const file of after.files) {
    const { oldPath, newPath } = file
    if (oldPath === null || newPath === null || oldPath === newPath) continue
    const gone = changes.find(change => change.path === oldPath)
    const made = changes.find(change => change.path === newPath)
    // git paired them itself (a staged `git mv`), binary files included.
    if (gone && made && isGone(gone) && made.was.kind === 'absent' && made.now.kind !== 'absent') pair(newPath, oldPath)
  }
  for (const gone of changes) {
    if (!isGone(gone) || renamedAway.has(gone.path)) continue
    const wasText = gone.was.kind === 'text' ? gone.was.text : undefined
    const wasHash = gone.was.kind === 'untracked' || gone.was.kind === 'binary' ? (gone.was.hash ?? null) : null
    if (wasText === undefined && wasHash === null) continue
    for (const made of changes) {
      const { now } = made
      if (made.was.kind !== 'absent' || (now.kind !== 'text' && now.kind !== 'binary') || renames.has(made.path)) continue
      // Bytes are best compared by git's own hashes (a binary or untracked file).
      const madeHash = after.untracked.get(made.path) ?? (now.kind === 'text' ? await blobHash(now.text) : null)
      const same = wasText !== undefined ? now.kind === 'text' && now.text === wasText : madeHash === wasHash
      if (same) {
        pair(made.path, gone.path)
        break
      }
    }
  }

  const steps: PlayByPlayStep[] = []
  for (const { path, was, now } of changes) {
    if (renamedAway.has(path)) continue
    const file = options.display(path)
    const from = renames.get(path)
    if (from !== undefined) {
      const old = changes.find(change => change.path === from)
      if (now.kind !== 'text' || (old?.was.kind !== 'text' && old?.was.kind !== 'untracked')) {
        // A moved binary file: no lines to show.
        const bytes = old?.was.kind === 'binary' ? old.was.bytes : undefined
        steps.push({ ...bareStep(file, 'rename', 'shell', binaryNote(bytes)), from: options.display(from) })
        continue
      }
      // An untracked file moved whole has no earlier text; its hash matched.
      const oldText = old.was.kind === 'text' ? old.was.text : now.text
      const step = stepFromTexts(file, oldText, now.text, { via: 'shell', kind: 'rename', from: options.display(from) })
      if (step) steps.push(step)
      continue
    }
    const step = describe(file, was, now)
    if (step) steps.push(step)
  }
  if (paths.length > MAX_SHELL_FILES) {
    const left = paths.length - MAX_SHELL_FILES
    steps.push(bareStep(`${left} more file${left === 1 ? '' : 's'}`, 'more', 'shell', 'past the per-command cap; not compared'))
  }
  return steps
}

/** Whether two states of a path differ, leaning to "same" where git cannot tell. */
async function differs(was: State, now: State): Promise<boolean> {
  if (was.kind === 'text' && now.kind === 'text') return was.text !== now.text
  if (was.kind === 'absent' && now.kind === 'absent') return false
  if (was.kind === 'untracked') {
    if (now.kind === 'absent') return true
    // `git add` of a file the command did not change: same hash, no step.
    if (now.kind === 'text') return was.hash !== null && (await blobHash(now.text)) !== was.hash
    return false
  }
  return true
}

/** One path's change as a step. */
function describe(file: string, was: State, now: State): PlayByPlayStep | null {
  const textOf = (state: State) => (state.kind === 'text' ? state.text : null)
  if ((was.kind === 'text' || was.kind === 'absent') && (now.kind === 'text' || now.kind === 'absent')) {
    return stepFromTexts(file, textOf(was), textOf(now), { via: 'shell' })
  }
  if (was.kind === 'untracked') {
    return now.kind === 'absent'
      ? bareStep(file, 'delete', 'shell', 'deleted; it was untracked, so git kept no copy to show')
      : bareStep(file, 'change', 'shell', 'changed; it was untracked, so git kept no earlier copy to compare')
  }
  if (was.kind === 'binary' || now.kind === 'binary') {
    const kind = was.kind === 'absent' ? 'create' : now.kind === 'absent' ? 'delete' : 'change'
    const bytes = now.kind === 'binary' ? now.bytes : was.kind === 'binary' ? was.bytes : undefined
    return bareStep(file, kind, 'shell', binaryNote(bytes))
  }
  return bareStep(file, 'change', 'shell', 'changed; too large to compare')
}
