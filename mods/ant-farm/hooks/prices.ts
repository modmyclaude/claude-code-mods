// The price table and the cost math. Pure: no `$`, so the tests drive it directly.

import type { ModelUsage } from 'claude-code'

import type { AntFarmUsage } from '../types'

type Rate = { input: number; output: number; cacheWrite: number; cacheRead: number }
type PriceRow = Rate & {
  id: string
  /** A higher rate for requests whose prompt is longer than `promptTokens`. */
  above?: Rate & { promptTokens: number }
}

/**
 * ESTIMATES ONLY. US dollars per million tokens: Anthropic's published
 * first-party API list prices, as cached on 2026-10-06. Cache writes are priced
 * at the 5-minute rate (1.25x input); the usage a request reports does not say
 * which cache lifetime was used. Partner clouds (Bedrock, Vertex), fast mode,
 * batch and negotiated rates differ. A model not listed here costs "?".
 */
export const PRICES_USD_PER_MTOK: readonly PriceRow[] = [
  { id: 'claude-fable-5-1', input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  { id: 'claude-mythos-5-1', input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  { id: 'claude-fable-5', input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 },
  { id: 'claude-mythos-5', input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 },
  { id: 'claude-opus-5-5', input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  { id: 'claude-opus-5', input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  { id: 'claude-opus-4-8', input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  { id: 'claude-opus-4-7', input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  { id: 'claude-opus-4-6', input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  { id: 'claude-sonnet-5-5', input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  { id: 'claude-sonnet-5', input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  { id: 'claude-sonnet-4-6', input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  {
    id: 'claude-haiku-5-5', input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01,
    above: { promptTokens: 100_000, input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 },
  },
  { id: 'claude-haiku-4-5', input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
]

// Longest id first, and an id never matches a longer version of itself:
// `claude-opus-5` must not price `claude-opus-5-5` or a future `claude-opus-5-6`,
// while dated (`-20251101`), regional (`us.anthropic.`), `-v1:0` and `[1m]`
// spellings of a listed id still match.
const MATCHERS = [...PRICES_USD_PER_MTOK]
  .sort((a, b) => b.id.length - a.id.length)
  .map(row => ({ row, re: new RegExp(`(?:^|[^a-z0-9])${row.id}(?!\\d)(?!-\\d{1,2}(?!\\d))`) }))

/** The price row for a model id as the engine or the API spells it, or undefined. */
export function priceFor(model: string): PriceRow | undefined {
  const id = model.toLowerCase()
  return MATCHERS.find(m => m.re.test(id))?.row
}

export function tokensOf(u: ModelUsage): number {
  return u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
}

/** Estimated dollars for one request's usage, or undefined for a model not in the table. */
export function costOf(model: string, u: ModelUsage): number | undefined {
  const row = priceFor(model)
  if (row === undefined) return undefined
  const prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const rate: Rate = row.above !== undefined && prompt > row.above.promptTokens ? row.above : row
  return (
    u.input_tokens * rate.input +
    u.output_tokens * rate.output +
    u.cache_creation_input_tokens * rate.cacheWrite +
    u.cache_read_input_tokens * rate.cacheRead
  ) / 1_000_000
}

export const NO_USAGE: AntFarmUsage = { requests: 0, tokens: 0, costUsd: 0, unpricedTokens: 0 }

/** One more request on the tally; `usage` null when the response carried none. */
export function addRequest(acc: AntFarmUsage, model: string, usage: ModelUsage | null): AntFarmUsage {
  if (usage === null) return { ...acc, requests: acc.requests + 1 }
  const tokens = tokensOf(usage)
  const cost = costOf(model, usage)
  return {
    requests: acc.requests + 1,
    tokens: acc.tokens + tokens,
    costUsd: acc.costUsd + (cost ?? 0),
    unpricedTokens: acc.unpricedTokens + (cost === undefined ? tokens : 0),
  }
}

export function sumUsage(list: readonly AntFarmUsage[]): AntFarmUsage {
  return list.reduce(
    (a, u) => ({
      requests: a.requests + u.requests,
      tokens: a.tokens + u.tokens,
      costUsd: a.costUsd + u.costUsd,
      unpricedTokens: a.unpricedTokens + u.unpricedTokens,
    }),
    NO_USAGE,
  )
}

/** The budget level: 0 under, 1 at or past the budget, 2 at or past twice it. 0 when off. */
export function budgetLevel(spendUsd: number, budgetUsd: number): 0 | 1 | 2 {
  if (!(budgetUsd > 0)) return 0
  if (spendUsd >= budgetUsd * 2) return 2
  return spendUsd >= budgetUsd ? 1 : 0
}
