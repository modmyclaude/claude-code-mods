// Behaviour through the real wiring: turns start and end through $.turn,
// the engine's own guess arrives through $.prompt.suggest, the person types
// through $.prompt.submit, the model and every other noun are answered
// beneath the plugin, and the band is mounted and pressed on both surfaces.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, Plugin } from 'claude-code/testing'
import type {
  AgentInfo,
  CommandInfo,
  ConfigRow,
  ModelCompleteInput,
  ModelCompleteResult,
  On,
  PromptFillInput,
  PromptFillResult,
  PromptSubmitInput,
  PromptSuggestInput,
  RenderSurface,
  SessionMessage,
  TurnCompleteInput,
  UiCopyArgs,
} from 'claude-code'

import { AGENT_WAIT_MS, ENGINE_WAIT_MS, REDACTED } from '../hooks/logic'
import { REVIEW_RISKY, REVIEW_SAFE } from './phrasings'

const PLUGIN = 'crossroads'
const SURFACES = ['terminal', 'desktop'] as const
const USAGE = { input_tokens: 700, output_tokens: 250, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 200, scroll: { offset: 0, bodyRows: 11 }, view: {} },
} as const

const ANSWER = 'I added the null check to auth.ts and the auth tests pass. Want me to add the same guard to signup.ts?'
const NUMBERED = 'I see two ways to handle the expired token:\n\n1. Refresh it silently\n2. Send the user back to login\n\nWhich one?'

// A real turn: a typed prompt, an edit, a passing test run.
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

const COMMANDS: CommandInfo[] = [
  { name: 'help', description: 'help', source: 'builtin' },
  { name: 'deploy-staging', description: 'deploy', source: 'user' },
]

const SUGGESTION_OFF: ConfigRow = {
  key: 'promptSuggestionEnabled',
  label: 'Prompt suggestions',
  kind: 'boolean',
  value: false,
  provider: { plugin: 'engine', tier: 'core' },
  isLocked: false,
}

/** A well-formed model reply carrying these suggestions. */
function reply(texts: readonly string[]): string {
  return `${JSON.stringify({ items: texts.map(text => ({ text, kind: 'other' })) })}\nEND`
}

const THREE = ['add the same guard to signup.ts', 'run the full test suite', 'explain the null check']

type Answer = string | ModelCompleteResult | 'deny'
type Setup = {
  surfaces?: readonly RenderSurface[]
  messages?: readonly SessionMessage[]
  config?: readonly ConfigRow[]
  env?: Record<string, string>
  modelDelayMs?: number
  /** Why the model call is refused, for `'deny'` answers. */
  denyText?: string
  /** Why a Send is dropped, while `isSubmitRefused`. */
  dropText?: string
}
type World = {
  calls: ModelCompleteInput[]
  fills: PromptFillInput[]
  copies: UiCopyArgs[]
  submitted: PromptSubmitInput[]
  ghosts: PromptSuggestInput[]
  toasts: string[]
  store: Map<string, string>
  agents: AgentInfo[]
  fillResult: PromptFillResult
  isCopyBroken: boolean
  isStoreBroken: boolean
  isSubmitRefused: boolean
  clock: MockClock
}

// The world beneath the plugin: every noun it calls, answered and recorded.
function world(on: On, answers: Answer[] = [reply(THREE)], setup: Setup = {}): World {
  const seen: World = {
    calls: [],
    fills: [],
    copies: [],
    submitted: [],
    ghosts: [],
    toasts: [],
    store: new Map(),
    agents: [],
    fillResult: { isFilled: true },
    isCopyBroken: false,
    isStoreBroken: false,
    isSubmitRefused: false,
    clock: mock.clock(on, { now: Date.UTC(2026, 9, 9, 12) }),
  }
  mock.env(on, setup.env ?? {})
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: setup.surfaces ?? ['terminal'] }))
  on('session.messages', () => ({ value: [...(setup.messages ?? MESSAGES)] }))
  on('session.root', () => ({ value: '/work/app' }))
  on('command.list', () => ({ value: COMMANDS }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('config.list', () => ({ value: [...(setup.config ?? [])] }))
  on('agent.list', () => ({ value: seen.agents }))
  // A store that keeps JSON, as the engine's does, and can be broken on purpose.
  on('store.get', ($, e) => {
    if (seen.isStoreBroken) return { deny: 'store unavailable' }
    const raw = seen.store.get(e.key)

    return { value: raw === undefined ? undefined : JSON.parse(raw) }
  })
  on('store.set', ($, e) => {
    if (seen.isStoreBroken) return { deny: 'store unavailable' }
    seen.store.set(e.key, JSON.stringify(e.value))

    return { value: undefined }
  })
  on('store.delete', ($, e) => (seen.store.delete(e.key), { value: undefined }))
  on('model.complete', async ($, e) => {
    seen.calls.push(e)
    const answer = answers[Math.min(seen.calls.length, answers.length) - 1] ?? reply(THREE)
    if (setup.modelDelayMs) await seen.clock.sleep(setup.modelDelayMs)
    if (answer === 'deny') return { deny: setup.denyText ?? 'model claude-haiku is not allowed here' }

    return { value: typeof answer === 'string' ? { isAnswered: true, text: answer, usage: USAGE } : answer }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => {
    seen.submitted.push(e)

    return seen.isSubmitRefused ? { drop: setup.dropText ?? 'a policy hook refused it' } : { text: e.text }
  })
  on('prompt.suggest', ($, e) => (seen.ghosts.push(e), { isShown: true }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', ($, e) => (seen.fills.push(e), seen.fillResult))
  on('ui.copy', ($, e) => {
    seen.copies.push(e)

    return { value: seen.isCopyBroken ? { isCopied: false, reason: 'no-clipboard' } : { isCopied: true } }
  })
  on('ui.toast', ($, e) => (seen.toasts.push(e.text), { value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  // What the engine draws in the band when the plugin passes.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })

  return seen
}

type Turns = {
  turn: {
    start: (e: { text: string; turnId: string }) => Promise<{ turnId: string }>
    complete: (e: TurnCompleteInput) => Promise<{ text: string }>
  }
}

let turnCount = 0

/** A main-loop turn starts and ends with this answer; the detached work then runs. */
async function finishTurn($: Turns, seen: World, answer = ANSWER, extra: Partial<TurnCompleteInput> = {}) {
  const turnId = `t${++turnCount}`
  await $.turn.start({ text: 'go', turnId })
  const done = await $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId, reason: 'answer', ...extra } as TurnCompleteInput)
  await seen.clock.settle()

  return done
}

const ENGINE = { kind: 'suggestion' } as const
const TYPED = { kind: 'composer' } as const

async function labels(ui: { findAll: (q: { type: string }) => Promise<{ key: string | undefined; text: string }[]> }) {
  return (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('pick-')).map(b => b.text)
}

/**
 * Runs `/crossroads <args>` and returns what it showed. The answer is always
 * `{}` (nothing for the model to read, API-GOTCHAS #18): what the person sees
 * is the toast it raised.
 */
async function crossroads($: Engine, seen: World, args = ''): Promise<string> {
  const before = seen.toasts.length
  const result = await $.command.run({ command: PLUGIN, args, origin: TYPED, presentation: { isFullscreen: false, columns: 100 } })
  expect(result.text).toBeUndefined()
  expect(seen.toasts).toHaveLength(before + 1)

  return seen.toasts.at(-1) ?? ''
}

test("the engine's guess becomes option 1, passed through untouched, and only two more are made", async ($, on) => {
  const seen = world(on)
  const ended = await finishTurn($, seen)
  expect(ended.text).toBe(ANSWER)

  // While it waits for the engine's guess: no call yet, a dim loading row.
  expect(seen.calls).toHaveLength(0)
  const loading = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  const row = await loading.find({ type: 'Text', text: /finding three ways forward/ })
  expect(row?.props.dimColor).toBe(true)
  await loading.unmount()

  const shown = await $.prompt.suggest({ text: 'run the auth tests again', origin: ENGINE })
  expect(shown.isShown).toBe(true)
  expect(seen.ghosts.map(ghost => ghost.text)).toEqual(['run the auth tests again'])
  await seen.clock.settle()

  expect(seen.calls).toHaveLength(1)
  const call = seen.calls[0]
  expect(call?.model).toBe('haiku')
  expect(call?.effort).toBe('low')
  expect(call?.prompt).toContain('2 different next prompts')
  expect(call?.prompt).toContain('Already suggested (do not repeat): run the auth tests again')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await labels(ui)).toEqual(['run the auth tests again', 'add the same guard to signup.ts', 'run the full test suite'])
    expect((await ui.find({ key: 'pick-1' }))?.props.hotkey).toBe('1')
    expect((await ui.find({ key: 'pick-3' }))?.props.hotkey).toBe('3')
    expect((await ui.find({ key: 'dismiss' }))?.props.hotkey).toBe('0')
    // The suggestions stack on top of what other mods draw; they never replace it.
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    await ui.unmount()
  }

  // Narrow: one per row, still all three.
  const narrow = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: { ...BAND.props, bodyColumns: 40 } })
  expect(await labels(narrow)).toHaveLength(3)
  // A survey or a running turn gets the band back.
  const survey = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await survey.find({ text: 'engine band' })).toBeDefined()
  const working = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: { ...BAND.props, isWorking: true } })
  expect(await working.find({ text: 'engine band' })).toBeDefined()
})

test('no guess from the engine: after the wait, all three are made', async ($, on) => {
  const seen = world(on)
  await finishTurn($, seen)
  expect(seen.calls).toHaveLength(0)
  await seen.clock.advance(ENGINE_WAIT_MS)

  expect(seen.calls).toHaveLength(1)
  expect(seen.calls[0]?.prompt).toContain('3 different next prompts')
  expect(seen.calls[0]?.prompt).not.toContain('Already suggested')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(THREE)
})

for (const [name, setup] of [
  ['the engine setting is off', { config: [SUGGESTION_OFF] }],
  ['only the desktop app draws (the engine never guesses there)', { surfaces: ['desktop'] as const }],
] as const) {
  test(`${name}: all three are made at once, no waiting`, async ($, on) => {
    const seen = world(on, [reply(THREE)], setup)
    await finishTurn($, seen)

    expect(seen.calls).toHaveLength(1)
    expect(seen.calls[0]?.prompt).toContain('3 different next prompts')
  })
}

test('a guess that lands after the list takes option 1, so ghost and option 1 agree', async ($, on) => {
  const seen = world(on)
  await finishTurn($, seen)
  await seen.clock.advance(ENGINE_WAIT_MS)
  expect(seen.calls).toHaveLength(1)

  await $.prompt.suggest({ text: 'commit the fix', origin: ENGINE })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['commit the fix', 'add the same guard to signup.ts', 'run the full test suite'])
  expect(seen.calls).toHaveLength(1)
})

test('a risky guess that lands late is kept from the ghost and displaces nothing', async ($, on) => {
  const seen = world(on)
  await finishTurn($, seen)
  await seen.clock.advance(ENGINE_WAIT_MS)

  expect((await $.prompt.suggest({ text: 'deploy it to production', origin: ENGINE })).isShown).toBe(false)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(THREE)
})

test('a guess made while a turn still runs is not taken for the finished turn', async ($, on) => {
  const seen = world(on)
  await $.turn.start({ text: 'go', turnId: 'running' })
  await $.prompt.suggest({ text: 'stale guess from before', origin: ENGINE })
  await $.turn.complete({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 'running', reason: 'answer' })
  await seen.clock.settle()
  expect(seen.calls).toHaveLength(0)
  await seen.clock.advance(ENGINE_WAIT_MS)

  expect(seen.calls[0]?.prompt).toContain('3 different next prompts')
  expect(seen.calls[0]?.prompt).not.toContain('stale guess')
})

test('a risky suggestion is amber with its note and never option 1', async ($, on) => {
  const seen = world(on, [reply(['push to main', 'run the auth tests', 'add the guard to signup.ts'])], { surfaces: ['desktop'] })
  await finishTurn($, seen)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await labels(ui)).toEqual(['run the auth tests', 'add the guard to signup.ts', 'push to main'])
    const note = await ui.find({ type: 'Text', text: '(pushes)' })
    expect(note?.props.color).toBe('warning')
    // Safe items keep their digit; the risky one is click-only.
    expect((await ui.find({ key: 'pick-1' }))?.props.hotkey).toBe('1')
    expect((await ui.find({ key: 'pick-3' }))?.props.hotkey).toBeUndefined()
    await ui.unmount()
  }
})

test("a risky guess from the engine is never the ghost text, and never option 1", async ($, on) => {
  const seen = world(on, [reply(['run the auth tests', 'add the guard to signup.ts'])])
  await finishTurn($, seen)

  const shown = await $.prompt.suggest({ text: 'git push origin main', origin: ENGINE })
  expect(shown.isShown).toBe(false)
  expect(seen.ghosts).toEqual([])
  await seen.clock.settle()

  expect(seen.calls[0]?.prompt).toContain('2 different next prompts')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['run the auth tests', 'add the guard to signup.ts', 'git push origin main'])
  expect((await ui.find({ type: 'Text', text: '(pushes)' }))?.props.color).toBe('warning')
})

test('a safe guess still reaches the box; a failing guard hides the ghost rather than risk it', async ($, on) => {
  const seen = world(on)
  expect((await $.prompt.suggest({ text: 'run the tests', origin: ENGINE })).isShown).toBe(true)
  // Another plugin's suggestion is never judged.
  expect((await $.prompt.suggest({ text: 'git push', origin: { kind: 'plugin', name: 'other' } })).isShown).toBe(true)

  seen.isStoreBroken = true
  expect((await $.prompt.suggest({ text: 'run the tests', origin: ENGINE })).isShown).toBe(false)
  expect(seen.ghosts.map(ghost => ghost.text)).toEqual(['run the tests', 'git push'])
})

test('when Claude ends with numbered options, the digit keys are left to answer it', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
  await finishTurn($, seen, NUMBERED)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons).toHaveLength(4)
    for (const button of buttons) expect(button.props.hotkey).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /number keys answer Claude/ })).toBeDefined()
    await ui.unmount()
  }
})

test('trivial, aborted and subagent turns never call the model', async ($, on) => {
  const quiet: SessionMessage[] = [{ role: 'user', text: 'how does the cache work', toolUses: [] }]
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'], messages: quiet })

  await finishTurn($, seen, 'Done.')
  await finishTurn($, seen, 'The cache keeps each response for five minutes, keyed by the request path.')
  await finishTurn($, seen, ANSWER, { reason: 'aborted', isAborted: true })
  await finishTurn($, seen, ANSWER, { agentId: 'sub-1' })
  await seen.clock.advance(60_000)

  expect(seen.calls).toHaveLength(0)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await ui.find({ text: 'engine band' })).toBeDefined()
})

test('a subagent ending mid-turn does not trigger the main list', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
  await $.turn.start({ text: 'go', turnId: 'main' })
  await $.turn.complete({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 'sub', reason: 'answer', agentId: 'sub-7' })
  await seen.clock.advance(10_000)
  expect(seen.calls).toHaveLength(0)
})

test('submitting while the call runs discards its result', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'], modelDelayMs: 3000 })
  await finishTurn($, seen)
  expect(seen.calls).toHaveLength(1)

  await $.prompt.submit({ text: 'actually, revert that', wait: false, origin: TYPED })
  await seen.clock.advance(3000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ key: 'pick-1' })).toBeUndefined()
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    await ui.unmount()
  }
  // The discarded list was never shown, so the next prompt cannot count it as ignored.
  await $.prompt.submit({ text: 'and run the build', wait: false, origin: TYPED })
  expect(await crossroads($, seen)).toContain('taken 0, edited 0, ignored 0')
})

test('the list clears as soon as anything is submitted', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
  await finishTurn($, seen)
  const before = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await before.find({ key: 'pick-1' })).toBeDefined()
  await before.unmount()

  await $.prompt.submit({ text: 'something else', wait: false, origin: TYPED })
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await after.find({ key: 'pick-1' })).toBeUndefined()
})

test('waits for background subagents to finish before suggesting', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
  seen.agents = [{ id: 'bg-1', description: 'scan the repo', type: 'general-purpose', status: 'running' }]
  await finishTurn($, seen)
  await seen.clock.advance(30_000)
  expect(seen.calls).toHaveLength(0)

  seen.agents = [{ id: 'bg-1', description: 'scan the repo', type: 'general-purpose', status: 'completed' }]
  await $.turn.complete({ answer: 'scan done', durationMs: 1, isAborted: false, turnId: 'bg', reason: 'answer', agentId: 'bg-1' })
  await seen.clock.settle()
  expect(seen.calls).toHaveLength(1)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(THREE)
})

for (const [name, answer] of [
  ['cut off (no END line)', reply(THREE).replace(/\nEND$/, '')],
  ['cut mid-JSON', '{"items":[{"text":"run the'],
  ['prose', 'You could run the tests next.\nEND'],
  ['too few items', reply(['only one'])],
  ['a failed call', { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE } as ModelCompleteResult],
] as const) {
  test(`${name}: nothing is shown`, async ($, on) => {
    const seen = world(on, [answer], { surfaces: ['desktop'] })
    await finishTurn($, seen)

    expect(seen.calls).toHaveLength(1)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    expect(await ui.find({ key: 'pick-1' })).toBeUndefined()
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    expect(seen.toasts).toEqual([])
  })
}

test('model output is sanitized before it is drawn or drafted', async ($, on) => {
  const dirty = reply(['\u001b[31mrun the auth tests\u001b[0m', 'add\u200b the guard\u202e to signup.ts', 'commit\u0007 it'])
  const seen = world(on, [dirty], { surfaces: ['desktop'] })
  await finishTurn($, seen)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['run the auth tests', 'add the guard to signup.ts', 'commit it'])
})

test('both surfaces: a press drafts on the terminal, copies with an explicit Send on desktop', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })

  for (const surface of SURFACES) {
    await finishTurn($, seen)
    // The engine answers `no_composer` on desktop; a hook's own cause is stripped, so the test answers plain false.
    seen.fillResult = { isFilled: surface === 'terminal' }
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    await ui.press({ key: 'pick-2' })

    if (surface === 'terminal') {
      expect(seen.fills.at(-1)).toMatchObject({ text: 'run the full test suite', mode: 'append' })
      expect(await ui.find({ key: 'pick-1' })).toBeUndefined()
      expect(seen.submitted).toEqual([])
      // Taking it as drafted counts as a take.
      await $.prompt.submit({ text: 'run the full test suite', wait: false, origin: TYPED })
    } else {
      expect(seen.toasts).toEqual([])
      expect(seen.copies.at(-1)).toEqual({ text: 'run the full test suite', surface: 'desktop' })
      expect(await ui.find({ type: 'Text', text: /Copied to your clipboard/ })).toBeDefined()
      const send = await ui.find({ key: 'send' })
      expect(send?.text).toBe('Send this prompt now')
      expect(send?.props.variant).toBe('secondary')
      expect(send?.props.autoFocus).toBeUndefined()
      expect(send?.props.hotkey).toBeUndefined()
      // Close is drawn first and is where the focus ring starts (API-GOTCHAS #24).
      const buttons = await ui.findAll({ type: 'Button' })
      expect(buttons.map(button => [button.key, button.props.hotkey, button.props.autoFocus])).toEqual([
        ['dismiss', undefined, true],
        ['send', undefined, undefined],
      ])
      const before = seen.submitted.length
      await ui.press({ key: 'send' })
      expect(seen.submitted).toHaveLength(before + 1)
      expect(seen.submitted.at(-1)).toMatchObject({
        text: 'run the full test suite',
        origin: { kind: 'plugin', name: PLUGIN, asUser: true },
      })
      expect(await ui.find({ key: 'send' })).toBeUndefined()
    }
    await ui.unmount()
  }

  expect(await crossroads($, seen)).toContain('taken 2, edited 0, ignored 0')
})

test('desktop: when the copy fails it says so, and Send still waits for a press', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
  await finishTurn($, seen)
  seen.fillResult = { isFilled: false }
  seen.isCopyBroken = true
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  await ui.press({ key: 'pick-1' })

  expect(await ui.find({ type: 'Text', text: /Could not copy it/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'add the same guard to signup.ts' })).toBeDefined()
  expect(seen.submitted).toEqual([])
  await ui.press({ key: 'dismiss' })
  expect(await ui.find({ key: 'send' })).toBeUndefined()
  expect(seen.submitted).toEqual([])
})

test('desktop: a refused Send says why and keeps the suggestion to try again', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
  await finishTurn($, seen)
  seen.fillResult = { isFilled: false }
  seen.isSubmitRefused = true
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  await ui.press({ key: 'pick-1' })
  await ui.press({ key: 'send' })

  expect(seen.submitted).toHaveLength(1)
  expect(seen.toasts).toEqual(['Crossroads: the prompt was not sent (a policy hook refused it).'])
  expect(await ui.find({ key: 'send' })).toBeDefined()
  expect(await crossroads($, seen)).toContain('taken 0')
})

test('0 dismisses the list and counts it as ignored', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
  await finishTurn($, seen)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    if (surface === 'terminal') await ui.press({ key: 'dismiss' })
    expect(await ui.find({ key: 'pick-1' })).toBeUndefined()
    await ui.unmount()
  }
  expect(await crossroads($, seen)).toContain('ignored 3')
})

test('backs off after 3 ignored lists in a row, and recovers when one is taken', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
  for (let round = 1; round <= 3; round++) {
    await finishTurn($, seen)
    expect(seen.calls).toHaveLength(round)
    await $.prompt.submit({ text: `something unrelated ${round}`, wait: false, origin: TYPED })
  }

  await finishTurn($, seen)
  expect(seen.calls).toHaveLength(3) // backing off: skipped
  await finishTurn($, seen)
  expect(seen.calls).toHaveLength(4) // every 2nd turn still gets a list

  // Typing a suggestion exactly counts as taking it: the streak ends.
  await $.prompt.submit({ text: 'run the full test suite', wait: false, origin: TYPED })
  await finishTurn($, seen)
  await finishTurn($, seen)
  expect(seen.calls).toHaveLength(6)
  expect(seen.calls[5]?.prompt).toContain('This person most often takes: other')

  // Counts only: no prompt or suggestion text is ever stored.
  const stored = [...seen.store.values()].join('\n')
  expect(stored).not.toContain('unrelated')
  expect(stored).not.toContain('test suite')
  expect(stored).not.toContain('/work/app')
})

test('only the digest leaves the machine, secrets replaced', async ($, on) => {
  const messages: SessionMessage[] = [
    { role: 'user', text: 'deploy with key AKIAIOSFODNN7EXAMPLE please', toolUses: [] },
    {
      role: 'assistant',
      text: '',
      toolUses: [
        { tool_use_id: 'w', tool: 'Write', input: { file_path: '/home/me/app/.env', content: 'STRIPE=sk_live_51HAbCdEfGhIjKlMn0' } },
        { tool_use_id: 'b', tool: 'Bash', input: { command: 'PGPASSWORD=hunter2 psql -c "select 1"' }, isError: true, text: 'fail' },
      ],
    },
  ]
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'], messages })
  await finishTurn($, seen)

  const sent = `${seen.calls[0]?.system ?? ''}\n${seen.calls[0]?.prompt ?? ''}`
  expect(sent).toContain('Files edited: .env')
  expect(sent).toContain(`Ran \`PGPASSWORD=${REDACTED} psql -c "select 1"\`: failed`)
  expect(sent).toContain('Slash commands in this session: /deploy-staging')
  expect(sent).toContain('The assistant ended by asking: Want me to add the same guard to signup.ts?')
  for (const secret of ['AKIAIOSFODNN7EXAMPLE', 'sk_live_', 'hunter2', '/home/me']) expect(sent).not.toContain(secret)
})

test('/crossroads shows calls and cost in a toast, never to the model; off, on and forget work', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
  const run = (args: string) => crossroads($, seen, args)

  await finishTurn($, seen)
  await $.prompt.submit({ text: 'nope', wait: false, origin: TYPED })
  const status = await run('')
  expect(status).toContain('Crossroads is on.')
  expect(status).toContain('Today: 1 call, about $0.0002')
  expect(status).toContain('ignored 3')

  expect(await run('off')).toContain('Crossroads is off')
  await finishTurn($, seen)
  expect(seen.calls).toHaveLength(1)
  // Off means fully off: even a risky engine guess passes as the engine made it.
  expect((await $.prompt.suggest({ text: 'git push', origin: ENGINE })).isShown).toBe(true)

  expect(await run('on')).toContain('Crossroads is on')
  await finishTurn($, seen)
  expect(seen.calls).toHaveLength(2)

  expect(await run('forget')).toContain('forgot')
  expect(await run('')).toContain('taken 0, edited 0, ignored 0')
  expect(await run('bogus')).toContain('Usage')
})

test('/crossroads still answers when its store fails', async ($, on) => {
  const seen = world(on)
  seen.isStoreBroken = true
  expect(await crossroads($, seen)).toBe('Crossroads could not read its counts.')
})

test('a prompt always goes in, even when learning from it fails', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
  await finishTurn($, seen)
  seen.isStoreBroken = true
  const entered = await $.prompt.submit({ text: 'something else', wait: false, origin: TYPED })
  expect(entered.text).toBe('something else')
  expect(seen.submitted).toHaveLength(1)
})

test('a refused model alias: the provider id from the environment is tried once', async ($, on) => {
  const seen = world(on, ['deny', reply(THREE)], { surfaces: ['desktop'], env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-5-5' } })
  await finishTurn($, seen)

  expect(seen.calls.map(call => call.model)).toEqual(['haiku', 'claude-haiku-5-5'])
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(THREE)
})

test('a refused model with no fallback says so once and stops calling', async ($, on) => {
  const seen = world(on, ['deny'], { surfaces: ['desktop'] })
  await finishTurn($, seen)
  await finishTurn($, seen)

  expect(seen.calls).toHaveLength(1)
  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).toContain('small model is not available')
})

// ---------------------------------------------------------------- control characters (API-GOTCHAS #31)

// One control character in a drawn string and the engine refuses the whole
// tree; this band composes the bands beneath it, so they would vanish too.
const CONTROLS = [
  ['BEL', '\u0007'],
  ['ESC with a CSI sequence', '\u001b[2J'],
  ['DEL', '\u007f'],
  ['NUL', '\u0000'],
  ['C1 CSI (U+009B)', '\u009b31m'],
] as const
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** Another mod's band beneath Crossroads: it must survive whatever Crossroads draws. */
const NEIGHBOUR: Plugin = {
  name: 'neighbour',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const { Box, Text } = $.ui.resolve(e)
      const rest = await next(e)

      return (
        <Box key="neighbour" flexDirection="column">
          <Text>neighbour band</Text>
          {rest}
        </Box>
      )
    })
  },
}

/**
 * Stands above Crossroads and dirties every suggestion it stores (every
 * control class at once), as a list kept in $.state by an older version could
 * be: what is drawn must be clean even when what is stored is not.
 */
const DIRTIER: Plugin = {
  name: 'dirtier',
  tier: 'prepend',
  register(on) {
    on('state.set', ($, e, next) => {
      const write = e as unknown as { plugin: string; value: { items?: { text: string }[]; item?: { text: string } } | null }
      const value = write.value
      if (write.plugin !== 'crossroads' || value === null) return next(e)
      const dirty = (text: string) => `${text}\u0007\u001b[2J\u007f\u0000\u009b31m`
      const items = value.items?.map(item => ({ ...item, text: dirty(item.text) }))
      const item = value.item ? { ...value.item, text: dirty(value.item.text) } : undefined

      return next({ ...e, value: { ...value, ...(items ? { items } : {}), ...(item ? { item } : {}) } } as typeof e)
    })
  },
}

/** Every string anywhere in a drawn tree: texts, labels, alts, keys. */
function strings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) for (const child of node) strings(child, out)
  else if (node !== null && typeof node === 'object') for (const value of Object.values(node)) strings(value, out)

  return out
}

/**
 * Mounts the band with the neighbour beneath. The kit rejects the mount when
 * the engine refuses Crossroads' tree, so resolving is the first assertion.
 */
async function mountBand($: Engine, surface: (typeof SURFACES)[number]) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
  expect((await ui.find({ key: 'neighbour' }))?.text, surface).toContain('neighbour band')
  for (const text of strings(await ui.drawn())) expect(text, surface).not.toMatch(CONTROL)

  return ui
}

describe('control characters never take the band down (API-GOTCHAS #31)', () => {
  for (const [name, c] of CONTROLS) {
    test(`${name} in the model's suggestions`, { plugins: [NEIGHBOUR] }, async ($, on) => {
      const dirty = [`run${c} the auth tests`, `add the guard ${c}to signup.ts`, `explain the ${c}null check`]
      const seen = world(on, [reply(dirty)], { surfaces: ['desktop'] })
      await finishTurn($, seen)
      for (const surface of SURFACES) {
        const ui = await mountBand($, surface)
        expect(await labels(ui)).toEqual(['run the auth tests', 'add the guard to signup.ts', 'explain the null check'])
        await ui.unmount()
      }
    })

    test(`${name} in the engine's own guess: drawn, drafted and copied clean`, { plugins: [NEIGHBOUR] }, async ($, on) => {
      const seen = world(on, [reply(['add the same guard to signup.ts', 'run the full test suite'])])
      const dirty = `run the auth${c} tests again`
      const shown = /^run the auth\uFFFD? tests again$/
      for (const surface of SURFACES) {
        await finishTurn($, seen)
        expect((await $.prompt.suggest({ text: dirty, origin: ENGINE })).isShown).toBe(true)
        await seen.clock.settle()
        seen.fillResult = { isFilled: surface === 'terminal' }
        const ui = await mountBand($, surface)
        expect((await labels(ui))[0]).toMatch(shown)
        await ui.press({ key: 'pick-1' })
        if (surface === 'terminal') expect(seen.fills.at(-1)?.text).toMatch(shown)
        else {
          expect(seen.copies.at(-1)?.text).toMatch(shown)
          // The copied line and its Send, on both surfaces.
          for (const where of SURFACES) {
            const copied = await mountBand($, where)
            expect(await copied.find({ key: 'send' })).toBeDefined()
            await copied.unmount()
          }
        }
        await ui.unmount()
      }
      // The engine's own ghost text is its business: passed on exactly as it came.
      expect(seen.ghosts.map(ghost => ghost.text)).toEqual([dirty, dirty])
    })

    test(`${name} in why the model was refused: the toast is clean`, async ($, on) => {
      const seen = world(on, ['deny'], { surfaces: ['desktop'], denyText: `model${c} blocked here` })
      await finishTurn($, seen)
      expect(seen.toasts).toHaveLength(1)
      expect(seen.toasts[0]).toContain('small model is not available')
      expect(seen.toasts[0]).not.toMatch(CONTROL)
    })

    test(`${name} in why a Send was dropped: the toast is clean and the band still draws`, { plugins: [NEIGHBOUR] }, async ($, on) => {
      const seen = world(on, [reply(THREE)], { surfaces: ['desktop'], dropText: `policy${c} says no` })
      await finishTurn($, seen)
      seen.fillResult = { isFilled: false }
      seen.isSubmitRefused = true
      const ui = await mountBand($, 'desktop')
      await ui.press({ key: 'pick-1' })
      await ui.press({ key: 'send' })
      expect(seen.toasts).toHaveLength(1)
      expect(seen.toasts[0]).toMatch(/^Crossroads: the prompt was not sent \(policy\uFFFD? says no\)\.$/)
      await ui.unmount()
      for (const surface of SURFACES) await (await mountBand($, surface)).unmount()
    })
  }

  test('what is stored dirty is still drawn clean: the list and the copied line', { plugins: [DIRTIER, NEIGHBOUR] }, async ($, on) => {
    const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
    await finishTurn($, seen)
    for (const surface of SURFACES) {
      const ui = await mountBand($, surface)
      const shown = await labels(ui)
      expect(shown).toHaveLength(3)
      for (const [index, label] of shown.entries()) expect(label.startsWith(THREE[index] ?? '?'), label).toBe(true)
      await ui.unmount()
    }
    seen.fillResult = { isFilled: false }
    const desk = await mountBand($, 'desktop')
    await desk.press({ key: 'pick-1' })
    await desk.unmount()
    for (const surface of SURFACES) {
      const ui = await mountBand($, surface)
      expect(await ui.find({ type: 'Text', text: /^add the same guard to signup\.ts/ })).toBeDefined()
      await ui.unmount()
    }
  })
})

// ---------------------------------------------------------------- risky phrasings (R-crossroads-1)

const SAFE_TWO = ['run the auth tests', 'add the guard to signup.ts']

test("the engine's \"ship it to production\" is never the ghost text, never option 1, never digit-armed", async ($, on) => {
  const seen = world(on, [reply(['git reset --hard origin/main', 'run the auth tests'])])
  await finishTurn($, seen)

  expect((await $.prompt.suggest({ text: 'ship it to production', origin: ENGINE })).isShown).toBe(false)
  expect(seen.ghosts).toEqual([])
  await seen.clock.settle()

  expect(seen.calls[0]?.prompt).toContain('2 different next prompts')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await labels(ui)).toEqual(['run the auth tests', 'ship it to production', 'git reset --hard origin/main'])
    expect((await ui.find({ key: 'pick-1' }))?.props.hotkey).toBe('1')
    expect((await ui.find({ key: 'pick-2' }))?.props.hotkey).toBeUndefined()
    expect((await ui.find({ key: 'pick-3' }))?.props.hotkey).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: '(deploys)' }))?.props.color).toBe('warning')
    expect((await ui.find({ type: 'Text', text: '(discards work)' }))?.props.color).toBe('warning')
    await ui.unmount()
  }
})

test('the review probe: three risky suggestions are all marked and none is digit-armed', async ($, on) => {
  const seen = world(on, [reply(['redeploy the auth service', 'git reset --hard origin/main'])])
  await finishTurn($, seen)
  expect((await $.prompt.suggest({ text: 'ship it to production', origin: ENGINE })).isShown).toBe(false)
  await seen.clock.settle()

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    const picks = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('pick-'))
    expect(picks).toHaveLength(3)
    for (const pick of picks) expect(pick.props.hotkey, pick.text).toBeUndefined()
    const notes = (await ui.findAll({ type: 'Text' })).filter(text => text.props.color === 'warning').map(text => text.text.trim())
    expect(notes).toEqual(['(deploys)', '(deploys)', '(discards work)'])
    await ui.unmount()
  }
})

test("every risky phrasing in the review's table, as the engine's guess: kept from the ghost, marked, click-only", async ($, on) => {
  const seen = world(on, REVIEW_RISKY.map(() => reply(SAFE_TWO)))
  for (const [text, note] of REVIEW_RISKY) {
    await finishTurn($, seen)
    expect((await $.prompt.suggest({ text, origin: ENGINE })).isShown, text).toBe(false)
    await seen.clock.settle()
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    expect(await labels(ui), text).toHaveLength(3)
    expect((await labels(ui))[0], text).toBe(SAFE_TWO[0])
    expect((await ui.find({ key: 'pick-3' }))?.props.hotkey, text).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: `(${note})` }))?.props.color, text).toBe('warning')
    await ui.unmount()
  }
  // Not one of them reached the prompt box as ghost text.
  expect(seen.ghosts).toEqual([])
  // The safe ones still do, untouched.
  for (const text of REVIEW_SAFE) expect((await $.prompt.suggest({ text, origin: ENGINE })).isShown, text).toBe(true)
  expect(seen.ghosts).toHaveLength(REVIEW_SAFE.length)
})

test("every risky phrasing in the review's table, written by the model: moved last, marked, click-only", async ($, on) => {
  const seen = world(on, REVIEW_RISKY.map(([text]) => reply([text, ...SAFE_TWO])), { surfaces: ['desktop'] })
  for (const [text, note] of REVIEW_RISKY) {
    await finishTurn($, seen)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    expect((await labels(ui)).slice(0, 2), text).toEqual(SAFE_TWO)
    expect((await ui.find({ key: 'pick-1' }))?.props.hotkey, text).toBe('1')
    expect((await ui.find({ key: 'pick-3' }))?.props.hotkey, text).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: `(${note})` }))?.props.color, text).toBe('warning')
    await ui.unmount()
  }
  expect(seen.calls).toHaveLength(REVIEW_RISKY.length)
})

// ---------------------------------------------------------------- surfaces that draw no band (R-crossroads-5)

for (const surfaces of [[], ['vscode'], ['mobile'], ['vscode', 'mobile']] as const) {
  test(`surfaces ${JSON.stringify(surfaces)} draw no band, so no call is spent`, async ($, on) => {
    const seen = world(on, [reply(THREE)], { surfaces })
    await finishTurn($, seen)
    await seen.clock.advance(ENGINE_WAIT_MS)
    await seen.clock.advance(60_000)
    expect(seen.calls).toHaveLength(0)
  })
}

test('a drawing surface beside one that draws nothing still gets its list', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['vscode', 'desktop'] })
  await finishTurn($, seen)
  expect(seen.calls).toHaveLength(1)
})

// ---------------------------------------------------------------- the cross-review's seven (mutants M1..M7)

test('a risky guess that lands during the call displaces nothing', async ($, on) => {
  const seen = world(on, [reply(THREE)], { modelDelayMs: 3000 })
  await finishTurn($, seen)
  await seen.clock.advance(ENGINE_WAIT_MS)
  expect(seen.calls).toHaveLength(1)
  expect((await $.prompt.suggest({ text: 'deploy it to production', origin: ENGINE })).isShown).toBe(false)
  await seen.clock.advance(3000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(THREE)
})

test('prompts from other plugins and task notifications are never learned from', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
  await finishTurn($, seen)
  await $.prompt.submit({ text: 'a background task finished', wait: false, origin: { kind: 'task-notification' } })
  await finishTurn($, seen)
  await $.prompt.submit({ text: 'from another mod', wait: false, origin: { kind: 'plugin', name: 'other' } })
  expect(await crossroads($, seen)).toContain('taken 0, edited 0, ignored 0')
})

test('error and refusal turns never call the model', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
  await finishTurn($, seen, ANSWER, { reason: 'error' })
  await finishTurn($, seen, ANSWER, { reason: 'refusal', refusal: { category: null, explanation: null } } as Partial<TurnCompleteInput>)
  await seen.clock.advance(60_000)
  expect(seen.calls).toHaveLength(0)
})

test('a background agent that never ends stops the wait at the cap', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
  seen.agents = [{ id: 'bg', description: 'hangs', type: 'general-purpose', status: 'running' }]
  await finishTurn($, seen)
  await seen.clock.advance(AGENT_WAIT_MS + 4_000)
  seen.agents = [{ id: 'bg', description: 'hangs', type: 'general-purpose', status: 'completed' }]
  await seen.clock.advance(4_000)
  expect(seen.calls).toHaveLength(0)
})

test('a secret cut at the command clip edge never leaks a prefix', async ($, on) => {
  const pad = 'x'.repeat(80)
  const messages: SessionMessage[] = [
    { role: 'user', text: 'print the key', toolUses: [] },
    {
      role: 'assistant',
      text: '',
      toolUses: [{ tool_use_id: 'b', tool: 'Bash', input: { command: `echo ${pad} sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345` }, text: 'ok' }],
    },
  ]
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'], messages })
  await finishTurn($, seen)
  expect(seen.calls).toHaveLength(1)
  expect(seen.calls[0]?.prompt).not.toContain('sk-proj')
})

test('/clear wipes the list', async ($, on) => {
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
  await finishTurn($, seen)
  const before = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await before.find({ key: 'pick-1' })).toBeDefined()
  await before.unmount()
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'pick-1' })).toBeUndefined()
  expect(await ui.find({ text: 'engine band' })).toBeDefined()
})

test("the band yields while an agent's transcript is on screen", async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
  await finishTurn($, seen)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND, props: { ...BAND.props, view: { agentId: 'a1' } } })
    expect(await ui.find({ key: 'pick-1' })).toBeUndefined()
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    await ui.unmount()
  }
})
