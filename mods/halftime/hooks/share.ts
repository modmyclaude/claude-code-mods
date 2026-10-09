// The words halftime shows: the share line after a run, the one-line
// scorecard, and clean() for the one outside text it draws. Pure, so the
// exact wording is pinned by tests.

import type { HalftimeGameId, HalftimeStats } from '../types'
import { GAME_IDS, scoreText } from './games'

// OSC (ESC ] or C1 U+009D, to BEL or ST), CSI (ESC [ or C1 U+009B), then any other escape.
const ANSI =
  /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u009d[^\u0007\u001b\u009c]*(?:\u0007|\u009c|\u001b\\)?|\u001b\[[0-?]*[ -/]*[@-~]|\u009b[0-?]*[ -/]*[@-~]|\u001b[ -/]*[0-~]?/g
const BREAKS = /\r\n?|[\n\t\u2028\u2029]/g
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
// Zero-width, bidi overrides and isolates, invisible fillers, tag characters, variation selectors.
const INVISIBLE =
  /[\u00ad\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufffb\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu

/**
 * Untrusted text made safe to draw on one line (API-GOTCHAS #31): the engine
 * refuses a whole tree holding one control character, and the band composes
 * every other mod's band, so one stray byte would take them all down. ANSI
 * sequences go, line breaks and tabs become spaces, any other C0, DEL or C1
 * becomes U+FFFD, invisible or bidi characters go. Everything else halftime
 * draws is its own words, game ids and numbers.
 */
export function clean(text: string): string {
  return text.replace(ANSI, '').replace(BREAKS, ' ').replace(CONTROL, '\uFFFD').replace(INVISIBLE, '')
}

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

/** "halftime daily 10-09 · hurdle 412 · played 3m of a 7m turn" */
export function shareLine(r: ShareInput): string {
  const head = r.mode === 'daily' ? `halftime daily ${r.day.slice(5)}` : 'halftime practice'
  const score = r.score === null ? 'lost' : scoreText(r.game, r.score)
  const played = r.waitMs >= 1000 ? `played ${duration(r.waitPlayedMs)} of a ${duration(r.waitMs)} turn` : `played ${duration(r.playedMs)}`
  return `${head} · ${r.game} ${score} · ${played}`
}

/** "halftime · hurdle 412 · tailchase 31 · merge - · sweep 47s · 37m played while waiting" */
export function scorecard(stats: HalftimeStats): string {
  const games = GAME_IDS.map(g => `${g} ${scoreText(g, stats.best[g] ?? null)}`).join(' · ')
  return `halftime · ${games} · ${duration(stats.waitPlayedMs)} played while waiting`
}
