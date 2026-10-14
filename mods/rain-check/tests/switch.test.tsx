// The switch: `enabled` off, as /config or the modmyclaude hub sets it, leaves Rain Check
// inert: no band, no hold, no timer, every prompt passed untouched; a prompt already
// waiting goes back to the person, never out. On, it is back. The engine reloads the mod
// with the new value (the first test, by its options); the config.set hook flips it at
// once (the others, through a stand-in for the engine's own config row).

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { HOUR, MIN, PERSON, RESET, SLOW, SURFACES, answered, band, measure, press, refuse, start, submit, window, world } from './world'

const OFF = 'Rain Check is off. /mods or /config turns it on.'

function rainCheck($: Engine, args: string) {
  return $.command.run({ command: 'rain-check', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
}

function flip($: Engine, value: boolean) {
  const previous = !value
  return $.config.set({ key: 'rain-check.enabled', value, previous, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
}

/** Counts the minute tick's periods (one `clock.every` dispatch each); hooked above the mocked clock. */
function ticks(on: On): () => number {
  let periods = 0
  on('clock.every', { ms: MIN }, ($, e, next) => {
    periods += 1
    return next(e)
  })
  return () => periods
}

/** Only what another mod draws above the prompt: nothing of Rain Check's, on either surface. */
async function expectNoBand($: Engine): Promise<void> {
  for (const surface of SURFACES) {
    const { ui, waiting, limit } = await band($, surface)
    expect(waiting ?? limit, surface).toBeUndefined()
    // Alone at the root, the kit drops the other line's key: found by text.
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text), surface).toEqual(["another mod's line"])
    await ui.unmount()
  }
}

test('switched off: holds nothing, draws nothing, keeps no timer, and every prompt passes untouched', { options: { enabled: false }, ...SLOW }, async ($, on) => {
  const periods = ticks(on)
  const w = world(on)
  await start($)
  await measure($, [window(100)])
  await refuse($)
  // The limit refused a turn, and what the person sends still goes out as typed.
  expect(await submit($, 'run the tests')).toEqual({ text: 'run the tests' })
  expect(w.sent).toEqual([{ text: 'run the tests', origin: PERSON }])
  await expectNoBand($)

  // The command stays, so the person can learn it is off.
  expect(await rainCheck($, '')).toEqual({})
  expect(await rainCheck($, 'now')).toEqual({})
  expect(w.toasts).toEqual([OFF, OFF])

  // Past the reset nothing ticks and nothing is sent.
  await answered($)
  await w.clock.advance(6 * HOUR)
  expect(periods()).toBe(0)
  expect(w.sent).toHaveLength(1)
  expect(w.toasts).toEqual([OFF, OFF])
  expect(w.fills).toEqual([])
  expect(w.logs).toEqual([])
})

test('flipped live: a waiting prompt goes back to the box, never out, and nothing more is held; on brings it back', SLOW, async ($, on) => {
  const periods = ticks(on)
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  await measure($, [window(100)])
  await refuse($)
  expect((await submit($, 'run the tests')).drop).toContain('Usage limit reached')
  const held = await band($, 'terminal')
  expect(held.preview).toBe('"run the tests"')
  await held.ui.unmount()
  expect(periods()).toBeGreaterThan(0)
  w.box = 'a new draft'

  await flip($, false)
  // The person's words come back after their draft, at once.
  expect(w.box).toBe('a new draft\n\nrun the tests')
  expect(w.toasts.pop()).toBe('Rain Check is off, so nothing waits. Your words are back in the prompt box.')
  await expectNoBand($)
  await w.clock.settle()
  const before = periods()
  await w.clock.advance(6 * HOUR)
  expect(periods(), 'no ticks while off').toBe(before)
  expect(w.sent, 'never sent by a switched-off mod').toEqual([])
  // Off, a refusal at the next window holds nothing new, and keeps no limit for later.
  const next = [window(100, RESET + 5 * HOUR)]
  await measure($, next)
  w.usage = next
  await refuse($)
  expect((await submit($, 'try again')).drop).toBeUndefined()
  expect(w.sent.map(s => s.text)).toEqual(['try again'])
  await expectNoBand($)

  // On again, it starts fresh: the next refusal holds what follows, and the countdown ticks.
  await flip($, true)
  await expectNoBand($)
  await refuse($)
  expect((await submit($, 'and the docs')).drop).toContain('Usage limit reached')
  const back = await band($, 'desktop')
  expect(back.preview).toBe('"and the docs"')
  await back.ui.unmount()
  await w.clock.advance(MIN)
  expect(periods()).toBeGreaterThan(before)
})

test('flipped live where no box takes the words: the transcript keeps them, and a pick-up is simply dropped', async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  await measure($, [window(100)])
  await refuse($)
  await press($, 'terminal', 'rain-continue')
  await submit($, 'and run the tests')
  w.canFill = false

  await flip($, false)
  expect(w.toasts.pop()).toBe('Rain Check is off, so nothing waits. "and run the tests"')
  expect(w.logs).toEqual(['rain-check: your words, in full: and run the tests'])
  await flip($, true)

  // A pick-up alone holds no words of the person's: it goes, with a word why.
  await refuse($)
  await press($, 'desktop', 'rain-continue')
  await flip($, false)
  expect(w.toasts.pop()).toBe('Rain Check is off, so nothing waits.')
  expect(w.logs).toHaveLength(1)
  await w.clock.advance(6 * HOUR)
  expect(w.sent).toEqual([])
})

test('switched off while its state will not write: the words still come back, and nothing is held, drawn or sent', SLOW, async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  await measure($, [window(100)])
  await refuse($)
  await submit($, 'run the tests')
  await rainCheck($, 'now') // the send waits one clock turn
  w.isStateBroken = true
  await flip($, false)
  w.isStateBroken = false
  expect(w.box).toBe('run the tests')

  // The limit and the hold it could not clear stay in its state, and off they do nothing:
  // the send asked for before the switch, and off set again, neither send nor give the words back twice.
  await w.clock.settle()
  await flip($, false)
  expect(w.box).toBe('run the tests')
  expect(w.sent).toEqual([])
  await expectNoBand($)
  expect((await submit($, 'try again')).drop).toBeUndefined()
  await answered($)
  await w.clock.advance(6 * HOUR)
  expect(w.sent.map(s => s.text)).toEqual(['try again'])

  // On again: what it could not clear is not picked up, so words already handed back never go out.
  await flip($, true)
  await w.clock.advance(6 * HOUR)
  expect(w.sent.map(s => s.text)).toEqual(['try again'])
  await expectNoBand($)
})

test('switched off while a send gets ready: the words come back once, and it never goes out', async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  // Holds the send at its first write (it has the words in hand), so the switch lands mid-send.
  let isArmed = false
  let reached = () => {}
  let open = () => {}
  const isAtGate = new Promise<void>(resolve => (reached = resolve))
  const gate = new Promise<void>(resolve => (open = resolve))
  on('state.set', { key: 'queued' }, async ($, e, next) => {
    if (isArmed && e.value === null) {
      isArmed = false
      reached()
      await gate
    }
    return next(e)
  })
  await start($)
  await measure($, [window(100)])
  await refuse($)
  await submit($, 'run the tests')
  isArmed = true
  await rainCheck($, 'now')
  const sending = w.clock.settle()
  await isAtGate
  await flip($, false)
  open()
  await sending
  expect(w.sent).toEqual([])
  expect(w.box).toBe('run the tests')
  expect(w.toasts).toEqual(['Rain Check is off, so nothing waits. Your words are back in the prompt box.'])
})

test('on again starts fresh: what it sent, and a refusal near a cap, are forgotten', async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  await measure($, [window(100)])
  await refuse($)
  await submit($, 'run the tests')
  await press($, 'terminal', 'rain-now')
  expect(w.sent.map(s => s.text)).toEqual(['run the tests'])
  await flip($, false)
  await flip($, true)
  // Refused again: the limit shows, but what it sent before the switch is not held a second time.
  await refuse($)
  const { ui, waiting, limit } = await band($, 'terminal')
  expect(waiting).toBeUndefined()
  expect(limit).toContain('Usage limit reached')
  await ui.unmount()

  // Near a cap, a refusal before the switch and one after are each a first one: nothing is held.
  await press($, 'terminal', 'rain-dismiss')
  await measure($, [window(97)])
  w.usage = [window(97)]
  await refuse($)
  await flip($, false)
  await flip($, true)
  await refuse($)
  expect((await submit($, 'next')).drop).toBeUndefined()
})
