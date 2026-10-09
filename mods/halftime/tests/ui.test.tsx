// The band as each surface draws it: the picker, a board played to its end,
// the result line and its copy, the fit to the band's own width, the
// scorecard where no board can be drawn, and the keys a board never passes on.

import { expect, test } from 'claude-code/testing'

import { initSweep } from '../hooks/games/sweep'
import { dailySeed } from '../hooks/rng'
import { BAND, ENGINE_BAND, SURFACES, T0, VIEWPORT, bandText, boardOf, fieldText, halftime, play, titleText, world } from './fixtures'

const DAY = '2026-10-09'

for (const surface of SURFACES) {
  test(`the picker starts a game, and a game can be left and picked up again (${surface})`, async ($, on) => {
    world(on)
    const text = (await $.command.run(halftime(''))).text
    expect(text).toBe('halftime · dash - · slither - · merge - · sweep - · 0s played while waiting')
    const ui = await $.ui.mount({ plugin: 'halftime', surface, component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
    const picker = await bandText(ui)
    for (const label of ['[dash]', '[slither]', '[merge]', '[sweep]', '[daily]', '[auto: off]', '[close]']) expect(picker).toContain(label)
    expect(await boardOf(ui)).toBeUndefined()

    await ui.press({ key: 'pick:merge' })
    const ready = await boardOf(ui)
    expect(titleText(ready!)).toContain('merge')
    expect(titleText(ready!)).toContain('daily 10-09')
    await ui.pointer({ type: 'down', x: 2, y: 1, button: 'left' })
    for (const key of ['left', 'up', 'right', 'down']) await ui.key({ key })
    const played = await boardOf(ui)
    expect(played?.live).toBe(true)
    expect(fieldText(played!)).not.toEqual(fieldText(ready!))
    expect(played?.ack[1]).toBe(4)

    // Off to the picker: the run waits, paused, and comes back as it was.
    await ui.press({ key: 'games' })
    expect(await bandText(ui)).toContain('[back to merge]')
    await ui.press({ key: 'resume' })
    const back = await boardOf(ui)
    expect(back?.live).toBe(false)
    expect(back?.wait).toContain('paused')
    expect(fieldText(back!)).toEqual(fieldText(played!))

    // Practice mode is a toggle in the picker and a word on the command.
    await ui.press({ key: 'games' })
    await ui.press({ key: 'mode' })
    expect(await bandText(ui)).toContain('[practice]')
    await ui.press({ key: 'pick:dash' })
    expect(titleText((await boardOf(ui))!)).toContain('practice')
    await ui.press({ key: 'close' })
    expect(await bandText(ui)).toBe('ENGINE')
  })

  test(`a sweep run to the end: result line, best, copy, again (${surface})`, async ($, on) => {
    const { clock, seen } = world(on)
    await $.command.run(halftime('sweep'))
    const ui = await $.ui.mount({ plugin: 'halftime', surface, component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
    const field = initSweep(dailySeed('sweep', DAY))
    await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left' })
    // Plant a flag with a right click, lift it again.
    const mine = field.mines.indexOf(1)
    await ui.pointer({ type: 'down', x: (mine % field.w) * 2, y: Math.floor(mine / field.w) + 1, button: 'right' })
    expect(titleText((await boardOf(ui))!)).toContain('1/14 flagged')
    await ui.pointer({ type: 'down', x: (mine % field.w) * 2, y: Math.floor(mine / field.w) + 1, button: 'right' })

    await clock.advance(46_600)
    for (let i = 0; i < field.mines.length; i += 1) {
      if (field.mines[i] || field.open[i]) continue
      await ui.pointer({ type: 'down', x: (i % field.w) * 2, y: Math.floor(i / field.w) + 1, button: 'left' })
    }
    const won = await boardOf(ui)
    expect(won?.live).toBe(false)
    expect(won?.wait).toContain('cleared in 47s')
    expect(won?.wait).toContain('new personal best')
    const line = await bandText(ui)
    expect(line).toContain('halftime daily 10-09 · sweep 47s · played 47s')
    await ui.press({ key: 'copy' })
    expect(seen.copies).toEqual(['halftime daily 10-09 · sweep 47s · played 47s'])
    expect(seen.toasts).toContain('halftime: result copied')

    // Again: the same daily field, now losing on a mine; the best stands.
    await ui.press({ key: 'again' })
    const again = await boardOf(ui)
    expect(again?.rid).toBe(2)
    expect(titleText(again!)).toContain('best 47s')
    await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left' })
    await ui.pointer({ type: 'down', x: (mine % field.w) * 2, y: Math.floor(mine / field.w) + 1, button: 'left' })
    const lost = await boardOf(ui)
    expect(lost?.wait).toContain('boom')
    expect(await bandText(ui)).toContain('halftime daily 10-09 · sweep lost · played 0s')
    expect(titleText(lost!)).toContain('best 47s')
  })

  test(`the board fits the band's body, not the terminal, and reflows without losing the run (${surface})`, async ($, on) => {
    const { clock } = world(on)
    await $.command.run(halftime('dash'))
    const narrow = { ...BAND, bodyColumns: 40 }
    const ui = await $.ui.mount({ plugin: 'halftime', surface, component: 'AbovePrompt', props: narrow, viewport: { columns: 200, rows: 50 } })
    await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
    await play(clock, ui, 600)
    const small = await boardOf(ui)
    for (const row of fieldText(small!)) expect(row.length).toBeLessThanOrEqual(40)
    await ui.redraw({ ...BAND, bodyColumns: 64 })
    const wide = await boardOf(ui)
    // The same board instance, redrawn wider.
    expect(wide?.key).toBe(small?.key)
    expect(wide?.live).toBe(true)
    expect(titleText(wide!)).toBe(titleText(small!))
    expect(fieldText(wide!)[4]!.length).toBeGreaterThan(fieldText(small!)[4]!.length)
    for (const row of fieldText(wide!)) expect(row.length).toBeLessThanOrEqual(64)
  })
}

test('a tight band keeps the field: the hint folds into the title and the field scrolls with the snake', async ($, on) => {
  const { clock } = world(on)
  await $.command.run(halftime('slither'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, maxRows: 6, bodyColumns: 30 }, viewport: VIEWPORT })
  await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left' })
  await play(clock, ui, 300)
  const b = await boardOf(ui)
  expect(b?.live).toBe(true)
  // Six rows, one left for what another mod draws beneath (API-GOTCHAS #25): while live the
  // board takes the other five (no button row), title plus four field rows.
  expect(b?.rows.length).toBe(4)
  for (const row of fieldText(b!)) expect(row.length).toBeLessThanOrEqual(30)
  expect(await bandText(ui)).not.toContain('[games]')
  const drawn = (await ui.drawn({ in: b!.key })) as { children: unknown[] }
  expect(drawn.children.length).toBe(5)
})

test('the band stacks with what other mods draw there, in every phase', async ($, on) => {
  world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    // Picker: the other mod's line stays, above the picker.
    await $.command.run(halftime(''))
    const ui = await $.ui.mount({ plugin: 'halftime', surface, component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
    expect(await bandText(ui)).toContain('ENGINE')
    expect(await bandText(ui)).toContain('[slither]')
    // Board: still there while a game is on screen.
    await ui.press({ key: 'pick:slither' })
    expect(await boardOf(ui)).toBeDefined()
    expect(await bandText(ui)).toContain('ENGINE')
    await ui.press({ key: 'close' })
    await ui.unmount()
  }
})

test('the score follows the real clock, not the frame count', async ($, on) => {
  const { clock } = world(on)
  await $.command.run(halftime('dash'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
  // A slow surface: one board frame for every 150 ms of real time. The first frame sets the
  // baseline, the next six cover 900 ms, so the runner covers about 0.9 s at ~14 cells/s.
  for (let frame = 0; frame < 7; frame += 1) {
    await clock.advance(150)
    await ui.advance(60)
  }
  const score = Number((await boardOf(ui))?.title[2]?.[0])
  expect(score).toBeGreaterThanOrEqual(11)
  expect(score).toBeLessThanOrEqual(13)
})

test('every game: Enter, y, n and digits never reach the game', async ($, on) => {
  world(on)
  for (const game of ['dash', 'slither', 'merge', 'sweep']) {
    await $.command.run(halftime(game))
    const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
    await ui.pointer({ type: 'down', x: 2, y: 1, button: 'left' })
    const before = await boardOf(ui)
    expect(before?.keys.some(k => ['return', 'enter', 'y', 'n'].includes(k) || /^[0-9]$/.test(k)), game).toBe(false)
    for (const key of ['return', 'y', 'n', 'Y', '1', '0', '9']) await ui.key({ key })
    const after = await boardOf(ui)
    expect(after?.ack, game).toEqual(before?.ack)
    expect(fieldText(after!), game).toEqual(fieldText(before!))
    // Even posted straight at the hooks module, they are ignored.
    await ui.post({ iid: 'forged', arm: 0, ev: [[1, 'y'], [2, 'n'], [3, '1'], [4, 'return']], tick: false })
    expect(fieldText((await boardOf(ui))!), game).toEqual(fieldText(before!))
    await ui.unmount()
  }
})

test('board posts that are not the board\'s shape are dropped', async ($, on) => {
  world(on)
  await $.command.run(halftime('merge'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  const before = await boardOf(ui)
  const junk = [null, 'left', { iid: 'x' }, { iid: 'x', arm: 1, ev: 'left' }, { iid: '', arm: 1, ev: [] }, { iid: 'x', arm: -1, ev: [] }, { iid: 'x', arm: 1, ev: [['1', 'left']] }]
  for (const data of junk) await ui.post(data as never)
  const after = await boardOf(ui)
  expect(after?.live).toBe(false)
  expect(fieldText(after!)).toEqual(fieldText(before!))
})

for (const surface of ['vscode', 'mobile'] as const) {
  test(`${surface}: no board can be drawn, so the command's row is a one-line scorecard`, async ($, on) => {
    const { seen } = world(on, { store: { 'best:dash': 412, 'best:sweep': 47, totals: { playedMs: 3_000_000, waitPlayedMs: 2_220_000, runs: 9 } } })
    await $.session.start({ cwd: '/', surface, isInteractive: true } as never)
    expect(seen.commands).toEqual(['halftime'])
    const ui = await $.ui.mount({ plugin: 'halftime', surface, component: 'CommandOutput', props: { command: 'halftime', args: '', text: 'halftime', isErrored: false } })
    const text = await bandText(ui)
    expect(text).toContain('halftime · dash 412 · slither - · merge - · sweep 47s · 37m played while waiting')
    expect(text).toContain('games play in the terminal and the desktop app')
  })
}

test('terminal and desktop keep the engine\'s command row', async ($, on) => {
  world(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'halftime', surface, component: 'CommandOutput', props: { command: 'halftime', args: '', text: 'x', isErrored: false } })
    expect(await ui.drawn()).toEqual(ENGINE_BAND)
  }
})

test('commands: help, off, auto, practice', async ($, on) => {
  world(on)
  expect((await $.command.run(halftime('what'))).text).toContain('/halftime opens the picker')
  expect((await $.command.run(halftime('sweep practice'))).text).toContain('sweep is above the prompt')
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  expect(titleText((await boardOf(ui))!)).toContain('practice')
  expect((await $.command.run(halftime('off'))).text).toBe('halftime: closed')
  expect(await bandText(ui)).toBe('ENGINE')
  expect((await $.command.run(halftime('auto on'))).text).toContain('auto is on')
  await $.command.run(halftime(''))
  expect(await bandText(ui)).toContain('[auto: on]')
})

test('the daily board is the same whenever in the day it is opened', async ($, on) => {
  const { clock } = world(on, { now: T0 })
  await $.command.run(halftime('merge'))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  const morning = fieldText((await boardOf(ui))!)
  await clock.advance(3 * 60 * 60 * 1000)
  await $.command.run(halftime('merge'))
  expect(fieldText((await boardOf(ui))!)).toEqual(morning)
  await $.command.run(halftime('merge practice'))
  expect(titleText((await boardOf(ui))!)).toContain('practice')
})
