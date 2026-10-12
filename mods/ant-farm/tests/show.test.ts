// Formatting, the ETA, model colours and the pixel ants, table-driven.

import { describe, expect, test } from 'claude-code/testing'

import {
  ANT_WIDTH, antRows, bar, fmtCost, fmtDuration, fmtEta, fmtTokens, miniAnt, modelColors,
  alarmText, clean, nextAlarm, progressOf, shortModel, spendLabel, spendOf, statusText, trimAnts, viewAfterClose,
} from '../hooks/show'
import type { AntFarmAnt } from '../types'

function ant(over: Partial<AntFarmAnt> & { requests?: number } = {}): AntFarmAnt {
  const { requests = 0, ...rest } = over
  return {
    id: 'a', task: 't', type: 'Explore', model: 'claude-haiku-5-5', status: 'running', startedAt: 0,
    usage: { requests, tokens: requests * 100, costUsd: 0, unpricedTokens: 0 },
    ...rest,
  }
}

describe('format', () => {
  const u = (costUsd: number, unpricedTokens = 0) => ({ requests: 1, tokens: 1, costUsd, unpricedTokens })
  const costs: [ReturnType<typeof u>, string][] = [
    [u(0), '≈$0.00'],
    [u(0.0002), '≈$0.0002'],
    [u(0.042), '≈$0.042'],
    [u(1.234), '≈$1.23'],
    [u(0, 500), '?'],
    [u(0.5, 500), '≈$0.50+?'],
  ]
  for (const [usage, text] of costs) test(`cost ${text}`, () => expect(fmtCost(usage)).toBe(text))

  const tokens: [number, string][] = [[0, '0'], [999, '999'], [1000, '1k'], [1234, '1.2k'], [98_765, '98.8k'], [123_456, '123k'], [1_234_567, '1.23M']]
  for (const [n, text] of tokens) test(`tokens ${n}`, () => expect(fmtTokens(n)).toBe(text))

  const durations: [number, string][] = [[0, '0s'], [42_400, '42s'], [65_000, '1m 05s'], [3_725_000, '1h 02m'], [-5, '0s']]
  for (const [ms, text] of durations) test(`duration ${ms}`, () => expect(fmtDuration(ms)).toBe(text))

  const etas: [number, string][] = [[1000, '~5s left'], [22_000, '~20s left'], [60_000, '~1m left'], [150_000, '~3m left'], [3_900_000, '~1h 5m left']]
  for (const [ms, text] of etas) test(`eta ${ms}`, () => expect(fmtEta(ms)).toBe(text))

  test('short model names', () => {
    expect(shortModel('claude-opus-5-5')).toBe('opus-5-5')
    expect(shortModel('us.anthropic.claude-sonnet-4-6-v1:0')).toBe('sonnet-4-6-v1:0')
    expect(shortModel('mystery-1')).toBe('mystery-1')
  })

  test('the spend: Claude Code estimate where given, else the table one, both marked ≈', () => {
    const est = { requests: 1, tokens: 10, costUsd: 0.5, unpricedTokens: 0 }
    expect(spendOf(1.234, est)).toEqual({ usd: 1.234, text: '≈$1.23', isEngine: true, isAny: true })
    expect(spendOf(0, { ...est, tokens: 0 }).isAny).toBe(false)
    expect(spendOf(null, est)).toEqual({ usd: 0.5, text: '≈$0.50', isEngine: false, isAny: true })
    expect(spendOf(null, { ...est, unpricedTokens: 4 }).text).toBe('≈$0.50+?')
  })

  test('status line text by level and source', () => {
    const est = (costUsd: number, tokens = 10) => spendOf(null, { requests: 1, tokens, costUsd, unpricedTokens: 0 })
    const real = (usd: number) => spendOf(usd, { requests: 1, tokens: 10, costUsd: 0, unpricedTokens: 0 })
    expect(statusText(est(0, 0), 2, 0)).toBeUndefined()
    expect(statusText(est(0.5), 2, 0)).toBe('≈$0.50 of $2.00 budget')
    expect(statusText(est(2.5), 2, 1)).toBe('≈$2.50 of $2.00 budget - over budget')
    expect(statusText(est(2.5), 1, 2)).toBe('≈$2.50 of $1.00 budget - past 2x the budget')
    expect(statusText(est(2.5), 0, 0)).toBe('≈$2.50 this session')
    expect(statusText(real(2.5), 2, 1)).toBe('≈$2.50 of $2.00 budget (Claude Code\'s estimate) - over budget')
    expect(statusText(real(2.5), 0, 0)).toBe('≈$2.50 this session (Claude Code\'s estimate)')
  })

  test('alarm text names where the figure came from', () => {
    const real = spendOf(2.1, { requests: 1, tokens: 10, costUsd: 0, unpricedTokens: 0 })
    const est = spendOf(null, { requests: 1, tokens: 10, costUsd: 4.2, unpricedTokens: 0 })
    expect(alarmText(real, 2, 1)).toBe('Claude Code\'s estimate ≈$2.10 reached your $2.00 budget.')
    expect(alarmText(est, 2, 2)).toBe('Session estimate ≈$4.20 is past 2x your $2.00 budget.')
  })

  test('bar', () => {
    expect(bar(null, 4)).toBe('····')
    expect(bar(0.5, 4)).toBe('██░░')
    expect(bar(1, 4)).toBe('████')
    expect(bar(2, 4)).toBe('████')
  })
})

describe('progressOf', () => {
  test('no estimate before 3 requests', () => {
    expect(progressOf(ant({ requests: 2 }), [], 20_000)).toEqual({ fraction: null, etaMs: null })
  })
  test('no finished subagents yet: assume halfway, at its own pace', () => {
    // 3 requests in 30s: 10s a request, 3 more to go.
    expect(progressOf(ant({ requests: 3 }), [], 30_000)).toEqual({ fraction: 0.5, etaMs: 30_000 })
  })
  test('finished subagents of the same type set the expected length', () => {
    const history = [
      ant({ id: 'x', status: 'done', requests: 8 }),
      ant({ id: 'y', status: 'done', requests: 10 }),
      ant({ id: 'z', status: 'done', requests: 12 }),
      ant({ id: 'p', status: 'done', type: 'Plan', requests: 40 }),
      ant({ id: 'f', status: 'failed', requests: 99 }),
    ]
    // 4 requests in 40s: median 10 of its type, 6 to go at 10s each.
    expect(progressOf(ant({ requests: 4 }), history, 40_000)).toEqual({ fraction: 0.4, etaMs: 60_000 })
  })
  test('another type stands in when none of its own has finished', () => {
    const history = [ant({ id: 'p', status: 'done', type: 'Plan', requests: 6 })]
    expect(progressOf(ant({ requests: 3 }), history, 30_000)).toEqual({ fraction: 0.5, etaMs: 30_000 })
  })
  test('past the usual length there is no estimate and the bar stays nearly full', () => {
    const history = [ant({ id: 'x', status: 'done', requests: 4 })]
    expect(progressOf(ant({ requests: 9 }), history, 90_000)).toEqual({ fraction: 0.9, etaMs: null })
    expect(progressOf(ant({ requests: 4 }), history, 40_000)).toEqual({ fraction: 0.8, etaMs: null })
    expect(progressOf(ant({ requests: 3 }), history, 30_000)).toEqual({ fraction: 0.75, etaMs: 10_000 })
  })
  test('done is full; failed has no estimate', () => {
    expect(progressOf(ant({ status: 'done', requests: 5 }), [], 1).fraction).toBe(1)
    expect(progressOf(ant({ status: 'failed', requests: 5 }), [], 1)).toEqual({ fraction: null, etaMs: null })
  })
})

describe('modelColors', () => {
  test('one colour per model, each different, families first', () => {
    const colors = modelColors([
      ant({ id: '1', model: 'claude-haiku-5-5', startedAt: 1 }),
      ant({ id: '2', model: 'claude-opus-5-5', startedAt: 2 }),
      ant({ id: '3', model: 'claude-haiku-5-5', startedAt: 3 }),
      ant({ id: '4', model: 'claude-haiku-4-5', startedAt: 4 }),
      ant({ id: '5', model: 'mystery-1', startedAt: 5 }),
    ])
    expect(colors.size).toBe(4)
    expect(colors.get('claude-haiku-5-5')).toBe('planMode')
    expect(colors.get('claude-opus-5-5')).toBe('autoAccept')
    expect(new Set(colors.values()).size).toBe(4)
  })
})

describe('pixel ants', () => {
  test('a running ant walks: its legs and place change frame to frame', () => {
    const a = antRows('running', 0, ANT_WIDTH + 3)
    const b = antRows('running', 1, ANT_WIDTH + 3)
    expect(a).toHaveLength(3)
    expect(a.every(r => r.length === ANT_WIDTH + 3)).toBe(true)
    expect(a.join('\n')).not.toBe(b.join('\n'))
    expect(/^[ ▀▄█]+$/.test(a.join(''))).toBe(true)
  })
  test('a finished ant stands still; a failed one lies on its back', () => {
    expect(antRows('done', 0, 12)).toEqual(antRows('done', 7, 12))
    expect(antRows('failed', 0, 12)).toEqual(antRows('failed', 3, 12))
    expect(antRows('failed', 0, 12)).not.toEqual(antRows('done', 0, 12))
  })
  test('the small ant is one row and walks only while running', () => {
    expect(miniAnt('running', 0)).not.toBe(miniAnt('running', 1))
    expect(miniAnt('done', 0)).toBe(miniAnt('done', 1))
    expect(miniAnt('done', 0).includes('\n')).toBe(false)
  })
})

describe('viewAfterClose', () => {
  const open = { isListInBand: true, isFinishedExpanded: true, isClosedByHand: false, hasOpenedUnasked: true }
  test('the person closing the pane ends the list and the unasked opens', () => {
    expect(viewAfterClose(open, 'person')).toEqual({ isListInBand: false, isFinishedExpanded: true, isClosedByHand: true, hasOpenedUnasked: true })
  })
  test('a plugin or the engine closing it changes nothing', () => {
    expect(viewAfterClose(open, 'plugin')).toEqual(open)
    expect(viewAfterClose(open, 'unload')).toEqual(open)
  })
})

describe('nextAlarm', () => {
  const cases: [string, { level: number; budgetUsd: number }, 0 | 1 | 2, number, { level: number; budgetUsd: number }, 0 | 1 | 2][] = [
    ['first crossing', { level: 0, budgetUsd: 2 }, 1, 2, { level: 1, budgetUsd: 2 }, 1],
    ['same level again is quiet', { level: 1, budgetUsd: 2 }, 1, 2, { level: 1, budgetUsd: 2 }, 0],
    ['a lower reading keeps the level and stays quiet', { level: 2, budgetUsd: 2 }, 0, 2, { level: 2, budgetUsd: 2 }, 0],
    ['past twice it', { level: 1, budgetUsd: 2 }, 2, 2, { level: 2, budgetUsd: 2 }, 2],
    ['straight past twice it', { level: 0, budgetUsd: 2 }, 2, 2, { level: 2, budgetUsd: 2 }, 2],
    ['a new budget re-arms: under it', { level: 2, budgetUsd: 2 }, 0, 5, { level: 0, budgetUsd: 5 }, 0],
    ['a new budget re-arms: over it', { level: 1, budgetUsd: 2 }, 1, 1, { level: 1, budgetUsd: 1 }, 1],
    ['nothing stored yet', { level: 0, budgetUsd: -1 }, 0, 2, { level: 0, budgetUsd: 2 }, 0],
  ]
  for (const [name, stored, level, budget, alarm, toast] of cases) {
    test(name, () => expect(nextAlarm(stored, level, budget)).toEqual({ alarm, toast }))
  }
})

describe('labels and trimming', () => {
  test('the session figure names its source', () => {
    const est = { requests: 1, tokens: 10, costUsd: 0.4, unpricedTokens: 0 }
    expect(spendLabel(spendOf(2.5, est))).toBe('Claude Code\'s estimate ≈$2.50')
    expect(spendLabel(spendOf(null, est))).toBe('≈$0.40 session')
  })
  test('trimming drops the oldest finished ants before any running one', () => {
    const list = [
      ant({ id: 'r1' }),
      ant({ id: 'd1', status: 'done' }),
      ant({ id: 'r2' }),
      ant({ id: 'f1', status: 'failed' }),
      ant({ id: 'd2', status: 'done' }),
    ]
    expect(trimAnts(list, 3).map(a => a.id)).toEqual(['r1', 'r2', 'd2'])
    expect(trimAnts(list, 9).map(a => a.id)).toEqual(['r1', 'd1', 'r2', 'f1', 'd2'])
    expect(trimAnts([ant({ id: 'a' }), ant({ id: 'b' })], 1).map(a => a.id)).toEqual(['b'])
  })
})

describe('clean', () => {
  const R = '\uFFFD'
  const cases: [string, string, string][] = [
    ['plain text is kept', 'Map the auth flow · ≈ █', 'Map the auth flow · ≈ █'],
    ['a colour sequence is removed', 'a\x1b[31;1mred\x1b[0m', 'ared'],
    ['a title sequence is removed', 'x\x1b]0;evil\x07y', 'xy'],
    ['a title sequence ended by ST is removed', 'x\x1b]0;evil\x1b\\y', 'xy'],
    ['an 8-bit CSI is removed', 'x\u009b2Jy', 'xy'],
    ['a lone ESC pair is removed', 'x\x1bMy', 'xy'],
    ['BEL, NUL, DEL, tab, newline become U+FFFD', 'a\x07b\x00c\x7fd\te\nf', `a${R}b${R}c${R}d${R}e${R}f`],
    ['C1 characters become U+FFFD', 'a\u0085b\u0080c\u009fd', `a${R}b${R}c${R}d`],
  ]
  for (const [name, input, output] of cases) test(name, () => expect(clean(input)).toBe(output))
})
