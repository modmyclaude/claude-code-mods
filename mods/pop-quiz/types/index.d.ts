// What pop-quiz keeps in $.state for the session: the quiz on show, whether it
// is on and how often it asks (when set this session), the session's score and
// what its calls cost. The all-time score lives in the mod's store.

/** One question on show, and whether its answer is. */
export type PopQuizQuestion = { q: string; a: string; isShown: boolean }

export type PopQuizScore = { asked: number; shown: number; skipped: number }

declare module 'claude-code' {
  interface PluginState {
    'pop-quiz': {
      quiz: PopQuizQuestion[] | null
      /** Set by /pop-quiz on or off this session; null follows the setting. */
      isOn: boolean | null
      /** Set by /pop-quiz every; null follows the setting. */
      every: number | null
      score: PopQuizScore
      /** What this session's quiz calls cost, in dollars at small-model list prices. */
      usd: number
    }
  }
}
