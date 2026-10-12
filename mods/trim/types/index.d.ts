// What trim keeps in $.state for the session: the calls it folded (the last 20),
// the session's totals, whether it is paused, and which call's full output the
// output pane shows. The full outputs themselves live only in the module's own
// memory, never in $.state, $.store or a file.

/** One Bash call trim folded. */
export type TrimCall = {
  /** Its place in this session, from 1. */
  n: number
  /** The tool call's id, which its transcript row carries. */
  id: string
  /** The command's first line, cleaned, at most 80 characters. */
  command: string
  linesIn: number
  /** Lines not shown as themselves to Claude. */
  folded: number
  /** Characters saved, an estimate's basis (tokens are about a quarter of it). */
  saved: number
}

export type TrimLog = {
  /** The last 20 folded calls, oldest first. */
  calls: TrimCall[]
  /** Calls folded this session, all of them. */
  count: number
  /** Characters saved this session, all calls. */
  saved: number
}

declare module 'claude-code' {
  interface PluginState {
    trim: {
      log: TrimLog
      /** The person paused it for the session (/trim off). */
      isOff: boolean
      /** The call (by n) whose full output the output pane shows; 0 for none. */
      shown: number
    }
  }
}
