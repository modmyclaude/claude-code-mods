// What umpire keeps in $.state for the session: whether it is on (when set this
// session), whether a run is going, the last runs' calls, and the file whose
// change holds the runs that start on their own. The runs' output lives in
// the module's memory; the command set per project, in its store.

export type UmpireRun = {
  /** When it ended, ms since the epoch, and how long it took. */
  at: number
  ms: number
  status: 'passed' | 'failed' | 'timed-out'
  passed?: number
  failed?: number
  total?: number
  /** Failing tests or files, each once. */
  names: string[]
  /** Why it could not run, when it could not. */
  error?: string
  /** The runner printed more than the engine keeps (4 MB): the counts may be missing. */
  isCut?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    umpire: {
      /** Set by /umpire on or off this session; null follows the setting. */
      isOn: boolean | null
      isRunning: boolean
      /** The last ten runs, oldest first. */
      runs: UmpireRun[]
      /** A file that says what the tests run changed: runs that start on their own wait until the person starts one. */
      heldBy: string | null
    }
  }
}
