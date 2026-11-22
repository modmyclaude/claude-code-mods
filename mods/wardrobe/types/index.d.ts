// The values wardrobe keeps in $.state for the session. Plain JSON data.

/** What is being worn right now, and why. */
export type WardrobeLook = {
  /** The theme drawn: a theme id, or `default` for Claude Code's own look. */
  theme: string
  /** What was chosen: a theme id, `auto`, `season` or `default`. */
  choice: string
  /** Where the choice came from: the global one, or this project's pin. */
  scope: 'global' | 'project'
  /** In auto mode, which half of the day it is; `game` where a game day chose the look (auto or season); null otherwise. */
  phase: 'day' | 'night' | 'game' | null
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

/** Claude Code's own theme, as far as a mod can read it: its tone decides whether a light look may paint light panels. */
export type WardrobeApp = {
  tone: 'dark' | 'light' | 'unknown'
}

/** The last `/wear` that put a theme on: what, and when (a `$.clock.now()` reading), for the switch band. */
export type WardrobeSwitch = {
  theme: string
  at: number
}

/** The theme wardrobe set for the app: the look's palette, and the scene behind the chat. */
export type WardrobeBackdrop = {
  /** The look whose palette wardrobe set (a theme id), or null where no theme of its own stands. Absent in a value an older version kept. */
  look?: string | null
  /** The scene wardrobe set (a theme id), or null where none of its own stands. */
  scene: string | null
  /** Whether a window said it draws that scene when it was set. */
  isDrawn: boolean
}

/** Which family of looks the `/wear` gallery shows: a family's name, or null for the worn look's own. */
export type WardrobeGallery = {
  family: string | null
}

declare module 'claude-code' {
  interface PluginState {
    wardrobe: {
      look: WardrobeLook
      timing: StateFamily<WardrobeTiming>
      switch: WardrobeSwitch | null
      verb: WardrobeVerb | null
      app: WardrobeApp
      backdrop: WardrobeBackdrop
      gallery: WardrobeGallery
    }
  }
}
