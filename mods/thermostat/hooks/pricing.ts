// Cost math for the prompt cache. Pure: no `$`, no clock, so the tests can
// table-drive it.

/** API list prices in US dollars per million tokens. */
export type Prices = {
  /** The family the model id matched, for messages ("Opus 5.5"). */
  family: string
  /** Uncached input. */
  input: number
  output: number
  /** Input served from the prompt cache. */
  read: number
  /**
   * The cache-write rate as Claude Code itself priced it (its managed pricing
   * when an organisation set one), when it has said; else derived from input.
   */
  write?: number
}

type Row = Prices & {
  match: RegExp
  /** Haiku 5.5 bills a prompt over 100k tokens at a higher tier. */
  over100k?: Omit<Prices, 'family'>
}

// Anthropic API list prices, October 2026. First match wins, so the newer
// and more specific ids come first. A cache write costs a multiple of
// `input` (writeRate below), so it is not listed per row.
const TABLE: readonly Row[] = [
  { family: 'Fable 5.1', match: /(fable|mythos)-5-1/, input: 10, output: 50, read: 0.25 },
  { family: 'Fable 5', match: /fable|mythos/, input: 10, output: 50, read: 1 },
  { family: 'Opus 5.5', match: /opus-5-5/, input: 4, output: 20, read: 0.2 },
  { family: 'Opus 4.5 to 5', match: /opus-(5|4-[5-9])/, input: 5, output: 25, read: 0.5 },
  { family: 'Opus 4.1', match: /opus/, input: 15, output: 75, read: 1.5 },
  { family: 'Sonnet 5 and 5.5', match: /sonnet-5/, input: 2, output: 10, read: 0.2 },
  { family: 'Sonnet 4', match: /sonnet/, input: 3, output: 15, read: 0.3 },
  // Haiku 5.5's cache-read rate is not published beside its prices: 0.1x input is assumed.
  {
    family: 'Haiku 5.5',
    match: /haiku-5/,
    input: 0.1,
    output: 0.5,
    read: 0.01,
    over100k: { input: 0.5, output: 2.5, read: 0.05 },
  },
  { family: 'Haiku 4.5', match: /haiku/, input: 1, output: 5, read: 0.1 },
]

/** An id the table does not know is priced as a mid-range model and says so. */
const UNKNOWN: Prices = { family: 'Sonnet 4 (model not recognised)', input: 3, output: 15, read: 0.3 }

/**
 * The prices for a model id as the API or Claude Code spells it
 * (`claude-opus-5-5`, `us.anthropic.claude-opus-4-5-20251101-v1:0`,
 * `claude-opus-4-5@20251101`), for a prompt of `promptTokens`.
 */
export function pricesFor(model: string, promptTokens = 0): Prices {
  const id = model.toLowerCase()
  const row = TABLE.find(one => one.match.test(id))
  if (row === undefined) return UNKNOWN
  const tier = row.over100k !== undefined && promptTokens > 100_000 ? row.over100k : row
  return { family: row.family, input: tier.input, output: tier.output, read: tier.read }
}

/**
 * What writing to the cache costs per million tokens: 1.25x input for the
 * 5-minute TTL, 2x for the 1-hour one. Any window longer than 5 minutes
 * can only be the 1-hour TTL, so it is priced that way.
 */
export function writeRate(prices: Prices, ttlMinutes: number): number {
  return prices.write ?? prices.input * (ttlMinutes > 5 ? 2 : 1.25)
}

/** How a message names the prices it used. */
export function pricesLabel(prices: Prices): string {
  return prices.write === undefined ? `${prices.family} API list prices` : `${prices.family} prices, cache rate from Claude Code`
}

/**
 * The cache-write rate behind an estimate Claude Code made itself
 * (`estimated_cache_write_usd` for `contextTokens`), per million tokens. Too
 * small a context makes a rounded estimate meaningless, so it is ignored.
 */
export function engineWriteRate(estimatedUsd: number, contextTokens: number): number | null {
  if (!(contextTokens >= 10_000) || !(estimatedUsd > 0)) return null
  return (estimatedUsd / contextTokens) * 1e6
}

/** One send's input side, cold (the context written again) and warm (read). */
export type SendEstimate = {
  tokens: number
  coldUsd: number
  warmUsd: number
  /** What going cold adds: cold minus warm. */
  extraUsd: number
}

/**
 * Prices re-reading `tokens` of context on the next send. The reply costs
 * the same either way, so only the input side is compared.
 */
export function estimateSend(tokens: number, prices: Prices, ttlMinutes: number): SendEstimate {
  const coldUsd = (tokens * writeRate(prices, ttlMinutes)) / 1e6
  const warmUsd = (tokens * prices.read) / 1e6
  return { tokens, coldUsd, warmUsd, extraUsd: coldUsd - warmUsd }
}

/** The four token counts every usage report carries (ModelUsage). */
export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** What a request with this usage cost at list prices. */
export function usageUsd(usage: Usage, prices: Prices, ttlMinutes: number): number {
  return (
    (usage.input_tokens * prices.input +
      usage.output_tokens * prices.output +
      usage.cache_read_input_tokens * prices.read +
      usage.cache_creation_input_tokens * writeRate(prices, ttlMinutes)) /
    1e6
  )
}

// A keep-warm ping re-sends the whole conversation (read from the cache)
// plus one short line, and gets a word back. Thinking can add output, so
// the output allowance is generous; once a ping has run, its measured cost
// replaces this guess.
export const PING_INPUT_TOKENS = 40
export const PING_OUTPUT_TOKENS = 200

/** A keep-warm ping's cost before one has been measured. */
export function estimatePingUsd(tokens: number, prices: Prices): number {
  return (tokens * prices.read + PING_INPUT_TOKENS * prices.input + PING_OUTPUT_TOKENS * prices.output) / 1e6
}
