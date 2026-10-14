// The switch: `enabled` off, as /config or the modmyclaude hub sets it, leaves Second Wind
// inert: no band, no spinner word, no timer, no counts, turns and prompts untouched; on, it
// is back from the next turn. The engine reloads the mod with the new value (the first
// test, by its options); the config.set hook flips it at once (the others, through a
// stand-in for the engine's own config row).

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { SURFACES, neighbour, timerSpy, world } from './world'
import type { World } from './world'

const OFF = 'Second Wind is off. /mods or /config turns it on.'

/** What each surface's band draws: its texts, and whether the desktop guide is there. */
async function bands($: Engine, w: World) {
  const out: { texts: string[]; hasGuide: boolean }[] = []
  for (const surface of SURFACES) {
    const ui = await w.band($, surface)
    out.push({ texts: (await ui.findAll({ type: 'Text' })).map(t => t.text), hasGuide: (await ui.find({ type: 'Svg' })) !== undefined })
    await ui.unmount()
  }
  return out
}

/** The mod's own toasts, not the timer spy's. */
const toasts = (w: World) => w.rec.toasts.filter(t => !t.startsWith('spy:'))

test('switched off: no band, no spinner word, no timer, no counts, and turns and prompts pass untouched', { plugins: [timerSpy, neighbour], options: { enabled: false } }, async ($, on) => {
  const w = world(on, { surfaces: ['terminal', 'desktop'] })
  const writes: string[] = []
  on('state.set', ($, e, next) => (writes.push(e.key), next(e)))
  await w.session($)
  // The command stays, so the person can learn it is off.
  expect(w.rec.registered.map(spec => spec.name)).toEqual(['breathe'])

  expect(await w.start($)).toEqual({ turnId: 'turn-1' })
  expect(await w.attach($, 'mobile')).toEqual({ clientId: 'mobile:default' })
  await w.clock.advance(3000 + 62_000)
  // What other mods draw there still shows; nothing of Second Wind's.
  expect(await bands($, w)).toEqual([
    { texts: ['neighbour mod', 'engine'], hasGuide: false },
    { texts: ['neighbour mod', 'engine'], hasGuide: false },
  ])
  for (const surface of SURFACES) {
    const spin = await w.spinner($, surface)
    expect((await spin.find({ key: 'engine-spinner-word' }))?.text, surface).toBe('Sauteing')
    await spin.unmount()
  }

  // Typing and sending: the edit lands as the editor made it, and the mod notes nothing.
  expect(await w.edit($, '', 0, 0, 'k')).toEqual({ text: 'k', cursor: 1 })
  const hint = await w.hint($, 'terminal', true)
  expect((await hint.find({ type: 'Text' }))?.text).toBe('esc to interrupt')
  await hint.unmount()
  expect(await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })).toEqual({ text: 'next' })
  expect(await w.complete($, { answer: 'Here is the fix.' })).toEqual({ text: 'Here is the fix.' })
  expect(await w.detach($, 'mobile')).toEqual({ clientId: 'mobile:default' })
  await w.clock.advance(20_000)
  expect(w.timers().all).toBe(0)
  expect(writes).toEqual([])
  expect(w.store.has('stats')).toBe(false)
  expect(w.rec.statuses).toEqual([])

  // /breathe, any word, says it is off and hands Claude nothing.
  for (const args of ['', 'on']) expect(await w.breathe($, args)).toEqual({})
  expect(toasts(w)).toEqual([OFF, OFF])
  expect(w.rec.logs).toEqual([])
  expect(w.store.has('switch')).toBe(false)
})

test('flipped live: off clears the band and stops its clock at once; on again, it shows from the next turn', { plugins: [timerSpy] }, async ($, on) => {
  const w = world(on, { surfaces: ['terminal', 'desktop'] })
  on('config.set', ($, e) => ({ value: e.value }))
  await w.session($)
  await w.start($)
  await w.clock.advance(3000 + 2000)
  const ui = await w.band($, 'terminal')
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect((await ui.find({ key: 'sw-cue' }))?.text).toBe('Breathe in 2')
  expect((await bands($, w))[1]?.hasGuide, 'desktop guide').toBe(true)

  await $.config.set({ key: 'second-wind.enabled', value: false, previous: true, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  expect(await texts()).toEqual(['engine'])
  expect(await bands($, w)).toEqual([
    { texts: ['engine'], hasGuide: false },
    { texts: ['engine'], hasGuide: false },
  ])
  const ticks = w.timers().all
  await w.clock.advance(30_000)
  expect(w.timers().all, 'no ticks while off').toBe(ticks)

  // On again in the same turn: that turn's breath was dropped, so the band waits for the next,
  // even when a client joins now.
  await $.config.set({ key: 'second-wind.enabled', value: true, previous: false, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  await w.attach($, 'mobile')
  await w.clock.advance(10_000)
  expect(await texts()).toEqual(['engine'])
  expect(w.timers().all).toBe(ticks)
  await w.complete($)
  await w.clock.advance(10_000)
  expect(await texts()).toEqual(['engine'])
  expect(w.store.has('stats')).toBe(false)

  await w.start($)
  await w.clock.advance(3000)
  expect((await ui.find({ key: 'sw-cue' }))?.text).toBe('Breathe in 4')
  expect((await bands($, w))[1]?.hasGuide, 'desktop guide').toBe(true)
  expect(w.timers().all).toBeGreaterThan(ticks)
  await w.breathe($, '')
  expect(toasts(w)).toEqual([])
  expect(w.rec.logs.length).toBeGreaterThan(0)
})

// The engine reloads the mod with the new value and its session state outlives the reload, so a
// breath can still be in state while the mod is off. Here the flip's own clean-up is held a minute.
test('off with a breath still in state: nothing drawn, nothing ticks, nothing written', { plugins: [timerSpy] }, async ($, on) => {
  const w = world(on, { surfaces: ['terminal', 'desktop'] })
  on('config.set', ($, e) => ({ value: e.value }))
  let isHolding = false
  let isHeld = false
  const writes: string[] = []
  on('state.set', async ($, e, next) => {
    if (isHolding && e.key === 'run' && e.value === null) {
      isHolding = false
      isHeld = true
      await w.clock.sleep(60_000)
    }
    writes.push(e.key)
    return next(e)
  })
  await w.session($)
  await w.start($)
  await w.clock.advance(3000 + 2000)
  writes.length = 0
  // The prompt line reports a draft just before the switch goes off; its note lands after.
  const hint = await w.hint($, 'terminal', true)
  isHolding = true
  const flipped = $.config.set({ key: 'second-wind.enabled', value: false, previous: true, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  for (let i = 0; i < 100 && !isHeld; i++) await Promise.resolve()
  expect(isHeld, 'the clean-up is held').toBe(true)
  await w.clock.settle()
  await hint.unmount()
  const ticks = w.timers().all

  expect(await bands($, w)).toEqual([
    { texts: ['engine'], hasGuide: false },
    { texts: ['engine'], hasGuide: false },
  ])
  const spin = await w.spinner($, 'terminal')
  expect((await spin.find({ key: 'engine-spinner-word' }))?.text).toBe('Sauteing')
  await spin.unmount()
  await w.clock.advance(20_000)
  expect(w.timers().all, 'no ticks while off').toBe(ticks)
  await w.complete($)
  await w.detach($, 'desktop')
  await w.detach($, 'terminal')
  await w.attach($, 'mobile')
  await w.clock.advance(20_000)
  expect(writes).toEqual([])

  // The clean-up lands: its own writes, and nothing else.
  await w.clock.advance(20_000)
  expect(await flipped).toEqual({ value: false })
  expect(writes).toEqual(['run', 'card', 'desk'])
  expect(w.timers().all).toBe(ticks)
  expect(w.store.has('stats')).toBe(false)
  expect(w.rec.statuses).toEqual([])
})
