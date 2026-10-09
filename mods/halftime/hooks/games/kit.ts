// What every game module provides, and the drawing vocabulary the board
// speaks. A game is pure: (state, input) -> state, and state -> rows of text.

import type { HalftimeGameId } from '../../types'

/** One cell (or run) as a game writes it: [text, color, background, flags]; flags 1 bold, 2 dim, 4 inverse. */
export type Cell = [string, string?, string?, number?]

/** A run of same-styled text as the board receives it: every field present ('' and 0 for none), so it crosses as plain data. */
export type Seg = [string, string, string, number]

export const BOLD = 1
export const DIM = 2
export const INVERSE = 4

/**
 * Where the game's field sits inside the drawn rows, so a click can be turned
 * back into a cell: field cell (cx, cy) is drawn at column x + (cx - ox) * cw
 * of row (cy - oy), counting from the first field row.
 */
export type Grid = { x: number; cw: number; ox: number; oy: number; w: number; h: number }

export type Drawn = { rows: Seg[][]; grid?: Grid }

export type Game<S> = {
  id: HalftimeGameId
  title: string
  /** Realtime games tick on the board's frame clock; turn-based ones never tick. */
  realtime: boolean
  /** Field rows the board needs to show the whole field. */
  rows: number
  tickMs: number
  better: 'higher' | 'lower'
  /** Key (as the board reports it) to the game's action name. */
  controls: Readonly<Record<string, string>>
  hint: string
  init: (seed: number) => S
  act: (s: S, action: string) => S
  step?: (s: S, dtMs: number) => S
  click?: (s: S, cx: number, cy: number, button: string) => S
  isOver: (s: S) => boolean
  /** The run's score, or null when it earned none (a lost sweep). */
  score: (s: S, playedMs: number) => number | null
  draw: (s: S, cols: number, rows: number) => Drawn
}

/**
 * Keys no game may ever use: Enter, y, n and the digits answer Claude Code's
 * own prompts, so a stray press meant for a game must never be one of them.
 */
export function isForbiddenKey(key: string): boolean {
  const k = key.toLowerCase()
  return k === 'return' || k === 'enter' || k === '\r' || k === '\n' || k === 'y' || k === 'n' || /^[0-9]$/.test(k)
}

/** The board reports a space as ' ' or 'space' depending on the surface; one name here. */
export function normalizeKey(key: string): string {
  if (key === ' ' || key === 'space') return 'space'
  return key.length === 1 ? key.toLowerCase() : key
}

/** A horizontal window of `size` over `total` cells keeping `focus` in view. */
export function windowStart(total: number, size: number, focus: number): number {
  if (size >= total) return 0
  return Math.max(0, Math.min(total - size, focus - Math.floor(size / 2)))
}

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** Joins neighbouring cells of the same style into one Seg each. */
export function paint(cells: readonly Cell[]): Seg[] {
  const out: Seg[] = []
  for (const [text, fg = '', bg = '', flags = 0] of cells) {
    const last = out[out.length - 1]
    if (last && last[1] === fg && last[2] === bg && last[3] === flags) last[0] += text
    else out.push([text, fg, bg, flags])
  }
  return out
}

/** A small stable integer hash, for decoration that must not touch the game's randomness. */
export function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ Math.imul(b, 0x9e3779b1), 0x85ebca6b)
  h ^= h >>> 13
  return Math.imul(h, 0xc2b2ae35) >>> 0
}
