// What Switchboard keeps in $.state: the sessions it last read from the shared
// folder, as the pane, band and footer draw them, and whether the quiet ones
// are unfolded. Each session's own record lives in a small file under
// ~/.claude/switchboard, written by that session itself.

/** What a session is doing, as it reports it. `gone` is also inferred from a stale record. */
export type SwitchboardState = 'working' | 'needs-you' | 'error' | 'idle' | 'gone'

/** Where a session runs, so the person knows where to go: a terminal, the desktop app, or nothing attached. */
export type SwitchboardWhere = 'terminal' | 'desktop' | 'background'

/** One session as the pane draws it. */
export type SwitchboardRow = {
  id: string
  /** The session's title, else its folder's name; a short id is added when two read the same. */
  name: string
  state: SwitchboardState
  /** When this state began, ms since the epoch. */
  since: number
  where: SwitchboardWhere
  /** What a `needs-you` session waits on, when it said. */
  waitingOn?: string
  /** What the session has cost so far, when Claude Code keeps a ledger. */
  costUsd?: number
  /** Idle with no turn in the last hour: folded into one line. */
  isQuiet: boolean
  /** True for the session this pane is drawn in. */
  isMine: boolean
}

declare module 'claude-code' {
  interface PluginState {
    switchboard: {
      rows: SwitchboardRow[]
      /** When the rows were read, ms since the epoch (their ages are counted from it). */
      readAt: number
      /** The person unfolded the quiet sessions. */
      showQuiet: boolean
    }
  }
}
