// Behaviour through the real wiring: turns start and end through $.turn,
// the engine's own guess arrives through $.prompt.suggest, the person types
// through $.prompt.submit, the model and every other noun are answered
// beneath the plugin, and the band is mounted and pressed on both surfaces.

import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
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

import { ENGINE_WAIT_MS, REDACTED } from '../hooks/logic'

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
    if (answer === 'deny') return { deny: 'model claude-haiku is not allowed here' }

    return { value: typeof answer === 'string' ? { isAnswered: true, text: answer, usage: USAGE } : answer }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => {
    seen.submitted.push(e)

    return seen.isSubmitRefused ? { drop: 'a policy hook refused it' } : { text: e.text }
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
    expect(await ui.find({ text: 'engine band' })).toBeUndefined()
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
  const status = await $.command.run({ command: PLUGIN, args: '', origin: TYPED, presentation: { isFullscreen: false, columns: 100 } })
  expect(status.text).toContain('taken 0, edited 0, ignored 0')
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

  const status = (await $.command.run({ command: PLUGIN, args: '', origin: TYPED, presentation: { isFullscreen: false, columns: 100 } })).text
  expect(status).toContain('taken 2, edited 0, ignored 0')
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
  const status = await $.command.run({ command: PLUGIN, args: '', origin: TYPED, presentation: { isFullscreen: false, columns: 100 } })
  expect(status.text).toContain('taken 0')
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
  const status = (await $.command.run({ command: PLUGIN, args: '', origin: TYPED, presentation: { isFullscreen: false, columns: 100 } })).text
  expect(status).toContain('ignored 3')
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

test('/crossroads shows calls and cost; off, on and forget work', async ($, on) => {
  const seen = world(on, [reply(THREE)], { surfaces: ['desktop'] })
  const run = async (args: string) =>
    (await $.command.run({ command: PLUGIN, args, origin: TYPED, presentation: { isFullscreen: false, columns: 100 } })).text ?? ''

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
  const result = await $.command.run({ command: PLUGIN, args: '', origin: TYPED, presentation: { isFullscreen: false, columns: 100 } })
  expect(result.text).toBe('Crossroads could not read its counts.')
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
