// The values Crossroads keeps in $.state for the session: what the band
// above the prompt shows right now.

/** What a suggestion would do, so the person's habits can be counted. */
export type CrossroadsKind =
  | 'test'
  | 'fix'
  | 'run'
  | 'review'
  | 'explain'
  | 'refactor'
  | 'docs'
  | 'commit'
  | 'ship'
  | 'feature'
  | 'other'

/** One suggested next prompt. */
export type CrossroadsItem = {
  /** The prompt as it would be drafted, already sanitized. */
  text: string
  kind: CrossroadsKind
  /** A short note ("deploys", "pushes") when the prompt is risky; null when safe. */
  risk: string | null
  /** True for the engine's own guess (the dim ghost text), passed through as option 1. */
  fromEngine: boolean
}

/** What the band shows. `epoch` names the turn the list belongs to. */
export type CrossroadsView =
  | { phase: 'idle' }
  | { phase: 'loading'; epoch: number }
  | { phase: 'shown'; epoch: number; items: CrossroadsItem[]; digits: boolean }
  | { phase: 'copied'; epoch: number; item: CrossroadsItem; isCopied: boolean }

declare module 'claude-code' {
  interface PluginState {
    crossroads: {
      view: CrossroadsView
    }
  }
}
