// cratehop: a one-button runner. The courier runs right on its own; one key
// jumps the crates. The course is laid out by distance from the seed alone,
// so everyone's daily course is the same; speed rises with distance.

import type { HalftimeCratehop } from '../../types'
import { rand } from '../rng'
import { BOLD, DIM, clamp, frame, type Cell, type Drawn, type Game } from './kit'

export const CRATEHOP = {
  /** The runner's screen column. */
  col: 6,
  v0: 14,
  /** Twice the acceleration per cell: v(x) = sqrt(v0^2 + accel2 * x). */
  accel2: 0.5,
  vmax: 34,
  jump: 13,
  gravity: 38,
  lookahead: 110,
  /** Crate-free cells at the start: about three seconds at the start speed. */
  runUp: 44,
  /** The longest stretch of time one tick may advance (a stalled frame never teleports). */
  maxDtMs: 250,
  subStepMs: 8,
  rows: 5,
} as const

/** Speed at a distance: rises slowly, then holds. */
export function speedAt(x: number): number {
  return Math.min(CRATEHOP.vmax, Math.sqrt(CRATEHOP.v0 * CRATEHOP.v0 + CRATEHOP.accel2 * Math.max(0, x)))
}

/** How far one jump carries at a speed. */
export function airDistance(v: number): number {
  return (v * 2 * CRATEHOP.jump) / CRATEHOP.gravity
}

/**
 * The least clear ground after a crate, given the speed reached there: well
 * over one jump's air distance (the runner is a little faster by the next
 * crate), so there is always room to land, breathe and jump again.
 */
export function minGap(v: number): number {
  return Math.ceil(airDistance(v) * 1.3) + 2
}

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
    const tall = r1 < Math.min(0.45, 0.18 + nextX / 6000)
    const w = tall ? (r2 < 0.4 ? 2 : 1) : 1 + Math.floor(r2 * 3)
    obs.push([nextX, w, tall ? 2 : 1])
    // The gap after a crate always leaves room to land and jump again; the random stretch grows with speed, so it is the same in seconds.
    const v = speedAt(nextX + w + 40)
    nextX += w + minGap(v) + Math.floor(r3 * Math.ceil(v * 0.6))
  }
  return { ...s, rng, nextX, obs }
}

export function initCratehop(seed: number): HalftimeCratehop {
  return layout({ rng: seed >>> 0, x: 0, y: 0, vy: 0, obs: [], nextX: CRATEHOP.runUp, dead: false, buffered: false }, CRATEHOP.lookahead)
}

/** Whether the runner, its feet at height y, overlaps a crate at distance x. */
export function hits(obs: readonly [number, number, number][], x: number, y: number): boolean {
  for (const [ox, w, h] of obs) {
    if (x + 0.9 > ox && x + 0.1 < ox + w && y < h - 0.1) return true
  }
  return false
}

export function jumpCratehop(s: HalftimeCratehop): HalftimeCratehop {
  if (s.dead) return s
  if (s.y === 0 && s.vy === 0) return { ...s, vy: CRATEHOP.jump }
  // Pressed while coming down, close to the ground: take it on touchdown.
  if (s.vy < 0 && s.y < 0.8) return { ...s, buffered: true }
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
