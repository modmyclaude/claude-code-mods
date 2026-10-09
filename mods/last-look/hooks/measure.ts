// Measures what a held command would destroy, to show the person. It never
// decides WHETHER to hold: once the classifier calls a command destructive it
// is held, and an empty or failed measurement only means the hold says
// "could not measure: review it yourself". The two exceptions, both
// classification the text alone cannot finish, are marked `isHarmless`: a
// redirect to a plain path that does not exist yet, and `git checkout <name>`
// that git confirms is a branch. alwaysAllow (plain literal paths only) is
// the one skip the person configures.
//
// Read-only commands only: `find` without -delete (no write or exec predicate
// is ever copied), `du`, and git's rev-parse, for-each-ref, status, ls-files,
// diff-index, diff-files, rev-list, log and clean -n (a dry run), all with optional locks
// off, so git writes nothing either.

import type { FsEntry, FsStat, ProcessRunResult } from 'claude-code'

import type { LastLookItem, LastLookReport, LastLookRow, LastLookTone } from '../types'
import { FIND_WRITES } from './classify'
import type { CdStep, Finding, Word } from './classify'
import { globSegment, hasGlob, isAbsolute, isAllowed, join, rebase, show, within } from './paths'

/**
 * The three read-only things measuring needs from the host. The hooks module
 * builds it from `$` (which never crosses an import); tests can fake it.
 */
export type Probe = {
  run: (argv: readonly string[], cwd: string, timeoutMs: number) => Promise<ProcessRunResult>
  /** A path's stat with `realPath`; undefined when it does not exist, a rejection for any other failure. */
  stat: (path: string) => Promise<FsStat | undefined>
  list: (path: string) => Promise<FsEntry[]>
}

export type Ctx = {
  probe: Probe
  /** The session's working directory, and where its links lead. */
  cwd: string
  cwdReal: string
  /** The project root: alwaysAllow folders are looked for beneath it. */
  root: string
  rootReal: string
  home?: string
  allow: readonly string[]
  now: number
}

export const COULD_NOT = 'could not measure: review it yourself'

/** Findings measured per command; any past it are held unmeasured. */
const MAX_ITEMS = 8
/** Detail rows kept per item: more than any pane shows. */
const MAX_ROWS = 40
/** Paths handed to one du call, and kept from a listing. */
const MAX_ARGS = 2000
const LIST_MS = 8_000
const GIT_MS = 6_000

const GIT = ['git', '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false']

/** Set on every measuring command: plain English output, no git locks, no prompts. */
export const MEASURE_ENV = { LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }

export async function measureAll(ctx: Ctx, command: string, findings: readonly Finding[]): Promise<LastLookReport> {
  const items: LastLookItem[] = []
  for (const finding of findings.slice(0, MAX_ITEMS)) {
    try {
      items.push(await measureOne(ctx, finding))
    } catch (error) {
      items.push(unmeasured(finding, undefined, `measuring failed: ${short(error)}`))
    }
  }
  const extra = findings.length - MAX_ITEMS
  if (extra > 0) {
    items.push({ ...blank(`${extra} more destructive ${extra === 1 ? 'step' : 'steps'}`), effect: 'unknown', summary: COULD_NOT, summaryTone: 'warning' })
  }
  return { command: clip(command, 2000), items, ...headline(items) }
}

/**
 * Every destructive command holds. Only alwaysAllow, or a part that turned out
 * not to be destructive at all (`isHarmless`), lets it through; what the
 * measurement found or failed to find never does.
 */
export function shouldHold(report: LastLookReport): boolean {
  return report.items.some(item => !item.isAllowed && !item.isHarmless)
}

async function measureOne(ctx: Ctx, f: Finding): Promise<LastLookItem> {
  const at = await whereItRuns(ctx, f.cd)
  if ('unknown' in at) return unmeasured(f, undefined, at.unknown)
  const where = show(at.dir, ctx.cwd, ctx.home)
  const notes: LastLookRow[] = at.notes.map(text => ({ text, tone: 'warning' }))
  if (f.isSudo) notes.push({ text: 'It runs with sudo, as root.', tone: 'warning' })
  if (f.unknown) return unmeasured(f, where, f.unknown, notes)
  const git = f.git
  switch (f.kind) {
    case 'rm': {
      const paths = await expand(ctx, at.dir, f.targets)
      return typeof paths === 'string' ? unmeasured(f, where, paths, notes) : remove(ctx, f, where, notes, at.dir, paths, 'words')
    }
    case 'find-delete':
      return findDelete(ctx, f, where, notes, at.dir)
    case 'redirect':
      return overwrite(ctx, f, where, notes, at.dir)
    case 'git-clean':
      return git?.sub === 'clean' ? clean(ctx, f, where, notes, at.dir, git) : unmeasured(f, where, 'unexpected git form', notes)
    case 'git-reset-hard':
    case 'git-discard':
      return discard(ctx, f, where, notes, at.dir)
    case 'git-push-force':
      return push(ctx, f, where, notes, at.dir)
    case 'git-branch-delete':
      return branchDelete(ctx, f, where, notes, at.dir)
    case 'xargs-rm':
      return unmeasured(f, where, 'it deletes whatever the command before it prints', notes)
  }
}

// ---------------------------------------------------------------- where, what

async function whereItRuns(ctx: Ctx, steps: readonly CdStep[]): Promise<{ dir: string; notes: string[] } | { unknown: string }> {
  let dir = ctx.cwd
  const notes: string[] = []
  for (const step of steps) {
    if (!step.dir.known) return { unknown: `it runs after cd ${step.dir.raw}, which is only known when it runs` }
    const next = join(dir, step.dir.text)
    if (step.soft && (await stat(ctx, next))?.kind !== 'dir') {
      notes.push(`cd ${step.dir.raw} would fail, so this would run in ${show(dir, ctx.cwd, ctx.home)}`)
      continue
    }
    dir = next
  }
  return { dir, notes }
}

/** A literal path as written, with no `..` (the kernel resolves `..` after links, not by spelling). */
function isPlainPath(w: Word): boolean {
  return w.plain && !w.text.split('/').includes('..')
}

function plainSteps(steps: readonly CdStep[]): boolean {
  return steps.every(step => isPlainPath(step.dir))
}

type Path = { abs: string; slash: boolean; plain: boolean }

/** Words to absolute paths, expanding globs as the shell would where it can. */
async function expand(ctx: Ctx, dir: string, words: readonly Word[]): Promise<Path[] | string> {
  const out: Path[] = []
  for (const w of words) {
    if (!w.known) return `it acts on ${w.raw}, which is only known when it runs`
    const slash = w.text.endsWith('/')
    if (!w.glob) {
      out.push({ abs: join(dir, w.text), slash, plain: isPlainPath(w) })
      continue
    }
    // zsh and bash differ on `**`; no single answer to measure against.
    if (w.text.includes('**')) return `it uses a recursive ** pattern (${w.raw}), which shells expand differently`
    const matches = await glob(ctx, dir, w.text)
    out.push(...(matches.length > 0 ? matches.map(abs => ({ abs, slash, plain: false })) : [{ abs: join(dir, w.text), slash, plain: false }]))
  }
  return out
}

async function glob(ctx: Ctx, dir: string, pattern: string): Promise<string[]> {
  let current = [isAbsolute(pattern) ? '/' : dir]
  for (const segment of pattern.split('/')) {
    if (segment === '' || segment === '.') continue
    if (!hasGlob(segment)) {
      current = current.map(path => join(path, segment))
      continue
    }
    const wanted = globSegment(segment)
    const next: string[] = []
    for (const path of current) {
      // A folder that is not there matches nothing; one that will not list is not "no match".
      const entries = await ctx.probe.list(path).catch(async error => {
        if (await stat(ctx, path)) throw error
        return []
      })
      for (const entry of entries) {
        const isHidden = entry.name.startsWith('.') && !segment.startsWith('.')
        if (!isHidden && wanted.test(entry.name)) next.push(join(path, entry.name))
      }
      if (next.length >= MAX_ARGS) break
    }
    current = next.slice(0, MAX_ARGS)
    if (current.length === 0) return []
  }
  return current
}

type Target = Path & { real: string; stat: FsStat }

async function existing(ctx: Ctx, paths: readonly Path[]): Promise<Target[]> {
  const stats = await Promise.all(paths.map(path => stat(ctx, path.abs)))
  return paths.flatMap((path, k) => {
    const found = stats[k]
    return found ? [{ ...path, real: found.realPath ?? path.abs, stat: found }] : []
  })
}

/** `/`, your home folder or one above it, or a top-level system folder. */
function isCatastrophic(path: string, home?: string): boolean {
  if (path === '/') return true
  if (home !== undefined && within(path, home)) return true
  return path.split('/').filter(Boolean).length === 1
}

/**
 * alwaysAllow: every target a plain literal path that exists, reached through
 * plain `cd`s, and both its spelling and its real path inside an allowed
 * folder. A real path another hook withheld is never allowed.
 */
function allowed(ctx: Ctx, f: Finding, paths: readonly Path[], found: readonly Target[]): boolean {
  if (ctx.allow.length === 0 || paths.length === 0 || found.length !== paths.length) return false
  if (!plainSteps(f.cd) || paths.some(p => !p.plain)) return false
  return found.every(t => t.stat.realPath !== undefined && isAllowed(t.abs, ctx.root, ctx.allow) && isAllowed(t.stat.realPath, ctx.rootReal, ctx.allow))
}

// ---------------------------------------------------------------- deletions

/** rm -r, and git clean once its dry run has named what it removes. */
async function remove(ctx: Ctx, f: Finding, where: string, notes: LastLookRow[], dir: string, paths: readonly Path[], from: 'words' | 'git-clean'): Promise<LastLookItem> {
  const found = await existing(ctx, paths)
  const name = (abs: string) => show(abs, ctx.cwd, ctx.home)
  if (found.length === 0) {
    const names = list(paths.map(p => name(p.abs)))
    if (from === 'words' && paths.every(p => p.plain) && plainSteps(f.cd)) {
      return item(f, where, { effect: 'nothing', summary: `Nothing found at these paths: ${names}`, tone: 'warning', rows: [...notes, { text: 'Held anyway: check these are the paths you mean.', tone: 'subtle' }] })
    }
    const why = from === 'git-clean' ? `its dry run named ${names}, which were not found where expected` : `nothing was found at ${names}, but the shell may read these paths differently`
    return unmeasured(f, where, why, notes)
  }
  const doomed = found.find(t => isCatastrophic(t.abs, ctx.home) || isCatastrophic(t.real, ctx.home))
  if (doomed) {
    return item(f, where, { summary: `It deletes ${name(doomed.abs)}: your home folder or a system folder. Too large to measure.`, tone: 'error', rows: notes, isCatastrophic: true })
  }
  if (from === 'words' && allowed(ctx, f, paths, found)) return allowedItem(f, where, notes)

  const [tree, view] = await Promise.all([measureTree(ctx, dir, found), gitView(ctx, dir, found.map(t => t.real), true)])
  const display = (real: string) => {
    const owner = found.find(t => within(t.real, real))
    return show(owner ? rebase(real, owner.real, owner.abs) : fromReal(ctx, real), ctx.cwd, ctx.home)
  }
  const rows = [...notes]
  const missing = paths.filter(p => !found.some(t => t.abs === p.abs))
  if (missing.length > 0) rows.push({ text: `Not found: ${list(missing.map(p => name(p.abs)))}`, tone: 'warning' })
  if (found.length > 1 && found.length <= 12) {
    for (const t of found) {
      const counted = tree.perTarget.get(t.real)
      const files = counted?.files ?? (t.stat.kind === 'dir' ? 0 : 1)
      const bytes = counted?.bytes ?? (t.stat.isLink ? 0 : t.stat.size)
      rows.push({ text: `${name(t.abs)}${t.stat.kind === 'dir' ? '/' : ''}  ${count(files, 'file')}, ${size(bytes)}`, tone: 'subtle' })
    }
  }
  const links = found.filter(t => t.stat.isLink && !t.slash)
  if (links.length > 0) rows.push({ text: `${list(links.map(t => name(t.abs)))}: a link, so only the link goes`, tone: 'subtle' })

  const lost = typeof view === 'object' ? [...view.changed].filter(([path, xy]) => !xy.includes('D') && found.some(t => within(t.real, path))) : []
  rows.push(...gitRows(view, lost, display, 'any of this'))
  if (typeof view === 'object' && view.tracked && view.tracked.size > 0) {
    rows.push({ text: `git can restore the last committed version of ${count(view.tracked.size, 'tracked file')}`, tone: 'subtle' })
  }
  const lostPaths = new Set(lost.map(([path]) => path))
  const sample = tree.sample.filter(path => !lostPaths.has(path))
  for (const path of sample.slice(0, MAX_ROWS)) rows.push({ text: display(path), tone: 'subtle' })
  const unlisted = Math.max(0, tree.files - lost.length - Math.min(sample.length, MAX_ROWS))
  rows.push(...tree.problems.map(text => ({ text, tone: 'warning' as const })))

  if (tree.isBlind) return unmeasured(f, where, tree.problems.join('; '), rows)
  const folders = found.filter(t => t.stat.kind === 'dir').length
  const summary = tree.files > 0 || folders === 0
    ? `Deletes ${tree.isLowerBound ? 'at least ' : ''}${count(tree.files, 'file')}, ${size(tree.bytes)}`
    : `Deletes ${count(folders, 'empty folder')}`
  return item(f, where, { summary, rows, moreRows: unlisted, files: tree.files, bytes: tree.bytes, unsaved: lost.length })
}

type Tree = {
  files: number
  bytes: number
  isLowerBound: boolean
  perTarget: Map<string, { files: number; bytes: number }>
  /** Real paths of some of the files, for the list. */
  sample: string[]
  problems: string[]
  /** Neither the list nor the size could be read. */
  isBlind: boolean
}

async function measureTree(ctx: Ctx, dir: string, targets: readonly Target[]): Promise<Tree> {
  const folders = targets.filter(t => t.stat.kind === 'dir' && (!t.stat.isLink || t.slash))
  const singles = targets.filter(t => !folders.includes(t))
  const tree: Tree = {
    files: singles.length,
    bytes: singles.reduce((sum, t) => sum + (t.stat.isLink ? 0 : t.stat.size), 0),
    isLowerBound: false,
    perTarget: new Map(),
    sample: singles.map(t => t.real),
    problems: [],
    isBlind: false,
  }
  if (folders.length === 0) return tree
  const reals = folders.map(t => t.real).slice(0, MAX_ARGS)
  const [listing, sizes] = await Promise.all([
    run(ctx, ['find', ...reals, '-type', 'f', '-print0'], dir, LIST_MS).catch(() => undefined),
    run(ctx, ['du', '-sk', ...reals], dir, LIST_MS).catch(() => undefined),
  ])
  if (listing) {
    const files = nulList(listing)
    tree.files += files.length
    tree.isLowerBound = listing.isStdoutTruncated || listing.exitCode !== 0
    tree.sample.push(...files.slice(0, MAX_ARGS))
    if (reals.length <= 20) {
      for (const real of reals) tree.perTarget.set(real, { files: files.filter(path => within(real, path)).length, bytes: 0 })
    }
    if (listing.exitCode !== 0) tree.problems.push('Some folders could not be read, so the count may be short.')
  } else tree.problems.push('Could not list the files.')
  if (sizes) {
    for (const [real, kib] of duLines(sizes.stdout)) {
      tree.bytes += kib * 1024
      const counted = tree.perTarget.get(real)
      if (counted) counted.bytes = kib * 1024
    }
  } else tree.problems.push('Could not add up the size.')
  tree.isBlind = !listing && !sizes
  return tree
}

async function findDelete(ctx: Ctx, f: Finding, where: string, notes: LastLookRow[], dir: string): Promise<LastLookItem> {
  const listing = f.findListing
  if (!listing) return unmeasured(f, where, 'its find expression could not be re-run safely', notes)
  // Never run a find that could write or execute, whatever built the listing.
  if (listing.some(t => FIND_WRITES.has(t))) return unmeasured(f, where, 'its find expression writes or runs commands', notes)
  const starts = f.targets.map(w => ({ abs: join(dir, w.text), slash: false, plain: isPlainPath(w) }))
  const names = list(starts.map(p => show(p.abs, ctx.cwd, ctx.home)))
  if (starts.some(p => isCatastrophic(p.abs, ctx.home))) {
    return unmeasured(f, where, `it searches ${names}, too much to measure`, notes)
  }
  const found = await existing(ctx, starts)
  if (found.length === 0) {
    if (starts.every(p => p.plain) && plainSteps(f.cd)) {
      return item(f, where, { effect: 'nothing', summary: `Nothing found at these paths: ${names}`, tone: 'warning', rows: [...notes, { text: 'Held anyway: check these are the paths you mean.', tone: 'subtle' }] })
    }
    return unmeasured(f, where, `nothing was found at ${names}, but the shell may read these paths differently`, notes)
  }
  if (allowed(ctx, f, starts, found)) return allowedItem(f, where, notes)

  const dirReal = (await stat(ctx, dir))?.realPath ?? dir
  const out = await run(ctx, ['find', ...listing], dirReal, LIST_MS).catch(() => undefined)
  if (!out) return unmeasured(f, where, 'the find listing did not finish', notes)
  const matched = nulList(out).map(path => join(dirReal, path))
  // The shell's find (bfs, GNU) and the system find can disagree: an error or an
  // empty listing says nothing about what the real command deletes.
  if (out.exitCode !== 0) {
    return unmeasured(f, where, `the system find stopped with an error (${clip(firstLine(out.stderr), 100)}); the shell's find may read it differently`, notes)
  }
  if (matched.length === 0) return unmeasured(f, where, "the system find lists nothing for it, but the shell's find may match differently", notes)
  const display = (real: string) => show(fromReal(ctx, real), ctx.cwd, ctx.home)
  const topmost = matched.filter(path => !matched.some(other => other !== path && within(other, path)))
  const [sizes, view] = await Promise.all([
    run(ctx, ['du', '-sk', ...topmost.slice(0, MAX_ARGS)], dirReal, LIST_MS).catch(() => undefined),
    gitView(ctx, dirReal, found.map(s => s.real), false),
  ])
  const bytes = sizes ? duLines(sizes.stdout).reduce((sum, [, kib]) => sum + kib * 1024, 0) : 0
  const matchedSet = new Set(matched)
  const lost = typeof view === 'object' ? [...view.changed].filter(([path, xy]) => !xy.includes('D') && matchedSet.has(path)) : []
  const lostPaths = new Set(lost.map(([path]) => path))
  const rows = [...notes, ...gitRows(view, lost, display, 'these files')]
  const sample = matched.filter(path => !lostPaths.has(path)).slice(0, MAX_ROWS)
  for (const path of sample) rows.push({ text: display(path), tone: 'subtle' })
  if (!sizes) rows.push({ text: 'Could not add up the size.', tone: 'warning' })
  rows.push({ text: "Listed with the system find; the shell's find may match a little differently.", tone: 'subtle' })
  const lower = out.isStdoutTruncated ? 'at least ' : ''
  return item(f, where, {
    summary: `Deletes ${lower}${count(matched.length, 'path')}${sizes ? `, ${size(bytes)}` : ''}`,
    rows,
    moreRows: Math.max(0, matched.length - lost.length - sample.length),
    files: matched.length,
    bytes,
    unsaved: lost.length,
  })
}

async function clean(ctx: Ctx, f: Finding, where: string, notes: LastLookRow[], dir: string, git: { flags: string[]; forces: number; excludes: string[]; paths: Word[] }): Promise<LastLookItem> {
  const unknownPath = git.paths.find(w => !w.known)
  if (unknownPath) return unmeasured(f, where, `it names ${unknownPath.raw}, which is only known when it runs`, notes)
  // The same clean as a dry run: -n lists and never removes, even beside -f.
  // The forces are passed too: -ff also removes nested git repositories.
  const forces = Array.from({ length: Math.min(git.forces, 2) }, () => '-f')
  const args = ['clean', '-n', ...forces, ...git.flags.map(flag => `-${flag}`), ...git.excludes.flatMap(e => ['-e', e]), '--', ...git.paths.map(w => w.text)]
  const out = await gitRun(ctx, dir, args)
  if (out.exitCode !== 0) {
    const why = /not a git repository/i.test(out.stderr) ? 'it is not in a git repository' : `git clean -n failed: ${clip(firstLine(out.stderr), 120)}`
    return unmeasured(f, where, why, notes)
  }
  const lines = out.stdout.split('\n')
  const names = lines.flatMap(line => (line.startsWith('Would remove ') ? [unquote(line.slice('Would remove '.length))] : []))
  const skipped = lines.flatMap(line => (line.startsWith('Would skip repository ') ? [unquote(line.slice('Would skip repository '.length))] : []))
  const rows = [...notes, ...skipped.map(name => ({ text: `It skips the nested repository ${name}.`, tone: 'subtle' as const }))]
  if (names.length === 0) return unmeasured(f, where, 'its dry run (git clean -n) lists nothing to remove', rows)
  return remove(ctx, f, where, rows, dir, names.map(name => ({ abs: join(dir, name), slash: false, plain: false })), 'git-clean')
}

/** git's C-style quoting of an odd name: `"notes \"v2\".md"`. */
export function unquote(name: string): string {
  if (!(name.length >= 2 && name.startsWith('"') && name.endsWith('"'))) return name
  const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '"': '"', '\\': '\\' }
  const bytes: number[] = []
  const body = name.slice(1, -1)
  for (let k = 0; k < body.length; k++) {
    const c = body[k] ?? ''
    if (c !== '\\') {
      for (const byte of new TextEncoder().encode(c)) bytes.push(byte)
      continue
    }
    const octal = /^[0-7]{3}/.exec(body.slice(k + 1))
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8))
      k += 3
    } else {
      const next = body[k + 1] ?? ''
      for (const byte of new TextEncoder().encode(escapes[next] ?? next)) bytes.push(byte)
      k += 1
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

async function overwrite(ctx: Ctx, f: Finding, where: string, notes: LastLookRow[], dir: string): Promise<LastLookItem> {
  const paths = await expand(ctx, dir, f.targets)
  if (typeof paths === 'string') return unmeasured(f, where, paths, notes)
  const path = paths[0]
  if (!path) return unmeasured(f, where, 'it names no file', notes)
  const isPlain = path.plain && plainSteps(f.cd)
  // `stat` answers undefined only when the path positively does not exist; any
  // other failure throws, and the part is held unmeasured.
  const found = await stat(ctx, path.abs)
  const name = show(path.abs, ctx.cwd, ctx.home)
  // The one proof that lets a redirect through: a plain path that does not exist.
  if (!found) {
    return isPlain
      ? harmless(f, where, `Creates ${name}; nothing is overwritten`, notes)
      : unmeasured(f, where, `nothing was found at ${name}, but the shell may read the path differently`, notes)
  }
  // A folder, a link (even to nowhere), a device: no proof either way, so held.
  if (found.kind !== 'file' || found.isLink) {
    if (found.kind !== 'file') return unmeasured(f, where, `${name} is not a plain file`, notes)
    notes = [...notes, { text: `${name} is a link: the file it leads to is overwritten.`, tone: 'warning' }]
  }
  const real = found.realPath
  if (isPlain && real !== undefined && ctx.allow.length > 0 && isAllowed(path.abs, ctx.root, ctx.allow) && isAllowed(real, ctx.rootReal, ctx.allow)) {
    return allowedItem(f, where, notes)
  }

  const view = await gitView(ctx, dir, [real ?? path.abs], true)
  const rows = [...notes]
  let unsaved = 0
  if (view === 'none') rows.push({ text: 'Not in a git repository: its old contents would be gone for good.', tone: 'warning' })
  else if (view === 'failed') rows.push({ text: 'git status failed, so unsaved work could not be checked.', tone: 'warning' })
  else {
    const xy = view.changed.get(real ?? path.abs)
    if (xy !== undefined && !xy.includes('D')) {
      unsaved = 1
      rows.push({ text: `It has unsaved work git cannot bring back (${describe(xy)}).`, tone: 'error' })
    } else if (view.tracked?.has(real ?? path.abs)) rows.push({ text: 'git can restore it as last committed.', tone: 'subtle' })
    else rows.push({ text: 'git ignores it: its old contents would be gone for good.', tone: 'warning' })
  }
  return item(f, where, { summary: `Overwrites ${name} (${size(found.size)})`, rows, files: 1, bytes: found.size, unsaved })
}

// ---------------------------------------------------------------- git

async function discard(ctx: Ctx, f: Finding, where: string, notes: LastLookRow[], dir: string): Promise<LastLookItem> {
  const git = f.git
  const top = await gitRun(ctx, dir, ['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) return unmeasured(f, where, 'it is not in a git repository', notes)
  const root = top.stdout.trim()
  const display = (real: string) => show(fromReal(ctx, real), ctx.cwd, ctx.home)

  let specs: string[] = []
  let fromIndex = false
  let ref: string | undefined
  if (git?.sub === 'reset') {
    if (git.ref && !git.ref.known) return unmeasured(f, where, `it resets to ${git.ref.raw}, which is only known when it runs`, notes)
    ref = git.ref?.text
  } else if (git?.sub === 'discard') {
    const unknownPath = git.paths.find(w => !w.known)
    if (unknownPath) return unmeasured(f, where, `it names ${unknownPath.raw}, which is only known when it runs`, notes)
    if (git.mode === 'maybe-ref') {
      // `git checkout x` passes only as a proven branch switch (git refuses a
      // switch that would lose changes); every doubt is held as paths.
      const name = git.paths[0]?.text ?? ''
      if (await isBranchSwitch(ctx, dir, name)) return harmless(f, where, `Switches to branch ${name}; git refuses a switch that would lose changes`, notes)
    }
    if (git.mode !== 'all') specs = ['--', ...git.paths.map(w => w.text)]
    fromIndex = git.fromIndex && git.mode !== 'all'
  } else return unmeasured(f, where, 'unexpected git form', notes)

  if (ref !== undefined && ref !== 'HEAD') {
    const known = await gitRun(ctx, dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    if (known.exitCode !== 0) return unmeasured(f, where, `git cannot find ${ref}`, notes)
  }
  const dropsCommits = ref !== undefined && ref !== 'HEAD'
  // diff-files and diff-index read the index without refreshing it: `git diff` would rewrite it.
  const numstatArgs = fromIndex ? ['diff-files', '--numstat', ...specs] : ['diff-index', '--numstat', 'HEAD', ...specs]
  const [status, numstat, branch, dropped, log] = await Promise.all([
    gitRun(ctx, dir, ['status', '--porcelain=v1', '-z', '--untracked-files=no', ...specs]),
    gitRun(ctx, dir, numstatArgs),
    gitRun(ctx, dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    dropsCommits ? gitRun(ctx, dir, ['rev-list', '--count', '--end-of-options', `${ref}..HEAD`]) : undefined,
    dropsCommits ? gitRun(ctx, dir, ['log', '--format=%h %s', '-n', '8', '--end-of-options', `${ref}..HEAD`]) : undefined,
  ])
  if (status.exitCode !== 0) return unmeasured(f, where, `git status failed: ${clip(firstLine(status.stderr), 120)}`, notes)
  if (dropped && dropped.exitCode !== 0) return unmeasured(f, where, `git could not count the commits it drops: ${clip(firstLine(dropped.stderr), 120)}`, notes)
  const changes = [...porcelain(status.stdout, root)].filter(([, xy]) => (fromIndex ? xy[1] !== ' ' : true))
  const lines = numstatLines(numstat.stdout, root)
  const commits = dropped ? Number.parseInt(dropped.stdout.trim(), 10) || 0 : 0
  if (changes.length === 0 && commits === 0) {
    return item(f, where, { effect: 'nothing', summary: 'Nothing to lose as far as git can tell: no uncommitted changes there', tone: 'warning', rows: notes })
  }
  const rows = [...notes]
  let added = 0
  let removed = 0
  if (changes.length > 0) {
    rows.push({ text: `${count(changes.length, 'file')} with uncommitted changes git cannot bring back:`, tone: 'error' })
    for (const [path, xy] of changes) {
      const stats = lines.get(path)
      added += stats?.added ?? 0
      removed += stats?.removed ?? 0
      rows.push({ text: `  ${display(path)}  ${stats ? `+${stats.added} -${stats.removed}` : describe(xy)}`, tone: 'error' })
    }
  }
  const onBranch = branch.exitCode === 0 ? branch.stdout.trim() : 'this branch'
  if (commits > 0) {
    rows.push({ text: `${count(commits, 'commit')} would leave ${onBranch}:`, tone: 'error' })
    for (const line of (log?.stdout ?? '').split('\n').filter(Boolean)) rows.push({ text: `  ${line}`, tone: 'subtle' })
    rows.push({ text: 'git reflog can still find dropped commits for a while.', tone: 'subtle' })
  }
  const parts = [
    ...(changes.length > 0 ? [`Discards uncommitted changes in ${count(changes.length, 'file')} (+${added} -${removed} lines)`] : []),
    ...(commits > 0 ? [`drops ${count(commits, 'commit')} from ${onBranch}`] : []),
  ]
  return item(f, where, { summary: capitalize(parts.join(' and ')), tone: 'error', rows, files: changes.length, unsaved: changes.length, commits })
}

/**
 * True only when git positively says `name` is a branch: a local branch, a
 * remote-tracking branch, or exactly one remote branch git would set up for
 * it; and no file or folder of that name makes the checkout ambiguous. A git
 * error answers false; a stat error throws (held).
 */
async function isBranchSwitch(ctx: Ctx, dir: string, name: string): Promise<boolean> {
  if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.startsWith('-') || name.includes('..')) return false
  const local = await gitRun(ctx, dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])
  let isBranch = local.exitCode === 0
  if (!isBranch) isBranch = (await gitRun(ctx, dir, ['rev-parse', '--verify', '--quiet', `refs/remotes/${name}`])).exitCode === 0
  if (!isBranch) {
    const guess = await gitRun(ctx, dir, ['for-each-ref', '--format=%(refname)', `refs/remotes/*/${name}`])
    isBranch = guess.exitCode === 0 && guess.stdout.split('\n').filter(Boolean).length === 1
  }
  if (!isBranch) return false
  return (await stat(ctx, join(dir, name))) === undefined
}

async function push(ctx: Ctx, f: Finding, where: string, notes: LastLookRow[], dir: string): Promise<LastLookItem> {
  const git = f.git
  if (git?.sub !== 'push') return unmeasured(f, where, 'unexpected git form', notes)
  if (git.isWholeRepo) return unmeasured(f, where, 'it force-pushes many branches at once', notes)
  if (git.remote && !git.remote.known) return unmeasured(f, where, `it pushes to ${git.remote.raw}, which is only known when it runs`, notes)
  const top = await gitRun(ctx, dir, ['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) return unmeasured(f, where, 'it is not in a git repository', notes)

  type Pair = { local: string; name: string; isDelete: boolean }
  const pairs: Pair[] = []
  const branch = (await gitRun(ctx, dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
  if (!git.remote) {
    let upstream = await gitRun(ctx, dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{push}'])
    if (upstream.exitCode !== 0) upstream = await gitRun(ctx, dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
    if (upstream.exitCode !== 0) return unmeasured(f, where, 'no upstream branch is set, so what it would overwrite is unclear', notes)
    pairs.push({ local: 'HEAD', name: upstream.stdout.trim(), isDelete: false })
  } else if (git.refspecs.length === 0) {
    pairs.push({ local: 'HEAD', name: `${git.remote.text}/${branch}`, isDelete: false })
  } else {
    for (const spec of git.refspecs) {
      if (!spec.known) return unmeasured(f, where, `it pushes ${spec.raw}, which is only known when it runs`, notes)
      const [src = '', dst] = spec.text.replace(/^\+/, '').split(':')
      const target = (dst ?? src).replace(/^refs\/heads\//, '')
      pairs.push({ local: src || 'HEAD', name: `${git.remote.text}/${target === 'HEAD' ? branch : target}`, isDelete: src === '' })
    }
  }

  const fetchHead = (await gitRun(ctx, dir, ['rev-parse', '--git-path', 'FETCH_HEAD'])).stdout.trim()
  const fetched = fetchHead ? await stat(ctx, join(dir, fetchHead)) : undefined
  const age = fetched ? ago(ctx.now - fetched.mtimeMs) : 'never fetched here'
  const rows = [...notes]
  let total = 0
  let isBlind = false
  for (const pair of pairs.slice(0, 6)) {
    const remoteRef = `refs/remotes/${pair.name}`
    if (pair.isDelete) {
      rows.push({ text: `It deletes ${pair.name} on the remote.`, tone: 'error' })
      continue
    }
    const known = await gitRun(ctx, dir, ['rev-parse', '--verify', '--quiet', remoteRef])
    if (known.exitCode !== 0) {
      isBlind = true
      rows.push({ text: `No record of ${pair.name} here, so what it would overwrite is unknown.`, tone: 'warning' })
      continue
    }
    const range = `${pair.local}..${remoteRef}`
    const [counted, log] = await Promise.all([
      gitRun(ctx, dir, ['rev-list', '--count', '--end-of-options', range]),
      gitRun(ctx, dir, ['log', '--format=%h %an: %s', '-n', '8', '--end-of-options', range]),
    ])
    if (counted.exitCode !== 0) {
      isBlind = true
      rows.push({ text: `git could not compare with ${pair.name}.`, tone: 'warning' })
      continue
    }
    const n = Number.parseInt(counted.stdout.trim(), 10) || 0
    total += n
    if (n > 0) {
      rows.push({ text: `${count(n, 'commit')} on ${pair.name} would be overwritten:`, tone: 'error' })
      for (const line of log.stdout.split('\n').filter(Boolean)) rows.push({ text: `  ${line}`, tone: 'subtle' })
    }
  }
  rows.push({ text: `As of your last fetch (${age}); the remote may have moved since.`, tone: 'warning' })
  const names = list(pairs.map(p => p.name))
  const summary = total > 0 ? `Overwrites ${names}: ${count(total, 'commit')} there would be lost` : `Force-pushes ${names}; no commits would be lost as of your last fetch`
  return item(f, where, { effect: isBlind ? 'unknown' : 'some', summary, tone: total > 0 ? 'error' : 'warning', rows, commits: total })
}

async function branchDelete(ctx: Ctx, f: Finding, where: string, notes: LastLookRow[], dir: string): Promise<LastLookItem> {
  const git = f.git
  if (git?.sub !== 'branch') return unmeasured(f, where, 'unexpected git form', notes)
  const unknownName = git.names.find(w => !w.known)
  if (unknownName) return unmeasured(f, where, `it deletes ${unknownName.raw}, which is only known when it runs`, notes)
  const top = await gitRun(ctx, dir, ['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) return unmeasured(f, where, 'it is not in a git repository', notes)
  const current = (await gitRun(ctx, dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
  const rows = [...notes]
  const deleted: string[] = []
  let total = 0
  let isBlind = false
  for (const w of git.names.slice(0, 10)) {
    const name = w.text
    const exists = (await gitRun(ctx, dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])).exitCode === 0
    if (!exists) {
      rows.push({ text: `No branch named ${name}.`, tone: 'subtle' })
      continue
    }
    if (name === current) rows.push({ text: `${name} is checked out, so git will refuse to delete it.`, tone: 'subtle' })
    deleted.push(name)
    // Commits on this branch and on no other branch, remote or tag.
    const only = [`refs/heads/${name}`, '--not', `--exclude=${name}`, '--branches', '--remotes', '--tags']
    const [counted, log] = await Promise.all([gitRun(ctx, dir, ['rev-list', '--count', ...only]), gitRun(ctx, dir, ['log', '--format=%h %s', '-n', '8', ...only])])
    if (counted.exitCode !== 0) {
      isBlind = true
      continue
    }
    const n = Number.parseInt(counted.stdout.trim(), 10) || 0
    total += n
    if (n > 0) {
      rows.push({ text: `${count(n, 'commit')} exist only on ${name}:`, tone: 'error' })
      for (const line of log.stdout.split('\n').filter(Boolean)) rows.push({ text: `  ${line}`, tone: 'subtle' })
    }
  }
  if (deleted.length === 0) return item(f, where, { effect: 'nothing', summary: 'No such branch found', tone: 'warning', rows })
  if (total > 0) rows.push({ text: 'git reflog can still find them for a while.', tone: 'subtle' })
  const summary = total > 0 ? `Deletes ${list(deleted)}: ${count(total, 'commit')} exist nowhere else` : `Deletes ${list(deleted)}; every commit is also on another branch`
  return item(f, where, { effect: isBlind ? 'unknown' : 'some', summary, tone: total > 0 ? 'error' : 'warning', rows, commits: total })
}

type GitView = { changed: Map<string, string>; tracked?: Set<string> } | 'none' | 'failed'

/** What git knows about these real paths: uncommitted entries, tracked files. */
async function gitView(ctx: Ctx, dir: string, reals: readonly string[], wantTracked: boolean): Promise<GitView> {
  const top = await gitRun(ctx, dir, ['rev-parse', '--show-toplevel']).catch(() => undefined)
  if (!top) return 'failed'
  if (top.exitCode !== 0) return 'none'
  const root = top.stdout.trim()
  const inside = reals.filter(real => within(root, real) && real !== join(root, '.git') && !within(join(root, '.git'), real))
  if (inside.length === 0) return 'none'
  const specs = inside.slice(0, MAX_ARGS).map(real => (real === root ? '.' : real.slice(root.length + 1)))
  // Literal pathspecs: a file named `a[1].txt` is that file, not a pattern.
  const status = await gitRun(ctx, root, ['--literal-pathspecs', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...specs]).catch(() => undefined)
  if (!status || status.exitCode !== 0) return 'failed'
  const view: GitView = { changed: porcelain(status.stdout, root) }
  if (wantTracked) {
    const files = await gitRun(ctx, root, ['--literal-pathspecs', 'ls-files', '-z', '--', ...specs]).catch(() => undefined)
    if (files && files.exitCode === 0) view.tracked = new Set(nulList(files).map(path => join(root, path)))
  }
  return view
}

function gitRows(view: GitView, lost: [string, string][], display: (real: string) => string, what: string): LastLookRow[] {
  if (view === 'none') return [{ text: `Not in a git repository: git cannot bring back ${what}.`, tone: 'warning' }]
  if (view === 'failed') return [{ text: 'git status failed, so unsaved work could not be checked.', tone: 'warning' }]
  if (lost.length === 0) return []
  const rows: LastLookRow[] = [{ text: `${count(lost.length, 'file')} ${lost.length === 1 ? 'has' : 'have'} unsaved work you would lose:`, tone: 'error' }]
  for (const [path, xy] of lost.slice(0, 15)) rows.push({ text: `  ${display(path)}  (${describe(xy)})`, tone: 'error' })
  if (lost.length > 15) rows.push({ text: `  and ${count(lost.length - 15, 'more file')} with unsaved work`, tone: 'error' })
  return rows
}

// ---------------------------------------------------------------- headline

function headline(items: readonly LastLookItem[]): Pick<LastLookReport, 'headline' | 'headlineTone'> {
  const live = items.filter(i => !i.isAllowed && !i.isHarmless)
  const total = (key: 'unsaved' | 'commits' | 'files' | 'bytes') => live.reduce((sum, i) => sum + i[key], 0)
  const unsaved = total('unsaved')
  const commits = total('commits')
  if (live.some(i => i.isCatastrophic)) return { headline: 'It deletes your home folder or a system folder', headlineTone: 'error' }
  if (unsaved > 0) return { headline: `${count(unsaved, 'file')} ${unsaved === 1 ? 'has' : 'have'} unsaved work you would lose`, headlineTone: 'error' }
  if (commits > 0) return { headline: `${count(commits, 'commit')} would be lost`, headlineTone: 'error' }
  if (live.some(i => i.effect === 'unknown')) return { headline: 'Could not measure all of it: review it yourself', headlineTone: 'warning' }
  const files = total('files')
  if (files > 0) return { headline: `It would delete or overwrite ${count(files, 'file')} (${size(total('bytes'))})`, headlineTone: 'warning' }
  if (live.length > 0 && live.every(i => i.effect === 'nothing')) return { headline: 'Nothing found to destroy as far as it can tell: review it yourself', headlineTone: 'warning' }
  return { headline: 'Check what it would change before it runs', headlineTone: 'warning' }
}

// ---------------------------------------------------------------- pieces

type Draft = {
  summary: string
  tone?: LastLookTone
  effect?: LastLookItem['effect']
  rows?: LastLookRow[]
  moreRows?: number
  files?: number
  bytes?: number
  unsaved?: number
  commits?: number
  isAllowed?: boolean
  isHarmless?: boolean
  isCatastrophic?: boolean
}

function blank(title: string): LastLookItem {
  return { title, effect: 'some', summary: '', summaryTone: 'normal', rows: [], moreRows: 0, files: 0, bytes: 0, unsaved: 0, commits: 0, isAllowed: false, isHarmless: false, isCatastrophic: false }
}

function item(f: Finding, where: string | undefined, d: Draft): LastLookItem {
  const rows = d.rows ?? []
  return {
    ...blank(clip(f.label, 400)),
    ...(where !== undefined && where !== '.' ? { where } : {}),
    effect: d.effect ?? 'some',
    summary: d.summary,
    summaryTone: d.tone ?? 'normal',
    rows: rows.slice(0, MAX_ROWS),
    moreRows: Math.max(0, rows.length - MAX_ROWS) + (d.moreRows ?? 0),
    files: d.files ?? 0,
    bytes: d.bytes ?? 0,
    unsaved: d.unsaved ?? 0,
    commits: d.commits ?? 0,
    isAllowed: d.isAllowed ?? false,
    isHarmless: d.isHarmless ?? false,
    isCatastrophic: d.isCatastrophic ?? false,
  }
}

function unmeasured(f: Finding, where: string | undefined, why: string, rows: LastLookRow[] = []): LastLookItem {
  return item(f, where, { effect: 'unknown', summary: COULD_NOT, tone: 'warning', rows: [{ text: capitalize(`${why}.`), tone: 'subtle' }, ...rows] })
}

function allowedItem(f: Finding, where: string, notes: LastLookRow[]): LastLookItem {
  return item(f, where, { summary: 'Inside your alwaysAllow folders', rows: notes, isAllowed: true })
}

/** Not destructive after all; see `isHarmless`. */
function harmless(f: Finding, where: string, summary: string, notes: LastLookRow[]): LastLookItem {
  return item(f, where, { effect: 'nothing', summary, rows: notes, isHarmless: true })
}

async function run(ctx: Ctx, argv: string[], cwd: string, timeoutMs: number): Promise<ProcessRunResult> {
  return ctx.probe.run(argv, cwd, timeoutMs)
}

async function gitRun(ctx: Ctx, dir: string, args: string[]): Promise<ProcessRunResult> {
  return run(ctx, [...GIT, ...args], dir, GIT_MS)
}

/** Undefined only when the path is not there; any other failure throws, so the part is held unmeasured. */
async function stat(ctx: Ctx, path: string): Promise<FsStat | undefined> {
  return ctx.probe.stat(path)
}

/** A real path as the person knows it: under their cwd's own spelling. */
function fromReal(ctx: Ctx, real: string): string {
  return rebase(real, ctx.cwdReal, ctx.cwd)
}

function nulList(out: ProcessRunResult): string[] {
  const parts = out.stdout.split('\0')
  // A cut stream ends mid-path: drop the partial one.
  if (out.isStdoutTruncated) parts.pop()
  return parts.filter(Boolean)
}

/** `du -sk` lines: [path, KiB]. */
export function duLines(stdout: string): [string, number][] {
  return stdout.split('\n').flatMap(line => {
    const m = /^(\d+)\t(.+)$/.exec(line)
    return m ? [[m[2] ?? '', Number(m[1])] as [string, number]] : []
  })
}

/** `git status --porcelain=v1 -z`: real path to its two-letter status. */
export function porcelain(stdout: string, root: string): Map<string, string> {
  const out = new Map<string, string>()
  const parts = stdout.split('\0')
  for (let k = 0; k < parts.length; k++) {
    const entry = parts[k] ?? ''
    if (entry.length < 4) continue
    const xy = entry.slice(0, 2)
    out.set(join(root, entry.slice(3)), xy)
    // A rename or copy is followed by the path it came from.
    if (xy[0] === 'R' || xy[0] === 'C') k++
  }
  return out
}

function numstatLines(stdout: string, root: string): Map<string, { added: number; removed: number }> {
  const out = new Map<string, { added: number; removed: number }>()
  for (const line of stdout.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (m) out.set(join(root, m[3] ?? ''), { added: Number(m[1]) || 0, removed: Number(m[2]) || 0 })
  }
  return out
}

function describe(xy: string): string {
  if (xy === '??') return 'never added to git'
  if (xy.includes('U')) return 'merge conflict'
  if (xy[0] === 'A') return 'new, staged'
  if (xy[0] === 'R') return 'renamed'
  if (xy[1] === 'M' || xy[1] === 'T') return 'modified'
  if (xy[0] === 'M') return 'staged changes'
  if (xy.includes('D')) return 'deleted'
  return 'changed'
}

export function count(n: number, noun: string): string {
  return `${grouped(n)} ${n === 1 ? noun : `${noun}s`}`
}

export function grouped(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function size(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`
}

function ago(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 2) return 'just now'
  if (minutes < 90) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

function list(names: readonly string[]): string {
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function short(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return clip(message, 120)
}
