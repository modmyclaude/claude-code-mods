// The vault: ticket <-> value, in this module's memory and nowhere else.
//
// Not $.store (a file on disk), not $.state (any plugin may read it), not the
// transcript. A reload of the mod or the end of the session forgets it, and
// tickets from before then are refused in tools (see restore()).
//
// Tickets are `[secret:NAME#xxxxxx]`: NAME comes from where the value was found
// (its variable name, or its format), the six characters from
// crypto.getRandomValues. Nothing in a ticket is computed from the value, and
// the same value keeps the same ticket for the life of the vault.

import { detect, isLearnable, type Hit } from './detect'

export type Entry = {
  ticket: string
  /** `NAME#xxxxxx`, the ticket without its brackets. */
  label: string
  kind: string
  /** Where cloakroom first met it: `.env.local`, `Bash output`, `your prompt`. */
  source: string
  value: string
  prefix?: string
  /** Seeded from a .env file: kept when learned entries are evicted. */
  isSeeded: boolean
  hidden: number
  restored: number
}

export type Found = { start: number; end: number; entry: Entry }

/** Thrown when text cannot be scanned in full; every caller withholds the text. */
export class ScanError extends Error {
  override name = 'ScanError'
}

/** Longest string scanned in one piece. Longer text is withheld, never passed unscanned. */
export const MAX_SCAN_CHARS = 16 * 1024 * 1024
/** Wall-clock cap for one scan; past it the text is withheld. */
export const SCAN_BUDGET_MS = 4000
const MAX_ENTRIES = 2000

export const TICKET = /\[secret:[A-Z0-9_]{1,48}#[a-z2-7]{6}\]/g
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  let id = ''
  for (const b of bytes) id += ID_ALPHABET[b & 31] // 256 is a multiple of 32: uniform
  return id
}

export function sanitizeName(name: string): string {
  return (
    name
      .toUpperCase()
      .replace(/[^A-Z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'SECRET'
  )
}

// ------------------------------------------------------- encoded forms

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += b === undefined ? '=' : B64[(n >> 6) & 63]!
    out += c === undefined ? '=' : B64[n & 63]!
  }
  return out
}

/**
 * The spellings a value takes on the way through tools: JSON-escaped (once and
 * twice, as transcripts nest JSON), URL-encoded, and base64 at each of the
 * three byte alignments it can sit at inside a longer base64 run.
 */
export function encodedForms(value: string): string[] {
  const forms = new Set<string>()
  const json = JSON.stringify(value).slice(1, -1)
  forms.add(json)
  forms.add(JSON.stringify(json).slice(1, -1))
  try {
    forms.add(encodeURIComponent(value))
  } catch {
    // a lone surrogate: no URL form
  }
  const bytes = new TextEncoder().encode(value)
  forms.add(base64(bytes))
  for (let shift = 0; shift < 3; shift++) {
    if (shift > 0 && bytes.length < 12) break
    const padded = new Uint8Array(shift + bytes.length)
    padded.set(bytes, shift)
    const enc = base64(padded)
    // Characters that mix in a neighbour's bits differ by context: keep the
    // ones the value's bytes alone decide.
    const core = enc.slice(Math.ceil((shift * 8) / 6), Math.floor(((shift + bytes.length) * 8) / 6))
    if (core.length >= 12) {
      forms.add(core)
      forms.add(core.replace(/\+/g, '-').replace(/\//g, '_'))
    }
  }
  forms.delete(value)
  return [...forms].filter(form => form.length >= 8)
}

// ------------------------------------------------------- Aho-Corasick

/** Many needles, one linear pass: the longest needle ending at each position. */
class Matcher {
  private readonly next: Map<number, number>[] = [new Map()]
  private readonly fail: number[] = [0]
  private readonly outLen: number[] = [0]
  private readonly outEntry: (Entry | undefined)[] = [undefined]

  add(needle: string, entry: Entry): void {
    let s = 0
    for (let i = 0; i < needle.length; i++) {
      const c = needle.charCodeAt(i)
      let t = this.next[s]!.get(c)
      if (t === undefined) {
        t = this.next.length
        this.next.push(new Map())
        this.fail.push(0)
        this.outLen.push(0)
        this.outEntry.push(undefined)
        this.next[s]!.set(c, t)
      }
      s = t
    }
    if (needle.length > this.outLen[s]!) {
      this.outLen[s] = needle.length
      this.outEntry[s] = entry
    }
  }

  build(): void {
    const queue: number[] = []
    for (const t of this.next[0]!.values()) queue.push(t)
    for (let qi = 0; qi < queue.length; qi++) {
      const s = queue[qi]!
      for (const [c, t] of this.next[s]!) {
        let f = this.fail[s]!
        while (f !== 0 && !this.next[f]!.has(c)) f = this.fail[f]!
        const g = this.next[f]!.get(c)
        this.fail[t] = g !== undefined && g !== t ? g : 0
        // A node's own needle is the longest ending here; else its suffix's.
        if (this.outLen[t] === 0) {
          this.outLen[t] = this.outLen[this.fail[t]!]!
          this.outEntry[t] = this.outEntry[this.fail[t]!]
        }
        queue.push(t)
      }
    }
  }

  /**
   * Spans of known values, in order, overlapping ones merged as they are found
   * (each span is pushed and popped at most once, so a text of nothing but
   * matches still costs one pass). `isExact` is false on a merged span.
   */
  scan(text: string, offset: number): KnownSpan[] {
    const out: KnownSpan[] = []
    let s = 0
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      while (s !== 0 && !this.next[s]!.has(c)) s = this.fail[s]!
      s = this.next[s]!.get(c) ?? 0
      const len = this.outLen[s]!
      if (len === 0) continue
      let start = i + 1 - len
      const entry = this.outEntry[s]!
      let isExact = true
      // Ends only grow, so an overlap is always with the spans just pushed. A
      // span inside this match is absorbed; one reaching further back makes a
      // union that is no single value.
      while (out.length > 0 && out[out.length - 1]!.end - offset > start) {
        const last = out.pop()!
        if (last.start - offset < start) {
          start = last.start - offset
          isExact = false
        }
      }
      out.push({ start: start + offset, end: i + 1 + offset, entry, isExact })
    }
    return out
  }
}

type KnownSpan = Found & { isExact: boolean }

type Candidate = { start: number; end: number; len: number; rank: number; entry?: Entry; isExact: boolean; hit?: Hit }

/** Longer wins; on a tie, the more specific detector (lower rank; known values first). */
function better(a: Candidate, b: Candidate): boolean {
  return a.len > b.len || (a.len === b.len && a.rank < b.rank)
}

// ------------------------------------------------------- the vault

export type ScrubResult = { text: string; changed: boolean; entries: Entry[] }

export class Vault {
  private readonly byValue = new Map<string, Entry>()
  private readonly byTicket = new Map<string, Entry>()
  /** Values the person told cloakroom to stop hiding (/cloakroom forget). */
  private readonly ignored = new Set<string>()
  private matcher: Matcher | undefined
  /** Set when a value was learned since the last takeGrown(). */
  private grown = false

  get size(): number {
    return this.byValue.size
  }

  entries(): Entry[] {
    return [...this.byValue.values()]
  }

  /** The entry a ticket names: `[secret:A#x]`, `A#x`, or just `x`. */
  lookup(text: string): Entry | undefined {
    const raw = text.trim()
    const label = raw.replace(/^\[secret:/, '').replace(/\]$/, '')
    const direct = this.byTicket.get(`[secret:${label}]`)
    if (direct) return direct
    const id = label.split('#').pop() ?? ''
    if (!/^[a-z2-7]{6}$/.test(id)) return undefined
    for (const entry of this.byValue.values()) if (entry.label.endsWith(`#${id}`)) return entry
    return undefined
  }

  /** True once since a value joined the vault (so cached prompt parts get rescanned). */
  takeGrown(): boolean {
    const was = this.grown
    this.grown = false
    return was
  }

  /** The value's entry, minting its ticket the first time it is seen. */
  ticketFor(value: string, name: string, kind: string, source: string, extra: { prefix?: string; isSeeded?: boolean } = {}): Entry {
    const known = this.byValue.get(value)
    if (known) {
      if (extra.isSeeded) known.isSeeded = true
      return known
    }
    let label: string
    do label = `${sanitizeName(name)}#${randomId()}`
    while (this.byTicket.has(`[secret:${label}]`))
    const entry: Entry = {
      ticket: `[secret:${label}]`,
      label,
      kind,
      source,
      value,
      ...(extra.prefix ? { prefix: extra.prefix } : {}),
      isSeeded: extra.isSeeded === true,
      hidden: 0,
      restored: 0,
    }
    this.byValue.set(value, entry)
    this.byTicket.set(entry.ticket, entry)
    this.ignored.delete(value)
    this.evict()
    if (isLearnable(value, label.split('#')[0])) {
      this.matcher = undefined
      this.grown = true
    }
    return entry
  }

  /** Learns a value from a .env file. */
  seed(value: string, name: string, source: string): Entry {
    return this.ticketFor(value, name, 'From a .env file', source, { isSeeded: true })
  }

  /** Stops hiding a value this session; its ticket stops working in tools. */
  forget(entry: Entry): void {
    this.byValue.delete(entry.value)
    this.byTicket.delete(entry.ticket)
    this.ignored.add(entry.value)
    this.matcher = undefined
  }

  isIgnored(value: string): boolean {
    return this.ignored.has(value)
  }

  /** A hostile text full of fresh "keys" must not grow the vault without end. */
  private evict(): void {
    if (this.byValue.size <= MAX_ENTRIES) return
    for (const entry of this.byValue.values()) {
      if (entry.isSeeded) continue
      this.byValue.delete(entry.value)
      this.byTicket.delete(entry.ticket)
      this.matcher = undefined
      if (this.byValue.size <= MAX_ENTRIES) return
    }
  }

  private known(): Matcher {
    if (this.matcher) return this.matcher
    const matcher = new Matcher()
    for (const entry of this.byValue.values()) {
      // A path, a short value or a common default is hidden only where a detector finds it.
      if (!isLearnable(entry.value, entry.label.split('#')[0])) continue
      matcher.add(entry.value, entry)
      for (const form of encodedForms(entry.value)) matcher.add(form, entry)
    }
    matcher.build()
    this.matcher = matcher
    return matcher
  }

  /** Known values only, no detectors, nothing learned: for the audit. */
  scanKnown(text: string): Found[] {
    return this.byValue.size === 0 ? [] : this.known().scan(text, 0)
  }

  /**
   * Every secret in `text`: known values (and their encoded forms) plus
   * detector hits, merged into non-overlapping spans, each with its entry.
   * Tickets already in the text are kept as they are: the text between them is
   * scanned piece by piece, so no span can reach into one. New values are
   * learned. Throws ScanError when the text cannot be scanned in full.
   */
  find(text: string, source: string): Found[] {
    if (text.length > MAX_SCAN_CHARS) throw new ScanError(`a text of ${text.length} characters is too long to scan`)
    const started = performance.now()
    const out: Found[] = []
    let at = 0
    if (text.includes('[secret:')) {
      TICKET.lastIndex = 0
      for (let m = TICKET.exec(text); m !== null; m = TICKET.exec(text)) {
        this.findIn(text.slice(at, m.index), at, source, out)
        at = m.index + m[0].length
      }
    }
    this.findIn(at === 0 ? text : text.slice(at), at, source, out)
    if (performance.now() - started > SCAN_BUDGET_MS) throw new ScanError('the scan ran out of time')
    return out
  }

  private findIn(piece: string, offset: number, source: string, out: Found[]): void {
    if (piece.length === 0) return
    const spans: Candidate[] = []
    if (this.byValue.size > 0) {
      for (const k of this.known().scan(piece, offset)) {
        spans.push({ start: k.start, end: k.end, len: k.end - k.start, rank: -1, entry: k.entry, isExact: k.isExact })
      }
    }
    for (const hit of detect(piece)) {
      if (this.ignored.has(piece.slice(hit.start, hit.end))) continue
      const start = hit.start + offset
      const end = hit.end + offset
      spans.push({ start, end, len: end - start, rank: hit.rank, isExact: true, hit })
    }
    if (spans.length === 0) return
    spans.sort((a, b) => a.start - b.start || b.len - a.len || a.rank - b.rank)

    // Overlapping spans are hidden as one union, so no tail of a secret shows.
    for (let i = 0; i < spans.length; ) {
      const first = spans[i]!
      let end = first.end
      let best = first
      let j = i + 1
      for (; j < spans.length && spans[j]!.start < end; j++) {
        const span = spans[j]!
        if (span.end > end) end = span.end
        if (better(span, best)) best = span
      }
      i = j
      const start = first.start
      let entry = best.start === start && best.end === end && best.isExact ? best.entry : undefined
      if (!entry) {
        const value = piece.slice(start - offset, end - offset)
        if (this.ignored.has(value)) continue
        const name = best.entry ? best.entry.label.split('#')[0]! : best.hit!.name
        const kind = best.entry ? best.entry.kind : best.hit!.kind
        const prefix = best.hit?.prefix
        entry = this.ticketFor(value, name, kind, source, prefix ? { prefix } : {})
      }
      out.push({ start, end, entry })
    }
  }

  /**
   * `text` with every secret swapped for its ticket. `keepLines` pads a
   * multi-line secret with its line breaks, so line numbers stay true.
   */
  scrub(text: string, source: string, options: { keepLines?: boolean } = {}): ScrubResult {
    const found = this.find(text, source)
    if (found.length === 0) return { text, changed: false, entries: [] }
    const parts: string[] = []
    const entries: Entry[] = []
    let at = 0
    for (const { start, end, entry } of found) {
      parts.push(text.slice(at, start), entry.ticket)
      if (options.keepLines) {
        const breaks = text.slice(start, end).split('\n').length - 1
        if (breaks > 0) parts.push('\n'.repeat(breaks))
      }
      entry.hidden++
      entries.push(entry)
      at = end
    }
    parts.push(text.slice(at))
    return { text: parts.join(''), changed: true, entries }
  }

  /**
   * `text` with every ticket swapped back for its value. A well-formed ticket
   * this vault does not hold (from before a restart, or made up) is reported,
   * and the caller refuses the call rather than write the ticket literally.
   */
  restore(text: string): { text: string; unknown: string[]; entries: Entry[] } {
    if (!text.includes('[secret:')) return { text, unknown: [], entries: [] }
    const unknown: string[] = []
    const entries: Entry[] = []
    const restored = text.replace(TICKET, ticket => {
      const entry = this.byTicket.get(ticket)
      if (!entry) {
        unknown.push(ticket)
        return ticket
      }
      entry.restored++
      entries.push(entry)
      return entry.value
    })
    return { text: restored, unknown, entries }
  }
}
