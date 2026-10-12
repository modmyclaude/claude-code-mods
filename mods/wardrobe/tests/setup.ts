// Shared wiring for the tests: the world beneath the plugin, answered from memory.

import { expect, mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, RenderPropsOf, RenderSurface } from 'claude-code'

export const SURFACES = ['terminal', 'desktop'] as const

/** What the engine's own drawing looks like in a test: an `engine` element. */
export const ENGINE = { type: 'engine', ref: 0 } as const

/** A local time today-ish, independent of the machine's time zone. */
export function at(hours: number, minutes: number, seconds = 0): number {
  return new Date(2026, 9, 8, hours, minutes, seconds).getTime()
}

/** What /wear showed the person: a toast, or a log line where nothing draws toasts. */
export type Heard = { via: 'toast' | 'log'; text: string; timeoutMs?: number }

// The current test's world, for wear() to read what was shown.
let heard: Heard[] = []

export type World = {
  clock: MockClock
  /** Every toast and log line, oldest first. */
  heard: Heard[]
  /** Every pane id opened. */
  panes: string[]
  /** wardrobe's own store, as JSON round-trips it; a test may write it as another session would. */
  store: Map<string, unknown>
  /** Moves the session to another project root (as /cd would). */
  cd: (root: string) => void
  /** Every set of props the engine was asked to draw itself with, newest last. */
  /** Every set of props the engine was asked to draw itself with, newest last. */
  drawnByEngine: unknown[]
  /** Claude Code's theme row as the world keeps it, every config.set asked for, and a refusal to arm. */
  config: ConfigWorld
}

export type ConfigWorld = { theme: string; sets: { key: string; value: unknown }[]; deny: string | null }
export const THEME_OPTIONS = ['dark', 'light', 'dark-daltonized', 'light-daltonized', 'dark-ansi', 'light-ansi'] as const

/**
 * Answers everything wardrobe asks beneath it: the clock, its store, the
 * project root, command registration, session start and the engine's drawing.
 */
export function world(
  on: On,
  options: { now?: number; root?: string; store?: Record<string, unknown>; surfaces?: readonly RenderSurface[]; placesPanes?: boolean; theme?: string; themeLocked?: boolean } = {},
): World {
  const clock = mock.clock(on, { now: options.now ?? at(12, 0) })
  const store = new Map<string, unknown>(Object.entries(options.store ?? {}))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  heard = []
  const panes: string[] = []
  const seen = heard
  on('ui.toast', ($, e) => {
    seen.push({ via: 'toast', text: e.text, timeoutMs: e.timeoutMs })
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    seen.push({ via: 'log', text: e.text })
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    panes.push(e.id)
    return { value: options.placesPanes === false ? { isPlaced: false, reason: 'the surface places no panes' } : { isPlaced: true } }
  })
  let root = options.root ?? '/work/alpha'
  const drawnByEngine: unknown[] = []
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.root', () => ({ value: root }))
  on('session.surfaces', () => ({ value: options.surfaces ?? ['terminal'] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  // Claude Code's own /config rows, as far as wardrobe reads them: the theme row, with a refusal a test can arm.
  const config: ConfigWorld = { theme: options.theme ?? 'dark', sets: [], deny: null }
  on('config.list', () => ({
    value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: config.theme, options: THEME_OPTIONS, provider: { plugin: 'engine', tier: 'core' }, isLocked: options.themeLocked === true } as never],
  }))
  on('config.set', ($, e) => {
    config.sets.push({ key: e.key, value: e.value })
    if (config.deny !== null) return { deny: config.deny }
    if (e.key === 'theme') config.theme = String(e.value)
    return { value: e.value }
  })
  on('ui.render', ($, e) => {
    drawnByEngine.push(e.props)
    return ENGINE
  })
  return { clock, store, heard: seen, panes, cd: next => (root = next), drawnByEngine, config }
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
}

/**
 * Runs `/wear <args>` as the person typing it would, and answers what it showed
 * them. Every run is also held to the rule that nothing it says reaches the model.
 */
export async function wear($: Engine, args: string): Promise<string> {
  const before = heard.length
  const ran = await $.command.run({
    command: 'wear',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(ran.text).toBeUndefined()
  expect(ran.context).toBeUndefined()
  return heard
    .slice(before)
    .map(line => line.text)
    .join('\n')
}

/** The `/wear` pane as a surface hands it to the hook. */
export const PANE: RenderPropsOf['Pane'] = {
  title: 'Wardrobe',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

/** The band above the prompt as a surface hands it to the hook; `over` changes a prop (a survey, the width). */
export function bandProps(over: Partial<RenderPropsOf['AbovePrompt']> = {}): RenderPropsOf['AbovePrompt'] {
  return { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {}, ...over }
}

export const TOOL_ROW: RenderPropsOf['ToolUse'] = {
  tool_use_id: 'toolu_row',
  tool: 'Bash',
  input: { command: 'ls' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
}

/** An Edit tool's result: one hunk, one line changed. */
export const EDIT = {
  filePath: '/work/alpha/src/app.ts',
  oldString: 'const b = 2',
  newString: 'const b = 3',
  originalFile: null,
  structuredPatch: [
    { oldStart: 11, oldLines: 3, newStart: 11, newLines: 3, lines: [' const a = 1', '-const b = 2', '+const b = 3', ' const c = 4'] },
  ],
  userModified: false,
  replaceAll: false,
}

// What the engine refuses in a drawn tree: every C0 control but tab and
// newline, DEL, and every C1 control.
const REFUSED = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/

/** Every string in a drawn tree (texts and string props) that holds a control character. */
export function controlsIn(node: unknown, found: string[] = []): string[] {
  if (typeof node === 'string') {
    if (REFUSED.test(node)) found.push(JSON.stringify(node))
  } else if (Array.isArray(node)) {
    for (const child of node) controlsIn(child, found)
  } else if (typeof node === 'object' && node !== null) {
    for (const value of Object.values(node)) controlsIn(value, found)
  }
  return found
}
