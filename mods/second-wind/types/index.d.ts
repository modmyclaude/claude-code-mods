// What Second Wind keeps in $.state for the session: the breath that is
// running (or folding away), the clock its drawings read, whether the person
// is typing, and an offered movement card. Persistent counts live in $.store.

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

declare module 'claude-code' {
  interface PluginState {
    'second-wind': {
      run: SecondWindRun | null
      now: number
      isTyping: boolean
      card: SecondWindCard | null
    }
  }
}
