// The switch: `enabled` off, as /config or the modmyclaude hub sets it, leaves trim
// inert: every Bash output reaches Claude as the engine made it, no row line, no status
// line, no pane; on, it is back. The engine reloads the mod with the new value (the
// first test, by its options); the config.set hook flips it at once (the second,
// through a stand-in for the engine's own config row).

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PLUGIN, SURFACES, bash, numbered, paneTexts, row, start, stdoutOf, trim, world } from './world'

const BIG = numbered(2_000)
const OFF = 'Trim is off. /mods or /config turns it on.'

function flip($: Engine, value: boolean) {
  return $.config.set({ key: 'trim.enabled', value, previous: !value, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } } as never)
}

/** Every Text of a Bash call's row on a surface: the engine's own and any trim adds. */
async function rowTexts($: Engine, surface: (typeof SURFACES)[number], id: string, stdout: string): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolResult', props: row(id, stdout) })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()
  return texts
}

test('switched off: output reaches Claude as Bash made it; no row line, status line or pane', { options: { enabled: false } }, async ($, on) => {
  const w = world(on)
  w.stdout['npm test'] = BIG
  await start($)

  // Exactly what the engine answered: nothing folded, no footer, a long output whole.
  const ran = await bash($, 'npm test')
  expect(ran).toEqual({ result: { stdout: BIG, stderr: '', interrupted: false }, text: BIG })
  expect(w.status).toBeUndefined()

  // The row is the engine's own on both surfaces (alone at the root, the kit drops its key: found by text).
  for (const surface of SURFACES) {
    expect(await rowTexts($, surface, w.ids[0]!, BIG), surface).toEqual(['engine row: 2001 lines'])
  }

  // The command stays, so the person can learn it is off; every word says so.
  for (const args of ['', 'show 1', 'on']) expect((await trim($, args)).text).toBeUndefined()
  expect(w.toasts).toEqual([OFF, OFF, OFF])
  expect(w.opened).toEqual([])
  for (const requestId of ['trim', 'trim-output']) {
    for (const surface of SURFACES) expect(await paneTexts($, requestId, surface), `${requestId} ${surface}`).toEqual([OFF])
  }
})

test('flipped live: off passes output whole and clears the row and the status line at once; on brings them back', async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  w.stdout['npm test'] = BIG
  await start($)
  const folded = stdoutOf(await bash($, 'npm test'))
  expect(folded).toMatch(/\[trim: 1,945 of 2,000 lines folded/)
  expect(w.status).toMatch(/^trim ~[\d.]+k saved$/)
  const drawn = [`engine row: ${folded.split('\n').length} lines`, expect.stringMatching(/^trim: 1,945 lines folded · ~[\d.]+k tokens saved$/)]
  expect(await rowTexts($, 'terminal', w.ids[0]!, folded)).toEqual(drawn)

  await flip($, false)
  expect(w.status).toBeUndefined()
  for (const surface of SURFACES) {
    expect(await rowTexts($, surface, w.ids[0]!, folded), surface).toEqual([`engine row: ${folded.split('\n').length} lines`])
  }
  expect(stdoutOf(await bash($, 'npm test'))).toBe(BIG)
  await trim($)
  expect(w.toasts).toEqual([OFF])
  expect(await paneTexts($, 'trim')).toEqual([OFF])
  // A start while off (the engine's reload with the new value) sets no status line either.
  await start($)
  expect(w.status).toBeUndefined()

  await flip($, true)
  expect(w.status).toMatch(/^trim ~[\d.]+k saved$/)
  expect(await rowTexts($, 'terminal', w.ids[0]!, folded)).toEqual(drawn)
  expect(stdoutOf(await bash($, 'npm test'))).toMatch(/\[trim: 1,945 of 2,000 lines folded/)
  await trim($)
  expect(w.opened).toEqual(['trim'])
  expect((await paneTexts($, 'trim'))[0]).toMatch(/^2 calls folded · about [\d,]+ tokens saved$/)
})
