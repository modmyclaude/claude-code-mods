// What mulligan keeps in $.state for the session: the project's snapshots as
// last read from its folder, the line above the prompt, and what the pane
// shows. The snapshots themselves are files under ~/.claude/mulligan.

/** One snapshot, saved before a destructive command ran. */
export type MulliganSnapshot = {
  /** Its number in this project, from 1. */
  n: number
  /** When it was saved, ms since the epoch. */
  at: number
  /** The command it was saved before, cleaned, one line. */
  command: string
  /** What it holds, in words ("dist", "tracked changes and untracked files", "the project"). */
  scope: string
  /** git: the commit object holding the tracked files' state. */
  sha?: string
  /** The archive's file name in the project's folder, when files were copied. */
  archive?: string
  /** The archive's size in bytes (0 without one). */
  bytes: number
}

/** The line above the prompt after a snapshot, or a skip, until a moment passes. */
export type MulliganBand = { text: string; tone: 'subtle' | 'warning'; until: number }

/** What the pane shows: the list (with a restore waiting on its confirm), or one snapshot's diff. */
export type MulliganView = { kind: 'list'; confirm: number } | { kind: 'diff'; n: number; lines: string[] }

declare module 'claude-code' {
  interface PluginState {
    mulligan: {
      snapshots: MulliganSnapshot[]
      band: MulliganBand | null
      view: MulliganView
    }
  }
}
