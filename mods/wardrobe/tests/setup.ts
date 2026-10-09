// Shared wiring for the tests: the world beneath the plugin, answered from memory.

import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, RenderPropsOf, RenderSurface } from 'claude-code'

export const SURFACES = ['terminal', 'desktop'] as const

/** What the engine's own drawing looks like in a test: an `engine` element. */
export const ENGINE = { type: 'engine', ref: 0 } as const

/** A local time today-ish, independent of the machine's time zone. */
export function at(hours: number, minutes: number, seconds = 0): number {
  return new Date(2026, 9, 8, hours, minutes, seconds).getTime()
}

export type World = {
  clock: MockClock
  /** wardrobe's own store, as JSON round-trips it; a test may write it as another session would. */
  store: Map<string, unknown>
  /** Moves the session to another project root (as /cd would). */
  cd: (root: string) => void
  /** Every set of props the engine was asked to draw itself with, newest last. */
  drawnByEngine: unknown[]
}

/**
 * Answers everything wardrobe asks beneath it: the clock, its store, the
 * project root, command registration, session start and the engine's drawing.
 */
export function world(
  on: On,
  options: { now?: number; root?: string; store?: Record<string, unknown>; surfaces?: readonly RenderSurface[] } = {},
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
  let root = options.root ?? '/work/alpha'
  const drawnByEngine: unknown[] = []
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.root', () => ({ value: root }))
  on('session.surfaces', () => ({ value: options.surfaces ?? ['terminal'] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    drawnByEngine.push(e.props)
    return ENGINE
  })
  return { clock, store, cd: next => (root = next), drawnByEngine }
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
}

/** Runs `/wear <args>` as the person typing it would, and answers its text. */
export async function wear($: Engine, args: string): Promise<string> {
  const ran = await $.command.run({
    command: 'wear',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  return ran.text ?? ''
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
