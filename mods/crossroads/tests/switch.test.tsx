// The switch: `enabled` off, as /config or the modmyclaude hub sets it, leaves Crossroads
// inert: no band, no model call, no timer, nothing counted, Claude Code's own guess and
// every prompt passed as they came; on, it is back. The engine reloads the mod with the
// new value (the first test, by its options); the config.set hook flips it at once (the
// second, through a stand-in for the engine's own config row).

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { ModelCompleteInput, On, PromptSubmitInput, PromptSuggestInput, SessionMessage, TurnCompleteInput } from 'claude-code'

import { ENGINE_WAIT_MS } from '../hooks/logic'

const PLUGIN = 'crossroads'
const OFF = 'Crossroads is off. /mods or /config turns it on.'
const SURFACES = ['terminal', 'desktop'] as const
const BENEATH = "another mod's line"
const LOADING = 'crossroads: finding three ways forward...'
const USAGE = { input_tokens: 700, output_tokens: 250, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ENGINE = { kind: 'suggestion' } as const
const TYPED = { kind: 'composer' } as const

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 200, scroll: { offset: 0, bodyRows: 11 }, view: {} },
} as const

const ANSWER = 'I added the null check to auth.ts and the auth tests pass. Want me to review the same guard in signup.ts?'
const THREE = ['review the same guard in signup.ts', 'run the full test suite', 'explain the null check']

// A turn worth a list: a typed prompt, an edit, a passing test run, a closing question.
const MESSAGES: SessionMessage[] = [
  { role: 'user', text: 'fix the login crash', toolUses: [] },
  {
    role: 'assistant',
    text: '',
    toolUses: [
      { tool_use_id: 'e1', tool: 'Edit', input: { file_path: '/work/app/src/auth.ts', old_string: 'a', new_string: 'b' } },
      { tool_use_id: 'b1', tool: 'Bash', input: { command: 'npm test -- auth' }, text: 'ok' },
    ],
  },
  {
    role: 'user',
    text: '',
    toolUses: [],
    toolResults: [
      { tool_use_id: 'e1', text: 'edited', isError: false },
      { tool_use_id: 'b1', text: '12 passed', isError: false },
    ],
  },
  { role: 'assistant', text: ANSWER, toolUses: [] },
]

type World = {
  calls: ModelCompleteInput[]
  ghosts: PromptSuggestInput[]
  submitted: PromptSubmitInput[]
  toasts: string[]
  /** Every key Crossroads read from, and wrote to, its store. */
  reads: string[]
  writes: string[]
  registered: string[]
  /** How many of its `$.clock.after` waits were asked so far. */
  timers: () => number
  clock: MockClock
}

// The world beneath the plugin: every noun it calls, answered and recorded.
function world(on: On): World {
  let timers = 0
  // Its two waits: the detached start of a list, and the wait for Claude Code's guess.
  for (const ms of [0, ENGINE_WAIT_MS]) {
    on('clock.after', { ms }, ($, e, next) => {
      timers += 1
      return next(e)
    })
  }
  const store = new Map<string, unknown>()
  const seen: World = {
    calls: [],
    ghosts: [],
    submitted: [],
    toasts: [],
    reads: [],
    writes: [],
    registered: [],
    timers: () => timers,
    clock: mock.clock(on, { now: Date.UTC(2026, 9, 9, 12) }),
  }
  mock.env(on, {})
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.messages', () => ({ value: [...MESSAGES] }))
  on('session.root', () => ({ value: '/work/app' }))
  on('command.list', () => ({ value: [] }))
  on('command.register', ($, e) => (seen.registered.push(e.name), { value: { command: e.name } }))
  on('config.list', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('store.get', ($, e) => (seen.reads.push(e.key), { value: store.get(e.key) }))
  on('store.set', ($, e) => (seen.writes.push(e.key), store.set(e.key, e.value), { value: undefined }))
  on('model.complete', ($, e) => {
    seen.calls.push(e)
    const text = `${JSON.stringify({ items: THREE.map(item => ({ text: item, kind: 'other' })) })}\nEND`
    return { value: { isAnswered: true, text, usage: USAGE } }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('prompt.submit', ($, e) => (seen.submitted.push(e), { text: e.text }))
  on('prompt.suggest', ($, e) => (seen.ghosts.push(e), { isShown: true }))
  on('ui.toast', ($, e) => (seen.toasts.push(e.text), { value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  // What another mod draws in the band, beneath Crossroads.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{BENEATH}</Text>
  })
  return seen
}

let turnCount = 0

/** A main-loop turn starts and ends with the answer; the detached work then runs. */
async function finishTurn($: Engine, seen: World) {
  const turnId = `t${++turnCount}`
  await $.turn.start({ text: 'go', turnId })
  const done = await $.turn.complete({ answer: ANSWER, durationMs: 1000, isAborted: false, turnId, reason: 'answer' } as TurnCompleteInput)
  await seen.clock.settle()
  return done
}

/** What the band draws on a surface: every Text, and the labels of the suggestion rows. */
async function band($: Engine, surface: (typeof SURFACES)[number]) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const picks = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('pick-')).map(b => b.text)
  await ui.unmount()
  return { texts, picks }
}

function crossroads($: Engine, args = '') {
  return $.command.run({ command: PLUGIN, args, origin: TYPED, presentation: { isFullscreen: false, columns: 100 } })
}

function flip($: Engine, value: boolean) {
  return $.config.set({ key: 'crossroads.enabled', value, previous: !value, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
}

test('switched off: no band, no model call, no timer, nothing counted, and the guess and prompts pass untouched', { options: { enabled: false } }, async ($, on) => {
  const seen = world(on)
  // Nothing is written to the band's session state while off.
  const states: unknown[] = []
  on('state.set', { plugin: PLUGIN, key: 'view' }, ($, e) => (states.push(e.value), { value: { isSet: true, version: 1 } }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  // The command stays, so the person can learn it is off.
  expect(seen.registered).toEqual([PLUGIN])

  expect(await finishTurn($, seen)).toEqual({ text: ANSWER })
  await seen.clock.advance(ENGINE_WAIT_MS * 3)
  expect(seen.calls).toEqual([])
  expect(seen.timers()).toBe(0)

  // Claude Code's own guess and the person's prompt reach the engine exactly as sent.
  expect(await $.prompt.suggest({ text: 'git push', origin: ENGINE })).toEqual({ isShown: true })
  expect(seen.ghosts).toEqual([{ text: 'git push', origin: ENGINE }])
  expect(await $.prompt.submit({ text: 'run the full test suite', wait: false, origin: TYPED })).toEqual({ text: 'run the full test suite' })
  expect(seen.submitted).toEqual([{ text: 'run the full test suite', wait: false, origin: TYPED }])
  expect(await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })).toEqual({ sessionId: 'session-1' })

  // What other mods draw there still shows (alone at the root, the kit drops its key: found by text).
  for (const surface of SURFACES) expect(await band($, surface), surface).toEqual({ texts: [BENEATH], picks: [] })

  expect((await crossroads($)).text).toBeUndefined()
  expect((await crossroads($, 'on')).text).toBeUndefined()
  expect(seen.toasts).toEqual([OFF, OFF])
  expect(seen.calls).toEqual([])
  expect(seen.reads).toEqual([])
  expect(seen.writes).toEqual([])
  expect(states).toEqual([])
})

test('flipped live: off drops the list and the wait under way at once; on brings them back', async ($, on) => {
  const seen = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await finishTurn($, seen)
  await seen.clock.advance(ENGINE_WAIT_MS)
  expect(seen.calls).toHaveLength(1)
  expect((await band($, 'terminal')).picks).toEqual(THREE)

  // The next turn waits on Claude Code's guess when the switch goes off.
  await finishTurn($, seen)
  expect((await band($, 'terminal')).texts).toEqual([BENEATH, LOADING])
  await flip($, false)
  for (const surface of SURFACES) expect(await band($, surface), surface).toEqual({ texts: [BENEATH], picks: [] })
  const timers = seen.timers()
  expect(timers, 'the waits are counted').toBeGreaterThan(0)
  await seen.clock.advance(ENGINE_WAIT_MS * 2)
  await finishTurn($, seen)
  await seen.clock.advance(ENGINE_WAIT_MS * 2)
  expect(seen.calls, 'no call while off').toHaveLength(1)
  expect(seen.timers(), 'no timer while off').toBe(timers)
  expect(await $.prompt.suggest({ text: 'git push', origin: ENGINE })).toEqual({ isShown: true })
  expect(await band($, 'terminal')).toEqual({ texts: [BENEATH], picks: [] })
  await crossroads($)
  expect(seen.toasts).toEqual([OFF])

  await flip($, true)
  await finishTurn($, seen)
  await seen.clock.advance(ENGINE_WAIT_MS)
  expect(seen.calls).toHaveLength(2)
  expect(seen.timers()).toBeGreaterThan(timers)
  for (const surface of SURFACES) expect((await band($, surface)).picks, surface).toEqual(THREE)
})

test('switched off with a list kept from before (the engine reloaded it off): nothing of it is drawn', { options: { enabled: false } }, async ($, on) => {
  world(on)
  const kept = { phase: 'shown', epoch: 1, items: THREE.map(text => ({ text, kind: 'other', risk: null, fromEngine: false })), digits: true }
  on('state.get', { plugin: PLUGIN, key: 'view' }, () => ({ value: { value: kept, version: 3 } }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  for (const surface of SURFACES) expect(await band($, surface), surface).toEqual({ texts: [BENEATH], picks: [] })
})
