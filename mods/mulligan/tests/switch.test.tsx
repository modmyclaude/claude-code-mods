// The switch: `enabled` off, as /config or the modmyclaude hub sets it, leaves Mulligan
// inert: no snapshot before any command (no process runs), no band, no timer, and
// /mulligan says it is off; on, it is back. A do-over saved while it was on still
// restores while off, and none is ever deleted by a flip. The engine reloads the mod
// with the new value (the first test, by its options); the config.set hook flips it at
// once (the second, through a stand-in for the engine's own config row).

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PANE_PROPS, PLUGIN, ROOT, SURFACES, bandTexts, bash, indexOf, mulligan, put, rmTree, start, world } from './world'
import type { World } from './world'

const OFF = 'Mulligan is off. /mods or /config turns it on.'
const BENEATH = "another mod's line"

// Another installed band mod, beneath Mulligan. It loads as a module of its own: no outer names.
const STUB = {
  name: 'stub-band',
  tier: 'append' as const,
  register(on: On) {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>another mod's line</Text>
    })
  },
}

function flip($: Engine, value: boolean) {
  return $.config.set({ key: 'mulligan.enabled', value, previous: !value, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } } as never)
}

/** Counts the band's `$.clock.after` waits (its 8 seconds); registered before the world, so above its clock. */
function timers(on: On): () => number {
  let count = 0
  on('clock.after', { ms: 8_000 }, ($, e, next) => {
    count += 1
    return next(e)
  })
  return () => count
}

function project(w: World): void {
  put(w, 'src/app.ts', 'export const a = 1\n', true)
  put(w, 'dist/app.js', 'var a = 1\n')
  w.effects['rm -rf dist'] = w => rmTree(w, 'dist')
}

async function paneTexts($: Engine, surface: (typeof SURFACES)[number] = 'terminal'): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'mulligan', props: PANE_PROPS })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()
  return texts
}

test('switched off: no snapshot, no process, no band, no timer, and the command passes as it came', { options: { enabled: false }, plugins: [STUB] }, async ($, on) => {
  const asked = timers(on)
  const w = world(on)
  project(w)
  await start($)

  // Exactly what the engine answered; the command ran once and nothing of Mulligan's ran or was written.
  expect(await bash($, 'rm -rf dist')).toEqual({ result: { stdout: '', stderr: '', interrupted: false } })
  expect(w.ran).toEqual(['rm -rf dist'])
  expect(w.runs).toEqual([])
  expect(w.writes).toEqual([])
  expect(indexOf(w).snapshots).toEqual([])
  await w.clock.advance(10_000)
  expect(asked()).toBe(0)

  // What other mods draw there still shows (alone at the root, the kit drops its key: found by text).
  for (const surface of SURFACES) expect(await bandTexts($, surface), surface).toEqual([BENEATH])

  // The command stays, so the person can learn it is off.
  for (const args of ['', 'list', 'diff 1', 'drop 1']) expect((await mulligan($, args)).text).toBeUndefined()
  expect(w.toasts).toEqual([OFF, OFF, OFF, OFF])
  expect(w.opened).toEqual([])
  for (const surface of SURFACES) expect(await paneTexts($, surface), surface).toEqual([OFF])
  expect(w.runs).toEqual([])
})

test('flipped live: off stops snapshots and the band at once, a saved do-over still restores; on brings them back', { plugins: [STUB] }, async ($, on) => {
  const asked = timers(on)
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  project(w)
  await start($)
  await bash($, 'rm -rf dist')
  expect(indexOf(w).snapshots.map(s => s.n)).toEqual([1])
  expect(await bandTexts($)).toEqual([BENEATH, 'mulligan: saved a do-over before "rm -rf dist" (dist) · /mulligan restore 1'])
  expect(asked()).toBe(1)

  await flip($, false)
  for (const surface of SURFACES) expect(await bandTexts($, surface), surface).toEqual([BENEATH])
  const runs = w.runs.length
  put(w, 'build/out.js', 'built\n')
  w.effects['rm -rf build'] = w => rmTree(w, 'build')
  await bash($, 'rm -rf build')
  await w.clock.advance(10_000)
  expect(w.ran).toEqual(['rm -rf dist', 'rm -rf build'])
  expect(w.runs.length, 'no snapshot process while off').toBe(runs)
  expect(indexOf(w).snapshots.map(s => s.n), 'the saved one stays').toEqual([1])
  expect(asked(), 'no timer while off').toBe(1)
  expect(await bandTexts($)).toEqual([BENEATH])
  await mulligan($)
  expect(w.toasts).toEqual([OFF])
  expect(await paneTexts($)).toEqual([OFF])

  // The do-over saved while it was on still comes back after the confirm press.
  await mulligan($, 'restore 1')
  expect(w.opened).toEqual(['mulligan'])
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'mulligan', props: PANE_PROPS })
  expect((await ui.findAll({ type: 'Text' })).map(found => found.text)).toEqual([OFF, 'Put back dist as it was before #1? Files it holds are written over what is there now; nothing newer is deleted.'])
  await ui.press({ key: 'yes' })
  await ui.unmount()
  expect(w.files[`${ROOT}/dist/app.js`]).toBe('var a = 1\n')
  expect(w.toasts.at(-1)).toBe('mulligan: restored #1 (dist). Claude was told to re-read files.')
  expect(w.appended).toHaveLength(1)
  expect(await paneTexts($)).toEqual([OFF])
  expect(indexOf(w).snapshots.map(s => s.n)).toEqual([1])

  await flip($, true)
  await bash($, 'rm -rf dist')
  expect(indexOf(w).snapshots.map(s => s.n)).toEqual([1, 2])
  expect(await bandTexts($)).toEqual([BENEATH, 'mulligan: saved a do-over before "rm -rf dist" (dist) · /mulligan restore 2'])
  expect(asked()).toBe(2)
  await mulligan($)
  expect((await paneTexts($))[0]).toBe('2 do-overs for this project')
})
