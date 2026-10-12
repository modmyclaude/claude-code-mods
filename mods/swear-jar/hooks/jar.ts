// Swear-jar's pure parts: the tic list, how a reply is counted, and the words
// the band, the status line and the pane say. Nothing here touches the engine.

import type { SwearJarCounts, SwearJarHit } from '../types'

/** The em dash, spelled by its code so no literal ever sits in a public file. */
export const EM_DASH = String.fromCharCode(0x2014)

/** The tics counted out of the box; the `tics` setting replaces this list. */
export const DEFAULT_TICS: readonly string[] = [
  "you're absolutely right",
  'you are absolutely right',
  'great question',
  'excellent question',
  'i apologize',
  'certainly!',
  'absolutely!',
  'as an ai',
  "it's worth noting",
  'i hope this helps',
  'let me know if',
  'delve',
  EM_DASH,
]

/** The one line the nudge adds to every request while it is on: about 30 tokens. */
export const NUDGE_TEXT = 'Plain words: do not open with praise or agreement phrases, avoid the em dash, say what you did.'

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g
const CURLY = /[‘’]/g

/** Text with no escape sequences or control characters and single spaces, edges kept. */
function squash(text: string): string {
  return text.replace(ANSI, '').replace(CONTROL, '�').replace(/\s+/g, ' ')
}

/** Text made safe to draw: squashed and trimmed. */
export function clean(text: string): string {
  return squash(text).trim()
}

/** A tic as the list keeps it: lower case, straight apostrophes, one line; the words "em dash" mean the character. */
export function normalizeTic(tic: string): string {
  const t = clean(tic).replace(CURLY, "'").toLowerCase()
  return /^em[ -]?dash(es)?$/.test(t) ? EM_DASH : t
}

/** The list from the `tics` setting: strings, cleaned and deduplicated; the built-in list when it leaves nothing. */
export function ticsOf(setting: unknown): string[] {
  const given = Array.isArray(setting) ? setting.filter((t): t is string => typeof t === 'string') : []
  const list = [...new Set(given.map(normalizeTic).filter(t => t !== ''))]
  return list.length > 0 ? list : [...DEFAULT_TICS]
}

/** What a tic is called on the board: the em dash by name, praise openers without their "you're". */
export function labelOf(tic: string): string {
  if (tic === EM_DASH) return 'em dashes'
  return tic.replace(/^you(?:'re| are) /, '').replace(/!$/, '')
}

/** The tic as a whole phrase, any case; word boundaries where the tic starts or ends with a letter or digit. */
function patternOf(tic: string): RegExp {
  const escaped = tic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const lead = /^[a-z0-9]/.test(tic) ? '\\b' : ''
  const tail = /[a-z0-9]$/.test(tic) ? '\\b' : ''
  return new RegExp(`${lead}${escaped}${tail}`, 'gi')
}

const SENTENCE_END = /[.!?\n]/
const WINDOW = 70

/** The sentence around a hit, cut to about 70 characters on each side of the tic. */
function sentenceAround(text: string, at: number, length: number): Pick<SwearJarHit, 'before' | 'tic' | 'after'> {
  let start = at
  while (start > 0 && !SENTENCE_END.test(text[start - 1] ?? '')) start -= 1
  let end = at + length
  while (end < text.length && !SENTENCE_END.test(text[end] ?? '')) end += 1
  if (end < text.length && text[end] !== '\n') end += 1
  const from = Math.max(start, at - WINDOW)
  const to = Math.min(end, at + length + WINDOW)
  const before = (from > start ? '...' : '') + squash(text.slice(from, at)).replace(/^\s+/, '')
  const after = squash(text.slice(at + length, to)).replace(/\s+$/, '') + (to < end ? '...' : '')
  return { before, tic: clean(text.slice(at, at + length)), after }
}

/** Every tic in a reply: counts by label, and the first 20 hits in their sentences. */
export function countReply(text: string, tics: readonly string[]): { counts: SwearJarCounts; hits: SwearJarHit[] } {
  const counts: SwearJarCounts = {}
  const hits: SwearJarHit[] = []
  const body = text.replace(CURLY, "'")
  for (const tic of tics) {
    const label = labelOf(tic)
    for (const m of body.matchAll(patternOf(tic))) {
      counts[label] = (counts[label] ?? 0) + 1
      if (hits.length < 20) hits.push({ label, ...sentenceAround(body, m.index ?? 0, m[0].length) })
    }
  }
  return { counts, hits }
}

export function merge(a: SwearJarCounts, b: SwearJarCounts): SwearJarCounts {
  const out: SwearJarCounts = { ...a }
  for (const [label, n] of Object.entries(b)) out[label] = (out[label] ?? 0) + n
  return out
}

export const total = (c: SwearJarCounts): number => Object.values(c).reduce((sum, n) => sum + n, 0)

/** Rows by count, highest first; ties keep the order the list names the tics in. */
export function rowsOf(c: SwearJarCounts): { label: string; count: number }[] {
  return Object.entries(c)
    .map(([label, count]) => ({ label, count }))
    .filter(r => r.count > 0)
    .sort((x, y) => y.count - x.count)
}

/** The band's one dim line: the top three of this session. */
export function bandWords(c: SwearJarCounts): string {
  return `swear-jar: ${rowsOf(c)
    .slice(0, 3)
    .map(r => `${r.label} ${r.count}`)
    .join(' · ')}`
}

export const statusWords = (c: SwearJarCounts): string => `swear-jar ${total(c)}`

/** The worst offender all time, or this session's while the jar is new. */
export function worst(all: SwearJarCounts, session: SwearJarCounts): { label: string; count: number } | undefined {
  return rowsOf(total(all) > 0 ? all : session)[0]
}

export type Show = { band: boolean; status: boolean }

/** The `show` setting: band (default), status, both or off. */
export function showOf(setting: unknown): Show {
  const word = typeof setting === 'string' ? setting.trim().toLowerCase() : 'band'
  if (word === 'status') return { band: false, status: true }
  if (word === 'both') return { band: true, status: true }
  if (word === 'off') return { band: false, status: false }
  return { band: true, status: false }
}

/** Counts as the store holds them: an object of whole positive numbers, anything else dropped. */
export function countsOf(stored: unknown): SwearJarCounts {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}
  const out: SwearJarCounts = {}
  for (const [label, n] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[clean(label)] = Math.floor(n)
  }
  return out
}

/** The scoreboard as plain lines, for a surface that places no pane (a transcript row, which the model does not read). */
export function scoreboardText(session: SwearJarCounts, all: SwearJarCounts, last: readonly SwearJarHit[], isNudge: boolean): string {
  const lines = [`Swear jar: ${total(session)} this session, ${total(all)} all time`]
  for (const r of rowsOf(session)) lines.push(`  ${r.label} ${r.count}`)
  const w = worst(all, session)
  if (w) lines.push(`Worst offender: ${w.label} (${w.count})`)
  lines.push(last.length === 0 ? 'Last reply: no tics' : `Last reply: ${last.map(h => h.label).join(', ')}`)
  lines.push(`Plain-words nudge ${isNudge ? 'on' : 'off'}`)
  return lines.join('\n')
}
