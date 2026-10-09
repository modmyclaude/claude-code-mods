// halftime's state contract: everything it keeps in `$.state` for the
// session. A run lives here (never in the board's surface module), so the
// board can be unmounted at any moment and drawn again from exactly here.

export type HalftimeGameId = 'hurdle' | 'tailchase' | 'merge' | 'sweep'

/** hurdle: a one-button runner. Distances are in cells, speeds in cells/s. */
export type HalftimeHurdle = {
  rng: number
  x: number
  y: number
  vy: number
  /** Upcoming obstacles: [world x, width, height]. */
  obs: [number, number, number][]
  nextX: number
  dead: boolean
  /** A jump pressed just before landing, taken on touchdown. */
  buffered: boolean
}

/** tailchase: a snake on a wide, short field whose edges wrap. */
export type HalftimeTailchase = {
  w: number
  h: number
  /** Head first. */
  body: [number, number][]
  /** 0 up, 1 right, 2 down, 3 left. */
  dir: number
  queue: number[]
  food: [number, number] | null
  grow: number
  rng: number
  /** Milliseconds banked toward the next step. */
  acc: number
  eaten: number
  dead: boolean
  won: boolean
}

/** merge: a 4x4 board of tiers; two equal tiers make the next one. */
export type HalftimeMerge = {
  /** 16 cells, row by row; 0 is empty, 1 the first tier. */
  cells: number[]
  rng: number
  points: number
  moves: number
  over: boolean
}

/** sweep: a small mine field. Cells are row by row, 0/1 flags. */
export type HalftimeSweep = {
  w: number
  h: number
  mines: number[]
  adj: number[]
  open: number[]
  flag: number[]
  cur: [number, number]
  dead: boolean
  won: boolean
  /** The mine that went off, -1 for none. */
  boom: number
}

export type HalftimeGameState = HalftimeHurdle | HalftimeTailchase | HalftimeMerge | HalftimeSweep

export type HalftimeStatus = 'ready' | 'countdown' | 'live' | 'paused' | 'over'

/** Why the whistle blew. */
export type HalftimeReason = 'permission' | 'question' | 'input' | 'turn'

export type HalftimeResult = {
  score: number | null
  /** The personal best once it was compared and saved; null until then. */
  best: number | null
  isBest: boolean
  share: string
  saved: boolean
}

export type HalftimeRun = {
  /** Counts up per run in the session; keys the board so a new run is a new instance. */
  id: number
  game: HalftimeGameId
  mode: 'daily' | 'practice'
  day: string
  seed: number
  g: HalftimeGameState
  status: HalftimeStatus
  /** 3-2-1 while `status` is `countdown`. */
  count: number
  /** True while the whistle holds the run (it resumes with a 3-2-1). */
  held: boolean
  /**
   * Counts the times the keys left the board (whistle, survey, typing, picker).
   * It keys the board, so each return is a fresh board that waits for a click.
   */
  epoch: number
  createdAt: number
  /** Last tick time of a realtime game; 0 until the first tick after (re)start. */
  lastAt: number
  /** Turn-based games: when the current live stretch began; 0 while not counting. */
  liveSince: number
  /** When the person last touched the run (a key, a click, taking the keys); a realtime run idle too long pauses. */
  inputAt: number
  /**
   * Realtime play since the last input, not yet counted: [ms, ms of it while a
   * main turn ran]. A key or click confirms it; idling out drops it.
   */
  pending: [number, number]
  playedMs: number
  /** Played while a main-loop turn was running. */
  waitPlayedMs: number
  /** Main-loop turn time that overlapped this run. */
  waitMs: number
  /** Input bookkeeping per board instance: which events and arming clicks were applied. */
  input: { iid: string; seq: number; arm: number }
  result: HalftimeResult | null
}

export type HalftimeSession = {
  phase: 'off' | 'offer' | 'picker' | 'board' | 'whistle'
  practice: boolean
  run: HalftimeRun | null
  whistle: HalftimeReason | null
  /** Loops ('' is the main one) waiting on the person: a permission, a question, an input. */
  asking: string[]
  /** The main-loop turn running now, if any. */
  turn: { id: string; startedAt: number } | null
  nextId: number
  /** Play time and finished runs not yet added to the stored totals: [playedMs, waitPlayedMs, runs]. */
  owed: [number, number, number]
}

export type HalftimeStats = {
  auto: boolean
  last: HalftimeGameId | null
  best: { [game: string]: number }
  daily: { [game: string]: { day: string; score: number } }
  playedMs: number
  waitPlayedMs: number
  runs: number
}

export type HalftimeFault = { surface: string; reason: string }

declare module 'claude-code' {
  interface PluginState {
    halftime: {
      session: HalftimeSession
      stats: HalftimeStats
      fault: HalftimeFault | null
    }
  }
}
