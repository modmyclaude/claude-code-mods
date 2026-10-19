// The values redline keeps in $.state: the gauge every drawing reads, and
// whether the band above the prompt is on. Self-contained on purpose: no
// import, every name led by "Redline".

/** The four token counts of a model request, as the API reports them. */
export type RedlineTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** One reading over time: context tokens, or new tokens of one request. */
export type RedlineSample = { t: number; tokens: number }

/** One plan rate-limit window as Claude Code reports it. */
export type RedlineLimit = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

/** One turn (or one subagent run) and what its requests used. */
export type RedlineTurn = {
  id: string
  label: string
  isSubagent: boolean
  startedAt: number
  requests: number
  tokens: RedlineTokens
  /** USD by the built-in price table; null once a request had no price. */
  usd: number | null
}

/** What the requests charged to one kind of work, or to one model, used. */
export type RedlineSpend = {
  requests: number
  tokens: RedlineTokens
  /** USD by the built-in price table; null once a request charged here had no price. */
  usd: number | null
}

export type RedlineGauge = {
  /** When the session began (Claude Code's own figure), epoch ms. */
  sessionStartedAt: number | null
  /** When redline began counting tokens, epoch ms. */
  trackingSince: number | null
  /** The model's context window in tokens, from Claude Code. */
  window: number | null
  /** Input side of the main loop's last request; null while unknown. */
  contextTokens: number | null
  /**
   * Claude Code's own fill percentage (the status line's used_percentage)
   * when it reported one for this reading; null to compute it from tokens.
   */
  contextPercent: number | null
  /** Main-loop context readings of the last 10 minutes (pace). */
  samples: RedlineSample[]
  /** New tokens per request of the last 10 minutes (tokens per minute). */
  flow: RedlineSample[]
  /** Every request counted since trackingSince, main loop and subagents. */
  totals: RedlineTokens
  /** The same requests priced by the built-in table, per category, USD. */
  tableUsd: RedlineTokens
  /** Models seen with no row in the price table. */
  unpriced: string[]
  /** Claude Code's own cost ledger for the session, USD; null where absent. */
  ledgerUsd: number | null
  limits: RedlineLimit[]
  /** Each plan window's readings of the last 15 minutes, by kind (run-out). */
  limitHistory: Record<string, RedlineSample[]>
  turns: RedlineTurn[]
  /**
   * This session's requests by the kind of work each carried (the results of the
   * previous response's tool calls: reading, editing, shell, search, planning; a
   * subagent's requests as subagents; a turn's first request as prompt; one with no
   * results as answering; an MCP server's tools as mcp:<server>), a request carrying
   * several kinds split evenly across them.
   */
  spend: Record<string, RedlineSpend>
  /** The same requests by the model that answered. */
  byModel: Record<string, RedlineSpend>
  /** The model of the main loop's last request. */
  model: string | null
  /** The 80% toast may fire; false until context drops under 75%. */
  isArmed: boolean
}

/** Which of the pane's two views is open: the limits, or where the money went. */
export type RedlineView = 'overview' | 'spend'

declare module 'claude-code' {
  interface PluginState {
    redline: { gauge: RedlineGauge; isBandOn: boolean; view: RedlineView }
  }
}
