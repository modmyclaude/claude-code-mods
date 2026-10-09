// The pure rules, table by table: each game's physics or moves, the seeded
// generator, the daily seed, the share line, and the key rule all four games
// must keep (never Enter, y, n or a digit).

import { describe, expect, test } from 'claude-code/testing'

import type { HalftimeCratehop, HalftimeTailchase } from '../types'
import { CRATEHOP, airDistance, hits, initCratehop, jumpCratehop, speedAt, stepCratehop } from '../hooks/games/cratehop'
import { GAME_IDS, beats, gameOf, scoreText } from '../hooks/games'
import { isForbiddenKey, normalizeKey } from '../hooks/games/kit'
import { canMove, initMerge, moveMerge, slide, slideLine, spawn } from '../hooks/games/merge'
import { TAILCHASE, initTailchase, moveTailchase, stepMs, stepTailchase, turnTailchase } from '../hooks/games/tailchase'
import { countAdjacent, flagAt, flood, initSweep, neighbors, revealAt } from '../hooks/games/sweep'
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

  test('collision is the overlap of runner and crate below its top', () => {
    expect(hits([[5, 1, 1]], 5, 0)).toBe(true)
    expect(hits([[5, 1, 1]], 5, 1.2)).toBe(false)
    expect(hits([[5, 1, 2]], 5, 1.2)).toBe(true)
    expect(hits([[5, 1, 1]], 3, 0)).toBe(false)
  })

  test('the course comes from the seed alone and leaves room to land between crates', () => {
    const a = initCratehop(123)
    expect(a.obs).toEqual(initCratehop(123).obs)
    expect(a.obs).not.toEqual(initCratehop(124).obs)
    for (let i = 1; i < a.obs.length; i += 1) {
      const [px, pw] = a.obs[i - 1]!
      const gap = a.obs[i]![0] - (px + pw)
      expect(gap).toBeGreaterThanOrEqual(Math.ceil(airDistance(speedAt(px)) * 0.9))
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

  test('a reversal is ignored; turns queue two deep', () => {
    let s = line()
    expect(turnTailchase(s, 3).queue).toEqual([])
    s = turnTailchase(turnTailchase(turnTailchase(s, 0), 3), 2)
    expect(s.queue).toEqual([0, 3])
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
    expect(a.mines.reduce((n, m) => n + m, 0)).toBe(14)
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
