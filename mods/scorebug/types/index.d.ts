// The values scorebug keeps in $.state for the session: the games it shows,
// how the look at the feed is going, how the person set it for this session,
// and a beat that counts the looks. Plain JSON data: the host holds
// them across a hot reload, and what reads one is drawn again when it changes.
// Every field added later is optional, and absent reads as its default, so a
// value kept by an older version still loads.

/** One side of a game. */
export type ScoreSide = {
  /** The team's name as the feed gives it. */
  name: string
  /** Its short code, two to four letters. */
  short: string
  score: number
}

/** One game, as every feed is turned into. */
export type ScoreGame = {
  /** Steady across looks, so a change in the score is seen as a change. */
  id: string
  /** The feed's short name for the competition. */
  league: string
  away: ScoreSide
  home: ScoreSide
  /** A break between periods is live: the game is on. */
  state: 'pre' | 'live' | 'final'
  /** What the game is at, in a few words: `P2 12:41`, `end of P1`, `halftime`, `final`, `starts in 2 min`. */
  status: string
  /** Whether each score is worth a toast (goals, runs) or only the end is (points). */
  kind: 'goals' | 'points'
  /** `$.clock.now()` milliseconds when it starts, where the feed says. */
  startsAt?: number
}

export type ScoreMeta = {
  /** When the last look at the feed succeeded, or null if none has. */
  lastOk: number | null
  /** When the last look failed, or null if none has. */
  lastErr: number | null
  /** The wait before the next look: the refresh setting while a game is on, longer while none is, doubled after each failure up to five minutes. */
  intervalMs: number
}

export type ScoreView = {
  /** False after `/scores off`: nothing drawn, no timer, no look at the feed, for the session. */
  on: boolean
  /** The column the cards stand in for this session, after `/scores left` or `/scores right`; absent, the setting's. */
  side?: 'left' | 'right'
}

declare module 'claude-code' {
  interface PluginState {
    scorebug: {
      /** The followed games, live ones first, four at most. */
      games: ScoreGame[]
      meta: ScoreMeta
      view: ScoreView
      /** One more after every look at the feed, so the band and the cards are drawn again at each: the band learns from it whether a card still shows. */
      beat: number
    }
  }
}
