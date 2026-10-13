// The whistle, through the real wiring: needs-you events raised the way the
// engine raises them, on a run being played on the board, on both surfaces
// that draw one.

import { expect } from 'claude-code/testing'

import { BAND, METER, SURFACES, VIEWPORT, bandText, boardOf, fieldText, halftime, meterCount, play, said, titleText, world } from './fixtures'
import { test } from './limit'

const MAIN_TURN = { text: 'refactor the parser', turnId: 'main-1' }
const turnDone = (turnId: string, agentId?: string) => ({
  answer: 'done', durationMs: 1000, isAborted: false, turnId, reason: 'answer' as const, ...(agentId ? { agentId } : {}),
})

for (const surface of SURFACES) {
  test(`a permission prompt mid-run freezes the run and unmounts the board; it comes back exact with a 3-2-1 (${surface})`, async ($, on) => {
    const { clock } = world(on)
    await $.turn.start(MAIN_TURN)
    await $.command.run(halftime('cratehop'))
    const ui = await $.ui.mount({ plugin: 'halftime', surface, component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })

    const ready = await boardOf(ui)
    expect(ready?.live).toBe(false)
    expect(ready?.wait).toContain('click the board to start')

    // The person clicks the board: the run starts and the board ticks.
    await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
    await play(clock, ui, 900)
    const before = await boardOf(ui)
    expect(before?.live).toBe(true)
    expect(Number(before?.title[2]?.[0])).toBeGreaterThan(5)

    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })

    // Frozen and gone: no board in the band, the whistle line in its place.
    expect(await boardOf(ui)).toBeUndefined()
    const line = await bandText(ui)
    expect(line).toContain('whistle: Claude needs you')
    expect(line).toContain('permission')
    expect(line).not.toContain('[play on]')
    await clock.advance(30_000)

    // The loop that asked moves on: back with a countdown, the very same board.
    await $.classic.PostToolBatch({ tool_calls: [] })
    const back = await boardOf(ui)
    expect(back?.rid).toBe(before?.rid)
    // A fresh board (the keys went back to the prompt), showing the same run.
    expect(back?.key).not.toBe(before?.key)
    expect(back?.live).toBe(false)
    expect(back?.wait).toBe('back in 3...')
    expect(fieldText(back!)).toEqual(fieldText(before!))
    expect(titleText(back!)).toBe(titleText(before!))

    await clock.advance(1000)
    expect((await boardOf(ui))?.wait).toBe('back in 2...')
    await clock.advance(2000)
    const live = await boardOf(ui)
    expect(live?.live).toBe(true)
    // Live again but not yet ticking: the keys went back to the prompt, so it waits for a click.
    await play(clock, ui, 600)
    expect(fieldText((await boardOf(ui))!)).toEqual(fieldText(before!))
    await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
    await play(clock, ui, 600)
    expect(Number((await boardOf(ui))?.title[2]?.[0])).toBeGreaterThan(Number(before?.title[2]?.[0]))
  })

  test(`subagents starting and finishing change nothing (${surface})`, async ($, on) => {
    const { clock } = world(on)
    await $.turn.start(MAIN_TURN)
    await $.command.run(halftime('tailchase'))
    const ui = await $.ui.mount({ plugin: 'halftime', surface, component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
    await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left' })
    await play(clock, ui, 300)

    // A subagent's turn ends and another starts: the run plays on.
    await $.turn.complete(turnDone('sub-1', 'agent-7'))
    await $.turn.start({ text: '', turnId: 'sub-2', agentId: 'agent-7' } as typeof MAIN_TURN)
    const still = await boardOf(ui)
    expect(still?.live).toBe(true)
    await play(clock, ui, 400)
    expect(fieldText((await boardOf(ui))!)).not.toEqual(fieldText(still!))

    // The main turn ends: whistle. A subagent starting does not resume it; a main turn does.
    await $.turn.complete(turnDone('main-1'))
    expect(await bandText(ui)).toContain('whistle: Claude needs you')
    await $.turn.start({ text: '', turnId: 'sub-3', agentId: 'agent-8' } as typeof MAIN_TURN)
    await $.turn.complete(turnDone('sub-3', 'agent-8'))
    expect(await boardOf(ui)).toBeUndefined()
    await $.turn.start({ text: 'next', turnId: 'main-2' })
    expect((await boardOf(ui))?.wait).toBe('back in 3...')
  })

  test(`a subagent's permission prompt still needs you; only that subagent moving on resumes (${surface})`, async ($, on) => {
    const { clock } = world(on)
    await $.turn.start(MAIN_TURN)
    await $.command.run(halftime('cratehop'))
    const ui = await $.ui.mount({ plugin: 'halftime', surface, component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
    await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
    await play(clock, ui, 300)

    await $.classic.PermissionRequest({ tool_name: 'Write', tool_input: { file_path: 'a.ts' }, agent_id: 'agent-3', agent_type: 'general-purpose' })
    expect(await boardOf(ui)).toBeUndefined()
    // The main loop's batch and another subagent's do not answer agent-3's prompt.
    await $.classic.PostToolBatch({ tool_calls: [] })
    await $.classic.PostToolBatch({ tool_calls: [], agent_id: 'agent-9' })
    expect(await boardOf(ui)).toBeUndefined()
    await $.classic.PostToolBatch({ tool_calls: [], agent_id: 'agent-3' })
    expect((await boardOf(ui))?.wait).toBe('back in 3...')
  })

  test(`the turn ending blows the whistle; play on and the next turn bring the run back (${surface})`, async ($, on) => {
    const { clock } = world(on)
    await $.turn.start(MAIN_TURN)
    await $.command.run(halftime('merge'))
    const ui = await $.ui.mount({ plugin: 'halftime', surface, component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
    await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left' })
    await ui.key({ key: 'left' })
    await ui.key({ key: 'up' })
    const before = await boardOf(ui)

    await $.turn.complete(turnDone('main-1'))
    const line = await bandText(ui)
    expect(line).toContain('whistle: Claude needs you')
    expect(line).toContain('the turn is over')
    await ui.press({ key: 'play-on' })
    expect((await boardOf(ui))?.wait).toBe('back in 3...')
    await clock.advance(3000)
    const after = await boardOf(ui)
    expect(after?.live).toBe(true)
    expect(fieldText(after!)).toEqual(fieldText(before!))
  })
}

test('coming back on your own during a whistle: the picker, then the board waits for your click', async ($, on) => {
  const { clock } = world(on)
  await $.turn.start(MAIN_TURN)
  await $.command.run(halftime('cratehop'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
  await play(clock, ui, 300)
  await $.turn.complete(turnDone('main-1'))
  await $.command.run(halftime(''))
  expect(await bandText(ui)).toContain('[back to cratehop]')
  await ui.press({ key: 'resume' })
  const paused = await boardOf(ui)
  expect(paused?.live).toBe(false)
  await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
  expect((await boardOf(ui))?.live).toBe(true)
  await play(clock, ui, 300)
  expect(fieldText((await boardOf(ui))!)).not.toEqual(fieldText(paused!))
})

test('a question for the person blows the whistle and is never answered or denied by the mod', async ($, on) => {
  const { seen } = world(on)
  await $.turn.start(MAIN_TURN)
  await $.command.run(halftime('sweep'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left' })

  const answer = await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Ship it?', header: 'Ship', options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }], multiSelect: false }] } as never)
  expect(seen.questions).toBe(1)
  expect(answer.deny).toBeUndefined()
  expect(answer.text).toBe('User answered: Yes')
  expect(await bandText(ui)).toContain('Claude has a question for you')
  expect(await boardOf(ui)).toBeUndefined()
  await $.classic.PostToolBatch({ tool_calls: [] })
  expect((await boardOf(ui))?.wait).toBe('back in 3...')
})

test('an input request from a tool and the permission notification blow it too', async ($, on) => {
  world(on)
  await $.turn.start(MAIN_TURN)
  await $.command.run(halftime('merge'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'desktop', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left' })
  await $.classic.Elicitation({ mcp_server_name: 'tracker', message: 'Which project?' })
  expect(await bandText(ui)).toContain('a tool wants your input')
  await $.classic.PostToolBatch({ tool_calls: [] })
  expect(await boardOf(ui)).toBeDefined()
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  expect(await boardOf(ui)).toBeUndefined()
  expect(await bandText(ui)).toContain('permission')
})

test('a permission a settings hook already decided shows no dialog, so no whistle', async ($, on) => {
  world(on, { permission: { decision: { behavior: 'allow' } } })
  await $.turn.start(MAIN_TURN)
  await $.command.run(halftime('merge'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  await $.classic.PermissionRequest({ tool_name: 'Read', tool_input: { file_path: 'x' } })
  expect(await boardOf(ui)).toBeDefined()
})

test('the observing hooks never block: with their own logic failing, the question and the prompt go through', async ($, on) => {
  // No clock beneath the plugin: its whistle throws on its first `$` call.
  let asked = 0
  on('tool.call', { tool: 'AskUserQuestion' }, () => {
    asked += 1
    return { result: {} as never, text: 'User answered: No' }
  })
  on('classic.PermissionRequest', () => ({}))
  const answer = await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  expect(asked).toBe(1)
  expect(answer.text).toBe('User answered: No')
  expect(answer.deny).toBeUndefined()
  expect(await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })).toEqual({})
})

test('a survey takes the band: the run pauses and the board waits for a click afterwards', { plugins: [METER] }, async ($, on) => {
  const { clock, seen } = world(on)
  await $.command.run(halftime('cratehop'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
  await play(clock, ui, 300)
  await ui.redraw({ ...BAND, hasSurvey: true })
  await clock.settle()
  expect(await bandText(ui)).toBe('ENGINE')
  await clock.advance(5000)
  await ui.redraw(BAND)
  const back = await boardOf(ui)
  expect(back?.live).toBe(false)
  expect(back?.wait).toContain('paused')
  const calls = meterCount(seen)
  await ui.advance(2000)
  await clock.advance(2000)
  expect(meterCount(seen)).toBe(calls)
  expect(fieldText((await boardOf(ui))!)).toEqual(fieldText(back!))
  // A click takes the keys back and play goes on.
  await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
  expect((await boardOf(ui))?.live).toBe(true)
})

test('zero idle: a paused or closed game schedules nothing and draws nothing new', { plugins: [METER] }, async ($, on) => {
  const { clock, seen } = world(on)
  await $.turn.start(MAIN_TURN)
  await $.command.run(halftime('tailchase'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left' })

  // While playing, the board's frame clock drives the work (the meter sees it); the
  // hooks module schedules no timer of its own.
  let calls = meterCount(seen)
  await play(clock, ui, 600)
  expect(meterCount(seen)).toBeGreaterThan(calls)
  expect(meterCount(seen, 'every') + meterCount(seen, 'after')).toBe(0)

  // The meter does see the module's timers: a whistle and a resume run the 3-2-1 on one.
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await $.classic.PostToolBatch({ tool_calls: [] })
  await clock.advance(3000)
  expect(meterCount(seen, 'every')).toBeGreaterThan(0)
  await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left' })
  await play(clock, ui, 300)

  // p pauses: the frame clock stops, nothing is processed or redrawn, nothing is scheduled.
  await ui.key({ key: 'p' })
  const paused = await boardOf(ui)
  expect(paused?.live).toBe(false)
  expect(paused?.wait).toContain('paused')
  calls = meterCount(seen)
  await clock.advance(60_000)
  await ui.advance(60_000)
  expect(meterCount(seen)).toBe(calls)
  expect(fieldText((await boardOf(ui))!)).toEqual(fieldText(paused!))

  // Closed: no board at all, and still nothing.
  await ui.press({ key: 'close' })
  expect(await bandText(ui)).toBe('ENGINE')
  calls = meterCount(seen)
  await clock.advance(60_000)
  expect(meterCount(seen)).toBe(calls)
})

test('typing at the prompt pauses a run in play (the keys have left the board)', async ($, on) => {
  const { clock } = world(on)
  await $.command.run(halftime('cratehop'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
  await play(clock, ui, 300)
  const hint = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: true, hint: '? for shortcuts' } })
  expect((await boardOf(ui))?.live).toBe(true)
  await hint.redraw({ isDraft: true, isWorking: true, hint: '' })
  await clock.settle()
  const b = await boardOf(ui)
  expect(b?.live).toBe(false)
  expect(b?.wait).toContain('paused')
})

test('auto mode only offers a line after 10 s of a main-loop turn, and never takes the keys', async ($, on) => {
  const { clock, seen } = world(on)
  expect(await said($, seen, 'auto')).toContain('auto is on')
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })

  // A subagent's turn arms nothing.
  await $.turn.start({ text: '', turnId: 'sub-1', agentId: 'agent-1' } as typeof MAIN_TURN)
  await clock.advance(20_000)
  expect(await bandText(ui)).toBe('ENGINE')

  await $.turn.start(MAIN_TURN)
  await clock.advance(9_900)
  expect(await bandText(ui)).toBe('ENGINE')
  await clock.advance(200)
  const offer = await bandText(ui)
  expect(offer).toContain('play while you wait')
  expect(offer).toContain('[cratehop]')
  // An offer, not a game: no board, nothing holds the keys.
  expect(await boardOf(ui)).toBeUndefined()

  await ui.press({ key: 'offer:merge' })
  const board = await boardOf(ui)
  expect(board?.live).toBe(false)
  expect(board?.wait).toBe('click the board to start')

  // A turn that ends before 10 s offers nothing.
  await ui.press({ key: 'close' })
  await $.turn.complete(turnDone('main-1'))
  await $.turn.start({ text: 'quick one', turnId: 'main-2' })
  await clock.advance(4_000)
  await $.turn.complete(turnDone('main-2'))
  await clock.advance(30_000)
  expect(await bandText(ui)).toBe('ENGINE')

  expect(await said($, seen, 'auto off')).toBe('auto is off')
  await $.turn.start({ text: 'long one', turnId: 'main-3' })
  await clock.advance(30_000)
  expect(await bandText(ui)).toBe('ENGINE')
})
