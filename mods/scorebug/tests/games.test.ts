// The rules with no engine: the pretend games through a round, following,
// order, toasts, the waits, and the words on a card and the band.

import { describe, expect, test } from 'claude-code/testing'

import {
  alertsOf, backoff, captionOf, clampRefresh, demoGames, follows, IDLE_MS, leaderOf, lineOf, parseTeams, ROUND, sameGames, shownOf, waitOf,
} from '../hooks/games'
import type { ScoreGame } from '../types'

const R0 = 1_888_889 * ROUND
const MIN = 60_000

const game = (over: Partial<ScoreGame> = {}): ScoreGame => ({
  id: 'g',
  league: 'test',
  away: { name: 'Ridgeline', short: 'RDG', score: 0 },
  home: { name: 'Harbour Gulls', short: 'HBR', score: 0 },
  state: 'live',
  status: 'P1 20:00',
  kind: 'goals',
  ...over,
})

describe('the pretend games', () => {
  test('the first game through its round: before the start, three periods with breaks, the final, then the next round', () => {
    const at = (ms: number) => demoGames(R0 + ms)[0]!
    expect(at(0)).toMatchObject({ state: 'pre', status: 'starts in 1 min', away: { short: 'RDG', score: 0 }, home: { short: 'HBR', score: 0 } })
    expect(at(30_000).status).toBe('starts in 1 min')
    expect(at(MIN)).toMatchObject({ state: 'live', status: 'P1 20:00' })
    expect(at(MIN + 90_000).status).toBe('P1 10:00')
    expect(at(MIN + 179_000).status).toBe('P1 0:07')
    expect(at(MIN + 180_000)).toMatchObject({ state: 'live', status: 'end of P1' })
    expect(at(MIN + 220_000).status).toBe('P2 20:00')
    expect(at(MIN + 400_000).status).toBe('end of P2')
    expect(at(MIN + 440_000).status).toBe('P3 20:00')
    expect(at(MIN + 620_000 - 1).state).toBe('live')
    expect(at(MIN + 620_000)).toMatchObject({ state: 'final', status: 'final' })
    expect(at(ROUND - 1).state).toBe('final')
    expect(at(ROUND)).toMatchObject({ state: 'pre', away: { score: 0 }, home: { score: 0 } })
  })

  test('the second game plays four quarters seven minutes later, with a halftime', () => {
    const at = (ms: number) => demoGames(R0 + 7 * MIN + ms)[1]!
    expect(at(0)).toMatchObject({ state: 'pre', kind: 'points', away: { short: 'LKS' }, home: { short: 'FDY' } })
    expect(at(MIN).status).toBe('Q1 12:00')
    expect(at(MIN + 135_000).status).toBe('end of Q1')
    expect(at(MIN + 2 * 135_000 + 40_000).status).toBe('halftime')
    expect(at(MIN + 4 * 135_000 + 3 * 40_000).status).toBe('final')
  })

  test('the same moment gives the same games; a score never falls within a round; the final holds the last score of play', () => {
    expect(demoGames(R0 + 5 * MIN)).toEqual(demoGames(R0 + 5 * MIN))
    for (const which of [0, 1]) {
      let away = 0
      let home = 0
      for (let ms = 0; ms < ROUND; ms += 5000) {
        const g = demoGames(R0 + which * 7 * MIN + ms)[which]!
        expect(g.away.score).toBeGreaterThanOrEqual(away)
        expect(g.home.score).toBeGreaterThanOrEqual(home)
        away = g.away.score
        home = g.home.score
      }
      expect(away + home).toBeGreaterThan(0)
    }
    const lastPlay = demoGames(R0 + MIN + 9 * MIN + 2 * 40_000 - 1)[0]!
    const final = demoGames(R0 + MIN + 9 * MIN + 2 * 40_000)[0]!
    expect(final.state).toBe('final')
    expect(final.away.score + final.home.score).toBeGreaterThanOrEqual(lastPlay.away.score + lastPlay.home.score)
    expect(final.away.score + final.home.score - (lastPlay.away.score + lastPlay.home.score)).toBeLessThanOrEqual(1)
  })

  test('a game of points scores far more than a game of goals', () => {
    const goals = demoGames(R0 + 14 * MIN)[0]!
    const points = demoGames(R0 + 7 * MIN + 14 * MIN)[1]!
    expect(points.away.score + points.home.score).toBeGreaterThan(5 * (goals.away.score + goals.home.score + 1))
  })
})

describe('following and order', () => {
  test('the teams setting: trimmed, lower case, no repeats, no empties, twenty at most', () => {
    expect(parseTeams(' HBR, harbour ,,Ridgeline, hbr ')).toEqual(['hbr', 'harbour', 'ridgeline'])
    expect(parseTeams('')).toEqual([])
    expect(parseTeams(undefined)).toEqual([])
    expect(parseTeams(Array.from({ length: 30 }, (_, i) => `t${i}`).join(','))).toHaveLength(20)
  })

  test('a game is followed by a short code, a whole name or one word of a name; no teams follows every game', () => {
    const g = game()
    expect(follows(g, [])).toBe(true)
    expect(follows(g, ['rdg'])).toBe(true)
    expect(follows(g, ['harbour gulls'])).toBe(true)
    expect(follows(g, ['gulls'])).toBe(true)
    expect(follows(g, ['gull'])).toBe(false)
    expect(follows(g, ['summit'])).toBe(false)
  })

  test('live first, then those to come, then the finished, the feed order kept within each, four at most', () => {
    const all = [
      game({ id: 'f1', state: 'final' }),
      game({ id: 'p1', state: 'pre' }),
      game({ id: 'l1' }),
      game({ id: 'f2', state: 'final' }),
      game({ id: 'l2' }),
      game({ id: 'p2', state: 'pre' }),
    ]
    expect(shownOf(all, []).map(g => g.id)).toEqual(['l1', 'l2', 'p1', 'p2'])
    expect(shownOf(all, ['nobody'])).toEqual([])
  })
})

describe('toasts', () => {
  test('a goal names the side that scored and the score, away first; both at once say so; a game seen first says nothing', () => {
    const before = [game({ away: { name: 'Ridgeline', short: 'RDG', score: 1 }, home: { name: 'Harbour', short: 'HBR', score: 1 } })]
    expect(alertsOf([], before)).toEqual([])
    expect(alertsOf(before, [game({ away: { name: 'Ridgeline', short: 'RDG', score: 1 }, home: { name: 'Harbour', short: 'HBR', score: 2 } })])).toEqual(['HBR scores: RDG 1, HBR 2'])
    expect(alertsOf(before, [game({ away: { name: 'Ridgeline', short: 'RDG', score: 2 }, home: { name: 'Harbour', short: 'HBR', score: 2 } })])).toEqual(['RDG and HBR score: RDG 2, HBR 2'])
    expect(alertsOf(before, before)).toEqual([])
  })

  test('points say nothing until the end; the end is said once, a last goal before it', () => {
    const was = game({ kind: 'points', away: { name: 'L', short: 'LKS', score: 40 }, home: { name: 'F', short: 'FDY', score: 38 } })
    const more = game({ kind: 'points', away: { name: 'L', short: 'LKS', score: 42 }, home: { name: 'F', short: 'FDY', score: 38 } })
    expect(alertsOf([was], [more])).toEqual([])
    const ended = { ...more, state: 'final' as const, status: 'final' }
    expect(alertsOf([more], [ended])).toEqual(['Final: LKS 42, FDY 38'])
    expect(alertsOf([ended], [ended])).toEqual([])
    const goal = game({ away: { name: 'R', short: 'RDG', score: 2 }, home: { name: 'H', short: 'HBR', score: 1 } })
    const late = { ...goal, home: { ...goal.home, score: 2 }, state: 'final' as const, status: 'final' }
    expect(alertsOf([goal], [late])).toEqual(['HBR scores: RDG 2, HBR 2', 'Final: RDG 2, HBR 2'])
  })
})

describe('waits', () => {
  test('the refresh while a game is on or the feed costs nothing; else until the next start, fifteen minutes at most, the refresh at least', () => {
    const now = 1_000_000
    expect(waitOf([game()], 30, now, false)).toBe(30_000)
    expect(waitOf([game({ state: 'final' })], 30, now, true)).toBe(30_000)
    expect(waitOf([game({ state: 'final' })], 30, now, false)).toBe(IDLE_MS)
    expect(waitOf([], 30, now, false)).toBe(IDLE_MS)
    expect(waitOf([game({ state: 'pre', startsAt: now + 5 * MIN })], 30, now, false)).toBe(5 * MIN)
    expect(waitOf([game({ state: 'pre', startsAt: now + 5000 })], 30, now, false)).toBe(30_000)
    expect(waitOf([game({ state: 'pre', startsAt: now + 60 * MIN })], 30, now, false)).toBe(IDLE_MS)
  })

  test('after a failure the wait doubles, five minutes at most', () => {
    expect(backoff(30_000)).toBe(60_000)
    expect(backoff(200_000)).toBe(300_000)
    expect(backoff(300_000)).toBe(300_000)
    expect(backoff(0)).toBe(2000)
  })

  test('the refresh setting: whole seconds from ten to three hundred, thirty when unset', () => {
    expect(clampRefresh(undefined)).toBe(30)
    expect(clampRefresh(3)).toBe(10)
    expect(clampRefresh(12.4)).toBe(12)
    expect(clampRefresh(9999)).toBe(300)
    expect(clampRefresh('20')).toBe(30)
  })
})

describe('words', () => {
  test('a card caption, a band line and who leads', () => {
    expect(captionOf(game({ status: 'P2 12:41' }))).toBe('LIVE  P2 12:41')
    expect(captionOf(game({ status: 'end of P1' }))).toBe('LIVE  END OF P1')
    expect(captionOf(game({ state: 'final', status: 'final' }))).toBe('FINAL')
    expect(captionOf(game({ state: 'pre', status: 'starts in 1 min' }))).toBe('STARTS IN 1 MIN')
    const g = game({ status: 'P2 12:41', away: { name: 'R', short: 'RDG', score: 1 }, home: { name: 'H', short: 'HBR', score: 2 } })
    expect(lineOf(g)).toBe('RDG 1 HBR 2 P2 12:41')
    expect(lineOf(game({ state: 'pre', status: 'starts in 1 min' }))).toBe('RDG at HBR starts in 1 min')
    expect(leaderOf(g)).toBe('home')
    expect(leaderOf(game())).toBe(null)
    expect(leaderOf(game({ state: 'pre', away: { name: 'R', short: 'RDG', score: 1 } }))).toBe(null)
    expect(sameGames([g], [{ ...g }])).toBe(true)
    expect(sameGames([g], [{ ...g, status: 'P2 12:40' }])).toBe(false)
  })
})
