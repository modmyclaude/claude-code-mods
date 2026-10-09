// MM-089: the proofs that all four games are easy to start, get gradually
// harder up to a cap, forgive, and can always be beaten. Each game's course or
// board is a pure function of its seed, so these walk every daily board for a
// year (from 2026-10-09) and a set of practice seeds, and play them with a
// bot or a solver that sees only what a player sees.

import { describe, expect, test } from 'claude-code/testing'

import type { HalftimeCratehop, HalftimeGameId, HalftimeMerge, HalftimeSweep, HalftimeTailchase } from '../types'
import { CRATEHOP, airDistance, clearWindowMs, initCratehop, jumpCratehop, layout, minGap, reactionMs, speedAt, stepCratehop, timeToLand } from '../hooks/games/cratehop'
import { GAME_IDS, gameOf } from '../hooks/games'
import { OPENING_MOVES, canMove, highChance, initMerge, moveMerge, pointsFor, slide, spawn, type Direction } from '../hooks/games/merge'
import { TAILCHASE, initTailchase, moveTailchase, reachableCells, stepMs, stepTailchase, turnTailchase } from '../hooks/games/tailchase'
import { SWEEP, countAdjacent, dealSweep, initSweep, latticeMines, neighbors, revealAt, solves } from '../hooks/games/sweep'
import { dailySeed, dayKey, fnv1a, practiceSeed, rand } from '../hooks/rng'

const LONG = { timeoutMs: 60_000 }

/** What the ticket asks for, written out so a change to a constant cannot quietly move the goalposts. */
const REACT_MS = 250
const BUFFER_MS = 120

// ---- the seeds every proof walks -------------------------------------------------------------

/** 2026-10-09, noon: the first of the 365 daily boards. */
const DAYS = 365
const day = (i: number) => dayKey(new Date(2026, 9, 9 + i, 12).getTime())
const dailySeeds = (game: HalftimeGameId) => Array.from({ length: DAYS }, (_, i) => dailySeed(game, day(i)))
const practiceSeeds = (game: HalftimeGameId, n: number) =>
  Array.from({ length: n }, (_, i) => practiceSeed(game, new Date(2026, 9, 9, 15).getTime() + i * 1013, i + 1))

describe('the seeds', () => {
  test('a year of days, one seed each, from 2026-10-09 to 2027-10-08', () => {
    expect(day(0)).toBe('2026-10-09')
    expect(day(DAYS - 1)).toBe('2027-10-08')
    for (const game of GAME_IDS) expect(new Set(dailySeeds(game)).size, game).toBe(DAYS)
    expect(new Set(practiceSeeds('sweep', 200)).size).toBe(200)
  })
})

// ---- cratehop ----------------------------------------------------------------------------------

describe('cratehop', () => {
  const flat = (over: Partial<HalftimeCratehop> = {}): HalftimeCratehop => ({
    rng: 1, x: 0, y: 0, vy: 0, obs: [], nextX: 1e9, dead: false, buffered: false, ...over,
  })

  /** The distance at which the ramp reaches the cap. */
  const capX = (() => {
    let x = 0
    while (speedAt(x) < CRATEHOP.vmax) x += 1
    return x
  })()

  const seeds = [...dailySeeds('cratehop'), ...practiceSeeds('cratehop', 50)]

  test('the first ten seconds are gentle: the start speed, a long run-up, low crates, wide gaps', () => {
    // Ten seconds at the start speed, exactly.
    expect(CRATEHOP.gentle / CRATEHOP.v0).toBe(10)
    for (const x of [0, 30, CRATEHOP.gentle]) expect(speedAt(x), `x=${x}`).toBe(CRATEHOP.v0)
    expect(CRATEHOP.runUp / CRATEHOP.v0).toBeGreaterThanOrEqual(4.5)
    for (const seed of seeds) {
      const course = layout(initCratehop(seed), 400).obs
      expect(course[0]![0], `seed ${seed}`).toBeGreaterThanOrEqual(CRATEHOP.runUp)
      for (let i = 0; i < course.length; i += 1) {
        const [ox, w, h] = course[i]!
        // Nothing tall and nothing wider than one cell until the player has had a while.
        if (ox < 100) expect([w, h], `seed ${seed} crate ${i}`).toEqual([1, 1])
        if (ox < 150) expect(h, `seed ${seed} crate ${i}`).toBe(1)
        // Early gaps are wider than the least the rule allows: at least 5 cells of extra room.
        if (i > 0 && ox < 150) {
          const [px, pw] = course[i - 1]!
          expect(ox - (px + pw), `seed ${seed} crate ${i}`).toBeGreaterThanOrEqual(minGap(speedAt(ox)) + 5)
        }
      }
    }
  })

  test('the ramp is slow - 0.2 cells/s gained a second at most - and ends at the cap, about 80 s after the gentle start', () => {
    // Walk the course by time: what speed does the player have at each whole second?
    let t = 0
    let x = 0
    const atSecond: number[] = [speedAt(0)]
    while (speedAt(x) < CRATEHOP.vmax) {
      x += 0.1
      t += 0.1 / speedAt(x)
      if (t >= atSecond.length) atSecond.push(speedAt(x))
    }
    for (let i = 1; i < atSecond.length; i += 1) expect(atSecond[i]! - atSecond[i - 1]!, `second ${i}`).toBeLessThanOrEqual(0.2 + 1e-6)
    expect(Math.abs(atSecond[10]! - CRATEHOP.v0)).toBeLessThan(0.01)
    // About 88 s in all (10 gentle, 78 of ramp): neither a sprint nor a crawl.
    expect(t).toBeGreaterThan(70)
    expect(t).toBeLessThan(100)
    // It never falls, and it holds at the cap for ever.
    for (let at = 0; at < 6000; at += 25) expect(speedAt(at + 25)).toBeGreaterThanOrEqual(speedAt(at))
    expect(speedAt(capX)).toBe(CRATEHOP.vmax)
    expect(speedAt(1e7)).toBe(CRATEHOP.vmax)
  })

  test('every gap is at least one full jump plus a 250 ms reaction margin at the speed the runner has there', () => {
    let tightest = Infinity
    let where = ''
    let crates = 0
    for (const seed of seeds) {
      const course = layout(initCratehop(seed), capX + 2500).obs
      for (let i = 1; i < course.length; i += 1) {
        const [px, pw] = course[i - 1]!
        const ox = course[i]![0]
        const v = speedAt(ox)
        const gap = ox - (px + pw)
        // Slack over the rule, in cells: the jump, then the reaction time at that speed, and `minGap`'s rounding up.
        const slack = Math.min(gap - (airDistance(v) + (v * REACT_MS) / 1000), gap - minGap(v))
        crates += 1
        if (slack < tightest) {
          tightest = slack
          where = `seed ${seed} crate ${i}`
        }
      }
    }
    expect(crates).toBeGreaterThan(40_000)
    expect(tightest, where).toBeGreaterThanOrEqual(0)
  })

  test('every crate can be cleared with a 250 ms timing window or more, at any speed up to the cap', () => {
    // The tallest crate is under the jump's peak with room to spare.
    const peak = (CRATEHOP.jump * CRATEHOP.jump) / (2 * CRATEHOP.gravity)
    let tallest = 0
    let widest = 0
    let narrowest = Infinity
    let where = ''
    for (const seed of seeds) {
      for (const [ox, w, h] of layout(initCratehop(seed), capX + 1500).obs) {
        tallest = Math.max(tallest, h)
        widest = Math.max(widest, w)
        const window = clearWindowMs(speedAt(ox), w, h)
        if (window < narrowest) {
          narrowest = window
          where = `seed ${seed} crate ${w}x${h} at ${ox}`
        }
      }
    }
    expect(tallest).toBe(2)
    expect(widest).toBe(3)
    expect(peak - tallest).toBeGreaterThan(0.5)
    expect(narrowest, where).toBeGreaterThanOrEqual(250)
    // The worst crate of each height, at the start speed, mid-ramp and the cap.
    for (const v of [CRATEHOP.v0, speedAt(600), speedAt(1200), CRATEHOP.vmax]) {
      for (const [w, h] of [[3, 1], [2, 2]] as const) expect(clearWindowMs(v, w, h), `v=${v} ${w}x${h}`).toBeGreaterThanOrEqual(250)
    }
  })

  test('the window means what it says: a take-off inside it clears the crate, one outside it hits', () => {
    // Past the ramp the speed is steady, so a take-off time maps straight to a distance.
    const v = CRATEHOP.vmax
    for (const [w, h] of [[2, 2], [3, 1], [1, 2]] as const) {
      const ox = capX + 300
      const window = clearWindowMs(v, w, h)
      // The take-off point that puts the jump's apex over the middle of the crate.
      const ideal = ox + w / 2 - airDistance(v) / 2
      const dies = (offsetMs: number): boolean => {
        let s = flat({ x: ideal - 30, obs: [[ox, w, h]] })
        const at = ideal + (v * offsetMs) / 1000
        while (s.x < at) s = stepCratehop(s, 1)
        s = jumpCratehop(s)
        while (!s.dead && s.x < ox + w + 6) s = stepCratehop(s, 4)
        return s.dead
      }
      const inside = window / 2 - 15
      const outside = window / 2 + 15
      expect(dies(0), `${w}x${h}`).toBe(false)
      expect(dies(inside), `${w}x${h} late`).toBe(false)
      expect(dies(-inside), `${w}x${h} early`).toBe(false)
      expect(dies(outside), `${w}x${h} too late`).toBe(true)
      expect(dies(-outside), `${w}x${h} too early`).toBe(true)
    }
  })

  test('the cap leaves 250 ms to see and answer a crate on the narrowest fair board, and is the last speed that does', () => {
    // A 24-column band: a 22-cell field, so the courier sees 15 cells ahead.
    expect(reactionMs(CRATEHOP.vmax, 22)).toBeGreaterThanOrEqual(250)
    expect(reactionMs(CRATEHOP.vmax + 1.5, 22)).toBeLessThan(250)
    // Wider boards leave more, and so does anything slower.
    expect(reactionMs(CRATEHOP.vmax, 38)).toBeGreaterThan(reactionMs(CRATEHOP.vmax, 22))
    expect(reactionMs(CRATEHOP.v0, 22)).toBeGreaterThan(reactionMs(CRATEHOP.vmax, 22))
    for (let x = 0; x < capX + 500; x += 50) expect(reactionMs(speedAt(x), 22), `x=${x}`).toBeGreaterThanOrEqual(250)
  })

  describe('forgiveness', () => {
    const air = () => jumpCratehop(flat())
    /** Steps a flat course in 2 ms slices until `done`. */
    const fly = (s: HalftimeCratehop, done: (t: HalftimeCratehop) => boolean): HalftimeCratehop => {
      let n = 0
      while (!done(s) && n < 1000) {
        s = stepCratehop(s, 2)
        n += 1
      }
      return s
    }
    const descending = (ms: number) => fly(air(), t => t.vy < 0 && timeToLand(t.y, t.vy) * 1000 <= ms)

    test('timeToLand is the real time the physics takes', () => {
      expect(timeToLand(0, 0)).toBe(0)
      expect(Math.abs(timeToLand(0, CRATEHOP.jump) - (2 * CRATEHOP.jump) / CRATEHOP.gravity)).toBeLessThan(1e-9)
      let s = descending(100)
      const predicted = timeToLand(s.y, s.vy) * 1000
      let ms = 0
      while (s.y > 0 && ms < 400) {
        s = stepCratehop(s, 2)
        ms += 2
      }
      expect(Math.abs(ms - predicted)).toBeLessThanOrEqual(8)
    })

    test('a jump pressed up to 120 ms before landing fires on touchdown', () => {
      expect(CRATEHOP.bufferMs).toBe(BUFFER_MS)
      for (const ms of [20, 60, 100, BUFFER_MS - 1]) {
        const pressed = jumpCratehop(descending(ms))
        expect(pressed.buffered, `${ms} ms`).toBe(true)
        const landed = fly(pressed, t => t.y === 0 && t.vy > 0)
        expect(landed.buffered, `${ms} ms`).toBe(false)
        expect(landed.vy, `${ms} ms`).toBe(CRATEHOP.jump)
        // It really leaves the ground again.
        expect(stepCratehop(landed, 40).y, `${ms} ms`).toBeGreaterThan(0)
      }
    })

    test('a press that is too early, or on the way up, is not kept; the click and the key are the same jump', () => {
      const early = descending(BUFFER_MS + 60)
      expect(jumpCratehop(early)).toBe(early)
      const rising = fly(air(), t => t.y > 1 && t.vy > 0)
      expect(jumpCratehop(rising)).toBe(rising)
      const landed = fly(early, t => t.y === 0)
      expect(landed.vy).toBe(0)
      expect(landed.buffered).toBe(false)
      // A click anywhere on the board jumps, and a key does too.
      expect(gameOf('cratehop').click!(flat(), 3, 1, 'left')).toEqual(jumpCratehop(flat()))
      for (const key of ['space', 'up', 'w', 'k']) expect(gameOf('cratehop').act(flat(), gameOf('cratehop').controls[key]!), key).toEqual(jumpCratehop(flat()))
    })

    test('a dead courier ignores the buffer', () => {
      const dead = flat({ dead: true })
      expect(jumpCratehop(dead)).toBe(dead)
    })
  })

  /**
   * A human-like player. It sees a crate only once its near edge is on the
   * field, and may act on it 250 ms later. From then it watches the crate come
   * and presses when the take-off point that puts the jump's apex over the
   * crate is reached, give or take +-60 ms of timing error (drawn once per
   * crate from a fixed seed). It plays at the board's own 60 ms frame, so a key
   * is acted on at the next frame, as in the real band.
   */
  function human(seed: number, until: number, field: number, opts: { jitterMs?: number } = {}): { dead: boolean; x: number; jumps: number } {
    const jitterMs = opts.jitterMs ?? 60
    let s = initCratehop(seed)
    let noise = fnv1a(`jitter/${seed}`)
    const seen = new Map<number, { at: number; jit: number; w: number }>()
    const done = new Set<number>()
    let t = 0
    let jumps = 0
    while (!s.dead && s.x < until) {
      const cam = Math.floor(s.x) - CRATEHOP.col
      for (const [ox, w] of s.obs) {
        if (ox + w <= s.x || seen.has(ox) || ox > cam + field - 1) continue
        let r: number
        ;[r, noise] = rand(noise)
        seen.set(ox, { at: t, jit: (r * 2 - 1) * jitterMs, w })
      }
      const v = speedAt(s.x)
      let press = false
      for (const [ox, crate] of seen) {
        if (done.has(ox) || t < crate.at + REACT_MS) continue
        const takeoff = ox + crate.w / 2 - airDistance(v) / 2
        if (((takeoff - s.x) / v) * 1000 + crate.jit <= 0) {
          done.add(ox)
          press = true
        }
      }
      if (press) {
        s = jumpCratehop(s)
        jumps += 1
      }
      s = stepCratehop(s, 60)
      t += 60
      if (seen.size > 40) {
        for (const ox of [...seen.keys()]) {
          if (ox >= s.x - 30) continue
          seen.delete(ox)
          done.delete(ox)
        }
      }
    }
    return { dead: s.dead, x: s.x, jumps }
  }

  // The cap regime for more than a minute: from the cap, 61 s at the cap speed.
  const FAR = capX + CRATEHOP.vmax * 61
  /** The narrowest fair board: a 24-column band, 22 field cells. */
  const NARROW = 22

  test('a human-like bot (sees only the screen, reacts in 250 ms, +-60 ms of jitter) clears the cap regime on every daily seed for a year and 50 practice seeds', LONG, () => {
    expect(FAR - capX).toBeGreaterThanOrEqual(60 * CRATEHOP.vmax)
    let jumps = 0
    for (const seed of seeds) {
      const run = human(seed, FAR, NARROW)
      expect(run.dead, `seed ${seed} crashed at ${Math.round(run.x)}`).toBe(false)
      jumps += run.jumps
    }
    // It really played: about one crate in every 30 cells.
    expect(jumps / seeds.length).toBeGreaterThan(FAR / 50)
  })

  test('the same bot also clears 5,000 cells on a wide board, on a sample of the seeds', LONG, () => {
    for (const seed of seeds.filter((_, i) => i % 14 === 0)) {
      const run = human(seed, 5000, 68)
      expect(run.dead, `seed ${seed} crashed at ${Math.round(run.x)}`).toBe(false)
    }
    for (const seed of seeds.filter((_, i) => i % 14 === 3)) {
      const run = human(seed, 5000, NARROW)
      expect(run.dead, `seed ${seed} crashed at ${Math.round(run.x)}`).toBe(false)
    }
  })

  test('the bot is not a pushover: blind past a few cells, or with 200 ms of jitter, it loses', () => {
    for (const seed of seeds.slice(0, 20)) expect(human(seed, FAR, 14).dead, `seed ${seed}`).toBe(true)
    let lost = 0
    for (const seed of seeds.slice(0, 40)) if (human(seed, FAR, NARROW, { jitterMs: 250 }).dead) lost += 1
    expect(lost).toBeGreaterThan(30)
  })
})

// ---- tailchase ---------------------------------------------------------------------------------

describe('tailchase', () => {
  const DX = [0, 1, 0, -1]
  const DY = [-1, 0, 1, 0]
  const key = (w: number, x: number, y: number) => y * w + x

  /** The test's own breadth-first search: the free cells the head can reach, over the wrapping grid. */
  function reach(w: number, h: number, body: readonly [number, number][]): Set<number> {
    const blocked = new Set(body.map(([x, y]) => key(w, x, y)))
    const out = new Set<number>()
    const queue: [number, number][] = [body[0]!]
    for (let q = 0; q < queue.length; q += 1) {
      const [x, y] = queue[q]!
      for (let d = 0; d < 4; d += 1) {
        const nx = (x + DX[d]! + w) % w
        const ny = (y + DY[d]! + h) % h
        const k = key(w, nx, ny)
        if (blocked.has(k) || out.has(k)) continue
        out.add(k)
        queue.push([nx, ny])
      }
    }
    return out
  }

  /** Whether the pip stands on a free cell the head can reach. */
  function pipOk(s: HalftimeTailchase): boolean {
    if (!s.food) return false
    const [fx, fy] = s.food
    return !s.body.some(([x, y]) => x === fx && y === fy) && reach(s.w, s.h, s.body).has(key(s.w, fx, fy))
  }

  /** A careful pilot: of the moves that do not bite, the one that stays in a roomy region and is closest to the pip. */
  function pilot(s: HalftimeTailchase): number {
    const { w, h, body, food, dir } = s
    const head = body[0]!
    let best = -1
    let bestScore = Infinity
    for (let d = 0; d < 4; d += 1) {
      if ((d + 2) % 4 === dir) continue
      const nx = (head[0] + DX[d]! + w) % w
      const ny = (head[1] + DY[d]! + h) % h
      const rest = s.grow > 0 ? body : body.slice(0, -1)
      if (rest.some(([x, y]) => x === nx && y === ny)) continue
      const after: [number, number][] = [[nx, ny], ...rest]
      const open = reach(w, h, after)
      const eats = food !== null && food[0] === nx && food[1] === ny
      // Steps to the pip over the cells that stay free.
      let far = 0
      if (food && !eats) {
        const seen = new Map<number, number>([[key(w, nx, ny), 0]])
        const queue: [number, number][] = [[nx, ny]]
        far = 500
        for (let q = 0; q < queue.length && far === 500; q += 1) {
          const [x, y] = queue[q]!
          for (let k = 0; k < 4; k += 1) {
            const ax = (x + DX[k]! + w) % w
            const ay = (y + DY[k]! + h) % h
            const id = key(w, ax, ay)
            if (seen.has(id) || (!open.has(id) && !(ax === food[0] && ay === food[1]))) continue
            seen.set(id, seen.get(key(w, x, y))! + 1)
            if (ax === food[0] && ay === food[1]) far = seen.get(id)!
            queue.push([ax, ay])
          }
        }
      }
      const roomy = open.size >= rest.length
      const score = (roomy ? 0 : 1000) + far
      if (score < bestScore) {
        bestScore = score
        best = d
      }
    }
    return best < 0 ? dir : best
  }

  test('it starts slow, quickens a little per pip, and the speed caps', () => {
    expect(stepMs(0)).toBeGreaterThanOrEqual(220)
    expect(stepMs(0) - stepMs(1)).toBeLessThanOrEqual(5)
    expect(TAILCHASE.floorMs).toBeGreaterThanOrEqual(100)
    let capAt = -1
    for (let eaten = 0; eaten < 300; eaten += 1) {
      expect(stepMs(eaten + 1), `eaten ${eaten}`).toBeLessThanOrEqual(stepMs(eaten))
      expect(stepMs(eaten), `eaten ${eaten}`).toBeGreaterThanOrEqual(TAILCHASE.floorMs)
      if (capAt < 0 && stepMs(eaten) === TAILCHASE.floorMs) capAt = eaten
    }
    // A long way in, not a few pips: the cap is a limit for a good run.
    expect(capAt).toBeGreaterThanOrEqual(30)
    expect(stepMs(1_000_000)).toBe(TAILCHASE.floorMs)
  })

  test('every pip lands on a free cell the head can reach, across many seeds and long scripted games, and the speed caps', LONG, () => {
    const seeds = [...dailySeeds('tailchase').slice(0, 20), ...practiceSeeds('tailchase', 12)]
    let best = 0
    let capped = 0
    let pipsChecked = 0
    for (const seed of seeds) {
      let s = initTailchase(seed)
      expect(pipOk(s), `seed ${seed} first pip`).toBe(true)
      let food = s.food
      let atCap: HalftimeTailchase | null = null
      for (let steps = 0; steps < 3000 && !s.dead && !s.won && s.eaten < 80; steps += 1) {
        s = turnTailchase(s, pilot(s))
        s = stepTailchase(s, stepMs(s.eaten))
        if (s.food !== food) {
          food = s.food
          if (food !== null) {
            pipsChecked += 1
            expect(pipOk(s), `seed ${seed} pip ${s.eaten + 1} at ${JSON.stringify(food)}, snake ${s.body.length} long`).toBe(true)
          }
        }
        if (atCap === null && s.eaten >= 40 && !s.dead && !s.won) atCap = s
      }
      best = Math.max(best, s.eaten)
      if (atCap !== null) {
        capped += 1
        // Past the cap a step still takes the floor: a millisecond less moves nothing, the floor itself moves the head.
        expect(stepMs(atCap.eaten)).toBe(TAILCHASE.floorMs)
        expect(stepTailchase(atCap, TAILCHASE.floorMs - 1).body[0], `seed ${seed}`).toEqual(atCap.body[0])
        const stepped = stepTailchase(atCap, TAILCHASE.floorMs)
        expect(stepped.dead || stepped.body[0]!.join() !== atCap.body[0]!.join(), `seed ${seed}`).toBe(true)
      }
    }
    // The pilot got past the cap in most games, so the cap is exercised, not assumed.
    expect(pipsChecked).toBeGreaterThan(500)
    expect(capped).toBeGreaterThanOrEqual(Math.floor(seeds.length / 2))
    expect(best).toBeGreaterThanOrEqual(40)
  })

  test('a pip is never placed in a pocket the body has walled off', () => {
    // A 4x4 ring of body on an 8x6 torus seals a 2x2 pocket; the head eats a pip just outside it and the body keeps growing.
    const ring: [number, number][] = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [3, 0], [2, 0], [1, 0]]
    const pocket = new Set([key(8, 1, 1), key(8, 2, 1), key(8, 1, 2), key(8, 2, 2)])
    expect(reach(8, 6, ring).has(key(8, 1, 1))).toBe(false)
    expect(reachableCells(8, 6, ring).some(([x, y]) => pocket.has(key(8, x, y)))).toBe(false)
    for (let seed = 1; seed <= 300; seed += 1) {
      const start: HalftimeTailchase = {
        w: 8, h: 6, body: ring, dir: 3, queue: [], food: [7, 0], grow: 1, rng: seed, acc: 0, eaten: 0, dead: false, won: false,
      }
      const s = moveTailchase(start)
      expect(s.eaten, `seed ${seed}`).toBe(1)
      expect(s.food, `seed ${seed}`).not.toBeNull()
      expect(pocket.has(key(8, s.food![0], s.food![1])), `seed ${seed}`).toBe(false)
      expect(pipOk(s), `seed ${seed}`).toBe(true)
    }
  })

  test('a head with nowhere to go gets no pip until the body opens up, and then one appears', () => {
    // A 3x3 torus: the body fills eight cells around the head, the ninth is cut off.
    const body: [number, number][] = [[1, 1], [1, 0], [0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1]]
    expect(reachableCells(3, 3, body)).toEqual([])
    const stuck: HalftimeTailchase = { w: 3, h: 3, body, dir: 1, queue: [], food: null, grow: 0, rng: 7, acc: 0, eaten: 0, dead: false, won: false }
    // The head steps into the tail's cell, which frees (2, 0) for it.
    const freed = moveTailchase(stuck)
    expect(freed.dead).toBe(false)
    expect(freed.won).toBe(false)
    expect(freed.food).toEqual([2, 0])
    expect(pipOk(freed)).toBe(true)
  })

  test('the first pip of every daily game is free and reachable', () => {
    for (const seed of dailySeeds('tailchase')) {
      const s = initTailchase(seed)
      expect(pipOk(s), `seed ${seed}`).toBe(true)
    }
  })

  test('grace: a turn pressed just before a step applies at that step, and up to three wait in line', () => {
    const snake = (over: Partial<HalftimeTailchase> = {}): HalftimeTailchase => ({ ...initTailchase(9), food: null, ...over })
    const s = snake()
    const due = stepMs(0)
    // One millisecond short of the step: nothing yet. Press up. One millisecond later: the turn is taken.
    const waiting = stepTailchase(s, due - 1)
    expect(waiting.body[0]).toEqual(s.body[0])
    const turned = stepTailchase(turnTailchase(waiting, 0), 1)
    expect(turned.body[0]).toEqual([s.body[0]![0], s.body[0]![1] - 1])
    // A flurry of turns is not lost.
    let flurry = snake({ body: [[10, 3], [9, 3], [8, 3]] })
    for (const dir of [0, 3, 2, 1]) flurry = turnTailchase(flurry, dir)
    expect(flurry.queue).toEqual([0, 3, 2])
  })

  test('grace: a step that would bite is held for 100 ms, and a turn pressed in that time saves the snake', () => {
    const loop: [number, number][] = [[2, 2], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2]]
    const doomed: HalftimeTailchase = { ...initTailchase(9), food: null, body: loop, dir: 2 }
    const due = stepMs(0)
    /** Real time in 10 ms frames, as the board delivers it. */
    const run = (s: HalftimeTailchase, ms: number) => {
      for (let t = 0; t < ms; t += 10) s = stepTailchase(s, 10)
      return s
    }
    // The bite is due now, but not yet taken.
    const held = run(doomed, due + 40)
    expect(held.dead).toBe(false)
    expect(held.body).toEqual(loop)
    // A turn pressed in the grace is taken at once: left, into the cell the tail has just left.
    const saved = stepTailchase(turnTailchase(held, 3), 10)
    expect(saved.dead).toBe(false)
    expect(saved.body[0]).toEqual([1, 2])
    // With no turn, the bite comes once the grace has run out - and not before.
    expect(run(doomed, due + TAILCHASE.graceMs - 20).dead).toBe(false)
    expect(run(doomed, due + TAILCHASE.graceMs + 20).dead).toBe(true)
    expect(TAILCHASE.graceMs).toBeLessThanOrEqual(120)
  })
})

// ---- sweep -------------------------------------------------------------------------------------

describe('sweep', () => {
  /**
   * An independent solver, written for the test: it plays through the game's
   * own `revealAt`, looks only at what a player sees (the open cells and their
   * numbers), and uses the single-cell rules and the subset rule. It never
   * guesses; it returns when it has nothing left to deduce.
   */
  function solve(start: HalftimeSweep): { s: HalftimeSweep; mines: Set<number> } {
    let s = start
    const mines = new Set<number>()
    for (let pass = 0; pass < 500 && !s.won && !s.dead; pass += 1) {
      let moved = false
      const rules: { closed: number[]; left: number }[] = []
      for (let i = 0; i < s.w * s.h; i += 1) {
        if (!s.open[i] || s.adj[i] === 0) continue
        const around = neighbors(s.w, s.h, i)
        const closed = around.filter(j => !s.open[j] && !mines.has(j))
        if (closed.length === 0) continue
        const left = s.adj[i]! - around.filter(j => mines.has(j)).length
        if (left === 0) {
          for (const j of closed) s = revealAt(s, j)
          moved = true
        } else if (left === closed.length) {
          for (const j of closed) mines.add(j)
          moved = true
        } else rules.push({ closed, left })
      }
      if (moved) continue
      for (const a of rules) {
        for (const b of rules) {
          if (a.closed.length >= b.closed.length || !a.closed.every(j => b.closed.includes(j))) continue
          const rest = b.closed.filter(j => !a.closed.includes(j))
          const extra = b.left - a.left
          if (extra === 0) {
            for (const j of rest) s = revealAt(s, j)
            moved = true
          } else if (extra === rest.length) {
            for (const j of rest) mines.add(j)
            moved = true
          }
        }
      }
      if (!moved) break
    }
    return { s, mines }
  }

  const seeds = [...dailySeeds('sweep'), ...practiceSeeds('sweep', 200)]

  test('the solver is honest: on a board that needs a guess it gets stuck (and so does the production verifier)', () => {
    // 3x2 with one mine in the middle column, top or bottom: every number that is shown sees both candidates.
    const mines = [0, 1, 0, 0, 0, 0]
    const adj = countAdjacent(3, 2, mines)
    const open = [1, 0, 1, 1, 0, 1]
    expect(solves(3, 2, mines, adj, open)).toBe(false)
    const s: HalftimeSweep = { w: 3, h: 2, mines, adj, open, flag: [0, 0, 0, 0, 0, 0], cur: [0, 0], dead: false, won: false, boom: -1 }
    const out = solve(s)
    expect(out.s.won).toBe(false)
    expect(out.s.dead).toBe(false)
    // And a board that is solvable is solved: a single mine in a corner.
    const easy = initSweep(1, 4, 3, 1)
    expect(solve(easy).s.won).toBe(true)
  })

  test('the solver clears every daily board for a year and 200 practice seeds with no guess', LONG, () => {
    for (const seed of seeds) {
      const board = initSweep(seed)
      // The fair density, never thinned by the fallback.
      expect(board.mines.reduce((n, m) => n + m, 0), `seed ${seed}`).toBe(SWEEP.mines)
      const { s, mines } = solve(board)
      expect(s.dead, `seed ${seed} hit a mine`).toBe(false)
      expect(s.won, `seed ${seed} left a guess`).toBe(true)
      // Everything it marked was a mine.
      for (const m of mines) expect(board.mines[m], `seed ${seed}`).toBe(1)
      // The production verifier agrees.
      expect(solves(board.w, board.h, board.mines, board.adj, initSweep(seed).open), `seed ${seed}`).toBe(true)
    }
  })

  test('the opening is a safe pocket that shows something, for every board', () => {
    for (const seed of seeds) {
      const b = initSweep(seed)
      const opened = b.open.reduce((n, o) => n + o, 0)
      expect(opened, `seed ${seed}`).toBeGreaterThanOrEqual(9)
      expect(b.open.some((o, i) => o === 1 && b.mines[i] === 1), `seed ${seed}`).toBe(false)
      // The cursor starts on an opened cell with no mine around it.
      const at = b.cur[1] * b.w + b.cur[0]
      expect([b.open[at], b.adj[at]], `seed ${seed}`).toEqual([1, 0])
    }
  })

  test('the board is a pure function of the seed', () => {
    for (const seed of seeds.slice(0, 40)) expect(initSweep(seed)).toEqual(initSweep(seed))
    expect(dealSweep(77, 16, 6, 40)).toEqual(dealSweep(77, 16, 6, 40))
  })

  test('regeneration is bounded: a density no logic can solve falls back to a sparse board that still can, fast', () => {
    for (const seed of [1, 2, 3, 20261009]) {
      const began = performance.now()
      // 90 mines on 96 cells: nothing can open a pocket, at this density or either thinner one tried.
      const board = initSweep(seed, 16, 6, 90)
      const took = performance.now() - began
      expect(took, `seed ${seed}`).toBeLessThan(50)
      const mines = board.mines.reduce((n, m) => n + m, 0)
      expect(mines, `seed ${seed}`).toBeLessThan(90)
      expect(mines, `seed ${seed}`).toBeGreaterThan(0)
      expect(solve(board).s.won, `seed ${seed}`).toBe(true)
    }
    // The last resort itself, as dealt.
    const lattice = latticeMines(16, 6, 12)
    expect(lattice.reduce((n, m) => n + m, 0)).toBe(8)
    // A heavier-than-normal request is thinned only as far as it must be.
    for (const seed of [4, 5, 6]) {
      const heavy = initSweep(seed, 16, 6, 24)
      expect(solve(heavy).s.won, `seed ${seed}`).toBe(true)
    }
  })

  test('mine density is fixed and fair: 12 of 96 cells', () => {
    expect(SWEEP.mines / (SWEEP.w * SWEEP.h)).toBeLessThanOrEqual(0.125)
    expect(SWEEP.tries).toBeLessThanOrEqual(120)
  })
})

// ---- merge -------------------------------------------------------------------------------------

describe('merge', () => {
  const seeds = [...dailySeeds('merge'), ...practiceSeeds('merge', 200)]
  const ALL: Direction[] = ['left', 'right', 'up', 'down']

  /** The unkindest legal move: the one that keeps the most tiles on the board. */
  function worst(cells: readonly number[]): Direction | null {
    let pick: Direction | null = null
    let most = -1
    for (const dir of ALL) {
      const r = slide(cells, dir)
      if (!r.moved) continue
      const tiles = r.cells.filter(v => v > 0).length
      if (tiles > most) {
        most = tiles
        pick = dir
      }
    }
    return pick
  }

  test('a start is never dead: two A tiles in one row or column, so the first slide along it makes a B', () => {
    for (const seed of seeds) {
      const s = initMerge(seed)
      const at = s.cells.flatMap((v, i) => (v > 0 ? [i] : []))
      expect(at.length, `seed ${seed}`).toBe(2)
      expect(s.cells.filter(v => v === 1).length, `seed ${seed}`).toBe(2)
      expect(canMove(s.cells), `seed ${seed}`).toBe(true)
      const sameRow = Math.floor(at[0]! / 4) === Math.floor(at[1]! / 4)
      const sameCol = at[0]! % 4 === at[1]! % 4
      expect(sameRow || sameCol, `seed ${seed}`).toBe(true)
      const moved = moveMerge(s, sameRow ? 'left' : 'up')
      expect(moved.cells.includes(2), `seed ${seed}`).toBe(true)
      expect(moved.points, `seed ${seed}`).toBe(pointsFor(2))
    }
  })

  test('early spawns are the lowest tile: nothing but A for the first moves, whatever is played', () => {
    for (const seed of seeds.slice(0, 120)) {
      let s: HalftimeMerge = initMerge(seed)
      let noise = seed
      for (let move = 0; move < OPENING_MOVES; move += 1) {
        // A pseudo-random legal move.
        const [f, after] = rand(noise)
        noise = after
        const dir = ALL[Math.min(3, Math.floor(f * 4))]!
        const slid = slide(s.cells, dir)
        if (!slid.moved) continue
        const next = moveMerge(s, dir)
        const born = next.cells.flatMap((v, i) => (v > 0 && slid.cells[i] === 0 ? [v] : []))
        expect(born, `seed ${seed} move ${move}`).toEqual([1])
        s = next
      }
    }
    // The odds of a B stay at nothing through the opening, then climb to the old one in eight and stop there.
    expect(OPENING_MOVES).toBeGreaterThanOrEqual(10)
    for (let moves = 0; moves <= OPENING_MOVES; moves += 1) expect(highChance(moves)).toBe(0)
    expect(highChance(OPENING_MOVES + 10)).toBeGreaterThan(0)
    expect(highChance(OPENING_MOVES + 10)).toBeLessThan(0.125)
    expect(highChance(1000)).toBe(0.125)
    for (let moves = 0; moves < 200; moves += 1) expect(highChance(moves + 1)).toBeGreaterThanOrEqual(highChance(moves))
    // And past the opening a B really does come, at about the capped rate.
    const empty = new Array<number>(16).fill(0)
    let bs = 0
    let rng = 99
    for (let i = 0; i < 2000; i += 1) {
      const born = spawn(empty, rng, 500)
      rng = born.rng
      if (born.cells.includes(2)) bs += 1
    }
    expect(bs / 2000).toBeGreaterThan(0.09)
    expect(bs / 2000).toBeLessThan(0.16)
  })

  test('the game can still end, but never in the opening: a board only dies full, and a move adds one tile', () => {
    let soonest = Infinity
    for (const seed of seeds.slice(0, 150)) {
      let s: HalftimeMerge = initMerge(seed)
      for (let move = 0; move < 3000 && !s.over; move += 1) {
        const dir = worst(s.cells)
        if (!dir) break
        s = moveMerge(s, dir)
        // At most two tiles at the start and one more a move: no move before the 14th can fill the board.
        expect(s.cells.filter(v => v > 0).length, `seed ${seed} move ${s.moves}`).toBeLessThanOrEqual(2 + s.moves)
        if (s.moves < 14) expect(s.over, `seed ${seed} move ${s.moves}`).toBe(false)
      }
      // Played unkindly, every game does end.
      expect(s.over, `seed ${seed}`).toBe(true)
      expect(canMove(s.cells)).toBe(false)
      soonest = Math.min(soonest, s.moves)
    }
    expect(soonest).toBeGreaterThanOrEqual(14)
  })
})

// ---- the clock ---------------------------------------------------------------------------------

describe('generation time', () => {
  test('a year of daily boards for all four games, laid out as far as a long run goes, takes a fraction of a second', LONG, () => {
    // Warm the code paths once, so the first call's compile time is not the thing measured.
    for (const id of GAME_IDS) gameOf(id).init(dailySeed(id, '2026-10-08'))
    layout(initCratehop(5), 3000)
    let total = 0
    let slowest = 0
    for (const id of GAME_IDS) {
      for (const seed of dailySeeds(id)) {
        const began = performance.now()
        const state = gameOf(id).init(seed)
        // A long cratehop run lays its course down as it goes; time the whole of 5000 cells at once.
        if (id === 'cratehop') layout(state as HalftimeCratehop, 5000)
        const took = performance.now() - began
        total += took
        slowest = Math.max(slowest, took)
      }
    }
    expect(slowest).toBeLessThan(50)
    expect(total).toBeLessThan(1000)
  })
})
