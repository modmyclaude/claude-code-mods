// The values last-look keeps in $.state: the commands it holds right now and
// the measured report each one shows. Plain JSON data, drawn by the pane and
// the band above the prompt.

export type LastLookTone = 'error' | 'warning' | 'subtle' | 'normal'

export type LastLookRow = { text: string; tone?: LastLookTone }

/** What one destructive part of a command would do, as measured. */
export type LastLookItem = {
  /** The part's own text, e.g. `rm -rf build`. */
  title: string
  /** Where it runs, relative to the session's directory, when not there. */
  where?: string
  /** `nothing`: measured and found nothing (still held); `unknown`: could not measure. */
  effect: 'nothing' | 'some' | 'unknown'
  summary: string
  summaryTone: LastLookTone
  /** Detail rows: files, commits, git notes; at most a screenful are kept. */
  rows: LastLookRow[]
  /** How many more rows there were than `rows` keeps. */
  moreRows: number
  files: number
  bytes: number
  /** Files with work git cannot bring back (uncommitted or never added). */
  unsaved: number
  /** Commits that would leave every branch. */
  commits: number
  /** Every target is a plain literal path whose real path lies inside the alwaysAllow folders. */
  isAllowed: boolean
  /**
   * Not destructive after all, decided only where the classifier cannot know
   * alone: a redirect to a plain path that does not exist yet (or is a
   * folder), and `git checkout <name>` that git confirms is a branch. An empty
   * or failed measurement never sets it: a destructive command always holds.
   */
  isHarmless: boolean
  /** It deletes your home folder, `/`, or a top-level system folder. */
  isCatastrophic: boolean
}

export type LastLookReport = {
  command: string
  headline: string
  headlineTone: LastLookTone
  items: LastLookItem[]
}

export type LastLookHold = {
  /** The held call's tool_use_id. */
  id: string
  /** Where it is shown: the pane, or the band above the prompt. */
  mode: 'pane' | 'band'
  report: LastLookReport
  isSubagent: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'last-look': { holds: LastLookHold[] }
  }
}
