// A terminal with no mouse reporting (the classic renderer) never sends
// the board its click. The band's focus chord (ctrl+x tab) and the letter pad
// under the board take the keys instead, and the run plays from the keyboard.

import { expect, test } from 'claude-code/testing'

import type { On } from 'claude-code'
import type { Engine, Plugin } from 'claude-code/testing'

import { GAME_IDS, gameOf } from '../hooks/games'
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

test('with no click, a pad letter takes the keys and a realtime run plays and ticks', async ($, on) => {
  const { clock, ui } = await boardUp($, on, 'cratehop')
  const pad = await ui.findAll({ type: 'Button', in: (await boardOf(ui))!.key })
  expect(pad.map(button => [button.key, button.props.hotkey, button.props.label])).toEqual([['pad:w', 'w', 'jump'], ['pad:p', 'p', 'pause']])
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

test('a click takes the keys the usual way, and the pad steps aside', async ($, on) => {
  const { ui } = await boardUp($, on, 'merge')
  expect(await ui.find({ key: 'pad:a', in: (await boardOf(ui))!.key })).toBeDefined()
  await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left' })
  expect((await boardOf(ui))?.live).toBe(true)
  expect(await ui.find({ key: 'pad:a', in: (await boardOf(ui))!.key })).toBeUndefined()
})

test('every pad is letters only, one per action, never y, n, Enter or a digit', () => {
  for (const game of GAME_IDS) {
    for (const status of ['ready', 'over'] as const) {
      const pad = padFor({ game, status } as Parameters<typeof padFor>[0]).map(([key]) => key)
      expect(pad.length, game).toBeGreaterThan(1)
      for (const key of pad) expect(key, `${game} ${key}`).toMatch(/^[a-z]$/)
      for (const key of pad) expect(['y', 'n'], `${game} ${key}`).not.toContain(key)
      expect(new Set(pad).size, game).toBe(pad.length)
      // Every action the game has is reachable from the pad, so no game ships unplayable from it.
      const controls = gameOf(game).controls
      expect(new Set(pad.filter(key => key in controls).map(key => controls[key])), game).toEqual(new Set(Object.values(controls)))
    }
  }
})

// A live session refuses a band tree that puts the
// engine's own node under a Box that sizes, hides or moves it, and draws its
// own band instead. The kit does not check this, so the test walks the tree.
const ENGINE_BENEATH: Plugin = {
  name: 'engine-beneath',
  tier: 'append',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as never)
  },
}
const CONCEALING = ['display', 'overflow', 'position', 'width', 'height', 'minWidth', 'minHeight', 'top', 'left', 'right', 'bottom']
type DrawnNode = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
function engineNodeConcealers(node: unknown, around: string[] = []): string[][] {
  if (node === null || typeof node !== 'object') return []
  const n = node as DrawnNode
  if (n.type === 'engine') return [around]
  const mine = n.type === 'Box' ? CONCEALING.filter(k => n.props?.[k] !== undefined) : []
  return (n.children ?? []).flatMap(c => engineNodeConcealers(c, [...around, ...mine]))
}

test('#39: the engine band beneath is never under a Box that sizes or hides it', { plugins: [ENGINE_BENEATH] }, async ($, on) => {
  const { ui } = await boardUp($, on, 'cratehop')
  expect(await boardOf(ui)).toBeDefined()
  expect(engineNodeConcealers(await ui.drawn())).toEqual([[]])
  await ui.press({ key: 'pad:w' })
  expect(engineNodeConcealers(await ui.drawn())).toEqual([[]])
})

test('Bolt stands beside the game picker, on the terminal and the desktop', async ($, on) => {
  world(on, { store: new Map() })
  await $.command.run(halftime(''))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'halftime', surface, component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
    expect(await ui.find({ key: 'pick:cratehop' }), surface).toBeDefined()
    expect(await ui.find({ key: 'bolt' }), surface).toBeDefined()
    await ui.unmount()
  }
})
