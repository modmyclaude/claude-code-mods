// The world beneath rain-check in a test: a clock that moves only when told,
// the usage windows Claude Code would report, and records of every prompt that
// reached the engine and every toast. Nothing here decides an outcome; each
// test sets the inputs and reads what the mod did.

import type { On, PromptOrigin, RenderSurface, SessionRateLimit } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

export const PLUGIN = 'rain-check'
export const MIN = 60_000
export const HOUR = 60 * MIN
/** 9am local time on a fixed day, so the words ("2pm") do not depend on the machine's zone. */
export const T0 = new Date(2026, 9, 12, 9, 0, 0).getTime()
/** The 5-hour window resets at 2pm the same day. */
export const RESET = new Date(2026, 9, 12, 14, 0, 0).getTime()
/** Moving the mocked clock through hours of minute ticks takes more than 5 s. */
export const SLOW = { timeoutMs: 30_000 }
export const SURFACES = ['terminal', 'desktop'] as const

export const PERSON: PromptOrigin = { kind: 'composer' }

/** A usage window as Claude Code reports it. */
export function window(percentUsed: number, resetsAt = RESET, kind = 'five_hour'): SessionRateLimit {
  return { kind, percentUsed, resetsAt: new Date(resetsAt).toISOString() }
}

export type World = {
  clock: MockClock
  toasts: string[]
  /** Every prompt that reached the engine, in order, with where it came from. */
  sent: { text: string; origin: PromptOrigin | undefined }[]
  surfaces: RenderSurface[]
  /** What `$.session.usage()` answers for the windows. */
  usage: SessionRateLimit[]
  /** Makes every `$.state` write fail, to break the mod mid-hold. */
  isStateBroken: boolean
  /** What the prompt box holds, and every text the mod put in it. */
  box: string
  fills: string[]
  /** False where no box can take text (a headless session). */
  canFill: boolean
  /** Another hook beneath that drops prompts plugins send. */
  dropsPlugins: boolean
  /** Lines the mod put in the transcript (not the debug log). */
  logs: string[]
}

export function world(on: On): World {
  on('state.set', ($, e, next) => (w.isStateBroken ? { deny: 'state unavailable' } : next(e)))
  const w: World = {
    clock: mock.clock(on, { now: T0 }), toasts: [], sent: [], surfaces: ['terminal'], usage: [], isStateBroken: false,
    box: '', fills: [], canFill: true, dropsPlugins: false, logs: [],
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.surfaces', () => ({ value: w.surfaces }))
  on('session.usage', () => ({ value: { startedAt: T0, context: { window: 200_000 }, rateLimits: w.usage } }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    if (e.to !== 'debug') w.logs.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    if (w.dropsPlugins && e.origin.kind === 'plugin') return { drop: 'a policy hook blocked it' }
    w.sent.push({ text: e.text, origin: e.origin })
    return { text: e.text }
  })
  on('prompt.read', () => ({ value: { text: w.box, cursor: w.box.length } }))
  on('prompt.fill', ($, e) => {
    if (!w.canFill) return { isFilled: false }
    w.fills.push(e.text)
    w.box = e.text
    return { isFilled: true }
  })
  on('turn.complete', () => ({ text: '' }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('classic.StopFailure', () => ({}))
  // Another mod's line beneath, so the band is seen to compose.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="other-mod">another mod's line</Text>
  })
  return w
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
}

/** Claude Code reporting the usage windows after a response. */
export async function measure($: Engine, rateLimits: SessionRateLimit[]): Promise<void> {
  await $.session.measure({ context: { window: 200_000 }, rateLimits, changed: ['rateLimits'] })
}

/** A turn Claude Code ended on the usage limit. */
export async function refuse($: Engine): Promise<void> {
  await $.classic.StopFailure({ error: 'rate_limit' })
}

/** A main turn that answered. */
export async function answered($: Engine): Promise<void> {
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
}

export function submit($: Engine, text: string, origin: PromptOrigin = PERSON, turnId?: string) {
  return $.prompt.submit({ text, wait: false, origin, ...(turnId === undefined ? {} : { turnId }) })
}

export const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

/** The mod's own band lines as text, by row key; undefined for a row it did not draw. */
export async function band($: Engine, surface: (typeof SURFACES)[number]) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
  const line = async (key: string) => (await ui.find({ key }))?.text
  const out = {
    waiting: await line('rain-waiting'),
    preview: await line('rain-preview'),
    limit: await line('rain-limit'),
    other: (await ui.find({ type: 'Text', text: "another mod's line" }))?.text,
  }
  return { ui, ...out }
}

/** Mounts the band on a surface, presses one of its buttons, and unmounts. */
export async function press($: Engine, surface: (typeof SURFACES)[number], key: string): Promise<void> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
  await ui.press({ key })
  await ui.unmount()
}
