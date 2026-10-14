// The switch: `enabled`, as /config or the modmyclaude hub flips it, through a stand-in
// for the engine's own config row. Off stops the runs at once, even after the person
// typed /umpire on: no line, no status, no run, and every command says it is off; on
// again, what was typed (or the start setting) decides, as before. Only the person or the
// hub switches it on. A refused flip changes nothing. The hold is still recorded while off.

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ConfigOrigin } from 'claude-code'

import { heldWords } from '../hooks/tests'
import { JEST_FAIL, JEST_PASS, ROOT, band, pane, start, turn, umpire, world } from './world'

const PASSED = { text: 'umpire: 144 passed · 0 failed · 8.3 s', color: 'success' }

const OFF = 'Umpire is off. /mods or /config turns it on.'
const REFUSED = { deny: 'umpire stays off: you switch it on in the /config menu or the modmyclaude hub' }

function flip($: Engine, value: boolean, origin: ConfigOrigin = { kind: 'composer' }) {
  const previous = !value
  return $.config.set({ key: 'umpire.enabled', value, previous, provider: { plugin: 'engine', tier: 'core' }, origin })
}

test('flipped live: off clears the line and runs nothing, over /umpire on; on brings them back', async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  await umpire($, 'on')
  await turn($, w)
  await w.clock.advance(8_300)
  expect(w.runs).toHaveLength(1)
  expect(await band($)).toEqual(PASSED)
  expect(w.status.at(-1)).toBe('tests 144/144')

  expect(await flip($, false)).toEqual({ value: false })
  expect(await band($)).toBeUndefined()
  expect(w.status.at(-1)).toBeUndefined()
  await turn($, w)
  await w.clock.advance(8_300)
  expect(w.runs).toHaveLength(1)
  expect(await band($)).toBeUndefined()

  expect(await flip($, true)).toEqual({ value: true })
  expect(await band($)).toEqual(PASSED)
  await turn($, w)
  expect(w.runs).toHaveLength(2)
  await w.clock.advance(8_300)
  expect(await band($)).toEqual(PASSED)
})

test('a refused flip changes nothing, either way', async ($, on) => {
  const w = world(on)
  on('config.set', () => ({ deny: 'set by your organisation' }))
  await start($)
  expect(await flip($, true)).toEqual({ deny: 'set by your organisation' })
  await turn($, w)
  expect(w.runs).toEqual([])

  await umpire($, 'on')
  expect(await flip($, false)).toEqual({ deny: 'set by your organisation' })
  await turn($, w)
  expect(w.runs).toHaveLength(1)
  await w.clock.advance(8_300)
  expect(await band($)).toEqual(PASSED)
  expect(w.status.at(-1)).toBe('tests 144/144')
})

test('switched off after a turn: the run it was due never starts; one already going keeps its call and says nothing', async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  w.results = [{ stdout: JEST_PASS, exitCode: 0, ms: 8300 }, { stdout: JEST_FAIL, exitCode: 1, ms: 9000 }]
  await start($)
  await umpire($, 'on')
  await turn($, w)
  await w.clock.advance(8_300)

  // Due, not started: the turn ends, the switch goes off, then the clock lets the run start.
  await $.turn.start({ turnId: 'due', prompt: 'go', origin: { kind: 'composer' } } as never)
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/a.ts`, old_string: 'a', new_string: 'b' } as never)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 'due', reason: 'answer' })
  await flip($, false)
  await w.clock.advance(1)
  expect(w.runs).toHaveLength(1)

  // Going when the switch goes off: it fails, with no toast and no status line.
  await flip($, true)
  await turn($, w)
  expect(w.runs).toHaveLength(2)
  await flip($, false)
  const toasts = [...w.toasts]
  const status = [...w.status]
  await w.clock.advance(9_000)
  expect(w.toasts).toEqual(toasts)
  expect(w.status).toEqual(status)
  expect(await band($)).toBeUndefined()
  // Its call is kept: the pane says off while off, and shows it once on again.
  const off = await pane($)
  expect((await off.findAll({ type: 'Text' })).map(t => t.text)).toEqual([OFF])
  await off.unmount()
  await flip($, true)
  const ui = await pane($)
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)[0]).toBe('umpire: 142 passed · 2 failed · auth.test.ts, user.test.ts · 9.0 s')
  await ui.unmount()
})

test('switched on: the files are taken as they are then, so a later change holds; a hold Claude made while off stays', { options: { enabled: false, startOn: true } }, async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  await flip($, true)
  w.files['package.json'] = JSON.stringify({ scripts: { test: 'jest && echo more' } })
  await turn($, w)
  expect(w.runs).toEqual([])
  expect((await band($))?.text).toBe(heldWords('package.json'))

  await umpire($, 'run')
  await w.clock.advance(1)
  await w.clock.advance(8_300)
  expect(w.runs).toHaveLength(1)
  await flip($, false)
  await turn($, w, ['Edit'], `${ROOT}/Cargo.toml`)
  await flip($, true)
  expect(await band($)).toEqual({ text: heldWords('Cargo.toml'), color: 'warning' })
  await turn($, w)
  expect(w.runs).toHaveLength(1)
})

test('switched off: nothing runs, nothing is drawn, every command says it is off', { options: { enabled: false, startOn: true } }, async ($, on) => {
  const w = world(on)
  await start($)
  for (const verb of ['on', 'run', 'show', 'tell', 'command make test', '']) await umpire($, verb)
  expect(w.toasts).toEqual(Array(6).fill(OFF))
  await turn($, w)
  await w.clock.advance(9_000)
  expect(w.runs).toEqual([])
  expect(await band($)).toBeUndefined()
  const ui = await pane($)
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual([OFF])
  await ui.unmount()
})

test('it runs commands, so only the person or the hub switches it on; another mod is refused', { options: { enabled: false, startOn: true } }, async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  expect(await flip($, true, { kind: 'plugin', name: 'other' })).toEqual(REFUSED)
  await turn($, w)
  expect(w.runs).toEqual([])
  expect(await flip($, true, { kind: 'plugin', name: 'modmyclaude-hub' })).toEqual({ value: true })
  await turn($, w)
  expect(w.runs).toHaveLength(1)
})

test('a /config sent over Remote Control may switch it on, as the person may', { options: { enabled: false, startOn: true } }, async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  expect(await flip($, true, { kind: 'bridge' })).toEqual({ value: true })
  await turn($, w)
  expect(w.runs).toHaveLength(1)
})

test('the switch never undoes what was typed: off and on again, a typed /umpire off still holds', { options: { startOn: true } }, async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  await umpire($, 'off')
  await flip($, false)
  await flip($, true)
  await turn($, w)
  expect(w.runs).toEqual([])
})

test('any plugin may switch it off, over a typed /umpire on: off is the safe way', async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  await umpire($, 'on')
  expect(await flip($, false, { kind: 'plugin', name: 'other' })).toEqual({ value: false })
  await turn($, w)
  expect(w.runs).toEqual([])
})
