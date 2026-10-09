// The world beneath footprints in a test: a project folder, a fake git that
// answers the exact read-only commands the mod runs (from the files below,
// never from what a test expects), a file system of names and mtimes, the
// tools Claude calls, and the engine's panes, toasts and status line, each
// recorded so a test reads what the mod did.
import { mock } from 'claude-code/testing'
import type { On, ProcessRunResult, RenderPropsOf, ToolCallResult, UiOpenResult } from 'claude-code'

export const PLUGIN = 'footprints'
export const PANE = 'footprints'
export const ROOT = '/work/proj'
export const SURFACES = ['terminal', 'desktop'] as const
export const T0 = 1_700_000_000_000
const HEAD_A = 'a'.repeat(40)

export type Setup = {
  /** Tracked files, relative to ROOT; all clean at the start. */
  tracked?: string[]
  /** Untracked, not-ignored files. */
  untracked?: string[]
  /** Ignored files: on disk, never in git's lists. */
  ignored?: string[]
  /** False: ROOT is no git work tree. */
  isGit?: boolean
  /** Whether a pane the mod opens is placed, and why not. */
  placed?: boolean
  /** The real path ROOT leads to, when a link leads there. */
  realRoot?: string
  /** Absolute paths outside ROOT that exist and can be read. */
  extern?: string[]
  /** True: the session's root and every process fail beneath the mod. */
  failing?: boolean
  /** How long each `git status` takes on the mocked clock (0 when not given). */
  statusMs?: number
  /** True: each `git status` fails once its time is up, as a timed-out run does. */
  statusTimesOut?: boolean
}

export type World = ReturnType<typeof world>

export function world(on: On, setup: Setup = {}) {
  const clock = mock.clock(on, { now: T0 })
  const isGit = setup.isGit ?? true
  // The disk: every file's mtime, by path relative to ROOT. Absent = no such file.
  const disk = new Map<string, number>()
  const tracked = new Set(setup.tracked ?? [])
  // Git's index: what HEAD and the index hold, as a path -> version stamp.
  const committed = new Map<string, number>()
  for (const path of [...(setup.tracked ?? []), ...(setup.untracked ?? []), ...(setup.ignored ?? [])]) disk.set(path, T0 - 60_000)
  for (const path of tracked) committed.set(path, T0 - 60_000)
  const staged = new Map<string, number | null>() // path -> staged stamp (null = staged delete)
  const ignored = new Set(setup.ignored ?? [])
  let head = HEAD_A
  let commits = 0

  const rec = {
    argv: [] as string[][],
    statuses: [] as (string | undefined)[],
    toasts: [] as string[],
    logs: [] as string[],
    opens: [] as string[],
    registered: [] as { name: string; immediate?: true }[],
    panes: [] as { id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }[],
    /** What each tool call reached beneath the mod, in order. */
    tools: [] as string[],
  }

  // ---- the fake git: porcelain v2 and ls-files from the state above

  const xy = (path: string): string | undefined => {
    if (ignored.has(path)) return undefined
    const onDisk = disk.get(path)
    const base = committed.get(path)
    const stage = staged.has(path) ? staged.get(path) : base
    if (base === undefined && stage === undefined) return onDisk === undefined ? undefined : '??'
    const x = stage === base ? '.' : stage === null ? 'D' : base === undefined ? 'A' : 'M'
    const indexVersion = stage ?? undefined
    const y = onDisk === undefined ? (stage === null ? '.' : 'D') : onDisk === indexVersion ? '.' : 'M'
    return x === '.' && y === '.' ? undefined : x + y
  }

  const porcelain = (): string => {
    const paths = new Set([...disk.keys(), ...committed.keys(), ...staged.keys()])
    const out = [`# branch.oid ${head}`, '# branch.head main']
    for (const path of [...paths].sort()) {
      const code = xy(path)
      if (code === undefined) continue
      out.push(code === '??' ? `? ${path}` : `1 ${code} N... 100644 100644 100644 ${'0'.repeat(40)} ${'0'.repeat(40)} ${path}`)
    }
    return `${out.join('\0')}\0`
  }

  const lsFiles = (): string => {
    const cached = [...new Set([...committed.keys(), ...[...staged].filter(([, v]) => v !== null).map(([p]) => p)])]
    const others = [...disk.keys()].filter(p => !committed.has(p) && !staged.has(p) && !ignored.has(p))
    return [...others, ...cached].map(p => `${p}\0`).join('')
  }

  const ok = (stdout: string): ProcessRunResult => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  const fail = (stderr: string): ProcessRunResult => ({ exitCode: 128, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false })

  on('process.run', async ($, e) => {
    if (setup.failing) throw new Error('no processes here')
    rec.argv.push([...e.argv])
    const args = e.argv.join(' ')
    if (args.includes(' status ') && setup.statusMs) await clock.sleep(setup.statusMs)
    if (args.includes(' status ') && setup.statusTimesOut) throw new Error('timed out')
    if (e.argv[0] !== 'git') return { value: fail('not git') }
    if (!isGit) return { value: fail('fatal: not a git repository') }
    if (args.includes(' rev-parse ')) return { value: ok(`${setup.realRoot ?? ROOT}\n\n`) }
    // git's own pathspec rule for `:(...exclude,glob)**/<dir>/**`: drop any path under a folder named <dir>
    const after = e.argv.indexOf('--')
    const excluded = (after < 0 ? [] : e.argv.slice(after + 1))
      .map(spec => /^:\([^)]*exclude[^)]*\)\*\*\/([^/*]+)\/\*\*$/.exec(spec)?.[1])
      .filter((dir): dir is string => dir !== undefined)
    const keep = (path: string) => !path.split('/').some(part => excluded.includes(part))
    const only = (out: string) => out.split('\0').filter(entry => entry.startsWith('#') || keep(entry.replaceAll(' ', '/'))).join('\0')
    if (args.includes(' status ')) return { value: ok(only(porcelain())) }
    if (args.includes(' ls-files ')) return { value: ok(only(lsFiles())) }
    return { value: fail(`unexpected: ${args}`) }
  })

  // ---- the file system: names and mtimes only

  const relOf = (path: string): string | undefined => {
    for (const root of [ROOT, setup.realRoot].filter((r): r is string => r !== undefined)) {
      if (path === root) return ''
      if (path.startsWith(`${root}/`)) return path.slice(root.length + 1)
    }
    return undefined
  }
  const isDir = (rel: string): boolean => rel === '' || [...disk.keys()].some(p => p.startsWith(`${rel}/`))

  on('session.root', () => {
    if (setup.failing) throw new Error('root unavailable')
    return { value: ROOT }
  })
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.stat', ($, e) => {
    const rel = relOf(e.path)
    if (rel === undefined) return { deny: `ENOENT: ${e.path}` }
    const mtime = disk.get(rel)
    if (mtime !== undefined) return { value: { kind: 'file', size: 1, mtimeMs: mtime, isLink: false } }
    if (isDir(rel)) {
      return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, ...(e.resolve ? { realPath: setup.realRoot && rel === '' ? setup.realRoot : e.path } : {}) } }
    }
    return { deny: `ENOENT: ${e.path}` }
  })
  on('fs.exists', ($, e) => {
    const rel = relOf(e.path)
    return { value: rel !== undefined && (disk.has(rel) || isDir(rel)) }
  })
  on('fs.list', ($, e) => {
    const rel = relOf(e.path) ?? ''
    const prefix = rel === '' ? '' : `${rel}/`
    const names = new Map<string, 'file' | 'dir'>()
    for (const path of disk.keys()) {
      if (!path.startsWith(prefix)) continue
      const [first, ...rest] = path.slice(prefix.length).split('/')
      if (first) names.set(first, rest.length > 0 ? 'dir' : 'file')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 0, isLink: false })) }
  })

  // ---- the engine: panes, toasts, status, commands, sessions

  const placed = setup.placed ?? true
  on('ui.toast', ($, e) => (rec.toasts.push(e.text), { value: undefined }))
  on('ui.log', ($, e) => (rec.logs.push(e.text), { value: undefined }))
  on('ui.status', ($, e) => (rec.statuses.push(e.text), { value: undefined }))
  on('ui.open', ($, e) => {
    rec.opens.push(e.id)
    rec.panes = [...rec.panes.filter(p => p.id !== e.id), { id: e.id, title: e.title ?? e.id, isShown: placed, isFocused: false, isPlaced: placed }]
    const value: UiOpenResult = placed ? { isPlaced: true } : { isPlaced: false, reason: 'no surface attached that places panes' }
    return { value }
  })
  on('ui.panes', () => ({ value: rec.panes }))
  on('command.register', ($, e) => {
    rec.registered.push({ name: e.name, ...(e.immediate === true ? { immediate: true as const } : {}) })
    return { value: { command: e.name } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))

  // ---- the tools, as core answers them; Bash runs a test-given effect on the disk

  let bash: (command: string) => void = () => {}
  let answer: (tool: string, args: Record<string, unknown>) => ToolCallResult | undefined = () => undefined
  let held: Promise<void> | undefined
  const text = (s: string) => s
  on('tool.call', async ($, e) => {
    const tool = String(e.tool)
    const args = e as unknown as Record<string, unknown>
    rec.tools.push(tool)
    if (held) await held
    const given = answer(tool, args)
    if (given) return given
    const pathArg = String(args.file_path ?? args.notebook_path ?? args.path ?? '')
    const rel = relOf(pathArg)
    if (tool === 'Read') {
      if (setup.extern?.includes(pathArg)) return { result: { type: 'text', file: { filePath: pathArg } }, text: 'x' }
      if (rel === undefined || !disk.has(rel)) return { isError: true, result: undefined, text: 'File does not exist.' } as ToolCallResult
      return { result: { type: 'text', file: { filePath: pathArg, content: 'x', numLines: 1, startLine: 1, totalLines: 1 } }, text: text('x') }
    }
    if (tool === 'Glob' || tool === 'Grep') return { result: { filenames: [], numFiles: 0 }, text: 'No files found' }
    if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
      if (rel === undefined || !disk.has(rel)) return { isError: true, result: undefined, text: 'File does not exist.' } as ToolCallResult
      disk.set(rel, clock.now())
      return { result: { filePath: pathArg }, text: 'The file has been updated.' }
    }
    if (tool === 'Write') {
      const existed = rel !== undefined && disk.has(rel)
      if (rel !== undefined) disk.set(rel, clock.now())
      return { result: { type: existed ? 'update' : 'create', filePath: pathArg }, text: 'Wrote it.' }
    }
    if (tool === 'Bash') {
      bash(String(args.command))
      return { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
    }
    return { result: {}, text: '' }
  })

  return {
    clock,
    rec,
    /** The next Bash call's effect on the disk and git, given the command line. */
    onBash(effect: (command: string) => void) {
      bash = effect
    },
    /** Answers tool calls beneath the mod in place of the default tools, where it returns a result. */
    answer(fn: (tool: string, args: Record<string, unknown>) => ToolCallResult | undefined) {
      answer = fn
    },
    /** Holds every tool call beneath the mod until the returned release runs. */
    hold(): () => void {
      let release = () => {}
      held = new Promise<void>(resolve => (release = resolve))
      return () => {
        held = undefined
        release()
      }
    },
    // Effects a Bash command can have, as the shell would leave the disk and git.
    write(path: string) {
      disk.set(path, clock.now())
    },
    remove(path: string) {
      disk.delete(path)
    },
    /** Puts the committed version back, file time and all (as `git stash` leaves a file). */
    revert(path: string) {
      const stamp = committed.get(path)
      if (stamp === undefined) disk.delete(path)
      else disk.set(path, stamp)
    },
    stage(path: string) {
      staged.set(path, disk.get(path) ?? null)
    },
    commit() {
      for (const [path, stamp] of staged) {
        if (stamp === null) committed.delete(path)
        else committed.set(path, stamp)
      }
      staged.clear()
      commits++
      head = String(commits).repeat(40).slice(0, 40)
    },
    /** `git add -A && git commit`: everything on disk (not ignored) as it stands. */
    commitAll() {
      for (const path of new Set([...disk.keys(), ...committed.keys()])) {
        if (ignored.has(path)) continue
        staged.set(path, disk.get(path) ?? null)
      }
      this.commit()
    },
  }
}

export const abs = (rel: string): string => `${ROOT}/${rel}`

export function paneProps(over: Partial<RenderPropsOf['Pane']> = {}): RenderPropsOf['Pane'] {
  return {
    title: 'Footprints', isFocused: false, bodyColumns: 60, placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 }, view: {}, ...over,
  }
}
