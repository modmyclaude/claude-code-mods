// The values ant-farm keeps in $.state for the session. Plain JSON data:
// the host holds them across a hot reload, and every drawing that reads one
// is drawn again when it changes. Fields added after 0.1.1 are optional: a
// value kept by an older version lacks them, and the code treats absent as empty.

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
  /** When it last started or answered a request: an ant silent for long stops the clock. */
  lastActiveAt?: number
  /** Started by a workflow script: never listed by `$.agent.list()`. */
  isWorkflow?: boolean
  /** Its number in the mission, from 1 in order of start; the cards and the timeline cite it. */
  n?: number
  /** The id of the agent whose loop started it; absent when the main loop did. */
  parentId?: string
  /** Tokens of its last model requests, oldest first, at most 24: the card's sparkline. */
  history?: number[]
  /** Tool calls it made (every tool). */
  tools?: number
  /** Of those, calls that wrote a file (Edit, Write, MultiEdit, NotebookEdit). */
  edits?: number
  /** Tool calls that failed or were refused. */
  errors?: number
}

/** Usage outside the subagents: the main loop, and loops no agent list names (engine forks). */
export type AntFarmLoops = { main: AntFarmUsage; other: AntFarmUsage }

/** The budget level last announced and the budget it was measured against. */
export type AntFarmAlarm = { level: number; budgetUsd: number }

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
  /** The subagent whose inspector is open, by id; absent for none. */
  selectedId?: string
  /** The activity timeline shows its long form (40 rows) instead of 12. */
  isTimelineExpanded?: boolean
  /** The activity timeline is folded away. */
  isTimelineHidden?: boolean
}

/** What one row of the activity timeline records. */
export type AntFarmEventKind = 'spawn' | 'handoff' | 'tool' | 'file' | 'done' | 'failed' | 'error' | 'warning'

/** One row of the activity timeline: something a subagent did, or something that happened to it. */
export type AntFarmEvent = {
  /** `$.clock.now()` milliseconds. */
  at: number
  kind: AntFarmEventKind
  /** The subagent it concerns; absent for a session-wide note (the budget alarm). */
  agentId?: string
  /** The row's words: a tool and what it touched, a task, a reason. Untrusted: cleaned when drawn. */
  text: string
  /** A second part drawn after the text: an error's first words, a refusal's reason. Untrusted. */
  detail?: string
}

declare module 'claude-code' {
  interface PluginState {
    'ant-farm': {
      ants: AntFarmAnt[]
      loops: AntFarmLoops
      turn: AntFarmTurn
      /** The budget level announced (0 under, 1 past the budget, 2 past twice it); it only rises until the budget changes or /clear. */
      alarm: AntFarmAlarm
      /** Claude Code's own cost estimate for the session (what /cost shows, at list prices), or null where unavailable. */
      engineUsd: number | null
      view: AntFarmView
      /** The activity timeline, oldest first, at most 80 rows; older rows leave. */
      events: AntFarmEvent[]
    }
  }
}
