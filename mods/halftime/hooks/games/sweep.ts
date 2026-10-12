// sweep: a small mine field, played against the clock. The field comes from
// the seed alone and opens with the same safe pocket for everyone, so the
// daily board is identical; the score is the time to clear it (lower wins).
//
// Fair by construction: a board is only dealt if plain logic clears
// it from the opening pocket with no guess, checked by `solves` below (the
// single-cell rules plus the subset rule). The seed is regenerated, in a fixed
// order, until a board passes; the attempt count is bounded, and the last
// resort is a sparse lattice board that is solvable by construction.

import type { HalftimeSweep } from '../../types'
import { randInt } from '../rng'
import { BOLD, INVERSE, frame, windowStart, type Cell, type Drawn, type Game } from './kit'

/**
 * The field is 16x6 with a fixed density of 12 mines (12.5%, the classic
 * beginner level; it was 14). There are no levels, so there is no ramp: the
 * fairness is that no board is ever dealt that needs a guess. At this density
 * about two random layouts in three already pass `solves`, so a board is dealt
 * in one or two tries; `tries` caps the tries at each density (the odds of
 * missing all of them are below 1e-25), and `minPocket` is the least number of
 * cells the opening must open, so the first look always shows something.
 */
export const SWEEP = { w: 16, h: 6, mines: 12, cellCols: 2, tries: 60, minPocket: 9 } as const

export function neighbors(w: number, h: number, i: number): number[] {
  const x = i % w
  const y = Math.floor(i / w)
  const out: number[] = []
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx
      const ny = y + dy
      if ((dx !== 0 || dy !== 0) && nx >= 0 && ny >= 0 && nx < w && ny < h) out.push(ny * w + nx)
    }
  }
  return out
}

export function countAdjacent(w: number, h: number, mines: readonly number[]): number[] {
  return mines.map((_, i) => neighbors(w, h, i).reduce((n, j) => n + (mines[j] ?? 0), 0))
}

/** Every cell's neighbours for one field size, built once (the solver asks for them in its inner loop). */
const NEIGHBORS = new Map<number, number[][]>()
function neighborTable(w: number, h: number): number[][] {
  const key = w * 4096 + h
  let table = NEIGHBORS.get(key)
  if (!table) {
    table = Array.from({ length: w * h }, (_, i) => neighbors(w, h, i))
    NEIGHBORS.set(key, table)
  }
  return table
}

/** Opens a cell and, through every cell with no mine around it, the whole pocket it belongs to. */
function spread(near: readonly number[][], adj: readonly number[], mines: readonly number[], flag: readonly number[], from: readonly number[], start: number): number[] {
  const open = [...from]
  const stack = [start]
  while (stack.length > 0) {
    const i = stack.pop()!
    if (open[i] || flag[i] || mines[i]) continue
    open[i] = 1
    if (adj[i] === 0) stack.push(...near[i]!)
  }
  return open
}

export function flood(s: HalftimeSweep, start: number): number[] {
  return spread(neighborTable(s.w, s.h), s.adj, s.mines, s.flag, s.open, start)
}

/**
 * Whether plain logic clears a field from its opening, with no guess. The
 * rules are the ones a careful player uses:
 *  - single cell: a number whose mines are all found opens the rest of its
 *    neighbours; a number with exactly as many closed neighbours as mines
 *    left makes them all mines;
 *  - subset: when the closed neighbours of one number are all among those of
 *    another, the difference holds the difference of their mine counts - none
 *    (so it is safe) or all of them (so they are mines).
 * `opening` is the open map the player starts from (the safe pocket).
 */
export function solves(w: number, h: number, mines: readonly number[], adj: readonly number[], opening: readonly number[]): boolean {
  const near = neighborTable(w, h)
  const cells = w * h
  const none = new Array<number>(cells).fill(0)
  let open = [...opening]
  const found = new Array<number>(cells).fill(0)
  let unsound = false
  const reveal = (i: number) => {
    if (open[i] || found[i]) return
    if (mines[i]) unsound = true
    else open = spread(near, adj, mines, none, open, i)
  }
  type Rule = { closed: number[]; left: number }
  for (;;) {
    let moved = false
    const rules: Rule[] = []
    for (let i = 0; i < cells; i += 1) {
      if (!open[i] || !adj[i]) continue
      const closed: number[] = []
      let known = 0
      for (const j of near[i]!) {
        if (found[j]) known += 1
        else if (!open[j]) closed.push(j)
      }
      if (closed.length === 0) continue
      const left = adj[i]! - known
      if (left === 0) {
        for (const j of closed) reveal(j)
        moved = true
      } else if (left === closed.length) {
        for (const j of closed) found[j] = 1
        moved = true
      } else rules.push({ closed, left })
    }
    if (unsound) return false
    if (moved) continue
    for (const a of rules) {
      for (const b of rules) {
        if (a.closed.length >= b.closed.length || !a.closed.every(j => b.closed.includes(j))) continue
        const rest = b.closed.filter(j => !a.closed.includes(j))
        const extra = b.left - a.left
        if (extra === 0) {
          for (const j of rest) reveal(j)
          moved = true
        } else if (extra === rest.length) {
          for (const j of rest) found[j] = 1
          moved = true
        }
      }
    }
    if (unsound) return false
    if (!moved) break
  }
  return open.every((o, i) => o === 1 || mines[i] === 1)
}

const safeCells = (s: HalftimeSweep) => s.w * s.h - s.mines.reduce((n, m) => n + m, 0)
const openCount = (open: readonly number[]) => open.reduce((n, o) => n + o, 0)

function settle(s: HalftimeSweep): HalftimeSweep {
  if (s.dead || openCount(s.open) < safeCells(s)) return s
  // Cleared: every mine gets its flag, for the picture.
  return { ...s, won: true, flag: s.mines.map(m => m) }
}

/** `count` mines on the field, picked by the seeded generator; returns the layout and the generator's next state. */
function scatter(cells: number, count: number, rng: number): { mines: number[]; rng: number } {
  const order = Array.from({ length: cells }, (_, i) => i)
  for (let k = 0; k < count; k += 1) {
    let j: number
    ;[j, rng] = randInt(rng, cells - k)
    const a = order[k]!
    order[k] = order[k + j]!
    order[k + j] = a
  }
  const mines = new Array<number>(cells).fill(0)
  for (let k = 0; k < count; k += 1) mines[order[k]!] = 1
  return { mines, rng }
}

/** The opening: an empty cell (it opens a pocket) nearest the middle, or -1 if the layout has none. */
function openingCell(w: number, h: number, mines: readonly number[], adj: readonly number[]): number {
  const mid = (i: number) => Math.abs((i % w) - (w - 1) / 2) + Math.abs(Math.floor(i / w) - (h - 1) / 2)
  let start = -1
  for (let i = 0; i < w * h; i += 1) {
    if (mines[i] || adj[i] !== 0) continue
    if (start < 0 || mid(i) < mid(start)) start = i
  }
  return start
}

/**
 * The sparse last resort: mines on a lattice, one in each 4x3 block, so no two
 * mines touch and each number sees exactly one. The tests clear this board for
 * the standard field with `solves`. It holds fewer mines than asked for when
 * the field has no room for them all.
 */
export function latticeMines(w: number, h: number, count: number): number[] {
  const mines = new Array<number>(w * h).fill(0)
  let placed = 0
  for (let y = 1; y < h && placed < count; y += 3) {
    for (let x = 3; x < w && placed < count; x += 4) {
      mines[y * w + x] = 1
      placed += 1
    }
  }
  return mines
}

export type Deal = { mines: number[]; adj: number[]; open: number[]; start: number }

/** Opens the pocket around `start` on a layout. */
function dealOf(w: number, h: number, mines: number[], adj: number[], start: number): Deal {
  const near = neighborTable(w, h)
  const open = spread(near, adj, mines, new Array<number>(w * h).fill(0), new Array<number>(w * h).fill(0), start)
  return { mines, adj, open, start }
}

/**
 * Deals the field for a seed: random layouts in the seed's fixed order until
 * one opens a real pocket and is cleared by `solves` with no guess. At most
 * `SWEEP.tries` layouts at the asked density, then at three quarters of it,
 * then half; failing all of those (it does not happen for any seed we know of,
 * and the tests walk a year of dailies and 200 practice seeds) the lattice
 * board stands in. Every step is bounded, and a pure function of the seed.
 */
export function dealSweep(seed: number, w: number, h: number, count: number): Deal {
  const cells = w * h
  let rng = seed >>> 0
  const levels = [count, Math.ceil(count * 0.75), Math.ceil(count * 0.5)]
  for (const level of levels) {
    for (let attempt = 0; attempt < SWEEP.tries; attempt += 1) {
      const placed = scatter(cells, level, rng)
      rng = placed.rng
      const adj = countAdjacent(w, h, placed.mines)
      const start = openingCell(w, h, placed.mines, adj)
      if (start < 0) continue
      const deal = dealOf(w, h, placed.mines, adj, start)
      if (openCount(deal.open) < Math.min(SWEEP.minPocket, cells - level)) continue
      if (solves(w, h, deal.mines, deal.adj, deal.open)) return deal
    }
  }
  const mines = latticeMines(w, h, Math.ceil(count * 0.5))
  const adj = countAdjacent(w, h, mines)
  const start = Math.max(0, openingCell(w, h, mines, adj))
  return dealOf(w, h, mines, adj, start)
}

/** Places mines from the seed, then opens the safe pocket nearest the middle. */
export function initSweep(seed: number, w: number = SWEEP.w, h: number = SWEEP.h, count: number = SWEEP.mines): HalftimeSweep {
  const cells = w * h
  const deal = dealSweep(seed, w, h, count)
  const base: HalftimeSweep = {
    w, h, mines: deal.mines, adj: deal.adj, open: new Array<number>(cells).fill(0), flag: new Array<number>(cells).fill(0),
    cur: [deal.start % w, Math.floor(deal.start / w)], dead: false, won: false, boom: -1,
  }
  return settle({ ...base, open: deal.open })
}

export function revealAt(s: HalftimeSweep, i: number): HalftimeSweep {
  if (s.dead || s.won || i < 0 || i >= s.w * s.h || s.flag[i]) return s
  if (s.open[i]) {
    // Chord: a number whose flags are all placed opens the rest of its neighbours.
    const around = neighbors(s.w, s.h, i)
    const flags = around.reduce((n, j) => n + (s.flag[j] ?? 0), 0)
    if (s.adj[i] === 0 || flags !== s.adj[i]) return s
    let next = s
    for (const j of around) if (!next.open[j] && !next.flag[j]) next = revealAt(next, j)
    return next
  }
  if (s.mines[i]) return { ...s, dead: true, boom: i }
  return settle({ ...s, open: flood(s, i) })
}

export function flagAt(s: HalftimeSweep, i: number): HalftimeSweep {
  if (s.dead || s.won || s.open[i]) return s
  const flag = [...s.flag]
  flag[i] = flag[i] ? 0 : 1
  return { ...s, flag }
}

const MOVES: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

export function actSweep(s: HalftimeSweep, action: string): HalftimeSweep {
  const here = s.cur[1] * s.w + s.cur[0]
  if (action === 'reveal') return revealAt(s, here)
  if (action === 'flag') return flagAt(s, here)
  const step = MOVES[action]
  if (!step || s.dead || s.won) return s
  const x = Math.max(0, Math.min(s.w - 1, s.cur[0] + step[0]))
  const y = Math.max(0, Math.min(s.h - 1, s.cur[1] + step[1]))
  return { ...s, cur: [x, y] }
}

/** A click: the cursor jumps there; left opens, right plants or lifts a flag. */
export function clickSweep(s: HalftimeSweep, cx: number, cy: number, button: string): HalftimeSweep {
  if (cx < 0 || cy < 0 || cx >= s.w || cy >= s.h) return s
  const moved: HalftimeSweep = { ...s, cur: [cx, cy] }
  const i = cy * s.w + cx
  if (button === 'right') return flagAt(moved, i)
  if (button === 'left') return revealAt(moved, i)
  return moved
}

const NUMBER_COLORS = ['', '#5b8def', '#4caf72', '#e05d5d', '#a46be0', '#e8804b', '#3fb6a8', '#d45ca6', '#9aa0a6']

/** Unopened cells are raised slabs in two close greys (a checker, so each cell reads on its own); opened ones are the dark floor. */
export const SLAB = ['#5f6773', '#535a66'] as const
export const FLOOR = '#252a32'

export function drawSweep(s: HalftimeSweep, cols: number, rows: number): Drawn {
  const cw = SWEEP.cellCols
  // The two side rails take two columns of the band.
  const fitW = Math.max(4, Math.floor((cols - 2) / cw))
  const fitH = Math.max(3, rows)
  const ox = windowStart(s.w, fitW, s.cur[0])
  const oy = windowStart(s.h, fitH, s.cur[1])
  const vw = Math.min(s.w, ox + fitW) - ox
  const over = s.dead || s.won
  const field: Cell[][] = []
  for (let y = oy; y < Math.min(s.h, oy + fitH); y += 1) {
    const cells: Cell[] = []
    for (let x = ox; x < ox + vw; x += 1) {
      const i = y * s.w + x
      const cursor = !over && s.cur[0] === x && s.cur[1] === y ? INVERSE : 0
      const slab = SLAB[(x + y) % 2]
      let cell: Cell
      if (s.flag[i]) cell = [' ▲', 'warning', slab, BOLD]
      else if (s.dead && s.mines[i]) cell = [' ✶', 'error', FLOOR, BOLD | (i === s.boom ? INVERSE : 0)]
      else if (!s.open[i]) cell = ['  ', undefined, slab]
      else if (s.adj[i] === 0) cell = ['  ', undefined, FLOOR]
      else cell = [` ${s.adj[i]}`, NUMBER_COLORS[s.adj[i]!] ?? 'text', FLOOR, BOLD]
      cells.push(cursor ? [cell[0], cell[1], cell[2], (cell[3] ?? 0) | INVERSE] : cell)
    }
    field.push(cells)
  }
  const framed = frame(field, vw * cw, cols)
  return { rows: framed.rows, grid: { x: framed.x, cw, ox, oy, w: s.w, h: s.h, vw } }
}

export const sweep: Game<HalftimeSweep> = {
  id: 'sweep',
  title: 'sweep',
  realtime: false,
  rows: SWEEP.h,
  tickMs: 0,
  better: 'lower',
  controls: {
    up: 'up', down: 'down', left: 'left', right: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    k: 'up', j: 'down', h: 'left', l: 'right',
    space: 'reveal', x: 'reveal', f: 'flag',
  },
  hint: 'arrows: move  ·  space: open  ·  f: flag  ·  or click / right-click  ·  esc: keys back',
  init: seed => initSweep(seed),
  act: actSweep,
  click: clickSweep,
  isOver: s => s.dead || s.won,
  score: (s, playedMs) => (s.won ? Math.max(1, Math.round(playedMs / 1000)) : null),
  draw: drawSweep,
}
