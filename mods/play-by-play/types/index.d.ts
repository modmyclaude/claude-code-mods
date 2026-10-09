// The values play-by-play keeps in $.state, so a hot reload loses nothing.

/** What made a step. */
export type PlayByPlayKind =
  | 'edit' // a file changed in place
  | 'write' // a file overwritten whole
  | 'create' // a new file
  | 'delete' // a file removed
  | 'rename' // a file moved, maybe changed too
  | 'cell' // one notebook cell
  | 'change' // changed, but there is no line detail to show
  | 'more' // a placeholder for files left out past the cap

/** One change, in the order it happened. */
export type PlayByPlayStep = {
  /** The path shown, relative to the session's folder when it lies inside it. */
  file: string
  /** For a rename: the path it had before. */
  from?: string
  kind: PlayByPlayKind
  /** `shell` when a Bash command made the change rather than a file tool. */
  via: 'tool' | 'shell'
  added: number
  removed: number
  /** Unified-diff hunks, capped for drawing; '' when there is no line detail. */
  hunks: string
  /** Why detail is missing or cut, shown under the step's header. */
  note?: string
}

/** One turn's changes. */
export type PlayByPlayTurn = {
  id: string
  /** The start of the prompt that began the turn. */
  prompt: string
  steps: PlayByPlayStep[]
  /** Changes past the per-turn step cap, counted but not kept. */
  dropped: number
}

/** What the replay pane shows: which kept turn (1 = latest) and which step. */
export type PlayByPlayView = { back: number; step: number }

declare module 'claude-code' {
  interface PluginState {
    'play-by-play': {
      /** The turn running now; null between turns. */
      current: PlayByPlayTurn | null
      /** Finished turns that changed files, oldest first, the last 10. */
      turns: PlayByPlayTurn[]
      /** Whether the hint above the prompt is up. */
      hint: boolean
      view: PlayByPlayView
    }
  }
}
