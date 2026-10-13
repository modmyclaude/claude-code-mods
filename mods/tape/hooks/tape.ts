// What the tape shows and how it moves, as pure functions over plain values:
// the symbol list, the sources' answers, the cells of a row, the marquee's
// window and the pages of the rotate mode. Nothing here reaches the engine,
// so every rule is testable on its own.

import type { TapeQuotes } from '../types'

export const DEFAULT_SYMBOLS = 'AAPL,NVDA,TSLA,AMZN,SP500,GOLD,BTC,ETH'
/** A symbol as this mod will draw it: letters, digits, a colon, a dot or a dash, sixteen at most. */
export const SYMBOL_RE = /^[A-Z0-9][A-Z0-9:.-]{0,15}$/
/** Symbols at most; the rest of a long setting are dropped. */
export const SYMBOLS_MAX = 40
/** The marquee moves one cell per frame, ten frames a second: the engine's own ceiling for redraws. */
export const FRAME_MS = 100
/** The longest wait between fetches after failures. */
export const MAX_INTERVAL_MS = 300_000
/** The gap between two symbols on the tape. */
export const GAP = '   '

export type Tone = 'up' | 'down' | 'flat' | 'dim' | 'name'
export type Motion = 'scroll' | 'rotate'

/** The symbols of a setting or a command, upper-cased, cleaned, deduplicated, capped. */
export function parseSymbols(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/[\s,;]+/)) {
    const s = raw.trim().toUpperCase()
    if (s === '' || !SYMBOL_RE.test(s) || out.includes(s)) continue
    out.push(s)
    if (out.length >= SYMBOLS_MAX) break
  }
  return out
}

export function isMotion(value: unknown): value is Motion {
  return value === 'scroll' || value === 'rotate'
}

/** A finite positive number from what a source wrote, or undefined. */
function numberOf(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Hyperliquid `allMids`: `{ "BTC": "83508.0", "xyz:AAPL": "346.16" }` to prices, keys cleaned, values checked. */
export function parseMids(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return out
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return out
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const n = numberOf(value)
    if (n !== undefined && /^[A-Za-z0-9:.-]{1,24}$/.test(key)) out[key] = n
  }
  return out
}

/** Hyperliquid `metaAndAssetCtxs`: `[{ universe: [{ name }] }, [{ midPx, prevDayPx }]]` to the previous day's price by name. */
export function parseAssetCtxs(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return out
  }
  if (!Array.isArray(data) || data.length < 2) return out
  const meta = data[0] as { universe?: unknown } | null
  const ctxs = data[1]
  const universe = meta !== null && typeof meta === 'object' && Array.isArray(meta.universe) ? meta.universe : []
  if (!Array.isArray(ctxs)) return out
  universe.forEach((asset, i) => {
    const name = asset !== null && typeof asset === 'object' ? (asset as { name?: unknown }).name : undefined
    const ctx = ctxs[i]
    if (typeof name !== 'string' || !/^[A-Za-z0-9:.-]{1,24}$/.test(name) || ctx === null || typeof ctx !== 'object') return
    const prev = numberOf((ctx as { prevDayPx?: unknown }).prevDayPx)
    if (prev !== undefined) out[name] = prev
  })
  return out
}

/** Alpaca `stocks/snapshots`: `{ "AAPL": { latestTrade: { p }, prevDailyBar: { c } } }` to prices by symbol. */
export function parseSnapshots(text: string): Record<string, { price: number; prevDay?: number }> {
  const out: Record<string, { price: number; prevDay?: number }> = {}
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return out
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return out
  for (const [symbol, snap] of Object.entries(data as Record<string, unknown>)) {
    if (!SYMBOL_RE.test(symbol) || snap === null || typeof snap !== 'object') continue
    const s = snap as { latestTrade?: { p?: unknown }; dailyBar?: { c?: unknown }; prevDailyBar?: { c?: unknown } }
    const price = numberOf(s.latestTrade?.p) ?? numberOf(s.dailyBar?.c)
    if (price === undefined) continue
    const prevDay = numberOf(s.prevDailyBar?.c)
    out[symbol] = prevDay !== undefined ? { price, prevDay } : { price }
  }
  return out
}

/** A price as the tape writes it: whole with commas from a thousand up, two decimals below. */
export function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return '?'
  if (n >= 1000) return Math.round(n).toLocaleString('en-US')
  if (n >= 1) return n.toFixed(2)
  return n.toPrecision(3)
}

/** The day's change as the tape writes it, with its tone; `--` dim where the earlier price is unknown; never NaN. */
export function fmtChange(price: number, prevDay: number | undefined): { text: string; tone: Tone } {
  if (prevDay === undefined || !Number.isFinite(prevDay) || prevDay <= 0 || !Number.isFinite(price)) return { text: '--', tone: 'dim' }
  const pct = ((price - prevDay) / prevDay) * 100
  const rounded = Math.round(pct * 10) / 10
  if (rounded === 0) return { text: '0.0%', tone: 'flat' }
  return { text: `${rounded > 0 ? '+' : '-'}${Math.abs(rounded).toFixed(1)}%`, tone: rounded > 0 ? 'up' : 'down' }
}

/** One symbol's cell on the tape. */
export type Cell = { symbol: string; price: string; change: string; tone: Tone; known: boolean }

export function cellsOf(symbols: readonly string[], quotes: TapeQuotes): Cell[] {
  return symbols.map(symbol => {
    const q = quotes[symbol]
    if (q === undefined) return { symbol, price: '?', change: '', tone: 'dim', known: false }
    const change = fmtChange(q.price, q.prevDay)
    return { symbol, price: fmtPrice(q.price), change: change.text, tone: change.tone, known: true }
  })
}

/** A run of text drawn in one tone. */
export type Run = { text: string; tone: Tone }

/** The runs of one cell: the name, the price, the change. */
export function runsOfCell(cell: Cell): Run[] {
  const runs: Run[] = [{ text: cell.symbol, tone: cell.known ? 'name' : 'dim' }, { text: ` ${cell.price}`, tone: cell.known ? 'name' : 'dim' }]
  if (cell.change !== '') runs.push({ text: ` ${cell.change}`, tone: cell.tone })
  return runs
}

export function cellWidth(cell: Cell): number {
  return runsOfCell(cell).reduce((n, r) => n + [...r.text].length, 0)
}

/** The whole tape as one ring of runs: every cell, a gap after each, so the marquee loops with a gap. */
export function ring(cells: readonly Cell[]): Run[] {
  if (cells.length === 0) return [{ text: `no symbols${GAP}`, tone: 'dim' }]
  const runs: Run[] = []
  for (const cell of cells) {
    runs.push(...runsOfCell(cell))
    runs.push({ text: GAP, tone: 'dim' })
  }
  return runs
}

export function ringLength(runs: readonly Run[]): number {
  return runs.reduce((n, r) => n + [...r.text].length, 0)
}

/** The `width` cells of the ring from `offset`, wrapping, as runs cut at the window's edges. */
export function windowOf(runs: readonly Run[], offset: number, width: number): Run[] {
  const total = ringLength(runs)
  if (total === 0 || width <= 0 || runs.length === 0) return []
  let start = ((Math.floor(offset) % total) + total) % total
  let i = 0
  while (i < runs.length && start >= [...runs[i]!.text].length) {
    start -= [...runs[i]!.text].length
    i += 1
  }
  const out: Run[] = []
  let need = width
  while (need > 0) {
    const run = runs[i % runs.length]!
    const chars = [...run.text]
    const take = chars.slice(start, start + need)
    if (take.length > 0) out.push({ text: take.join(''), tone: run.tone })
    need -= take.length
    start = 0
    i += 1
  }
  return out
}

/** Whole cells packed into pages of at most `width` cells, a gap between cells; a cell wider than the page goes alone. */
export function pagesOf(cells: readonly Cell[], width: number): Cell[][] {
  const pages: Cell[][] = []
  let page: Cell[] = []
  let used = 0
  for (const cell of cells) {
    const w = cellWidth(cell)
    const needed = page.length === 0 ? w : used + GAP.length + w
    if (page.length > 0 && needed > width) {
      pages.push(page)
      page = []
      used = 0
    }
    page.push(cell)
    used = page.length === 1 ? w : used + GAP.length + w
  }
  if (page.length > 0) pages.push(page)
  return pages
}

/** The runs of one page: its cells with gaps between, no gap after the last. */
export function runsOfPage(page: readonly Cell[]): Run[] {
  const runs: Run[] = []
  page.forEach((cell, i) => {
    if (i > 0) runs.push({ text: GAP, tone: 'dim' })
    runs.push(...runsOfCell(cell))
  })
  return runs
}

/** The wait after one more failure: double, capped. */
export function backoff(intervalMs: number): number {
  return Math.min(MAX_INTERVAL_MS, Math.max(1000, intervalMs) * 2)
}

/** How old the last good prices are, in words. */
export function ageOf(now: number, lastOk: number | null): string {
  if (lastOk === null) return 'no prices yet'
  const s = Math.max(0, Math.round((now - lastOk) / 1000))
  if (s < 60) return `${s}s old`
  if (s < 3600) return `${Math.round(s / 60)}m old`
  return `${Math.round(s / 3600)}h old`
}

/** The nonessential-traffic switch counts as set unless empty, `0` or `false`. */
export function isQuiet(value: string | undefined): boolean {
  if (value === undefined) return false
  const v = value.trim().toLowerCase()
  return v !== '' && v !== '0' && v !== 'false'
}

/** The lead cell: the mod's name and its source, and the age of the prices when the last fetch failed. */
export function leadOf(source: 'hyperliquid' | 'alpaca', staleAge: string | undefined): string {
  const name = source === 'alpaca' ? 'alpaca iex' : 'hyperliquid perps'
  return staleAge === undefined ? `tape · ${name}` : `tape · ${name} · ${staleAge}`
}
