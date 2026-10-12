// Switchboard's pure parts: the record a session writes about itself, how a
// reader turns records into rows, and the words the pane, band, footer and
// toasts say. Nothing here touches the engine, so the tests pin every case.

import type { SwitchboardRow, SwitchboardState, SwitchboardWhere } from '../types'

/**
 * What a session writes about itself, one small JSON file per session: its name
 * (its title, else its folder), state, where it runs, what a dialog waits on (in
 * Claude Code's words: a tool's name), times and cost. Never message text.
 */
export type SessionRecord = {
  v: 1
  id: string
  name: string
  state: SwitchboardState
  since: number
  /** The heartbeat: a live session rewrites its record at least this often (HEARTBEAT_MS). */
  updatedAt: number
  costUsd?: number
  where?: SwitchboardWhere
  /** What a `needs-you` session waits on: "a permission for Bash", "a question". */
  waitingOn?: string
  /** When a turn last ran or a dialog last opened; absent when none has since Switchboard loaded. */
  lastActiveAt?: number
  /** A session opened and not prompted yet (no turn in its transcript). */
  isNew?: boolean
}

/** A live session rewrites its record at least this often. */
export const HEARTBEAT_MS = 30_000
/** A record not rewritten for three heartbeats belongs to a session that is gone (closed, crashed, asleep). */
export const STALE_MS = 3 * HEARTBEAT_MS
/** A gone session stays listed this long, then drops off. */
export const SHOWN_GONE_MS = 60 * 60_000
/** An idle session with no turn for this long folds into one "quiet" line. */
export const QUIET_MS = 60 * 60_000
/** How often an attached session reads the others. */
export const POLL_MS = 5_000
/** The most records one read opens, newest first. */
export const MAX_SESSIONS = 60

const STATES: readonly string[] = ['working', 'needs-you', 'error', 'idle', 'gone']
const WHERES: readonly string[] = ['terminal', 'desktop', 'background']

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
    state: r.state as SwitchboardState,
    since: r.since,
    updatedAt: r.updatedAt,
    ...(cost === undefined ? {} : { costUsd: cost }),
    ...(typeof r.where === 'string' && WHERES.includes(r.where) ? { where: r.where as SwitchboardWhere } : {}),
    ...(typeof r.waitingOn === 'string' && r.waitingOn !== '' ? { waitingOn: oneLine(r.waitingOn, 40) } : {}),
    ...(typeof r.lastActiveAt === 'number' ? { lastActiveAt: r.lastActiveAt } : {}),
    ...(r.isNew === true ? { isNew: true } : {}),
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
 * An idle session with no turn in the last hour is `isQuiet`: the pane folds
 * those into one line. Two sessions with one name are told apart by where they run.
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
    const isMine = r.id === mine
    if (state === 'gone' && now - r.updatedAt > SHOWN_GONE_MS && !isMine) continue
    const lastActiveAt = r.lastActiveAt
    rows.push({
      id: r.id,
      name: oneLine(r.name, 48) || 'session',
      state,
      since: state === 'gone' && r.state !== 'gone' ? r.updatedAt : r.since,
      where: r.where ?? 'terminal',
      ...(state === 'needs-you' && r.waitingOn !== undefined ? { waitingOn: r.waitingOn } : {}),
      ...(r.costUsd === undefined ? {} : { costUsd: r.costUsd }),
      // A session nobody has prompted yet is new, not quiet: someone just opened it.
      isQuiet: !isMine && state === 'idle' && r.isNew !== true && (lastActiveAt === undefined || now - lastActiveAt > QUIET_MS),
      isNew: state === 'idle' && r.isNew === true,
      isMine,
    })
  }
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1)
  return rows
    .map(row => ((counts.get(row.name) ?? 0) > 1 ? { ...row, name: `${row.name} · ${row.id.slice(0, 4)}` } : row))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || Number(a.isQuiet) - Number(b.isQuiet) || b.since - a.since || a.name.localeCompare(b.name))
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
  return rows.map(r => `${r.id}|${r.name}|${r.where}|${r.isQuiet}|${stateWords(r, now)}|${costWords(r.costUsd)}|${r.isMine}`).join('\n')
}

/** Shape and colour together, never colour alone. */
export const MARK: Record<SwitchboardState, { shape: string; color?: string; dimColor?: boolean }> = {
  'needs-you': { shape: '!', color: 'warning' },
  error: { shape: '✕', color: 'error' },
  working: { shape: '●', color: 'success' },
  idle: { shape: '○', dimColor: true },
  gone: { shape: '-', dimColor: true },
}

/**
 * What a dialog waits on, from Claude Code's notice type and the tool the turn
 * last called: "a permission for Bash", "a question", "a plan to approve".
 */
export function waitingWords(notice: string, tool: string | undefined): string {
  if (notice === 'elicitation_dialog' || notice === 'elicitation_url_dialog' || notice === 'agent_needs_input') return 'an answer'
  // A subagent's dialog: the tool the main loop last called is not the one it asks about.
  if (notice === 'worker_permission_prompt') return "a subagent's permission"
  if (tool === 'AskUserQuestion') return 'a question'
  if (tool === 'ExitPlanMode') return 'a plan to approve'
  if (tool === undefined || tool === '') return 'a permission'
  const short = tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool
  return `a permission for ${oneLine(short, 24)}`
}

/** `under a minute`, `12m`, `3h`, `2d`: whole units, so the pane redraws at most once a minute. */
export function ageWords(ms: number): string {
  if (ms < 60_000) return 'under a minute'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

/** A row's state as a phrase that explains itself: "idle for 9m", "closed 2m ago". */
export function stateWords(row: SwitchboardRow, now: number): string {
  const age = ageWords(now - row.since)
  switch (row.state) {
    case 'needs-you':
      return `waiting on ${row.waitingOn ?? 'you'} · ${age}`
    case 'error':
      return age === 'under a minute' ? 'stopped on an error just now' : `stopped on an error ${age} ago`
    case 'working':
      return `working for ${age}`
    case 'idle':
      // A quiet row's own age is only since Switchboard loaded into it: say what is known instead.
      return row.isNew ? 'new, no prompt yet' : row.isQuiet ? 'no turn in the last hour' : `idle for ${age}`
    case 'gone':
      return age === 'under a minute' ? 'closed just now' : `closed ${age} ago`
  }
}

export const WHERE_WORDS: Record<SwitchboardWhere, string> = { terminal: 'terminal', desktop: 'desktop', background: 'background' }

/** `≈$0.49`, `≈$123`, or '' when there is no figure or it is under a cent. */
export function costWords(usd: number | undefined): string {
  if (usd === undefined || usd < 0.01) return ''
  return usd < 100 ? `≈$${usd.toFixed(2)}` : `≈$${Math.round(usd)}`
}

const others = (rows: readonly SwitchboardRow[]) => rows.filter(row => !row.isMine)
const needing = (rows: readonly SwitchboardRow[]) => others(rows).filter(row => needsYou(row.state))

/** The pane's first line: what needs you, else that nothing does. */
export function heroLine(rows: readonly SwitchboardRow[]): { text: string; tone: 'warning' | 'subtle' | 'success' } {
  const n = needing(rows).length
  if (n > 0) return { text: `${n} need${n === 1 ? 's' : ''} you`, tone: 'warning' }
  const live = others(rows).filter(row => row.state !== 'gone').length
  if (live === 0) return { text: 'Only this session', tone: 'subtle' }
  return { text: `Nothing needs you · ${live} other session${live === 1 ? '' : 's'}`, tone: 'success' }
}

/** The pane's pinned line about this session. */
export function hereLine(rows: readonly SwitchboardRow[]): string | null {
  const me = rows.find(row => row.isMine)
  return me === undefined ? null : `You are here: ${me.name} (${WHERE_WORDS[me.where]})`
}

/** The folded line for idle sessions with no turn in the last hour. */
export function quietLine(count: number): string {
  return `${count} quiet session${count === 1 ? '' : 's'}: idle, no turn in the last hour`
}

export const EMPTY_LINE = 'Only this session runs Switchboard. Install it for all sessions to see the rest.'

/** The band's one line while another session needs you, or null. */
export function bandLine(rows: readonly SwitchboardRow[]): string | null {
  const list = needing(rows)
  const first = list[0]
  if (first === undefined) return null
  if (list.length === 1) return `${first.name} ${first.state === 'error' ? 'stopped on an error' : 'needs you'} (${WHERE_WORDS[first.where]})`
  const names = list.slice(0, 2).map(r => r.name).join(', ')
  return `${list.length} sessions need you: ${names}${list.length > 2 ? ', …' : ''}`
}

/** The footer's label while another session needs you, or null. */
export function footerLabel(rows: readonly SwitchboardRow[]): string | null {
  const n = needing(rows).length
  return n === 0 ? null : `${n} need${n === 1 ? 's' : ''} you`
}

/** The toast for a session that just started needing you (at most 12 words). */
export function toastLine(row: SwitchboardRow): string {
  const where = WHERE_WORDS[row.where]
  return row.state === 'error' ? `${row.name} stopped on an error (${where}).` : `${row.name} needs you (${where}).`
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

/** Where Claude Code keeps a session's transcript: the folder under `projects/` is the cwd with every non-alphanumeric character as `-`. */
export function transcriptPath(configDir: string, cwd: string, id: string): string {
  return `${configDir}/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${id}.jsonl`
}

/**
 * The session's title from the end of its transcript: the last title the
 * person set (`custom-title`, the desktop sidebar's), else the last one Claude
 * Code wrote (`ai-title`). Only those lines are parsed; every other line is
 * skipped unread, and the first (cut mid-line by the tail) never parses.
 */
export function titleFromTail(tail: string): string | undefined {
  let custom: string | undefined
  let ai: string | undefined
  for (const line of tail.split('\n')) {
    if (!line.includes('-title"')) continue
    try {
      const entry = JSON.parse(line) as { type?: unknown; customTitle?: unknown; aiTitle?: unknown }
      if (entry.type === 'custom-title' && typeof entry.customTitle === 'string' && entry.customTitle.trim() !== '') custom = entry.customTitle
      if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string' && entry.aiTitle.trim() !== '') ai = entry.aiTitle
    } catch {
      // The line the tail cut in half.
    }
  }
  const title = custom ?? ai
  return title === undefined ? undefined : oneLine(title, 48)
}
