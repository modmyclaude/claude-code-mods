// The switch: `enabled` off, as /config or the modmyclaude hub sets it, leaves Chapters
// inert: no model call, no git, no band, no pane, no timer, Claude's tool calls
// untouched; on, it is back. A review being written when it goes off stops there: it
// never draws or asks the model again, and it never blocks the next one. The engine
// reloads the mod with the new value (the first test, by its options); the config.set
// hook flips it at once (the second, through a stand-in for the engine's own config row).

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ROOT, SURFACES, TWO, bandTexts, chapters, paneTexts, start, world } from './world'
import type { World } from './world'

const OFF = 'Chapters is off. /mods or /config turns it on.'
const BENEATH = "another mod's line"
const BAND = 'chapters: 2 chapters, 1 risky, 2 unread · /chapters to read'
const STOPPED = 'the review stopped when Chapters was switched off; /chapters writes a new one'

// Another installed band mod, beneath Chapters. It loads as a module of its own: no outer names.
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
  const previous = !value
  return $.config.set({ key: 'chapters.enabled', value, previous, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
}

/** Counts the detached start of a review (`$.clock.after(0)`); registered before the world, so above its clock. */
function timers(on: On): () => number {
  let count = 0
  on('clock.after', { ms: 0 }, ($, e, next) => {
    count += 1
    return next(e)
  })
  return () => count
}

const EDIT = { tool: 'Edit', file_path: `${ROOT}/src/a.ts`, old_string: 'let a = 1', new_string: 'const a = 1' } as never

async function editTurn($: Engine) {
  await $.turn.start({ turnId: 't1', prompt: 'go', origin: { kind: 'composer' } } as never)
  const ran = await $.tool.call(EDIT)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  return ran
}

test('switched off: no model call, no git, no band, no pane, no timer, and tool calls pass untouched', { options: { enabled: false }, plugins: [STUB] }, async ($, on) => {
  const asked = timers(on)
  const w = world(on)
  await start($)

  // Exactly what the engine answered.
  expect(await editTurn($)).toEqual({ result: { ok: true, tool: 'Edit' } })

  // The command stays, so the person can learn it is off; every word says so.
  for (const args of ['', 'staged', 'last']) expect((await chapters($, w, args)).text).toBeUndefined()
  expect(w.toasts).toEqual([OFF, OFF, OFF])
  expect(w.opened).toEqual([])
  await w.clock.advance(5_000)
  expect(w.prompts).toEqual([])
  expect(w.gits).toEqual([])
  expect(asked()).toBe(0)

  for (const surface of SURFACES) {
    // What other mods draw there still shows (alone at the root, the kit drops its key: found by text).
    expect(await bandTexts($, surface), surface).toEqual([BENEATH])
    expect(await paneTexts($, surface), surface).toEqual([OFF])
  }
})

test('flipped live: off clears the band and drops the review under way at once; on brings them back', { plugins: [STUB] }, async ($, on) => {
  const asked = timers(on)
  // Holds the next model call open until the test lets it answer.
  let gate: Promise<void> | null = null
  let open = () => {}
  let held = 0
  on('model.complete', { model: /./ }, async ($, e, next) => {
    const wait = gate
    gate = null
    if (wait !== null) {
      held += 1
      await wait
    }
    return next(e)
  })
  const w: World = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  // The first review, the one after the switch, then the held one: it fails, so it would ask again.
  w.replies = [TWO, TWO, 'fail']
  await start($)
  await chapters($, w)
  expect(w.prompts).toHaveLength(1)
  expect(await bandTexts($)).toEqual([BENEATH, BAND])

  // A second review, its model call still out when the switch goes off.
  gate = new Promise<void>(resolve => {
    open = resolve
  })
  await chapters($, w, 'new')
  for (let i = 0; i < 20 && held === 0; i++) await w.clock.settle()
  expect(held).toBe(1)
  expect((await paneTexts($))[0]).toBe('Writing the review of uncommitted changes...')
  const timersBefore = asked()

  await flip($, false)
  for (const surface of SURFACES) {
    expect(await bandTexts($, surface), surface).toEqual([BENEATH])
    expect(await paneTexts($, surface), surface).toEqual([OFF])
  }
  expect(await editTurn($)).toEqual({ result: { ok: true, tool: 'Edit' } })
  await chapters($, w)
  expect(w.toasts).toEqual([OFF])
  expect(asked(), 'no timer while off').toBe(timersBefore)

  await flip($, true)
  expect(await paneTexts($)).toEqual([STOPPED])
  // A new review is not blocked by the dropped one, still out.
  await chapters($, w)
  for (let i = 0; i < 20 && w.prompts.length < 2; i++) await w.clock.settle()
  expect(w.prompts).toHaveLength(2)
  expect(await bandTexts($)).toEqual([BENEATH, BAND])
  expect(asked()).toBeGreaterThan(timersBefore)

  // The dropped review's call answers (a failure, which would retry): it asks nothing more and draws nothing.
  open()
  for (let i = 0; i < 20 && w.prompts.length < 3; i++) await w.clock.settle()
  await w.clock.settle()
  expect(w.prompts, 'the call already out, and no retry').toHaveLength(3)
  expect(await bandTexts($)).toEqual([BENEATH, BAND])
  expect((await paneTexts($))[0]).toBe('uncommitted changes · 0 of 2 read')

  // A review waiting unread: switched off, its line goes too.
  await flip($, false)
  expect(await bandTexts($)).toEqual([BENEATH])
})

test('a review asked for just before the switch goes off never starts', async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  w.replies = [TWO]
  await start($)
  await $.command.run({ command: 'chapters', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  await flip($, false)
  await w.clock.advance(5_000)
  expect(w.gits).toEqual([])
  expect(w.prompts).toEqual([])
})

test('the dropped review answering late does not free the lock of the one written since', async ($, on) => {
  // Holds each model call open until the test lets it answer, in order.
  const gates: (() => void)[] = []
  let held = 0
  on('model.complete', { model: /./ }, async ($, e, next) => {
    held += 1
    await new Promise<void>(resolve => gates.push(resolve))
    return next(e)
  })
  const w: World = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  w.replies = [TWO, TWO, TWO]
  await start($)
  await chapters($, w)
  for (let i = 0; i < 20 && held < 1; i++) await w.clock.settle()
  await flip($, false)
  await flip($, true)
  await chapters($, w)
  for (let i = 0; i < 20 && held < 2; i++) await w.clock.settle()
  expect(held).toBe(2)
  // The dropped one answers; the new one is still writing, so a third /chapters waits for it.
  gates[0]!()
  for (let i = 0; i < 10; i++) await w.clock.settle()
  await chapters($, w)
  for (let i = 0; i < 10; i++) await w.clock.settle()
  expect(held, 'no second review beside the one being written').toBe(2)
  gates[1]!()
  for (let i = 0; i < 20 && w.prompts.length < 2; i++) await w.clock.settle()
  expect(await bandTexts($)).toEqual([BAND])
})

test('an edit made while off is not noted: on again, the last turn has nothing to review', async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  w.replies = [TWO]
  await start($)
  await flip($, false)
  await editTurn($)
  await flip($, true)
  await chapters($, w, 'last')
  for (let i = 0; i < 10; i++) await w.clock.settle()
  expect(w.prompts).toEqual([])
  expect((await paneTexts($)).join(' ')).toContain('nothing to review')
})
