// The world beneath thermostat in a test: a clock that moves only when told,
// a login, a prompt box, model requests with the usage a test chooses, and
// records of everything the mod shows. Nothing here decides an outcome; each
// test sets the inputs and reads what the mod did.

import type { CommandSpec, ModelForkResult, On, PromptOrigin, RenderSurface, SessionAuthorization, TurnUsage } from 'claude-code'
import { expect, mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

export const MIN = 60_000
/** 2026-10-09 09:00 UTC: an arbitrary start, so nothing depends on zero. */
export const T0 = Date.UTC(2026, 9, 9, 9, 0, 0)

/** Tests that move the mocked clock through hours of 30-second ticks need more than 5 s. */
export const SLOW = { timeoutMs: 30_000 }

export const PERSON: PromptOrigin = { kind: 'composer' }
export const SUBSCRIPTION: SessionAuthorization = { handle: 'h', kind: 'bearer' }
export const API_KEY: SessionAuthorization = { handle: 'h', kind: 'api-key' }

export type World = {
  clock: MockClock
  statuses: (string | undefined)[]
  toasts: string[]
  logs: string[]
  fills: string[]
  forks: string[]
  /** What the prompt box holds when the mod reads it. */
  box: string
  /** What the next keep-warm fork answers. */
  fork: ModelForkResult
  /** What the next model request reports. */
  usage: TurnUsage | null
  /** The surfaces the session draws on, as `$.session.surfaces()` answers. */
  surfaces: RenderSurface[]
  /** The commands the mod registered, as it registered them. */
  registered: CommandSpec[]
  /** The panes the mod asked to open, by id. */
  panes: string[]
  /** Whether a surface places the panes it is asked for. */
  isPanePlaced: boolean
  /** How many times the mod asked for a redraw. */
  invalidates: number
  /** The session's total as /cost would show it. */
  sessionUsd: number
  /** Makes every `$.state` read fail, to break the mod's own logic. */
  isStateBroken: boolean
}

/** A request's usage: `read` tokens served from the cache, `write` written to it. */
export function usage(read: number, write: number, more: Partial<TurnUsage> = {}): TurnUsage {
  return {
    input_tokens: 300,
    output_tokens: 700,
    cache_read_input_tokens: read,
    cache_creation_input_tokens: write,
    model: 'claude-opus-5-5',
    ...more,
  }
}

/** A fork that read `read` tokens from the cache and said "ok". */
export function forkAnswer(read: number, more: Partial<TurnUsage> = {}): ModelForkResult {
  const { model: _model, ...counts } = usage(read, 0, { input_tokens: 40, output_tokens: 60, ...more })
  return { isAnswered: true, text: 'ok', usage: counts }
}

export function world(on: On, auth: SessionAuthorization = SUBSCRIPTION): World {
  // Sits above the kit's own state store and can make every read fail.
  on('state.get', ($, e, next) => (w.isStateBroken ? { deny: 'state unavailable' } : next(e)))
  const w: World = {
    clock: mock.clock(on, { now: T0 }),
    statuses: [],
    toasts: [],
    logs: [],
    fills: [],
    forks: [],
    box: '',
    fork: forkAnswer(0),
    usage: null,
    surfaces: ['terminal'],
    registered: [],
    panes: [],
    isPanePlaced: true,
    invalidates: 0,
    sessionUsd: 4.2,
    isStateBroken: false,
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    w.registered.push(e)
    return { value: { command: e.name } }
  })
  on('ui.open', ($, e) => {
    w.panes.push(e.id)
    return { value: w.isPanePlaced ? { isPlaced: true } : { isPlaced: false, reason: 'the terminal is too narrow' } }
  })
  on('session.authorize', () => ({ value: auth }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surfaces', () => ({ value: w.surfaces }))
  on('ui.invalidate', ($, e, next) => {
    w.invalidates += 1
    return next(e)
  })
  on('session.usage', () => ({
    value: { startedAt: T0, context: { window: 1_000_000 }, rateLimits: [], cost: { usd: w.sessionUsd } },
  }))
  on('ui.status', ($, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    if (e.to !== 'debug') w.logs.push(e.text)
    return { value: undefined }
  })
  on('prompt.read', () => ({ value: { text: w.box, cursor: w.box.length } }))
  on('prompt.fill', ($, e) => {
    w.fills.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('model.fork', ($, e) => {
    w.forks.push(e.prompt)
    return { value: w.fork }
  })
  // The engine's own footer labels, as the plain dim line it draws.
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ dimColor: true, children: e.props.modes.join(' & ') })
  })
  on('classic.SessionStart', () => ({}))
  on('classic.PostModelSwitch', () => ({}))
  on('turn.step', async function* ($, e) {
    const answered = w.usage
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: answered }
  })
  return w
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
}

/** One main-thread model request that reports `answered` as its usage. */
export async function step($: Engine, w: World, answered: TurnUsage | null, agentId?: string): Promise<void> {
  w.usage = answered
  const stream = $.turn.step({ turnId: 'turn', index: 0, model: 'claude-opus-5-5', messageCount: 4, ...(agentId ? { agentId } : {}) })
  for await (const _chunk of stream) {
    // drain
  }
  await stream.result
}

export function submit($: Engine, text: string, origin: PromptOrigin = PERSON) {
  return $.prompt.submit({ text, wait: false, origin })
}

/** The props a docked pane is drawn with. */
export const PANE_PROPS = {
  title: 'Thermostat',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

/** The receipt pane's lines, as drawn on `surface`. */
export async function paneText($: Engine, surface: RenderSurface = 'terminal'): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'thermostat', surface, component: 'Pane', requestId: 'thermostat-receipt', props: PANE_PROPS })
  type Node = { type?: unknown; key?: unknown; props?: Record<string, unknown>; children?: unknown[] }
  const texts = (node: unknown, out: string[] = []): string[] => {
    if (node === null || typeof node !== 'object') return out
    const n = node as Node
    if (n.type === 'Text') out.push((n.children ?? []).filter((c): c is string => typeof c === 'string').join(''))
    else for (const c of n.children ?? []) texts(c, out)
    return out
  }
  const lines: string[] = []
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const n = node as Node
    const key = n.key ?? n.props?.key
    if (n.type === 'Box' && typeof key === 'string' && key.startsWith('row-')) return void lines.push(texts(n).join(': '))
    if (n.type === 'Text') return void lines.push(texts(n).join(''))
    for (const c of n.children ?? []) walk(c)
  }
  walk(await ui.drawn())
  await ui.unmount()
  return lines.join('\n')
}

/**
 * Runs a slash command as the person typing it and returns what they see: the
 * toasts and transcript notes it raised, and the receipt pane if it opened
 * one. The model never reads any of it, so the command answers no text.
 */
export async function command($: Engine, w: World, name: string, args = ''): Promise<string> {
  const [toasts, logs, panes] = [w.toasts.length, w.logs.length, w.panes.length]
  const ran = await $.command.run({ command: name, args, origin: PERSON, presentation: { isFullscreen: true, columns: 120 } })
  expect(ran.text, `/${name} ${args} answered the model with text`).toBeUndefined()
  const shown = [...w.toasts.slice(toasts), ...w.logs.slice(logs)]
  if (w.panes.length > panes) shown.push(await paneText($))
  return shown.join('\n')
}
