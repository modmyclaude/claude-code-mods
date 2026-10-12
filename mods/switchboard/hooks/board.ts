// Switchboard's pure parts: the record a session writes about itself, how a
// reader turns records into rows, and the words the pane, band and toasts say.
// Nothing here touches the engine, so the tests can pin every case directly.

import type { SwitchboardRow, SwitchboardState } from '../types'

/**
 * What a session writes about itself, one small JSON file per session. Never any
 * message text: a name, a state, two times and a cost.
 */
export type SessionRecord = {
  v: 1
  id: string
  name: string
  state: Exclude<SwitchboardState, 'gone'> | 'gone'
  since: number
  /** The heartbeat: a live session rewrites its record at least this often (HEARTBEAT_MS). */
  updatedAt: number
  costUsd?: number
}

/** A live session rewrites its record at least this often. */
export const HEARTBEAT_MS = 60_000
/** A record not rewritten for this long belongs to a session that is gone (closed, crashed, asleep). */
export const STALE_MS = 3 * HEARTBEAT_MS
/** A gone session stays listed this long, then drops off. */
export const SHOWN_GONE_MS = 60 * 60_000
/** How often an attached session reads the others. */
export const POLL_MS = 5_000
/** The most records one read opens, newest first. */
export const MAX_SESSIONS = 40

const STATES: readonly string[] = ['working', 'needs-you', 'error', 'idle', 'gone']

/** A record read from disk, or null when it is not one (another version, a half-written file). */
export function parseRecord(text: string): SessionRecord | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  if (r.v !== 1 || typeof r.id !== 'string' || r.id === '' || typeof r.name !== 'string') return null
  if (typeof r.state !== 'string' || !STATES.includes(r.state)) return null
  if (typeof r.since !== 'number' || typeof r.updatedAt !== 'number') return null
  const cost = typeof r.costUsd === 'number' && Number.isFinite(r.costUsd) && r.costUsd >= 0 ? r.costUsd : undefined
  return {
    v: 1,
    id: r.id,
    name: r.name,
    state: r.state as SessionRecord['state'],
    since: r.since,
    updatedAt: r.updatedAt,
    ...(cost === undefined ? {} : { costUsd: cost }),
  }
}

/** The state a reader shows: a record not rewritten lately is a session that is gone. */
export function liveState(record: SessionRecord, now: number): SwitchboardState {
  return now - record.updatedAt > STALE_MS ? 'gone' : record.state
}

/** Whether a row asks for the person: a dialog waiting, or a turn that ended on an error. */
export const needsYou = (state: SwitchboardState): boolean => state === 'needs-you' || state === 'error'

const ORDER: Record<SwitchboardState, number> = { 'needs-you': 0, error: 1, working: 2, idle: 3, gone: 4 }

/**
 * The rows the pane draws: who needs you first, then working, idle and recently
 * gone, the latest change first in each; gone sessions drop off after an hour.
 * Two sessions with one name get a short id each.
 */
export function rowsOf(records: readonly SessionRecord[], mine: string, now: number): SwitchboardRow[] {
  const latest = new Map<string, SessionRecord>()
  for (const r of records) {
    const had = latest.get(r.id)
    if (had === undefined || r.updatedAt > had.updatedAt) latest.set(r.id, r)
  }
  const rows: SwitchboardRow[] = []
  for (const r of latest.values()) {
    const state = liveState(r, now)
    if (state === 'gone' && now - r.updatedAt > SHOWN_GONE_MS && r.id !== mine) continue
    rows.push({ id: r.id, name: oneLine(r.name, 40) || 'session', state, since: state === 'gone' && r.state !== 'gone' ? r.updatedAt : r.since, ...(r.costUsd === undefined ? {} : { costUsd: r.costUsd }), isMine: r.id === mine })
  }
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1)
  return rows
    .map(row => ((counts.get(row.name) ?? 0) > 1 ? { ...row, name: `${row.name} ${row.id.slice(0, 4)}` } : row))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.since - a.since || a.name.localeCompare(b.name))
}

/**
 * Sessions other than this one that just started needing you: a toast each,
 * once per change. `seen` is the state each session had at the last read
 * (undefined on the first read, which raises nothing: the band shows those).
 */
export function newlyNeeding(rows: readonly SwitchboardRow[], seen: ReadonlyMap<string, string> | undefined): SwitchboardRow[] {
  if (seen === undefined) return []
  return rows.filter(row => !row.isMine && needsYou(row.state) && seen.get(row.id) !== `${row.state}@${row.since}`)
}

/** What each row was at this read, for the next read's comparison. */
export function seenOf(rows: readonly SwitchboardRow[]): Map<string, string> {
  return new Map(rows.map(row => [row.id, `${row.state}@${row.since}`]))
}

/** The rows as they would draw, so a read that changed nothing on screen writes nothing (no redraw). */
export function drawnKey(rows: readonly SwitchboardRow[], now: number): string {
  return rows.map(r => `${r.id}|${r.name}|${r.state}|${ageWords(now - r.since)}|${costWords(r.costUsd)}|${r.isMine}`).join('\n')
}

export const STATE_WORDS: Record<SwitchboardState, string> = {
  'needs-you': 'needs you',
  error: 'error',
  working: 'working',
  idle: 'idle',
  gone: 'gone',
}

/**
 * `now`, `12m`, `3h`, `2d`: how long a row has been in its state. Under a minute
 * is `now`, so the pane redraws once a minute at most, not on every read.
 */
export function ageWords(ms: number): string {
  if (ms < 60_000) return 'now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

/** `≈$0.49`, `≈$123`, or '' when there is no figure. */
export function costWords(usd: number | undefined): string {
  if (usd === undefined) return ''
  return usd < 100 ? `≈$${usd.toFixed(2)}` : `≈$${Math.round(usd)}`
}

/** The pane's hero line: what needs you, else how many sessions there are. */
export function heroLine(rows: readonly SwitchboardRow[]): { text: string; tone: 'warning' | 'subtle' | 'success' } {
  const live = rows.filter(r => r.state !== 'gone')
  const needing = rows.filter(r => !r.isMine && needsYou(r.state)).length
  if (needing > 0) return { text: `${needing} of ${live.length} need${needing === 1 ? 's' : ''} you`, tone: 'warning' }
  if (live.length <= 1) return { text: 'Only this session', tone: 'subtle' }
  return { text: `Nothing needs you · ${live.length} sessions`, tone: 'success' }
}

/** The band's one line while another session needs you, or null. */
export function bandLine(rows: readonly SwitchboardRow[]): string | null {
  const needing = rows.filter(r => !r.isMine && needsYou(r.state))
  if (needing.length === 0) return null
  if (needing.length === 1) return `${needing[0]?.name} ${needing[0]?.state === 'error' ? 'stopped on an error' : 'needs you'}`
  const names = needing.slice(0, 2).map(r => r.name).join(', ')
  return `${needing.length} sessions need you: ${names}${needing.length > 2 ? ', …' : ''}`
}

/** The toast for a session that just started needing you (at most 12 words). */
export function toastLine(row: SwitchboardRow): string {
  return row.state === 'error' ? `${row.name} stopped on an error.` : `${row.name} needs you.`
}

/** Text made safe to draw: no control characters, one line, cut to `max` with an ellipsis. */
export function oneLine(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  return chars.length <= max ? flat : `${chars.slice(0, Math.max(1, max - 1)).join('')}…`
}

/** A folder's last part, for a session with no title: `/work/api-server/` reads `api-server`. */
export function folderName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
}
