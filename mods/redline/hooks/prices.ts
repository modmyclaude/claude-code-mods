// The built-in price table: USD per million tokens, per model family, as the
// published list prices stood on 2026-10-08.
//
// Claude Code's own cost ledger (what /cost shows) is preferred for the session
// total wherever it exists; this table prices the breakdowns (per category, per
// turn) and stands in for the total where no ledger is kept. Everything priced
// here is shown with "≈": it leaves out long-context premiums, fast mode,
// 1-hour cache writes, batch and regional pricing. A model with no row gets no
// price at all (tokens only), never a guess.

import type { RedlineTokens } from '../types'

export type Price = RedlineTokens

type Row = {
  label: string
  families: readonly string[]
  /** "major.minor", as the model id spells it (claude-opus-4-1 is 4.1). */
  versions: readonly string[]
  price: Price
  /** A second rate card for requests whose prompt is over 100k tokens. */
  above100k?: Price
}

// Cache writes are the 5-minute rate (1.25x input); cache reads 0.1x input
// unless the model's list price says otherwise.
const rates = (input: number, output: number, readX = 0.1): Price => ({
  input,
  output,
  cacheWrite: input * 1.25,
  cacheRead: input * readX,
})

export const PRICE_TABLE: readonly Row[] = [
  { label: 'Fable 5.1', families: ['fable', 'mythos'], versions: ['5.1'], price: rates(10, 50, 0.025) },
  { label: 'Fable 5', families: ['fable', 'mythos'], versions: ['5.0'], price: rates(10, 50) },
  { label: 'Opus 5.5', families: ['opus'], versions: ['5.5'], price: rates(4, 20, 0.05) },
  { label: 'Opus 4.5 - 5', families: ['opus'], versions: ['4.5', '4.6', '4.7', '4.8', '5.0'], price: rates(5, 25) },
  { label: 'Opus 4 - 4.1', families: ['opus'], versions: ['4.0', '4.1'], price: rates(15, 75) },
  { label: 'Sonnet 5 - 5.5', families: ['sonnet'], versions: ['5.0', '5.5'], price: rates(2, 10) },
  { label: 'Sonnet 4 - 4.6', families: ['sonnet'], versions: ['4.0', '4.5', '4.6'], price: rates(3, 15) },
  { label: 'Haiku 5.5', families: ['haiku'], versions: ['5.5'], price: rates(0.1, 0.5), above100k: rates(0.5, 2.5) },
  { label: 'Haiku 4.5', families: ['haiku'], versions: ['4.5'], price: rates(1, 5) },
]

// claude-opus-4-1-20250805, us.anthropic.claude-sonnet-4-5-20250929-v1:0,
// claude-haiku-4-5@20251001, claude-opus-5: the family, then the major, then a
// one-digit minor when one follows (a date is never a minor).
const MODEL_ID = /(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d)(?!\d))?/

/** The price row for a model id, or undefined when the table has none. */
export function priceRow(model: string): Row | undefined {
  const m = MODEL_ID.exec(model.toLowerCase())
  if (!m) return undefined
  const family = m[1] ?? ''
  const version = `${m[2]}.${m[3] ?? '0'}`
  return PRICE_TABLE.find(row => row.families.includes(family) && row.versions.includes(version))
}

/** What one request cost per category, USD; undefined for an unpriced model. */
export function priceRequest(model: string, t: RedlineTokens): RedlineTokens | undefined {
  const row = priceRow(model)
  if (!row) return undefined
  const prompt = t.input + t.cacheRead + t.cacheWrite
  const p = row.above100k && prompt > 100_000 ? row.above100k : row.price
  return {
    input: (t.input * p.input) / 1e6,
    output: (t.output * p.output) / 1e6,
    cacheRead: (t.cacheRead * p.cacheRead) / 1e6,
    cacheWrite: (t.cacheWrite * p.cacheWrite) / 1e6,
  }
}

export const sumTokens = (t: RedlineTokens): number => t.input + t.output + t.cacheRead + t.cacheWrite
