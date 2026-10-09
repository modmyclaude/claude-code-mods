// The values Fine Print keeps in $.state for the session.

/** A topic Fine Print can watch for (the `watchFor` setting). */
export type FinePrintTopic =
  | 'cost'
  | 'security'
  | 'data-loss'
  | 'irreversible'
  | 'customers'
  | 'assumptions'

/** What the person did with a note: still open, or which button they pressed. */
export type FinePrintNoteStatus = 'open' | 'acknowledged' | 'dismissed' | 'explained'

/** One note flagged after a long reply. */
export type FinePrintNote = {
  /** The id of the turn whose reply was read. */
  id: string
  /** When it was flagged, ms since the epoch. */
  at: number
  headline: string
  bullets: string[]
  topics: FinePrintTopic[]
  status: FinePrintNoteStatus
}

declare module 'claude-code' {
  interface PluginState {
    'fine-print': {
      /** Every note flagged this session, oldest first. */
      notes: FinePrintNote[]
      /** The id of the note shown above the prompt, or null for none. */
      shown: string | null
      /** Model checks started this session (the spend cap counts these). */
      checks: number
      /** The cap's status line was shown already. */
      capNoticed: boolean
      /** The one "could not reach the model" toast was shown already. */
      warned: boolean
    }
  }
}
