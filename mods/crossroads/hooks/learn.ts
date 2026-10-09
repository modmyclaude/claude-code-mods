// Pure bookkeeping for Crossroads: what the person takes, edits or ignores
// (counts per kind, never their prompts), the back-off, and today's spend.
// Every value here round-trips through $.store as plain JSON.

import type { ModelUsage } from 'claude-code'

import type { CrossroadsKind } from '../types'
import { KINDS } from './logic'

// ---------------------------------------------------------------- per-project counts

export type Counts = Partial<Record<CrossroadsKind, number>>

/** One project's record. Counts only: no prompt or suggestion text is ever stored. */
export type ProjectRecord = {
  taken: Counts
  edited: Counts
  ignored: Counts
  /** Lists ignored in a row; 3 or more is backing off. */
  streak: number
  /** Eligible turns skipped since the last list, while backing off. */
  skipped: number
}

export function emptyRecord(): ProjectRecord {
  return { taken: {}, edited: {}, ignored: {}, streak: 0, skipped: 0 }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function coerceCounts(value: unknown): Counts {
  const counts: Counts = {}
  if (typeof value !== 'object' || value === null) return counts
  for (const kind of KINDS) {
    const n = count((value as Record<string, unknown>)[kind])
    if (n > 0) counts[kind] = n
  }

  return counts
}

/** Reads a stored record back, whatever shape an older version or a hand edit left. */
export function coerceRecord(value: unknown): ProjectRecord {
  if (typeof value !== 'object' || value === null) return emptyRecord()
  const stored = value as Record<string, unknown>

  return {
    taken: coerceCounts(stored.taken),
    edited: coerceCounts(stored.edited),
    ignored: coerceCounts(stored.ignored),
    streak: count(stored.streak),
    skipped: count(stored.skipped),
  }
}

function bump(counts: Counts, kind: CrossroadsKind): Counts {
  return { ...counts, [kind]: (counts[kind] ?? 0) + 1 }
}

export type Outcome =
  | { type: 'taken' | 'edited'; kind: CrossroadsKind }
  | { type: 'ignored'; kinds: readonly CrossroadsKind[] }

/** Applies what the person did with a list: a take or an edit recovers, an ignore extends the streak. */
export function recordOutcome(record: ProjectRecord, outcome: Outcome): ProjectRecord {
  if (outcome.type === 'ignored') {
    let ignored = record.ignored
    for (const kind of outcome.kinds) ignored = bump(ignored, kind)

    return { ...record, ignored, streak: record.streak + 1 }
  }
  const key = outcome.type === 'taken' ? 'taken' : 'edited'

  return { ...record, [key]: bump(record[key], outcome.kind), streak: 0, skipped: 0 }
}

/** The person's top kinds, by takes and edits, fewer ignores breaking ties. */
export function topKinds(record: ProjectRecord, limit = 3): CrossroadsKind[] {
  const score = (kind: CrossroadsKind) => (record.taken[kind] ?? 0) + (record.edited[kind] ?? 0)

  return KINDS.filter(kind => score(kind) > 0)
    .sort((a, b) => score(b) - score(a) || (record.ignored[a] ?? 0) - (record.ignored[b] ?? 0))
    .slice(0, limit)
}

/** Eligible turns between lists while backing off: every turn, then every 2nd, 4th, 8th. */
export function backoffGap(streak: number): number {
  return streak < 3 ? 1 : 2 ** (Math.min(streak, 5) - 2)
}

/** Whether this eligible turn gets a list, and the record after deciding. */
export function decideTurn(record: ProjectRecord): { isAllowed: boolean; record: ProjectRecord } {
  const isAllowed = record.skipped + 1 >= backoffGap(record.streak)

  return { isAllowed, record: { ...record, skipped: isAllowed ? 0 : record.skipped + 1 } }
}

/** A short, stable store key for a project root (the path itself is not stored). */
export function projectKey(root: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < root.length; index++) {
    hash ^= root.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return `project:${hash.toString(16).padStart(8, '0')}`
}

// ---------------------------------------------------------------- today's spend

/** Small-model list prices per million tokens (Claude Haiku 5.5, prompts under 100K). */
export const PRICE_PER_MTOK = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 } as const

export type DayUsage = { day: string; calls: number; input: number; output: number; usd: number }

export function estimateUsd(usage: ModelUsage): number {
  return (
    (usage.input_tokens * PRICE_PER_MTOK.input +
      usage.output_tokens * PRICE_PER_MTOK.output +
      usage.cache_read_input_tokens * PRICE_PER_MTOK.cacheRead +
      usage.cache_creation_input_tokens * PRICE_PER_MTOK.cacheWrite) /
    1_000_000
  )
}

/** The local calendar day of a time, `YYYY-MM-DD`. */
export function dayOf(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Adds one call to today's tally; a stored tally from another day starts over. */
export function addUsage(stored: unknown, day: string, usage: ModelUsage): DayUsage {
  const was = coerceUsage(stored, day)

  return {
    day,
    calls: was.calls + 1,
    input: was.input + usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
    output: was.output + usage.output_tokens,
    usd: was.usd + estimateUsd(usage),
  }
}

export function coerceUsage(stored: unknown, day: string): DayUsage {
  const zero: DayUsage = { day, calls: 0, input: 0, output: 0, usd: 0 }
  if (typeof stored !== 'object' || stored === null) return zero
  const value = stored as Record<string, unknown>
  if (value.day !== day) return zero
  const usd = typeof value.usd === 'number' && Number.isFinite(value.usd) && value.usd > 0 ? value.usd : 0

  return { day, calls: count(value.calls), input: count(value.input), output: count(value.output), usd }
}

// ---------------------------------------------------------------- /crossroads

function total(counts: Counts): number {
  return Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0)
}

/** What `/crossroads` prints. */
export function formatStatus(isEnabled: boolean, usage: DayUsage, record: ProjectRecord): string {
  const lines = [isEnabled ? 'Crossroads is on.' : 'Crossroads is off. /crossroads on turns it back on.']
  const calls = usage.calls === 1 ? '1 call' : `${usage.calls} calls`
  lines.push(
    `Today: ${calls}, about $${usage.usd.toFixed(4)} (${usage.input} tokens in, ${usage.output} out; estimated at small-model list prices).`,
  )
  const kinds = topKinds(record)
  lines.push(
    `This project: taken ${total(record.taken)}, edited ${total(record.edited)}, ignored ${total(record.ignored)}.` +
      (kinds.length ? ` Top kinds: ${kinds.join(', ')}.` : ''),
  )
  if (record.streak >= 3) {
    lines.push(`Backing off: ${record.streak} lists ignored in a row, so a list comes every ${backoffGap(record.streak)} turns until you take one.`)
  }
  lines.push('Commands: /crossroads on, /crossroads off, /crossroads forget (wipes this project\'s counts).')

  return lines.join('\n')
}
