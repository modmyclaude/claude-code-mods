// The breathing math: patterns, the escalation schedule, the soft finish and
// what each moment says. Pure: every function takes elapsed milliseconds the
// caller read off the wall clock, so the pace never drifts with frame timing.

import type { SecondWindPaced, SecondWindPlan, SecondWindRun } from '../types'

export type Pattern = 'sigh' | SecondWindPaced
export type PhaseName = 'in' | 'sip' | 'hold' | 'out'
export type Interlude = 'eyes' | 'stretch'

type Step = { readonly phase: PhaseName; readonly ms: number; readonly from: number; readonly to: number }

/** Each pattern as steps of fill (0 empty, 1 full) over time. */
export const PATTERNS: Readonly<Record<Pattern, readonly Step[]>> = {
  // A deep inhale, a short top-up sip, a long slow exhale: 15 seconds.
  sigh: [
    { phase: 'in', ms: 4000, from: 0, to: 0.75 },
    { phase: 'sip', ms: 2000, from: 0.75, to: 1 },
    { phase: 'out', ms: 9000, from: 1, to: 0 },
  ],
  // Slow paced breathing: 5.5 seconds in, 5.5 seconds out.
  slow: [
    { phase: 'in', ms: 5500, from: 0, to: 1 },
    { phase: 'out', ms: 5500, from: 1, to: 0 },
  ],
  // Box breathing: in, hold, out, hold, 4 seconds each.
  box: [
    { phase: 'in', ms: 4000, from: 0, to: 1 },
    { phase: 'hold', ms: 4000, from: 1, to: 1 },
    { phase: 'out', ms: 4000, from: 1, to: 0 },
    { phase: 'hold', ms: 4000, from: 0, to: 0 },
  ],
}

export const LABELS: Readonly<Record<Pattern | Interlude, string>> = {
  sigh: 'physiological sigh',
  slow: 'slow paced breathing',
  box: 'box breathing',
  eyes: '20-20-20 eye rest',
  stretch: 'stretch',
}

/** One-line stretches, taken in turn. */
export const STRETCHES: readonly string[] = [
  'Roll your shoulders back, slowly',
  'Drop your shoulders and lengthen your neck',
  'Open your hands and spread your fingers wide',
  'Sit tall and turn gently to each side',
]

export const EYE_REST = 'Look at something 20 feet away'

export const LONG_MS = 60_000 // a turn past this is a long turn
export const INTERLUDE_MS = 20_000 // an eye rest or a stretch
export const GAP_MS = 120_000 // breathing between interludes, at least
export const MIN_CLOSE_MS = 1500 // the shortest closing exhale
export const ABANDON_FILL = 0.2 // an inhale barely begun is let go, not finished

export const cycleMs = (p: Pattern): number => PATTERNS[p].reduce((n, s) => n + s.ms, 0)
export const SIGH_MS = cycleMs('sigh')

/** The exhale step's length. */
export const exhaleMs = (p: Pattern): number => PATTERNS[p].find(s => s.phase === 'out')?.ms ?? 0

/** Where one cycle's exhale ends, from the cycle's start: a breath is counted there. */
function exhaleEndMs(p: Pattern): number {
  let t = 0
  for (const s of PATTERNS[p]) {
    t += s.ms
    if (s.phase === 'out') return t
  }
  return t
}

export const clamp01 = (x: number): number => (!(x > 0) ? 0 : x >= 1 ? 1 : x)

/** Sine in-out: lungs speed up and slow down, they do not move linearly. */
export const ease = (p: number): number => (1 - Math.cos(Math.PI * clamp01(p))) / 2

const secondsOf = (ms: number): number => Math.max(1, Math.ceil(ms / 1000))

export type Breath = {
  phase: PhaseName
  /** Whole seconds left in this step, never 0 while it runs. */
  secondsLeft: number
  /** 0 empty to 1 full. */
  fill: number
  msLeft: number
  stepMs: number
  from: number
  to: number
}

/** Where a pattern stands `elapsedMs` after it began. */
export function phaseAt(pattern: Pattern, elapsedMs: number): Breath {
  const steps = PATTERNS[pattern]
  const total = cycleMs(pattern)
  const t = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  let u = t - Math.floor(t / total) * total
  let i = 0
  while (i < steps.length - 1 && u >= steps[i]!.ms) {
    u -= steps[i]!.ms
    i += 1
  }
  const s = steps[i]!
  const msLeft = Math.max(0, s.ms - u)
  return {
    phase: s.phase,
    secondsLeft: secondsOf(msLeft),
    fill: s.from + (s.to - s.from) * ease(u / s.ms),
    msLeft,
    stepMs: s.ms,
    from: s.from,
    to: s.to,
  }
}

/** The interludes a plan takes, alternating in this order. */
export function interludes(plan: SecondWindPlan): Interlude[] {
  return [...(plan.eyeRest ? (['eyes'] as const) : []), ...(plan.stretch ? (['stretch'] as const) : [])]
}

/**
 * Breath time of the first interlude: the first cycle boundary once the turn
 * (delay included) has run 60 seconds, so no breath is cut in half.
 */
export function firstInterludeAt(plan: SecondWindPlan): number {
  const c = cycleMs(plan.pattern)
  return SIGH_MS + c * Math.max(0, Math.ceil((LONG_MS - plan.delayMs - SIGH_MS) / c))
}

/** Whole paced cycles between two interludes. */
export const cyclesPerGap = (plan: SecondWindPlan): number => Math.max(1, Math.ceil(GAP_MS / cycleMs(plan.pattern)))

export type Segment =
  | { kind: 'breath'; pattern: Pattern; breath: Breath; startMs: number }
  | { kind: 'interlude'; interlude: Interlude; index: number; nth: number; fill: number; msLeft: number; secondsLeft: number }

const breathFrom = (pattern: Pattern, spanStart: number, t: number): Segment => {
  const breath = phaseAt(pattern, t - spanStart)
  return { kind: 'breath', pattern, breath, startMs: t - (breath.stepMs - breath.msLeft) }
}

/**
 * The escalation schedule: one physiological sigh, then the paced pattern;
 * once the turn is long, an eye rest or a stretch every couple of minutes,
 * each followed by more breathing. `t` is breath time (ms since the band
 * first showed).
 */
export function segmentAt(plan: SecondWindPlan, t: number): Segment {
  const at = Number.isFinite(t) ? Math.max(0, t) : 0
  if (at < SIGH_MS) return breathFrom('sigh', 0, at)
  const kinds = interludes(plan)
  const first = firstInterludeAt(plan)
  if (kinds.length === 0 || at < first) return breathFrom(plan.pattern, SIGH_MS, at)
  const block = INTERLUDE_MS + cyclesPerGap(plan) * cycleMs(plan.pattern)
  const k = Math.floor((at - first) / block)
  const u = at - first - k * block
  if (u < INTERLUDE_MS) {
    const msLeft = INTERLUDE_MS - u
    // `nth`: which interlude of its own kind this is, so stretches take their lines in turn.
    const nth = Math.floor(k / kinds.length)
    return { kind: 'interlude', interlude: kinds[k % kinds.length]!, index: k, nth, fill: msLeft / INTERLUDE_MS, msLeft, secondsLeft: secondsOf(msLeft) }
  }
  return breathFrom(plan.pattern, first + k * block + INTERLUDE_MS, at)
}

export type Tally = { breaths: number; eyeRests: number; stretches: number }

/** Breaths whose exhale has ended, and interludes begun, by breath time `t`. */
export function tally(plan: SecondWindPlan, t: number): Tally {
  const at = Number.isFinite(t) ? Math.max(0, t) : 0
  if (at < SIGH_MS) return { breaths: 0, eyeRests: 0, stretches: 0 }
  const c = cycleMs(plan.pattern)
  const end = exhaleEndMs(plan.pattern)
  const exhaled = (span: number) => Math.floor(span / c) + (span % c >= end ? 1 : 0)
  const kinds = interludes(plan)
  const first = firstInterludeAt(plan)
  if (kinds.length === 0 || at < first) return { breaths: 1 + exhaled(at - SIGH_MS), eyeRests: 0, stretches: 0 }
  const per = cyclesPerGap(plan)
  const block = INTERLUDE_MS + per * c
  const k = Math.floor((at - first) / block)
  const u = at - first - k * block
  const breaths = 1 + (first - SIGH_MS) / c + k * per + (u < INTERLUDE_MS ? 0 : exhaled(u - INTERLUDE_MS))
  const begun = k + 1
  const eyes = kinds.length === 2 ? Math.ceil(begun / 2) : kinds[0] === 'eyes' ? begun : 0
  return { breaths, eyeRests: eyes, stretches: begun - eyes }
}

export type Finish = Tally & { ms: number; fromFill: number }

/**
 * What happens when the main turn ends at breath time `t`: an exhale already
 * under way runs out its own time; an inhale or hold turns into a closing
 * exhale from where the breath stands; an interlude, an interrupt or an inhale
 * barely begun fold at once. The finished breath counts.
 */
export function softFinish(plan: SecondWindPlan, t: number, isAborted = false): Finish {
  const base = tally(plan, t)
  const seg = segmentAt(plan, t)
  if (isAborted || seg.kind === 'interlude') return { ...base, ms: 0, fromFill: 0 }
  const b = seg.breath
  if (b.phase === 'out') return { ...base, breaths: base.breaths + 1, ms: b.msLeft, fromFill: b.fill }
  if (b.fill < ABANDON_FILL) return { ...base, ms: 0, fromFill: 0 }
  const ms = Math.round(Math.max(MIN_CLOSE_MS, b.fill * exhaleMs(seg.pattern)))
  return { ...base, breaths: base.breaths + 1, ms, fromFill: b.fill }
}

/** The step being drawn, whole: what the desktop circle animates across. */
export type FrameStep = { key: string; from: number; to: number; ms: number }

export type Frame = {
  mode: 'breath' | 'interlude' | 'finish'
  /** The band's words: `Breathe in 4`, `Hold 2`, `Out 6`. */
  cue: string
  /** The spinner's verb while it carries the breath. */
  word: string
  /** What is running, dim: `slow paced breathing · 3 breaths`. */
  caption: string
  fill: number
  step: FrameStep
}

const CUES: Readonly<Record<PhaseName, string>> = { in: 'Breathe in', sip: 'Sip in', hold: 'Hold', out: 'Out' }
const WORDS: Readonly<Record<PhaseName, string>> = { in: 'Breathing in', sip: 'Sipping in', hold: 'Holding', out: 'Breathing out' }

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** What a run shows at `now`, or null while it shows no breath. */
export function frameAt(run: SecondWindRun, now: number): Frame | null {
  if (run.phase === 'finishing' && run.finish !== null && run.finish.ms > 0) {
    const f = run.finish
    const since = Math.min(f.ms, Math.max(0, now - f.at))
    return {
      mode: 'finish',
      cue: `Out ${secondsOf(f.ms - since)}`,
      word: WORDS.out,
      caption: plural(f.breaths, 'breath'),
      fill: f.fromFill * (1 - ease(since / f.ms)),
      step: { key: `finish:${f.at}`, from: f.fromFill, to: 0, ms: f.ms },
    }
  }
  if (run.phase !== 'breathing') return null
  const t = Math.max(0, now - run.breathStartedAt)
  const seg = segmentAt(run.plan, t)
  if (seg.kind === 'interlude') {
    const isEyes = seg.interlude === 'eyes'
    const text = isEyes ? EYE_REST : STRETCHES[seg.nth % STRETCHES.length]!
    return {
      mode: 'interlude',
      cue: `${text} · ${seg.secondsLeft}`,
      word: isEyes ? 'Resting your eyes' : 'Stretching',
      caption: LABELS[seg.interlude],
      fill: seg.fill,
      step: { key: `rest:${seg.index}`, from: 1, to: 0, ms: INTERLUDE_MS },
    }
  }
  const b = seg.breath
  const done = tally(run.plan, t).breaths
  return {
    mode: 'breath',
    cue: `${CUES[b.phase]} ${b.secondsLeft}`,
    word: WORDS[b.phase],
    caption: done > 0 ? `${LABELS[seg.pattern]} · ${plural(done, 'breath')}` : LABELS[seg.pattern],
    fill: b.fill,
    step: { key: `step:${seg.startMs}`, from: b.from, to: b.to, ms: b.stepMs },
  }
}
