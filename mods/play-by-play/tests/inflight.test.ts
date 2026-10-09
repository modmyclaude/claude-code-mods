// /replay runs at once, mid-turn too: it replays finished turns while Claude
// works, never shows the running turn half done, and answers the model nothing.

import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PANE, panes, PLUGIN, runReplay, session, start, turn } from './fixtures'

const PANE_PROPS = {
  title: 'Play-by-Play',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

function writes(on: On) {
  on('tool.call', { tool: 'Write' }, ($, e) => ({
    result: { type: 'create', filePath: e.file_path, content: 'x\n', structuredPatch: [], originalFile: null },
    text: 'created',
  }))
}

test('/replay is registered to run at once, mid-turn', async ($, on) => {
  const world = session(on)
  await start($)
  expect(world.registered).toEqual([{ name: 'replay', immediate: true }])
})

test('mid-turn, /replay lists only finished turns, never the running one', async ($, on) => {
  const world = session(on)
  panes(on, false, world.opened)
  writes(on)
  await start($)
  await turn($, 't1', () => $.tool.call({ tool: 'Write', file_path: '/repo/done.txt', content: 'x\n' }))
  await $.turn.start({ text: 'next', turnId: 't2' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/half-done.txt', content: 'x\n' })
  const text = await runReplay($)
  expect(text).toBe('the latest turn: 1 edit · 1 file · +1 −0\n1. done.txt (create) +1 −0')
  expect(text).not.toContain('half-done.txt')
})

test('the pane says a turn is in progress, and keeps its turn when that one ends', async ($, on) => {
  const world = session(on)
  panes(on, true, world.opened)
  writes(on)
  await start($)
  await turn($, 't1', () => $.tool.call({ tool: 'Write', file_path: '/repo/done.txt', content: 'x\n' }))
  await $.turn.start({ text: 'next', turnId: 't2' })
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(await runReplay($)).toBe('') // the pane is the answer
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /in progress/ })).toBeUndefined() // nothing changed yet
    await ui.unmount()
  }
  await $.tool.call({ tool: 'Write', file_path: '/repo/half-done.txt', content: 'x\n' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  expect(await ui.find({ type: 'Text', text: 'done.txt' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'half-done.txt' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /A turn in progress has changed files/ })).toBeDefined()
  // The running turn ends while the pane is open: it stays on the turn it showed.
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: 'done.txt' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Turn 2 of 2, newest first/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /in progress/ })).toBeUndefined()
  // /replay then opens the newest.
  await runReplay($)
  expect(await ui.find({ type: 'Text', text: 'half-done.txt' })).toBeDefined()
})
