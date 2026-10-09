// MM-081: a terminal with no mouse reporting (the classic renderer) never sends
// the board its click. The band's focus chord (ctrl+x tab) and the letter pad
// under the board take the keys instead, and the run plays from the keyboard.

import { expect, test } from 'claude-code/testing'

import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { GAME_IDS } from '../hooks/games'
import { padFor } from '../hooks/view'
import { BAND, VIEWPORT, boardOf, fieldText, halftime, play, world } from './fixtures'

const MAIN_TURN = { text: 'refactor the parser', turnId: 'main-1' }

async function boardUp($: Engine, on: On, game: string) {
  const { clock } = world(on, { store: new Map() })
  await $.turn.start(MAIN_TURN)
  await $.command.run(halftime(game))
  const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  return { clock, ui }
}

test('MM-081: with no click, a pad letter takes the keys and a realtime run plays and ticks', async ($, on) => {
  const { clock, ui } = await boardUp($, on, 'cratehop')
  const pad = await ui.findAll({ type: 'Button', in: (await boardOf(ui))!.key })
  expect(pad.map(button => [button.key, button.props.hotkey])).toEqual([['pad:w', 'w'], ['pad:p', 'p']])
  expect((await boardOf(ui))?.live).toBe(false)

  await ui.press({ key: 'pad:w' })
  expect((await boardOf(ui))?.live).toBe(true)
  const before = fieldText((await boardOf(ui))!)
  await play(clock, ui, 1_000)
  // The frame clock runs: the courier has moved on.
  expect(fieldText((await boardOf(ui))!)).not.toEqual(before)
  // The pad stays drawn, since its letters now carry the keys.
  expect(await ui.find({ key: 'pad:w', in: (await boardOf(ui))!.key })).toBeDefined()

  await ui.press({ key: 'pad:p' })
  expect((await boardOf(ui))?.wait).toContain('paused')
})

test('MM-081: a click takes the keys the usual way, and the pad steps aside', async ($, on) => {
  const { ui } = await boardUp($, on, 'merge')
  expect(await ui.find({ key: 'pad:a', in: (await boardOf(ui))!.key })).toBeDefined()
  await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left' })
  expect((await boardOf(ui))?.live).toBe(true)
  expect(await ui.find({ key: 'pad:a', in: (await boardOf(ui))!.key })).toBeUndefined()
})

test('MM-081: every pad is letters only, one per action, never y, n, Enter or a digit', () => {
  for (const game of GAME_IDS) {
    for (const status of ['ready', 'over'] as const) {
      const pad = padFor({ game, status } as Parameters<typeof padFor>[0])
      expect(pad.length, game).toBeGreaterThan(1)
      for (const key of pad) expect(key, `${game} ${key}`).toMatch(/^[a-z]$/)
      for (const key of pad) expect(['y', 'n'], `${game} ${key}`).not.toContain(key)
      expect(new Set(pad).size, game).toBe(pad.length)
    }
  }
})
