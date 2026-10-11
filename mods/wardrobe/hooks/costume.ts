// Bolt in costume: a hat, glasses or a cape drawn OVER the brand sprite
// (bolt.ts) before its pixels are packed into cells, never a change to a pixel
// of Bolt's own. Each theme has one costume, in at most three colours taken
// from the theme's own palette, so the costume matches what is worn.
//
// Rules (brand/BRAND.md, brand/bolt-sprites/README.md), held by costume.test.ts:
// the antenna light and the stem under it stay uncovered, so every hat has a
// notch around them; the pink and the blush are Bolt's alone, never a costume's.

import { BOLT_PALETTE, BOLT_SPRITES, boltCells } from './bolt'
import type { BoltCell, BoltPose, BoltSize, BoltSmallPose, BoltTinyPose } from './bolt'
import type { Role, Theme } from './themes'

/** One costume pixel: where on the sprite, and which letter of the costume's paint. */
export type Stitch = { row: number; col: number; key: string }

/** A costume's paint: each letter names a colour of the theme's palette, or its background. */
export type Paint = Record<string, Role | 'bg'>

export type Costume = {
  /** What it is, for the gallery and the docs. */
  name: string
  paint: Paint
  small: readonly Stitch[]
  tiny: readonly Stitch[]
}

/** The pixels of the antenna (the light, and the stem under it) no costume covers. */
export const ANTENNA: Record<BoltSize, readonly (readonly [number, number])[]> = {
  small: [
    [0, 4],
    [0, 5],
    [1, 4],
    [1, 5],
  ],
  tiny: [[0, 1]],
}

/** A costume uses this many colours at most. */
export const MAX_COLOURS = 3

/** Bolt's own pink and blush, never a costume colour. */
export const BOLT_ONLY = [BOLT_PALETTE.O, BOLT_PALETTE.K] as const

const at = (key: string, ...cells: readonly (readonly [number, number])[]): Stitch[] => cells.map(([row, col]) => ({ row, col, key }))
const run = (key: string, row: number, from: number, to: number): Stitch[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ row, col: from + i, key }))

// The small sprite (idle), for reading the stitches below:
//   row 0  ....OO....   the light (cols 4-5)
//   row 1  ....SS....   the stem
//   row 2  ..BBBBBB..   the top of the head
//   row 3  .BBBBBBBB.
//   row 4  BBWEBBWEBB   the eyes (cols 2-3 and 6-7)
//   row 5  BBEEBBEEBB
//   row 6  BKKBBBBKKB   the cheeks
//   row 7  BBBBEEBBBB   the mouth (cols 4-5)
//   row 8  .SSSSSSSS.
//   row 9  ..SS..SS..   the feet
// The tiny sprite: `.O.` / `BEB` / `BBB` / `S.S`.

/** One costume per theme id; a theme with none wears Bolt plain. */
export const COSTUMES: Record<string, Costume> = {
  noir: {
    name: 'fedora',
    paint: { C: 'muted', B: 'text' },
    small: [...at('C', [0, 2], [0, 3], [0, 6], [0, 7]), ...at('C', [1, 2], [1, 3], [1, 6], [1, 7]), ...run('B', 2, 0, 9)],
    tiny: at('B', [0, 0], [0, 2]),
  },
  paper: {
    name: 'reading glasses',
    paint: { F: 'accent' },
    small: at('F', [4, 1], [4, 4], [4, 5], [4, 8]),
    tiny: at('F', [1, 0], [1, 2]),
  },
  'tokyo-night': {
    name: 'headband',
    paint: { H: 'accent', T: 'info' },
    small: [...run('H', 2, 2, 7), ...at('T', [2, 1], [2, 8])],
    tiny: at('H', [0, 0], [0, 2]),
  },
  dracula: {
    name: 'cape and fangs',
    paint: { C: 'accent', R: 'error', W: 'text' },
    small: [
      ...at('C', [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0]),
      ...at('C', [3, 9], [4, 9], [5, 9], [6, 9], [7, 9], [8, 9]),
      ...at('R', [2, 1], [2, 8]),
      ...at('W', [8, 4], [8, 5]),
    ],
    tiny: at('C', [2, 0], [2, 2]),
  },
  catppuccin: {
    name: 'cat ears',
    paint: { E: 'accent', I: 'warn' },
    small: [...at('E', [0, 1], [0, 8], [1, 1], [1, 8]), ...at('I', [1, 2], [1, 7])],
    tiny: at('E', [0, 0], [0, 2]),
  },
  solarized: {
    name: 'sun visor',
    paint: { V: 'warn', B: 'accent' },
    small: [...at('B', [1, 2], [1, 3], [1, 6], [1, 7]), ...run('V', 2, 0, 9)],
    tiny: at('V', [0, 0], [0, 2]),
  },
  nord: {
    name: 'beanie with a pom',
    paint: { P: 'text', K: 'accent', F: 'info' },
    small: [...at('P', [0, 2]), ...at('K', [0, 3], [0, 6], [0, 7]), ...at('K', [1, 1], [1, 2], [1, 3], [1, 6], [1, 7], [1, 8]), ...run('F', 2, 1, 8)],
    tiny: at('K', [0, 0], [0, 2]),
  },
  'high-contrast': {
    name: 'bow tie',
    paint: { Y: 'accent', K: 'text' },
    small: [...at('Y', [8, 2], [8, 3], [8, 6], [8, 7]), ...at('K', [8, 4], [8, 5])],
    tiny: at('Y', [2, 0], [2, 2]),
  },
  colorblind: {
    name: 'none',
    paint: {},
    small: [],
    tiny: [],
  },
  halloween: {
    name: 'witch hat',
    paint: { V: 'info', B: 'accent' },
    small: [...at('V', [0, 3], [0, 6]), ...at('B', [1, 2], [1, 3], [1, 6], [1, 7]), ...run('V', 2, 1, 8)],
    tiny: at('V', [0, 0], [0, 2]),
  },
  christmas: {
    name: 'santa hat',
    paint: { R: 'error', W: 'text' },
    small: [...at('W', [0, 2]), ...at('R', [0, 3], [0, 6], [0, 7]), ...at('R', [1, 1], [1, 2], [1, 3], [1, 6], [1, 7], [1, 8]), ...run('W', 2, 1, 8)],
    tiny: at('R', [0, 0]).concat(at('W', [0, 2])),
  },
  spring: {
    name: 'flower crown',
    paint: { P: 'special', G: 'ok' },
    small: [...at('P', [2, 1], [2, 3], [2, 5], [2, 7]), ...at('G', [2, 2], [2, 4], [2, 6], [2, 8])],
    tiny: at('P', [0, 0], [0, 2]),
  },
  summer: {
    name: 'sunglasses',
    paint: { D: 'bg', F: 'accent' },
    small: [...run('D', 4, 1, 3), ...run('D', 4, 6, 8), ...run('D', 5, 1, 3), ...run('D', 5, 6, 8), ...at('F', [4, 4], [4, 5])],
    tiny: at('F', [0, 0], [0, 2]),
  },
  autumn: {
    name: 'beanie',
    paint: { A: 'accent', R: 'warn' },
    small: [...at('A', [0, 2], [0, 3], [0, 6], [0, 7]), ...at('A', [1, 1], [1, 2], [1, 3], [1, 6], [1, 7], [1, 8]), ...run('R', 2, 1, 8)],
    tiny: at('A', [0, 0], [0, 2]),
  },
}

/** The costume a theme wears, or undefined (Bolt plain). */
export function costumeOf(theme: Pick<Theme, 'id'>): Costume | undefined {
  return COSTUMES[theme.id]
}

/** Whether a sprite pixel is the antenna: the light anywhere, the stem in the top two rows. */
function isAntenna(letter: string, row: number): boolean {
  return letter === 'O' || (letter === 'S' && row <= 1)
}

/** The colour a costume letter paints, out of the theme's palette. */
export function paintOf(theme: Theme, costume: Costume, key: string): string | undefined {
  const role = costume.paint[key]
  if (role === undefined) return undefined
  return role === 'bg' ? theme.palette.bg : theme.palette[role]
}

/** Two pixel colours as one half-block cell (bolt.ts packs the sprite the same way). */
function pack(top: string | undefined, bottom: string | undefined): BoltCell {
  if (top === undefined && bottom === undefined) return { ch: ' ' }
  if (bottom === undefined) return { ch: '▀', fg: top }
  if (top === undefined) return { ch: '▄', fg: bottom }
  if (top === bottom) return { ch: '█', fg: top }
  return { ch: '▀', fg: top, bg: bottom }
}

/**
 * The pixel rows of a pose with the theme's costume over them: each row a list
 * of colours (undefined where empty). A stitch lands only inside the sprite and
 * never on the antenna, whatever the pose puts there.
 */
export function dressedPixels(theme: Theme, size: BoltSize, pose: BoltPose): { grid: (string | undefined)[][]; touched: Set<string> } {
  const rows: readonly string[] = (BOLT_SPRITES[size] as Record<string, readonly string[]>)[pose] ?? []
  const palette = BOLT_PALETTE as Record<string, string>
  const grid = rows.map(row => [...row].map(letter => (letter === '.' ? undefined : palette[letter])))
  const touched = new Set<string>()
  const costume = costumeOf(theme)
  if (!costume) return { grid, touched }
  for (const stitch of costume[size]) {
    const line = grid[stitch.row]
    const letter = rows[stitch.row]?.[stitch.col]
    if (line === undefined || letter === undefined || isAntenna(letter, stitch.row)) continue
    const colour = paintOf(theme, costume, stitch.key)
    if (colour === undefined) continue
    line[stitch.col] = colour
    touched.add(`${stitch.row}/${stitch.col}`)
  }
  return { grid, touched }
}

/** The half-block cells; any other character is a glyph bolt.ts drew over the sprite (a sleeping z), which a costume never covers. */
const BLOCKS = new Set([' ', '\u2580', '\u2584', '\u2588'])

/**
 * Bolt dressed for the theme, as cells for bolt-draw. Only the cells a stitch
 * touched are packed afresh; every other cell is the sprite's own, and so is
 * any glyph bolt.ts draws over a cell, whatever a stitch did beneath it.
 */
export function wearBolt(theme: Theme, size: 'small', pose: BoltSmallPose): BoltCell[][]
export function wearBolt(theme: Theme, size: 'tiny', pose: BoltTinyPose): BoltCell[][]
export function wearBolt(theme: Theme, size: BoltSize, pose: BoltPose): BoltCell[][]
export function wearBolt(theme: Theme, size: BoltSize, pose: BoltPose): BoltCell[][] {
  const base = size === 'small' ? boltCells('small', pose as BoltSmallPose) : boltCells('tiny', pose as BoltTinyPose)
  const { grid, touched } = dressedPixels(theme, size, pose)
  if (touched.size === 0) return base
  const hit = (r: number, c: number) => touched.has(`${2 * r}/${c}`) || touched.has(`${2 * r + 1}/${c}`)
  return base.map((line, r) => line.map((cell, c) => (hit(r, c) && BLOCKS.has(cell.ch) ? pack(grid[2 * r]?.[c], grid[2 * r + 1]?.[c]) : cell)))
}
