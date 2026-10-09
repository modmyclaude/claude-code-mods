// What the band and the pane say: formatting, the ETA, model colours and the
// pixel ants. Pure: no `$`, so the tests drive it directly.

import type { AntFarmAlarm, AntFarmAnt, AntFarmUsage, AntFarmView } from '../types'

// ---------------------------------------------------------------- untrusted text

// Task descriptions, agent types and model names come from the model and
// other plugins. The engine refuses a drawn tree holding a control character
// (and draws its own in its place, hiding every band beneath), so every such
// text is cleaned where it is drawn: escape sequences removed, any other C0,
// DEL or C1 character shown as U+FFFD.
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]|\x9b[0-?]*[ -/]*[@-~]/g
const CONTROLS = /[\x00-\x1f\x7f-\x9f]/g

export function clean(text: string): string {
  return text.replace(ESCAPES, '').replace(CONTROLS, '\uFFFD')
}

// ---------------------------------------------------------------- numbers

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`.replace('.0k', 'k')
  return `${(n / 1_000_000).toFixed(2)}M`
}

/** Dollars with the precision small amounts need: "$1.23", "$0.042", "$0.0021". */
export function fmtDollars(c: number): string {
  return `$${c === 0 || c >= 0.1 ? c.toFixed(2) : c >= 0.01 ? c.toFixed(3) : c.toFixed(4)}`
}

/** Every table cost is an estimate: "≈$0.042"; a model the table lacks makes it "?" or "≈$0.04+?". */
export function fmtCost(u: AntFarmUsage): string {
  if (u.costUsd === 0 && u.unpricedTokens > 0) return '?'
  return `≈${fmtDollars(u.costUsd)}${u.unpricedTokens > 0 ? '+?' : ''}`
}

/**
 * The session's spend: Claude Code's own estimate where the engine gives one
 * (its cost ledger, summed at list prices: not a bill), else the table's.
 * Either way an estimate, drawn with ≈.
 */
export type Spend = { usd: number; text: string; isEngine: boolean; isAny: boolean }

export function spendOf(engineUsd: number | null, estimate: AntFarmUsage): Spend {
  if (engineUsd !== null) {
    return { usd: engineUsd, text: `≈${fmtDollars(engineUsd)}`, isEngine: true, isAny: engineUsd > 0 || estimate.tokens > 0 }
  }
  return { usd: estimate.costUsd, text: fmtCost(estimate), isEngine: false, isAny: estimate.tokens > 0 }
}

export function fmtUsd(usd: number): string {
  return `$${usd.toFixed(2)}`
}

/** The plugin's status line: the session's spend against the budget, once anything was spent. */
export function statusText(spend: Spend, budgetUsd: number, level: 0 | 1 | 2): string | undefined {
  if (!spend.isAny) return undefined
  const source = spend.isEngine ? " (Claude Code's estimate)" : ''
  // Claude Code already labels a plugin's status line with its name.
  if (!(budgetUsd > 0)) return `${spend.text} this session${source}`
  const over = level === 2 ? ' - past 2x the budget' : level === 1 ? ' - over budget' : ''
  return `${spend.text} of ${fmtUsd(budgetUsd)} budget${source}${over}`
}

/**
 * The alarm after a new reading: a level once announced is not announced
 * again, even if a later reading comes in lower (a stale or failed read), until
 * the budget itself changes. `toast` is the level to announce now, or 0.
 */
export function nextAlarm(stored: AntFarmAlarm, level: 0 | 1 | 2, budgetUsd: number): { alarm: AntFarmAlarm; toast: 0 | 1 | 2 } {
  const before = stored.budgetUsd === budgetUsd ? stored.level : 0
  return {
    alarm: { level: Math.max(before, level), budgetUsd },
    toast: level > before ? level : 0,
  }
}

/** The session figure with its source: "Claude Code's estimate ≈$2.50" or "≈$2.50 session". */
export function spendLabel(spend: Spend): string {
  return spend.isEngine ? `Claude Code's estimate ${spend.text}` : `${spend.text} session`
}

/** The toast when the spend crosses the budget (level 1) or twice it (level 2). */
export function alarmText(spend: Spend, budgetUsd: number, level: 1 | 2): string {
  const what = `${spend.isEngine ? "Claude Code's estimate" : 'Session estimate'} ${spend.text}`
  return level === 2
    ? `${what} is past 2x your ${fmtUsd(budgetUsd)} budget.`
    : `${what} reached your ${fmtUsd(budgetUsd)} budget.`
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function fmtEta(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `~${Math.max(5, Math.round(s / 5) * 5)}s left`
  const m = Math.round(s / 60)
  if (m < 60) return `~${m}m left`
  return `~${Math.floor(m / 60)}h ${m % 60}m left`
}

/** `claude-opus-5-5` -> `opus-5-5`; regional and dated spellings kept readable. */
export function shortModel(model: string): string {
  return model.replace(/^.*?claude-/, '') || model
}

/** At most `max` ants, the oldest finished ones dropped before any running one. */
export function trimAnts(list: readonly AntFarmAnt[], max: number): AntFarmAnt[] {
  let excess = list.length - max
  if (excess <= 0) return [...list]
  const kept = list.filter(a => {
    if (excess > 0 && a.status !== 'running') {
      excess -= 1
      return false
    }
    return true
  })
  return kept.slice(-max)
}

/**
 * The view after the pane closed: the person's own close also ends the band's
 * list and keeps the pane from opening again unasked; a plugin's or the
 * engine's close changes nothing.
 */
export function viewAfterClose(v: AntFarmView, by: 'plugin' | 'person' | 'unload'): AntFarmView {
  return by === 'person' ? { ...v, isClosedByHand: true, isListInBand: false } : v
}

// ---------------------------------------------------------------- ETA

/** The minimum requests before a pace is worth extrapolating. */
export const ETA_MIN_REQUESTS = 3

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

export type Progress = {
  /** 0..1, or null while there is no basis for one yet. */
  fraction: number | null
  /** Milliseconds left, or null. */
  etaMs: number | null
}

/**
 * How far along a running subagent is, from its own pace (time per request so
 * far) and how many requests finished subagents needed: the median of those of
 * its type this session, else of all of them. With no finished subagent yet it
 * assumes it is halfway (as many requests to go as made). Nothing before
 * ETA_MIN_REQUESTS requests.
 */
export function progressOf(ant: AntFarmAnt, all: readonly AntFarmAnt[], now: number): Progress {
  if (ant.status === 'done') return { fraction: 1, etaMs: null }
  const steps = ant.usage.requests
  if (ant.status !== 'running' || steps < ETA_MIN_REQUESTS) return { fraction: null, etaMs: null }

  const done = all.filter(a => a.status === 'done' && a.id !== ant.id && a.usage.requests > 0)
  const sameType = done.filter(a => a.type === ant.type)
  const expected = median((sameType.length > 0 ? sameType : done).map(a => a.usage.requests))
  const remaining = expected === undefined ? steps : Math.max(1, Math.round(expected - steps))
  const pace = Math.max(0, now - ant.startedAt) / steps
  return { fraction: steps / (steps + remaining), etaMs: remaining * pace }
}

export function bar(fraction: number | null, width: number): string {
  if (fraction === null) return '·'.repeat(width)
  const full = Math.round(Math.min(1, Math.max(0, fraction)) * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

// ---------------------------------------------------------------- colours

// Theme keys, so the ants follow the person's light or dark theme. The status
// colours (success, warning, error) are kept for status and the budget.
const PALETTE = ['claude', 'autoAccept', 'suggestion', 'planMode', 'permission', 'ide', 'merged', 'remember'] as const
const FAMILY: readonly [RegExp, (typeof PALETTE)[number]][] = [
  [/fable|mythos/, 'claude'],
  [/opus/, 'autoAccept'],
  [/sonnet/, 'suggestion'],
  [/haiku/, 'planMode'],
]

/** One colour per model, in order of first appearance; a family keeps its colour while it is free. */
export function modelColors(ants: readonly AntFarmAnt[]): Map<string, string> {
  const colors = new Map<string, string>()
  const taken = new Set<string>()
  for (const { model } of [...ants].sort((a, b) => a.startedAt - b.startedAt)) {
    if (colors.has(model)) continue
    const preferred = FAMILY.find(([re]) => re.test(model.toLowerCase()))?.[1]
    const free = PALETTE.find(c => !taken.has(c))
    const color = preferred !== undefined && !taken.has(preferred) ? preferred : free ?? PALETTE[colors.size % PALETTE.length]!
    colors.set(model, color)
    taken.add(color)
  }
  return colors
}

// ---------------------------------------------------------------- pixel ants

// Each ant is drawn from pixel rows ('#' on, '.' off), two pixel rows to a
// text row with half blocks, so it is plain text on every surface. Facing
// right: abdomen, waist, thorax, head and an antenna; the legs alternate.
const WALK: readonly (readonly string[])[] = [
  ['........#.', '.##...##..', '####.####.', '..#.#.#...'],
  ['........#.', '.##...##..', '####.####.', '.#..#..#..'],
]
const REST = WALK[0]!
// A failed ant lies on its back, legs up.
const FLIPPED = [...REST].reverse()

const MINI_WALK: readonly (readonly string[])[] = [
  ['###.#.##', '.#.#.#..'],
  ['###.#.##', '#.#.#.#.'],
]

export const ANT_WIDTH = 10
export const MINI_WIDTH = 8

function halfBlocks(pixels: readonly string[]): string[] {
  const rows: string[] = []
  for (let y = 0; y < pixels.length; y += 2) {
    const top = pixels[y] ?? ''
    const bottom = pixels[y + 1] ?? ''
    rows.push(
      [...top]
        .map((t, x) => {
          const a = t === '#'
          const b = bottom[x] === '#'
          return a && b ? '█' : a ? '▀' : b ? '▄' : ' '
        })
        .join(''),
    )
  }
  return rows
}

/** A per-ant offset so a colony does not march in step. */
export function phaseOf(id: string): number {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 997
}

/**
 * The two text rows of a full-size ant in a lane `lane` cells wide: a running
 * ant walks right across it (one cell and one leg swap a frame), a finished
 * one stands at the far end, a failed one lies on its back.
 */
export function antRows(status: AntFarmAnt['status'], frame: number, lane: number): string[] {
  const room = Math.max(0, lane - ANT_WIDTH)
  if (status !== 'running') {
    return halfBlocks(status === 'failed' ? FLIPPED : REST).map(r => ' '.repeat(room) + r)
  }
  const x = frame % (room + 1)
  return halfBlocks(WALK[frame % 2]!).map(r => ' '.repeat(x) + r + ' '.repeat(room - x))
}

/** One text row: the small ant the band's list draws. */
export function miniAnt(status: AntFarmAnt['status'], frame: number): string {
  const pixels = status === 'running' ? MINI_WALK[frame % 2]! : MINI_WALK[0]!
  const row = halfBlocks(status === 'failed' ? [...pixels].reverse() : pixels)[0] ?? ''
  return row
}
