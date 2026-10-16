// redline's pure logic: no `$`, no clock, no state. Every hook turns what it
// saw into a Reading, `reduce` folds it into the gauge, and the formatters
// draw the gauge as text. Kept pure so the thresholds, the toast's hysteresis,
// the pace and the cost math are table-tested on their own.

import type { TurnUsage } from 'claude-code'
import type { RedlineGauge, RedlineLimit, RedlineSample, RedlineSpend, RedlineTokens, RedlineTurn } from '../types'
import { priceRequest, sumTokens } from './prices'

export const AMBER_AT = 60
export const RED_AT = 80
/** The 80% toast re-arms only once context drops under this (after /compact). */
export const REARM_BELOW = 75
/** Pace and tokens per minute look back this far. */
export const SPAN_MS = 10 * 60_000
/** A plan window's current rate looks back this far (it moves in whole points). */
export const LIMIT_SPAN_MS = 15 * 60_000
/** Under a minute of growth is too little to extrapolate from. */
const MIN_PACE_MS = 60_000
const TURNS_KEPT = 100
const MINUTE = 60_000
const HOUR = 60 * MINUTE

export type Level = 'unknown' | 'normal' | 'amber' | 'red'

export const ZERO: RedlineTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export const EMPTY_GAUGE: RedlineGauge = {
  spend: {},
  byModel: {},
  sessionStartedAt: null,
  trackingSince: null,
  window: null,
  contextTokens: null,
  contextPercent: null,
  samples: [],
  flow: [],
  totals: ZERO,
  tableUsd: ZERO,
  unpriced: [],
  ledgerUsd: null,
  limits: [],
  limitHistory: {},
  turns: [],
  model: null,
  isArmed: true,
}

// ---------------------------------------------------------------- thresholds

/**
 * Context fill as a whole percentage, as the gauge shows and judges it:
 * Claude Code's own figure when it gave one for this count, else the count
 * over the window, rounded as Claude Code rounds it.
 */
export function percentOf(g: Pick<RedlineGauge, 'contextTokens' | 'contextPercent' | 'window'>): number | undefined {
  if (g.contextTokens === null) return undefined
  if (g.contextPercent !== null) return g.contextPercent
  if (!g.window) return undefined
  return Math.round((g.contextTokens * 100) / g.window)
}

export function levelOf(percent: number | undefined): Level {
  if (percent === undefined) return 'unknown'
  if (percent >= RED_AT) return 'red'
  if (percent >= AMBER_AT) return 'amber'
  return 'normal'
}

/**
 * The 80% toast's hysteresis: fire once on the way up, then stay quiet until
 * the fill drops under 75% (a /compact, a fresh session) and arms it again.
 */
export function alarm(isArmed: boolean, percent: number | undefined): { isArmed: boolean; fire: boolean } {
  if (percent === undefined) return { isArmed, fire: false }
  if (isArmed && percent >= RED_AT) return { isArmed: false, fire: true }
  if (!isArmed && percent < REARM_BELOW) return { isArmed: true, fire: false }
  return { isArmed, fire: false }
}

// ---------------------------------------------------------------------- pace

/**
 * When the context fills at the rate of the last 10 minutes: milliseconds
 * after the last reading, 0 when already full, undefined with no estimate.
 *
 * Only the run since the last drop counts (a compaction starts it over), and
 * it must span a minute and grow; flat or shrinking context has no estimate.
 */
export function paceEta(samples: readonly RedlineSample[], window: number | null, now: number): number | undefined {
  const growth = contextGrowth(samples, now)
  if (!window || growth === undefined) return undefined
  const left = window - growth.last
  return left <= 0 ? 0 : left / growth.perMs
}

/**
 * How fast a reading grew over the last `span` (10 minutes for the context),
 * counted from the last drop: units per millisecond and the latest value.
 */
export function contextGrowth(samples: readonly RedlineSample[], now: number, span = SPAN_MS): { perMs: number; last: number } | undefined {
  const recent = samples.filter(s => s.t >= now - span)
  let start = 0
  for (let i = 1; i < recent.length; i++) {
    if ((recent[i]?.tokens ?? 0) < (recent[i - 1]?.tokens ?? 0)) start = i
  }
  const run = recent.slice(start)
  const first = run[0]
  const last = run[run.length - 1]
  if (!first || !last || run.length < 2) return undefined
  const covered = last.t - first.t
  const growth = last.tokens - first.tokens
  if (covered < MIN_PACE_MS || growth <= 0) return undefined
  return { perMs: growth / covered, last: last.tokens }
}

/**
 * New tokens a minute over the last 10 minutes: uncached input, cache writes
 * and output. Cache reads are left out: every request re-reads the whole
 * context, so counting them measures context size, not work.
 */
export function tokensPerMinute(flow: readonly RedlineSample[], now: number, since: number | null): number {
  const from = now - SPAN_MS
  const sum = flow.filter(s => s.t > from).reduce((n, s) => n + s.tokens, 0)
  const covered = Math.min(SPAN_MS, now - (since ?? from))
  return sum / Math.max(1, covered / MINUTE)
}

// --------------------------------------------------------------- plan limits

// The windows Claude Code reports (SessionRateLimit.kind) and how long each
// runs; any other kind (a gateway's spend_limit) is shown with no run-out.
const LIMIT_WINDOWS: Record<string, { label: string; short: string; ms: number }> = {
  five_hour: { label: '5-hour', short: '5h', ms: 5 * HOUR },
  seven_day: { label: 'weekly', short: 'week', ms: 7 * 24 * HOUR },
}

export const limitLabel = (kind: string): string => LIMIT_WINDOWS[kind]?.label ?? kind.replace(/_/g, ' ')
export const limitShort = (kind: string): string => LIMIT_WINDOWS[kind]?.short ?? kind.replace(/_limit$/, '').replace(/_/g, ' ')

/** What a run-out was judged on: the last 15 minutes, or the window's average. */
export type RunOutBasis = 'recent' | 'average'

export type RunOut = { kind: 'out' } | { kind: 'at'; ms: number; basis: RunOutBasis } | { kind: 'resets-first'; basis: RunOutBasis }

/**
 * When a plan window runs out. At its current rate (how far it moved over the
 * last 15 minutes) when it moved; otherwise at the average pace since it
 * opened (its start is its reset less its length), so a late burst warns and
 * a quiet spell does not hide what came before. Undefined with no reset time
 * or one already past, and for an average that has too little to go on (a
 * window of unknown length, unused, or opened under 10 minutes ago).
 */
export function runOut(limit: RedlineLimit, now: number, history: readonly RedlineSample[] = []): RunOut | undefined {
  if (limit.percentUsed >= 100) return { kind: 'out' }
  const reset = Date.parse(limit.resetsAt ?? '')
  if (Number.isNaN(reset) || reset <= now) return undefined
  const left = 100 - limit.percentUsed
  const recent = contextGrowth(history, now, LIMIT_SPAN_MS)
  let ms: number
  let basis: RunOutBasis
  if (recent) {
    ms = left / recent.perMs
    basis = 'recent'
  } else {
    const length = LIMIT_WINDOWS[limit.kind]?.ms
    if (length === undefined || limit.percentUsed <= 0) return undefined
    const elapsed = now - (reset - length)
    if (elapsed < 10 * MINUTE) return undefined
    ms = (left * elapsed) / limit.percentUsed
    basis = 'average'
  }
  return now + ms >= reset ? { kind: 'resets-first', basis } : { kind: 'at', ms, basis }
}

/** Adds this reading of each plan window to its last 15 minutes of readings. */
export function recordLimits(
  history: Readonly<Record<string, readonly RedlineSample[]>>,
  limits: readonly RedlineLimit[],
  now: number,
): Record<string, RedlineSample[]> {
  const out: Record<string, RedlineSample[]> = {}
  for (const l of limits) {
    const kept = (history[l.kind] ?? []).filter(s => s.t >= now - LIMIT_SPAN_MS)
    const last = kept[kept.length - 1]
    // A reading a minute is plenty while the figure holds still.
    const isSame = last !== undefined && last.tokens === l.percentUsed && now - last.t < MINUTE
    out[l.kind] = isSame ? kept : [...kept, { t: now, tokens: l.percentUsed }]
  }
  return out
}

// ------------------------------------------------------------------- reduce

/** What one hook saw. A field left out changes nothing in the gauge. */
export type Reading = {
  now: number
  sessionStartedAt?: number
  window?: number
  /** The main loop's context: a count, or null when unknown again. */
  contextTokens?: number | null
  /** Claude Code's own percentage for that count, when it gave one. */
  contextPercent?: number
  ledgerUsd?: number
  limits?: readonly RedlineLimit[]
  /** A main-loop turn began with this prompt. */
  turnStart?: { turnId: string; text: string }
  /** One model request finished, in the main loop or a subagent's, and the kinds of work it carried. */
  request?: { turnId: string; agentId?: string; usage: TurnUsage; kinds?: readonly string[] }
}

const addTokens = (a: RedlineTokens, b: RedlineTokens): RedlineTokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

export const tokensOf = (u: TurnUsage): RedlineTokens => ({
  input: u.input_tokens,
  output: u.output_tokens,
  cacheRead: u.cache_read_input_tokens,
  cacheWrite: u.cache_creation_input_tokens,
})

/** A prompt's first line, cut to fit a row. */
export function labelOf(text: string): string {
  const line = text.trim().split('\n')[0]?.trim() ?? ''
  if (line === '') return '(no prompt text)'
  return line.length > 60 ? `${line.slice(0, 59)}...` : line
}

function withTurn(turns: readonly RedlineTurn[], id: string, make: () => RedlineTurn, change: (t: RedlineTurn) => RedlineTurn): RedlineTurn[] {
  const found = turns.some(t => t.id === id)
  const next = found ? turns.map(t => (t.id === id ? change(t) : t)) : [...turns, change(make())]
  if (next.length <= TURNS_KEPT) return next
  // Over the cap: drop the least busy, which the busiest list never shows;
  // never the turn being written (a new turn has no tokens yet).
  const others = next.filter(t => t.id !== id)
  const quietest = others.reduce((a, b) => (sumTokens(b.tokens) < sumTokens(a.tokens) ? b : a))
  return next.filter(t => t !== quietest)
}

/** Folds a reading into the gauge; `fire` says the 80% toast is due now. */
export function reduce(g: RedlineGauge, r: Reading): { gauge: RedlineGauge; fire: boolean } {
  // A gauge kept in session state by an earlier version lacks the newer fields: they start empty.
  let next: RedlineGauge = { ...EMPTY_GAUGE, ...g }
  if (r.sessionStartedAt !== undefined) next.sessionStartedAt = r.sessionStartedAt
  if (next.trackingSince === null) next.trackingSince = r.now
  if (r.window !== undefined && r.window > 0) next.window = r.window
  if (r.ledgerUsd !== undefined) next.ledgerUsd = r.ledgerUsd
  if (r.limits !== undefined) {
    next.limits = r.limits.map(l => ({ ...l }))
    next.limitHistory = recordLimits(next.limitHistory, r.limits, r.now)
  }

  let context = r.contextTokens
  if (r.turnStart) {
    const { turnId, text } = r.turnStart
    const make = (): RedlineTurn => ({ id: turnId, label: '', isSubagent: false, startedAt: r.now, requests: 0, tokens: ZERO, usd: 0 })
    next.turns = withTurn(next.turns, turnId, make, t => ({ ...t, label: labelOf(text) }))
  }
  if (r.request) {
    const { turnId, agentId, usage, kinds = [] } = r.request
    const tokens = tokensOf(usage)
    const usd = priceRequest(usage.model, tokens)
    next.totals = addTokens(next.totals, tokens)
    if (usd) next.tableUsd = addTokens(next.tableUsd, usd)
    else if (!next.unpriced.includes(usage.model)) next.unpriced = [...next.unpriced, usage.model].slice(-5)
    next.flow = [...next.flow.filter(s => s.t > r.now - SPAN_MS), { t: r.now, tokens: tokens.input + tokens.cacheWrite + tokens.output }]
    const make = (): RedlineTurn => ({
      id: turnId,
      label: agentId === undefined ? '(prompt not seen)' : `subagent ${agentId.slice(0, 8)}`,
      isSubagent: agentId !== undefined,
      startedAt: r.now,
      requests: 0,
      tokens: ZERO,
      usd: 0,
    })
    next.turns = withTurn(next.turns, turnId, make, t => ({
      ...t,
      requests: t.requests + 1,
      tokens: addTokens(t.tokens, tokens),
      usd: t.usd === null || !usd ? null : t.usd + sumTokens(usd),
    }))
    // Where the money went: the request's tokens and price split evenly across the kinds it carried, and by model.
    const cost = usd ? sumTokens(usd) : undefined
    const charge = (entry: RedlineSpend | undefined, t: RedlineTokens, c: number | undefined): RedlineSpend => ({
      requests: (entry?.requests ?? 0) + 1,
      tokens: addTokens(entry?.tokens ?? ZERO, t),
      usd: entry?.usd === null || c === undefined ? null : (entry?.usd ?? 0) + c,
    })
    const share = kinds.length > 0 ? 1 / kinds.length : 1
    const part: RedlineTokens = { input: tokens.input * share, output: tokens.output * share, cacheRead: tokens.cacheRead * share, cacheWrite: tokens.cacheWrite * share }
    const spend = { ...next.spend }
    for (const kind of kinds) spend[kind] = charge(spend[kind], part, cost === undefined ? undefined : cost * share)
    next.spend = spend
    next.byModel = { ...next.byModel, [usage.model]: charge(next.byModel[usage.model], tokens, cost) }
    // Only the main loop's requests are the session's context; a subagent
    // has a window of its own.
    if (agentId === undefined) {
      context = tokens.input + tokens.cacheRead + tokens.cacheWrite
      next.model = usage.model
    }
  }
  if (context !== undefined) {
    next.contextTokens = context
    // Claude Code's figure belongs to the count it came with, never to another.
    next.contextPercent = r.contextPercent !== undefined && context === r.contextTokens ? r.contextPercent : null
    const last = next.samples[next.samples.length - 1]
    if (context !== null && last?.tokens !== context) {
      next.samples = [...next.samples.filter(s => s.t >= r.now - SPAN_MS), { t: r.now, tokens: context }]
    }
  }

  const { isArmed, fire } = alarm(next.isArmed, percentOf(next))
  next.isArmed = isArmed
  return { gauge: next, fire }
}

/** The busiest turns first, by every token their requests used. */
export const busiest = (g: RedlineGauge, n = 5): RedlineTurn[] =>
  [...g.turns].filter(t => t.requests > 0).sort((a, b) => sumTokens(b.tokens) - sumTokens(a.tokens)).slice(0, n)

// --------------------------------------------------------------- formatting

// ANSI sequences: CSI (7-bit ESC [ or 8-bit U+009B) and OSC (ESC ] ... BEL or ST).
const ANSI = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g

/**
 * Text safe to draw: the engine refuses a whole tree (and the status line's
 * text) that holds a C0 or C1 control character, hiding every band beneath.
 * Model ids, plan window kinds and prompt text come from outside, so every
 * string redline draws passes through here: ANSI sequences go, a tab becomes
 * a space, and any other control character becomes U+FFFD.
 */
export const clean = (s: string): string => s.replace(ANSI, '').replace(/\t/g, ' ').replace(CONTROL, '\ufffd')

export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/**
 * Dollars as the gauge writes them, always marked "≈": the price table and
 * Claude Code's own ledger alike are list-price arithmetic, not a bill (on a
 * subscription nobody pays them).
 */
export function fmtUsd(usd: number): string {
  if (usd >= 100) return `≈$${Math.round(usd)}`
  // A real but tiny cost reads as such, not as a suspicious $0.00.
  if (usd > 0 && usd < 0.005) return '≈<$0.01'
  return `≈$${usd.toFixed(2)}`
}

export function fmtDuration(ms: number): string {
  if (ms < MINUTE) return '<1m'
  // 59m 40s rounds to the hour, not to "60m".
  if (ms < HOUR) return Math.round(ms / MINUTE) === 60 ? '1h' : `${Math.round(ms / MINUTE)}m`
  if (ms < 24 * HOUR) {
    const h = Math.floor(ms / HOUR)
    const m = Math.round((ms - h * HOUR) / MINUTE)
    return m === 0 ? `${h}h` : m === 60 ? `${h + 1}h` : `${h}h ${m}m`
  }
  const d = Math.floor(ms / (24 * HOUR))
  const h = Math.round((ms - d * 24 * HOUR) / HOUR)
  // 23h 50m rounds up into the next day, as 59m 40s does into the next hour.
  return h === 0 ? `${d}d` : h === 24 ? `${d + 1}d` : `${d}d ${h}h`
}

/** A span as the one-line gauge writes it: to the minute under ten hours, to the hour from there (`21h`, not `20h 43m`). */
export function fmtSpan(ms: number): string {
  return ms < 10 * HOUR ? fmtDuration(ms) : fmtDuration(Math.round(ms / HOUR) * HOUR)
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * A moment as clock time, in the machine's own zone: `3:30pm` today, `Sat 10am`
 * on another day of the coming week, and a span (`in 7d`) further out, where a
 * weekday would be ambiguous.
 */
export function fmtClock(at: number, now: number): string {
  const d = new Date(at)
  const n = new Date(now)
  const h = d.getHours()
  const m = d.getMinutes()
  const time = `${h % 12 === 0 ? 12 : h % 12}${m === 0 ? '' : `:${String(m).padStart(2, '0')}`}${h < 12 ? 'am' : 'pm'}`
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return time
  if (at - now >= 6 * 24 * HOUR) return `in ${fmtSpan(at - now)}`
  return `${DAYS[d.getDay()] ?? ''} ${time}`
}

/** When a window resets, as the words after "resets": `in 48m` under ten hours away, else the clock time (`Sat 10am`). */
export function fmtReset(at: number, now: number): string {
  return at - now < 10 * HOUR ? `in ${fmtDuration(at - now)}` : fmtClock(at, now)
}

export function fmtPace(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined
  if (ms <= 0) return 'full now'
  if (ms < MINUTE) return 'full in <1m'
  if (ms > 24 * HOUR) return 'full in >1d'
  return `full in ~${fmtDuration(ms)}`
}

export function bar(percent: number | undefined, cells: number): string {
  const filled = percent === undefined ? 0 : Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

/** The level as a word, so the gauge reads the same without colour. */
export const levelWord = (level: Level): string => (level === 'red' ? 'RED' : level === 'amber' ? 'AMBER' : '')

/**
 * The session's cost as the gauge shows it: Claude Code's own estimate (what
 * /cost shows), else the price table's, else tokens.
 */
export function costText(g: RedlineGauge): string {
  if (g.ledgerUsd !== null) return fmtUsd(g.ledgerUsd)
  if (g.unpriced.length === 0) return fmtUsd(sumTokens(g.tableUsd))
  return `${fmtTokens(sumTokens(g.totals))} tokens`
}

/** A run-out in words: `out in ~1h 20m` (`~21h` from ten hours), `resets first`, `OUT`, or nothing. */
export function fmtRunOut(r: RunOut | undefined): string | undefined {
  if (r === undefined) return undefined
  if (r.kind === 'out') return 'OUT'
  if (r.kind === 'resets-first') return 'resets first'
  return r.ms < MINUTE ? 'out in <1m' : `out in ~${fmtSpan(r.ms)}`
}

/**
 * A plan window's level, by whether it is set to hit its wall: red when spent,
 * amber when it is projected to run out before it resets, normal otherwise,
 * unknown once its reset time has passed (the figure is stale until the next
 * reply). A percentage alone says nothing here: a week at 83% is fine when it
 * resets first, and a week at 40% is not when a burst will empty it by tonight.
 */
export function limitLevel(l: RedlineLimit, now: number, history: readonly RedlineSample[] = []): Level {
  const reset = Date.parse(l.resetsAt ?? '')
  if (!Number.isNaN(reset) && reset <= now) return 'unknown'
  const r = runOut(l, now, history)
  return r?.kind === 'out' ? 'red' : r?.kind === 'at' ? 'amber' : 'normal'
}

/**
 * One figure of the one-line gauge: a label, a bar where there is room, the
 * readout, its level (the band's colour, the status line's word), and a clause
 * bound to it with a comma (`, full in ~7m`, `, out in ~21h`, `, resets Sat 10am`).
 * Every string is already cleaned: a window's kind is the engine's.
 */
export type Figure = {
  key: string
  label: string
  bar?: string
  value: string
  level: Level
  clause?: string
  /** Drawn dim in the band: the dollars on a plan, the rate. */
  isDim: boolean
}

/**
 * A plan window as a figure: `week ████░ 83%`, or `week 83% used` where the
 * band has no room for a bar (the bar says "used" on its own); its run-out
 * when it runs dry before it resets; when it comes back once spent.
 */
export function limitFigure(l: RedlineLimit, now: number, history: readonly RedlineSample[] = [], cells = 5): Figure {
  const key = `limit-${l.kind}`
  const label = clean(limitShort(l.kind))
  const level = limitLevel(l, now, history)
  const reset = Date.parse(l.resetsAt ?? '')
  // Past its reset the reading is stale until the next response says more.
  if (level === 'unknown') return { key, label, value: 'reset', level, isDim: true }
  const r = runOut(l, now, history)
  // A spent window: when it comes back is the one figure that matters.
  if (r?.kind === 'out') return { key, label, value: 'OUT', level, isDim: false, ...(Number.isNaN(reset) ? {} : { clause: `resets ${fmtReset(reset, now)}` }) }
  const pct = Math.round(l.percentUsed)
  const readout = cells > 0 ? { bar: bar(Math.min(100, pct), cells), value: `${pct}%` } : { value: `${pct}% used` }
  // On the one line only a window that runs dry before it resets earns words.
  return { key, label, ...readout, level, isDim: false, ...(r?.kind === 'at' ? { clause: fmtRunOut(r) ?? '' } : {}) }
}

/**
 * A figure as plain text, for the status line: `week ████░ 83% AMBER, out in ~21h`.
 * The level word follows the readout, except where the readout spells it out (OUT).
 */
export function figureText(f: Figure): string {
  const word = f.value === 'OUT' ? '' : levelWord(f.level)
  const head = [f.label, f.bar, `${f.value}${word ? ` ${word}` : ''}`].filter(s => s !== undefined && s !== '').join(' ')
  return f.clause ? `${head}, ${f.clause}` : head
}

/** One plan window as the status line writes it. */
export const limitText = (l: RedlineLimit, now: number, history: readonly RedlineSample[] = [], cells = 5): string =>
  figureText(limitFigure(l, now, history, cells))

/** How many cells each bar of the one-line gauge gets; 0 draws the readout in words. */
export type Cells = { context: number; limit: number }
export const FULL_CELLS: Cells = { context: 10, limit: 5 }
export const NARROW_CELLS: Cells = { context: 5, limit: 0 }

/**
 * The figures every view of the gauge draws, computed once, in reading order:
 * the context with its pace, each plan window, the dollars, the rate while
 * tokens flow. On a plan the windows are the limits and the dollars a
 * footnote (nobody pays them); with an API key the dollars are the limit.
 */
export function gaugeParts(g: RedlineGauge, now: number, cells: Cells = FULL_CELLS) {
  const percent = percentOf(g)
  const level = levelOf(percent)
  const pace = fmtPace(paceEta(g.samples, g.window, now))
  const figures: Figure[] = [
    percent === undefined
      ? { key: 'context', label: 'context', value: '--', level, isDim: false }
      : { key: 'context', label: 'context', bar: bar(percent, cells.context), value: `${percent}%`, level, isDim: false, ...(pace ? { clause: pace } : {}) },
    ...g.limits.map(l => limitFigure(l, now, g.limitHistory[l.kind], cells.limit)),
    { key: 'cost', label: '', value: costText(g), level: 'normal', isDim: g.limits.length > 0 },
  ]
  const rate = tokensPerMinute(g.flow, now, g.trackingSince)
  // An idle session shows no rate: "0 tokens/min" reads like a fault.
  if (rate > 0) figures.push({ key: 'rate', label: '', value: `${fmtTokens(rate)} tokens/min`, level: 'normal', isDim: true })
  return { percent, level, figures }
}

/**
 * The status line: plain text, each level spelled out since it has no colour,
 * cleaned since a plan window's kind is the engine's string.
 */
export function gaugeLine(g: RedlineGauge, now: number): string {
  return clean(gaugeParts(g, now).figures.map(figureText).join(' · '))
}

/** The 80% toast: redline's own words and a number, no outside text. */
export const TOAST_TEXT = (percent: number): string =>
  `Context is ${percent}% full. Run /compact to summarize it, or /clear to start a fresh session.`
