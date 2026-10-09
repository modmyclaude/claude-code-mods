// merge: a 4x4 board of lettered tiers. Slide everything one way; two equal
// tiers that meet become the next letter, once per tile per move. A new A
// (sometimes a B) lands after every move that changed the board.

import type { HalftimeMerge } from '../../types'
import { rand, randInt } from '../rng'
import { BOLD, frame, type Cell, type Drawn, type Game } from './kit'

export const SIZE = 4

export type Direction = 'left' | 'right' | 'up' | 'down'

/** Points for making a tier: each tier is worth twice the one below it. */
export const pointsFor = (tier: number) => 2 ** tier

/**
 * Slides one line toward its start. Each tile merges at most once per move,
 * so [A A A A] makes [B B], never [C].
 */
export function slideLine(line: readonly number[]): { line: number[]; gained: number } {
  const tiles = line.filter(v => v > 0)
  const out: number[] = []
  let gained = 0
  for (let i = 0; i < tiles.length; i += 1) {
    const here = tiles[i]!
    if (tiles[i + 1] === here) {
      out.push(here + 1)
      gained += pointsFor(here + 1)
      i += 1
    } else out.push(here)
  }
  while (out.length < line.length) out.push(0)
  return { line: out, gained }
}

/** The cell indices of each line, ordered toward where the tiles slide. */
function lines(dir: Direction): number[][] {
  const out: number[][] = []
  for (let a = 0; a < SIZE; a += 1) {
    const line: number[] = []
    for (let b = 0; b < SIZE; b += 1) {
      if (dir === 'left') line.push(a * SIZE + b)
      if (dir === 'right') line.push(a * SIZE + (SIZE - 1 - b))
      if (dir === 'up') line.push(b * SIZE + a)
      if (dir === 'down') line.push((SIZE - 1 - b) * SIZE + a)
    }
    out.push(line)
  }
  return out
}

/** Slides the whole board; `moved` says whether anything changed. */
export function slide(cells: readonly number[], dir: Direction): { cells: number[]; gained: number; moved: boolean } {
  const next = [...cells]
  let gained = 0
  for (const idx of lines(dir)) {
    const result = slideLine(idx.map(i => cells[i] ?? 0))
    gained += result.gained
    idx.forEach((cell, k) => (next[cell] = result.line[k] ?? 0))
  }
  return { cells: next, gained, moved: next.some((v, i) => v !== cells[i]) }
}

export function canMove(cells: readonly number[]): boolean {
  return (['left', 'right', 'up', 'down'] as const).some(dir => slide(cells, dir).moved)
}

/** A new tile on an empty cell: tier 1, or tier 2 one time in eight. */
export function spawn(cells: readonly number[], rng: number): { cells: number[]; rng: number } {
  const empty = cells.flatMap((v, i) => (v === 0 ? [i] : []))
  if (empty.length === 0) return { cells: [...cells], rng }
  const [pick, r1] = randInt(rng, empty.length)
  const [roll, r2] = rand(r1)
  const next = [...cells]
  next[empty[pick]!] = roll < 0.125 ? 2 : 1
  return { cells: next, rng: r2 }
}

export function initMerge(seed: number): HalftimeMerge {
  const first = spawn(new Array<number>(SIZE * SIZE).fill(0), seed >>> 0)
  const second = spawn(first.cells, first.rng)
  return { cells: second.cells, rng: second.rng, points: 0, moves: 0, over: false }
}

export function moveMerge(s: HalftimeMerge, dir: Direction): HalftimeMerge {
  if (s.over) return s
  const slid = slide(s.cells, dir)
  if (!slid.moved) return s
  const placed = spawn(slid.cells, s.rng)
  return { cells: placed.cells, rng: placed.rng, points: s.points + slid.gained, moves: s.moves + 1, over: !canMove(placed.cells) }
}

/** Tier colors: a background each, with dark letters, readable on light and dark themes. */
const TIER_BG = ['#6c8ebf', '#4fa3a5', '#62b37a', '#a9b84f', '#d9b44a', '#e39552', '#e0705e', '#d0607f', '#ad6fc4', '#7f78d1', '#5a86d6', '#c9ccd1']

export const tierLabel = (tier: number) => (tier <= 26 ? String.fromCharCode(64 + tier) : '+')

/** An empty place on the board: a dark well, so the 4x4 grid reads even before it fills. */
export const WELL = '#2c313a'

export function drawMerge(s: HalftimeMerge, cols: number): Drawn {
  // Odd widths, so a letter sits dead center; the two side rails take two columns of the band.
  const tw = Math.floor((cols - 2 - (SIZE - 1)) / SIZE) >= 5 ? 5 : 3
  const field: Cell[][] = []
  for (let r = 0; r < SIZE; r += 1) {
    const cells: Cell[] = []
    for (let c = 0; c < SIZE; c += 1) {
      const tier = s.cells[r * SIZE + c] ?? 0
      const mid = (tw - 1) / 2
      if (tier > 0) {
        cells.push([' '.repeat(mid) + tierLabel(tier) + ' '.repeat(mid), '#111418', TIER_BG[(tier - 1) % TIER_BG.length], BOLD])
      } else cells.push([' '.repeat(tw), undefined, WELL])
      if (c < SIZE - 1) cells.push([' '])
    }
    field.push(cells)
  }
  return { rows: frame(field, SIZE * tw + (SIZE - 1), cols).rows }
}

const go = (dir: Direction) => `move:${dir}`

export const merge: Game<HalftimeMerge> = {
  id: 'merge',
  title: 'merge',
  realtime: false,
  rows: SIZE,
  tickMs: 0,
  better: 'higher',
  controls: {
    up: go('up'), down: go('down'), left: go('left'), right: go('right'),
    w: go('up'), s: go('down'), a: go('left'), d: go('right'),
    k: go('up'), j: go('down'), h: go('left'), l: go('right'),
  },
  hint: 'arrows or wasd: slide  ·  two equal letters make the next  ·  esc: keys back',
  init: initMerge,
  act: (s, action) => (action.startsWith('move:') ? moveMerge(s, action.slice(5) as Direction) : s),
  isOver: s => s.over,
  score: s => s.points,
  draw: (s, cols) => drawMerge(s, cols),
}
