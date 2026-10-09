// sweep: a small mine field, played against the clock. The field comes from
// the seed alone and opens with the same safe pocket for everyone, so the
// daily board is identical; the score is the time to clear it (lower wins).

import type { HalftimeSweep } from '../../types'
import { randInt } from '../rng'
import { BOLD, DIM, INVERSE, paint, windowStart, type Cell, type Drawn, type Game, type Seg } from './kit'

export const SWEEP = { w: 16, h: 6, mines: 14, cellCols: 2 } as const

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

/** Opens a cell and, through every cell with no mine around it, the whole pocket it belongs to. */
export function flood(s: HalftimeSweep, start: number): number[] {
  const open = [...s.open]
  const stack = [start]
  while (stack.length > 0) {
    const i = stack.pop()!
    if (open[i] || s.flag[i] || s.mines[i]) continue
    open[i] = 1
    if (s.adj[i] === 0) stack.push(...neighbors(s.w, s.h, i))
  }
  return open
}

const safeCells = (s: HalftimeSweep) => s.w * s.h - s.mines.reduce((n, m) => n + m, 0)
const openCount = (open: readonly number[]) => open.reduce((n, o) => n + o, 0)

function settle(s: HalftimeSweep): HalftimeSweep {
  if (s.dead || openCount(s.open) < safeCells(s)) return s
  // Cleared: every mine gets its flag, for the picture.
  return { ...s, won: true, flag: s.mines.map(m => m) }
}

/** Places mines from the seed, then opens the safe pocket nearest the middle. */
export function initSweep(seed: number, w: number = SWEEP.w, h: number = SWEEP.h, count: number = SWEEP.mines): HalftimeSweep {
  const cells = w * h
  const order = Array.from({ length: cells }, (_, i) => i)
  let rng = seed >>> 0
  for (let k = 0; k < count; k += 1) {
    let j: number
    ;[j, rng] = randInt(rng, cells - k)
    const a = order[k]!
    order[k] = order[k + j]!
    order[k + j] = a
  }
  const mines = new Array<number>(cells).fill(0)
  for (let k = 0; k < count; k += 1) mines[order[k]!] = 1
  const adj = countAdjacent(w, h, mines)
  const mid = (i: number) => Math.abs((i % w) - (w - 1) / 2) + Math.abs(Math.floor(i / w) - (h - 1) / 2)
  let start = -1
  for (let i = 0; i < cells; i += 1) {
    if (mines[i]) continue
    // Prefer an empty cell (it opens a pocket), then the nearest to the middle.
    const better = start < 0 || adj[i]! < adj[start]! || (adj[i] === adj[start] && mid(i) < mid(start))
    if (better) start = i
  }
  const base: HalftimeSweep = {
    w, h, mines, adj, open: new Array<number>(cells).fill(0), flag: new Array<number>(cells).fill(0),
    cur: [start % w, Math.floor(start / w)], dead: false, won: false, boom: -1,
  }
  return settle({ ...base, open: flood(base, start) })
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

export function drawSweep(s: HalftimeSweep, cols: number, rows: number): Drawn {
  const cw = SWEEP.cellCols
  const fitW = Math.max(4, Math.floor(cols / cw))
  const fitH = Math.max(3, rows)
  const ox = windowStart(s.w, fitW, s.cur[0])
  const oy = windowStart(s.h, fitH, s.cur[1])
  const over = s.dead || s.won
  const out: Seg[][] = []
  for (let y = oy; y < Math.min(s.h, oy + fitH); y += 1) {
    const cells: Cell[] = []
    for (let x = ox; x < Math.min(s.w, ox + fitW); x += 1) {
      const i = y * s.w + x
      const cursor = !over && s.cur[0] === x && s.cur[1] === y ? INVERSE : 0
      let cell: Cell
      if (s.flag[i]) cell = [' ▲', 'warning', undefined, BOLD]
      else if (s.dead && s.mines[i]) cell = [' *', 'error', undefined, BOLD | (i === s.boom ? INVERSE : 0)]
      else if (!s.open[i]) cell = ['░░', 'subtle', undefined, DIM]
      else if (s.adj[i] === 0) cell = ['  ']
      else cell = [` ${s.adj[i]}`, NUMBER_COLORS[s.adj[i]!] ?? 'text', undefined, BOLD]
      cells.push(cursor ? [cell[0], cell[1], cell[2], (cell[3] ?? 0) | INVERSE] : cell)
    }
    out.push(paint(cells))
  }
  return { rows: out, grid: { x: 0, cw, ox, oy, w: s.w, h: s.h } }
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
