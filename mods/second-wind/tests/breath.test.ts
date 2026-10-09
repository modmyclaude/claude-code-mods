// The breathing math, table by table: each pattern's phases, the escalation
// schedule, the counts and the soft finish, all as functions of elapsed time.

import { describe, expect, test } from 'claude-code/testing'

import {
  INTERLUDE_MS, SIGH_MS, cycleMs, firstInterludeAt, frameAt, phaseAt, segmentAt, softFinish, tally,
} from '../hooks/breath'
import type { Pattern } from '../hooks/breath'
import type { SecondWindPlan, SecondWindRun } from '../types'

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

describe('phaseAt: (pattern, elapsedMs) -> phase, seconds left, fill', () => {
  const rows: [Pattern, number, string, number, number][] = [
    // pattern, elapsed, phase, secondsLeft, fill
    ['sigh', 0, 'in', 4, 0],
    ['sigh', 2000, 'in', 2, 0.375],
    ['sigh', 3999, 'in', 1, 0.75 * (1 - Math.cos(Math.PI * 3999 / 4000)) / 2],
    ['sigh', 4000, 'sip', 2, 0.75],
    ['sigh', 5000, 'sip', 1, 0.875],
    ['sigh', 6000, 'out', 9, 1],
    ['sigh', 10500, 'out', 5, 0.5],
    ['sigh', 14999, 'out', 1, (1 + Math.cos(Math.PI * 8999 / 9000)) / 2],
    ['sigh', 15000, 'in', 4, 0],
    ['slow', 0, 'in', 6, 0],
    ['slow', 2750, 'in', 3, 0.5],
    ['slow', 5500, 'out', 6, 1],
    ['slow', 8250, 'out', 3, 0.5],
    ['slow', 11000, 'in', 6, 0],
    // a thousand cycles on, exactly where the first one was: no drift
    ['slow', 11000 * 1000 + 2750, 'in', 3, 0.5],
    ['box', 0, 'in', 4, 0],
    ['box', 2000, 'in', 2, 0.5],
    ['box', 4000, 'hold', 4, 1],
    ['box', 7999, 'hold', 1, 1],
    ['box', 8000, 'out', 4, 1],
    ['box', 10000, 'out', 2, 0.5],
    ['box', 12000, 'hold', 4, 0],
    ['box', 16000, 'in', 4, 0],
    // nonsense in, the start out
    ['slow', -500, 'in', 6, 0],
    ['box', Number.NaN, 'in', 4, 0],
  ]
  for (const [pattern, ms, phase, secondsLeft, fill] of rows) {
    test(`${pattern} at ${ms} ms is ${phase} ${secondsLeft}`, () => {
      const b = phaseAt(pattern, ms)
      expect(b.phase).toBe(phase)
      expect(b.secondsLeft).toBe(secondsLeft)
      expect(near(b.fill, fill)).toBe(true)
      expect(b.fill >= 0 && b.fill <= 1).toBe(true)
    })
  }

  test('cycle lengths: the sigh is about 15 s, slow 11 s, box 16 s', () => {
    expect([cycleMs('sigh'), cycleMs('slow'), cycleMs('box')]).toEqual([15000, 11000, 16000])
  })

  // The steepest step is box's 4 s inhale: pi/2 x 100/4000, just under 4% per 100 ms.
  test('fill never leaves 0..1 and moves smoothly (no step larger than 4% per 100 ms)', () => {
    for (const p of ['sigh', 'slow', 'box'] as const) {
      let prev = phaseAt(p, 0).fill
      for (let t = 100; t <= cycleMs(p) * 2; t += 100) {
        const f = phaseAt(p, t).fill
        expect(f >= 0 && f <= 1).toBe(true)
        expect(Math.abs(f - prev) <= 0.04).toBe(true)
        prev = f
      }
    }
  })
})

const plan = (over: Partial<SecondWindPlan> = {}): SecondWindPlan => ({ pattern: 'slow', delayMs: 3000, eyeRest: true, stretch: true, ...over })

describe('segmentAt: the escalation schedule', () => {
  test('the first interlude waits for the first cycle boundary past 60 s of turn time', () => {
    expect(firstInterludeAt(plan())).toBe(59000) // 3 s delay + 15 s sigh + 4 x 11 s = 62 s of turn
    expect(firstInterludeAt(plan({ pattern: 'box' }))).toBe(63000) // 3 + 15 + 3 x 16 = 66 s
    expect(firstInterludeAt(plan({ delayMs: 0 }))).toBe(70000) // 4 cycles would end at 59 s: too soon
    expect(firstInterludeAt(plan({ delayMs: 60000 }))).toBe(SIGH_MS) // already long: right after the sigh
  })

  const rows: [string, Partial<SecondWindPlan>, number, string][] = [
    ['opens with the sigh', {}, 0, 'breath:sigh:in'],
    ['sigh top-up sip', {}, 4500, 'breath:sigh:sip'],
    ['sigh exhale', {}, 9000, 'breath:sigh:out'],
    ['then slow paced breathing', {}, 15000, 'breath:slow:in'],
    ['slow exhale', {}, 21000, 'breath:slow:out'],
    ['box breathing when chosen', { pattern: 'box' }, 15000 + 4000, 'breath:box:hold'],
    ['last breath before the interlude', {}, 58999, 'breath:slow:out'],
    ['eye rest after 60 s', {}, 59000, 'interlude:eyes:0'],
    ['eye rest still', {}, 59000 + INTERLUDE_MS - 1, 'interlude:eyes:0'],
    ['back to breathing', {}, 59000 + INTERLUDE_MS, 'breath:slow:in'],
    ['then a stretch two minutes on', {}, 59000 + 141000, 'interlude:stretch:1'],
    ['and the eyes again', {}, 59000 + 2 * 141000, 'interlude:eyes:2'],
    ['stretch only when eye rest is off', { eyeRest: false }, 59000, 'interlude:stretch:0'],
    ['eyes only when stretch is off', { stretch: false }, 59000 + 141000, 'interlude:eyes:1'],
    ['no interludes: breathing goes on', { eyeRest: false, stretch: false }, 59000, 'breath:slow:in'],
  ]
  for (const [name, over, t, want] of rows) {
    test(name, () => {
      const s = segmentAt(plan(over), t)
      const got = s.kind === 'breath' ? `breath:${s.pattern}:${s.breath.phase}` : `interlude:${s.interlude}:${s.index}`
      expect(got).toBe(want)
    })
  }

  test('an interlude counts down 20 s and drains its fill', () => {
    const s = segmentAt(plan(), 59000 + 5000)
    expect(s.kind).toBe('interlude')
    if (s.kind !== 'interlude') return
    expect(s.secondsLeft).toBe(15)
    expect(near(s.fill, 0.75)).toBe(true)
  })
})

describe('tally: breaths whose exhale ended, interludes begun', () => {
  const rows: [string, Partial<SecondWindPlan>, number, [number, number, number]][] = [
    ['nothing yet', {}, 0, [0, 0, 0]],
    ['sigh not yet out', {}, 14999, [0, 0, 0]],
    ['the sigh counts', {}, 15000, [1, 0, 0]],
    ['first slow breath not yet out', {}, 25999, [1, 0, 0]],
    ['first slow breath out', {}, 26000, [2, 0, 0]],
    ['at the eye rest', {}, 59000, [5, 1, 0]],
    ['after the eye rest', {}, 79000, [5, 1, 0]],
    ['a breath after it', {}, 90000, [6, 1, 0]],
    ['at the stretch', {}, 200000, [16, 1, 1]],
    ['box counts at the end of the exhale, before the last hold', { pattern: 'box' }, 15000 + 12000, [2, 0, 0]],
    ['box one ms before', { pattern: 'box' }, 15000 + 11999, [1, 0, 0]],
    ['stretch only', { eyeRest: false }, 200000, [16, 0, 2]],
  ]
  for (const [name, over, t, [breaths, eyeRests, stretches]] of rows) {
    test(name, () => {
      expect(tally(plan(over), t)).toEqual({ breaths, eyeRests, stretches })
    })
  }
})

describe('softFinish: what the main turn ending does', () => {
  const rows: [string, number, boolean, number, number, number][] = [
    // name, breath time, aborted, ms, fromFill, breaths
    ['mid-inhale: a closing exhale from where it stands', 2000, false, 3375, 0.375, 1],
    ['an inhale barely begun is let go', 500, false, 0, 0, 0],
    ['mid-exhale: the exhale runs out its own time', 10500, false, 4500, 0.5, 1],
    ['slow inhale: half its exhale', 15000 + 2750, false, 2750, 0.5, 2],
    ['interrupted: fold at once, finished breaths only', 15000 + 2750, true, 0, 0, 1],
    ['during the eye rest: fold at once', 60000, false, 0, 0, 5],
  ]
  for (const [name, t, isAborted, ms, fromFill, breaths] of rows) {
    test(name, () => {
      const f = softFinish(plan(), t, isAborted)
      expect(f.ms).toBe(ms)
      expect(near(f.fromFill, fromFill)).toBe(true)
      expect(f.breaths).toBe(breaths)
    })
  }

  test('box: in the empty hold the exhale already counted', () => {
    const f = softFinish(plan({ pattern: 'box' }), 15000 + 13000)
    expect(f).toEqual({ breaths: 2, eyeRests: 0, stretches: 0, ms: 0, fromFill: 0 })
  })

  test('a short closing exhale is at least 1.5 s', () => {
    const f = softFinish(plan(), 15000 + 1500) // slow inhale, fill ~0.17 -> let go
    expect(f.ms).toBe(0)
    const g = softFinish(plan(), 15000 + 1800) // fill ~0.24 -> 0.24 x 5.5 s = 1.3 s -> 1.5 s
    expect(g.ms).toBe(1500)
  })
})

describe('frameAt: the words the band reads', () => {
  const runAt = (over: Partial<SecondWindRun> = {}): SecondWindRun => ({
    id: 't', phase: 'breathing', turnStartedAt: 0, breathStartedAt: 3000, plan: plan(), isLong: false, finish: null, fold: null, ...over,
  })
  const rows: [string, number, string, string, string][] = [
    ['opening inhale', 3000, 'Breathe in 4', 'Breathing in', 'physiological sigh'],
    ['top-up sip', 3000 + 4000, 'Sip in 2', 'Sipping in', 'physiological sigh'],
    ['long exhale', 3000 + 6000, 'Out 9', 'Breathing out', 'physiological sigh'],
    ['slow paced', 3000 + 15000, 'Breathe in 6', 'Breathing in', 'slow paced breathing · 1 breath'],
    ['slow paced later', 3000 + 26000 + 5500, 'Out 6', 'Breathing out', 'slow paced breathing · 2 breaths'],
    ['eye rest', 3000 + 59000, 'Look at something 20 feet away · 20', 'Resting your eyes', '20-20-20 eye rest'],
    ['stretch', 3000 + 200000 + 1000, 'Roll your shoulders back, slowly · 19', 'Stretching', 'stretch'],
  ]
  for (const [name, now, cue, word, caption] of rows) {
    test(name, () => {
      const f = frameAt(runAt(), now)
      expect(f?.cue).toBe(cue)
      expect(f?.word).toBe(word)
      expect(f?.caption).toBe(caption)
    })
  }

  test('box breathing reads Hold', () => {
    expect(frameAt(runAt({ plan: plan({ pattern: 'box' }) }), 3000 + 15000 + 4000)?.cue).toBe('Hold 4')
  })

  test('the closing exhale counts down and empties', () => {
    const r = runAt({ phase: 'finishing', finish: { at: 10_000, ms: 3375, fromFill: 0.375, breaths: 1, eyeRests: 0, stretches: 0 } })
    expect(frameAt(r, 10_000)?.cue).toBe('Out 4')
    expect(near(frameAt(r, 10_000)?.fill ?? -1, 0.375)).toBe(true)
    expect(frameAt(r, 13_375)?.fill).toBe(0)
    expect(frameAt(r, 10_000)?.caption).toBe('1 breath')
  })

  test('a step keeps one key from start to end, and the next step gets another', () => {
    const a = frameAt(runAt(), 3000 + 15000 + 100)?.step.key
    const b = frameAt(runAt(), 3000 + 15000 + 5400)?.step.key
    const c = frameAt(runAt(), 3000 + 15000 + 5600)?.step.key
    expect(a).toBe(b)
    expect(c === a).toBe(false)
  })

  test('nothing is drawn while waiting or after the fold', () => {
    expect(frameAt(runAt({ phase: 'waiting' }), 99_999)).toBeNull()
    expect(frameAt(runAt({ phase: 'folded' }), 99_999)).toBeNull()
  })
})
