// Days, streaks and the counts Second Wind keeps. Pure: a day is a calendar
// date in the person's local time, computed from a clock reading and a UTC
// offset, so tests can cross midnight in any time zone.

export type DayCounts = { breaths: number; eyeRests: number; stretches: number; moves: number }

/** What $.store keeps under `stats`: counts and dates, nothing else. */
export type Stats = {
  v: 1
  /** The local day `today` belongs to (YYYY-MM-DD). */
  day: string | null
  today: DayCounts
  all: DayCounts
  /** Consecutive days with at least one breath, ending on `streakDay`. */
  streak: number
  streakDay: string | null
  /** Turns that ran past 60 seconds; every fifth may offer a movement card. */
  longTurns: number
}

/** What $.store keeps under `switch`: /breathe off and /breathe snooze. */
export type Switch = { off: boolean; snoozeDay: string | null }

export const ZERO: DayCounts = { breaths: 0, eyeRests: 0, stretches: 0, moves: 0 }
export const EMPTY_STATS: Stats = { v: 1, day: null, today: ZERO, all: ZERO, streak: 0, streakDay: null, longTurns: 0 }
export const SWITCH_ON: Switch = { off: false, snoozeDay: null }

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The local calendar day of `ms`, `offsetMinutes` east of UTC. */
export function dayKey(ms: number, offsetMinutes: number): string {
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10)
}

/** This machine's offset east of UTC at `ms` (daylight saving included); 0 if unknown. */
export function localOffset(ms: number): number {
  try {
    const off = -new Date(ms).getTimezoneOffset()
    return Number.isFinite(off) ? off + 0 : 0
  } catch {
    return 0
  }
}

export const localDay = (ms: number): string => dayKey(ms, localOffset(ms))

/** Days since 1970-01-01 for a day key. */
export const dayNumber = (day: string): number => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000)

/**
 * The streak after a breathing day. The same day keeps it; the next day adds
 * one; a gap starts over at 1. A day before the last (the clock moved back,
 * or a flight west) changes nothing.
 */
export function bumpStreak(streak: number, streakDay: string | null, day: string): { streak: number; streakDay: string } {
  if (streakDay === null || streak < 1) return { streak: 1, streakDay: day }
  const gap = dayNumber(day) - dayNumber(streakDay)
  if (gap <= 0) return { streak, streakDay }
  return gap === 1 ? { streak: streak + 1, streakDay: day } : { streak: 1, streakDay: day }
}

/** The streak as of `day`: still alive through the day after its last breath. */
export function streakOn(stats: Stats, day: string): number {
  if (stats.streakDay === null) return 0
  return dayNumber(day) - dayNumber(stats.streakDay) <= 1 ? stats.streak : 0
}

/** Today's counts as of `day` (a day before the stored one reads as the stored one). */
export const todayOn = (stats: Stats, day: string): DayCounts =>
  stats.day !== null && day <= stats.day ? stats.today : ZERO

const add = (a: DayCounts, b: Partial<DayCounts>): DayCounts => ({
  breaths: a.breaths + (b.breaths ?? 0),
  eyeRests: a.eyeRests + (b.eyeRests ?? 0),
  stretches: a.stretches + (b.stretches ?? 0),
  moves: a.moves + (b.moves ?? 0),
})

/** Adds one turn's counts on `day`. A day with breaths extends the streak. */
export function addCounts(stats: Stats, day: string, counts: Partial<DayCounts>): Stats {
  const on = stats.day !== null && day < stats.day ? stats.day : day
  const today = stats.day === on ? add(stats.today, counts) : add(ZERO, counts)
  const streak = (counts.breaths ?? 0) > 0 ? bumpStreak(stats.streak, stats.streakDay, on) : { streak: stats.streak, streakDay: stats.streakDay }
  return { ...stats, day: on, today, all: add(stats.all, counts), ...streak }
}

const count = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0)
const dayOrNull = (x: unknown): string | null => (typeof x === 'string' && DAY.test(x) ? x : null)
const record = (x: unknown): Record<string, unknown> => (typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {})

function counts(x: unknown): DayCounts {
  const r = record(x)
  return { breaths: count(r.breaths), eyeRests: count(r.eyeRests), stretches: count(r.stretches), moves: count(r.moves) }
}

/** Reads what the store holds, whatever shape it is in. */
export function parseStats(raw: unknown): Stats {
  const r = record(raw)
  return {
    v: 1,
    day: dayOrNull(r.day),
    today: counts(r.today),
    all: counts(r.all),
    streak: count(r.streak),
    streakDay: dayOrNull(r.streakDay),
    longTurns: count(r.longTurns),
  }
}

export function parseSwitch(raw: unknown): Switch {
  const r = record(raw)
  return { off: r.off === true, snoozeDay: dayOrNull(r.snoozeDay) }
}

/** Whether the band runs on `day`: not off, and not snoozed through it. */
export const isOn = (sw: Switch, day: string): boolean => !sw.off && !(sw.snoozeDay !== null && day <= sw.snoozeDay)
