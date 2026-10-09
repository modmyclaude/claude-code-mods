// cratehop: a one-button runner. The courier runs right on its own; one key
// jumps the crates. The course is laid out by distance from the seed alone,
// so everyone's daily course is the same; speed rises with distance.
//
// Fair by construction (MM-089), in four rules the tests hold it to:
//  1. Gentle start: the first 10 s (100 cells) run at the start speed, the
//     first crate is 4.5 s out, and the gaps around the early crates are wide.
//  2. A slow ramp with a cap: 0.18 cells/s of speed gained per second, from
//     10 up to 24 cells/s, about 80 s after the gentle start.
//  3. Every gap is at least one full jump plus a 250 ms reaction margin at the
//     speed the runner has where the next crate stands (`minGap`).
//  4. Every crate can be cleared with a timing window of 250 ms or more, at
//     any speed up to the cap (`clearWindowMs`).
// Forgiveness: the hit boxes are smaller than the drawn art, a jump pressed up
// to 120 ms before landing fires on touchdown, and a click anywhere on the
// board jumps.

import type { HalftimeCratehop } from '../../types'
import { rand } from '../rng'
import { BOLD, DIM, clamp, frame, type Cell, type Drawn, type Game } from './kit'

export const CRATEHOP = {
  /** The runner's screen column. */
  col: 6,
  /** Start speed, cells/s: the courier covers the first 10 s here. */
  v0: 10,
  /** Cells held at the start speed (10 s of it) before the ramp begins. */
  gentle: 100,
  /** Twice the acceleration per cell: v(x) = sqrt(v0^2 + accel2 * (x - gentle)), i.e. +0.18 cells/s every second. */
  accel2: 0.36,
  /** The speed cap, cells/s: the fastest that still leaves 250 ms to see and answer a crate on a 24-column band (`reactionMs`); the hardest crate's timing window at this speed is 370 ms. */
  vmax: 24,
  /** Take-off speed (cells/s up) and gravity: a jump peaks at 2.58 cells, lasts 0.74 s, and clears a 2-high crate. */
  jump: 14,
  gravity: 38,
  lookahead: 110,
  /** Crate-free cells at the start: 4.5 s at the start speed. */
  runUp: 45,
  /** The longest stretch of time one tick may advance (a stalled frame never teleports). */
  maxDtMs: 250,
  subStepMs: 8,
  rows: 5,
  /** The reaction time every gap leaves the player, and the timing window every crate must offer, ms. */
  reactMs: 250,
  /** A jump pressed this close (ms) to touchdown is kept and fires on landing. */
  bufferMs: 120,
  /** Hit boxes. The courier is 0.4 wide, centered on its x; a crate is its drawn width less `inset` at each end; its top is `clearance` below the drawn top. */
  halfFoot: 0.2,
  inset: 0.35,
  clearance: 0.35,
  /** Early gaps are widened by up to 80% of a second of ground, fading to nothing by this distance. */
  calmUntil: 400,
  calmSecs: 0.8,
} as const

/** Speed at a distance: flat for the gentle start, then a slow ramp, then the cap. */
export function speedAt(x: number): number {
  const run = Math.max(0, x - CRATEHOP.gentle)
  return Math.min(CRATEHOP.vmax, Math.sqrt(CRATEHOP.v0 * CRATEHOP.v0 + CRATEHOP.accel2 * run))
}

/** How far one jump carries at a speed. */
export function airDistance(v: number): number {
  return (v * 2 * CRATEHOP.jump) / CRATEHOP.gravity
}

/**
 * The least clear ground after a crate, given the speed reached at the next
 * one: one full jump, plus the ground covered in the reaction time. A player
 * who jumps the first crate on time lands at least 250 ms before the second
 * crate's take-off point.
 */
export function minGap(v: number): number {
  return Math.ceil(airDistance(v) + (v * CRATEHOP.reactMs) / 1000)
}

/**
 * How many milliseconds wide the window of take-off moments is that clear a
 * crate `w` wide and `h` high at speed `v`: the time the courier spends above
 * the crate's top in one jump, less the time it takes to cross the crate.
 */
export function clearWindowMs(v: number, w: number, h: number): number {
  const need = h - CRATEHOP.clearance
  const disc = CRATEHOP.jump * CRATEHOP.jump - 2 * CRATEHOP.gravity * need
  if (disc <= 0) return 0
  const above = (2 * Math.sqrt(disc)) / CRATEHOP.gravity
  const across = (w - 2 * CRATEHOP.inset + 2 * CRATEHOP.halfFoot) / v
  return Math.max(0, (above - across) * 1000)
}

/**
 * How many milliseconds a player has to see and answer a crate: from its near
 * edge coming on screen, on a field `width` cells wide (the courier stands in
 * column `col`), to the moment the courier passes its ideal take-off point.
 * At the speed cap this is 250 ms or more on any field from 22 cells (a
 * 24-column band) up; narrower than that, the cap outruns the sight line.
 */
export function reactionMs(v: number, width: number): number {
  const sight = width - CRATEHOP.col - 1
  return ((sight - airDistance(v) / 2) / v) * 1000
}

/** Seconds until a courier at height y, moving at vy, touches down. */
export function timeToLand(y: number, vy: number): number {
  if (y <= 0 && vy <= 0) return 0
  return (vy + Math.sqrt(vy * vy + 2 * CRATEHOP.gravity * Math.max(0, y))) / CRATEHOP.gravity
}

/**
 * The ground after a crate whose far edge is at `from`: never below `minGap`
 * for the speed where the next crate will stand, widened early on (`calm`) and
 * by a random stretch. Bounded: if the speed shifts as the gap is settled, the
 * gap is raised to match; it never settles lower than the rule.
 */
function gapAfter(from: number, roll: number): number {
  const v = speedAt(from)
  const calm = Math.max(0, 1 - from / CRATEHOP.calmUntil)
  let gap = minGap(v) + Math.round(v * CRATEHOP.calmSecs * calm) + Math.floor(roll * Math.ceil(v * 0.6))
  for (let i = 0; i < 4; i += 1) {
    const need = minGap(speedAt(from + gap))
    if (gap >= need) return gap
    gap = need
  }
  return minGap(CRATEHOP.vmax)
}

/** Tall crates (two high) are rare at first and never more than three in ten. */
const tallChance = (x: number) => clamp((x - 150) / 5000, 0, 0.3)

/** How wide a low crate can be: one cell at first, then two, then three. */
const widthCap = (x: number) => (x < 100 ? 1 : x < 300 ? 2 : 3)

/** Lays out crates until the course reaches `until`; depends on the seed and distance only. */
export function layout(s: HalftimeCratehop, until: number): HalftimeCratehop {
  let { rng, nextX } = s
  const obs = [...s.obs]
  while (nextX < until) {
    let r1: number
    let r2: number
    let r3: number
    ;[r1, rng] = rand(rng)
    ;[r2, rng] = rand(rng)
    ;[r3, rng] = rand(rng)
    const tall = r1 < tallChance(nextX)
    const w = tall ? (nextX > 600 && r2 < 0.4 ? 2 : 1) : 1 + Math.floor(r2 * widthCap(nextX))
    obs.push([nextX, w, tall ? 2 : 1])
    nextX += w + gapAfter(nextX + w, r3)
  }
  return { ...s, rng, nextX, obs }
}

export function initCratehop(seed: number): HalftimeCratehop {
  return layout({ rng: seed >>> 0, x: 0, y: 0, vy: 0, obs: [], nextX: CRATEHOP.runUp, dead: false, buffered: false }, CRATEHOP.lookahead)
}

/**
 * Whether the courier, its feet at height y, hits a crate at distance x. The
 * boxes are smaller than the art: the courier's is a 0.4-wide slice centered
 * on x (the courier is drawn in cell floor(x)), the crate's is its drawn width
 * less 0.35 at each end, and its top counts 0.35 lower - the point at which the
 * courier is drawn one row up. A graze is not a hit.
 */
export function hits(obs: readonly [number, number, number][], x: number, y: number): boolean {
  for (const [ox, w, h] of obs) {
    if (x + CRATEHOP.halfFoot > ox + CRATEHOP.inset && x - CRATEHOP.halfFoot < ox + w - CRATEHOP.inset && y < h - CRATEHOP.clearance) return true
  }
  return false
}

export function jumpCratehop(s: HalftimeCratehop): HalftimeCratehop {
  if (s.dead) return s
  if (s.y === 0 && s.vy === 0) return { ...s, vy: CRATEHOP.jump }
  // Pressed in the last 120 ms before touchdown: kept, and taken on landing.
  if (timeToLand(s.y, s.vy) * 1000 <= CRATEHOP.bufferMs) return { ...s, buffered: true }
  return s
}

/** Advances real time: small fixed sub-steps, so the outcome barely depends on the frame rate. */
export function stepCratehop(s: HalftimeCratehop, dtMs: number): HalftimeCratehop {
  if (s.dead) return s
  let { x, y, vy, buffered } = s
  let dead = false
  let left = clamp(dtMs, 0, CRATEHOP.maxDtMs)
  while (left > 0 && !dead) {
    const h = Math.min(left, CRATEHOP.subStepMs)
    left -= h
    const sec = h / 1000
    x += speedAt(x) * sec
    if (y > 0 || vy > 0) {
      vy -= CRATEHOP.gravity * sec
      y += vy * sec
      if (y <= 0) {
        y = 0
        vy = 0
        if (buffered) {
          vy = CRATEHOP.jump
          buffered = false
        }
      }
    }
    dead = hits(s.obs, x, y)
  }
  const kept = s.obs.filter(([ox, w]) => ox + w > x - CRATEHOP.col - 2)
  return layout({ ...s, x, y, vy, buffered, dead, obs: kept }, x + CRATEHOP.lookahead)
}

export function drawCratehop(s: HalftimeCratehop, cols: number): Drawn {
  const width = clamp(cols - 2, 14, 70)
  const cam = Math.floor(s.x) - CRATEHOP.col
  const feet = 3 - clamp(Math.floor(s.y + 0.35), 0, 3)
  // The courier is two cells tall, a head over a body; its legs swap every couple of cells run.
  const body = s.y > 0 ? '█' : Math.floor(s.x / 2) % 2 === 0 ? '▟' : '▙'
  const field: Cell[][] = []
  for (let row = 0; row < CRATEHOP.rows; row += 1) {
    const cells: Cell[] = []
    for (let c = 0; c < width; c += 1) {
      const wc = cam + c
      if (row === 4) {
        // The track: a solid floor, with a brighter mark every eight cells so the ground is seen to move.
        cells.push(wc % 8 === 0 ? ['▀', 'text', undefined, DIM] : ['▀', 'subtle'])
        continue
      }
      if (s.dead && row === feet && Math.abs(c - CRATEHOP.col) <= 1) {
        cells.push([['\\', '✶', '/'][c - CRATEHOP.col + 1]!, 'error', undefined, BOLD])
        continue
      }
      if (!s.dead && c === CRATEHOP.col && (row === feet || row === feet - 1)) {
        cells.push(row === feet ? [body, 'suggestion', undefined, BOLD] : ['▄', 'suggestion', undefined, BOLD])
        continue
      }
      const crate = s.obs.find(([ox, w]) => wc >= ox && wc < ox + w)
      cells.push(crate && (row === 3 || (row === 2 && crate[2] === 2)) ? ['█', 'warning'] : [' '])
    }
    field.push(cells)
  }
  return { rows: frame(field, width, cols).rows }
}

export const cratehop: Game<HalftimeCratehop> = {
  id: 'cratehop',
  title: 'cratehop',
  realtime: true,
  rows: CRATEHOP.rows,
  tickMs: 60,
  better: 'higher',
  controls: { space: 'jump', up: 'jump', w: 'jump', k: 'jump' },
  hint: 'space or up: jump  ·  p: pause  ·  esc: keys back to the prompt',
  init: initCratehop,
  act: (s, action) => (action === 'jump' ? jumpCratehop(s) : s),
  step: stepCratehop,
  click: s => jumpCratehop(s),
  isOver: s => s.dead,
  score: s => Math.floor(s.x),
  draw: (s, cols) => drawCratehop(s, cols),
}
