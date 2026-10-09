// Measures what each finding would destroy, with read-only commands only:
// `find` without -delete, `du`, and git's status, log, rev-list, rev-parse,
// ls-files, diff --numstat and clean -n (a dry run). Every git call runs with
// optional locks off, so even git status writes nothing.
//
// A finding that cannot be measured is reported as such ("could not measure:
// review it yourself") and still held; it is never waved through.

import type { FsEntry, FsStat, ProcessRunResult } from 'claude-code'

import type { LastLookItem, LastLookReport, LastLookRow, LastLookTone } from '../types'
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
    items.push({
      ...blank(`${extra} more destructive ${extra === 1 ? 'step' : 'steps'}`),
      effect: 'unknown',
      summary: COULD_NOT,
      summaryTone: 'warning',
    })
  }
  return { command: clip(command, 2000), items, ...headline(items) }
}

/** Hold unless every part is measured harmless or inside alwaysAllow. */
export function shouldHold(report: LastLookReport): boolean {
  return report.items.some(item => item.effect !== 'nothing' && !item.isAllowed)
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
      return typeof paths === 'string' ? unmeasured(f, where, paths, notes) : remove(ctx, f, where, notes, at.dir, paths)
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

type Path = { abs: string; slash: boolean }

/** Words to absolute paths, expanding globs as the shell would. */
async function expand(ctx: Ctx, dir: string, words: readonly Word[]): Promise<Path[] | string> {
  const out: Path[] = []
  for (const w of words) {
    if (!w.known) return `it acts on ${w.raw}, which is only known when it runs`
    const slash = w.text.endsWith('/')
    if (!w.glob) {
      out.push({ abs: join(dir, w.text), slash })
      continue
    }
    const matches = await glob(ctx, dir, w.text)
    // No match: the shell hands over the pattern itself, which names nothing.
    out.push(...(matches.length > 0 ? matches.map(abs => ({ abs, slash })) : [{ abs: join(dir, w.text), slash }]))
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

function allowed(ctx: Ctx, targets: readonly { abs: string; real: string }[]): boolean {
  if (ctx.allow.length === 0 || targets.length === 0) return false
  return targets.every(t => isAllowed(t.abs, ctx.root, ctx.allow) && isAllowed(t.real, ctx.rootReal, ctx.allow))
}

// ---------------------------------------------------------------- deletions

/** rm -r, and git clean once its dry run has named what it removes. */
async function remove(ctx: Ctx, f: Finding, where: string, notes: LastLookRow[], dir: string, paths: readonly Path[]): Promise<LastLookItem> {
  const found = await existing(ctx, paths)
  if (found.length === 0) {
    const names = paths.map(p => show(p.abs, ctx.cwd, ctx.home))
    return item(f, where, { effect: 'nothing', summary: `Nothing to delete: ${list(names)} ${names.length === 1 ? 'does' : 'do'} not exist`, rows: notes })
  }
  const doomed = found.find(t => isCatastrophic(t.abs, ctx.home) || isCatastrophic(t.real, ctx.home))
  if (doomed) {
    const name = show(doomed.abs, ctx.cwd, ctx.home)
    return item(f, where, { summary: `It deletes ${name}: your home folder or a system folder. Too large to measure.`, tone: 'error', rows: notes })
  }
  if (allowed(ctx, found)) return allowedItem(f, where, notes)

  const [tree, view] = await Promise.all([measureTree(ctx, dir, found), gitView(ctx, dir, found.map(t => t.real), true)])
  const display = (real: string) => {
    const owner = found.find(t => within(t.real, real))
    return show(owner ? rebase(real, owner.real, owner.abs) : fromReal(ctx, real), ctx.cwd, ctx.home)
  }
  const rows = [...notes]
  if (found.length > 1 && found.length <= 12) {
    for (const t of found) {
      const counted = tree.perTarget.get(t.real)
      const files = counted?.files ?? (t.stat.kind === 'dir' ? 0 : 1)
      const bytes = counted?.bytes ?? (t.stat.isLink ? 0 : t.stat.size)
      rows.push({ text: `${show(t.abs, ctx.cwd, ctx.home)}${t.stat.kind === 'dir' ? '/' : ''}  ${count(files, 'file')}, ${size(bytes)}`, tone: 'subtle' })
    }
  }
  const links = found.filter(t => t.stat.isLink && !t.slash)
  if (links.length > 0) rows.push({ text: `${list(links.map(t => show(t.abs, ctx.cwd, ctx.home)))}: a link, so only the link goes`, tone: 'subtle' })

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
    tree.isLowerBound = listing.isStdoutTruncated
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
  const starts = f.targets.map(w => join(dir, w.text))
  if (starts.some(path => isCatastrophic(path, ctx.home))) {
    return unmeasured(f, where, `it searches ${list(starts.map(p => show(p, ctx.cwd, ctx.home)))}, too much to measure`, notes)
  }
  const dirStat = await stat(ctx, dir)
  if (!dirStat) return item(f, where, { effect: 'nothing', summary: `Nothing to delete: ${where} does not exist`, rows: notes })
  const dirReal = dirStat.realPath ?? dir
  const startReals = await Promise.all(starts.map(async path => ({ abs: path, real: (await stat(ctx, path))?.realPath ?? path })))
  if (allowed(ctx, startReals)) return allowedItem(f, where, notes)

  const out = await run(ctx, ['find', ...listing], dirReal, LIST_MS).catch(() => undefined)
  if (!out) return unmeasured(f, where, 'the find listing did not finish', notes)
  const matched = nulList(out).map(path => join(dirReal, path))
  if (matched.length === 0) {
    const why = out.exitCode !== 0 ? `: find says ${clip(firstLine(out.stderr), 120)}` : ''
    return item(f, where, { effect: 'nothing', summary: `Nothing matches, so nothing would be deleted${why}`, rows: notes })
  }
  const display = (real: string) => show(fromReal(ctx, real), ctx.cwd, ctx.home)
  const topmost = matched.filter(path => !matched.some(other => other !== path && within(other, path)))
  const [sizes, view] = await Promise.all([
    run(ctx, ['du', '-sk', ...topmost.slice(0, MAX_ARGS)], dirReal, LIST_MS).catch(() => undefined),
    gitView(ctx, dirReal, startReals.map(s => s.real), false),
  ])
  const bytes = sizes ? duLines(sizes.stdout).reduce((sum, [, kib]) => sum + kib * 1024, 0) : 0
  const matchedSet = new Set(matched)
  const lost = typeof view === 'object' ? [...view.changed].filter(([path, xy]) => !xy.includes('D') && matchedSet.has(path)) : []
  const lostPaths = new Set(lost.map(([path]) => path))
  const rows = [...notes, ...gitRows(view, lost, display, 'these files')]
  const sample = matched.filter(path => !lostPaths.has(path)).slice(0, MAX_ROWS)
  for (const path of sample) rows.push({ text: display(path), tone: 'subtle' })
  if (!sizes) rows.push({ text: 'Could not add up the size.', tone: 'warning' })
  if (out.exitCode !== 0) rows.push({ text: 'find could not read everything, so it may delete more than this.', tone: 'warning' })
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

async function clean(ctx: Ctx, f: Finding, where: string, notes: LastLookRow[], dir: string, git: { flags: string[]; excludes: string[]; paths: Word[] }): Promise<LastLookItem> {
  const unknownPath = git.paths.find(w => !w.known)
  if (unknownPath) return unmeasured(f, where, `it names ${unknownPath.raw}, which is only known when it runs`, notes)
  // The same clean as a dry run: -n lists, it never removes.
  const args = ['clean', '-n', ...git.flags.map(flag => `-${flag}`), ...git.excludes.flatMap(e => ['-e', e]), '--', ...git.paths.map(w => w.text)]
  const out = await gitRun(ctx, dir, args)
  if (out.exitCode !== 0) {
    if (/not a git repository/i.test(out.stderr)) return item(f, where, { effect: 'nothing', summary: 'Not in a git repository, so git clean would fail', rows: notes })
    return unmeasured(f, where, `git clean -n failed: ${clip(firstLine(out.stderr), 120)}`, notes)
  }
  const names = out.stdout.split('\n').flatMap(line => (line.startsWith('Would remove ') ? [line.slice('Would remove '.length)] : []))
  if (names.length === 0) return item(f, where, { effect: 'nothing', summary: 'Nothing to clean', rows: notes })
  return remove(ctx, f, where, notes, dir, names.map(name => ({ abs: join(dir, name), slash: false })))
}

async function overwrite(ctx: Ctx, f: Finding, where: string, notes: LastLookRow[], dir: string): Promise<LastLookItem> {
  const paths = await expand(ctx, dir, f.targets)
  if (typeof paths === 'string') return unmeasured(f, where, paths, notes)
  const path = paths[0]
  if (!path) return unmeasured(f, where, 'it names no file', notes)
  const found = await stat(ctx, path.abs)
  const name = show(path.abs, ctx.cwd, ctx.home)
  if (!found) return item(f, where, { effect: 'nothing', summary: `Creates ${name}; nothing is overwritten`, rows: notes })
  if (found.kind !== 'file') return item(f, where, { effect: 'nothing', summary: `${name} is not a plain file, so nothing is overwritten`, rows: notes })
  const real = found.realPath ?? path.abs
  if (allowed(ctx, [{ abs: path.abs, real }])) return allowedItem(f, where, notes)

  const view = await gitView(ctx, dir, [real], true)
  const rows = [...notes]
  let unsaved = 0
  if (view === 'none') rows.push({ text: 'Not in a git repository: its old contents would be gone for good.', tone: 'warning' })
  else if (view === 'failed') rows.push({ text: 'git status failed, so unsaved work could not be checked.', tone: 'warning' })
  else {
    const xy = view.changed.get(real)
    if (xy !== undefined && !xy.includes('D')) {
      unsaved = 1
      rows.push({ text: `It has unsaved work git cannot bring back (${describe(xy)}).`, tone: 'error' })
    } else if (view.tracked?.has(real)) rows.push({ text: 'git can restore it as last committed.', tone: 'subtle' })
    else rows.push({ text: 'git ignores it: its old contents would be gone for good.', tone: 'warning' })
  }
  return item(f, where, { summary: `Overwrites ${name} (${size(found.size)})`, rows, files: 1, bytes: found.size, unsaved })
}

// ---------------------------------------------------------------- git

async function discard(ctx: Ctx, f: Finding, where: string, notes: LastLookRow[], dir: string): Promise<LastLookItem> {
  const git = f.git
  const top = await gitRun(ctx, dir, ['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) return item(f, where, { effect: 'nothing', summary: 'Not in a git repository, so git would refuse it', rows: notes })
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
      const name = git.paths[0]?.text ?? ''
      const isRef = (await gitRun(ctx, dir, ['rev-parse', '--verify', '--quiet', `${name}^{commit}`])).exitCode === 0
      if (isRef) return item(f, where, { effect: 'nothing', summary: `Switches to ${name}; git refuses a switch that would lose changes`, rows: notes })
    }
    if (git.mode !== 'all') specs = ['--', ...git.paths.map(w => w.text)]
    fromIndex = git.fromIndex && git.mode !== 'all'
  } else return unmeasured(f, where, 'unexpected git form', notes)

  if (ref !== undefined && ref !== 'HEAD') {
    const known = await gitRun(ctx, dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    if (known.exitCode !== 0) return item(f, where, { effect: 'nothing', summary: `git cannot find ${ref}, so the reset would fail`, rows: notes })
  }
  const dropsCommits = ref !== undefined && ref !== 'HEAD'
  const [status, numstat, branch, dropped, log] = await Promise.all([
    gitRun(ctx, dir, ['status', '--porcelain=v1', '-z', '--untracked-files=no', ...specs]),
    gitRun(ctx, dir, ['diff', '--numstat', '--no-ext-diff', '--no-textconv', ...(fromIndex ? [] : ['HEAD']), ...specs]),
    gitRun(ctx, dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    dropsCommits ? gitRun(ctx, dir, ['rev-list', '--count', `${ref}..HEAD`]) : undefined,
    dropsCommits ? gitRun(ctx, dir, ['log', '--format=%h %s', '-n', '8', `${ref}..HEAD`]) : undefined,
  ])
  if (status.exitCode !== 0) return unmeasured(f, where, `git status failed: ${clip(firstLine(status.stderr), 120)}`, notes)
  const changes = [...porcelain(status.stdout, root)].filter(([, xy]) => (fromIndex ? xy[1] !== ' ' : true))
  const lines = numstatLines(numstat.stdout, root)
  const commits = dropped ? Number.parseInt(dropped.stdout.trim(), 10) || 0 : 0
  if (changes.length === 0 && commits === 0) {
    return item(f, where, { effect: 'nothing', summary: 'Nothing to lose: no uncommitted changes there', rows: notes })
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

async function push(ctx: Ctx, f: Finding, where: string, notes: LastLookRow[], dir: string): Promise<LastLookItem> {
  const git = f.git
  if (git?.sub !== 'push') return unmeasured(f, where, 'unexpected git form', notes)
  if (git.isWholeRepo) return unmeasured(f, where, 'it force-pushes many branches at once', notes)
  if (git.remote && !git.remote.known) return unmeasured(f, where, `it pushes to ${git.remote.raw}, which is only known when it runs`, notes)
  const top = await gitRun(ctx, dir, ['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) return item(f, where, { effect: 'nothing', summary: 'Not in a git repository, so the push would fail', rows: notes })

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
    const [counted, log] = await Promise.all([gitRun(ctx, dir, ['rev-list', '--count', range]), gitRun(ctx, dir, ['log', '--format=%h %an: %s', '-n', '8', range])])
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
  if (top.exitCode !== 0) return item(f, where, { effect: 'nothing', summary: 'Not in a git repository, so git would refuse it', rows: notes })
  const current = (await gitRun(ctx, dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
  const rows = [...notes]
  const deleted: string[] = []
  let total = 0
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
    const n = Number.parseInt(counted.stdout.trim(), 10) || 0
    total += n
    if (n > 0) {
      rows.push({ text: `${count(n, 'commit')} exist only on ${name}:`, tone: 'error' })
      for (const line of log.stdout.split('\n').filter(Boolean)) rows.push({ text: `  ${line}`, tone: 'subtle' })
    }
  }
  if (deleted.length === 0) return item(f, where, { effect: 'nothing', summary: 'No such branch, so nothing is deleted', rows })
  if (total > 0) rows.push({ text: 'git reflog can still find them for a while.', tone: 'subtle' })
  const summary = total > 0 ? `Deletes ${list(deleted)}: ${count(total, 'commit')} exist nowhere else` : `Deletes ${list(deleted)}; every commit is also on another branch`
  return item(f, where, { summary, tone: total > 0 ? 'error' : 'warning', rows, commits: total })
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
  const live = items.filter(i => i.effect !== 'nothing' && !i.isAllowed)
  const total = (key: 'unsaved' | 'commits' | 'files' | 'bytes') => live.reduce((sum, i) => sum + i[key], 0)
  const unsaved = total('unsaved')
  const commits = total('commits')
  if (unsaved > 0) return { headline: `${count(unsaved, 'file')} ${unsaved === 1 ? 'has' : 'have'} unsaved work you would lose`, headlineTone: 'error' }
  if (commits > 0) return { headline: `${count(commits, 'commit')} would be lost`, headlineTone: 'error' }
  if (live.some(i => i.effect === 'unknown')) return { headline: 'Could not measure all of it: review it yourself', headlineTone: 'warning' }
  const files = total('files')
  if (files > 0) return { headline: `It would delete or overwrite ${count(files, 'file')} (${size(total('bytes'))})`, headlineTone: 'warning' }
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
}

function blank(title: string): LastLookItem {
  return { title, effect: 'some', summary: '', summaryTone: 'normal', rows: [], moreRows: 0, files: 0, bytes: 0, unsaved: 0, commits: 0, isAllowed: false }
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
  }
}

function unmeasured(f: Finding, where: string | undefined, why: string, rows: LastLookRow[] = []): LastLookItem {
  return item(f, where, { effect: 'unknown', summary: COULD_NOT, tone: 'warning', rows: [{ text: capitalize(`${why}.`), tone: 'subtle' }, ...rows] })
}

function allowedItem(f: Finding, where: string, notes: LastLookRow[]): LastLookItem {
  return item(f, where, { summary: 'Inside your alwaysAllow folders', rows: notes, isAllowed: true })
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
