// What Rain Check keeps in $.state for the session: the usage window that ran
// out, the prompt waiting for it, the clock its countdown reads, and the
// prompt it last sent (so one the limit refused again waits again).

/**
 * A usage window Claude Code refused a turn on: which one and when it resets.
 * Set only by a real refusal, never by a reading alone (extra usage can let
 * requests through at 100%).
 */
export type RainCheckLimit = {
  /** `five_hour`, `seven_day`, or another window Claude Code reports. */
  kind: string
  /** When the window resets, ms since the epoch. */
  resetsAt: number
}

/** A prompt waiting for the reset. */
export type RainCheckQueued = {
  text: string
  /** When it goes out, ms since the epoch: just after the reset. */
  sendAt: number
  /** `held`: a prompt the person sent; `continue`: the turn the limit cut off, picked up. */
  source: 'held' | 'continue'
}

declare module 'claude-code' {
  interface PluginState {
    'rain-check': {
      limit: RainCheckLimit | null
      queued: RainCheckQueued | null
      now: number
      lastSent: RainCheckQueued | null
    }
  }
}
