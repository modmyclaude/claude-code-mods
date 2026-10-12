// What the review asked for, through the real wiring: an unattended
// realtime run pauses itself, command answers stay out of the model's
// context, the whistle line keeps the result on screen where copy cannot
// reach a clipboard, the five behaviours no test pinned before (mutants M1
// to M5), and the band's stacking.

import { expect, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import type { RenderSurface } from 'claude-code'

import { IDLE_PAUSE_MS } from '../hooks/engine'
import { initSweep } from '../hooks/games/sweep'
import { dailySeed } from '../hooks/rng'
import { BAND, METER, SURFACES, VIEWPORT, bandText, boardOf, cellAt, fieldText, halftime, meterCount, play, said, world } from './fixtures'

const MAIN_TURN = { text: 'refactor the parser', turnId: 'main-1' }
const turnDone = (turnId: string, agentId?: string) => ({
  answer: 'done', durationMs: 1000, isAborted: false, turnId, reason: 'answer' as const, ...(agentId ? { agentId } : {}),
})
const LONG = { timeoutMs: 60_000 }

type Totals = { playedMs: number; waitPlayedMs: number; runs: number }

// A realtime run nobody plays stops ticking, and its idle time never counts.

test('a realtime run with no key or click for 20 s pauses itself, stops its frame clock, and counts none of the idle time', { plugins: [METER], ...LONG }, async ($, on) => {
  const disk = new Map<string, unknown>()
  const { clock, seen } = world(on, { store: disk })
  await $.turn.start(MAIN_TURN)
  await $.command.run(halftime('tailchase'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  // The click takes the keys; then Esc (which the mod never hears) or a walk-away: no input at all.
  await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left' })
  await play(clock, ui, IDLE_PAUSE_MS - 1_000)
  expect((await boardOf(ui))?.live).toBe(true)
  await play(clock, ui, 2_000)
  const idle = await boardOf(ui)
  expect(idle?.live).toBe(false)
  expect(idle?.wait).toContain('paused')

  // The frame clock is stopped: nothing is processed, scheduled or redrawn from here on.
  const calls = meterCount(seen)
  await ui.advance(60_000)
  await clock.advance(60_000)
  expect(meterCount(seen)).toBe(calls)
  expect(fieldText((await boardOf(ui))!)).toEqual(fieldText(idle!))
  // Twenty seconds with nobody at the board are not play: nothing was added to the totals.
  expect(disk.get('totals')).toBeUndefined()

  // Back at the board: a click and a key, two seconds of play, and only those two count.
  await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left' })
  await ui.key({ key: 'right' })
  await play(clock, ui, 2_000)
  await ui.press({ key: 'close' })
  const totals = disk.get('totals') as Totals
  expect(totals.playedMs).toBeGreaterThan(1_500)
  expect(totals.playedMs).toBeLessThan(2_500)
  expect(totals.waitPlayedMs).toBe(totals.playedMs)
})

test('a key now and then keeps a realtime run in play well past 20 s, and all of it counts', LONG, async ($, on) => {
  const disk = new Map<string, unknown>()
  const { clock } = world(on, { store: disk })
  await $.command.run(halftime('tailchase'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left' })
  for (let i = 0; i < 4; i += 1) {
    await play(clock, ui, 15_000)
    // Already heading right: the snake does not change, but someone is clearly there.
    await ui.key({ key: 'right' })
  }
  expect((await boardOf(ui))?.live).toBe(true)
  await ui.press({ key: 'close' })
  expect((disk.get('totals') as Totals).playedMs).toBeGreaterThan(59_000)
})

// /halftime answers never become text the model reads where the band can say them.

test('where the band draws, every /halftime answer is a toast and the command answers {}', async ($, on) => {
  const attached: RenderSurface[] = []
  const { seen } = world(on, { surfaces: attached })
  for (const surfaces of [['terminal'], ['desktop'], ['mobile', 'desktop']] as const) {
    attached.splice(0, attached.length, ...surfaces)
    expect(await said($, seen, '')).toBe('halftime · cratehop - · tailchase - · merge - · sweep - · 0s played while waiting')
    expect(await said($, seen, 'cratehop')).toBe('cratehop is above the prompt - click the board (or ctrl+x tab, then a key) to play')
    expect(await said($, seen, 'auto on')).toContain('auto is on')
    expect(await said($, seen, 'auto off')).toBe('auto is off')
    expect(await said($, seen, 'off')).toBe('closed')
    expect(await said($, seen, 'zzz')).toContain('/halftime opens the picker')
  }
})

test('a /halftime that fails says so in a toast, still with no text for the model', async ($, on) => {
  // Nothing beneath answers the store, so turning auto on throws inside the hook.
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  expect(await $.command.run(halftime('auto on'))).toEqual({})
  expect(toasts).toEqual(['that did not work - try /halftime again'])
})

for (const surface of ['vscode', 'mobile'] as const) {
  test(`${surface} draws no band, so the command's row is the scorecard, as the CommandOutput hook draws it`, async ($, on) => {
    const { seen } = world(on, { surfaces: [surface], store: { 'best:cratehop': 412 } })
    await $.session.start({ cwd: '/', surface, isInteractive: true } as never)
    const scorecard = 'halftime · cratehop 412 · tailchase - · merge - · sweep - · 0s played while waiting'
    const answer = await $.command.run(halftime('cratehop'))
    expect(answer).toEqual({ text: scorecard })
    expect(seen.toasts).toEqual([])
    // The row the engine raises from that text: the hook draws the scorecard in its place.
    const row = await $.ui.mount({ plugin: 'halftime', surface, component: 'CommandOutput', props: { command: 'halftime', args: 'cratehop', text: scorecard, isErrored: false } })
    const drawn = await bandText(row)
    expect(drawn).toContain(scorecard)
    expect(drawn).toContain('games play in the terminal and the desktop app')
  })
}

// Where copy has no clipboard (the desktop app), the result stays on screen to select.

const NOCLIP: Plugin = {
  name: 'noclip',
  tier: 'prepend',
  register(on) {
    on('ui.copy', () => ({ value: { isCopied: false as const, reason: 'no-clipboard' as const } }))
  },
}

test('a copy with no clipboard in the whistle line leaves the result there to select', { plugins: [NOCLIP] }, async ($, on) => {
  const { seen } = world(on)
  await $.turn.start(MAIN_TURN)
  await $.command.run(halftime('sweep'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'desktop', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left' })
  const field = initSweep(dailySeed('sweep', '2026-10-09'))
  const mine = field.mines.indexOf(1)
  await ui.pointer({ type: 'down', ...cellAt((await boardOf(ui))!, mine % field.w, Math.floor(mine / field.w)), button: 'left' })
  await $.turn.complete(turnDone('main-1'))
  expect(await bandText(ui)).toContain('whistle: Claude needs you')
  await ui.press({ key: 'copy' })
  expect(seen.toasts).toContain('this surface cannot copy - select the line instead')
  // The share line is its own line, whole, so it can be selected.
  const share = await ui.find({ type: 'Text', text: /^halftime daily 10-09 · sweep lost · played/ })
  expect(share).toBeDefined()
})

// The five behaviours the suite did not pin (each test kills one of the reviewer's mutants).

test('M1: a question shows only after the board is gone (the whistle comes before the dialog)', async ($, on) => {
  let boardDuringQuestion: boolean | null = null
  let mounted: { drawn: () => Promise<unknown> } | null = null
  on('tool.call', { tool: 'AskUserQuestion' }, async () => {
    // The question is on screen now: the board must already be closed.
    boardDuringQuestion = mounted ? (await boardOf(mounted)) !== undefined : null
    return { result: {} as never, text: 'User answered: Yes' }
  })
  world(on)
  await $.turn.start(MAIN_TURN)
  await $.command.run(halftime('merge'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  mounted = ui
  await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left' })
  expect(await boardOf(ui)).toBeDefined()
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  expect(boardDuringQuestion).toBe(false)
})

test('M2: two loops waiting - one moving on does not resume while the other still needs you', async ($, on) => {
  const { clock } = world(on)
  await $.turn.start(MAIN_TURN)
  await $.command.run(halftime('cratehop'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
  await play(clock, ui, 300)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await $.classic.PermissionRequest({ tool_name: 'Write', tool_input: {}, agent_id: 'agent-3', agent_type: 'general-purpose' })
  await $.classic.PostToolBatch({ tool_calls: [] })
  // agent-3's dialog is still up: no board, no countdown.
  expect(await boardOf(ui)).toBeUndefined()
  expect(await bandText(ui)).toContain('whistle: Claude needs you')
  await $.classic.PostToolBatch({ tool_calls: [], agent_id: 'agent-3' })
  expect((await boardOf(ui))?.wait).toBe('back in 3...')
})

test('M3: a stalled frame clock (a throttled or sleeping surface) credits at most one capped tick of play', async ($, on) => {
  const disk = new Map<string, unknown>()
  const { clock } = world(on, { store: disk })
  await $.turn.start(MAIN_TURN)
  await $.command.run(halftime('tailchase'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left' })
  await play(clock, ui, 600)
  // Real time runs on while the frame clock stalls (kept under the idle pause, which would drop it anyway).
  await clock.advance(15_000)
  await ui.advance(60)
  await ui.key({ key: 'p' })
  await ui.press({ key: 'close' })
  const totals = disk.get('totals') as Totals | undefined
  expect(totals?.playedMs ?? 0).toBeGreaterThan(0)
  expect(totals?.playedMs ?? 0).toBeLessThan(5_000)
})

test('M4: the share line counts the main turn a run overlapped, even after that turn ended', async ($, on) => {
  const { clock } = world(on)
  await $.turn.start(MAIN_TURN)
  await $.command.run(halftime('sweep'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left' })
  await clock.advance(120_000)
  // The turn ends (2 minutes in), play on, then lose on a mine.
  await $.turn.complete(turnDone('main-1'))
  await ui.press({ key: 'play-on' })
  await clock.advance(3000)
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left' })
  const field = initSweep(dailySeed('sweep', '2026-10-09'))
  const mine = field.mines.indexOf(1)
  await ui.pointer({ type: 'down', ...cellAt((await boardOf(ui))!, mine % field.w, Math.floor(mine / field.w)), button: 'left' })
  expect(await bandText(ui)).toContain('of a 2m turn')
})

test('M5: the session ending mid-run banks the time played (no minutes lost on exit)', async ($, on) => {
  on('session.end', () => ({ sessionId: 's' }))
  const disk = new Map<string, unknown>()
  const { clock } = world(on, { store: disk })
  await $.turn.start(MAIN_TURN)
  await $.command.run(halftime('tailchase'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left' })
  await play(clock, ui, 10_000)
  expect(disk.get('totals')).toBeUndefined()
  await $.session.end({ reason: 'exit' } as never)
  const totals = disk.get('totals') as Totals | undefined
  expect(totals?.playedMs ?? 0).toBeGreaterThan(9_000)
})

// #25: the band composes what other mods draw there (their lines above the game, one row kept for them).

/** Another band mod beneath halftime: one line of its own. */
const BENEATH: Plugin = {
  name: 'beneath',
  tier: 'append',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['BENEATH-LINE'] }))
  },
}

/** A well-behaved band mod above halftime: its line, then what `next(e)` drew. */
const ABOVE: Plugin = {
  name: 'above',
  tier: 'prepend',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const below = await next(e)
      return { type: 'Box', props: { flexDirection: 'column' }, children: [{ type: 'Text', props: {}, children: ['ABOVE-LINE'] }, below] }
    })
  },
}

for (const surface of SURFACES) {
  test(`#25: a one-line mod beneath stays drawn above halftime in every phase (${surface})`, { plugins: [BENEATH] }, async ($, on) => {
    const { clock } = world(on)
    const ui = await $.ui.mount({ plugin: 'halftime', surface, component: 'AbovePrompt', props: { ...BAND, maxRows: 6, bodyColumns: 30 }, viewport: VIEWPORT })
    expect(await bandText(ui)).toBe('BENEATH-LINE')
    await $.command.run(halftime(''))
    let text = await bandText(ui)
    expect(text.startsWith('BENEATH-LINE')).toBe(true)
    expect(text).toContain('[tailchase]')
    await ui.press({ key: 'pick:tailchase' })
    await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left' })
    await play(clock, ui, 300)
    text = await bandText(ui)
    expect(text.startsWith('BENEATH-LINE')).toBe(true)
    const b = await boardOf(ui)
    expect(b?.live).toBe(true)
    // maxRows 6: one row kept for the mod beneath, the title and four field rows for the board.
    expect(b?.rows.length).toBe(4)
    await $.turn.start(MAIN_TURN)
    await $.turn.complete(turnDone('main-1'))
    text = await bandText(ui)
    expect(text.startsWith('BENEATH-LINE')).toBe(true)
    expect(text).toContain('whistle: Claude needs you')
  })

  test(`#25: a well-behaved mod above keeps halftime's board beneath it (${surface})`, { plugins: [ABOVE] }, async ($, on) => {
    world(on)
    await $.command.run(halftime('merge'))
    const ui = await $.ui.mount({ plugin: 'halftime', surface, component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
    const text = await bandText(ui)
    expect(text.startsWith('ABOVE-LINE')).toBe(true)
    expect(text).toContain('ENGINE')
    expect(await boardOf(ui)).toBeDefined()
  })
}
