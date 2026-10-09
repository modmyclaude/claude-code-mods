// Pure rules for Pager: what pages, when it stays quiet, and what a push says.
// No `$` here, so every rule is tested on plain values.

import type { TurnCompleteInput } from 'claude-code'

export const PACKS = ['classic', 'arcade', 'zen'] as const
export type Pack = (typeof PACKS)[number]
export const DEFAULT_PACK: Pack = 'classic'

export const KINDS = ['done', 'needs-you', 'error'] as const
export type Kind = (typeof KINDS)[number]

export const LABEL: Record<Kind, string> = {
  done: 'Done',
  'needs-you': 'Needs you',
  error: 'Error',
}

/** At most one sound (and one push) every five seconds, whatever the events. */
export const GAP_MS = 5_000
export const DEFAULT_MUTE_MS = 60 * 60_000
export const MAX_MUTE_MS = 7 * 24 * 60 * 60_000

export const isPack = (value: unknown): value is Pack =>
  typeof value === 'string' && (PACKS as readonly string[]).includes(value)

/** The clip for one alert, relative to the plugin folder as `$.audio.play` takes it. */
export const assetFor = (pack: Pack, kind: Kind) => `sounds/${pack}/${kind}.wav`

/**
 * Which turn endings page you. A subagent's turn never does (its parent's turn
 * will), and neither does an interrupt: you, or a plugin acting on your input,
 * stopped it, so you are already there.
 */
export function turnAlert(
  e: Pick<TurnCompleteInput, 'reason' | 'durationMs' | 'agentId'>,
  minMs: number,
): Kind | undefined {
  if (e.agentId !== undefined) return undefined
  if (e.reason === 'error' || e.reason === 'refusal') return 'error'
  if (e.reason === 'answer' && e.durationMs >= minMs) return 'done'
  return undefined
}

/**
 * The engine's own Notification types that mean "a dialog is waiting on you".
 * Claude Code raises them once a permission prompt, question, plan approval or
 * MCP input request has waited about six seconds without a keypress. Left out
 * on purpose: idle_prompt (it follows a finished turn, which already paged),
 * agent_completed, auth and the rest.
 */
const NEEDS_YOU = new Set([
  'permission_prompt',
  'worker_permission_prompt',
  'elicitation_dialog',
  'elicitation_url_dialog',
  'agent_needs_input',
])

export const notificationAlert = (type: string): Kind | undefined =>
  NEEDS_YOU.has(type) ? 'needs-you' : undefined

const UNIT_MS: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 }

/**
 * A mute length: `30m`, `2h`, `1h30m`, `45s`, `1d`; a bare number is minutes.
 * Undefined for anything else, for zero, and past seven days.
 */
export function parseDuration(text: string): number | undefined {
  const t = text.trim().toLowerCase()
  let ms: number
  if (/^\d+$/.test(t)) {
    ms = Number(t) * UNIT_MS.m!
  } else if (/^(\d+[dhms])+$/.test(t)) {
    ms = 0
    for (const [, n, unit] of t.matchAll(/(\d+)([dhms])/g)) ms += Number(n) * UNIT_MS[unit!]!
  } else {
    return undefined
  }
  return ms > 0 && ms <= MAX_MUTE_MS ? ms : undefined
}

/** A daily window in minutes since local midnight; `end` before `start` wraps midnight. */
export type QuietHours = { start: number; end: number }

/**
 * `22:00-07:00` (or `22-7`). `null` when the setting is empty (off),
 * `undefined` when it cannot be read (also off, and said once at start).
 */
export function parseQuietHours(text: string): QuietHours | null | undefined {
  if (text.trim() === '') return null
  const m = /^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?$/.exec(text.trim())
  if (!m) return undefined
  const minute = (h: string, mm = '0') =>
    Number(h) <= 23 && Number(mm) <= 59 ? Number(h) * 60 + Number(mm) : NaN
  const start = minute(m[1]!, m[2])
  const end = minute(m[3]!, m[4])
  if (Number.isNaN(start) || Number.isNaN(end) || start === end) return undefined
  return { start, end }
}

export function isQuiet(window: QuietHours | null | undefined, minuteOfDay: number): boolean {
  if (!window) return false
  return window.start < window.end
    ? minuteOfDay >= window.start && minuteOfDay < window.end
    : minuteOfDay >= window.start || minuteOfDay < window.end
}

/** Minutes since local midnight for an epoch time. */
export const minuteOfDay = (ms: number) => {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `14:05`, `tomorrow 07:30` or `Oct 12 14:05`, in local time. */
export function untilText(now: number, until: number): string {
  const a = new Date(now)
  const b = new Date(until)
  const time = `${pad(b.getHours())}:${pad(b.getMinutes())}`
  const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((dayOf(b) - dayOf(a)) / 86_400_000)
  if (days === 0) return time
  if (days === 1) return `tomorrow ${time}`
  return `${MONTHS[b.getMonth()]} ${b.getDate()} ${time}`
}

/** `20s`, `2m 5s`, `1h 30m`, `7d`: the two largest units that are not zero. */
export function formatDuration(ms: number): string {
  let s = Math.max(0, Math.round(ms / 1000))
  const parts: string[] = []
  for (const [unit, size] of [['d', 86_400], ['h', 3_600], ['m', 60], ['s', 1]] as const) {
    const n = Math.floor(s / size)
    s -= n * size
    if (n > 0) parts.push(`${n}${unit}`)
  }
  return parts.slice(0, 2).join(' ') || '0s'
}

/**
 * The ntfy topic setting: `null` when unset (push off), `undefined` when it is
 * not a topic ntfy.sh accepts (push off, said once at start). A pasted
 * `https://ntfy.sh/<topic>` URL is taken as its topic.
 */
export function parseTopic(raw: unknown): string | null | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const topic = raw.trim().replace(/^https:\/\/ntfy\.sh\//, '')
  return /^[A-Za-z0-9_-]{1,64}$/.test(topic) ? topic : undefined
}

/** What reaches ntfy.sh: fixed words and a duration, never conversation text. */
export function pushFor(kind: Kind, durationMs?: number): { title: string; body: string } {
  switch (kind) {
    case 'done':
      return {
        title: 'Pager: done',
        body: durationMs === undefined ? 'A turn finished.' : `A turn finished after ${formatDuration(durationMs)}.`,
      }
    case 'needs-you':
      return { title: 'Pager: needs you', body: 'Claude is waiting on a permission or a question.' }
    case 'error':
      return { title: 'Pager: error', body: 'A turn ended on an error.' }
  }
}

/** The name a toast shows: the session's title, else its project folder. */
export function sessionName(title: string | undefined, root: string | undefined): string {
  const clip = (s: string) => (s.length > 60 ? `${s.slice(0, 59)}...` : s)
  if (title?.trim()) return clip(title.trim())
  const folder = root?.split(/[\\/]/).filter(Boolean).at(-1)
  return folder ? clip(folder) : 'this session'
}
