// tailchase: a snake on a wide, short field. The edges wrap, so the only way
// to lose is to bite yourself. Each pip grows you by one and speeds you up.
//
// Fair by construction:
//  - Slow start, a little quicker per pip, with a cap: a step takes 230 ms at
//    first (4.3 a second) and 3 ms less per pip, down to 120 ms (8.3 a second)
//    at 37 pips. It never gets quicker than that.
//  - A pip is only ever placed on a free cell the head can reach: a
//    breadth-first search over the cells no body part sits on, through the
//    wrapping edges. If the head is walled in with nothing to reach, no pip is
//    placed until the body opens up (a pip is tried again on every step).
//  - A turn pressed before a step still applies: up to three wait in line. And
//    a step that would bite the body is held back for 100 ms, so a turn pressed
//    just as it was due still saves the snake.

import type { HalftimeTailchase } from '../../types'
import { randInt } from '../rng'
import { BOLD, frame, windowStart, type Cell, type Drawn, type Game } from './kit'

export const TAILCHASE = {
  w: 28,
  h: 7,
  /** Columns each cell takes on screen, so cells read square. */
  cellCols: 2,
  /** Milliseconds per step: starts here, then quickens per pip down to the floor. */
  startMs: 230,
  perPipMs: 3,
  floorMs: 120,
  /** Turns that may wait for their step. */
  maxQueue: 3,
  /** How long a step that would bite is held back, ms: a turn pressed in that time still applies. */
  graceMs: 100,
} as const

/** up, right, down, left */
const DX = [0, 1, 0, -1] as const
const DY = [-1, 0, 1, 0] as const

export const stepMs = (eaten: number) => Math.max(TAILCHASE.floorMs, TAILCHASE.startMs - eaten * TAILCHASE.perPipMs)

const occupied = (body: readonly [number, number][], x: number, y: number) => body.some(([bx, by]) => bx === x && by === y)

/**
 * The free cells the head can reach, row by row: breadth-first from the head
 * over the cells no body part is on, through the wrapping edges.
 */
export function reachableCells(w: number, h: number, body: readonly [number, number][]): [number, number][] {
  const seen = new Uint8Array(w * h)
  for (const [bx, by] of body) seen[by * w + bx] = 1
  const reached = new Uint8Array(w * h)
  const head = body[0]
  const queue: number[] = head ? [head[1] * w + head[0]] : []
  for (let q = 0; q < queue.length; q += 1) {
    const i = queue[q]!
    const x = i % w
    const y = (i - x) / w
    for (let d = 0; d < 4; d += 1) {
      const j = ((y + DY[d]! + h) % h) * w + ((x + DX[d]! + w) % w)
      if (seen[j]) continue
      seen[j] = 1
      reached[j] = 1
      queue.push(j)
    }
  }
  const out: [number, number][] = []
  for (let j = 0; j < w * h; j += 1) if (reached[j]) out.push([j % w, Math.floor(j / w)])
  return out
}

/** A pip on a free cell the head can reach, picked by the seeded generator; none if the head is walled in, a win once the field is full. */
function placeFood(s: HalftimeTailchase): HalftimeTailchase {
  if (s.body.length >= s.w * s.h) return { ...s, food: null, won: true }
  const free = reachableCells(s.w, s.h, s.body)
  if (free.length === 0) return { ...s, food: null }
  const [i, rng] = randInt(s.rng, free.length)
  return { ...s, food: free[i] ?? null, rng }
}

export function initTailchase(seed: number, w: number = TAILCHASE.w, h: number = TAILCHASE.h): HalftimeTailchase {
  const y = Math.floor(h / 2)
  return placeFood({
    w, h, body: [[3, y], [2, y], [1, y]], dir: 1, queue: [], food: null, grow: 0,
    rng: seed >>> 0, acc: 0, eaten: 0, dead: false, won: false,
  })
}

/** Queues a turn: never a reversal onto the neck, never a repeat, at most three ahead. */
export function turnTailchase(s: HalftimeTailchase, dir: number): HalftimeTailchase {
  if (s.dead || s.won) return s
  const last = s.queue.length > 0 ? s.queue[s.queue.length - 1]! : s.dir
  if (dir === last || (dir + 2) % 4 === last || s.queue.length >= TAILCHASE.maxQueue) return s
  return { ...s, queue: [...s.queue, dir] }
}

/** Where the next step goes: its direction, the turns left after it, the cell, and whether that bites the body. */
function aim(s: HalftimeTailchase): { d: number; queue: number[]; nx: number; ny: number; bites: boolean; rest: [number, number][] } {
  const [dir, ...queue] = s.queue.length > 0 ? s.queue : [s.dir]
  const d = dir ?? s.dir
  const head = s.body[0]!
  const nx = (head[0] + (DX[d] ?? 0) + s.w) % s.w
  const ny = (head[1] + (DY[d] ?? 0) + s.h) % s.h
  // The tail moves out of the way first, unless this step grows the snake.
  const rest = s.grow > 0 ? s.body : s.body.slice(0, -1)
  return { d, queue, nx, ny, bites: occupied(rest, nx, ny), rest }
}

/** One cell forward: wrap at the edges, grow if a pip is owed, die on your own body. */
export function moveTailchase(s: HalftimeTailchase): HalftimeTailchase {
  if (s.dead || s.won) return s
  const { d, queue, nx, ny, bites, rest } = aim(s)
  if (bites) return { ...s, dir: d, queue, dead: true }
  const growing = s.grow > 0
  const body: [number, number][] = [[nx, ny], ...rest]
  let next: HalftimeTailchase = { ...s, body, dir: d, queue, grow: growing ? s.grow - 1 : 0 }
  if (s.food && s.food[0] === nx && s.food[1] === ny) next = placeFood({ ...next, eaten: s.eaten + 1, grow: next.grow + 1 })
  // A pip that had nowhere to go is tried again as the body moves.
  else if (next.food === null) next = placeFood(next)
  return next
}

/** Real time in, whole steps out; leftover time is banked for the next tick. */
export function stepTailchase(s: HalftimeTailchase, dtMs: number): HalftimeTailchase {
  let next: HalftimeTailchase = { ...s, acc: s.acc + Math.max(0, Math.min(dtMs, 250)) }
  while (!next.dead && !next.won) {
    const due = stepMs(next.eaten)
    if (next.acc < due) break
    // A step that would bite waits out the grace: a turn pressed in time changes it.
    if (next.acc < due + TAILCHASE.graceMs && aim(next).bites) break
    next = { ...moveTailchase(next), acc: next.acc - due }
  }
  return next
}

export function drawTailchase(s: HalftimeTailchase, cols: number, rows: number): Drawn {
  const cw = TAILCHASE.cellCols
  // The two side rails take two columns of the band.
  const fitW = Math.max(4, Math.floor((cols - 2) / cw))
  const fitH = Math.max(3, rows)
  const head = s.body[0]!
  const ox = windowStart(s.w, fitW, head[0])
  const oy = windowStart(s.h, fitH, head[1])
  const vw = Math.min(s.w, ox + fitW) - ox
  const field: Cell[][] = []
  for (let y = oy; y < Math.min(s.h, oy + fitH); y += 1) {
    const cells: Cell[] = []
    for (let x = ox; x < ox + vw; x += 1) {
      if (head[0] === x && head[1] === y) cells.push(['██', s.dead ? 'error' : 'suggestion', undefined, BOLD])
      else if (occupied(s.body, x, y)) cells.push(['██', 'success'])
      else if (s.food && s.food[0] === x && s.food[1] === y) cells.push(['██', 'warning'])
      else cells.push(['  '])
    }
    field.push(cells)
  }
  const framed = frame(field, vw * cw, cols)
  return { rows: framed.rows, grid: { x: framed.x, cw, ox, oy, width: s.w, height: s.h, vw } }
}

const turn = (dir: number) => `turn:${dir}`

export const tailchase: Game<HalftimeTailchase> = {
  id: 'tailchase',
  title: 'tailchase',
  realtime: true,
  rows: TAILCHASE.h,
  tickMs: 60,
  better: 'higher',
  controls: {
    up: turn(0), right: turn(1), down: turn(2), left: turn(3),
    w: turn(0), d: turn(1), s: turn(2), a: turn(3),
    k: turn(0), l: turn(1), j: turn(2), h: turn(3),
  },
  hint: 'arrows or wasd: steer  ·  edges wrap  ·  p: pause  ·  esc: keys back',
  init: seed => initTailchase(seed),
  act: (s, action) => (action.startsWith('turn:') ? turnTailchase(s, Number(action.slice(5))) : s),
  step: stepTailchase,
  isOver: s => s.dead || s.won,
  score: s => s.eaten,
  draw: drawTailchase,
}
