// The values wardrobe keeps in $.state for the session. Plain JSON data.

/** What is being worn right now, and why. */
export type WardrobeLook = {
  /** The theme drawn: a theme id, or `default` for Claude Code's own look. */
  theme: string
  /** What was chosen: a theme id, `auto`, `season` or `default`. */
  choice: string
  /** Where the choice came from: the global one, or this project's pin. */
  scope: 'global' | 'project'
  /** In auto mode, which half of the day it is; null otherwise. */
  phase: 'day' | 'night' | null
  /** The project root the look was resolved for (pins are keyed by it). */
  root: string
}

/** One tool call's timing, from `tool.call`; `ms` is null while it runs. */
export type WardrobeTiming = {
  startedAt: number
  ms: number | null
}

/** The verb this turn wears on the spinner and its closing line, picked once when the turn started; null between themes or for a theme with none. */
export type WardrobeVerb = {
  turnId: string
  present: string
  past: string
}

/** The last `/wear` that put a theme on: what, and when (a `$.clock.now()` reading), for the switch band. */
export type WardrobeSwitch = {
  theme: string
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    wardrobe: {
      look: WardrobeLook
      timing: StateFamily<WardrobeTiming>
      switch: WardrobeSwitch | null
      verb: WardrobeVerb | null
    }
  }
}
