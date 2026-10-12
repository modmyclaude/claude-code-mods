// What swear-jar keeps in $.state: this session's counts, the all-time counts
// as its store holds them, the last reply's hits, and the nudge switch.

/** Counts by tic label ("absolutely right", "em dashes"). */
export type SwearJarCounts = Record<string, number>

/** One tic found in the last reply, with the words around it. */
export type SwearJarHit = {
  label: string
  before: string
  tic: string
  after: string
}

declare module 'claude-code' {
  interface PluginState {
    'swear-jar': {
      /** This session's counts; /swear-jar reset empties it. */
      session: SwearJarCounts
      /** All-time counts, read from the store at start and written on each change. */
      allTime: SwearJarCounts
      /** The last reply's hits, each in its sentence. */
      last: SwearJarHit[]
      /** Whether the plain-words nudge joins every request. */
      nudge: boolean
    }
  }
}
