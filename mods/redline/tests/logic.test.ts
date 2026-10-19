// Table tests for redline's pure logic: thresholds, the toast's hysteresis,
// pace, tokens per minute, plan run-out, the price table and the formatters.

import { describe, expect, test } from 'claude-code/testing'
import type { TurnUsage } from 'claude-code'
import type { RedlineGauge, RedlineSpend, RedlineTurn } from '../types'
import { kindOf, kindsCarried, modelLabel, spendLabel } from '../hooks/spend'

import {
  alarm,
  bar,
  busiest,
  clean,
  costliest,
  EMPTY_GAUGE,
  fmtClock,
  fmtDuration,
  fmtPace,
  fmtReset,
  fmtSince,
  fmtSpan,
  fmtTokens,
  fmtUsd,
  gaugeLine,
  gaugeParts,
  labelOf,
  levelOf,
  limitFigure,
  limitLevel,
  limitRowLabel,
  limitText,
  paceEta,
  percentOf,
  recordLimits,
  reduce,
  runOut,
  tokensPerMinute,
  verdict,
} from '../hooks/gauge'
import { boltPose, detailChunks, detailLines, detailText, labelCells } from '../hooks/detail'
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

  const durations: [number, string][] = [
    [30_000, '<1m'],
    [25 * MIN, '25m'],
    [59 * MIN + 40_000, '1h'],
    [2 * HOUR + 10 * MIN, '2h 10m'],
    [3 * 24 * HOUR + 5 * HOUR, '3d 5h'],
    [30 * 24 * HOUR - 10 * MIN, '30d'],
  ]
  for (const [ms, text] of durations) test(`${ms} ms reads ${text}`, () => expect(fmtDuration(ms)).toBe(text))

  const words: [number | undefined, string | undefined][] = [
    [undefined, undefined],
    [0, 'full now'],
    [30_000, 'full in <1m'],
    [25 * MIN, 'full in ≈25m'],
    [2 * HOUR + 10 * MIN, 'full in ≈2h 10m'],
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
    expect(limitText({ kind: 'five_hour', percentUsed: 80, resetsAt: at(3) }, NOW)).toBe('5h ████░ 80% AMBER, out in ≈30m')
  })
  test('a window used slowly resets first', () => {
    const l = { kind: 'seven_day', percentUsed: 10, resetsAt: at(24 * 6) }
    expect(runOut(l, NOW)).toEqual({ kind: 'resets-first', basis: 'average' })
    expect(limitText(l, NOW)).toBe('week █░░░░ 10%')
  })
  test('a late burst warns at the recent rate, which the average would hide', () => {
    // Opened 4.5h ago, 50% used, resets in 30 min: the average says it resets first.
    const l = { kind: 'five_hour', percentUsed: 50, resetsAt: at(0.5) }
    expect(limitText(l, NOW)).toBe('5h ███░░ 50%')
    // But it went 20% -> 50% in the last 10 minutes: 3 points a minute, dry in ≈17m.
    const burst = [{ t: NOW - 10 * MIN, tokens: 20 }, { t: NOW, tokens: 50 }]
    const r = runOut(l, NOW, burst)
    expect(r).toMatchObject({ kind: 'at', basis: 'recent' })
    expect(r?.kind === 'at' ? Math.round(r.ms / MIN) : -1).toBe(17)
    expect(limitText(l, NOW, burst)).toBe('5h ███░░ 50% AMBER, out in ≈17m')
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
    expect(limitText({ kind: 'five_hour', percentUsed: 100, resetsAt: at(1) }, NOW)).toBe('5h OUT, resets in 1h')
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

describe('the view where no pane is placed', () => {
  test('transcript chunks are whole lines, each under the cap, and together the whole view, its blocks parted by a blank line', () => {
    const g: RedlineGauge = { ...EMPTY_GAUGE, window: 200_000, contextTokens: 50_000, ledgerUsd: 1.5, sessionStartedAt: NOW - 30 * MIN }
    for (const view of ['overview', 'spend'] as const) {
      const text = detailText(g, NOW, view)
      const rows = text.split('\n')
      const lines = detailLines(g, NOW, view)
      expect(rows.filter(row => row !== ''), view).toEqual(lines.map(l => l.text))
      // A block (the session rows, the footnote) starts after a blank line.
      for (const l of lines.filter(l => l.gap)) expect(text, l.key).toContain(`\n\n${l.text}`)
      expect(detailChunks(g, NOW, view).join('\n'), view).toBe(text)
      // Cut small: every line still there, in order; a blank line never opens a row.
      const small = detailChunks(g, NOW, view, 60)
      expect(small.length, view).toBeGreaterThan(1)
      expect(small.join('\n').split('\n').filter(row => row !== ''), view).toEqual(lines.map(l => l.text))
      const longest = Math.max(...rows.map(l => l.length))
      for (const chunk of small) {
        expect(chunk.length).toBeLessThanOrEqual(Math.max(60, longest))
        expect(chunk.startsWith('\n'), view).toBe(false)
        for (const row of chunk.split('\n')) expect(rows).toContain(row)
      }
    }
  })
})

describe('the detail lines by kind', () => {
  test('before any reading: a dim hero and one line, no bars, no rows, no footnote; with a reading: the hero in its level and the context bar', () => {
    const fresh = detailLines(EMPTY_GAUGE, NOW)
    expect(fresh[0]).toMatchObject({ key: 'title', kind: 'title', textOnly: true, text: 'Redline - context, plan limits and cost' })
    expect(fresh.map(l => l.key)).toEqual(['title', 'state', 'empty', 'spend-link'])
    expect(fresh.find(l => l.key === 'state')).toMatchObject({ kind: 'hero', tone: 'dim', head: true, value: 'Nothing measured yet' })
    expect(fresh.find(l => l.key === 'empty')).toMatchObject({ kind: 'line', tone: 'dim', head: true, value: "Context and limits show up after Claude's next reply." })
    expect(boltPose(EMPTY_GAUGE, NOW)).toBe('sleep')
    const g: RedlineGauge = { ...EMPTY_GAUGE, window: 200_000, contextTokens: 170_000, model: 'claude-opus-5-5', ledgerUsd: 2 }
    const lines = detailLines(g, NOW)
    expect(lines.map(l => l.key)).toEqual(['title', 'state', 'context', 'limits-none', 'cost', 'note', 'spend-link'])
    expect(levelOf(85)).toBe('red')
    expect(lines.find(l => l.key === 'state')).toMatchObject({ kind: 'hero', tone: 'red', head: true, value: 'Context 85%' })
    const context = lines.find(l => l.key === 'context')
    expect(context).toMatchObject({ kind: 'bar', tone: 'red', head: true, label: 'Context', bar: bar(85, 10), figures: ['85%'], clauses: [], text: 'Context  █████████░   85%' })
    expect(context?.bar).toHaveLength(10)
    expect(lines.find(l => l.key === 'limits-none')).toMatchObject({ kind: 'line', tone: 'dim', head: true, value: 'On a Claude plan, 5-hour and week limits appear after a reply.' })
    // The session rows start a block; with no start time known, the cost row carries the gap.
    expect(lines.find(l => l.key === 'cost')).toMatchObject({ kind: 'row', tone: 'plain', gap: true, label: 'Cost', value: '≈$2.00', text: `Cost${'≈$2.00'.padStart(36)}` })
    expect(lines.find(l => l.key === 'note')).toMatchObject({ kind: 'note', tone: 'dim', gap: true, value: 'Dollars are API list prices, not a bill.' })
    expect(boltPose(g, NOW)).toBe('idle')
    for (const l of lines) expect(l.text, l.key).not.toContain(String.fromCharCode(27))
  })
})

describe('where the money went', () => {
  const OPUS: TurnUsage = { model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 }
  const HAIKU: TurnUsage = { model: 'claude-haiku-4-5', input_tokens: 2000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const NOVA: TurnUsage = { model: 'claude-nova-1', input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const fold = (g: RedlineGauge, usage: TurnUsage, kinds: string[], agentId?: string) =>
    reduce(g, { now: NOW, request: { turnId: agentId ?? 't1', agentId, usage, kinds } }).gauge

  test('a request splits evenly across the kinds it carried; cache share is cache reads over the input side; models sum to the total', () => {
    let g = fold(EMPTY_GAUGE, OPUS, ['prompt'])
    g = fold(g, OPUS, ['reading', 'editing'])
    g = fold(g, HAIKU, ['subagents'], 'agent-1')
    // Opus 5.5: 1000 x $4 + 100 x $20 + 9000 x $0.20 per million = $0.0078; Haiku 4.5: 2000 x $1 + 200 x $5 = $0.003.
    // Dollars compared in millionths: the kit has no closeTo.
    const micro = (e: { usd: number | null } | undefined) => (e === undefined || e.usd === null ? e?.usd : Math.round(e.usd * 1e6))
    const shaped = (e: { requests: number; tokens: unknown; usd: number | null } | undefined) => (e === undefined ? undefined : { requests: e.requests, tokens: e.tokens, usd: micro(e) })
    expect(shaped(g.spend.prompt)).toEqual({ requests: 1, tokens: { input: 1000, output: 100, cacheRead: 9000, cacheWrite: 0 }, usd: 7800 })
    expect(shaped(g.spend.reading)).toEqual({ requests: 1, tokens: { input: 500, output: 50, cacheRead: 4500, cacheWrite: 0 }, usd: 3900 })
    expect(g.spend.editing).toEqual(g.spend.reading)
    expect(shaped(g.spend.subagents)).toEqual({ requests: 1, tokens: { input: 2000, output: 200, cacheRead: 0, cacheWrite: 0 }, usd: 3000 })
    const cacheShare = (k: string) => g.spend[k]!.tokens.cacheRead / (g.spend[k]!.tokens.input + g.spend[k]!.tokens.cacheRead + g.spend[k]!.tokens.cacheWrite)
    expect(Math.round(cacheShare('reading') * 100)).toBe(90)
    expect(cacheShare('subagents')).toBe(0)
    const models = Object.values(g.byModel).reduce((s, e) => s + (e.usd ?? 0), 0)
    expect(Math.round(models * 1e6)).toBe(7800 * 2 + 3000)
    expect(Math.round(models * 1e6)).toBe(Math.round((g.tableUsd.input + g.tableUsd.output + g.tableUsd.cacheRead + g.tableUsd.cacheWrite) * 1e6))
    expect(g.byModel['claude-opus-5-5']?.requests).toBe(2)
    expect(g.byModel['claude-haiku-4-5']?.requests).toBe(1)
    // A model with no price makes its kind and its model row priceless, never a guess.
    g = fold(g, NOVA, ['shell'])
    expect(g.spend.shell?.usd).toBeNull()
    expect(g.byModel['claude-nova-1']?.usd).toBeNull()
    expect(micro(g.spend.prompt)).toBe(7800)
  })

  test('kinds: a subagent is one kind whatever it carried; the first request is the prompt; nothing carried is answering; tools by name, MCP by server, a lent plan tool is planning', () => {
    expect(kindsCarried(0, undefined, [])).toEqual(['prompt'])
    expect(kindsCarried(0, undefined, ['Read'])).toEqual(['prompt'])
    expect(kindsCarried(1, undefined, ['Read', 'Edit', 'Read'])).toEqual(['reading', 'editing'])
    expect(kindsCarried(1, undefined, [])).toEqual(['answering'])
    expect(kindsCarried(0, 'agent-1', ['Bash'])).toEqual(['subagents'])
    expect(kindsCarried(3, 'agent-1', [])).toEqual(['subagents'])
    const table: [string, string][] = [
      ['Read', 'reading'], ['Grep', 'reading'], ['Glob', 'reading'],
      ['Edit', 'editing'], ['Write', 'editing'], ['MultiEdit', 'editing'], ['NotebookEdit', 'editing'],
      ['Bash', 'shell'], ['WebSearch', 'search'], ['WebFetch', 'search'], ['ToolSearch', 'search'],
      ['TodoWrite', 'planning'], ['Task', 'planning'], ['Agent', 'planning'], ['ExitPlanMode', 'planning'],
      ['mcp__github__search_issues', 'mcp:github'], ['mcp__headway__plan', 'planning'], ['Mystery', 'other'],
    ]
    for (const [tool, kind] of table) expect(kindOf(tool), tool).toBe(kind)
    expect(spendLabel('mcp:github')).toBe('github')
    expect(spendLabel('mcp:a-server-with-a-long-name')).toBe('a-server-wit')
    expect(spendLabel('subagents')).toBe('Subagents')
    expect(spendLabel('other')).toBe('Other tools')
    // A model by its own family and version, never the price table's range label; an id of another shape loses its vendor prefix and date.
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-opus-4-6-20260101')).toBe('Opus 4.6')
    expect(modelLabel('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('Sonnet 4.5')
    expect(modelLabel('claude-haiku-4-5@20251001')).toBe('Haiku 4.5')
    expect(modelLabel('claude-opus-5')).toBe('Opus 5')
    expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1')
    // The older ids put the version before the family; the date after it is never the version.
    expect(modelLabel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
    expect(modelLabel('claude-3-7-sonnet-20250219')).toBe('Sonnet 3.7')
    expect(modelLabel('claude-3-opus-20240229')).toBe('Opus 3')
    expect(modelLabel('anthropic.claude-3-5-sonnet-20241022-v2:0')).toBe('Sonnet 3.5')
    expect(modelLabel('claude-nova-1-20270101')).toBe('nova-1')
    expect(modelLabel('claude-nova-1@20270101')).toBe('nova-1')
    expect(modelLabel('claude-some-very-long-model-name')).toBe('some-very-lo')
  })
})

describe('a gauge kept by an earlier version', () => {
  test('one without the spend fields still folds a request and still draws: the new fields start empty', () => {
    const { spend: _s, byModel: _m, ...rest } = EMPTY_GAUGE
    const old = { ...rest, window: 200_000, contextTokens: 50_000 } as unknown as RedlineGauge
    const usage: TurnUsage = { model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    expect(detailLines(old, NOW, 'spend').find(l => l.key === 'spend-none')?.value).toContain('after Claude')
    expect(boltPose(old, NOW, 'spend')).toBe('sleep')
    const g = reduce(old, { now: NOW, request: { turnId: 't1', usage, kinds: ['prompt'] } }).gauge
    expect(g.spend.prompt?.requests).toBe(1)
    expect(g.byModel['claude-opus-5-5']?.requests).toBe(1)
    expect(detailLines(g, NOW, 'spend').find(l => l.key === 'spend-prompt')).toMatchObject({ label: 'Prompt', figures: ['≈$0.01', '100%'] })
    // No session start known: the hero says since when redline counts.
    expect(detailLines(g, NOW, 'spend').find(l => l.key === 'spend-total')?.value).toMatch(/^≈\$0\.01 in 1 request · since \d{1,2}(:\d\d)?[ap]m$/)
  })
})

describe('the one-line gauge reads at a glance', () => {
  const at = (hoursLeft: number) => new Date(NOW + hoursLeft * HOUR).toISOString()
  // Moments built from local parts, so the clock-time cases hold in every zone.
  const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()
  const THU = local(15, 13, 20)

  test('a span reads to the minute under ten hours and to the hour from there', () => {
    expect(fmtSpan(9 * HOUR + 43 * MIN)).toBe('9h 43m')
    expect(fmtSpan(20 * HOUR + 43 * MIN)).toBe('21h')
    expect(fmtSpan(23 * HOUR + 40 * MIN)).toBe('1d')
    expect(fmtSpan(2 * 24 * HOUR + 19 * HOUR + 20 * MIN)).toBe('2d 19h')
  })

  test('clock time: today by the hour, this week by the day, further out as a span', () => {
    expect(fmtClock(local(15, 15, 30), THU)).toBe('3:30pm')
    expect(fmtClock(local(15, 0, 5), THU)).toBe('12:05am')
    expect(fmtClock(local(17, 10), THU)).toBe('Sat 10am')
    expect(fmtClock(local(18, 12), THU)).toBe('Sun 12pm')
    expect(fmtClock(local(22, 13, 20), THU)).toBe('in 7d')
  })

  test('a reset under ten hours away is a span, further out the clock time', () => {
    expect(fmtReset(THU + 48 * MIN, THU)).toBe('in 48m')
    expect(fmtReset(THU + 9 * HOUR + 59 * MIN, THU)).toBe('in 9h 59m')
    expect(fmtReset(local(16, 9), THU)).toBe('Fri 9am')
  })

  test("a plan window's level follows whether it hits its wall, never its percentage alone", () => {
    // 83% used, opened 6 days ago, resets in a day: 17 points left at 0.58 an hour lasts 30 hours, so it resets first.
    expect(limitLevel({ kind: 'seven_day', percentUsed: 83, resetsAt: at(24) }, NOW)).toBe('normal')
    // The same figure with two days to go: the same pace empties it in ≈25 hours, before the reset.
    expect(limitLevel({ kind: 'seven_day', percentUsed: 83, resetsAt: at(48) }, NOW)).toBe('amber')
    // Opened 2h ago, 80% used, resets in 3h: dry in 30 minutes.
    expect(limitLevel({ kind: 'five_hour', percentUsed: 80, resetsAt: at(3) }, NOW)).toBe('amber')
    // 40% used but a burst of 30 points in 10 minutes, half an hour before the reset: dry in 20 minutes.
    const burst = [{ t: NOW - 10 * MIN, tokens: 10 }, { t: NOW, tokens: 40 }]
    expect(limitLevel({ kind: 'five_hour', percentUsed: 40, resetsAt: at(0.5) }, NOW, burst)).toBe('amber')
    expect(limitLevel({ kind: 'five_hour', percentUsed: 100, resetsAt: at(1) }, NOW)).toBe('red')
    expect(limitLevel({ kind: 'five_hour', percentUsed: 100, resetsAt: at(-0.1) }, NOW)).toBe('unknown')
  })

  test('a window reads as a bar, or in words where the band has no room for one', () => {
    const l = { kind: 'seven_day', percentUsed: 83, resetsAt: at(24) }
    expect(limitText(l, NOW)).toBe('week ████░ 83%')
    expect(limitText(l, NOW, [], 0)).toBe('week 83% used')
    expect(limitFigure(l, NOW)).toMatchObject({ key: 'limit-seven_day', label: 'week', bar: '████░', value: '83%', level: 'normal', isDim: false })
    expect(limitFigure(l, NOW).clause).toBeUndefined()
  })

  test('a run-out binds to its window with a comma; a spent window says when it comes back, as clock time when far', () => {
    expect(limitText({ kind: 'five_hour', percentUsed: 80, resetsAt: at(3) }, NOW, [], 0)).toBe('5h 80% used AMBER, out in ≈30m')
    // 90% used, opened 5 days ago, resets in 2 days: 10 points left at 0.75 an hour, dry in ≈13h.
    expect(limitText({ kind: 'seven_day', percentUsed: 90, resetsAt: at(48) }, NOW)).toBe('week █████ 90% AMBER, out in ≈13h')
    expect(limitText({ kind: 'seven_day', percentUsed: 100, resetsAt: new Date(local(17, 10)).toISOString() }, THU)).toBe('week OUT, resets Sat 10am')
    expect(limitText({ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(THU + 48 * MIN).toISOString() }, THU)).toBe('5h OUT, resets in 48m')
  })

  test('the figures read in order: the context with its pace, each window, the dollars, the rate while tokens flow', () => {
    const limits = [{ kind: 'five_hour', percentUsed: 11, resetsAt: at(3) }, { kind: 'seven_day', percentUsed: 83, resetsAt: at(24) }]
    let g = reduce({ ...EMPTY_GAUGE, window: 200_000 }, { now: NOW - 4 * MIN, ledgerUsd: 53.86, limits, request: { turnId: 't', usage: usage('claude-opus-5-5', 90_000) } }).gauge
    g = reduce(g, { now: NOW, ledgerUsd: 53.86, limits, request: { turnId: 't', usage: usage('claude-opus-5-5', 98_000) } }).gauge
    const { figures } = gaugeParts(g, NOW)
    expect(figures.map(f => f.key)).toEqual(['context', 'limit-five_hour', 'limit-seven_day', 'cost', 'rate'])
    // +8k context in 4 minutes: 102k left at 2k a minute.
    expect(figures[0]).toMatchObject({ label: 'context', bar: '█████░░░░░', value: '49%', level: 'normal', clause: 'full in ≈51m', isDim: false })
    // On a plan the dollars are a footnote.
    expect(figures[3]).toMatchObject({ key: 'cost', label: '', value: '≈$53.86', isDim: true })
    expect(gaugeLine(g, NOW)).toBe('context █████░░░░░ 49%, full in ≈51m · 5h █░░░░ 11% · week ████░ 83% · ≈$53.86 · 1.1k tokens/min')
    // Idle ten minutes later: no pace, no rate, nothing that reads like a fault.
    expect(gaugeLine(g, NOW + 11 * MIN)).toBe('context █████░░░░░ 49% · 5h █░░░░ 11% · week ████░ 83% · ≈$53.86')
    // With an API key there are no windows: the dollars are the limit, drawn plain.
    const api = reduce({ ...EMPTY_GAUGE, window: 200_000 }, { now: NOW, ledgerUsd: 2, request: { turnId: 't', usage: usage('claude-opus-5-5', 98_000) } }).gauge
    expect(gaugeParts(api, NOW).figures.find(f => f.key === 'cost')).toMatchObject({ value: '≈$2.00', isDim: false })
  })

  test('the narrow band halves the context bar and puts the windows in words', () => {
    const limits = [{ kind: 'seven_day', percentUsed: 83, resetsAt: at(24) }]
    const g = reduce({ ...EMPTY_GAUGE, window: 200_000 }, { now: NOW, ledgerUsd: 2, limits, contextTokens: 170_000 }).gauge
    const narrow = gaugeParts(g, NOW, { context: 5, limit: 0 }).figures
    expect(narrow[0]).toMatchObject({ bar: '████░', value: '85%', level: 'red' })
    expect(narrow[1]).toMatchObject({ value: '83% used', level: 'normal' })
    expect(narrow[1]?.bar).toBeUndefined()
  })
})

describe('the pane on one screen', () => {
  // Moments built from local parts, so the clock-time words hold in every zone: Sat Oct 17 2026, 2pm.
  const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()
  const SAT = local(17, 14)
  const spend = (usd: number, requests: number): RedlineSpend => ({ requests, tokens: { input: 1000 * requests, output: 100 * requests, cacheRead: 0, cacheWrite: 0 }, usd })
  const turn = (id: string, label: string, usd: number | null, requests = 1, tokens = 1000): RedlineTurn => ({
    id,
    label,
    isSubagent: false,
    startedAt: SAT,
    requests,
    tokens: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0 },
    usd,
  })
  const FIVE = { kind: 'five_hour', percentUsed: 14, resetsAt: new Date(SAT + 48 * MIN).toISOString() }
  const WEEK = { kind: 'seven_day', percentUsed: 84, resetsAt: new Date(local(20, 9)).toISOString() }
  /**
   * A sample state: context 14% of 1M filling in ≈30m; the 5-hour window 14%, resetting in 48m; the week 84%,
   * up a point in the last ten minutes, so set to run out in ≈2h 44m before it resets Tue 9am; ≈$57.62 since Wed 2pm;
   * redline counted 9 requests (≈$2.36, shell and prompt) since 1:47pm, all in one turn.
   */
  const sample = (): RedlineGauge => ({
    ...EMPTY_GAUGE,
    sessionStartedAt: local(14, 14),
    trackingSince: SAT - 13 * MIN,
    window: 1_000_000,
    contextTokens: 140_000,
    samples: [{ t: SAT - 4 * MIN, tokens: 25_333 }, { t: SAT, tokens: 140_000 }],
    ledgerUsd: 57.62,
    limits: [WEEK, FIVE],
    limitHistory: { seven_day: [{ t: SAT - 10 * MIN, tokens: 83.0244 }, { t: SAT, tokens: 84 }] },
    totals: { input: 9000, output: 900, cacheRead: 0, cacheWrite: 0 },
    tableUsd: { input: 2.364, output: 0, cacheRead: 0, cacheWrite: 0 },
    spend: { prompt: spend(0.946, 4), shell: spend(1.418, 5) },
    byModel: { 'claude-fable-5-1': spend(2.364, 9) },
    turns: [turn('t1', 'Has the nightly build been added to the release checklist yet...', 2.364, 9)],
    model: 'claude-fable-5-1',
  })

  test('the overview: a hero naming the limit closest to its wall, three aligned bars with one readout each, Started and Cost, one footnote', () => {
    const g = sample()
    const lines = detailLines(g, SAT)
    // The windows draw in a fixed order, the 5-hour before the week, whatever order they were reported in.
    expect(lines.map(l => l.key)).toEqual(['title', 'state', 'context', 'limit-five_hour', 'limit-seven_day', 'session', 'cost', 'note', 'spend-link'])
    expect(lines.find(l => l.key === 'state')).toMatchObject({ kind: 'hero', tone: 'amber', head: true, value: 'Week runs out in ≈2h 44m' })
    expect(lines.find(l => l.key === 'context')).toMatchObject({ kind: 'bar', tone: 'normal', head: true, label: 'Context', bar: '█░░░░░░░░░', figures: ['14%'], clauses: ['full in ≈30m'] })
    expect(lines.find(l => l.key === 'limit-five_hour')).toMatchObject({ kind: 'bar', tone: 'normal', head: true, label: '5-hour', bar: '█░░░░░░░░░', figures: ['14%'], clauses: ['resets in 48m'] })
    // The week is set to run dry before it resets: amber by the band's rule, never red for its 84%.
    expect(lines.find(l => l.key === 'limit-seven_day')).toMatchObject({ kind: 'bar', tone: 'amber', head: true, label: 'Week', bar: '████████░░', figures: ['84%'], clauses: ['out in ≈2h 44m', 'resets Tue 9am'] })
    expect(lines.find(l => l.key === 'session')).toMatchObject({ kind: 'row', tone: 'plain', gap: true, label: 'Started', value: 'Wed 2pm' })
    expect(lines.find(l => l.key === 'cost')).toMatchObject({ kind: 'row', tone: 'plain', label: 'Cost', value: '≈$57.62' })
    expect(lines.find(l => l.key === 'cost')?.gap).toBeUndefined()
    expect(lines.find(l => l.key === 'note')).toMatchObject({ kind: 'note', tone: 'dim', gap: true, value: 'Dollars are API list prices, not a bill. Times with ≈ assume your pace holds.' })
    expect(lines.find(l => l.key === 'spend-link')).toMatchObject({ kind: 'line', tone: 'dim', textOnly: true, value: 'Where the money went: /redline spend' })
    expect(lines.filter(l => l.head).map(l => l.key)).toEqual(['state', 'context', 'limit-five_hour', 'limit-seven_day'])
    expect(labelCells(lines)).toBe(7)
    expect(boltPose(g, SAT)).toBe('idle')
    expect(detailText(g, SAT)).toBe(
      [
        'Redline - context, plan limits and cost',
        'Week runs out in ≈2h 44m',
        'Context  █░░░░░░░░░   14%  full in ≈30m',
        '5-hour   █░░░░░░░░░   14%  resets in 48m',
        'Week     ████████░░   84%  out in ≈2h 44m, resets Tue 9am',
        '',
        `Started${'Wed 2pm'.padStart(33)}`,
        `Cost${'≈$57.62'.padStart(36)}`,
        '',
        'Dollars are API list prices, not a bill. Times with ≈ assume your pace holds.',
        'Where the money went: /redline spend',
      ].join('\n'),
    )
  })

  test('the spend view: what redline counted and since when, the share by kind, the costliest turns; by model only when several answered', () => {
    const g = sample()
    const lines = detailLines(g, SAT, 'spend')
    expect(lines.map(l => l.key)).toEqual(['title', 'spend-total', 'spend-shell', 'spend-prompt', 'busiest-title', 'busiest-1', 'spend-rule', 'limits-link'])
    expect(lines.find(l => l.key === 'spend-total')).toMatchObject({ kind: 'hero', tone: 'plain', head: true, value: '≈$2.36 in 9 requests · since 1:47pm' })
    expect(lines.find(l => l.key === 'spend-shell')).toMatchObject({ kind: 'bar', tone: 'plain', head: true, label: 'Shell', bar: '██████░░░░', figures: ['≈$1.42', '60%'], clauses: [] })
    expect(lines.find(l => l.key === 'spend-prompt')).toMatchObject({ label: 'Prompt', bar: '████░░░░░░', figures: ['≈$0.95', '40%'] })
    expect(lines.find(l => l.key === 'busiest-title')).toMatchObject({ kind: 'title', tone: 'title', gap: true, value: 'Costliest turns' })
    expect(lines.find(l => l.key === 'busiest-1')).toMatchObject({ kind: 'row', tone: 'plain', label: '1. Has the nightly build been added to the release checklist yet...', value: '≈$2.36' })
    expect(lines.find(l => l.key === 'spend-rule')).toMatchObject({ kind: 'note', tone: 'dim', gap: true, value: 'Each request counts toward what it sent Claude. Dollars are API list prices.' })
    expect(boltPose(g, SAT, 'spend')).toBe('idle')
    expect(detailText(g, SAT, 'spend')).toBe(
      [
        'Redline - where the money went',
        '≈$2.36 in 9 requests · since 1:47pm',
        'Shell    ██████░░░░   ≈$1.42   60%',
        'Prompt   ████░░░░░░   ≈$0.95   40%',
        '',
        'Costliest turns',
        '1. Has the nightly build been added to the release checklist yet...  ≈$2.36',
        '',
        'Each request counts toward what it sent Claude. Dollars are API list prices.',
        'Context and plan limits: /redline',
      ].join('\n'),
    )
    // Redline that saw the session from its start says no "since"; counting for six days or more, it says a span.
    expect(detailLines({ ...g, trackingSince: g.sessionStartedAt }, SAT, 'spend').find(l => l.key === 'spend-total')?.value).toBe('≈$2.36 in 9 requests')
    expect(detailLines({ ...g, sessionStartedAt: SAT - 10 * 24 * HOUR, trackingSince: SAT - 9 * 24 * HOUR }, SAT, 'spend').find(l => l.key === 'spend-total')?.value).toBe('≈$2.36 in 9 requests · over the last 9d')
  })

  test('five or more kinds fold into the three costliest and the rest, three or more models into the costliest and the rest, and the turns take the rows left under the cap', () => {
    const g: RedlineGauge = {
      ...sample(),
      spend: { reading: spend(7.54, 40), shell: spend(4.05, 30), editing: spend(3.13, 20), prompt: spend(1.5, 10), search: spend(1.18, 8), answering: spend(1, 5), 'mcp:github': spend(0.5, 2) },
      byModel: { 'claude-opus-5-5': spend(16.19, 100), 'claude-haiku-4-5': spend(2.21, 10), 'claude-sonnet-5-5': spend(0.5, 5) },
      tableUsd: { input: 18.9, output: 0, cacheRead: 0, cacheWrite: 0 },
      turns: [turn('a', 'Refactor the auth module and add tests', 6.02, 20), turn('b', 'A small one', 0.1), turn('c', 'No price', null, 1, 50_000), turn('d', 'Never sent', 1, 0)],
    }
    const lines = detailLines(g, SAT, 'spend')
    expect(lines.map(l => l.key)).toEqual(['title', 'spend-total', 'spend-reading', 'spend-shell', 'spend-editing', 'spend-rest', 'model-claude-opus-5-5', 'model-rest', 'busiest-title', 'busiest-1', 'spend-rule', 'limits-link'])
    expect(lines.find(l => l.key === 'spend-total')?.value).toBe('≈$18.90 in 115 requests · since 1:47pm')
    expect(lines.find(l => l.key === 'spend-reading')).toMatchObject({ label: 'Reading', bar: '████░░░░░░', figures: ['≈$7.54', '40%'] })
    expect(lines.find(l => l.key === 'spend-rest')).toMatchObject({ label: 'The rest', bar: '██░░░░░░░░', figures: ['≈$4.18', '22%'] })
    expect(lines.find(l => l.key === 'model-claude-opus-5-5')).toMatchObject({ label: 'Opus 5.5', gap: true, figures: ['≈$16.19', '86%'] })
    expect(lines.find(l => l.key === 'model-rest')).toMatchObject({ label: 'The rest', figures: ['≈$2.71', '14%'] })
    expect(lines.find(l => l.key === 'model-rest')?.gap).toBeUndefined()
    // Four kind rows and two model rows leave one turn: the costliest, by dollars.
    expect(lines.filter(l => l.kind === 'bar' || l.kind === 'row')).toHaveLength(7)
    expect(lines.find(l => l.key === 'busiest-1')).toMatchObject({ label: '1. Refactor the auth module and add tests', value: '≈$6.02' })
    expect(labelCells(lines)).toBe(8)
    // Two kinds and one model: three turns, a turn with no price last, in tokens; a turn that never sent is not a turn.
    const few: RedlineGauge = { ...g, spend: { reading: spend(1, 1), shell: spend(2, 1) }, byModel: { 'claude-opus-5-5': spend(3, 2) } }
    const rows = detailLines(few, SAT, 'spend').filter(l => l.kind === 'row')
    expect(rows.map(l => l.label)).toEqual(['1. Refactor the auth module and add tests', '2. A small one', '3. No price'])
    expect(rows[2]?.value).toBe('50k tokens')
    expect(detailLines(few, SAT, 'spend').some(l => l.key.startsWith('model-'))).toBe(false)
    expect(costliest(g, 10).map(t => t.id)).toEqual(['a', 'b', 'c'])
  })

  test('the hero ranks the walls: used up, context full, context red, the soonest amber wall, else within limits', () => {
    const g = sample()
    expect(verdict(g, SAT)).toEqual({ text: 'Week runs out in ≈2h 44m', level: 'amber' })
    // The same week resetting before it runs dry: nothing is near a wall, and the row is calm.
    const calm: RedlineGauge = { ...g, limits: [FIVE, { ...WEEK, resetsAt: new Date(SAT + 60 * MIN).toISOString() }], limitHistory: {} }
    expect(verdict(calm, SAT)).toEqual({ text: 'Within limits', level: 'normal' })
    expect(detailLines(calm, SAT).find(l => l.key === 'limit-seven_day')).toMatchObject({ tone: 'normal', figures: ['84%'], clauses: ['resets in 1h'] })
    // Used up: the window that resets last is the wall, and Bolt sleeps until it resets.
    const out: RedlineGauge = { ...g, limits: [{ ...FIVE, percentUsed: 100 }, { ...WEEK, percentUsed: 100 }] }
    expect(verdict(out, SAT)).toEqual({ text: 'Week ran out · resets Tue 9am', level: 'red' })
    expect(detailLines(out, SAT).find(l => l.key === 'limit-five_hour')).toMatchObject({ tone: 'red', bar: '██████████', figures: ['OUT'], clauses: ['resets in 48m'] })
    expect(boltPose(out, SAT)).toBe('sleep')
    expect(verdict({ ...g, limits: [{ kind: 'five_hour', percentUsed: 100 }] }, SAT)).toEqual({ text: '5-hour ran out', level: 'red' })
    // A used-up window with no reset time counts as resetting last: it is the wall over one with a known reset.
    expect(verdict({ ...g, limits: [{ ...WEEK, percentUsed: 100 }, { kind: 'spend_limit', percentUsed: 100 }] }, SAT)).toEqual({ text: 'Spend ran out', level: 'red' })
    // A used-up window outranks a full context, which outranks a red one, which outranks an amber window.
    const full: RedlineGauge = { ...g, contextTokens: 1_000_000, samples: [] }
    expect(verdict({ ...full, limits: [{ ...FIVE, percentUsed: 100 }] }, SAT)).toEqual({ text: '5-hour ran out · resets in 48m', level: 'red' })
    expect(verdict(full, SAT)).toEqual({ text: 'Context full · run /compact', level: 'red' })
    expect(boltPose(full, SAT)).toBe('idle')
    const red: RedlineGauge = { ...g, contextTokens: 850_000, samples: [{ t: SAT - 4 * MIN, tokens: 750_000 }, { t: SAT, tokens: 850_000 }] }
    expect(verdict(red, SAT)).toEqual({ text: 'Context 85% · full in ≈6m', level: 'red' })
    // Amber: the soonest wall wins, a window's run-out or the context's pace; a context with no estimate comes last.
    const amber: RedlineGauge = { ...g, contextTokens: 650_000, samples: [{ t: SAT - 4 * MIN, tokens: 550_000 }, { t: SAT, tokens: 650_000 }] }
    expect(verdict(amber, SAT)).toEqual({ text: 'Context 65% · full in ≈14m', level: 'amber' })
    expect(verdict({ ...amber, samples: [] }, SAT)).toEqual({ text: 'Week runs out in ≈2h 44m', level: 'amber' })
    expect(verdict({ ...amber, samples: [], limits: [] }, SAT)).toEqual({ text: 'Context 65%', level: 'amber' })
    // A window past its reset is no reading: with no context reading either, nothing is measured, and the row says when it reset.
    const stale: RedlineGauge = { ...EMPTY_GAUGE, limits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(SAT - 10 * MIN).toISOString() }] }
    expect(verdict(stale, SAT)).toEqual({ text: 'Nothing measured yet', level: 'unknown' })
    expect(boltPose(stale, SAT)).toBe('sleep')
    expect(detailLines(stale, SAT).find(l => l.key === 'limit-five_hour')).toMatchObject({ tone: 'dim', bar: '░░░░░░░░░░', figures: ['--'], clauses: ['reset 10m ago'] })
    expect(detailLines(stale, SAT).find(l => l.key === 'context')).toMatchObject({ tone: 'dim', bar: '░░░░░░░░░░', figures: ['--'], clauses: ['no reading yet'] })
    expect(verdict({ ...stale, window: 200_000, contextTokens: 40_000 }, SAT)).toEqual({ text: 'Within limits', level: 'normal' })
  })

  test('every line is a title, hero, line, bar, row or note; a line stands only in an empty state; a row is followed by a row or a new block; seven rows and one footnote at most; no word holds a glyph', () => {
    const rich: RedlineGauge = {
      ...sample(),
      unpriced: ['claude-nova-1'],
      spend: { prompt: spend(1, 2), shell: spend(2, 3), reading: { ...spend(0, 1), usd: null } },
      byModel: { 'claude-fable-5-1': spend(3, 5), 'claude-nova-1': { ...spend(0, 1), usd: null } },
      turns: [turn('a', 'one', 2, 3), turn('b', 'two', null, 2)],
    }
    for (const view of ['overview', 'spend'] as const) {
      for (const g of [rich, sample(), { ...rich, ledgerUsd: null }, EMPTY_GAUGE]) {
        const lines = detailLines(g, SAT, view)
        for (const l of lines) expect(['title', 'hero', 'line', 'bar', 'row', 'note'], `${view} ${l.key}`).toContain(l.kind)
        for (const l of lines.filter(l => l.kind === 'line' && !l.textOnly)) expect(['empty', 'limits-none', 'spend-none'], `${view} ${l.key}`).toContain(l.key)
        lines.forEach((l, i) => {
          const before = lines[i - 1]
          if (before?.kind === 'row') expect(l.kind === 'row' || l.gap === true || l.textOnly === true, `${view}: ${l.key} after ${before.key}`).toBe(true)
        })
        expect(lines.filter(l => l.kind === 'bar' || l.kind === 'row').length, view).toBeLessThanOrEqual(7)
        expect(lines.filter(l => l.kind === 'note').length, view).toBeLessThanOrEqual(1)
        for (const l of lines) {
          for (const s of [l.label, l.value, ...(l.figures ?? []), ...(l.clauses ?? [])]) if (s !== undefined) expect(s, `${view} ${l.key}`).not.toMatch(/[▀-▟]/u)
        }
      }
    }
    // With no ledger and a model the table cannot price, the cost reads in tokens, dim, and the footnote keeps only the pace sentence.
    const noLedger = detailLines({ ...rich, ledgerUsd: null }, SAT)
    expect(noLedger.find(l => l.key === 'cost')).toMatchObject({ tone: 'dim', value: '9.9k tokens' })
    expect(noLedger.find(l => l.key === 'note')?.value).toBe('Times with ≈ assume your pace holds.')
    expect(detailLines(rich, SAT).find(l => l.key === 'cost')).toMatchObject({ tone: 'plain', value: '≈$57.62' })
    // The spend view says the same with -- and tokens.
    const spendLines = detailLines(rich, SAT, 'spend')
    expect(spendLines.find(l => l.key === 'spend-total')?.value).toBe('9.9k tokens in 6 requests · since 1:47pm')
    expect(spendLines.find(l => l.key === 'spend-reading')).toMatchObject({ figures: ['--', '--'], bar: '░░░░░░░░░░' })
    expect(spendLines.find(l => l.key === 'model-claude-nova-1')).toMatchObject({ label: 'nova-1', figures: ['--', '--'] })
    expect(spendLines.find(l => l.key === 'busiest-2')).toMatchObject({ label: '2. two', value: '1.0k tokens' })
    // A block glyph pasted into a prompt reads as # in its row: words never hold a glyph, so the desktop keeps one font.
    const pasted = detailLines({ ...rich, turns: [turn('p', 'progress ███░░ 60% done', 3, 1)] }, SAT, 'spend')
    expect(pasted.find(l => l.key === 'busiest-1')?.label).toBe('1. progress ##### 60% done')
  })

  test('an API key after the first reply: within limits, the context bar, a line that limits appear on a plan, the session rows, one sentence; nothing spent: no rows', () => {
    const api: RedlineGauge = { ...EMPTY_GAUGE, sessionStartedAt: SAT - 13 * MIN, trackingSince: SAT - 13 * MIN, window: 1_000_000, contextTokens: 140_000, ledgerUsd: 2.36, byModel: { 'claude-fable-5-1': spend(2.36, 9) } }
    const lines = detailLines(api, SAT)
    expect(lines.map(l => l.key)).toEqual(['title', 'state', 'context', 'limits-none', 'session', 'cost', 'note', 'spend-link'])
    expect(lines.find(l => l.key === 'state')).toMatchObject({ value: 'Within limits', tone: 'normal' })
    expect(lines.find(l => l.key === 'session')).toMatchObject({ value: '1:47pm', gap: true })
    expect(lines.find(l => l.key === 'note')?.value).toBe('Dollars are API list prices, not a bill.')
    expect(boltPose(api, SAT)).toBe('idle')
    const fresh: RedlineGauge = { ...EMPTY_GAUGE, window: 1_000_000, contextTokens: 140_000 }
    expect(detailLines(fresh, SAT).map(l => l.key)).toEqual(['title', 'state', 'context', 'limits-none', 'spend-link'])
    expect(detailLines(fresh, SAT, 'spend').map(l => l.key)).toEqual(['title', 'spend-total', 'spend-none', 'limits-link'])
    expect(detailLines(fresh, SAT, 'spend').find(l => l.key === 'spend-total')).toMatchObject({ tone: 'dim', value: 'Nothing spent yet' })
    expect(boltPose(fresh, SAT, 'spend')).toBe('sleep')
    expect(boltPose(fresh, SAT)).toBe('idle')
  })

  test('a past moment reads as clock time today, as a weekday this week, as a span further back; a window by its row name', () => {
    expect(fmtSince(SAT - 13 * MIN, SAT)).toBe('1:47pm')
    expect(fmtSince(local(14, 14), SAT)).toBe('Wed 2pm')
    expect(fmtSince(local(11, 14), SAT)).toBe('6d ago')
    expect(fmtSince(SAT - 9 * 24 * HOUR, SAT)).toBe('9d ago')
    expect(limitRowLabel('five_hour')).toBe('5-hour')
    expect(limitRowLabel('seven_day')).toBe('Week')
    expect(limitRowLabel('spend_limit')).toBe('Spend')
    expect(limitRowLabel('monthly_limit')).toBe('Monthly')
  })

  test("a prompt's label ends at a word, never mid-word, and fits a row; the label column follows the longest label, 7 to 12 cells", () => {
    expect(labelOf('Has the nightly build been added to the release checklist yet and is it green on the main branch')).toBe('Has the nightly build been added to the release checklist...')
    expect(labelOf('x'.repeat(70))).toBe(`${'x'.repeat(57)}...`)
    expect(labelOf(`${'y'.repeat(30)} ${'z'.repeat(40)}`)).toBe(`${'y'.repeat(30)} ${'z'.repeat(26)}...`)
    expect(labelOf('a'.repeat(60))).toBe('a'.repeat(60))
    expect(labelOf('  first line  \nsecond')).toBe('first line')
    expect(labelCells(detailLines({ ...sample(), limits: [{ kind: 'a_very_long_window_kind', percentUsed: 5 }] }, SAT))).toBe(12)
    expect(detailLines({ ...sample(), limits: [{ kind: 'a_very_long_window_kind', percentUsed: 5 }] }, SAT).find(l => l.key === 'limit-a_very_long_window_kind')).toMatchObject({ label: 'A very long window kind', figures: ['5%'], clauses: [] })
    expect(labelCells(detailLines({ ...sample(), spend: { other: spend(1, 1) } }, SAT, 'spend'))).toBe(11)
  })
})
