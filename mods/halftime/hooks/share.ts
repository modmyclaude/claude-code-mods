// The words halftime shows: the share line after a run and the one-line
// scorecard. Pure, so the exact wording is pinned by tests.

import type { HalftimeGameId, HalftimeStats } from '../types'
import { GAME_IDS, scoreText } from './games'

/** "45s" under a minute, "3m" under an hour, then "1h 5m". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export type ShareInput = {
  mode: 'daily' | 'practice'
  day: string
  game: HalftimeGameId
  score: number | null
  playedMs: number
  /** Main-loop turn time the run overlapped, and the part of it spent playing. */
  waitMs: number
  waitPlayedMs: number
}

/** "halftime daily 10-09 · dash 412 · played 3m of a 7m turn" */
export function shareLine(r: ShareInput): string {
  const head = r.mode === 'daily' ? `halftime daily ${r.day.slice(5)}` : 'halftime practice'
  const score = r.score === null ? 'lost' : scoreText(r.game, r.score)
  const played = r.waitMs >= 1000 ? `played ${duration(r.waitPlayedMs)} of a ${duration(r.waitMs)} turn` : `played ${duration(r.playedMs)}`
  return `${head} · ${r.game} ${score} · ${played}`
}

/** "halftime · dash 412 · slither 31 · merge - · sweep 47s · 37m played while waiting" */
export function scorecard(stats: HalftimeStats): string {
  const games = GAME_IDS.map(g => `${g} ${scoreText(g, stats.best[g] ?? null)}`).join(' · ')
  return `halftime · ${games} · ${duration(stats.waitPlayedMs)} played while waiting`
}
