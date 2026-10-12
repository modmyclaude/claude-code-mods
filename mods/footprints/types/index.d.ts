/**
 * What footprints knows about one path Claude touched this session.
 * Every flag is absent until it is true, so an empty mark means "untouched".
 */
export type FootprintsMark = {
  /** Read with Read, or searched with Glob/Grep (then the mark is a folder's). */
  read?: true
  /** tool_use ids of edit calls still running on this path (the shimmer). */
  editing?: string[]
  /** Changed this session: an edit tool, or the shell (see viaShell). */
  edited?: true
  /** Created this session. */
  isNew?: true
  /** Deleted this session. */
  deleted?: true
  /** Edited, and a later git commit left it clean. */
  committed?: true
  /** Changed by a Bash command only, never by an edit tool. */
  viaShell?: true
  /** The path is a folder (a Glob/Grep target), not a file. */
  isDir?: true
}

/** The project's file list, names only, as the last scan found it. */
export type FootprintsTree = {
  /** The folder the tree is drawn from, absolute. */
  root: string
  /** The same folder with every link resolved, when that spells it differently. */
  realRoot?: string
  /** File paths relative to root, '/'-separated, at most the scan cap. */
  files: string[]
  /** Where the list came from: git (honours .gitignore) or a folder walk. */
  source: 'git' | 'walk'
  /** How many files the scan found before the cap. */
  total: number
  /** One line about a scan that fell short, when it did. */
  note?: string
}

declare module 'claude-code' {
  interface PluginState {
    footprints: {
      /** Absolute path to its mark. */
      marks: Record<string, FootprintsMark>
      tree: FootprintsTree | null
      /** Touched-only as the person chose it with t or /footprints touched; null until they do, when a big tree (over 50 folders) opens touched-only. */
      touchedOnly: boolean | null
      /** Animation frame of the shimmer; only moves while an edit runs. */
      phase: number
      /** True once git status proved too slow here: Bash calls are no longer checked. */
      shellPaused: boolean
    }
  }
}
