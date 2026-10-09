// The pure rules, table by table: each game's physics or moves, the seeded
// generator, the daily seed, the share line, and the key rule all four games
// must keep (never Enter, y, n or a digit).

import { BOLT_PALETTE, BOLT_RUN, boltCells } from '../hooks/bolt'
import { describe, expect, test } from 'claude-code/testing'

import type { HalftimeCratehop, HalftimeSweep, HalftimeTailchase } from '../types'
import { CRATEHOP, airDistance, hits, initCratehop, jumpCratehop, layout, minGap, speedAt, stepCratehop } from '../hooks/games/cratehop'
import { GAME_IDS, beats, gameOf, scoreText } from '../hooks/games'
import { INVERSE, isForbiddenKey, normalizeKey, type Seg } from '../hooks/games/kit'
import { WELL, canMove, initMerge, moveMerge, slide, slideLine, spawn } from '../hooks/games/merge'
import { TAILCHASE, initTailchase, moveTailchase, stepMs, stepTailchase, turnTailchase } from '../hooks/games/tailchase'
import { FLOOR, SLAB, SWEEP, countAdjacent, flagAt, flood, initSweep, neighbors, revealAt } from '../hooks/games/sweep'
import { SHARED_KEYS } from '../hooks/engine'
import { dailySeed, dayKey, fnv1a, rand, randInt } from '../hooks/rng'
import { duration, scorecard, shareLine } from '../hooks/share'

describe('names', () => {
  // Every id is a picker button, a command argument, a store key and a daily seed. A rename is
  // this one diff (the old snake and runner names were taken by registered game trademarks).
  test('the four games and nothing else', () => {
    expect([...GAME_IDS]).toEqual(['cratehop', 'tailchase', 'merge', 'sweep'])
    for (const id of GAME_IDS) {
      expect(gameOf(id).id).toBe(id)
      expect(gameOf(id).title).toBe(id)
    }
  })
})

describe('keys', () => {
  test('no game, and no shared key, uses Enter, y, n or a digit', () => {
    for (const id of GAME_IDS) {
      const keys = Object.keys(gameOf(id).controls)
      expect(keys.length, id).toBeGreaterThan(0)
      for (const k of [...keys, ...Object.keys(SHARED_KEYS)]) {
        expect(isForbiddenKey(k), `${id} uses ${k}`).toBe(false)
        expect(['return', 'enter', 'y', 'n', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']).not.toContain(k)
      }
    }
  })

  test('forbidden keys are recognised in every spelling', () => {
    for (const k of ['return', 'Return', 'enter', 'y', 'Y', 'n', 'N', '0', '5', '9']) expect(isForbiddenKey(k), k).toBe(true)
    for (const k of ['space', 'up', 'w', 'p', 'r', 'f', 'x', 'h']) expect(isForbiddenKey(k), k).toBe(false)
    expect(normalizeKey(' ')).toBe('space')
    expect(normalizeKey('W')).toBe('w')
    expect(normalizeKey('up')).toBe('up')
  })
})

describe('rng and the daily seed', () => {
  test('mulberry32 is deterministic and in range', () => {
    let a = 42
    let b = 42
    for (let i = 0; i < 200; i += 1) {
      let x: number
      let y: number
      ;[x, a] = rand(a)
      ;[y, b] = rand(b)
      expect(x).toBe(y)
      expect(x >= 0 && x < 1).toBe(true)
    }
    const [n] = randInt(7, 6)
    expect(n >= 0 && n < 6).toBe(true)
  })

  const days: [number, string][] = [
    [new Date(2026, 9, 9, 0, 0, 1).getTime(), '2026-10-09'],
    [new Date(2026, 9, 9, 23, 59, 59).getTime(), '2026-10-09'],
    [new Date(2026, 0, 1, 12).getTime(), '2026-01-01'],
  ]
  for (const [ms, day] of days) test(`dayKey ${day}`, () => expect(dayKey(ms)).toBe(day))

  test('same day and game: same seed for everyone; another day or game: another seed', () => {
    expect(dailySeed('cratehop', '2026-10-09')).toBe(dailySeed('cratehop', '2026-10-09'))
    expect(dailySeed('cratehop', '2026-10-09')).toBe(fnv1a('halftime/cratehop/2026-10-09'))
    expect(dailySeed('cratehop', '2026-10-09')).not.toBe(dailySeed('cratehop', '2026-10-10'))
    expect(dailySeed('cratehop', '2026-10-09')).not.toBe(dailySeed('merge', '2026-10-09'))
    // The same seed builds the same board.
    expect(initSweep(dailySeed('sweep', '2026-10-09'))).toEqual(initSweep(dailySeed('sweep', '2026-10-09')))
    expect(initMerge(dailySeed('merge', '2026-10-09'))).toEqual(initMerge(dailySeed('merge', '2026-10-09')))
  })
})

describe('cratehop', () => {
  const flat = (over: Partial<HalftimeCratehop> = {}): HalftimeCratehop => ({
    rng: 1, x: 0, y: 0, vy: 0, obs: [], nextX: 1e9, dead: false, buffered: false, ...over,
  })

  test('speed rises slowly with distance, then holds', () => {
    expect(speedAt(0)).toBe(CRATEHOP.v0)
    expect(speedAt(500)).toBeGreaterThan(speedAt(100))
    expect(speedAt(1e6)).toBe(CRATEHOP.vmax)
  })

  test('a jump peaks near v^2/2g and lands after 2v/g', () => {
    let s = jumpCratehop(flat())
    let peak = 0
    let t = 0
    while (t === 0 || s.y > 0) {
      s = stepCratehop(s, 8)
      t += 8
      peak = Math.max(peak, s.y)
      if (t > 3000) break
    }
    expect(peak).toBeGreaterThan(2)
    expect(peak).toBeLessThan((CRATEHOP.jump * CRATEHOP.jump) / (2 * CRATEHOP.gravity) + 0.05)
    expect(Math.abs(t - (2 * CRATEHOP.jump * 1000) / CRATEHOP.gravity)).toBeLessThan(40)
  })

  const crash: [string, [number, number, number], boolean][] = [
    ['runs into a low crate on the ground', [10, 1, 1], true],
    ['runs into a tall crate on the ground', [10, 2, 2], true],
  ]
  for (const [name, crate, dies] of crash) {
    test(name, () => {
      let s = flat({ obs: [crate] })
      for (let i = 0; i < 40 && !s.dead; i += 1) s = stepCratehop(s, 50)
      expect(s.dead).toBe(dies)
    })
  }

  test('a jump at the right moment clears a low crate', () => {
    let s = flat({ obs: [[10, 1, 1]] })
    while (s.x < 10 - airDistance(speedAt(s.x)) / 2) s = stepCratehop(s, 8)
    s = jumpCratehop(s)
    for (let i = 0; i < 100; i += 1) s = stepCratehop(s, 8)
    expect(s.dead).toBe(false)
    expect(s.x).toBeGreaterThan(12)
  })

  test('collision is the overlap of runner and crate below its top, in boxes smaller than the art', () => {
    // The courier is drawn in cell floor(x), so x = 5.5 is it standing on a crate drawn in cell 5.
    expect(hits([[5, 1, 1]], 5.5, 0)).toBe(true)
    expect(hits([[5, 1, 1]], 5.5, 1.2)).toBe(false)
    expect(hits([[5, 1, 2]], 5.5, 1.2)).toBe(true)
    expect(hits([[5, 1, 1]], 3, 0)).toBe(false)
    // Forgiving: a graze of the drawn crate's edge, either side, is not a hit.
    expect(hits([[5, 1, 1]], 4.9, 0)).toBe(false)
    expect(hits([[5, 1, 1]], 6.05, 0)).toBe(false)
    expect(hits([[5, 3, 1]], 5.1, 0)).toBe(false)
    expect(hits([[5, 3, 1]], 7.95, 0)).toBe(false)
    // ... and the crate's top counts a little lower than drawn: feet at 0.65 are drawn one row up.
    expect(hits([[5, 1, 1]], 5.5, 0.6)).toBe(true)
    expect(hits([[5, 1, 1]], 5.5, 0.7)).toBe(false)
    expect(hits([[5, 1, 2]], 5.5, 1.6)).toBe(true)
    expect(hits([[5, 1, 2]], 5.5, 1.7)).toBe(false)
  })

  test('the course comes from the seed alone, however far it was laid out at once', () => {
    const a = initCratehop(123)
    expect(a.obs).toEqual(initCratehop(123).obs)
    expect(a.obs).not.toEqual(initCratehop(124).obs)
    // Laying out further only extends the course; what was laid out before never changes.
    const far = layout(a, 4000).obs
    expect(far.slice(0, a.obs.length)).toEqual(a.obs)
    expect(layout(layout(a, 1500), 4000).obs).toEqual(far)
  })

  test('a crate-free run-up of four and a half seconds, then always comfortably more than one jump between crates', () => {
    expect(CRATEHOP.runUp / CRATEHOP.v0).toBeGreaterThanOrEqual(4.5)
    for (const seed of [1, 2, 123, 5, 20261009, 0xdeadbeef]) {
      const course = layout(initCratehop(seed), 7000).obs
      expect(course.length, `seed ${seed}`).toBeGreaterThan(60)
      expect(course[0]![0], `seed ${seed}`).toBeGreaterThanOrEqual(CRATEHOP.runUp)
      for (let i = 1; i < course.length; i += 1) {
        const [px, pw] = course[i - 1]!
        const ox = course[i]![0]
        const gap = ox - (px + pw)
        // At least the floor for the speed reached there ...
        expect(gap, `seed ${seed} crate ${i}`).toBeGreaterThanOrEqual(minGap(speedAt(px)))
        // ... and, at the (faster) speed where the next crate stands, still well over one jump's air distance.
        expect(gap, `seed ${seed} crate ${i}`).toBeGreaterThan(airDistance(speedAt(ox)) * 1.2)
      }
    }
  })

  test('every crate of the course can be cleared: a player who centers each jump over its crate never crashes', () => {
    for (const seed of [1, 2, 3, 123, 20261009, 999]) {
      let s = initCratehop(seed)
      while (!s.dead && s.x < 3000) {
        const next = s.obs.find(([ox, w]) => ox + w > s.x)
        // Takes off so the arc's peak sits over the middle of the crate's hit box.
        if (next && s.y === 0 && s.vy === 0 && next[0] + next[1] / 2 - 0.5 - s.x <= airDistance(speedAt(s.x)) / 2) s = jumpCratehop(s)
        s = stepCratehop(s, 16)
      }
      expect(s.dead, `seed ${seed} crashed at ${Math.round(s.x)}`).toBe(false)
    }
  })

  test('score follows real time, not the frame count', () => {
    const coarse = Array.from({ length: 10 }, () => 100).reduce((s, dt) => stepCratehop(s, dt), flat())
    const fine = Array.from({ length: 100 }, () => 10).reduce((s, dt) => stepCratehop(s, dt), flat())
    expect(Math.abs(coarse.x - fine.x)).toBeLessThan(0.05)
    expect(Math.floor(fine.x)).toBe(gameOf('cratehop').score(fine, 1000))
    // One stalled frame advances at most its cap.
    expect(stepCratehop(flat(), 10_000).x).toBeLessThan(speedAt(0) * (CRATEHOP.maxDtMs / 1000) + 0.5)
  })
})

describe('tailchase', () => {
  const line = (over: Partial<HalftimeTailchase> = {}): HalftimeTailchase => ({
    ...initTailchase(9), food: null, ...over,
  })

  test('moves one cell per step and wraps at every edge', () => {
    const cases: [string, [number, number], number, [number, number]][] = [
      ['right edge to the left', [TAILCHASE.w - 1, 2], 1, [0, 2]],
      ['left edge to the right', [0, 2], 3, [TAILCHASE.w - 1, 2]],
      ['top to bottom', [5, 0], 0, [5, TAILCHASE.h - 1]],
      ['bottom to top', [5, TAILCHASE.h - 1], 2, [5, 0]],
    ]
    for (const [name, head, dir, want] of cases) {
      const s = moveTailchase(line({ body: [head], dir }))
      expect(s.body[0], name).toEqual(want)
      expect(s.dead, name).toBe(false)
    }
  })

  test('eating a pip scores, then grows by one on the next step', () => {
    let s = line({ body: [[3, 3], [2, 3], [1, 3]], dir: 1, food: [4, 3] })
    s = moveTailchase(s)
    expect(s.eaten).toBe(1)
    expect(s.body.length).toBe(3)
    expect(s.food).not.toEqual([4, 3])
    expect(s.body.some(([x, y]) => s.food !== null && x === s.food[0] && y === s.food[1])).toBe(false)
    s = moveTailchase(s)
    expect(s.body.length).toBe(4)
  })

  test('biting its own body ends the run; the cell the tail just left is free', () => {
    const loop: [number, number][] = [[2, 2], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2]]
    expect(moveTailchase(line({ body: loop, dir: 2 })).dead).toBe(true)
    const square: [number, number][] = [[2, 2], [3, 2], [3, 3], [2, 3]]
    expect(moveTailchase(line({ body: square, dir: 2 })).dead).toBe(false)
    expect(moveTailchase(line({ body: square, dir: 2, grow: 1 })).dead).toBe(true)
  })

  test('a reversal is ignored; turns queue three deep', () => {
    let s = line()
    expect(turnTailchase(s, 3).queue).toEqual([])
    s = turnTailchase(turnTailchase(turnTailchase(turnTailchase(s, 0), 3), 2), 1)
    expect(s.queue).toEqual([0, 3, 2])
  })

  test('steps come from real time and quicken with every pip', () => {
    const s = stepTailchase(stepTailchase(line({ body: [[3, 3], [2, 3], [1, 3]] }), stepMs(0)), stepMs(0) + 5)
    expect(s.body[0]).toEqual([5, 3])
    expect(s.acc).toBe(5)
    expect(stepMs(10)).toBeLessThan(stepMs(0))
    expect(stepMs(1000)).toBe(TAILCHASE.floorMs)
  })
})

describe('merge', () => {
  const rows: [number[], number[], number][] = [
    [[1, 1, 0, 0], [2, 0, 0, 0], 4],
    [[1, 1, 1, 1], [2, 2, 0, 0], 8],
    [[1, 1, 1, 0], [2, 1, 0, 0], 4],
    [[2, 1, 1, 0], [2, 2, 0, 0], 4],
    [[0, 0, 0, 1], [1, 0, 0, 0], 0],
    [[1, 2, 3, 4], [1, 2, 3, 4], 0],
    [[3, 3, 2, 2], [4, 3, 0, 0], 24],
  ]
  for (const [line, want, gained] of rows) {
    test(`slide ${line.join(' ')} -> ${want.join(' ')}`, () => {
      expect(slideLine(line)).toEqual({ line: want, gained })
    })
  }

  test('each direction slides toward its own side, one merge per tile', () => {
    const board = [1, 1, 1, 1, 0, 0, 0, 0, 2, 0, 0, 2, 0, 0, 0, 0]
    expect(slide(board, 'left').cells.slice(0, 4)).toEqual([2, 2, 0, 0])
    expect(slide(board, 'right').cells.slice(0, 4)).toEqual([0, 0, 2, 2])
    expect(slide(board, 'right').cells.slice(8, 12)).toEqual([0, 0, 0, 3])
    const up = slide(board, 'up').cells
    expect([up[0], up[4], up[8]]).toEqual([1, 2, 0])
    const down = slide(board, 'down').cells
    expect([down[0], down[4], down[8], down[12]]).toEqual([0, 0, 1, 2])
  })

  test('a move that changes nothing spawns nothing; one that does spawns one tile', () => {
    const still = { cells: [1, 2, 3, 4, 2, 3, 4, 1, 3, 4, 1, 2, 4, 1, 2, 3], rng: 5, points: 0, moves: 0, over: false }
    expect(moveMerge(still, 'left')).toBe(still)
    expect(canMove(still.cells)).toBe(false)
    const open = { ...still, cells: [1, 1, 0, 0, ...new Array<number>(12).fill(0)] }
    const moved = moveMerge(open, 'left')
    expect(moved.points).toBe(4)
    expect(moved.cells.filter(v => v > 0).length).toBe(2)
    expect(spawn(open.cells, 5)).toEqual(spawn(open.cells, 5))
  })
})

describe('sweep', () => {
  test('neighbours and counts', () => {
    expect(neighbors(4, 3, 0).sort()).toEqual([1, 4, 5])
    expect(neighbors(4, 3, 5).length).toBe(8)
    const mines = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]
    expect(countAdjacent(4, 3, mines)).toEqual([0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0])
  })

  const board = () => {
    // 4x3, one mine in the bottom right corner.
    const mines = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]
    return {
      w: 4, h: 3, mines, adj: countAdjacent(4, 3, mines), open: new Array<number>(12).fill(0), flag: new Array<number>(12).fill(0),
      cur: [0, 0] as [number, number], dead: false, won: false, boom: -1,
    }
  }

  test('flood fill opens the empty pocket and its numbered rim, never past a flag', () => {
    const s = board()
    expect(flood(s, 0)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0])
    const flagged = { ...s, flag: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0] }
    expect(flood(flagged, 0)[6]).toBe(0)
  })

  test('opening every safe cell wins; a mine loses', () => {
    expect(revealAt(board(), 0).won).toBe(true)
    const lost = revealAt(board(), 11)
    expect(lost.dead).toBe(true)
    expect(lost.boom).toBe(11)
    expect(gameOf('sweep').score(lost, 9000)).toBe(null)
    expect(gameOf('sweep').score(revealAt(board(), 0), 46_600)).toBe(47)
  })

  test('a flag blocks a reveal, and a number with its flags placed opens the rest', () => {
    const s = flagAt(board(), 11)
    expect(revealAt(s, 11)).toBe(s)
    const opened = { ...s, open: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0] }
    const chorded = revealAt(opened, 10)
    expect(chorded.dead).toBe(false)
    expect(chorded.won).toBe(true)
  })

  test('the daily field opens with the same safe pocket for everyone', () => {
    const a = initSweep(dailySeed('sweep', '2026-10-09'))
    expect(a.open.reduce((n, o) => n + o, 0)).toBeGreaterThan(0)
    expect(a.mines.reduce((n, m) => n + m, 0)).toBe(SWEEP.mines)
    expect(a.open.some((o, i) => o === 1 && a.mines[i] === 1)).toBe(false)
  })
})

describe('words', () => {
  const lines: [Parameters<typeof shareLine>[0], string][] = [
    [
      { mode: 'daily', day: '2026-10-09', game: 'cratehop', score: 412, playedMs: 190_000, waitMs: 420_000, waitPlayedMs: 180_000 },
      'halftime daily 10-09 · cratehop 412 · played 3m of a 7m turn',
    ],
    [
      { mode: 'practice', day: '2026-10-09', game: 'merge', score: 1320, playedMs: 45_000, waitMs: 0, waitPlayedMs: 0 },
      'halftime practice · merge 1320 · played 45s',
    ],
    [
      { mode: 'daily', day: '2026-01-02', game: 'sweep', score: 47, playedMs: 47_000, waitMs: 90_000, waitPlayedMs: 47_000 },
      'halftime daily 01-02 · sweep 47s · played 47s of a 2m turn',
    ],
    [
      { mode: 'daily', day: '2026-10-09', game: 'sweep', score: null, playedMs: 5_000, waitMs: 60_000, waitPlayedMs: 5_000 },
      'halftime daily 10-09 · sweep lost · played 5s of a 1m turn',
    ],
  ]
  for (const [input, want] of lines) test(want, () => expect(shareLine(input)).toBe(want))

  test('durations and scores read plainly', () => {
    expect(duration(0)).toBe('0s')
    expect(duration(59_400)).toBe('59s')
    expect(duration(61_000)).toBe('1m')
    expect(duration(3_900_000)).toBe('1h 5m')
    expect(scoreText('sweep', 47)).toBe('47s')
    expect(scoreText('cratehop', null)).toBe('-')
    expect(beats('sweep', 40, 47)).toBe(true)
    expect(beats('cratehop', 40, 47)).toBe(false)
    expect(beats('cratehop', 40, undefined)).toBe(true)
  })

  test('the scorecard is one line over every game', () => {
    const line = scorecard({ auto: false, last: null, best: { cratehop: 412, sweep: 47 }, daily: {}, playedMs: 0, waitPlayedMs: 2_220_000, runs: 3 })
    expect(line).toBe('halftime · cratehop 412 · tailchase - · merge - · sweep 47s · 37m played while waiting')
    expect(line.includes('\n')).toBe(false)
  })
})

// The art: every game's field is a centered play window between two dim rails, on a clean
// background, drawn in single-cell glyphs only, and its Grid says exactly where the field is.

describe('drawing', () => {
  const rowText = (row: Seg[]) => row.map(seg => seg[0]).join('')
  /** [first column, seg] for every run in a row (every glyph here is one cell wide). */
  const runs = (row: Seg[]): [number, Seg][] => {
    let col = 0
    return row.map(seg => {
      const at: [number, Seg] = [col, seg]
      col += [...seg[0]].length
      return at
    })
  }
  /** The run drawn over a column of a row. */
  const segAt = (row: Seg[], col: number) => runs(row).find(([at, seg]) => at <= col && col < at + [...seg[0]].length)![1]
  /** What lies between the two rails of a row. */
  const inside = (row: Seg[]) => row.slice(row.findIndex(seg => seg[0] === '│') + 1, -1)
  /** Box drawing, block elements, printable ASCII, and the two geometric marks the art uses. */
  const ALLOWED = /^[\u0020-\u007e\u2500-\u257f\u2580-\u259f\u2736\u25b2]*$/
  const draws = (id: (typeof GAME_IDS)[number], cols: number) => {
    const game = gameOf(id)
    return game.draw(game.init(20261009), cols, game.rows)
  }

  for (const id of GAME_IDS) {
    for (const cols of [48, 70, 100, 140]) {
      test(`${id} at ${cols} columns: centered between two dim rails, every Seg whole, single-cell glyphs only`, () => {
        const { rows } = draws(id, cols)
        expect(rows.length).toBeGreaterThan(0)
        for (const row of rows) {
          for (const seg of row) {
            expect(seg.length).toBe(4)
            expect(typeof seg[0]).toBe('string')
            expect(typeof seg[1]).toBe('string')
            expect(typeof seg[2]).toBe('string')
            expect(typeof seg[3]).toBe('number')
          }
          const text = rowText(row)
          expect(text, `${id} ${cols}`).toMatch(ALLOWED)
          const width = text.length
          expect(width).toBeLessThanOrEqual(cols)
          // The rails are the first and last cells after the pad, drawn dim.
          const pad = width - text.trimStart().length
          expect(runs(row).find(([at]) => at === pad)![1], `${id} ${cols}`).toEqual(['│', 'subtle', '', 2])
          expect(row[row.length - 1], `${id} ${cols}`).toEqual(['│', 'subtle', '', 2])
          // Centered: what is left of the band is split evenly (an odd column goes to the right).
          expect(pad, `${id} ${cols}`).toBe(Math.floor((cols - width + pad) / 2))
          expect(Math.abs(pad - (cols - width)), `${id} ${cols}`).toBeLessThanOrEqual(1)
        }
        // Every row is as wide as the others, so the rails line up.
        expect(new Set(rows.map(row => rowText(row).length)).size).toBe(1)
      })
    }
  }

  test('a wide band leaves room on both sides of a fixed-size field', () => {
    for (const id of ['tailchase', 'merge', 'sweep'] as const) {
      const text = rowText(draws(id, 100).rows[0]!)
      expect(text.length - text.trimStart().length, id).toBeGreaterThan(10)
      expect(100 - text.length, id).toBeGreaterThan(10)
    }
  })

  test('the empty field is blank: no dot fill in any game', () => {
    for (const id of GAME_IDS) for (const row of draws(id, 100).rows) expect(rowText(row), id).not.toContain('·')
    // Besides the snake, the pip and the rails, every tailchase cell is a space.
    const rows = gameOf('tailchase').draw(initTailchase(3), 100, TAILCHASE.h).rows
    expect(rows.map(rowText).join('').replace(/[│█]/g, '').trim()).toBe('')
  })

  describe('tailchase', () => {
    const state = (over: Partial<HalftimeTailchase> = {}): HalftimeTailchase => ({ ...initTailchase(9), food: [10, 1], ...over })
    /** The run over a field cell, and the two columns of text it takes. */
    const cell = (s: HalftimeTailchase, cx: number, cy: number) => {
      const d = gameOf('tailchase').draw(s, 100, TAILCHASE.h)
      const g = d.grid!
      const row = d.rows[cy - g.oy]!
      const col = g.x + (cx - g.ox) * g.cw
      return { seg: segAt(row, col), text: rowText(row).slice(col, col + g.cw) }
    }

    test('a uniform solid body, a bold head in the suggestion color, a pip in the warning color', () => {
      const s = state()
      const [hx, hy] = s.body[0]!
      expect(cell(s, hx, hy).text).toBe('██')
      expect(cell(s, hx, hy).seg.slice(1)).toEqual(['suggestion', '', 1])
      for (const [bx, by] of s.body.slice(1)) {
        expect(cell(s, bx, by).text, `${bx},${by}`).toBe('██')
        expect(cell(s, bx, by).seg.slice(1), `${bx},${by}`).toEqual(['success', '', 0])
      }
      expect(cell(s, 10, 1).text).toBe('██')
      expect(cell(s, 10, 1).seg.slice(1)).toEqual(['warning', '', 0])
    })

    test('a dead head turns error red', () => {
      const s = state({ dead: true })
      const [hx, hy] = s.body[0]!
      expect(cell(s, hx, hy).seg.slice(1)).toEqual(['error', '', 1])
    })

    test('the grid says where each field cell is drawn: centered, and scrolled in a narrow band', () => {
      for (const cols of [100, 70, 30]) {
        const s = state({ body: [[20, 3], [19, 3], [18, 3]] })
        const d = gameOf('tailchase').draw(s, cols, TAILCHASE.h)
        const g = d.grid!
        const row = d.rows[3 - g.oy]!
        const head = runs(row).find(([, seg]) => seg[1] === 'suggestion')!
        expect(head[0], `${cols} cols`).toBe(g.x + (20 - g.ox) * g.cw)
        // The rails stand just outside the grid's window, which fits the band.
        expect(rowText(row)[g.x - 1], `${cols} cols`).toBe('│')
        expect(rowText(row)[g.x + g.vw * g.cw], `${cols} cols`).toBe('│')
        expect(g.x + g.vw * g.cw + 1, `${cols} cols`).toBeLessThanOrEqual(cols)
        expect(g.vw).toBeLessThanOrEqual(g.w)
      }
    })
  })

  describe('cratehop', () => {
    const run = (over: Partial<HalftimeCratehop> = {}): HalftimeCratehop => ({
      rng: 1, x: 100.5, y: 0, vy: 0, obs: [], nextX: 1e9, dead: false, buffered: false, ...over,
    })
    const drawn = (s: HalftimeCratehop) => gameOf('cratehop').draw(s, 100, CRATEHOP.rows).rows
    /** The courier's runs in each row (the only suggestion-colored thing in this field). */
    const courier = (rows: Seg[][]) => rows.map(row => runs(row).filter(([, seg]) => seg[1] === 'suggestion'))

    /** Bolt's runs in each row: the cells painted in Bolt's own palette (MM-091). */
    const BOLT_COLORS = new Set<string>(Object.values(BOLT_PALETTE))
    const boltIn = (rows: Seg[][]) => rows.map(row => runs(row).filter(([, seg]) => BOLT_COLORS.has(seg[1]) || BOLT_COLORS.has(seg[2])))
    /** A pose's lines as drawn: its see-through cells left out. */
    const poseText = (pose: Parameters<typeof boltCells>[1]) =>
      boltCells('tiny', pose as 'idle').map(line => line.filter(c => c.fg !== undefined || c.bg !== undefined).map(c => c.ch).join(''))
    const used = (found: ReturnType<typeof boltIn>) => found.flatMap((r, i) => (r.length ? [i] : []))
    const textOf = (found: ReturnType<typeof boltIn>, i: number) => found[i]!.map(([, seg]) => seg[0]).join('')

    test('on the ground the courier is Bolt running, feet on the floor row above the track', () => {
      const s = run()
      const found = boltIn(drawn(s))
      expect(used(found)).toEqual([2, 3])
      const pose = BOLT_RUN[Math.floor(s.x / 1.5) % 2]!
      expect([textOf(found, 2), textOf(found, 3)]).toEqual(poseText(pose))
      // The run frames swap as the courier runs.
      expect(boltCells('tiny', 'run1')).not.toEqual(boltCells('tiny', 'run2'))
    })

    test('in the air Bolt rises together in the jump pose, at the same column', () => {
      const ground = boltIn(drawn(run()))
      const air = boltIn(drawn(run({ y: 1.6, vy: 5 })))
      expect(used(air)).toEqual([1, 2])
      expect([textOf(air, 1), textOf(air, 2)]).toEqual(poseText('jump'))
      expect(Math.min(...air.flat().map(([at]) => at))).toBe(Math.min(...ground.flat().map(([at]) => at)))
    })

    test('crates are solid blocks, tall ones two cells high', () => {
      const rows = drawn(run({ obs: [[106, 2, 1], [112, 1, 2]] }))
      expect(rowText(rows[3]!)).toContain('██')
      expect(rows[3]!.filter(seg => seg[0].includes('█')).every(seg => seg[1] === 'warning')).toBe(true)
      const tall = rows[2]!.filter(seg => seg[0].includes('█'))
      expect(tall.map(seg => seg[0])).toEqual(['█'])
      expect(tall[0]![1]).toBe('warning')
      expect(rowText(rows[1]!)).not.toContain('█')
    })

    test('a crash is Bolt in its crash pose where the courier was', () => {
      const found = boltIn(drawn(run({ dead: true })))
      expect(used(found)).toEqual([2, 3])
      expect([textOf(found, 2), textOf(found, 3)]).toEqual(poseText('crash'))
    })

    test('the sky is clear: nothing but the courier and the crates above the floor', () => {
      for (const x of [0, 33.3, 250.7, 1999]) {
        for (const row of drawn(run({ x, obs: [] })).slice(0, 4)) expect(rowText(row).replace(/[│▀▄█]/g, '').trim(), `x=${x}`).toBe('')
      }
    })
  })

  describe('merge', () => {
    test('tiles are solid blocks of color with a bold dark letter dead center; empty places are wells', () => {
      const s = { ...initMerge(4), cells: [1, 0, 3, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2] }
      const places = inside(gameOf('merge').draw(s, 100, 4).rows[0]!).filter(seg => seg[2] !== '')
      // Four places in the row (three tiles and a well): each one solid, all the same width, all different colors.
      expect(places.length).toBe(4)
      expect(new Set(places.map(seg => seg[0].length)).size).toBe(1)
      expect(new Set(places.map(seg => seg[2])).size).toBe(4)
      const letters = places.filter(seg => seg[0].trim() !== '')
      expect(letters.map(seg => seg[0].trim())).toEqual(['A', 'C', 'L'])
      for (const seg of letters) {
        expect(seg[1]).toBe('#111418')
        expect(seg[3]).toBe(1)
        expect(seg[0].indexOf(seg[0].trim())).toBe((seg[0].length - 1) / 2)
      }
      expect(places.filter(seg => seg[2] === WELL).map(seg => seg[0].trim())).toEqual([''])
    })
  })

  describe('sweep', () => {
    const field = (): HalftimeSweep => initSweep(dailySeed('sweep', '2026-10-09'))

    test('every cell is painted: closed cells are slabs in two close greys, opened ones the dark floor', () => {
      const cells = gameOf('sweep').draw(field(), 100, 6).rows.flatMap(inside)
      for (const seg of cells) expect([...SLAB, FLOOR], seg[0]).toContain(seg[2])
      expect(new Set(cells.map(seg => seg[2]))).toEqual(new Set([...SLAB, FLOOR]))
    })

    test('the cursor, flags and mines sit where the grid says', () => {
      const s = field()
      const d = gameOf('sweep').draw(s, 100, 6)
      const g = d.grid!
      const cursor = runs(d.rows[s.cur[1] - g.oy]!).find(([, seg]) => (seg[3] & INVERSE) !== 0)!
      expect(cursor[0]).toBe(g.x + (s.cur[0] - g.ox) * g.cw)
      expect(cursor[1][0].length).toBe(g.cw)
      // A flag on the first closed cell is drawn exactly in its place.
      const i = s.open.indexOf(0)
      const [fx, fy] = [i % s.w, Math.floor(i / s.w)]
      const df = gameOf('sweep').draw({ ...s, flag: s.flag.map((f, k) => (k === i ? 1 : f)) }, 100, 6)
      const at = g.x + (fx - g.ox) * g.cw
      expect(rowText(df.rows[fy - g.oy]!).slice(at, at + g.cw)).toBe(' ▲')
      // A lost field shows its mines as bold red burst marks, the one that went off inverted.
      const dl = gameOf('sweep').draw(revealAt(s, s.mines.indexOf(1)), 100, 6)
      const marks = dl.rows.flatMap(row => row.filter(seg => /^( ✶)+$/.test(seg[0])))
      expect(marks.length).toBeGreaterThan(0)
      expect(marks.every(seg => seg[1] === 'error' && (seg[3] & 1) !== 0)).toBe(true)
      expect(marks.filter(seg => (seg[3] & INVERSE) !== 0).map(seg => seg[0])).toEqual([' ✶'])
    })

    test('a narrow band scrolls the field inside the rails and the grid still matches', () => {
      const s = { ...field(), cur: [15, 5] as [number, number] }
      const d = gameOf('sweep').draw(s, 30, 6)
      const g = d.grid!
      expect(g.ox).toBeGreaterThan(0)
      expect(g.vw * g.cw + 2).toBeLessThanOrEqual(30)
      const cursor = runs(d.rows[5 - g.oy]!).find(([, seg]) => (seg[3] & INVERSE) !== 0)!
      expect(cursor[0]).toBe(g.x + (15 - g.ox) * g.cw)
    })
  })
})
