// What umpire keeps in $.state for the session: whether it is on (when set this
// session), whether a run is going, and the last runs' calls. Their output
// lives in the module's memory; the command set per project, in its store.

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
}

declare module 'claude-code' {
  interface PluginState {
    umpire: {
      /** Set by /umpire on or off this session; null follows the setting. */
      isOn: boolean | null
      isRunning: boolean
      /** The last ten runs, oldest first. */
      runs: UmpireRun[]
    }
  }
}
