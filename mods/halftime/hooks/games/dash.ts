// dash: a one-button runner. The courier runs right on its own; one key
// jumps the crates. The course is laid out by distance from the seed alone,
// so everyone's daily course is the same; speed rises with distance.

import type { HalftimeDash } from '../../types'
import { rand } from '../rng'
import { BOLD, DIM, clamp, hash2, paint, type Cell, type Drawn, type Game, type Seg } from './kit'

export const DASH = {
  /** The runner's screen column. */
  col: 6,
  v0: 14,
  /** Twice the acceleration per cell: v(x) = sqrt(v0^2 + accel2 * x). */
  accel2: 0.5,
  vmax: 34,
  jump: 13,
  gravity: 38,
  lookahead: 110,
  /** The longest stretch of time one tick may advance (a stalled frame never teleports). */
  maxDtMs: 250,
  subStepMs: 8,
  rows: 5,
} as const

/** Speed at a distance: rises slowly, then holds. */
export function speedAt(x: number): number {
  return Math.min(DASH.vmax, Math.sqrt(DASH.v0 * DASH.v0 + DASH.accel2 * Math.max(0, x)))
}

/** How far one jump carries at a speed. */
export function airDistance(v: number): number {
  return (v * 2 * DASH.jump) / DASH.gravity
}

/** Lays out crates until the course reaches `until`; depends on the seed and distance only. */
function layout(s: HalftimeDash, until: number): HalftimeDash {
  let { rng, nextX } = s
  const obs = [...s.obs]
  while (nextX < until) {
    let r1: number
    let r2: number
    let r3: number
    ;[r1, rng] = rand(rng)
    ;[r2, rng] = rand(rng)
    ;[r3, rng] = rand(rng)
    const tall = r1 < Math.min(0.45, 0.18 + nextX / 6000)
    const w = tall ? (r2 < 0.4 ? 2 : 1) : 1 + Math.floor(r2 * 3)
    obs.push([nextX, w, tall ? 2 : 1])
    // The gap after a crate always leaves room to land and jump again at the speed reached there.
    nextX += w + Math.ceil(airDistance(speedAt(nextX)) * 0.9) + Math.floor(r3 * 10)
  }
  return { ...s, rng, nextX, obs }
}

export function initDash(seed: number): HalftimeDash {
  return layout({ rng: seed >>> 0, x: 0, y: 0, vy: 0, obs: [], nextX: 40, dead: false, buffered: false }, DASH.lookahead)
}

/** Whether the runner, its feet at height y, overlaps a crate at distance x. */
export function hits(obs: readonly [number, number, number][], x: number, y: number): boolean {
  for (const [ox, w, h] of obs) {
    if (x + 0.9 > ox && x + 0.1 < ox + w && y < h - 0.1) return true
  }
  return false
}

export function jumpDash(s: HalftimeDash): HalftimeDash {
  if (s.dead) return s
  if (s.y === 0 && s.vy === 0) return { ...s, vy: DASH.jump }
  // Pressed while coming down, close to the ground: take it on touchdown.
  if (s.vy < 0 && s.y < 0.8) return { ...s, buffered: true }
  return s
}

/** Advances real time: small fixed sub-steps, so the outcome barely depends on the frame rate. */
export function stepDash(s: HalftimeDash, dtMs: number): HalftimeDash {
  if (s.dead) return s
  let { x, y, vy, buffered } = s
  let dead = false
  let left = clamp(dtMs, 0, DASH.maxDtMs)
  while (left > 0 && !dead) {
    const h = Math.min(left, DASH.subStepMs)
    left -= h
    const sec = h / 1000
    x += speedAt(x) * sec
    if (y > 0 || vy > 0) {
      vy -= DASH.gravity * sec
      y += vy * sec
      if (y <= 0) {
        y = 0
        vy = 0
        if (buffered) {
          vy = DASH.jump
          buffered = false
        }
      }
    }
    dead = hits(s.obs, x, y)
  }
  const kept = s.obs.filter(([ox, w]) => ox + w > x - DASH.col - 2)
  return layout({ ...s, x, y, vy, buffered, dead, obs: kept }, x + DASH.lookahead)
}

export function drawDash(s: HalftimeDash, cols: number): Drawn {
  const width = clamp(cols, 16, 72)
  const cam = Math.floor(s.x) - DASH.col
  const runnerRow = 3 - clamp(Math.floor(s.y + 0.35), 0, 3)
  const rows: Seg[][] = []
  for (let row = 0; row < DASH.rows; row += 1) {
    const cells: Cell[] = []
    for (let c = 0; c < width; c += 1) {
      const wc = cam + c
      if (row === 4) {
        cells.push([wc % 8 === 0 ? '┴' : '─', 'subtle', undefined, DIM])
        continue
      }
      if (c === DASH.col && row === runnerRow) {
        cells.push(s.dead ? ['x', 'error', undefined, BOLD] : [s.y > 0 ? '^' : '@', 'suggestion', undefined, BOLD])
        continue
      }
      const crate = s.obs.find(([ox, w]) => wc >= ox && wc < ox + w)
      if (crate && (row === 3 || (row === 2 && crate[2] === 2))) {
        cells.push([row === 3 && crate[2] === 2 ? '█' : '▆', 'warning'])
        continue
      }
      // Far-off dots drift at half speed, so the course reads as moving even between crates.
      const star = row < 2 && hash2(Math.floor(s.x / 2) - DASH.col + c, row) % 29 === 0
      cells.push(star ? ['·', 'subtle', undefined, DIM] : [' '])
    }
    rows.push(paint(cells))
  }
  return { rows }
}

export const dash: Game<HalftimeDash> = {
  id: 'dash',
  title: 'dash',
  realtime: true,
  rows: DASH.rows,
  tickMs: 60,
  better: 'higher',
  controls: { space: 'jump', up: 'jump', w: 'jump', k: 'jump' },
  hint: 'space or up: jump  ·  p: pause  ·  esc: keys back to the prompt',
  init: initDash,
  act: (s, action) => (action === 'jump' ? jumpDash(s) : s),
  step: stepDash,
  click: s => jumpDash(s),
  isOver: s => s.dead,
  score: s => Math.floor(s.x),
  draw: (s, cols) => drawDash(s, cols),
}
