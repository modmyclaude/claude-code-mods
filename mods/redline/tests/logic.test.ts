// Table tests for redline's pure logic: thresholds, the toast's hysteresis,
// pace, tokens per minute, plan run-out, the price table and the formatters.

import { describe, expect, test } from 'claude-code/testing'
import type { TurnUsage } from 'claude-code'
import type { RedlineGauge } from '../types'

import {
  alarm,
  bar,
  busiest,
  EMPTY_GAUGE,
  fmtPace,
  fmtTokens,
  fmtUsd,
  clean,
  gaugeLine,
  levelOf,
  limitText,
  paceEta,
  percentOf,
  reduce,
  recordLimits,
  runOut,
  tokensPerMinute,
} from '../hooks/gauge'
import { priceRequest, priceRow } from '../hooks/prices'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = Date.parse('2026-10-08T12:00:00Z')
const cents = (usd: number): number => Math.round(usd * 100) / 100

const usage = (model: string, ctx: number, output = 100): TurnUsage => ({
  model,
  input_tokens: 1000,
  cache_creation_input_tokens: 1000,
  cache_read_input_tokens: ctx - 2000,
  output_tokens: output,
})

describe('levels', () => {
  const cases: [number | undefined, string][] = [
    [undefined, 'unknown'],
    [0, 'normal'],
    [59, 'normal'],
    [60, 'amber'],
    [79, 'amber'],
    [80, 'red'],
    [100, 'red'],
  ]
  for (const [percent, level] of cases) {
    test(`${percent}% is ${level}`, () => expect(levelOf(percent)).toBe(level))
  }

  test('percent rounds tokens over the window and is unknown without both', () => {
    expect(percentOf({ contextTokens: 159_000, contextPercent: null, window: 200_000 })).toBe(80)
    expect(percentOf({ contextTokens: 158_900, contextPercent: null, window: 200_000 })).toBe(79)
    expect(percentOf({ contextTokens: null, contextPercent: null, window: 200_000 })).toBeUndefined()
    expect(percentOf({ contextTokens: 1000, contextPercent: null, window: null })).toBeUndefined()
  })
})

describe('the 80% toast fires once per upward crossing', () => {
  test('a run of readings fires on the first crossing and again only after dropping under 75%', () => {
    const readings = [50, 79, 80, 85, 99, 78, 76, 81, 74, 79, 80, 82]
    const fired: number[] = []
    let armed = true
    for (const p of readings) {
      const r = alarm(armed, p)
      armed = r.isArmed
      if (r.fire) fired.push(p)
    }
    expect(fired).toEqual([80, 80])
  })

  test('an unknown reading neither fires nor re-arms', () => {
    expect(alarm(true, undefined)).toEqual({ isArmed: true, fire: false })
    expect(alarm(false, undefined)).toEqual({ isArmed: false, fire: false })
  })

  test('a session that opens past 80% warns once', () => {
    expect(alarm(true, 92)).toEqual({ isArmed: false, fire: true })
  })
})

describe('pace', () => {
  const W = 200_000
  const cases: [string, [number, number][], number | undefined][] = [
    ['no samples: no estimate', [], undefined],
    ['one sample: no estimate', [[0, 100_000]], undefined],
    ['no growth: no estimate', [[0, 100_000], [5, 100_000]], undefined],
    ['shrinking: no estimate', [[0, 150_000], [3, 120_000], [6, 90_000]], undefined],
    ['under a minute of growth: no estimate', [[9.5, 100_000], [10, 120_000]], undefined],
    // 20k in 4 min = 5k/min; 80k left -> 16 min.
    ['steady growth', [[2, 100_000], [6, 120_000]], 16 * MIN],
    // A compaction at minute 4 starts the run over: 40k -> 60k in 4 min.
    ['growth after a compaction', [[0, 150_000], [2, 170_000], [4, 40_000], [8, 60_000]], 28 * MIN],
    // Readings older than 10 minutes do not count.
    ['old readings are dropped', [[-30, 0], [5, 100_000]], undefined],
    ['already full', [[2, 150_000], [6, 210_000]], 0],
  ]
  for (const [name, points, expected] of cases) {
    test(name, () => {
      // Minutes before NOW + 10 min, so every case sits inside the window.
      const samples = points.map(([m, tokens]) => ({ t: NOW + m * MIN, tokens }))
      const eta = paceEta(samples, W, NOW + 10 * MIN)
      if (expected === undefined) expect(eta).toBeUndefined()
      else expect(Math.round(eta ?? -1)).toBe(expected)
    })
  }

  test('no window: no estimate', () => {
    expect(paceEta([{ t: 0, tokens: 1 }, { t: 5 * MIN, tokens: 2 }], null, 5 * MIN)).toBeUndefined()
  })

  const words: [number | undefined, string | undefined][] = [
    [undefined, undefined],
    [0, 'full now'],
    [30_000, 'full in <1m'],
    [25 * MIN, 'full in ~25m'],
    [2 * HOUR + 10 * MIN, 'full in ~2h 10m'],
    [30 * HOUR, 'full in >1d'],
  ]
  for (const [ms, text] of words) test(`pace words for ${ms}`, () => expect(fmtPace(ms)).toBe(text))
})

describe('tokens per minute', () => {
  test('sums the last 10 minutes over the minutes covered', () => {
    const flow = [
      { t: NOW - 20 * MIN, tokens: 999_999 }, // outside the window
      { t: NOW - 8 * MIN, tokens: 20_000 },
      { t: NOW - 1 * MIN, tokens: 10_000 },
    ]
    expect(tokensPerMinute(flow, NOW, null)).toBe(3_000)
    // Tracking for 5 minutes only: divide by 5, not 10.
    expect(tokensPerMinute(flow, NOW, NOW - 5 * MIN)).toBe(6_000)
    // Never divides by less than a minute.
    expect(tokensPerMinute([{ t: NOW, tokens: 500 }], NOW, NOW - 1000)).toBe(500)
    expect(tokensPerMinute([], NOW, null)).toBe(0)
  })
})

describe('plan run-out', () => {
  const at = (hoursLeft: number) => new Date(NOW + hoursLeft * HOUR).toISOString()
  test('a 5-hour window used fast runs out before it resets', () => {
    // Opened 2h ago, 80% used: 40%/h, 20% left -> 30 min, reset in 3h.
    const r = runOut({ kind: 'five_hour', percentUsed: 80, resetsAt: at(3) }, NOW)
    expect(r?.kind).toBe('at')
    expect(r?.kind === 'at' ? Math.round(r.ms / MIN) : -1).toBe(30)
    expect(limitText({ kind: 'five_hour', percentUsed: 80, resetsAt: at(3) }, NOW)).toBe('5h 80% out in ~30m')
  })
  test('a window used slowly resets first', () => {
    const l = { kind: 'seven_day', percentUsed: 10, resetsAt: at(24 * 6) }
    expect(runOut(l, NOW)).toEqual({ kind: 'resets-first', basis: 'average' })
    expect(limitText(l, NOW)).toBe('7d 10%')
  })
  test('a late burst warns at the recent rate, which the average would hide', () => {
    // Opened 4.5h ago, 50% used, resets in 30 min: the average says it resets first.
    const l = { kind: 'five_hour', percentUsed: 50, resetsAt: at(0.5) }
    expect(limitText(l, NOW)).toBe('5h 50%')
    // But it went 20% -> 50% in the last 10 minutes: 3 points a minute, dry in ~17m.
    const burst = [{ t: NOW - 10 * MIN, tokens: 20 }, { t: NOW, tokens: 50 }]
    const r = runOut(l, NOW, burst)
    expect(r).toMatchObject({ kind: 'at', basis: 'recent' })
    expect(r?.kind === 'at' ? Math.round(r.ms / MIN) : -1).toBe(17)
    expect(limitText(l, NOW, burst)).toBe('5h 50% out in ~17m')
  })
  test('a window that held still lately falls back to its average pace', () => {
    const flat = [{ t: NOW - 10 * MIN, tokens: 80 }, { t: NOW, tokens: 80 }]
    expect(runOut({ kind: 'five_hour', percentUsed: 80, resetsAt: at(3) }, NOW, flat)).toMatchObject({ kind: 'at', basis: 'average' })
  })
  test('a reset inside the last 15 minutes starts the recent run over', () => {
    // Reset 4 minutes ago (95 -> 3), then 3 -> 5 in 4 minutes: 0.5 a minute, 95 left.
    const history = [{ t: NOW - 8 * MIN, tokens: 95 }, { t: NOW - 4 * MIN, tokens: 3 }, { t: NOW, tokens: 5 }]
    const r = runOut({ kind: 'five_hour', percentUsed: 5, resetsAt: at(5 - 4 / 60) }, NOW, history)
    expect(r).toMatchObject({ kind: 'at', basis: 'recent' })
    expect(r?.kind === 'at' ? Math.round(r.ms / MIN) : -1).toBe(190)
  })
  test('readings are kept for 15 minutes, one a minute while the figure holds still', () => {
    const l = (percentUsed: number) => [{ kind: 'five_hour', percentUsed }]
    let h = recordLimits({}, l(10), NOW - 20 * MIN)
    h = recordLimits(h, l(10), NOW - 30_000) // the old one is dropped
    h = recordLimits(h, l(10), NOW - 10_000) // same figure, under a minute: not kept
    h = recordLimits(h, l(12), NOW) // moved: kept
    expect(h.five_hour).toEqual([{ t: NOW - 30_000, tokens: 10 }, { t: NOW, tokens: 12 }])
  })
  test('a spent window is out', () => {
    expect(runOut({ kind: 'five_hour', percentUsed: 100, resetsAt: at(1) }, NOW)).toEqual({ kind: 'out' })
    // Spent: the one-line gauge says when it comes back.
    expect(limitText({ kind: 'five_hour', percentUsed: 100, resetsAt: at(1) }, NOW)).toBe('5h OUT, resets in ~1h')
    expect(limitText({ kind: 'five_hour', percentUsed: 100 }, NOW)).toBe('5h OUT')
  })
  test('a window past its reset time reads reset, not a stale figure', () => {
    expect(limitText({ kind: 'five_hour', percentUsed: 100, resetsAt: at(-0.1) }, NOW)).toBe('5h reset')
  })
  const none: [string, { kind: string; percentUsed: number; resetsAt?: string }][] = [
    ['a window of unknown length', { kind: 'spend_limit', percentUsed: 50, resetsAt: at(1) }],
    ['no reset time', { kind: 'five_hour', percentUsed: 50 }],
    ['an unused window', { kind: 'five_hour', percentUsed: 0, resetsAt: at(1) }],
    ['a window opened 5 minutes ago', { kind: 'five_hour', percentUsed: 20, resetsAt: at(5 - 5 / 60) }],
  ]
  for (const [name, l] of none) test(`no run-out for ${name}`, () => expect(runOut(l, NOW)).toBeUndefined())
})

describe('price table', () => {
  const rows: [string, string | undefined][] = [
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-opus-5', 'Opus 4.5 - 5'],
    ['claude-opus-4-5-20251101', 'Opus 4.5 - 5'],
    ['claude-opus-4-1-20250805', 'Opus 4 - 4.1'],
    ['claude-opus-4-20250514', 'Opus 4 - 4.1'],
    ['us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'Sonnet 4 - 4.6'],
    ['claude-sonnet-5-5', 'Sonnet 5 - 5.5'],
    ['claude-haiku-4-5@20251001', 'Haiku 4.5'],
    ['claude-haiku-5-5', 'Haiku 5.5'],
    ['claude-fable-5-1', 'Fable 5.1'],
    ['claude-mythos-5', 'Fable 5'],
    ['claude-3-5-haiku-20241022', undefined],
    ['claude-opus-6', undefined],
    ['gpt-whatever', undefined],
  ]
  for (const [model, label] of rows) test(`${model} -> ${label ?? 'no price'}`, () => expect(priceRow(model)?.label).toBe(label))

  test('a request is priced per category', () => {
    const usd = priceRequest('claude-opus-5-5', { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 })
    expect(usd && [usd.input, usd.output, usd.cacheRead, usd.cacheWrite].map(cents)).toEqual([4, 20, 0.2, 5])
    const sonnet = priceRequest('claude-sonnet-4-6', { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 })
    expect(sonnet && [sonnet.cacheRead, sonnet.cacheWrite].map(cents)).toEqual([0.3, 3.75])
  })
  test('Haiku 5.5 takes its second card over a 100k prompt', () => {
    const small = priceRequest('claude-haiku-5-5', { input: 100_000, output: 0, cacheRead: 0, cacheWrite: 0 })
    const big = priceRequest('claude-haiku-5-5', { input: 100_001, output: 0, cacheRead: 0, cacheWrite: 0 })
    expect(cents(small?.input ?? 0)).toBe(0.01)
    expect(big?.input).toBeGreaterThan(0.05)
    expect(big?.input).toBeLessThan(0.0501)
  })
  test('an unknown model has no price, never a guess', () => {
    expect(priceRequest('claude-nova-1', { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 })).toBeUndefined()
  })
})

describe('reduce', () => {
  test('a main-loop request sets the context, totals, flow and cost by the table', () => {
    const { gauge, fire } = reduce(
      { ...EMPTY_GAUGE, window: 200_000 },
      { now: NOW, request: { turnId: 't', usage: usage('claude-opus-5-5', 100_000, 2000) } },
    )
    expect(fire).toBe(false)
    expect(gauge.contextTokens).toBe(100_000)
    expect(gauge.totals).toEqual({ input: 1000, output: 2000, cacheRead: 98_000, cacheWrite: 1000 })
    expect(gauge.flow).toEqual([{ t: NOW, tokens: 4000 }])
    expect(gauge.unpriced).toEqual([])
    expect(gauge.turns[0]?.requests).toBe(1)
    expect(cents(gauge.tableUsd.output)).toBe(0.04)
  })

  test("a subagent's request counts toward totals but not the session's context", () => {
    const start = { ...EMPTY_GAUGE, window: 200_000, contextTokens: 50_000 }
    const { gauge } = reduce(start, { now: NOW, request: { turnId: 's', agentId: 'agent-123456789', usage: usage('claude-haiku-4-5', 150_000) } })
    expect(gauge.contextTokens).toBe(50_000)
    expect(gauge.totals.cacheRead).toBe(148_000)
    expect(gauge.turns[0]).toMatchObject({ isSubagent: true, label: 'subagent agent-12' })
  })

  test('an unknown model is listed as unpriced and the line falls back to tokens', () => {
    const { gauge } = reduce({ ...EMPTY_GAUGE, window: 200_000 }, { now: NOW, request: { turnId: 't', usage: usage('claude-nova-1', 10_000) } })
    expect(gauge.unpriced).toEqual(['claude-nova-1'])
    expect(gauge.turns[0]?.usd).toBeNull()
    expect(gaugeLine(gauge, NOW)).toContain('10k tok')
    expect(gaugeLine(gauge, NOW)).not.toContain('$')
  })

  test("the ledger, when Claude Code keeps one, is the cost shown, marked ≈: it is list-price arithmetic, not a bill", () => {
    const { gauge } = reduce({ ...EMPTY_GAUGE, window: 200_000 }, { now: NOW, ledgerUsd: 3.456, request: { turnId: 't', usage: usage('claude-nova-1', 10_000) } })
    expect(gaugeLine(gauge, NOW)).toContain(' · ≈$3.46 · ')
  })

  test("Claude Code's own percentage wins for the count it came with, and only that count", () => {
    const g = { ...EMPTY_GAUGE, window: 200_000 }
    // 159k of 200k computes to 80%; Claude Code said 79 for it.
    const own = reduce(g, { now: NOW, contextTokens: 159_000, contextPercent: 79 }).gauge
    expect(percentOf(own)).toBe(79)
    // A request with a count Claude Code has not measured yet: computed.
    const next = reduce(own, { now: NOW, contextTokens: 159_000, contextPercent: 79, request: { turnId: 't', usage: usage('claude-opus-5-5', 170_000) } }).gauge
    expect(percentOf(next)).toBe(85)
    // A compaction's count has no percentage of its own: computed.
    expect(percentOf(reduce(own, { now: NOW, contextTokens: 40_000 }).gauge)).toBe(20)
  })

  test('past the 100-turn cap a new turn keeps its prompt and the quietest old one goes', () => {
    let g: RedlineGauge = { ...EMPTY_GAUGE, window: 1_000_000 }
    for (let i = 0; i < 100; i++) {
      g = reduce(g, { now: NOW, turnStart: { turnId: `small-${i}`, text: `small ${i}` } }).gauge
      g = reduce(g, { now: NOW, request: { turnId: `small-${i}`, usage: usage('claude-opus-5-5', 10_000 + i) } }).gauge
    }
    g = reduce(g, { now: NOW, turnStart: { turnId: 'big', text: 'the big one' } }).gauge
    g = reduce(g, { now: NOW, request: { turnId: 'big', usage: usage('claude-opus-5-5', 400_000) } }).gauge
    expect(g.turns).toHaveLength(100)
    expect(busiest(g)[0]?.label).toBe('the big one')
    expect(g.turns.some(t => t.id === 'small-0')).toBe(false)
  })

  test('the busiest turns come first', () => {
    let g: RedlineGauge = { ...EMPTY_GAUGE, window: 1_000_000 }
    for (const [id, ctx] of [['a', 10_000], ['b', 300_000], ['c', 50_000], ['b', 310_000]] as const) {
      g = reduce(g, { now: NOW, request: { turnId: id, usage: usage('claude-opus-5-5', ctx) } }).gauge
    }
    expect(busiest(g).map(t => t.id)).toEqual(['b', 'c', 'a'])
    expect(busiest(g)[0]?.requests).toBe(2)
  })
})

describe('clean: nothing the engine would refuse is ever drawn', () => {
  const cases: [string, string, string][] = [
    ['plain text', 'claude-opus-5-5', 'claude-opus-5-5'],
    ['a 7-bit colour sequence', '\u001b[31mred\u001b[0m', 'red'],
    ['an 8-bit CSI (U+009B)', 'a\u009b31mb', 'ab'],
    ['a window-title OSC', '\u001b]0;title\u0007after', 'after'],
    ['a bell', 'a\u0007b', 'a\ufffdb'],
    ['a C1 control (U+0085)', 'a\u0085b', 'a\ufffdb'],
    ['NUL and DEL', '\u0000\u007f', '\ufffd\ufffd'],
    ['a lone ESC', 'x\u001b', 'x\ufffd'],
    ['a tab', 'tab\there', 'tab here'],
  ]
  for (const [name, input, output] of cases) test(name, () => expect(clean(input)).toBe(output))
})

describe('formatting', () => {
  const cases: [number, string][] = [
    [0, '0'],
    [999, '999'],
    [1234, '1.2k'],
    [164_200, '164k'],
    [1_000_000, '1.0M'],
    [3_250_000, '3.3M'],
  ]
  for (const [n, s] of cases) test(`${n} tokens read ${s}`, () => expect(fmtTokens(n)).toBe(s))
  const usd: [number, string][] = [
    [0, '≈$0.00'],
    [0.004, '≈<$0.01'],
    [0.0537, '≈$0.05'],
    [4.125, '≈$4.13'],
    [123.4, '≈$123'],
  ]
  for (const [n, text] of usd) test(`$${n} reads ${text}`, () => expect(fmtUsd(n)).toBe(text))
  test('bars fill by the percent and clamp', () => {
    expect(bar(0, 10)).toBe('░░░░░░░░░░')
    expect(bar(52, 10)).toBe('█████░░░░░')
    expect(bar(150, 4)).toBe('████')
    expect(bar(undefined, 3)).toBe('░░░')
  })
})
