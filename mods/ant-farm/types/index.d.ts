// The values ant-farm keeps in $.state for the session. Plain JSON data:
// the host holds them across a hot reload, and every drawing that reads one
// is drawn again when it changes.

/** Tokens and estimated spend of one model loop (a subagent, the main loop, the rest). */
export type AntFarmUsage = {
  /** Model requests that came back with a response. */
  requests: number
  /** Every token the requests reported: input, output, cache reads and cache writes. */
  tokens: number
  /** Estimated US dollars for the tokens whose model is in the price table. */
  costUsd: number
  /** Tokens from models the price table does not know (their cost shows as "?"). */
  unpricedTokens: number
}

export type AntFarmStatus = 'running' | 'done' | 'failed'

/** One subagent of this session: one ant. */
export type AntFarmAnt = {
  /** The agent id `agent.spawn` answered; every loop event carries it. */
  id: string
  /** The Agent call's short description of the task. */
  task: string
  /** The agent type (`Explore`, `general-purpose`, a plugin's agent). */
  type: string
  /** The model the agent runs on, as the API last reported it. */
  model: string
  status: AntFarmStatus
  /** `$.clock.now()` milliseconds. */
  startedAt: number
  endedAt?: number
  usage: AntFarmUsage
  /** Started by a workflow script: never listed by `$.agent.list()`. */
  isWorkflow?: boolean
}

/** Usage outside the subagents: the main loop, and loops no agent list names (engine forks). */
export type AntFarmLoops = { main: AntFarmUsage; other: AntFarmUsage }

/** The main loop's current turn. */
export type AntFarmTurn = { isRunning: boolean; startedAt: number }

export type AntFarmView = {
  /** Draw the compact list inside the band: the pane was wanted but could not be placed. */
  isListInBand: boolean
  /** Finished subagents drawn as full cards instead of one line each. */
  isFinishedExpanded: boolean
  /** The person closed the pane by hand: do not open it again unasked this session. */
  isClosedByHand: boolean
  /** The pane already opened once unasked: it never does again this session. */
  hasOpenedUnasked: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'ant-farm': {
      ants: AntFarmAnt[]
      loops: AntFarmLoops
      turn: AntFarmTurn
      /** The budget level last announced: 0 under, 1 past the budget, 2 past twice it. */
      alarm: number
      /** Claude Code's own cost total for the session (what /cost shows), or null where unavailable. */
      engineUsd: number | null
      view: AntFarmView
    }
  }
}
