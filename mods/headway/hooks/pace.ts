// Pace math: the per-step estimate, time left, the "running long" rule and
// the duration words. Pure functions, no engine calls.

import type { HeadwayPrior } from '../types'

/** Time left shows only once this many steps of the plan have finished. */
export const MIN_FINISHED = 2
/**
 * Step times vary too much to be honest when their coefficient of variation
 * (sample standard deviation / mean) is above this. At 1.0, two steps hide the
 * estimate when one took roughly six times the other (3 + 2·√2, about 5.8).
 */
export const SPREAD_MAX = 1.0
/**
 * Steadiness reads only this many of the latest step times, so one long step
 * (a full test run among quick edits) stops hiding time left once it ages out.
 * The per-step median still uses the whole session.
 */
export const STEADY_WINDOW = 8
/** Project history weighs at most as much as this many steps of this session. */
export const PRIOR_WEIGHT_MAX = 3
/** A step running past this many times its estimate turns amber. */
export const LONG_FACTOR = 3

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

/** Sample coefficient of variation; 0 for fewer than two values or a zero mean. */
export function spread(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  if (mean <= 0) return 0
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance) / mean
}

export type Estimate = {
  /** The expected time of one step, ms. */
  perStepMs: number
  /** False when step times vary too much to show a time left. */
  isSteady: boolean
}

/**
 * The per-step estimate: the median of this session's step times, blended
 * with the project's history (which counts as up to PRIOR_WEIGHT_MAX steps),
 * steady when the last STEADY_WINDOW times agree well enough.
 * Null with fewer than MIN_FINISHED session times.
 */
export function estimate(session: readonly number[], prior?: HeadwayPrior): Estimate | null {
  if (session.length < MIN_FINISHED) return null
  const own = median(session)
  const weight = prior && prior.medianMs > 0 ? Math.min(prior.count, PRIOR_WEIGHT_MAX) : 0
  const perStepMs = weight > 0 && prior ? (session.length * own + weight * prior.medianMs) / (session.length + weight) : own
  return { perStepMs, isSteady: spread(session.slice(-STEADY_WINDOW)) <= SPREAD_MAX }
}

/** Time left: the rest of the current step (none once past its estimate) plus every step after it. */
export function timeLeft(perStepMs: number, remaining: number, currentElapsedMs: number): number {
  if (remaining <= 0) return 0
  return Math.max(0, perStepMs - currentElapsedMs) + perStepMs * (remaining - 1)
}

export function isRunningLong(currentElapsedMs: number, perStepMs: number): boolean {
  return perStepMs > 0 && currentElapsedMs > LONG_FACTOR * perStepMs
}

/** "45s", "4m 12s", "4m", "1h 5m": a duration to the second (minute past an hour). */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
}

/** "<1m", "3m", "1h 20m": a time left, rounded up to the minute. */
export function formatLeft(ms: number): string {
  if (ms < 60_000) return '<1m'
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** How the actual total compares with the first estimate, or '' without one. */
export function accuracy(totalMs: number, estimateMs: number | undefined): string {
  if (estimateMs === undefined || estimateMs <= 0) return ''
  const delta = totalMs - estimateMs
  if (Math.abs(delta) <= Math.max(5_000, estimateMs * 0.05)) return 'right on estimate'
  return delta < 0 ? `${formatDuration(-delta)} ahead of estimate` : `${formatDuration(delta)} behind estimate`
}

/** The receipt: total time, how the first estimate did, and time per stage. */
export function receiptText(totalMs: number, estimateMs: number | undefined, stages: readonly { name: string; ms: number }[], steps: number): string {
  const how = accuracy(totalMs, estimateMs)
  const head = `Plan done in ${formatDuration(totalMs)}${how ? `, ${how}` : ''}.`
  if (stages.length < 2) return `${head} ${steps} ${steps === 1 ? 'step' : 'steps'}.`
  return `${head} ${stages.map(stage => `${stage.name} ${formatDuration(stage.ms)}`).join(' · ')}`
}
