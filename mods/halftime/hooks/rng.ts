// Seeded randomness and the daily seed. Game logic never calls Math.random:
// every draw goes through `rand`, whose state is a plain number kept in the
// game state, so a run is a pure function of its seed and its inputs.

import type { HalftimeGameId } from '../types'

/** One mulberry32 step: a float in [0, 1) and the next state. */
export function rand(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) >>> 0
  let t = next
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next]
}

/** A whole number in [0, n) and the next state. */
export function randInt(state: number, n: number): [number, number] {
  const [f, next] = rand(state)
  return [Math.min(n - 1, Math.floor(f * n)), next]
}

/** FNV-1a, 32 bit: a stable hash of a string. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The calendar day of a time, `YYYY-MM-DD`, in the machine's own time zone. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The same seed for everyone on the same day: it depends on nothing but the day and the game. */
export function dailySeed(game: HalftimeGameId, day: string): number {
  return fnv1a(`halftime/${game}/${day}`)
}

/** A practice seed: from the time and a counter, so two runs in one millisecond still differ. */
export function practiceSeed(game: HalftimeGameId, now: number, n: number): number {
  return fnv1a(`halftime/${game}/practice/${now}/${n}`)
}
