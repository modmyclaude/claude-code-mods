import { describe, expect, test } from 'claude-code/testing'

import { accuracy, estimate, formatDuration, formatLeft, isRunningLong, median, receiptText, spread, timeLeft } from '../hooks/pace'

const S = 1000
const M = 60 * S

describe('median and spread', () => {
  const medians: [number[], number][] = [
    [[], 0],
    [[5], 5],
    [[3, 1, 2], 2],
    [[4, 1, 3, 2], 2.5],
  ]
  for (const [values, expected] of medians) test(`median ${JSON.stringify(values)}`, () => expect(median(values)).toBe(expected))

  const spreads: [number[], number][] = [
    [[60], 0],
    [[60, 60, 60], 0],
    [[0, 0], 0],
    // Two values a and b: sqrt(2) * |a - b| / (a + b).
    [[30, 90], Math.SQRT2 * 0.5],
  ]
  for (const [values, expected] of spreads) test(`spread ${JSON.stringify(values)}`, () => expect(Math.abs(spread(values) - expected)).toBeLessThan(1e-9))
})

describe('estimate', () => {
  test('nothing before two finished steps', () => {
    expect(estimate([])).toBeNull()
    expect(estimate([M])).toBeNull()
  })

  test('the median of this session', () => {
    expect(estimate([M, 2 * M, 4 * M])).toEqual({ perStepMs: 2 * M, isSteady: true })
  })

  const blends: [string, number[], { medianMs: number; count: number } | undefined, number][] = [
    ['no history: session alone', [M, M], undefined, M],
    ['history worth its count when small', [M, M], { medianMs: 4 * M, count: 2 }, (2 * M + 2 * 4 * M) / 4],
    ['history capped at three steps', [M, M], { medianMs: 4 * M, count: 40 }, (2 * M + 3 * 4 * M) / 5],
    ['a longer session outweighs history', [M, M, M, M, M, M, M, M, M], { medianMs: 4 * M, count: 40 }, (9 * M + 3 * 4 * M) / 12],
  ]
  for (const [name, session, prior, perStepMs] of blends) {
    test(name, () => expect(estimate(session, prior)?.perStepMs).toBe(perStepMs))
  }

  const steadiness: [number[], boolean][] = [
    [[M, M], true],
    [[20 * S, 100 * S], true], // spread 0.94
    [[10 * S, 100 * S], false], // spread 1.16: about ten times apart
    [[5 * S, 300 * S], false],
    [[M, M, M, M, 30 * M], false],
  ]
  for (const [session, isSteady] of steadiness) {
    test(`steady ${JSON.stringify(session.map(v => v / S))}s -> ${isSteady}`, () => expect(estimate(session)?.isSteady).toBe(isSteady))
  }
})

describe('timeLeft and the running-long rule', () => {
  const lefts: [number, number, number, number][] = [
    [M, 4, 0, 4 * M],
    [M, 4, 30 * S, 3.5 * M],
    [M, 4, 5 * M, 3 * M], // past its estimate, the current step counts as nothing left
    [M, 1, 0, M],
    [M, 0, 0, 0],
  ]
  for (const [per, remaining, elapsed, expected] of lefts) {
    test(`per ${per / S}s, ${remaining} left, ${elapsed / S}s in -> ${expected / S}s`, () => expect(timeLeft(per, remaining, elapsed)).toBe(expected))
  }

  const longs: [number, number, boolean][] = [
    [3 * M, M, false],
    [3 * M + 1, M, true],
    [10 * M, M, true],
    [M, 0, false],
  ]
  for (const [elapsed, per, isLong] of longs) {
    test(`${elapsed}ms against ${per}ms -> ${isLong}`, () => expect(isRunningLong(elapsed, per)).toBe(isLong))
  }
})

describe('duration words', () => {
  const durations: [number, string][] = [
    [0, '0s'],
    [45 * S, '45s'],
    [59.6 * S, '1m'],
    [4 * M + 12 * S, '4m 12s'],
    [4 * M, '4m'],
    [65 * M, '1h 5m'],
    [120 * M, '2h'],
  ]
  for (const [ms, text] of durations) test(`duration ${ms} -> ${text}`, () => expect(formatDuration(ms)).toBe(text))

  const lefts: [number, string][] = [
    [30 * S, '<1m'],
    [M, '1m'],
    [2.5 * M, '3m'],
    [80 * M, '1h 20m'],
    [120 * M, '2h'],
  ]
  for (const [ms, text] of lefts) test(`left ${ms} -> ${text}`, () => expect(formatLeft(ms)).toBe(text))
})

describe('the receipt', () => {
  const accuracies: [number, number | undefined, string][] = [
    [4 * M + 12 * S, 4 * M + 30 * S, '18s ahead of estimate'],
    [6 * M, 4 * M, '2m behind estimate'],
    [4 * M + 3 * S, 4 * M, 'right on estimate'],
    [4 * M, undefined, ''],
  ]
  for (const [total, guess, text] of accuracies) test(`accuracy ${total} vs ${guess}`, () => expect(accuracy(total, guess)).toBe(text))

  test('a flat plan names its steps', () => {
    expect(receiptText(4 * M + 12 * S, 4 * M + 30 * S, [], 6)).toBe('Plan done in 4m 12s, 18s ahead of estimate. 6 steps.')
  })

  test('a staged plan names each stage’s time', () => {
    expect(receiptText(5 * M, undefined, [{ name: 'Build', ms: 3 * M }, { name: 'Verify', ms: 2 * M }], 4)).toBe('Plan done in 5m. Build 3m · Verify 2m')
  })
})
