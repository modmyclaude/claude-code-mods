// The world beneath cloakroom in a test: a project folder and a home folder in
// memory, a clock that moves only when told, and records of what the mod
// showed, wrote and submitted. Nothing here decides an outcome: each test
// puts its inputs in and reads what the mod did with them.

import type { FsEntry, On, RenderSurface, ToolCallResult } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

export const ROOT = '/work/app'
export const HOME = '/home/me'
/** 2026-10-09 09:00 UTC. */
export const T0 = Date.UTC(2026, 9, 9, 9, 0, 0)

export const SURFACES = ['terminal', 'desktop'] as const

/** What the band above the prompt is handed by a surface. */
export const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 11 },
  view: {},
}

export const PERSON = { wait: false, origin: { kind: 'composer' } } as const

export type World = {
  files: Record<string, string>
  /** Paths written, in order. */
  writes: string[]
  /** Paths read, in order. */
  reads: string[]
  toasts: string[]
  /** Prompts the mod itself submitted. */
  submitted: string[]
  clock: MockClock
  /** What the tool beneath was handed, per call, in order. */
  ran: { tool: string; input: Record<string, unknown> }[]
  /** The next tool answer, per tool name (default: an empty Bash result). */
  answer: Record<string, (input: Record<string, unknown>) => ToolCallResult>
  surfaces: RenderSurface[]
  /** Store writes: cloakroom must make none. */
  persisted: string[]
  /** Cached prompt parts the mod asked the engine to compute again. */
  invalidated: string[]
  /** Paths that exist but cannot be read. */
  unreadable: Set<string>
  /** Panes the mod opened, by id, in order. */
  opened: string[]
  /** Whether a pane opened now is drawn. */
  isPanePlaced: boolean
}

export function world(on: On, files: Record<string, string> = {}): World {
  const w: World = {
    files: { ...files },
    writes: [],
    reads: [],
    toasts: [],
    submitted: [],
    clock: mock.clock(on, { now: T0 }),
    ran: [],
    answer: {},
    surfaces: ['terminal'],
    persisted: [],
    invalidated: [],
    unreadable: new Set(),
    opened: [],
    isPanePlaced: true,
  }
  mock.env(on, { HOME })

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: w.surfaces }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: w.isPanePlaced ? { isPlaced: true } : { isPlaced: false, reason: 'no room' } }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  // The kit redraws for a render's invalidate; the cached prompt parts are the engine's.
  on('ui.invalidate', { event: ['prompt.attachment', 'prompt.context'] }, ($, e) => {
    w.invalidated.push(e.event)
    return { value: undefined }
  })
  on('store.set', ($, e) => {
    w.persisted.push(`store:${e.key}`)
    return { value: undefined }
  })

  const isDir = (path: string) => Object.keys(w.files).some(f => f.startsWith(path.replace(/\/$/, '') + '/'))
  on('fs.exists', ($, e) => ({ value: e.path in w.files || isDir(e.path) }))
  on('fs.read', ($, e) => {
    w.reads.push(e.path)
    if (w.unreadable.has(e.path)) return { deny: `EACCES: permission denied ${e.path}` }
    const text = w.files[e.path]
    return text === undefined ? { deny: `ENOENT: no such file ${e.path}` } : { value: text }
  })
  on('fs.write', ($, e) => {
    w.writes.push(e.path)
    w.files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.list', ($, e) => {
    const dir = e.path.replace(/\/$/, '')
    if (!isDir(dir)) return { deny: `ENOENT: no such directory ${dir}` }
    const seen = new Map<string, FsEntry>()
    for (const [path, text] of Object.entries(w.files)) {
      if (!path.startsWith(dir + '/')) continue
      const [name, ...deeper] = path.slice(dir.length + 1).split('/')
      if (!name || seen.has(name)) continue
      seen.set(
        name,
        deeper.length > 0
          ? { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false }
          : { name, kind: 'file', size: text.length, mtimeMs: mtimeOf(name), isLink: false },
      )
    }
    return { value: [...seen.values()] }
  })

  // What is beneath the band: another mod's, or the engine's. cloakroom draws above it.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key="below">
        <Text>another mod's band</Text>
      </Box>
    )
  })

  // The engine's own end of the prompt and the tools.
  on('prompt.submit', ($, e) => {
    if (e.origin.kind === 'plugin') w.submitted.push(e.text)
    return { text: e.text }
  })
  on('tool.call', ($, e) => {
    const { tool, tool_use_id: _id, ...input } = e as Record<string, unknown>
    const name = String(tool)
    w.ran.push({ tool: name, input })
    const answer = w.answer[name]
    if (answer) return answer(input)
    return bash('')
  })
  return w
}

/** A transcript's date can ride in its name in these tests: `2026-09-12_<id>.jsonl`. */
function mtimeOf(name: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(name)
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : T0
}

/** A Bash tool answer, as core hands one back: its record and the text the model reads. */
export function bash(stdout: string, stderr = ''): ToolCallResult {
  return { result: { stdout, stderr, interrupted: false }, text: stdout + (stderr ? `\n${stderr}` : '') }
}

/** session.start for the project at ROOT, as the engine raises it. */
export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

/** `/cloakroom <args>` typed at the prompt. */
export async function cloakroom($: Engine, args = ''): Promise<string> {
  const ran = await $.command.run({
    command: 'cloakroom',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 140 },
  })
  return ran.text ?? ''
}

/** The audit pane's lines, as the person sees them. */
export async function auditPane($: Engine, surface: RenderSurface = 'terminal'): Promise<string[]> {
  const ui = await $.ui.mount({
    plugin: 'cloakroom',
    surface,
    component: 'Pane',
    requestId: 'cloakroom-audit',
    props: { title: 'Cloakroom audit', isFocused: true, bodyColumns: 140, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
  })
  const lines = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()
  return lines
}

/** Runs one Bash command through every plugin, as the model's call is run. */
export function runBash($: Engine, command: string): Promise<ToolCallResult> {
  return $.tool.call({ tool: 'Bash', command })
}

/** The stdout the model reads from a Bash answer the mod returned. */
export function stdoutOf(ran: ToolCallResult): string {
  return String((ran.result as { stdout?: unknown } | undefined)?.stdout ?? '')
}

export const TICKET = /\[secret:[A-Z0-9_]{1,48}#[a-z2-7]{6}\]/
export const TICKETS = /\[secret:[A-Z0-9_]{1,48}#[a-z2-7]{6}\]/g
