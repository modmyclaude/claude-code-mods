// What thermostat keeps in `$.state`: plain data the host holds for the
// session, so a hot reload of the code keeps the countdown and the receipt.

/** What the main conversation's prompt cache holds, as the last request left it. */
export type ThermostatCache = {
  /** When the last request that read or wrote the cache started (ms); null when nothing is cached. */
  lastAt: number | null
  /** The same, counting only real model requests, never keep-warm pings. */
  lastRealAt: number | null
  /** Tokens the next request re-reads: the last request's whole input plus its reply. */
  tokens: number
  /** The model id the API reported for that request. */
  model: string | null
  /** True when a large request neither read nor wrote the cache: caching is switched off. */
  isOff: boolean
}

/** A running `/warm`. */
export type ThermostatWarm = {
  /** When the keep-warm window ends (ms). */
  until: number
  startedAt: number
  /** Pings sent in this window and what they cost. */
  pings: number
  usd: number
  /** The last ping's measured cost, the best guess for the next. */
  lastPingUsd: number | null
}

/** A prompt the guard held, so the next send in the same cold spell goes through. */
export type ThermostatHeld = {
  /** The cold spell it belongs to: the cache's `lastAt` when it was held. */
  spell: number
  /** When it was held (ms). */
  at: number
  /** What sending it cold would have cost. */
  coldUsd: number
}

/** The session's running totals for `/thermostat`. */
export type ThermostatReceipt = {
  coldSends: number
  coldTokens: number
  /** What the cold sends cost over the same sends warm. */
  coldExtraUsd: number
  held: number
  /** Holds followed by /clear instead of the cold send. */
  clearedAfterHold: number
  clearAvoidedUsd: number
  pings: number
  pingUsd: number
  /** Sends that found the cache warm only because pings kept it so. */
  rescued: number
  rescuedUsd: number
}

/** A cache-write rate Claude Code priced itself (USD per million tokens), for one model family. */
export type ThermostatEngineWrite = { family: string; usdPerMTok: number }

/** The session's login: `bearer` a subscription, `api-key`, or `none` (a cloud provider or gateway). */
export type ThermostatAuth = 'bearer' | 'api-key' | 'none'

declare module 'claude-code' {
  interface PluginState {
    thermostat: {
      cache: ThermostatCache
      warm: ThermostatWarm | null
      held: ThermostatHeld | null
      receipt: ThermostatReceipt
      auth: ThermostatAuth | null
      /** The cache window in minutes as Claude Code itself reported it; null until it has. */
      engineTtl: number | null
      /** Claude Code's own cache-write rate for a model family, from an estimate it made; null until it has. */
      engineWrite: ThermostatEngineWrite | null
    }
  }
}
