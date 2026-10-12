// What chapters keeps in $.state for the session: the review on show (its
// chapters, which are read, which one is open) and where it came from. The
// diff's hunks live in the module's memory beside it.

export type ChaptersRisk = 'none' | 'low' | 'high'

/** One chapter of a review, as the model wrote it and the person read it. */
export type ChaptersChapter = {
  title: string
  /** The files it covers, and the new-side lines when the model named them. */
  files: { path: string; lines?: [number, number] }[]
  what: string
  why: string
  risk: ChaptersRisk
  riskWhy: string
  /** One thing a reviewer should check. */
  question: string
  isRead: boolean
}

export type ChaptersReview = {
  status: 'loading' | 'ready' | 'failed'
  /** What was reviewed, in words ("uncommitted changes", "staged changes", "this branch against main"). */
  scope: string
  chapters: ChaptersChapter[]
  /** The open chapter, from 0. */
  at: number
  /** Files of the diff not sent to the model (past the cap). */
  left: number
  /** Why there is no review, when status is failed. */
  reason?: string
}

declare module 'claude-code' {
  interface PluginState {
    chapters: {
      review: ChaptersReview | null
    }
  }
}
