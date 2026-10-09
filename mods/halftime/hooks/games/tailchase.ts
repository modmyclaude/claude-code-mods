// tailchase: a snake on a wide, short field. The edges wrap, so the only way
// to lose is to bite yourself. Each pip grows you by one and speeds you up.

import type { HalftimeTailchase } from '../../types'
import { randInt } from '../rng'
import { BOLD, DIM, paint, windowStart, type Cell, type Drawn, type Game, type Seg } from './kit'

export const TAILCHASE = {
  w: 28,
  h: 7,
  /** Columns each cell takes on screen, so cells read square. */
  cellCols: 2,
  /** Milliseconds per step: starts here, then quickens per pip down to the floor. */
  startMs: 150,
  perPipMs: 3,
  floorMs: 70,
  maxQueue: 2,
} as const

/** up, right, down, left */
const DX = [0, 1, 0, -1] as const
const DY = [-1, 0, 1, 0] as const

export const stepMs = (eaten: number) => Math.max(TAILCHASE.floorMs, TAILCHASE.startMs - eaten * TAILCHASE.perPipMs)

const occupied = (body: readonly [number, number][], x: number, y: number) => body.some(([bx, by]) => bx === x && by === y)

/** A pip on a free cell, picked by the seeded generator; null once the field is full. */
function placeFood(s: HalftimeTailchase): HalftimeTailchase {
  const free: [number, number][] = []
  for (let y = 0; y < s.h; y += 1) for (let x = 0; x < s.w; x += 1) if (!occupied(s.body, x, y)) free.push([x, y])
  if (free.length === 0) return { ...s, food: null, won: true }
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

/** Queues a turn: never a reversal onto the neck, never a repeat, at most two ahead. */
export function turnTailchase(s: HalftimeTailchase, dir: number): HalftimeTailchase {
  if (s.dead || s.won) return s
  const last = s.queue.length > 0 ? s.queue[s.queue.length - 1]! : s.dir
  if (dir === last || (dir + 2) % 4 === last || s.queue.length >= TAILCHASE.maxQueue) return s
  return { ...s, queue: [...s.queue, dir] }
}

/** One cell forward: wrap at the edges, grow if a pip is owed, die on your own body. */
export function moveTailchase(s: HalftimeTailchase): HalftimeTailchase {
  if (s.dead || s.won) return s
  const [dir, ...queue] = s.queue.length > 0 ? s.queue : [s.dir]
  const d = dir ?? s.dir
  const head = s.body[0]!
  const nx = (head[0] + (DX[d] ?? 0) + s.w) % s.w
  const ny = (head[1] + (DY[d] ?? 0) + s.h) % s.h
  // The tail moves out of the way first, unless this step grows the snake.
  const growing = s.grow > 0
  const rest = growing ? s.body : s.body.slice(0, -1)
  if (occupied(rest, nx, ny)) return { ...s, dir: d, queue, dead: true }
  const body: [number, number][] = [[nx, ny], ...rest]
  let next: HalftimeTailchase = { ...s, body, dir: d, queue, grow: growing ? s.grow - 1 : 0 }
  if (s.food && s.food[0] === nx && s.food[1] === ny) next = placeFood({ ...next, eaten: s.eaten + 1, grow: next.grow + 1 })
  return next
}

/** Real time in, whole steps out; leftover time is banked for the next tick. */
export function stepTailchase(s: HalftimeTailchase, dtMs: number): HalftimeTailchase {
  let next: HalftimeTailchase = { ...s, acc: s.acc + Math.max(0, Math.min(dtMs, 250)) }
  while (!next.dead && !next.won && next.acc >= stepMs(next.eaten)) {
    const spent = stepMs(next.eaten)
    next = { ...moveTailchase(next), acc: next.acc - spent }
  }
  return next
}

export function drawTailchase(s: HalftimeTailchase, cols: number, rows: number): Drawn {
  const cw = TAILCHASE.cellCols
  const fitW = Math.max(4, Math.floor(cols / cw))
  const fitH = Math.max(3, rows)
  const head = s.body[0]!
  const ox = windowStart(s.w, fitW, head[0])
  const oy = windowStart(s.h, fitH, head[1])
  const out: Seg[][] = []
  for (let y = oy; y < Math.min(s.h, oy + fitH); y += 1) {
    const cells: Cell[] = []
    for (let x = ox; x < Math.min(s.w, ox + fitW); x += 1) {
      if (head[0] === x && head[1] === y) cells.push(['██', s.dead ? 'error' : 'success', undefined, BOLD])
      else if (occupied(s.body, x, y)) cells.push(['▓▓', 'success'])
      else if (s.food && s.food[0] === x && s.food[1] === y) cells.push(['▐▌', 'error'])
      else cells.push([' ·', 'subtle', undefined, DIM])
    }
    out.push(paint(cells))
  }
  return { rows: out, grid: { x: 0, cw, ox, oy, w: s.w, h: s.h } }
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
