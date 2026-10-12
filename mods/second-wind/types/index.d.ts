// What Second Wind keeps in $.state for the session: the breath that is
// running (or folding away), the clock the terminal's drawings read, what the
// desktop draws (written only when it changes), whether the person is typing,
// and an offered movement card. Persistent counts live in $.store.

/** The paced pattern after the opening sigh, as the `pattern` setting names it. */
export type SecondWindPaced = 'slow' | 'box'

/** What one run of the band follows, fixed when the turn starts. */
export type SecondWindPlan = {
  pattern: SecondWindPaced
  delayMs: number
  eyeRest: boolean
  stretch: boolean
}

/** The closing exhale after Claude answered, and what the run adds up to. */
export type SecondWindFinish = {
  /** When the closing exhale began (ms since the epoch). */
  at: number
  /** How long it lasts; 0 folds at once. */
  ms: number
  /** How full the breath was when the turn ended. */
  fromFill: number
  breaths: number
  eyeRests: number
  stretches: number
}

/** The one-line summary shown after the breath folds away. */
export type SecondWindFold = {
  text: string
  /** When it dims. */
  fadeAt: number
  /** When it clears. */
  until: number
}

/** One band run, tied to the main conversation's turn. */
export type SecondWindRun = {
  /** The main turn's id that started it. */
  id: string
  phase: 'waiting' | 'breathing' | 'finishing' | 'folded'
  turnStartedAt: number
  /** turnStartedAt plus the delay: the breath's own zero. */
  breathStartedAt: number
  plan: SecondWindPlan
  /** Set once the turn has run past 60 seconds. */
  isLong: boolean
  finish: SecondWindFinish | null
  fold: SecondWindFold | null
}

/** The optional movement card. */
export type SecondWindCard = { kind: 'stand' | 'squats' }

/** One step of a breath pattern, as the desktop guide's timeline carries it. */
export type SecondWindStep = { phase: 'in' | 'sip' | 'hold' | 'out'; ms: number; from: number; to: number }

/**
 * What the desktop draws for the run: the guide for one stretch of the wait
 * (its whole timeline, so the drawing keeps its own clock), or the fold line.
 * Written only when it changes. The desktop's band reads this and never the
 * per-tick clock, so nothing around a running guide is drawn again (MM-110).
 */
export type SecondWindDesk =
  | {
      kind: 'guide'
      /** Changes only when the span does. */
      key: string
      phase: 'breathing' | 'finishing'
      /** When the span's timeline began (ms since the epoch). */
      at: number
      segments: { steps: SecondWindStep[]; loop: boolean; atMs: number }[]
      pose: 'calm' | 'idle'
      words: boolean
      /** Beside the drawing, unchanged for the whole span. */
      label: string
      /** An interlude's instruction; null when the drawing carries the words. */
      still: string | null
    }
  | { kind: 'fold'; key: string; text: string; isFaded: boolean }

declare module 'claude-code' {
  interface PluginState {
    'second-wind': {
      run: SecondWindRun | null
      now: number
      desk: SecondWindDesk | null
      isTyping: boolean
      card: SecondWindCard | null
    }
  }
}
