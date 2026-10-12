// The engine beneath mulligan in its tests: a project on a fake disk, a fake
// git and tar that keep what they saved, the Bash tool (whose effect a test
// sets), panes, toasts, the band and the rows appended for Claude.

import type { On, PromptOrigin, RenderSurface } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

export const PLUGIN = 'mulligan'
export const SURFACES = ['terminal', 'desktop'] as const
export const PERSON: PromptOrigin = { kind: 'composer' }
export const HOME = '/home/me'
export const ROOT = '/work/app'
export const T0 = Date.UTC(2026, 9, 12, 8, 0, 0)
export const SHA = 'a'.repeat(40)
export const HEAD = 'b'.repeat(40)

type Entry = { name: string; text: string }

export type World = {
  clock: MockClock
  /** The disk: absolute path to text. A tar archive's text is its entries as JSON. */
  files: Record<string, string>
  isGit: boolean
  /** Paths (relative to ROOT) git tracks, and the commits it knows: sha to tracked files' text. */
  tracked: Set<string>
  commits: Record<string, Record<string, string>>
  /** Whether the tracked files differ from HEAD (stash create answers a commit, else nothing). */
  isDirty: boolean
  /** Untracked, not ignored paths git lists (relative). */
  untracked: string[]
  /** What the Bash tool does to the disk, by command. */
  effects: Record<string, (w: World) => void>
  /** Refuse every Bash call beneath, as a safety hold would. */
  isHeld: boolean
  /** Make tar fail or hang. */
  tarFails: boolean
  /** Every process run, as `cwd: argv`. */
  runs: string[]
  /** Every path fs.write wrote. */
  writes: string[]
  /** Archives present on disk when the Bash tool ran (so a snapshot is seen to come before it). */
  seenAtRun: string[][]
  ran: string[]
  toasts: string[]
  opened: string[]
  isPanePlaced: boolean
  appended: string[]
  surfaces: RenderSurface[]
  cwd: string
  /** Lines the mod logged (its debug lines included). */
  logs: string[]
  /** git runs made without GIT_OPTIONAL_LOCKS=0, which could take the index lock under Claude. */
  lockingGit: string[]
}

const rel = (path: string) => (path === ROOT ? '' : path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path)
const abs = (cwd: string, path: string) => (path.startsWith('/') ? path : `${cwd}/${path.replace(/^\.\//, '')}`.replace(/\/\.$/, ''))

export function world(on: On): World {
  const w: World = {
    clock: mock.clock(on, { now: T0 }),
    files: {},
    isGit: true,
    tracked: new Set(),
    commits: {},
    isDirty: false,
    untracked: [],
    effects: {},
    isHeld: false,
    tarFails: false,
    runs: [],
    writes: [],
    seenAtRun: [],
    ran: [],
    toasts: [],
    opened: [],
    isPanePlaced: true,
    appended: [],
    surfaces: ['terminal'],
    cwd: ROOT,
    logs: [],
    lockingGit: [],
  }
  mock.env(on, { HOME })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('session.cwd', () => ({ value: w.cwd }))
  on('session.surfaces', () => ({ value: w.surfaces }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: w.isPanePlaced ? { isPlaced: true } : { isPlaced: false, reason: 'no room' } }
  })
  on('ui.log', ($, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  // What is beneath the band: nothing of another mod's here.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="below" />
  })
  on('session.append', ($, e, next) => {
    const block = (e.message as { content?: { text?: string }[] }).content?.[0]
    w.appended.push(String(block?.text ?? ''))
    return next(e)
  })

  const under = (dir: string) => Object.keys(w.files).filter(path => path === dir || path.startsWith(`${dir}/`))
  on('fs.exists', ($, e) => ({ value: e.path in w.files || under(e.path).length > 0 }))
  on('fs.read', ($, e) => (e.path in w.files ? { value: w.files[e.path]! } : { deny: `ENOENT ${e.path}` }))
  on('fs.write', ($, e) => {
    w.writes.push(e.path)
    w.files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.list', ($, e) => {
    const names = Object.keys(w.files).filter(path => path.startsWith(`${e.path}/`) && !path.slice(e.path.length + 1).includes('/'))
    return { value: names.map(path => ({ name: path.slice(e.path.length + 1), kind: 'file' as const, size: w.files[path]!.length, mtimeMs: 0, isLink: false })) }
  })

  const archiveOf = (path: string): Entry[] => {
    try {
      return JSON.parse(w.files[path] ?? '[]') as Entry[]
    } catch {
      return []
    }
  }
  const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  const fail = (stderr: string) => ({ value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })

  on('process.run', ($, e) => {
    const argv = [...e.argv]
    const cwd = e.init?.cwd ?? ROOT
    w.runs.push(`${rel(cwd)}: ${argv.join(' ')}`)
    const [cmd, ...args] = argv
    if (cmd === 'git') {
      if (e.init?.env?.GIT_OPTIONAL_LOCKS !== '0') w.lockingGit.push(argv.join(' '))
      if (!w.isGit) return fail('fatal: not a git repository')
      const sub = args.join(' ')
      if (sub === 'rev-parse --is-inside-work-tree') return ok('true\n')
      if (sub === 'rev-parse --verify HEAD') return ok(`${HEAD}\n`)
      if (sub === 'stash create') {
        if (!w.isDirty) return ok('')
        w.commits[SHA] = Object.fromEntries([...w.tracked].map(path => [path, w.files[`${ROOT}/${path}`] ?? '']))
        return ok(`${SHA}\n`)
      }
      if (sub.startsWith('ls-files --others')) return ok(w.untracked.map(p => `${p}\0`).join(''))
      if (args[0] === 'restore') {
        const sha = args.find(a => a.startsWith('--source='))!.slice('--source='.length)
        for (const [path, text] of Object.entries(w.commits[sha] ?? {})) w.files[`${ROOT}/${path}`] = text
        return ok()
      }
      if (args[0] === 'diff') {
        const then = w.commits[args[2]!] ?? {}
        const lines = Object.entries(then).flatMap(([path, text]) => {
          const now = w.files[`${ROOT}/${path}`]
          return now === undefined ? [`D\t${path}`] : now !== text ? [`M\t${path}`] : []
        })
        return ok(lines.join('\n'))
      }
      return fail(`unknown git ${sub}`)
    }
    if (cmd === 'mkdir') return ok()
    if (cmd === 'mv') {
      const [, from, to] = args
      w.files[to!] = w.files[from!] ?? ''
      delete w.files[from!]
      return ok()
    }
    if (cmd === 'tar') {
      const archive = args[1]!
      if (args[0] === '-cf') {
        if (w.tarFails) return fail('tar: cannot read')
        const names = args.includes('-T') ? (e.init?.stdin ?? '').split('\0').filter(Boolean) : ['.']
        const entries: Entry[] = []
        for (const name of names) {
          const base = abs(cwd, name)
          for (const path of under(base === `${ROOT}/.` ? ROOT : base)) {
            if (/\/(\.git|node_modules)(\/|$)/.test(path.slice(ROOT.length)) || path.startsWith(`${HOME}/`)) continue
            entries.push({ name: rel(path), text: w.files[path]! })
          }
        }
        w.files[archive] = JSON.stringify(entries)
        return ok()
      }
      if (args[0] === '-xf') {
        for (const entry of archiveOf(archive)) w.files[`${ROOT}/${entry.name}`] = entry.text
        return ok()
      }
      if (args[0] === '-tf') return ok(archiveOf(archive).map(entry => entry.name).join('\n'))
      if (args[0] === '-xOf') return ok(archiveOf(archive).find(entry => entry.name === args[3])?.text ?? '')
    }
    return fail(`unknown ${cmd}`)
  })

  on('tool.call', ($, e) => {
    if (e.tool !== 'Bash') return { result: {} }
    w.seenAtRun.push(Object.keys(w.files).filter(path => path.includes('/mulligan/') && path.endsWith('.tar') && w.files[path] !== ''))
    if (w.isHeld) return { deny: 'held: waiting on the person' }
    w.ran.push(e.command)
    w.effects[e.command]?.(w)
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  return w
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

export function bash($: Engine, command: string) {
  return $.tool.call({ tool: 'Bash', command })
}

export function mulligan($: Engine, args = '', origin: PromptOrigin = PERSON) {
  return $.command.run({ command: 'mulligan', args, origin, presentation: { isFullscreen: true, columns: 120 } })
}

/** The project's snapshot folder and its index, as written. */
export function folderOf(w: World): string {
  const index = Object.keys(w.files).find(path => path.startsWith(`${HOME}/.claude/mulligan/`) && path.endsWith('/index.json'))
  return index ? index.slice(0, -'/index.json'.length) : ''
}

export function indexOf(w: World): { next: number; snapshots: { n: number; command: string; scope: string; sha?: string; archive?: string; bytes: number }[] } {
  const folder = folderOf(w)
  return folder ? JSON.parse(w.files[`${folder}/index.json`]!) : { next: 1, snapshots: [] }
}

export const PANE_PROPS = { title: 'mulligan', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }

export const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} }

/** The band's text lines on a surface. */
export async function bandTexts($: Engine, surface: RenderSurface = 'terminal'): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()
  return texts
}

/** Writes a file in the project. */
export function put(w: World, path: string, text: string, isTracked = false): void {
  w.files[`${ROOT}/${path}`] = text
  if (isTracked) w.tracked.add(path)
}

export function rmTree(w: World, path: string): void {
  for (const key of Object.keys(w.files)) if (key === `${ROOT}/${path}` || key.startsWith(`${ROOT}/${path}/`)) delete w.files[key]
}
