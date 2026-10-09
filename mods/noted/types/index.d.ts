// noted's state contract: what its band draws from ($.state, per session)
// and what it remembers about the rules it learned ($.store, across sessions).

/** Which file a rule lives in: ./CLAUDE.md or ~/.claude/CLAUDE.md. */
export type NotedScope = 'project' | 'global'

/** A rule already in one of the two files; `label` is how the band names the file. */
export type NotedExisting = { text: string; scope: NotedScope; path: string; label: string }

/** A rule noted saved, as kept in its store under "learned". */
export type NotedLearned = {
  id: string
  rule: string
  scope: NotedScope
  /** The absolute path of the CLAUDE.md it was written to. */
  path: string
  /** When it was added, as an ISO timestamp. */
  addedAt: string
}

/** What the band above the prompt shows; null hides it. */
export type NotedBand =
  | {
      kind: 'proposal'
      rule: string
      /** The existing rule this one contradicts: offer to replace it. */
      conflict: NotedExisting | null
      isEditing: boolean
      /** A line about the proposal itself (the old rule went missing). */
      note: string | null
    }
  | { kind: 'notice'; text: string; isError: boolean }
  | { kind: 'rules'; items: NotedLearned[]; globalLabel: string; message: string | null }

declare module 'claude-code' {
  interface PluginState {
    noted: { band: NotedBand | null }
  }
}
