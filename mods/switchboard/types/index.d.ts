// What Switchboard keeps in $.state: the sessions it last read from the shared
// folder, as the pane and the band draw them. Each session's own record lives
// in a small file under ~/.claude/switchboard, written by that session itself.

/** What a session is doing, as it reports it. `gone` is only ever inferred from a stale record. */
export type SwitchboardState = 'working' | 'needs-you' | 'error' | 'idle' | 'gone'

/** One session as the pane draws it. */
export type SwitchboardRow = {
  id: string
  /** The session's title, else its folder's name; a short id is added when two read the same. */
  name: string
  state: SwitchboardState
  /** When this state began, ms since the epoch. */
  since: number
  /** What the session has cost so far, when Claude Code keeps a ledger. */
  costUsd?: number
  /** True for the session this pane is drawn in. */
  isMine: boolean
}

declare module 'claude-code' {
  interface PluginState {
    switchboard: {
      rows: SwitchboardRow[]
      /** When the rows were read, ms since the epoch (their ages are counted from it). */
      readAt: number
    }
  }
}
