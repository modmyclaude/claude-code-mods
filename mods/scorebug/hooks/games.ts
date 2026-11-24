// The games scorebug shows, as plain data, and every rule about them that
// needs no engine: the pretend games that stand in until a real feed is
// chosen, which games a person follows and in what order, the words a card
// and the band show, what is worth a toast, and how long to wait before the
// next look at the feed.
//
// Pure: a time and the settings in, plain values out. register.tsx reads the
// clock and draws; nothing here does.

import type { ScoreGame, ScoreSide } from '../types'

export const SOURCES = ['demo'] as const
export type Source = (typeof SOURCES)[number]
export const isSource = (v: unknown): v is Source => typeof v === 'string' && (SOURCES as readonly string[]).includes(v)

export type Side = 'left' | 'right'
export const isSide = (v: unknown): v is Side => v === 'left' || v === 'right'

/** auto: the band shows where no card can, on the terminal, on the phone and in the desktop app with no scene behind the chat. */
export type Band = 'auto' | 'on' | 'off'
export const isBand = (v: unknown): v is Band => v === 'auto' || v === 'on' || v === 'off'

export const DEFAULT_REFRESH_S = 30
const MIN_REFRESH_S = 10
const MAX_REFRESH_S = 300
/** With no followed game on, the next look is at most this far off. */
export const IDLE_MS = 15 * 60_000
/** After a failed look the wait doubles, up to this. */
const MOST_BACKOFF_MS = 5 * 60_000
/** At most this many games are shown: cards in a column, or games on the band. */
export const MOST = 4
/** At most this many teams are followed, each name at most this long. */
const MOST_TEAMS = 20
const LONGEST_TEAM = 40

export function clampRefresh(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_REFRESH_S
  return Math.min(MAX_REFRESH_S, Math.max(MIN_REFRESH_S, Math.round(n)))
}

/** The teams setting: names or short codes, comma-separated, in lower case; empty follows every game. */
export function parseTeams(value: unknown): string[] {
  if (typeof value !== 'string') return []
  const out: string[] = []
  for (const part of value.split(',')) {
    const t = part.trim().toLowerCase().slice(0, LONGEST_TEAM)
    if (t !== '' && !out.includes(t)) out.push(t)
  }
  return out.slice(0, MOST_TEAMS)
}

const named = (side: ScoreSide, t: string): boolean => {
  const name = side.name.toLowerCase()
  return side.short.toLowerCase() === t || name === t || name.split(/\s+/).includes(t)
}

/** Whether a game has a team the person follows: by its short code, its whole name or one word of it. */
export function follows(game: ScoreGame, teams: readonly string[]): boolean {
  return teams.length === 0 || teams.some(t => named(game.away, t) || named(game.home, t))
}

const RANK: Record<ScoreGame['state'], number> = { live: 0, pre: 1, final: 2 }

/** The games to show: followed ones, live first, then those to come, then the finished, the feed's order kept within each; four at most. */
export function shownOf(all: readonly ScoreGame[], teams: readonly string[]): ScoreGame[] {
  return all
    .filter(g => follows(g, teams))
    .map((g, i) => ({ g, i }))
    .sort((a, b) => RANK[a.g.state] - RANK[b.g.state] || a.i - b.i)
    .map(x => x.g)
    .slice(0, MOST)
}

/** The wait before the next look: the refresh while a game is on or the feed costs nothing, else until the next start, at most fifteen minutes. */
export function waitOf(games: readonly ScoreGame[], refreshS: number, now: number, costsNothing: boolean): number {
  const refresh = refreshS * 1000
  if (costsNothing || games.some(g => g.state === 'live')) return refresh
  let wait = IDLE_MS
  for (const g of games) if (g.state === 'pre' && g.startsAt !== undefined && g.startsAt > now) wait = Math.min(wait, g.startsAt - now)
  return Math.max(refresh, wait)
}

/** The wait after a failed look: twice the last, up to five minutes. */
export function backoff(lastMs: number): number {
  return Math.min(MOST_BACKOFF_MS, Math.max(1000, lastMs) * 2)
}

/** The game's score as words: `RDG 1, HBR 2`, away first. */
const scoreOf = (g: ScoreGame): string => `${g.away.short} ${g.away.score}, ${g.home.short} ${g.home.score}`

/**
 * What is worth a toast between two looks: a score in a game of goals or runs,
 * and the end of any game. A game seen for the first time says nothing, so a
 * session opens quietly and a reload stays quiet.
 */
export function alertsOf(before: readonly ScoreGame[], after: readonly ScoreGame[]): string[] {
  const out: string[] = []
  for (const g of after) {
    const was = before.find(b => b.id === g.id)
    if (was === undefined) continue
    if (g.kind === 'goals' && g.state !== 'pre') {
      const scorers = [g.away.score > was.away.score ? g.away.short : '', g.home.score > was.home.score ? g.home.short : ''].filter(s => s !== '')
      if (scorers.length > 0) out.push(`${scorers.join(' and ')} ${scorers.length > 1 ? 'score' : 'scores'}: ${scoreOf(g)}`)
    }
    if (g.state === 'final' && was.state !== 'final') out.push(`Final: ${scoreOf(g)}`)
  }
  return out
}

/** The card's top line: `LIVE  P2 12:41`, `FINAL`, `STARTS IN 2 MIN`. */
export function captionOf(g: ScoreGame): string {
  return g.state === 'live' ? `LIVE  ${g.status.toUpperCase()}` : g.status.toUpperCase()
}

/** Which side leads, or neither. */
export function leaderOf(g: ScoreGame): 'away' | 'home' | null {
  if (g.state === 'pre' || g.away.score === g.home.score) return null
  return g.away.score > g.home.score ? 'away' : 'home'
}

/** One game on the band: `RDG 1 HBR 2 P2 12:41`, or `RDG at HBR starts in 2 min`. */
export function lineOf(g: ScoreGame): string {
  if (g.state === 'pre') return `${g.away.short} at ${g.home.short} ${g.status}`
  return `${g.away.short} ${g.away.score} ${g.home.short} ${g.home.score} ${g.status}`
}

/** Whether two looks found the same thing, so an unchanged look writes nothing and redraws nothing. */
export function sameGames(a: readonly ScoreGame[], b: readonly ScoreGame[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// The pretend games: two made-up teams in each, playing on the clock, so the
// cards and the band can be seen and judged before a real feed is chosen.
// Each round is fifteen minutes: a minute before the start, nine minutes of
// play cut into periods with short breaks, then the final score until the
// next round. The scoring is drawn from the round's number, so every engine,
// every reload and every test sees the same game at the same moment.

const MIN = 60_000
export const ROUND = 15 * MIN
const BEFORE = MIN
const PLAY = 9 * MIN
const BREAK = 40_000

type Plan = {
  id: string
  away: readonly [string, string]
  home: readonly [string, string]
  kind: ScoreGame['kind']
  periods: number
  unit: 'P' | 'Q'
  /** The minutes on the game clock each period. */
  minutes: number
  /** Where its round starts, from the hour. */
  offset: number
  /** One chance to score in each stretch of this long. */
  slot: number
  /** How likely a stretch holds a score. */
  chance: number
}

const PLANS: readonly Plan[] = [
  { id: 'demo-harbour', away: ['Ridgeline', 'RDG'], home: ['Harbour', 'HBR'], kind: 'goals', periods: 3, unit: 'P', minutes: 20, offset: 0, slot: 30_000, chance: 0.2 },
  { id: 'demo-foundry', away: ['Lakeside', 'LKS'], home: ['Foundry', 'FDY'], kind: 'points', periods: 4, unit: 'Q', minutes: 12, offset: 7 * MIN, slot: 10_000, chance: 0.85 },
]

/** A steady number from 0 to 1 for each whole number, the same on every engine. */
function hash(n: number): number {
  let x = Math.imul(n | 0, 0x9e3779b1) ^ 0x5bd1e995
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

/** Seconds on a game clock as `12:41`. */
function clockOf(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The score after `played` milliseconds of play in round `round`. */
function scoredBy(plan: Plan, which: number, round: number, played: number): { away: number; home: number } {
  const score = { away: 0, home: 0 }
  const stretches = Math.floor(played / plan.slot)
  for (let k = 0; k < stretches; k += 1) {
    const seed = round * 7919 + which * 104_729 + k * 31
    if (hash(seed) >= plan.chance) continue
    const roll = hash(seed + 2)
    const points = plan.kind === 'goals' ? 1 : roll < 0.25 ? 3 : roll < 0.35 ? 1 : 2
    if (hash(seed + 1) < 0.5) score.away += points
    else score.home += points
  }
  return score
}

function pretend(plan: Plan, which: number, now: number): ScoreGame {
  const since = now - plan.offset
  const round = Math.floor(since / ROUND)
  const t = since - round * ROUND
  const periodMs = PLAY / plan.periods
  let state: ScoreGame['state'] = 'final'
  let status = 'final'
  let played = PLAY
  if (t < BEFORE) {
    state = 'pre'
    status = `starts in ${Math.ceil((BEFORE - t) / MIN)} min`
    played = 0
  } else {
    let e = t - BEFORE
    for (let p = 1; p <= plan.periods; p += 1) {
      if (e < periodMs) {
        state = 'live'
        played = (p - 1) * periodMs + e
        // Whole numbers to the last step, so the clock reads the same on every engine.
        status = `${plan.unit}${p} ${clockOf((plan.minutes * 60 * (periodMs - e)) / periodMs)}`
        break
      }
      e -= periodMs
      if (p === plan.periods) break
      if (e < BREAK) {
        state = 'live'
        played = p * periodMs
        status = plan.unit === 'Q' && p * 2 === plan.periods ? 'halftime' : `end of ${plan.unit}${p}`
        break
      }
      e -= BREAK
    }
  }
  const score = scoredBy(plan, which, round, played)
  return {
    id: plan.id,
    league: 'pretend game',
    away: { name: plan.away[0], short: plan.away[1], score: score.away },
    home: { name: plan.home[0], short: plan.home[1], score: score.home },
    state,
    status,
    kind: plan.kind,
    startsAt: now - t + BEFORE,
  }
}

/** The pretend games at `now`. */
export function demoGames(now: number): ScoreGame[] {
  return PLANS.map((plan, which) => pretend(plan, which, now))
}
