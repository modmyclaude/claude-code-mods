// The world beneath switchboard in a test: a clock that moves only when told, a
// home folder whose ~/.claude/switchboard holds other sessions' records, and
// records of every file touched and every toast. Nothing here decides an
// outcome; each test writes the other sessions and reads what the mod did.

import type { On, RenderSurface } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import type { SessionRecord } from '../hooks/board'

export const PLUGIN = 'switchboard'
export const MIN = 60_000
export const T0 = Date.UTC(2026, 9, 12, 9, 0, 0)
export const HOME = '/home/me'
export const DIR = `${HOME}/.claude/switchboard`
export const MINE = 'aaaa1111-0000-0000-0000-000000000001'
export const SURFACES = ['terminal', 'desktop'] as const
/** Moving the mocked clock through many 5-second polls takes more than 5 s. */
export const SLOW = { timeoutMs: 30_000 }

export type World = {
  clock: MockClock
  toasts: string[]
  files: Record<string, { text: string; mtimeMs: number }>
  /** Every path the mod read, listed or wrote, in order. */
  touched: string[]
  env: Record<string, string>
  id: string
  surfaces: RenderSurface[]
  isPanePlaced: boolean
  panes: string[]
  /** What `tail` prints for this session's transcript, and every command the mod ran. */
  tail: string
  runs: string[][]
  /** Prompts in this session's transcript, as `$.session.turns()` answers. */
  turns: number
  /** Whether the open pane is shown, and every close the mod asked for. */
  isPaneShown: boolean
  closes: string[]
}

export function world(on: On): World {
  const w: World = {
    clock: mock.clock(on, { now: T0 }),
    toasts: [],
    files: {},
    touched: [],
    env: { HOME },
    id: MINE,
    surfaces: ['terminal'],
    isPanePlaced: true,
    panes: [],
    tail: '',
    runs: [],
    turns: 1,
    isPaneShown: true,
    closes: [],
  }
  on('session.turns', () => ({ value: w.turns }))
  on('ui.panes', () => ({ value: w.panes.length > 0 ? [{ id: 'switchboard', title: 'Switchboard', isShown: w.isPaneShown, isFocused: false, isPlaced: true }] : [] }))
  on('ui.close', ($, e) => {
    w.closes.push(e.id)
    w.panes = w.panes.filter(id => id !== e.id)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    w.runs.push([...e.argv])
    return { value: { exitCode: w.tail === '' ? 1 : 0, stdout: w.tail, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: w.id }))
  on('session.root', () => ({ value: '/work/api-server' }))
  on('session.surfaces', () => ({ value: w.surfaces }))
  on('env.get', ($, e) => ({ value: w.env[e.name] }))
  on('fs.write', ($, e) => {
    w.touched.push(`write ${e.path}`)
    w.files[e.path] = { text: e.text, mtimeMs: w.clock.now() }
    return { value: undefined }
  })
  on('fs.read', ($, e) => {
    w.touched.push(`read ${e.path}`)
    const file = w.files[e.path]
    return file === undefined ? { deny: `ENOENT: ${e.path}` } : { value: file.text }
  })
  on('fs.list', ($, e) => {
    w.touched.push(`list ${e.path}`)
    const dir = e.path.replace(/\/$/, '')
    const entries = Object.entries(w.files)
      .filter(([path]) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/'))
      .map(([path, file]) => ({ name: path.slice(dir.length + 1), kind: 'file' as const, size: file.text.length, mtimeMs: file.mtimeMs, isLink: false }))
    return entries.length === 0 ? { deny: `ENOENT: ${dir}` } : { value: entries }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', ($, e) => {
    w.panes.push(e.id)
    return { value: w.isPanePlaced ? { isPlaced: true } : { isPlaced: false, reason: 'no room' } }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.attach', () => ({ clientId: 'c1' }))
  on('tool.call', () => ({ result: 'ok' }))
  on('classic.SessionStart', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.Notification', () => ({}))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="other-mod">another mod's line</Text>
  })
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.modes.join(' & ')}</Text>
  })
  return w
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/work/api-server', surface: 'terminal', isInteractive: true })
}

/** Another session's record on disk, as that session would write it (active a moment before `since` unless told otherwise). */
export function other(w: World, id: string, name: string, state: SessionRecord['state'], since: number, more: Partial<SessionRecord> = {}): void {
  const record: SessionRecord = { v: 1, id, name, state, since, updatedAt: since, where: 'terminal', lastActiveAt: since, ...more }
  w.files[`${DIR}/${id}.json`] = { text: JSON.stringify(record), mtimeMs: record.updatedAt }
}

/** A transcript's last lines as Claude Code writes them: a title the person set, one it wrote, and talk in between. */
export function transcriptTail(titles: { custom?: string; ai?: string }): string {
  const lines = ['art of a line the tail cut"}', JSON.stringify({ type: 'user', message: { content: 'secret words' } })]
  if (titles.ai !== undefined) lines.push(JSON.stringify({ type: 'ai-title', aiTitle: titles.ai, sessionId: MINE }))
  if (titles.custom !== undefined) lines.push(JSON.stringify({ type: 'custom-title', customTitle: titles.custom, sessionId: MINE }))
  lines.push(JSON.stringify({ type: 'assistant', message: { content: 'more words' } }))
  return lines.join('\n')
}

/** This session's record as it wrote it last. */
export function mine(w: World, id = w.id): SessionRecord | undefined {
  const file = w.files[`${DIR}/${id}.json`]
  return file === undefined ? undefined : (JSON.parse(file.text) as SessionRecord)
}

export const PANE_PROPS = {
  title: 'Switchboard',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

/** The pane's lines on a surface, top to bottom (optionally after pressing one of its buttons). */
export async function paneLines($: Engine, surface: RenderSurface, press?: string): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })
  if (press !== undefined) await ui.press({ key: press })
  const rows = await ui.findAll({ type: 'Box' })
  const lines: string[] = []
  for (const row of rows) if (typeof row.key === 'string' && (row.key.startsWith('row-') || ['hero-text', 'here', 'empty', 'quiet'].includes(row.key))) lines.push(row.text)
  await ui.unmount()
  return lines
}

export const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

/** The footer as drawn: the engine's labels and Switchboard's count. */
export async function footer($: Engine, surface: RenderSurface): Promise<string | undefined> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'SessionMode', props: { modes: ['auto mode'] } })
  const text = (await ui.find({ key: 'switchboard' }))?.text
  await ui.unmount()
  return text
}

/** The band's own line (undefined when it draws none) and the line of the mod beneath. */
export async function band($: Engine, surface: RenderSurface) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
  const line = (await ui.find({ key: 'switchboard' }))?.text
  const beneath = (await ui.find({ type: 'Text', text: "another mod's line" }))?.text
  await ui.unmount()
  return { line, beneath }
}
