// The switch: `enabled` off, as /config or the modmyclaude hub sets it, leaves Halftime
// inert: no band, no board, no whistle, no timer, Claude's prompts and questions untouched;
// on, /halftime offers the paused run back. The engine reloads the mod with the new value
// (the first test, by its options); the config.set hook flips it at once (the others,
// through a stand-in for the engine's own config row).

import { expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BAND, METER, SURFACES, VIEWPORT, bandText, boardOf, halftime, meterCount, play, said, world } from './fixtures'
import { test } from './limit'

const OFF = 'Halftime is off. /mods or /config turns it on.'
const MAIN_TURN = { text: 'refactor the parser', turnId: 'main-1' }

const band = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'halftime', surface, component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })

/** What each surface's band draws, mounted fresh. */
async function bands($: Engine) {
  const out: string[] = []
  for (const surface of SURFACES) {
    const ui = await band($, surface)
    out.push(await bandText(ui))
    await ui.unmount()
  }
  return out
}

test('switched off: no band, no board, no whistle, no timer, and turns, prompts and questions pass untouched', { plugins: [METER], options: { enabled: false } }, async ($, on) => {
  const { clock, seen } = world(on, { store: { auto: true, 'best:cratehop': 412 } })
  on('session.end', () => ({ sessionId: 's' }))
  const writes: string[] = []
  on('state.set', ($, e, next) => (writes.push(e.key), next(e)))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  // The command stays, so the person can learn it is off; its bests are read in, nothing more.
  expect(seen.commands).toEqual(['halftime'])

  expect(await $.turn.start(MAIN_TURN)).toEqual({ turnId: 'main-1' })
  await clock.advance(15_000) // auto mode would offer a game at 10 s
  // What is drawn beneath still shows; nothing of Halftime's.
  expect(await bands($)).toEqual(['ENGINE', 'ENGINE'])
  const survey = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, hasSurvey: true }, viewport: VIEWPORT })
  expect(await bandText(survey)).toBe('ENGINE')
  await survey.unmount()

  // No whistle: Claude's prompts and questions pass as they came.
  expect(await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })).toEqual({ decision: { behavior: 'deny', message: 'the test world answers no' } })
  expect(await $.classic.Elicitation({ mcp_server_name: 'tracker', message: 'Which project?' })).toEqual({})
  expect(await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })).toEqual({})
  expect(await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)).toEqual({ result: { answers: { 'Ship it?': 'Yes' } }, text: 'User answered: Yes' })
  expect(seen.questions).toBe(1)
  expect(await $.classic.PostToolBatch({ tool_calls: [] })).toEqual({})
  const hint = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'PromptHint', props: { isDraft: true, isWorking: true, hint: '' } })
  expect(await bandText(hint)).toBe('ENGINE')
  await hint.unmount()
  expect(await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 'main-1', reason: 'answer' })).toEqual({ text: 'done' })
  // VS Code's command row is the engine's, not the scorecard.
  const row = await $.ui.mount({ plugin: 'halftime', surface: 'vscode', component: 'CommandOutput', props: { command: 'halftime', args: '', text: 'halftime', isErrored: false } })
  expect(await bandText(row)).toBe('ENGINE')
  await row.unmount()

  // /halftime, any word, says it is off and hands Claude nothing.
  expect(await said($, seen, 'cratehop')).toBe(OFF)
  expect(await said($, seen, '')).toBe(OFF)
  await $.session.end({ reason: 'exit' } as never)
  await clock.advance(30_000)
  expect(meterCount(seen), 'no clock read, no timer').toBe(0)
  expect(writes).toEqual(['stats'])
  expect(seen.copies).toEqual([])
})

test('flipped live: off pauses the run, clears the band and stops the 3-2-1 at once; on, /halftime offers the run back', { plugins: [METER] }, async ($, on) => {
  const { clock, seen } = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await $.turn.start(MAIN_TURN)
  await $.command.run(halftime('cratehop'))
  const ui = await band($, 'terminal')
  await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
  await play(clock, ui, 600)
  expect((await boardOf(ui))?.live).toBe(true)
  // A whistle and Claude moving on: the 3-2-1 runs on the module's one timer.
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await $.classic.PostToolBatch({ tool_calls: [] })
  expect((await boardOf(ui))?.wait).toBe('back in 3...')

  await $.config.set({ key: 'halftime.enabled', value: false, previous: true, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  expect(await bandText(ui)).toBe('ENGINE')
  expect(await bands($)).toEqual(['ENGINE', 'ENGINE'])
  const calls = meterCount(seen)
  await clock.advance(10_000)
  await ui.advance(10_000)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  expect(meterCount(seen), 'nothing ticks or reads the clock while off').toBe(calls)
  expect(await bandText(ui)).toBe('ENGINE')

  // On again: the band stays closed, as /halftime off leaves it, and the picker offers the run back.
  await $.config.set({ key: 'halftime.enabled', value: true, previous: false, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  expect(await bandText(ui)).toBe('ENGINE')
  await said($, seen, '')
  expect(await bandText(ui)).toContain('[back to cratehop]')
  await ui.press({ key: 'resume' })
  expect((await boardOf(ui))?.live).toBe(false)
  await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
  await play(clock, ui, 600)
  expect((await boardOf(ui))?.live).toBe(true)
  expect(meterCount(seen)).toBeGreaterThan(calls)
})

// The engine reloads the mod with the new value and its session state outlives the reload, so a
// game can still be in state while the mod is off. Here the flip's own clean-up is held a minute,
// three times over: during a whistle, a 3-2-1 and a run in play.
test('off with a game still in state: nothing drawn, nothing ticks, nothing written', { plugins: [METER] }, async ($, on) => {
  const { clock, seen } = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  let isHolding = false
  let isHeld = false
  const writes: string[] = []
  on('state.set', async ($, e, next) => {
    if (isHolding) {
      isHolding = false
      isHeld = true
      await clock.sleep(60_000)
    }
    writes.push(e.key)
    return next(e)
  })
  /** The next state write is held a minute: set before switching off, so the clean-up is held. */
  function holdNextWrite() {
    isHolding = true
    isHeld = false
  }
  /** Waits until the clean-up is held; nothing written before that counts. */
  async function untilHeld() {
    for (let i = 0; i < 100 && !isHeld; i++) await Promise.resolve()
    expect(isHeld, 'the clean-up is held').toBe(true)
    writes.length = 0
  }
  /** The paused run back in play, once the switch is on again. */
  async function backInPlay(ui: Awaited<ReturnType<typeof band>>) {
    await said($, seen, '')
    await ui.press({ key: 'resume' })
    await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
    await play(clock, ui, 300)
    expect((await boardOf(ui))?.live).toBe(true)
  }

  await $.turn.start(MAIN_TURN)
  await $.command.run(halftime('cratehop'))
  const ui = await band($, 'terminal')
  await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
  await play(clock, ui, 300)

  // A whistle: Claude moving on while off resumes nothing.
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  holdNextWrite()
  let flipped = $.config.set({ key: 'halftime.enabled', value: false, previous: true, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  await untilHeld()
  expect(await bands($)).toEqual(['ENGINE', 'ENGINE'])
  await $.classic.PostToolBatch({ tool_calls: [] })
  expect(writes).toEqual([])
  await clock.advance(60_000)
  await flipped

  // A 3-2-1: its tick, and a reload's pick-up, start nothing.
  await $.config.set({ key: 'halftime.enabled', value: true, previous: false, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  await backInPlay(ui)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await $.classic.PostToolBatch({ tool_calls: [] })
  expect((await boardOf(ui))?.wait).toBe('back in 3...')
  holdNextWrite()
  flipped = $.config.set({ key: 'halftime.enabled', value: false, previous: true, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  await untilHeld()
  await clock.advance(3000)
  expect(writes).toEqual([])
  const every = meterCount(seen, 'every')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(3000)
  expect(meterCount(seen, 'every')).toBe(every)
  expect(writes, 'its bests read in again, nothing more').toEqual(['stats'])
  expect(await bands($)).toEqual(['ENGINE', 'ENGINE'])
  await clock.advance(60_000)
  await flipped

  // A run in play: the board's late posts and the prompt line's pause change nothing.
  await $.config.set({ key: 'halftime.enabled', value: true, previous: false, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  await backInPlay(ui)
  const hint = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'PromptHint', props: { isDraft: true, isWorking: true, hint: '' } })
  holdNextWrite()
  flipped = $.config.set({ key: 'halftime.enabled', value: false, previous: true, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  await untilHeld()
  await clock.settle()
  await ui.post({ iid: 'late', arm: 0, ev: [], tick: true })
  await hint.unmount()
  expect(writes).toEqual([])
  expect(await bands($)).toEqual(['ENGINE', 'ENGINE'])
  await clock.advance(60_000)
  await flipped
})
