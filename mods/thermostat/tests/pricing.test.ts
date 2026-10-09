// The price table and cost math, table-driven.

import { describe, expect, test } from 'claude-code/testing'

import { engineWriteRate, estimatePingUsd, estimateSend, pricesFor, pricesLabel, usageUsd, writeRate } from '../hooks/pricing'

/** Dollar sums carry float noise; a billionth of a cent is the same price. */
function expectNear(got: number, want: number): void {
  expect(Math.abs(got - want), `${got} should be ${want}`).toBeLessThan(1e-9)
}

describe('pricesFor matches model ids as Claude Code and the clouds spell them', () => {
  const cases: [id: string, family: string, input: number, output: number, read: number][] = [
    ['claude-fable-5-1', 'Fable 5.1', 10, 50, 0.25],
    ['claude-mythos-5-1', 'Fable 5.1', 10, 50, 0.25],
    ['claude-fable-5', 'Fable 5', 10, 50, 1],
    ['claude-opus-5-5', 'Opus 5.5', 4, 20, 0.2],
    ['claude-opus-5-5[1m]', 'Opus 5.5', 4, 20, 0.2],
    ['claude-opus-5', 'Opus 4.5 to 5', 5, 25, 0.5],
    ['claude-opus-4-8', 'Opus 4.5 to 5', 5, 25, 0.5],
    ['us.anthropic.claude-opus-4-5-20251101-v1:0', 'Opus 4.5 to 5', 5, 25, 0.5],
    ['claude-opus-4-5@20251101', 'Opus 4.5 to 5', 5, 25, 0.5],
    ['claude-opus-4-1-20250805', 'Opus 4.1', 15, 75, 1.5],
    ['claude-opus-4-20250514', 'Opus 4.1', 15, 75, 1.5],
    ['claude-sonnet-5-5', 'Sonnet 5', 2, 10, 0.2],
    ['claude-sonnet-5', 'Sonnet 5', 2, 10, 0.2],
    ['claude-sonnet-4-6', 'Sonnet 4', 3, 15, 0.3],
    ['claude-sonnet-4-5-20250929', 'Sonnet 4', 3, 15, 0.3],
    ['claude-haiku-5-5', 'Haiku 5.5', 0.1, 0.5, 0.01],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5', 1, 5, 0.1],
    ['CLAUDE-OPUS-5-5', 'Opus 5.5', 4, 20, 0.2],
    ['some-new-model', 'Sonnet 4 (model not recognised)', 3, 15, 0.3],
    ['', 'Sonnet 4 (model not recognised)', 3, 15, 0.3],
  ]
  for (const [id, family, input, output, read] of cases) {
    test(`${id || '(empty)'} -> ${family}`, () => {
      expect(pricesFor(id)).toEqual({ family, input, output, read })
    })
  }

  test('Haiku 5.5 bills a prompt over 100k tokens at its higher tier', () => {
    expect(pricesFor('claude-haiku-5-5', 100_000).input).toBe(0.1)
    expect(pricesFor('claude-haiku-5-5', 100_001)).toEqual({ family: 'Haiku 5.5', input: 0.5, output: 2.5, read: 0.05 })
    expect(pricesFor('claude-opus-5-5', 500_000).input).toBe(4)
  })
})

describe('writeRate: 1.25x input for the 5-minute TTL, 2x for anything longer', () => {
  const opus = pricesFor('claude-opus-5-5')
  const cases: [minutes: number, rate: number][] = [
    [5, 5],
    [4, 5],
    [6, 8],
    [60, 8],
    [90, 8],
  ]
  for (const [minutes, rate] of cases) {
    test(`${minutes} minutes -> $${rate}/MTok`, () => {
      expect(writeRate(opus, minutes)).toBe(rate)
    })
  }
})

describe('estimateSend prices one send cold and warm', () => {
  const cases: [model: string, tokens: number, minutes: number, cold: number, warm: number][] = [
    ['claude-opus-5-5', 150_000, 60, 1.2, 0.03],
    ['claude-opus-5-5', 150_000, 5, 0.75, 0.03],
    ['claude-sonnet-4-6', 200_000, 60, 1.2, 0.06],
    ['claude-fable-5-1', 400_000, 60, 8, 0.1],
    ['claude-haiku-4-5', 50_000, 5, 0.0625, 0.005],
    ['claude-opus-5-5', 0, 60, 0, 0],
  ]
  for (const [model, tokens, minutes, cold, warm] of cases) {
    test(`${model}, ${tokens} tokens, ${minutes}m window`, () => {
      const est = estimateSend(tokens, pricesFor(model, tokens), minutes)
      expectNear(est.coldUsd, cold)
      expectNear(est.warmUsd, warm)
      expectNear(est.extraUsd, cold - warm)
      expect(est.tokens).toBe(tokens)
    })
  }
})

describe('usageUsd sums each token kind at its own rate', () => {
  const opus = pricesFor('claude-opus-5-5')
  const cases: [label: string, usage: [input: number, output: number, read: number, write: number], minutes: number, usd: number][] = [
    ['nothing', [0, 0, 0, 0], 60, 0],
    ['1M uncached input', [1_000_000, 0, 0, 0], 60, 4],
    ['1M output', [0, 1_000_000, 0, 0], 60, 20],
    ['1M cache reads', [0, 0, 1_000_000, 0], 60, 0.2],
    ['1M cache writes, 1-hour', [0, 0, 0, 1_000_000], 60, 8],
    ['1M cache writes, 5-minute', [0, 0, 0, 1_000_000], 5, 5],
    ['a typical ping', [40, 60, 149_000, 0], 60, 0.03116],
  ]
  for (const [label, [input, output, read, write], minutes, usd] of cases) {
    test(label, () => {
      const got = usageUsd(
        { input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write },
        opus,
        minutes,
      )
      expectNear(got, usd)
    })
  }
})

test('a ping is estimated as one cache read of the conversation plus a short line and a short reply', () => {
  const opus = pricesFor('claude-opus-5-5')
  // 150k x $0.20 + 40 x $4 + 200 x $20, per million.
  expectNear(estimatePingUsd(150_000, opus), 0.03416)
  expect(estimatePingUsd(0, opus)).toBeGreaterThan(0)
})

describe("Claude Code's own cache-write rate replaces the derived one", () => {
  const cases: [usd: number, tokens: number, rate: number | null][] = [
    [1.2, 150_000, 8],
    [0.9, 150_000, 6],
    [0.05, 9_000, null], // too small a context to trust a rounded estimate
    [0, 150_000, null],
    [Number.NaN, 150_000, null],
  ]
  for (const [usd, tokens, rate] of cases) {
    test(`$${usd} for ${tokens} tokens -> ${rate}`, () => {
      const got = engineWriteRate(usd, tokens)
      if (rate === null) expect(got).toBeNull()
      else expectNear(got ?? Number.NaN, rate)
    })
  }

  test('a known write rate wins over the TTL multiplier, and the label says where it came from', () => {
    const opus = { ...pricesFor('claude-opus-5-5'), write: 6 }
    expect(writeRate(opus, 60)).toBe(6)
    expect(writeRate(opus, 5)).toBe(6)
    expect(pricesLabel(opus)).toBe('Opus 5.5 prices, cache rate from Claude Code')
    expect(pricesLabel(pricesFor('claude-opus-5-5'))).toBe('Opus 5.5 API list prices')
    expectNear(estimateSend(150_000, opus, 60).coldUsd, 0.9)
  })
})
