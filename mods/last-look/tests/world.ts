// A small fake machine for the tests: files, a git repo, and the read-only
// commands last-look measures with (find, du, git ...). It answers both as a
// Probe (unit tests of measure.ts) and as the engine's nouns beneath the
// plugin (`on(...)` hooks for the end-to-end tests). Every command the mod
// runs is recorded, so a test can prove it only ever ran read-only ones.

import type { FsEntry, FsStat, On, ProcessRunResult, RenderSurface } from 'claude-code'

import type { Probe } from '../hooks/measure'
import { globSegment, join, within } from '../hooks/paths'

export type FakeFile = { size: number; git?: 'clean' | 'modified' | 'staged' | 'untracked' | 'ignored' }

export type WorldSpec = {
  cwd?: string
  home?: string
  /** The repo's top; defaults to cwd; null for no repo at all. */
  repo?: string | null
  /** Paths relative to cwd, or absolute. */
  files?: Record<string, FakeFile>
  dirs?: string[]
  git?: {
    branch?: string
    /** Refs that resolve: `HEAD~2`, `refs/remotes/origin/main`, `refs/heads/feature`. */
    refs?: string[]
    /** `A..B` ranges, and `only:<branch>` for commits on one branch alone. */
    ranges?: Record<string, string[]>
    upstream?: string
    fetchedAt?: number
  }
  /** Commands that fail to start (argv joined by spaces is tested). */
  fail?: RegExp
  surfaces?: RenderSurface[]
  /** What `$.ui.open` answers: the pane placed, or left waiting. */
  isPanePlaced?: boolean
  /** Paths that exist but cannot be stat'ed (permission denied). */
  unreadable?: string[]
  /** `$.session.cwd()` is refused: the mod itself fails mid-hook. */
  isCwdBroken?: boolean
}

export const NOW = 1_800_000_000_000

export type World = ReturnType<typeof makeWorld>

const ok = (stdout = '', exitCode = 0, stderr = ''): ProcessRunResult => ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

export function makeWorld(spec: WorldSpec = {}) {
  const cwd = spec.cwd ?? '/work/app'
  const home = spec.home ?? '/Users/me'
  const repo = spec.repo === undefined ? cwd : spec.repo
  const files = new Map<string, FakeFile>()
  for (const [path, file] of Object.entries(spec.files ?? {})) files.set(join(cwd, path), file)
  const dirs = new Set<string>(['/'])
  const addDir = (dir: string) => {
    for (let d = dir; d !== '/'; d = d.slice(0, d.lastIndexOf('/')) || '/') dirs.add(d)
  }
  for (const path of files.keys()) addDir(path.slice(0, path.lastIndexOf('/')) || '/')
  for (const dir of spec.dirs ?? []) addDir(join(cwd, dir))
  addDir(cwd)
  addDir(home)
  if (repo) addDir(repo)

  const calls: string[][] = []
  const git = spec.git ?? {}
  const refs = new Set(['HEAD', ...(git.refs ?? [])])
  const ranges = git.ranges ?? {}

  const stat = (path: string): FsStat | undefined => {
    const p = join('/', path)
    const file = files.get(p)
    if (file) return { kind: 'file', size: file.size, mtimeMs: 0, isLink: false, realPath: p }
    if (dirs.has(p)) return { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: p }
    if (repo && p === `${repo}/.git/FETCH_HEAD` && git.fetchedAt !== undefined) return { kind: 'file', size: 10, mtimeMs: git.fetchedAt, isLink: false, realPath: p }
    return undefined
  }
  const list = (path: string): FsEntry[] => {
    const p = join('/', path)
    const names = new Map<string, FsEntry>()
    const prefix = p === '/' ? '/' : `${p}/`
    for (const f of files.keys()) {
      if (!f.startsWith(prefix)) continue
      const name = f.slice(prefix.length).split('/')[0] ?? ''
      const isFile = !f.slice(prefix.length).includes('/')
      names.set(name, { name, kind: isFile ? 'file' : 'dir', size: isFile ? (files.get(f)?.size ?? 0) : 0, mtimeMs: 0, isLink: false })
    }
    for (const d of dirs) {
      if (d.startsWith(prefix) && d !== p && !d.slice(prefix.length).includes('/')) {
        const name = d.slice(prefix.length)
        names.set(name, { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
      }
    }
    return [...names.values()]
  }
  const under = (start: string): string[] => [...files.keys()].filter(f => within(start, f))
  const rel = (path: string, from: string) => (path === from ? '.' : path.slice(from === '/' ? 1 : from.length + 1))

  const gitFiles = (dir: string, specs: string[], include: (f: FakeFile) => boolean): string[] => {
    if (!repo) return []
    const scopes = specs.length === 0 ? [repo] : specs.map(s => join(dir, s))
    return [...files.entries()].filter(([path, f]) => within(repo, path) && include(f) && scopes.some(s => within(s, path))).map(([path]) => path)
  }
  const status = (f: FakeFile) => (f.git === 'modified' ? ' M' : f.git === 'staged' ? 'M ' : f.git === 'untracked' ? '??' : '')

  const runGit = (argv: string[], dir: string): ProcessRunResult => {
    let k = 1
    while (argv[k] === '-c' || argv[k] === '--literal-pathspecs') k += argv[k] === '-c' ? 2 : 1
    const sub = argv[k] ?? ''
    const args = argv.slice(k + 1)
    const dash = args.indexOf('--')
    const specs = dash === -1 ? [] : args.slice(dash + 1)
    if (!repo || !within(repo, dir)) return ok('', 128, 'fatal: not a git repository (or any of the parent directories): .git')
    if (sub === 'rev-parse') {
      if (args[0] === '--show-toplevel') return ok(`${repo}\n`)
      if (args[0] === '--git-path') return ok(`${repo}/.git/${args[1] ?? ''}\n`)
      if (args.includes('--symbolic-full-name')) return git.upstream ? ok(`${git.upstream}\n`) : ok('', 128, 'fatal: no upstream configured')
      if (args[0] === '--abbrev-ref') return ok(`${git.branch ?? 'main'}\n`)
      if (args[0] === '--verify') {
        const ref = (args[2] ?? '').replace(/\^\{commit\}$/, '')
        return refs.has(ref) ? ok('0123456789abcdef\n') : ok('', 1)
      }
    }
    if (sub === 'status') {
      const withUntracked = args.includes('--untracked-files=all')
      const changed = gitFiles(dir, specs, f => status(f) !== '' && (withUntracked || f.git !== 'untracked'))
      return ok(changed.map(path => `${status(files.get(path) ?? { size: 0 })} ${rel(path, repo)}\0`).join(''))
    }
    if (sub === 'ls-files') {
      const tracked = gitFiles(dir, specs, f => f.git === 'clean' || f.git === 'modified' || f.git === 'staged')
      return ok(tracked.map(path => `${rel(path, repo)}\0`).join(''))
    }
    if (sub === 'diff') {
      const changed = gitFiles(dir, specs, f => f.git === 'modified' || f.git === 'staged')
      return ok(changed.map(path => `3\t1\t${rel(path, repo)}\n`).join(''))
    }
    if (sub === 'rev-list' || sub === 'log') {
      const wanted = args.find(a => a.includes('..')) ?? (args.includes('--not') ? `only:${(args.find(a => a.startsWith('refs/heads/')) ?? '').slice('refs/heads/'.length)}` : '')
      const lines = ranges[wanted] ?? []
      return sub === 'log' ? ok(lines.map(l => `${l}\n`).join('')) : ok(`${lines.length}\n`)
    }
    if (sub === 'clean') {
      if (!args.includes('-n')) throw new Error(`fake world: git clean without -n would delete: ${argv.join(' ')}`)
      const withIgnored = args.includes('-x') || args.includes('-X')
      const doomed = gitFiles(dir, specs, f => f.git === 'untracked' || (withIgnored && f.git === 'ignored'))
      return ok(doomed.map(path => `Would remove ${rel(path, dir)}\n`).join(''))
    }
    return ok('', 1, `fake world: unknown git ${sub}`)
  }

  const runFind = (argv: string[], dir: string): ProcessRunResult => {
    const args = argv.slice(1)
    let k = 0
    const starts: string[] = []
    while (k < args.length && !(args[k] ?? '').startsWith('-')) starts.push(args[k++] ?? '')
    const expr = args.slice(k)
    if (expr.includes('-delete') || expr.includes('-exec')) throw new Error(`fake world: a find that deletes: ${argv.join(' ')}`)
    const onlyFiles = expr.join(' ').includes('-type f')
    const nameAt = expr.indexOf('-name')
    const name = nameAt >= 0 ? globSegment(expr[nameAt + 1] ?? '*') : undefined
    const out: string[] = []
    let exitCode = 0
    for (const start of starts.length > 0 ? starts : ['.']) {
      const abs = join(dir, start)
      if (!stat(abs)) {
        exitCode = 1
        continue
      }
      const found = [...(onlyFiles ? [] : [...dirs].filter(d => within(abs, d))), ...under(abs)]
      for (const path of found) {
        if (name && !name.test(path.slice(path.lastIndexOf('/') + 1))) continue
        out.push(path === abs ? start : `${start.replace(/\/$/, '')}/${path.slice(abs.length + 1)}`)
      }
    }
    return ok(out.map(p => `${p}\0`).join(''), exitCode, exitCode ? 'find: No such file or directory' : '')
  }

  const runDu = (argv: string[], dir: string): ProcessRunResult => {
    const lines = argv.slice(2).flatMap(path => {
      const abs = join(dir, path)
      if (!stat(abs)) return []
      const bytes = under(abs).reduce((sum, f) => sum + (files.get(f)?.size ?? 0), 0)
      return [`${Math.ceil(bytes / 1024)}\t${path}\n`]
    })
    return ok(lines.join(''))
  }

  const run = async (argv: readonly string[], dir: string): Promise<ProcessRunResult> => {
    calls.push([...argv])
    if (spec.fail?.test(argv.join(' '))) throw new Error(`fake world: ${argv[0]} cannot start`)
    const [program] = argv
    if (program === 'sleep') {
      await new Promise<void>(resolve => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(resolve, 15))
      return ok()
    }
    if (program === 'git') return runGit([...argv], dir)
    if (program === 'find') return runFind([...argv], dir)
    if (program === 'du') return runDu([...argv], dir)
    throw new Error(`fake world: no such command ${program}`)
  }

  const probe: Probe = {
    run: (argv, dir) => run(argv, dir),
    stat: async path => stat(path),
    list: async path => {
      if (!stat(path)) throw new Error('ENOENT')
      return list(path)
    },
  }

  /** Answers every noun last-look reaches, beneath the plugin. */
  const install = (on: On) => {
    const seen = { opened: [] as string[], openArgs: [] as Record<string, unknown>[], closed: [] as string[], status: [] as (string | undefined)[], logs: [] as string[] }
    on('process.run', async (_$, e) => ({ value: await run(e.argv, e.init?.cwd ?? cwd) }))
    on('fs.stat', async (_$, e) => {
      if ((spec.unreadable ?? []).some(p => join(cwd, p) === join('/', e.path))) return { deny: `EACCES: ${e.path}` }
      const found = stat(e.path)
      return found ? { value: found } : { deny: `ENOENT: ${e.path}` }
    })
    on('fs.list', async (_$, e) => (stat(e.path) ? { value: list(e.path) } : { deny: `ENOENT: ${e.path}` }))
    on('fs.exists', (_$, e) => ({ value: stat(e.path) !== undefined || (spec.unreadable ?? []).some(p => join(cwd, p) === join('/', e.path)) }))
    on('session.cwd', () => (spec.isCwdBroken ? { deny: 'session is gone' } : { value: cwd }))
    on('session.root', () => ({ value: cwd }))
    on('session.surfaces', () => ({ value: spec.surfaces ?? ['terminal'] }))
    on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? home : undefined }))
    on('clock.now', () => ({ value: NOW }))
    on('ui.open', (_$, e) => {
      seen.opened.push(e.id)
      seen.openArgs.push({ ...e })
      return { value: spec.isPanePlaced === false ? { isPlaced: false as const, reason: 'narrow terminal' } : { isPlaced: true as const } }
    })
    on('ui.close', (_$, e) => {
      seen.closed.push(e.id)
      return { value: undefined }
    })
    on('ui.status', (_$, e) => {
      seen.status.push(e.text)
      return { value: undefined }
    })
    on('ui.log', (_$, e) => {
      seen.logs.push(e.text)
      return { value: undefined }
    })
    return seen
  }

  return { cwd, home, repo, calls, probe, install, stat }
}

/**
 * The commands last-look may run: nothing here writes. find never with
 * -delete or -exec, git only its reading subcommands, clean only with -n.
 */
export function isReadOnly(argv: readonly string[]): boolean {
  const [program, ...rest] = argv
  if (program === 'sleep' || program === 'du') return true
  if (program === 'powershell') return rest.join(' ').includes('Start-Sleep')
  if (program === 'find') return !rest.some(a => ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls'].includes(a))
  if (program === 'git') {
    let k = 0
    while (rest[k] === '-c' || rest[k] === '--literal-pathspecs') k += rest[k] === '-c' ? 2 : 1
    const sub = rest[k] ?? ''
    if (sub === 'clean') return rest.includes('-n') && !rest.some(a => /^-[a-zA-Z]*f/.test(a) || a === '--force')
    return ['rev-parse', 'status', 'ls-files', 'diff', 'rev-list', 'log'].includes(sub)
  }
  return false
}
