// The price table and the cost math, table-driven.

import { describe, expect, test } from 'claude-code/testing'

import { addRequest, budgetLevel, costOf, NO_USAGE, priceFor, sumUsage } from '../hooks/prices'
import { usage } from './world'

describe('priceFor', () => {
  const cases: [string, string | undefined][] = [
    ['claude-opus-5-5', 'claude-opus-5-5'],
    ['claude-opus-5', 'claude-opus-5'],
    ['claude-fable-5-1', 'claude-fable-5-1'],
    ['claude-fable-5', 'claude-fable-5'],
    ['claude-haiku-5-5', 'claude-haiku-5-5'],
    ['CLAUDE-SONNET-5-5', 'claude-sonnet-5-5'],
    // Dated, regional, versioned and context-suffixed spellings of a listed id.
    ['claude-haiku-4-5-20251001', 'claude-haiku-4-5'],
    ['us.anthropic.claude-sonnet-4-6-v1:0', 'claude-sonnet-4-6'],
    ['claude-sonnet-5-5[1m]', 'claude-sonnet-5-5'],
    ['claude-opus-4-6@20260101', 'claude-opus-4-6'],
    // Never a shorter id's price for a model the table does not list.
    ['claude-opus-5-6', undefined],
    ['claude-opus-55', undefined],
    ['claude-opus-4-5', undefined],
    ['claude-opus-4-5-20251101', undefined],
    ['claude-sonnet-4-5', undefined],
    ['some-other-model', undefined],
    ['', undefined],
  ]
  for (const [model, expected] of cases) {
    test(`${model || '(empty)'} -> ${expected ?? 'unknown'}`, () => {
      expect(priceFor(model)?.id).toBe(expected)
    })
  }
})

describe('costOf', () => {
  const M = 1_000_000
  const cases: [string, Parameters<typeof usage>, number | undefined][] = [
    ['opus 5.5 input', ['claude-opus-5-5', M, 0], 4],
    ['opus 5.5 output', ['claude-opus-5-5', 0, M], 20],
    ['opus 5.5 cache read', ['claude-opus-5-5', 0, 0, M, 0], 0.2],
    ['opus 5.5 cache write', ['claude-opus-5-5', 0, 0, 0, M], 5],
    ['sonnet 5.5 mixed', ['claude-sonnet-5-5', 10_000, 2_000, 50_000, 1_000], (10_000 * 2 + 2_000 * 10 + 50_000 * 0.2 + 1_000 * 2.5) / M],
    ['fable 5.1 output', ['claude-fable-5-1', 0, 1000], 0.05],
    ['haiku 5.5 short prompt', ['claude-haiku-5-5', 100_000, 1000], (100_000 * 0.1 + 1000 * 0.5) / M],
    ['haiku 5.5 long prompt pays the higher rate', ['claude-haiku-5-5', 100_001, 1000], (100_001 * 0.5 + 1000 * 2.5) / M],
    ['haiku 5.5 cached prompt counts toward the tier', ['claude-haiku-5-5', 1, 0, 100_000, 0], (1 * 0.5 + 100_000 * 0.05) / M],
    ['unknown model', ['mystery-1', 1000, 1000], undefined],
  ]
  for (const [name, args, expected] of cases) {
    test(name, () => {
      const got = costOf(args[0], usage(...args))
      if (expected === undefined) expect(got).toBeUndefined()
      else expect(Math.abs((got ?? NaN) - expected) < 1e-12).toBe(true)
    })
  }
})

describe('addRequest', () => {
  test('a priced request adds tokens and cost', () => {
    const u = addRequest(NO_USAGE, 'claude-opus-5-5', usage('claude-opus-5-5', 1000, 500, 2000, 100))
    expect(u.requests).toBe(1)
    expect(u.tokens).toBe(3600)
    expect(u.unpricedTokens).toBe(0)
    expect(Math.abs(u.costUsd - (1000 * 4 + 500 * 20 + 2000 * 0.2 + 100 * 5) / 1e6) < 1e-12).toBe(true)
  })
  test('an unknown model adds tokens and no cost', () => {
    const u = addRequest(NO_USAGE, 'mystery-1', usage('mystery-1', 1000, 500))
    expect(u).toEqual({ requests: 1, tokens: 1500, costUsd: 0, unpricedTokens: 1500 })
  })
  test('a response with no usage counts as a request alone', () => {
    expect(addRequest(NO_USAGE, 'claude-opus-5-5', null)).toEqual({ ...NO_USAGE, requests: 1 })
  })
  test('sumUsage adds every field', () => {
    const a = { requests: 1, tokens: 10, costUsd: 0.5, unpricedTokens: 3 }
    expect(sumUsage([a, a, NO_USAGE])).toEqual({ requests: 2, tokens: 20, costUsd: 1, unpricedTokens: 6 })
  })
})

describe('budgetLevel', () => {
  const cases: [number, number, 0 | 1 | 2][] = [
    [0, 2, 0],
    [1.99, 2, 0],
    [2, 2, 1],
    [3.99, 2, 1],
    [4, 2, 2],
    [100, 2, 2],
    [100, 0, 0],
    [100, -1, 0],
    [100, Number.NaN, 0],
  ]
  for (const [spend, budget, level] of cases) {
    test(`$${spend} of $${budget} -> ${level}`, () => expect(budgetLevel(spend, budget)).toBe(level))
  }
})
