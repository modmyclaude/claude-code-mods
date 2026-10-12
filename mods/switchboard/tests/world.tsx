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
  }
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
  return w
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/work/api-server', surface: 'terminal', isInteractive: true })
}

/** Another session's record on disk, as that session would write it. */
export function other(w: World, id: string, name: string, state: SessionRecord['state'], since: number, updatedAt = since, costUsd?: number): void {
  const record: SessionRecord = { v: 1, id, name, state, since, updatedAt, ...(costUsd === undefined ? {} : { costUsd }) }
  w.files[`${DIR}/${id}.json`] = { text: JSON.stringify(record), mtimeMs: updatedAt }
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

/** The pane's lines on a surface, top to bottom. */
export async function paneLines($: Engine, surface: RenderSurface): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })
  const rows = await ui.findAll({ type: 'Box' })
  const lines: string[] = []
  for (const row of rows) if (typeof row.key === 'string' && (row.key.startsWith('row-') || row.key === 'hero' || row.key === 'empty')) lines.push(row.text)
  await ui.unmount()
  return lines
}

export const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

/** The band's own line (undefined when it draws none) and the line of the mod beneath. */
export async function band($: Engine, surface: RenderSurface) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
  const line = (await ui.find({ key: 'switchboard' }))?.text
  const beneath = (await ui.find({ type: 'Text', text: "another mod's line" }))?.text
  await ui.unmount()
  return { line, beneath }
}
