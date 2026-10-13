// The values tape keeps in $.state for the session: the last good prices,
// how the fetch loop is doing, and how the band is shown. Plain JSON data:
// the host holds them across a hot reload, and the band is drawn again when
// one changes. Every field added later is optional, and absent reads as its
// default, so a value kept by an older version still loads.

/** One symbol's last good price. */
export type TapeQuote = {
  /** The price as the source gave it. */
  price: number
  /** The price a day earlier, for the change; absent where the source gave none yet. */
  prevDay?: number
  /** Where the price came from. */
  source: 'hyperliquid' | 'alpaca'
  /** `$.clock.now()` milliseconds when it was fetched. */
  at: number
}

/** The last good price of every symbol that resolved, by symbol. */
export type TapeQuotes = Record<string, TapeQuote>

/** How the fetch loop is doing. */
export type TapeMeta = {
  /** When the last fetch succeeded, or null before the first. */
  lastOk: number | null
  /** When the last fetch failed, or null if none has. */
  lastErr: number | null
  /** The wait before the next fetch: the refresh setting, doubled after each failure up to five minutes. */
  intervalMs: number
  /** Alpaca refused the keys: stocks stay on Hyperliquid until the keys change. */
  alpacaRefused?: boolean
  /** Symbols no source knows, each logged once. */
  unknown?: string[]
}

/** How the band is shown this session. */
export type TapeView = {
  /** `/tape off` hides the band for the session; `/tape on` brings it back. */
  on: boolean
  /** A session override of the motion setting, from `/tape scroll` or `/tape rotate`. */
  motion?: 'scroll' | 'rotate'
  /** The marquee's position, in cells; wraps at the tape's length. */
  offset?: number
  /** The page shown while rotating; wraps at the page count. */
  page?: number
  /** A session override of the symbols setting, from `/tape add` and `/tape remove`. */
  symbols?: string
}

declare module 'claude-code' {
  interface PluginState {
    tape: {
      quotes: TapeQuotes
      meta: TapeMeta
      view: TapeView
    }
  }
}
