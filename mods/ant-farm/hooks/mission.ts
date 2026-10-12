// Mission control's words and arithmetic: the status of a subagent from what
// was seen of it, the activity timeline's rows, the sparkline, the grid and
// the mission clock. Pure: no `$`, so the tests drive it directly.

import type { AntFarmAnt, AntFarmEvent, AntFarmEventKind } from '../types'

// ---------------------------------------------------------------- the live phase

/**
 * What a running subagent was last seen doing, from the events the engine
 * raises in its loop: nothing is inferred. `starting` until its first model
 * request; `thinking` while a thinking block streams; `writing` while text
 * streams; `tool` from the model naming a tool until the call answered;
 * `waiting` while the person is asked for a permission, or the engine's list
 * says the agent is held; `working` between a tool's answer and the next
 * request, and for an agent the mod only found mid-run.
 */
export type AntFarmPhase = 'starting' | 'thinking' | 'writing' | 'tool' | 'waiting' | 'working'

export type LivePhase = {
  phase: AntFarmPhase
  /** The tool and what it touches, or what is waited for. Untrusted: cleaned when drawn. */
  detail?: string
  /** `$.clock.now()` when the phase began; absent until the clock answered. */
  since?: number
}

/** The status word of a card, its colour and its mark: one of the five the dashboard names. */
export type StatusLook = { word: string; color: string; glyph: string }

export function statusLook(status: AntFarmAnt['status'], phase: AntFarmPhase | undefined): StatusLook {
  if (status === 'failed') return { word: 'FAILED', color: 'error', glyph: '✗' }
  if (status === 'done') return { word: 'DONE', color: 'success', glyph: '✓' }
  if (phase === 'waiting') return { word: 'WAITING', color: 'warning', glyph: '◇' }
  if (phase === 'thinking') return { word: 'THINKING', color: 'claude', glyph: '◌' }
  return { word: 'WORKING', color: 'suggestion', glyph: '●' }
}

/** The activity line of a running card: "Thinking · 4s", "Bash: npm test", "Waiting · permission for Bash". */
export function activityText(live: LivePhase | undefined, now: number): string {
  if (live === undefined) return 'Working'
  const forMs = live.since !== undefined ? Math.max(0, now - live.since) : undefined
  const since = forMs !== undefined && forMs >= 1000 ? ` · ${fmtShort(forMs)}` : ''
  switch (live.phase) {
    case 'starting': return `Starting${since}`
    case 'thinking': return `Thinking${since}`
    case 'writing': return `Writing${since}`
    case 'tool': return `${live.detail ?? 'A tool'}${since}`
    case 'waiting': return `Waiting${live.detail !== undefined ? ` · ${live.detail}` : ''}${since}`
    default: return `Working${since}`
  }
}

/** "4s", "1m 20s", "2h 05m": the short form used in activity lines and event rows. */
export function fmtShort(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

// ---------------------------------------------------------------- the mission clock

/** Mission elapsed time, as a launch clock reads: "T+00:00", "T+12:04", "T+1:02:33". */
export function met(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `T+${h}:${mm}:${ss}` : `T+${mm}:${ss}`
}

// ---------------------------------------------------------------- tools

/** The file tools: a call of one is a file modification on the timeline. */
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export type ToolSummary = { kind: 'tool' | 'file'; text: string }

/** The last path segment, so a row names the file and not its folder. */
export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return at === -1 ? trimmed : trimmed.slice(at + 1)
}

function firstLine(text: string, max: number): string {
  const line = text.split(/\r?\n/, 1)[0] ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const str = (input: Record<string, unknown>, key: string): string | undefined => {
  const v = input[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * A tool call in a few words for the timeline: the tool, then what it
 * touched (a file's name, a command's first line, a pattern). The words come
 * from the model's own arguments, so they are cleaned where drawn.
 */
export function toolSummary(tool: string, input: Record<string, unknown>): ToolSummary {
  if (FILE_TOOLS.has(tool)) {
    const path = str(input, 'file_path') ?? str(input, 'notebook_path')
    return { kind: 'file', text: `${tool} ${path !== undefined ? basename(path) : ''}`.trim() }
  }
  const mcp = /^mcp__([^_].*?)__(.+)$/.exec(tool)
  if (mcp !== null) return { kind: 'tool', text: `${mcp[1]}: ${mcp[2]}` }
  const detail =
    tool === 'Bash' ? firstLine(str(input, 'command') ?? '', 48)
    : tool === 'Read' ? basename(str(input, 'file_path') ?? '')
    : tool === 'Grep' || tool === 'Glob' ? firstLine(str(input, 'pattern') ?? '', 40)
    : tool === 'Agent' ? firstLine(str(input, 'description') ?? '', 40)
    : tool === 'WebFetch' ? firstLine(str(input, 'url') ?? '', 48)
    : tool === 'WebSearch' ? firstLine(str(input, 'query') ?? '', 40)
    : tool === 'Skill' ? firstLine(str(input, 'skill') ?? '', 40)
    : ''
  return { kind: 'tool', text: `${tool}${detail !== '' ? ` ${detail}` : ''}` }
}

/** A model response's stop reason worth a warning row, or undefined. */
export function stopWarning(stopReason: string | null, hasResponse: boolean): string | undefined {
  if (!hasResponse) return 'no response from the model'
  if (stopReason === 'max_tokens') return 'hit the output limit'
  if (stopReason === 'model_context_window_exceeded') return 'context window exceeded'
  if (stopReason === 'refusal') return 'the model refused'
  return undefined
}

// ---------------------------------------------------------------- the timeline

export const EVENTS_MAX = 80
export const TIMELINE_ROWS = 12
export const TIMELINE_ROWS_EXPANDED = 40

/** Appends one row, dropping the oldest past `max`. */
export function pushEvent(list: readonly AntFarmEvent[], event: AntFarmEvent, max = EVENTS_MAX): AntFarmEvent[] {
  const next = [...list, event]
  return next.length > max ? next.slice(next.length - max) : next
}

export type EventLook = { glyph: string; word: string; color?: string }

/** How a kind of row reads: its mark, its word and its colour (none: the surface's text colour). */
export function eventLook(kind: AntFarmEventKind): EventLook {
  switch (kind) {
    case 'spawn': return { glyph: '⇢', word: 'start', color: 'claude' }
    case 'handoff': return { glyph: '⇢', word: 'handoff', color: 'claude' }
    case 'file': return { glyph: '✎', word: 'edit', color: 'suggestion' }
    case 'done': return { glyph: '✓', word: 'done', color: 'success' }
    case 'failed': return { glyph: '✗', word: 'failed', color: 'error' }
    case 'error': return { glyph: '✗', word: 'error', color: 'error' }
    case 'warning': return { glyph: '△', word: 'warning', color: 'warning' }
    default: return { glyph: '▸', word: 'tool' }
  }
}

/** The next mission number: one past the highest so far, so a trimmed list never reuses one. */
export function nextN(list: readonly AntFarmAnt[]): number {
  return list.reduce((top, a) => Math.max(top, a.n ?? 0), 0) + 1
}

// ---------------------------------------------------------------- the sparkline

export const SPARK_GLYPHS = '▁▂▃▄▅▆▇█'
export const HISTORY_MAX = 24

/** Appends one request's tokens, keeping the last HISTORY_MAX. */
export function pushHistory(history: readonly number[] | undefined, tokens: number): number[] {
  const next = [...(history ?? []), tokens]
  return next.length > HISTORY_MAX ? next.slice(next.length - HISTORY_MAX) : next
}

/**
 * The last `width` values as a row of eight-level bars, scaled to their
 * largest; a value of 0 is the lowest bar. Dots where there is nothing yet.
 */
export function sparkline(values: readonly number[], width: number): string {
  const tail = values.slice(-width)
  if (tail.length === 0) return '·'.repeat(width)
  const top = Math.max(1, ...tail)
  const glyphs = tail.map(v => SPARK_GLYPHS[Math.min(7, Math.max(0, Math.round((Math.max(0, v) / top) * 7)))] ?? '▁').join('')
  return ' '.repeat(width - tail.length) + glyphs
}

// ---------------------------------------------------------------- the grid

/** Narrower than this, a card has no room for art and the pane draws compact rows. */
export const COMPACT_BELOW = 40
/** A card needs this many columns: the lane for the ant, the words beside it, a border. */
export const CARD_MIN = 38
export const GRID_MAX_COLUMNS = 3

/** How many cards fit side by side, and how wide each is, for a body width. */
export function gridOf(bodyColumns: number): { cols: number; cardWidth: number } {
  const cols = Math.max(1, Math.min(GRID_MAX_COLUMNS, Math.floor((bodyColumns + 1) / (CARD_MIN + 1))))
  const cardWidth = Math.max(CARD_MIN, Math.floor((bodyColumns - (cols - 1)) / cols))
  return { cols, cardWidth }
}

/** `items` in rows of `n`, the last row shorter. */
export function rowsOf<T>(items: readonly T[], n: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += Math.max(1, n)) rows.push(items.slice(i, i + Math.max(1, n)))
  return rows
}

// ---------------------------------------------------------------- motion

/** The spinner beside a working card, one glyph a frame. */
export const SPIN = ['◐', '◓', '◑', '◒'] as const

export function spinner(frame: number): string {
  return SPIN[((frame % SPIN.length) + SPIN.length) % SPIN.length] ?? '◐'
}

/** The heartbeat's weight this frame: bold, plain, dim, plain, so the dot breathes. */
export function pulse(frame: number): { bold?: true; dimColor?: true } {
  const beat = ((frame % 4) + 4) % 4
  return beat === 0 ? { bold: true } : beat === 2 ? { dimColor: true } : {}
}

/** A finished subagent keeps its full colour this long before it rests dim: the eye follows the change. */
export const SETTLE_MS = 2500
/** The newest timeline row is drawn bold this long. */
export const FRESH_MS = 1500

// ---------------------------------------------------------------- selection

/** The id after (`1`) or before (`-1`) the current one among `ids`, wrapping; the first with none current. */
export function moveSelection(ids: readonly string[], current: string | undefined, by: 1 | -1): string | undefined {
  if (ids.length === 0) return undefined
  const at = current === undefined ? -1 : ids.indexOf(current)
  if (at === -1) return by === 1 ? ids[0] : ids[ids.length - 1]
  return ids[(at + by + ids.length) % ids.length]
}

/** Hotkeys for the first nine cards in display order: a bare digit each. */
export function hotkeyOf(position: number): string | undefined {
  return position >= 0 && position < 9 ? String(position + 1) : undefined
}

// ---------------------------------------------------------------- order

/** Running first (oldest on top), then finished (latest on top). */
export function ordered(list: readonly AntFarmAnt[]): { running: AntFarmAnt[]; finished: AntFarmAnt[] } {
  const running = list.filter(a => a.status === 'running').sort((a, b) => a.startedAt - b.startedAt)
  const finished = list
    .filter(a => a.status !== 'running')
    .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
  return { running, finished }
}
