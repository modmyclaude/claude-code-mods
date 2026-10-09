// API-GOTCHAS #31: one control character in a drawn string and the engine
// refuses the band's whole tree, taking every band beneath it down too.
// Second Wind draws only its own words and numbers: these tests show that
// holds even when its store and settings hold control characters, and that
// the one outside string it repeats (a word typed after /breathe) comes back
// clean.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { clean } from '../hooks/settings'
import { SURFACES, neighbour, world } from './world'
import type { Surface, World } from './world'

const CONTROLS = [
  ['BEL', '\u0007'],
  ['ESC with a CSI sequence', '\u001b[2J'],
  ['DEL', '\u007f'],
  ['NUL', '\u0000'],
  ['C1 CSI (U+009B)', '\u009b31m'],
] as const
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
/** /breathe's answers and the share card break lines on purpose: newline is their one control. */
const CONTROL_BUT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/
const ALL = CONTROLS.map(([, c]) => c).join('')

/** Every string anywhere in a drawn tree: texts, labels, alts, SVG source, keys. */
function strings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) for (const child of node) strings(child, out)
  else if (node !== null && typeof node === 'object') for (const value of Object.values(node)) strings(value, out)
  return out
}

/** The band with the neighbour beneath. The kit rejects the mount when the engine refuses the tree. */
async function band($: Engine, w: World, surface: Surface) {
  const ui = await w.band($, surface)
  expect(await ui.find({ type: 'Text', text: 'neighbour mod' }), surface).toBeDefined()
  for (const text of strings(await ui.drawn())) expect(text, surface).not.toMatch(CONTROL)
  return ui
}

describe('control characters (API-GOTCHAS #31)', () => {
  test('clean() handles each control class, bidi and zero-width', () => {
    const cases: [string, string][] = [
      ['loud\u0007', 'loud�'],
      ['\u001b[2Jloud\u001b[0m', 'loud'],
      ['loud\u007f', 'loud�'],
      ['lo\u0000ud', 'lo�ud'],
      ['loud\u009b31m', 'loud'],
      ['\u001b]0;title\u0007loud', 'loud'],
      ['lo\u200bud\u202e', 'loud'],
      ['lo\tud\n', 'lo ud '],
      ['on', 'on'],
    ]
    for (const [raw, out] of cases) expect(clean(raw)).toBe(out)
  })

  for (const [name, c] of CONTROLS) {
    test(`${name} in a word typed after /breathe is repeated clean`, async ($, on) => {
      const w = world(on)
      const text = (await w.breathe($, `loud${c}`)).text ?? ''
      expect(text).not.toMatch(CONTROL)
      expect(text).toMatch(/^Second Wind does not know "loud�?"\. Use \/breathe/)
    })
  }

  test(
    'everything else drawn is its own: band, card, fold, spinner and /breathe from a store full of control characters',
    { plugins: [neighbour], options: { movementCard: true } },
    async ($, on) => {
      const dirty = {
        stats: {
          v: 1, day: `2026-10-09${ALL}`, today: { breaths: ALL, eyeRests: 2 }, all: { breaths: `7${ALL}` },
          streak: ALL, streakDay: `${ALL}2026-10-08`, longTurns: 4,
        },
        switch: { off: ALL, snoozeDay: ALL },
      }
      const w = world(on, { store: dirty })
      await w.start($)
      await w.clock.advance(3000)
      for (const surface of SURFACES) {
        const ui = await band($, w, surface)
        expect((await ui.find({ key: 'sw-cue' }))?.text).toBe('Breathe in 4')
        await ui.unmount()
        const spin = await w.spinner($, surface)
        for (const text of strings(await spin.drawn())) expect(text, surface).not.toMatch(CONTROL)
        await spin.unmount()
      }
      // Typing: the one quiet line.
      await w.edit($, '', 0, 0, 'k')
      for (const surface of SURFACES) await (await band($, w, surface)).unmount()
      await w.edit($, 'k', 0, 1, '')

      // Past 60 seconds: the fifth long turn offers the movement card.
      await w.clock.advance(60_000)
      for (const surface of SURFACES) {
        const ui = await band($, w, surface)
        expect((await ui.find({ key: 'sw-card' }))?.text).toContain('Stand up and stretch')
        await ui.unmount()
      }

      // Claude answers: the closing exhale folds into one line.
      await w.complete($)
      const watch = await w.band($, 'terminal')
      for (let waited = 0; waited < 12_000 && (await watch.find({ key: 'sw-fold' })) === undefined; waited += 125) await w.clock.advance(125)
      await watch.unmount()
      for (const surface of SURFACES) {
        const ui = await band($, w, surface)
        expect((await ui.find({ key: 'sw-fold' }))?.text).toMatch(/^\d+ breaths? while Claude worked/)
        await ui.unmount()
      }

      for (const args of ['', 'card', 'help']) expect((await w.breathe($, args)).text ?? '').not.toMatch(CONTROL_BUT_NEWLINE)
      expect(w.rec.copies).toHaveLength(1)
      for (const copied of w.rec.copies) expect(copied).not.toMatch(CONTROL_BUT_NEWLINE)
    },
  )

  test('where only VS Code draws, the status line carries the same clean words', async ($, on) => {
    const w = world(on, { surfaces: ['vscode'], store: { stats: { day: ALL, streakDay: ALL, all: { breaths: ALL } } } })
    await w.start($)
    await w.clock.advance(3000)
    await w.complete($)
    await w.clock.advance(3375)
    expect(w.rec.statuses.length).toBeGreaterThan(1)
    for (const status of w.rec.statuses) expect(status ?? '').not.toMatch(CONTROL)
  })
})
