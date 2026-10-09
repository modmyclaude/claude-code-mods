// The values wardrobe keeps in $.state for the session. Plain JSON data.

/** What is being worn right now, and why. */
export type WardrobeLook = {
  /** The theme drawn: a theme id, or `default` for Claude Code's own look. */
  theme: string
  /** What was chosen: a theme id, `auto` or `default`. */
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

declare module 'claude-code' {
  interface PluginState {
    wardrobe: {
      look: WardrobeLook
      timing: StateFamily<WardrobeTiming>
    }
  }
}
