import { heatGlyph, heatGrid, HEAT_WINDOW_MS } from '../hooks/mission'
// The pure arithmetic and words of mission control.

import { describe, expect, test } from 'claude-code/testing'

import type { AntFarmAnt, AntFarmEvent } from '../types'
import {
  activityText, basename, eventLook, gridOf, hotkeyOf, met, moveSelection, nextN, ordered, pulse, pushEvent, pushHistory,
  rowsOf, sparkline, spinner, statusLook, stopWarning, toolSummary, EVENTS_MAX, HISTORY_MAX,
} from '../hooks/mission'

const ant = (over: Partial<AntFarmAnt>): AntFarmAnt => ({
  id: 'a', task: 't', type: 'Explore', model: 'claude-haiku-5-5', status: 'running', startedAt: 0,
  usage: { requests: 0, tokens: 0, costUsd: 0, unpricedTokens: 0 }, ...over,
})

describe('status words', () => {
  test('the five the dashboard names, from the status and the live phase', () => {
    expect(statusLook('failed', 'thinking').word).toBe('FAILED')
    expect(statusLook('done', 'waiting').word).toBe('DONE')
    expect(statusLook('running', 'waiting')).toEqual({ word: 'WAITING', color: 'warning', glyph: '◇' })
    expect(statusLook('running', 'thinking').word).toBe('THINKING')
    for (const phase of ['starting', 'writing', 'tool', 'working', undefined] as const) expect(statusLook('running', phase).word).toBe('WORKING')
  })

  test('what follows the status word: what was seen and for how long', () => {
    expect(activityText(undefined, 10_000)).toBe('')
    expect(activityText({ phase: 'thinking', since: 6000 }, 10_000)).toBe('4s')
    expect(activityText({ phase: 'thinking', since: 9800 }, 10_000)).toBe('')
    expect(activityText({ phase: 'working', since: 0 }, 3000)).toBe('3s')
    expect(activityText({ phase: 'tool', detail: 'Bash npm test', since: 0 }, 75_000)).toBe('Bash npm test · 1m 15s')
    expect(activityText({ phase: 'waiting', detail: 'permission for Bash' }, 1)).toBe('permission for Bash')
    expect(activityText({ phase: 'waiting' }, 1)).toBe('held')
    expect(activityText({ phase: 'starting' }, 1)).toBe('starting')
    expect(activityText({ phase: 'writing' }, 1)).toBe('writing')
  })
})

describe('the mission clock', () => {
  test('reads as a launch clock', () => {
    expect(met(0)).toBe('T+00:00')
    expect(met(-5)).toBe('T+00:00')
    expect(met(724_000)).toBe('T+12:04')
    expect(met(3_753_000)).toBe('T+1:02:33')
  })
})

describe('tool summaries', () => {
  test('file tools are edits and name the file; others name what they touch', () => {
    expect(toolSummary('Edit', { file_path: '/repo/src/auth.ts' })).toEqual({ kind: 'file', text: 'Edit auth.ts' })
    expect(toolSummary('Write', { file_path: 'C:\\repo\\notes.md' })).toEqual({ kind: 'file', text: 'Write notes.md' })
    expect(toolSummary('NotebookEdit', { notebook_path: '/n/book.ipynb' })).toEqual({ kind: 'file', text: 'NotebookEdit book.ipynb' })
    expect(toolSummary('MultiEdit', {})).toEqual({ kind: 'file', text: 'MultiEdit' })
    expect(toolSummary('Bash', { command: 'npm test\nnpm run lint' })).toEqual({ kind: 'tool', text: 'Bash npm test' })
    expect(toolSummary('Bash', { command: 'x'.repeat(80) }).text).toBe(`Bash ${'x'.repeat(47)}…`)
    expect(toolSummary('Read', { file_path: '/a/b/c.ts' })).toEqual({ kind: 'tool', text: 'Read c.ts' })
    expect(toolSummary('Grep', { pattern: 'TODO' })).toEqual({ kind: 'tool', text: 'Grep TODO' })
    expect(toolSummary('Agent', { description: 'scan tests' })).toEqual({ kind: 'tool', text: 'Agent scan tests' })
    expect(toolSummary('mcp__github__list_prs', {})).toEqual({ kind: 'tool', text: 'github: list_prs' })
    expect(toolSummary('WebSearch', { query: 'ink borders' })).toEqual({ kind: 'tool', text: 'WebSearch ink borders' })
    expect(toolSummary('Mystery', { anything: 1 })).toEqual({ kind: 'tool', text: 'Mystery' })
    expect(toolSummary('Bash', { command: 42 })).toEqual({ kind: 'tool', text: 'Bash' })
    // Redacted before the cut: the token would have been cut in half, past the rules' reach.
    expect(toolSummary('Bash', { command: 'curl https://api.example.com/v1/items -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz"' }).text)
      .toBe('Bash curl https://api.example.com/v1/items -H "Autho…')
    expect(toolSummary('Bash', { command: 'export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789 && gh auth status' }).text)
      .toBe('Bash export GITHUB_TOKEN=[REDACTED] && gh auth status')
  })

  test('basename keeps the last segment of either slash', () => {
    expect(basename('a/b/c')).toBe('c')
    expect(basename('a/b/')).toBe('b')
    expect(basename('plain')).toBe('plain')
    expect(basename('')).toBe('')
  })

  test('stop reasons worth a warning', () => {
    expect(stopWarning('end_turn', true)).toBeUndefined()
    expect(stopWarning('tool_use', true)).toBeUndefined()
    expect(stopWarning('max_tokens', true)).toBe('hit the output limit')
    expect(stopWarning('model_context_window_exceeded', true)).toBe('context window exceeded')
    expect(stopWarning('refusal', true)).toBe('the model refused')
    expect(stopWarning(null, false)).toBe('no response from the model')
  })
})

describe('the timeline', () => {
  const ev = (i: number): AntFarmEvent => ({ at: i, kind: 'tool', text: `t${i}` })

  test('keeps the newest eighty', () => {
    let list: AntFarmEvent[] = []
    for (let i = 0; i < 100; i += 1) list = pushEvent(list, ev(i))
    expect(list.length).toBe(EVENTS_MAX)
    expect(list[0]?.text).toBe('t20')
    expect(list.at(-1)?.text).toBe('t99')
  })

  test('each kind has a mark, a word and a colour; a tool row takes the text colour', () => {
    expect(eventLook('spawn')).toEqual({ glyph: '⇢', word: 'start', color: 'suggestion' })
    expect(eventLook('handoff').word).toBe('handoff')
    expect(eventLook('file')).toEqual({ glyph: '✎', word: 'edit', color: 'suggestion' })
    expect(eventLook('done').color).toBe('success')
    expect(eventLook('failed').color).toBe('error')
    expect(eventLook('error').glyph).toBe('✗')
    expect(eventLook('warning')).toEqual({ glyph: '△', word: 'warning', color: 'warning' })
    expect(eventLook('tool')).toEqual({ glyph: '▸', word: 'tool' })
  })

  test('mission numbers never repeat, even after the oldest ants left', () => {
    expect(nextN([])).toBe(1)
    expect(nextN([ant({ n: 3 }), ant({ id: 'b', n: 7 })])).toBe(8)
    expect(nextN([ant({})])).toBe(1)
  })
})

describe('the sparkline', () => {
  test('eight levels scaled to the largest, right-aligned, dots when empty', () => {
    expect(sparkline([], 4)).toBe('····')
    expect(sparkline([10], 4)).toBe('   █')
    expect(sparkline([0, 5, 10], 3)).toBe('▁▅█')
    expect(sparkline([0, 4, 10], 3)).toBe('▁▄█')
    expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8], 4)).toBe('▅▆▇█')
    expect(sparkline([0, 0], 2)).toBe('▁▁')
  })

  test('history keeps the last twenty-four', () => {
    let h: number[] | undefined
    for (let i = 0; i < 30; i += 1) h = pushHistory(h, i)
    expect(h?.length).toBe(HISTORY_MAX)
    expect(h?.[0]).toBe(6)
  })
})

describe('the grid', () => {
  test('one column to 76 cells, two to 115, three from 116, cards sharing the width', () => {
    expect(gridOf(30)).toEqual({ cols: 1, cardWidth: 38 })
    expect(gridOf(60)).toEqual({ cols: 1, cardWidth: 60 })
    expect(gridOf(76)).toEqual({ cols: 1, cardWidth: 76 })
    expect(gridOf(77)).toEqual({ cols: 2, cardWidth: 38 })
    expect(gridOf(84)).toEqual({ cols: 2, cardWidth: 41 })
    expect(gridOf(115)).toEqual({ cols: 2, cardWidth: 57 })
    expect(gridOf(116)).toEqual({ cols: 3, cardWidth: 38 })
    expect(gridOf(200)).toEqual({ cols: 3, cardWidth: 66 })
  })

  test('rows of n', () => {
    expect(rowsOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(rowsOf([], 3)).toEqual([])
    expect(rowsOf([1, 2], 0)).toEqual([[1], [2]])
  })

  test('running first, oldest on top; finished latest on top', () => {
    const list = [
      ant({ id: 'old-done', status: 'done', startedAt: 1, endedAt: 10 }),
      ant({ id: 'new-done', status: 'failed', startedAt: 2, endedAt: 20 }),
      ant({ id: 'run-2', startedAt: 5 }),
      ant({ id: 'run-1', startedAt: 3 }),
    ]
    const { running, finished } = ordered(list)
    expect(running.map(a => a.id)).toEqual(['run-1', 'run-2'])
    expect(finished.map(a => a.id)).toEqual(['new-done', 'old-done'])
  })
})

describe('motion and keys', () => {
  test('the spinner turns, the heartbeat breathes', () => {
    expect([0, 1, 2, 3, 4].map(spinner).join('')).toBe('◐◓◑◒◐')
    expect([0, 1, 2, 3].map(pulse)).toEqual([{ bold: true }, {}, { dimColor: true }, {}])
  })

  test('selection moves and wraps', () => {
    expect(moveSelection([], undefined, 1)).toBeUndefined()
    expect(moveSelection(['a', 'b', 'c'], undefined, 1)).toBe('a')
    expect(moveSelection(['a', 'b', 'c'], undefined, -1)).toBe('c')
    expect(moveSelection(['a', 'b', 'c'], 'c', 1)).toBe('a')
    expect(moveSelection(['a', 'b', 'c'], 'a', -1)).toBe('c')
    expect(moveSelection(['a', 'b', 'c'], 'gone', 1)).toBe('a')
  })

  test('a digit for mission numbers one to nine', () => {
    expect(hotkeyOf(1)).toBe('1')
    expect(hotkeyOf(9)).toBe('9')
    expect(hotkeyOf(10)).toBeUndefined()
    expect(hotkeyOf(0)).toBeUndefined()
    expect(hotkeyOf(undefined)).toBeUndefined()
  })
})

describe('heatGrid', () => {
  type Ant = Parameters<typeof heatGrid>[0][number]
  const ant = (id: string, n: number, startedAt = 0): Ant => ({ id, n, task: id, type: 't', model: 'm', startedAt, status: 'running', usage: { requests: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as unknown as Ant)
  const ev = (agentId: string, at: number) => ({ at, kind: 'tool' as const, agentId, text: 'x' })
  test('one column per subagent in mission order, one row per window anchored to the clock, the oldest on top', () => {
    const now = 103_000 // inside the window 100 s to 110 s
    const list = [ant('b', 2, 5), ant('a', 1, 1), ant('c', 3, 9)]
    const events = [ev('a', now - 1_000), ev('a', 98_500), ev('b', 55_000), ev('c', 49_999), ev('a', now + 1)]
    const { ids, grid } = heatGrid(list, events, now)
    expect(ids).toEqual(['a', 'b', 'c'])
    expect(grid.length).toBe(6)
    expect(grid[5]).toEqual([1, 0, 0]) // the window now falls in, at the bottom; the row from the future is not counted
    expect(grid[4]).toEqual([1, 0, 0]) // 98.5 s falls in the window before, 90 s to 100 s
    expect(grid[0]).toEqual([0, 1, 0]) // 55 s falls in the oldest window, 50 s to 60 s
    expect(grid.flat().reduce((x, y) => x + y, 0)).toBe(3) // 49.999 s has scrolled off
  })
  test('the strip steps once per window, not with every tick', () => {
    const list = [ant('a', 1)]
    const events = [ev('a', 61_000), ev('a', 64_000), ev('a', 67_000)]
    const at = (now: number) => heatGrid(list, events, now).grid.map(r => r[0]).join('')
    expect(at(72_000)).toBe(at(79_999)) // the same drawing all through one window
    expect(at(72_000)).not.toBe(at(80_000)) // and a step at its edge
  })
  test('a running subagent always has a column: running first, then the latest finished', () => {
    const list: Ant[] = [...Array.from({ length: 12 }, (_, i) => ({ ...ant(`f${i}`, i + 1), status: 'done' as const, endedAt: 1_000 + i })), ant('r', 13)]
    const { ids } = heatGrid(list, [], 60_000)
    expect(ids[0]).toBe('r')
    expect(ids.length).toBe(12)
    expect(ids).not.toContain('f0') // the earliest finished one gives way
  })
  test('a window boundary lands in the later window, and columns stop at the cap', () => {
    const now = 60_000
    const list = Array.from({ length: 14 }, (_, i) => ant(`id${i}`, i + 1))
    const { ids, grid } = heatGrid(list, [ev('id0', now - HEAT_WINDOW_MS), ev('id1', now - 2 * HEAT_WINDOW_MS), ev('id13', now)], now, 6, 12)
    expect(ids.length).toBe(12)
    expect(grid[4]![0]).toBe(1) // 50 s: the window 50 s to 60 s, the one before the one 60 s falls in
    expect(grid[5]![0]).toBe(0)
    expect(grid[3]![1]).toBe(1) // 40 s: the window before that
    expect(grid.flat().reduce((x, y) => x + y, 0)).toBe(2) // the thirteenth subagent has no column
  })
  test('the shades climb from a dot to a full block and stop there', () => {
    expect([0, 1, 2, 3, 4, 9].map(heatGlyph).join('')).toBe('·░▒▓██')
  })
})

