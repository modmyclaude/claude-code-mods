// /breathe through the engine: registration, stats, on/off/snooze and the
// share card, with the band they switch drawn on both surfaces.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { SAFETY } from '../hooks/settings'
import { DAY_MS, SURFACES, T0, timerSpy, world } from './world'
import type { World } from './world'

/** /breathe as the person types it: the model gets nothing; the answer is a transcript note. */
async function say($: Engine, w: World, args = '') {
  const r = await w.say($, args)
  expect(r.result.text).toBeUndefined()
  return r
}

/** One main turn with two breaths out (the sigh and one slow breath), then its fold cleared. */
async function turn($: Engine, w: World) {
  await w.start($)
  await w.clock.advance(3000 + 26_000)
  await w.complete($)
  await w.clock.advance(10_000)
}

const shown = async (w: World, $: Engine) => {
  const out: boolean[] = []
  for (const surface of SURFACES) {
    const ui = await w.band($, surface)
    out.push((await ui.find({ key: 'second-wind' })) !== undefined)
    await ui.unmount()
  }
  return out
}

describe('/breathe', () => {
  test('is registered at session start and runs at once, even mid-turn', async ($, on) => {
    const w = world(on)
    await w.session($)
    expect(w.rec.registered).toEqual([{ name: 'breathe', immediate: true }])
  })

  test("shows today's stats, the settings and the safety line", { options: { motion: 'still', pattern: 'box' } }, async ($, on) => {
    const w = world(on)
    await turn($, w)
    const r = await say($, w)
    expect(r.text).toContain('Second Wind is on.')
    expect(r.text).toContain('Today: 2 breaths · 0 eye rests · 0 stretches · 1-day streak')
    expect(r.text).toContain('All time: 2 breaths while Claude worked')
    expect(r.text).toContain('pattern box (box breathing) · motion still · delay 3s · eye rest on · stretch on · movement card off')
    expect(r.text).toContain(SAFETY)
  })

  test('help carries the safety line; an unknown word gets the usage', async ($, on) => {
    const w = world(on)
    expect((await say($, w, 'help')).text).toContain(SAFETY)
    expect((await say($, w, 'loud')).text).toBe('Second Wind does not know "loud". Use /breathe, /breathe on, /breathe off, /breathe snooze or /breathe card.')
  })

  test('off hides the band at once and stops its clock; on brings it back next turn', { plugins: [timerSpy] }, async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000)
    expect(await shown(w, $)).toEqual([true, true])
    expect((await say($, w, 'off')).text).toBe('Second Wind is off. /breathe on brings it back.')
    expect(await shown(w, $)).toEqual([false, false])
    const ticks = w.timers().all
    await w.clock.advance(30_000)
    expect(w.timers().all).toBe(ticks)
    await w.complete($)
    await w.start($)
    await w.clock.advance(5000)
    expect(await shown(w, $)).toEqual([false, false])
    expect(w.store.get('switch')).toEqual({ off: true, snoozeDay: null })
    await w.complete($)
    expect((await say($, w, 'on')).text).toBe('Second Wind is on. It shows once a turn has run 3s.')
    await w.start($)
    await w.clock.advance(3000)
    expect(await shown(w, $)).toEqual([true, true])
  })

  test('snooze is off for the rest of today, and back tomorrow', async ($, on) => {
    const w = world(on)
    expect((await say($, w, 'snooze')).text).toContain('snoozed for the rest of today')
    expect((await say($, w)).text).toContain('Second Wind is snoozed for the rest of today.')
    await w.start($)
    await w.clock.advance(5000)
    expect(await shown(w, $)).toEqual([false, false])
    await w.complete($)
    await w.clock.set(T0 + DAY_MS)
    await w.start($)
    await w.clock.advance(3000)
    expect(await shown(w, $)).toEqual([true, true])
  })

  test('card copies a small text card of the stats', { options: { motion: 'still' } }, async ($, on) => {
    const w = world(on)
    await turn($, w)
    const r = await say($, w, 'card')
    const card = 'Second Wind\n2 breaths today · 1-day streak\n2 breaths while Claude worked, all time'
    expect(w.rec.copies).toEqual([card])
    expect(r.text).toBe(`Copied your stats card:\n\n${card}`)
  })

  test('when the clipboard says no, the card is shown to copy by hand', async ($, on) => {
    const w = world(on, { isCopied: false })
    const r = await say($, w, 'card')
    expect(r.text).toBe('Could not copy it (no-clipboard). Here it is to copy by hand:\n\nSecond Wind\n0 breaths today · 0-day streak\n0 breaths while Claude worked, all time')
  })

  test('a store that cannot save says so instead of pretending', async ($, on) => {
    const w = world(on, { storeFails: true })
    expect((await say($, w, 'off')).text).toBe('Second Wind could not save that. Try again.')
    expect((await say($, w)).text).toContain('Second Wind is on.')
  })
})
