// The world beneath thermostat in a test: a clock that moves only when told,
// a login, a prompt box, model requests with the usage a test chooses, and
// records of everything the mod shows. Nothing here decides an outcome; each
// test sets the inputs and reads what the mod did.

import type { ModelForkResult, On, PromptOrigin, SessionAuthorization, TurnUsage } from 'claude-code'
import { mock } from 'claude-code/testing'
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
    sessionUsd: 4.2,
    isStateBroken: false,
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.authorize', () => ({ value: auth }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
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

export async function command($: Engine, name: string, args = ''): Promise<string> {
  const ran = await $.command.run({ command: name, args, origin: PERSON, presentation: { isFullscreen: true, columns: 120 } })
  return ran.text ?? ''
}
