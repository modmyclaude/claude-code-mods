// Personal bests, daily scores and totals in the mod's own store, which every
// open session shares. A store write is last-write-wins, so a best is
// compare-and-set by hand: re-read right before writing, never write over a
// better stored score, and read back after writing to repair a race.

import type { HalftimeGameId, HalftimeStats } from '../types'
import { GAME_IDS, beats, isGameId } from './games'

export type Store = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

type Daily = { day: string; score: number }
const daily = (v: unknown): Daily | undefined => {
  if (typeof v !== 'object' || v === null) return undefined
  const d = v as Record<string, unknown>
  const score = num(d.score)
  return typeof d.day === 'string' && score !== undefined ? { day: d.day, score } : undefined
}

export type Totals = { playedMs: number; waitPlayedMs: number; runs: number }
const totals = (v: unknown): Totals => {
  const d = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
  return { playedMs: num(d.playedMs) ?? 0, waitPlayedMs: num(d.waitPlayedMs) ?? 0, runs: num(d.runs) ?? 0 }
}

export async function loadStats(store: Store): Promise<HalftimeStats> {
  const best: HalftimeStats['best'] = {}
  const dailies: HalftimeStats['daily'] = {}
  for (const g of GAME_IDS) {
    const b = num(await store.get(`best:${g}`))
    if (b !== undefined) best[g] = b
    const d = daily(await store.get(`daily:${g}`))
    if (d) dailies[g] = d
  }
  const t = totals(await store.get('totals'))
  const last = await store.get('last')
  return {
    auto: (await store.get('auto')) === true,
    last: isGameId(last) ? last : null,
    best,
    daily: dailies,
    playedMs: t.playedMs,
    waitPlayedMs: t.waitPlayedMs,
    runs: t.runs,
  }
}

/**
 * Saves `score` as the best for `game` unless the store already holds one at
 * least as good. Returns the best as it stands after the save.
 */
export async function saveBest(store: Store, game: HalftimeGameId, score: number): Promise<{ best: number; isBest: boolean }> {
  const key = `best:${game}`
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = num(await store.get(key))
    if (stored !== undefined && !beats(game, score, stored)) return { best: stored, isBest: false }
    await store.set(key, score)
    const after = num(await store.get(key))
    if (after === score) return { best: score, isBest: true }
    // Another session wrote in between: a better score stands, a worse one is written over again.
    if (after !== undefined && beats(game, after, score)) return { best: after, isBest: false }
  }
  return { best: score, isBest: true }
}

/** Today's best for the daily board, the same compare-and-set; another day's entry counts as none. */
export async function saveDaily(store: Store, game: HalftimeGameId, day: string, score: number): Promise<Daily> {
  const key = `daily:${game}`
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = daily(await store.get(key))
    if (stored && stored.day === day && !beats(game, score, stored.score)) return stored
    await store.set(key, { day, score })
    const after = daily(await store.get(key))
    if (after && after.day === day && after.score === score) return after
    if (after && after.day === day && beats(game, after.score, score)) return after
  }
  return { day, score }
}

/** Adds play time and finished runs to the stored totals (re-read, then written at once). */
export async function addTotals(store: Store, owed: readonly [number, number, number]): Promise<Totals> {
  const t = totals(await store.get('totals'))
  const next = { playedMs: t.playedMs + owed[0], waitPlayedMs: t.waitPlayedMs + owed[1], runs: t.runs + owed[2] }
  await store.set('totals', next)
  return next
}
