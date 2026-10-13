// The switch: `enabled`, as /config or the modmyclaude hub flips it, through a stand-in
// for the engine's own config row. Off stops the quiz at once, even after the person
// typed /pop-quiz on: no band, no model call; on brings it back. A refused flip
// changes nothing.

import { expect, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { ConfigOrigin } from 'claude-code'

import { TWO, bandTexts, edit, quizCmd, start, turn, world } from './world'

const FIRST = '1. Why does the migration add an index on user_id?'

const OFF = 'Pop Quiz is off. /mods or /config turns it on.'
const REFUSED = { deny: 'pop-quiz stays off: you switch it on in the /config menu or the modmyclaude hub' }

function flip($: Engine, value: boolean, origin: ConfigOrigin = { kind: 'composer' }) {
  return $.config.set({ key: 'pop-quiz.enabled', value, previous: !value, provider: { plugin: 'engine', tier: 'core' }, origin })
}

test('flipped live: off clears the quiz and makes no call, over /pop-quiz on; on brings it back', async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  await quizCmd($, 'every 1')
  await quizCmd($, 'on')
  await turn($, w, [edit()])
  expect(w.calls).toHaveLength(1)
  expect((await bandTexts($))[1]).toBe(FIRST)

  expect(await flip($, false)).toEqual({ value: false })
  expect(await bandTexts($)).toEqual([])
  await turn($, w, [edit()])
  expect(w.calls).toHaveLength(1)
  expect(await bandTexts($)).toEqual([])

  expect(await flip($, true)).toEqual({ value: true })
  await turn($, w, [edit()])
  expect(w.calls).toHaveLength(2)
  expect((await bandTexts($))[1]).toBe(FIRST)
})

test('a refused flip changes nothing, either way', async ($, on) => {
  const w = world(on)
  on('config.set', () => ({ deny: 'set by your organisation' }))
  await start($)
  await quizCmd($, 'every 1')
  expect(await flip($, true)).toEqual({ deny: 'set by your organisation' })
  await turn($, w, [edit()])
  expect(w.calls).toEqual([])

  await quizCmd($, 'on')
  expect(await flip($, false)).toEqual({ deny: 'set by your organisation' })
  await turn($, w, [edit()])
  expect(w.calls).toHaveLength(1)
  expect((await bandTexts($))[1]).toBe(FIRST)
})

/** Another plugin above the world's model: each reply takes five seconds. */
const SLOW: Plugin = {
  name: 'slow-model',
  register(on) {
    on('model.complete', async ($, e, next) => {
      await $.clock.sleep(5_000)
      return next(e)
    })
  },
}

test('switched off after a turn: the quiz it was due makes no call; one being written is dropped, and never asked again', { plugins: [SLOW] }, async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  await quizCmd($, 'every 1')
  await quizCmd($, 'on')

  // Due, not started: the turn ends, the switch goes off, then the clock lets the quiz run.
  await $.turn.start({ turnId: 'due', prompt: 'go', origin: { kind: 'composer' } } as never)
  await $.tool.call(edit() as never)
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 'due', reason: 'answer' })
  await flip($, false)
  await w.clock.advance(1)
  expect(w.calls).toEqual([])

  // Being written when the switch goes off: its questions are dropped.
  await flip($, true)
  await turn($, w, [edit()])
  await flip($, false)
  await w.clock.advance(5_000)
  expect(w.calls).toHaveLength(1)
  expect(await bandTexts($)).toEqual([])

  // Its first reply fails after the switch went off: no second call.
  await flip($, true)
  w.replies = [TWO, 'fail']
  await turn($, w, [edit()])
  await flip($, false)
  await w.clock.advance(5_000)
  await w.clock.advance(5_000)
  expect(w.calls).toHaveLength(2)
  expect(await bandTexts($)).toEqual([])
})

test('switched off: no quiz, nothing drawn, and every command says it is off', { options: { enabled: false, startOn: true, every: 1 } }, async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, w, [edit()])
  for (const args of ['on', 'ask', 'score', 'every 2', '']) await quizCmd($, args)
  expect(w.toasts).toEqual(Array(5).fill(OFF))
  expect(w.calls).toEqual([])
  expect(await bandTexts($)).toEqual([])
})

test('a quiz costs money, so only the person or the hub switches it on; another mod is refused', { options: { enabled: false, startOn: true, every: 1 } }, async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  expect(await flip($, true, { kind: 'plugin', name: 'other' })).toEqual(REFUSED)
  await turn($, w, [edit()])
  expect(w.calls).toEqual([])
  expect(await flip($, true, { kind: 'plugin', name: 'modmyclaude-hub' })).toEqual({ value: true })
  await turn($, w, [edit()])
  expect(w.calls).toHaveLength(1)
})

test('a /config sent over Remote Control may switch it on, as the person may', { options: { enabled: false, startOn: true, every: 1 } }, async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  expect(await flip($, true, { kind: 'bridge' })).toEqual({ value: true })
  await turn($, w, [edit()])
  expect(w.calls).toHaveLength(1)
})

test('the switch never undoes what was typed: off and on again, a typed /pop-quiz off still holds', { options: { startOn: true, every: 1 } }, async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  await quizCmd($, 'off')
  await flip($, false)
  await flip($, true)
  await turn($, w, [edit()])
  expect(w.calls).toEqual([])
})

test('any plugin may switch it off, over a typed /pop-quiz on: off is the safe way', async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  await quizCmd($, 'every 1')
  await quizCmd($, 'on')
  expect(await flip($, false, { kind: 'plugin', name: 'other' })).toEqual({ value: false })
  await turn($, w, [edit()])
  expect(w.calls).toHaveLength(0)
})

test('switched off and on again, the quiz that was showing does not come back', async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  await quizCmd($, 'every 1')
  await quizCmd($, 'on')
  await turn($, w, [edit()])
  expect((await bandTexts($))[1]).toBe(FIRST)
  await flip($, false)
  await flip($, true)
  expect(await bandTexts($)).toEqual([])
})

test('a quiz the person asked for makes no second call once the switch goes off', { plugins: [SLOW] }, async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  w.replies = ['fail', TWO]
  await start($)
  await turn($, w, [edit()])
  // The command waits on the call: it is let run while the clock moves.
  const asking = quizCmd($, 'ask')
  await w.clock.settle()
  await flip($, false)
  await w.clock.advance(5_000)
  await w.clock.advance(5_000)
  await asking
  expect(w.calls).toHaveLength(1)
  expect(await bandTexts($)).toEqual([])
})

test('switched off with a quiz kept from before (the engine reloaded it off): nothing of it is drawn', { options: { enabled: false } }, async ($, on) => {
  world(on)
  const kept = [{ q: 'Why the index?', a: 'Lookups by user.', isShown: false }]
  on('state.get', { plugin: 'pop-quiz', key: 'quiz' }, () => ({ value: { value: kept, version: 2 } }))
  await start($)
  expect(await bandTexts($)).toEqual([])
})
