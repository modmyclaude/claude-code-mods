// The switch: `enabled` off, as /config or the modmyclaude hub sets it, leaves Headway
// quiet: no line, no pane, no tool lent, no timer, no receipt or "plan done", Claude's
// tool calls untouched; it still follows the plan, so on again it shows where things stand. The engine reloads the mod with the new value (the first test, by its
// options); the config.set hook flips it at once (the second, through a stand-in for
// the engine's own config row).

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BAND, PANE_PROPS, PLUGIN, SURFACES, bandText, beneath, list, todos, turnStart, world } from './world'

const S = 1000
const STEPS = ['Plan the schema', 'Write the migration', 'Wire the routes', 'Add tests']
const OFF = 'Headway is off. /mods or /config turns it on.'

function headway($: Engine, args: string) {
  return $.command.run({ command: 'headway', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
}

test('switched off: no line, no pane, no tool lent, no timer, and tool calls pass untouched', { options: { enabled: false } }, async ($, on) => {
  const w = world(on, {}, ['desktop', 'terminal'])
  beneath(on)
  const lent: string[] = []
  on('tool.list', () => ({ value: [{ name: 'Bash', description: 'Bash', mcp: false }] }))
  on('tool.register', ($, e) => (lent.push(e.name), { value: { tool: `mcp__headway__${e.name}` } }))
  let heardDone = 0
  on('state.set', { plugin: 'headway', key: 'done' }, ($, e, next) => {
    heardDone += 1
    return next(e)
  })
  const rows: unknown[] = []
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    rows.push(e.props.input)
    const { Text } = $.ui.resolve(e)
    return <Text key="engine-row">row</Text>
  })
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  // The command stays, so the person can learn it is off; no tool is lent where it would be.
  expect(w.registered.map(spec => spec.name)).toEqual(['headway'])
  expect(lent).toEqual([])

  await turnStart($)
  const steps = list(STEPS, 1)
  const answer = await todos($, steps)
  expect(answer).toEqual({ result: { oldTodos: [], newTodos: steps.map(step => ({ ...step, activeForm: step.content })) }, text: 'Todos updated' })
  await w.clock.advance(5 * S)
  expect(w.periods()).toBe(0)
  // Lent before the switch went off, the plan tool still answers, and records nothing.
  const lentAnswer = await $.tool.call({ tool: 'mcp__headway__plan', todos: steps } as never)
  expect(lentAnswer).toEqual({ result: OFF, text: OFF })
  // The plan call's row in the terminal is left as Claude Code draws it: the input, not a count.
  const row = await $.ui.mount({
    plugin: PLUGIN, surface: 'terminal', component: 'ToolUse',
    props: { tool_use_id: 't1', tool: 'mcp__headway__plan', input: { todos: steps }, isRunning: false, isErrored: false, isInterrupted: false },
  })
  await row.unmount()
  expect(rows).toEqual([{ todos: steps }])
  // A plan that finishes while off brings no receipt, no "plan done" and no pace history.
  await todos($, list(STEPS, STEPS.length))
  await w.clock.advance(30 * S)
  expect(heardDone).toBe(0)
  expect(w.stored).toEqual({})
  for (const surface of SURFACES) {
    expect(await bandText($, surface), surface).toBeUndefined()
    // What other mods draw there still shows (alone at the root, the kit drops its key: found by text).
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(["another mod's line"])
    await ui.unmount()
  }

  await headway($, '')
  expect(w.toasts).toEqual([OFF])
  expect(w.opened).toEqual([])
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE_PROPS })
  expect((await pane.findAll({ type: 'Text' })).map(t => t.text)).toEqual([OFF])
  await pane.unmount()
})

test('flipped live: off clears the line and stops the timer at once; on shows the plan as it now stands', async ($, on) => {
  const w = world(on)
  beneath(on)
  on('config.set', ($, e) => ({ value: e.value }))
  let redraws = 0
  on('ui.invalidate', ($, e, next) => {
    redraws += 1
    return next(e)
  })
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await turnStart($)
  await todos($, list(STEPS, 1))
  expect(await bandText($, 'terminal')).toContain('Write the migration')

  const drawnBefore = redraws
  await $.config.set({ key: 'headway.enabled', value: false, previous: true, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  expect(redraws, 'the line is redrawn at once').toBeGreaterThan(drawnBefore)
  expect(await bandText($, 'terminal')).toBeUndefined()
  await w.clock.settle()
  const before = w.periods()
  await w.clock.advance(10 * S)
  expect(w.periods(), 'no ticks while off').toBe(before)
  await todos($, list(STEPS, 2))
  expect(await bandText($, 'terminal')).toBeUndefined()

  // On again: the step Claude reached while it was off, and its clock running, with no new call needed.
  await $.config.set({ key: 'headway.enabled', value: true, previous: false, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  expect(await bandText($, 'terminal')).toContain('Wire the routes')
  await w.clock.advance(2 * S)
  expect(w.periods(), 'the switch alone restarts the clock').toBeGreaterThan(before)
})

test('a plan that finished just before the switch went off gets no receipt after it', async ($, on) => {
  const w = world(on)
  beneath(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await turnStart($)
  await todos($, list(STEPS, 1))
  await w.clock.advance(60 * S)
  await todos($, list(STEPS, STEPS.length))
  await $.config.set({ key: 'headway.enabled', value: false, previous: true, provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
  await w.clock.advance(30 * S)
  expect(w.toasts.filter(text => text.startsWith('Plan done'))).toEqual([])
})
