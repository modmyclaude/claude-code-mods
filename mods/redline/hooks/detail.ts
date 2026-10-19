// The /redline pane as structured lines, each keyed, after brand/UI-STANDARD.md.
// Two views: the overview (a hero naming the limit closest to its wall, the
// context and each plan window as aligned bars with one readout each, when the
// session started and its cost, one footnote) and where the money went (what
// redline counted, by kind of work, by model, the costliest turns). The pane
// draws the lines by kind; where no surface places the pane, each line's plain
// `text` prints as transcript rows, so the two can never disagree.

import type { RedlineGauge, RedlineLimit, RedlineSpend, RedlineTokens, RedlineView } from '../types'
import { bar, BAR_CELLS, clean, contextReadout, costliest, costText, EMPTY_GAUGE, fmtSince, fmtTokens, fmtUsd, limitReadout, limitRowLabel, percentOf, runOut, verdict } from './gauge'
import type { Level, Readout } from './gauge'
import { sumTokens } from './prices'
import { modelLabel, spendLabel } from './spend'

export type Tone = Level | 'dim' | 'title' | 'plain'

/** How the pane draws a line: a section title, the hero, a standalone dim line, a labelled bar with figures, a label and value row, the footnote. */
export type Kind = 'title' | 'hero' | 'line' | 'bar' | 'row' | 'note'

export type DetailLine = {
  key: string
  /** The line as plain text, for a surface that places no pane. */
  text: string
  tone: Tone
  kind: Kind
  /** Drawn in the head, beside Bolt. */
  head?: true
  /** Starts a block: a blank row before it. */
  gap?: true
  /** The text form only; the pane skips it (the title bar names the mod, the links are buttons there). */
  textOnly?: true
  /** Bars and rows: the label on the left. */
  label?: string
  /** A row's value (drawn right-aligned); the words of a hero, a line, a title, the note. */
  value?: string
  /** A bar's ten glyphs, drawn apart from the words on the desktop. */
  bar?: string
  /** A bar's right-aligned number columns after it. */
  figures?: string[]
  /** A bar's words after the numbers, each wrapping as a whole, joined with a comma. */
  clauses?: string[]
}

/** The bar rows' label column: the view's longest bar label, within these bounds. */
export const LABEL_MIN_CELLS = 7
export const LABEL_MAX_CELLS = 12
/** The width of each figure column after a bar, per view: the percent; the dollars and the share. */
export const FIGURE_CELLS: Record<RedlineView, readonly number[]> = { overview: [4], spend: [7, 4] }
/** The text form pushes a row's value to this column when the row fits in it. */
const TEXT_COLUMNS = 40
/** Rows the standard allows a pane: the spend view's kinds, models and turns share them. */
const ROW_CAP = 7

type Draft = Omit<DetailLine, 'text'>

/** The bar rows' label column for a view: its longest bar label, at least 7 cells, at most 12. */
export function labelCells(lines: readonly Pick<DetailLine, 'kind' | 'label'>[]): number {
  const longest = Math.max(0, ...lines.filter(l => l.kind === 'bar').map(l => l.label?.length ?? 0))
  return Math.max(LABEL_MIN_CELLS, Math.min(LABEL_MAX_CELLS, longest))
}

// Model ids, plan window kinds and prompts are outside text: cleaned here, at the one
// place every line passes, before the pane or the command draws it.
const cleaned = (d: Draft): Draft => ({
  ...d,
  ...(d.label === undefined ? {} : { label: clean(d.label) }),
  ...(d.value === undefined ? {} : { value: clean(d.value) }),
  ...(d.figures === undefined ? {} : { figures: d.figures.map(clean) }),
  ...(d.clauses === undefined ? {} : { clauses: d.clauses.map(clean) }),
})

const toneOf = (level: Level): Tone => (level === 'unknown' ? 'dim' : level)

/** Every request redline counted, main loop and subagents: the models' counts, which the 100-turn cap never loses. */
const requestsOf = (g: RedlineGauge): number => Object.values(g.byModel).reduce((n, e) => n + e.requests, 0)

/** Plan windows in a fixed order: the 5-hour, the week, then any other kind by name. */
function windowsOf(limits: readonly RedlineLimit[]): RedlineLimit[] {
  const rank = (kind: string): number => (kind === 'five_hour' ? 0 : kind === 'seven_day' ? 1 : 2)
  return [...limits].sort((a, b) => rank(a.kind) - rank(b.kind) || a.kind.localeCompare(b.kind))
}

const barLine = (key: string, label: string, r: Readout): Draft => ({ key, kind: 'bar', tone: toneOf(r.level), head: true, label, bar: r.bar, figures: [r.figure], clauses: r.clauses })

// ---------------------------------------------------------------- overview

function overview(g: RedlineGauge, now: number): Draft[] {
  const lines: Draft[] = []
  const add = (d: Draft): void => {
    lines.push(cleaned(d))
  }
  const requests = requestsOf(g)
  const spent = (g.ledgerUsd ?? 0) > 0 || requests > 0
  const isEmpty = percentOf(g) === undefined && g.limits.length === 0
  const state = verdict(g, now)

  // For the text view only: the pane's title bar already names the mod.
  add({ key: 'title', kind: 'title', tone: 'title', textOnly: true, value: 'Redline - context, plan limits and cost' })
  add({ key: 'state', kind: 'hero', tone: toneOf(state.level), head: true, value: state.text })
  if (isEmpty) add({ key: 'empty', kind: 'line', tone: 'dim', head: true, value: "Context and limits show up after Claude's next reply." })
  else {
    add(barLine('context', 'Context', contextReadout(g, now)))
    const windows = windowsOf(g.limits)
    for (const l of windows) add(barLine(`limit-${l.kind}`, limitRowLabel(l.kind), limitReadout(l, now, g.limitHistory[l.kind])))
    if (windows.length === 0) add({ key: 'limits-none', kind: 'line', tone: 'dim', head: true, value: 'On a Claude plan, 5-hour and week limits appear after a reply.' })
  }

  // This session, whole: when it started and what it cost (Claude Code's own figures), once anything is spent.
  let dollars = false
  if (spent) {
    if (g.sessionStartedAt !== null) add({ key: 'session', kind: 'row', tone: 'plain', gap: true, label: 'Started', value: fmtSince(g.sessionStartedAt, now) })
    const isTokens = g.ledgerUsd === null && g.unpriced.length > 0
    dollars = !isTokens
    add({ key: 'cost', kind: 'row', tone: isTokens ? 'dim' : 'plain', ...(g.sessionStartedAt === null ? { gap: true } : {}), label: 'Cost', value: costText(g) })
  }

  // The footnote: a sentence for each figure on screen that needs one.
  const estimates = lines.some(l => (l.kind === 'hero' && (l.value ?? '').includes('≈')) || (l.clauses ?? []).some(c => c.includes('≈')))
  const sentences = [...(dollars ? ['Dollars are API list prices, not a bill.'] : []), ...(estimates ? ['Times with ≈ assume your pace holds.'] : [])]
  if (sentences.length > 0) add({ key: 'note', kind: 'note', tone: 'dim', gap: true, value: sentences.join(' ') })
  add({ key: 'spend-link', kind: 'line', tone: 'dim', textOnly: true, value: 'Where the money went: /redline spend' })
  return lines
}

// ------------------------------------------------------------- spend view

type Share = { key: string; label: string; entry: RedlineSpend; share: number }

const addTokens = (a: RedlineTokens, b: RedlineTokens): RedlineTokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

/** Several entries as one: their requests and tokens summed, their dollars summed unless one has no price. */
function folded(entries: readonly RedlineSpend[]): RedlineSpend {
  return entries.reduce<RedlineSpend>(
    (sum, e) => ({ requests: sum.requests + e.requests, tokens: addTokens(sum.tokens, e.tokens), usd: sum.usd === null || e.usd === null ? null : sum.usd + e.usd }),
    { requests: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, usd: 0 },
  )
}

/** By cost; entries with no price last, then by tokens. */
const byCost = (a: RedlineSpend, b: RedlineSpend): number => (b.usd ?? -1) - (a.usd ?? -1) || sumTokens(b.tokens) - sumTokens(a.tokens)

/**
 * The rows of a share table: every entry when `max` or fewer, else the `max - 1`
 * costliest and the rest folded into one; each with its share of the group's dollars.
 */
function shareRows(entries: readonly [string, string, RedlineSpend][], max: number, restKey: string): Share[] {
  const sorted = [...entries].sort(([, , a], [, , b]) => byCost(a, b))
  const priced = sorted.reduce((sum, [, , e]) => sum + (e.usd ?? 0), 0)
  const shown: [string, string, RedlineSpend][] = sorted.length > max ? [...sorted.slice(0, max - 1), [restKey, 'The rest', folded(sorted.slice(max - 1).map(([, , e]) => e))]] : sorted
  return shown.map(([key, label, entry]) => ({ key, label, entry, share: entry.usd !== null && priced > 0 ? Math.round((100 * entry.usd) / priced) : 0 }))
}

const shareLine = (s: Share, gap?: true): Draft => ({
  key: s.key,
  kind: 'bar',
  tone: 'plain',
  head: true,
  ...(gap ? { gap } : {}),
  label: s.label,
  bar: bar(s.entry.usd === null ? undefined : s.share, BAR_CELLS),
  figures: s.entry.usd === null ? ['--', '--'] : [fmtUsd(s.entry.usd), `${s.share}%`],
  clauses: [],
})

function spendView(g: RedlineGauge, now: number): Draft[] {
  const lines: Draft[] = []
  const add = (d: Draft): void => {
    lines.push(cleaned(d))
  }
  const requests = requestsOf(g)

  add({ key: 'title', kind: 'title', tone: 'title', textOnly: true, value: 'Redline - where the money went' })
  if (requests === 0) {
    add({ key: 'spend-total', kind: 'hero', tone: 'dim', head: true, value: 'Nothing spent yet' })
    add({ key: 'spend-none', kind: 'line', tone: 'dim', head: true, value: "Each kind of work shows up here after Claude's next reply." })
  } else {
    // Redline's own count, as the table prices it (tokens once a model had no price), and since when it counts.
    const total = g.unpriced.length === 0 ? fmtUsd(sumTokens(g.tableUsd)) : `${fmtTokens(sumTokens(g.totals))} tokens`
    const isLate = g.trackingSince !== null && (g.sessionStartedAt === null || g.trackingSince - g.sessionStartedAt > 60_000)
    const since = isLate && g.trackingSince !== null ? ` · since ${fmtSince(g.trackingSince, now)}` : ''
    add({ key: 'spend-total', kind: 'hero', tone: 'plain', head: true, value: `${total} in ${requests} ${requests === 1 ? 'request' : 'requests'}${since}` })
  }

  // By kind of work: up to four rows, the three costliest and the rest when there are five or more.
  const kinds = shareRows(Object.entries(g.spend).map(([kind, e]) => [`spend-${kind}`, spendLabel(kind), e]), 4, 'spend-rest')
  for (const s of kinds) add(shareLine(s))
  // By model, only when more than one answered: the costliest and the rest.
  const models = Object.entries(g.byModel)
  const modelRows = models.length >= 2 ? shareRows(models.map(([model, e]) => [`model-${model}`, modelLabel(model), e]), 2, 'model-rest') : []
  modelRows.forEach((s, i) => add(shareLine(s, i === 0 ? true : undefined)))

  // The costliest turns take the rows left under the cap.
  const slots = Math.max(1, Math.min(3, ROW_CAP - kinds.length - modelRows.length))
  const turns = costliest(g, slots)
  if (turns.length > 0) {
    add({ key: 'busiest-title', kind: 'title', tone: 'title', gap: true, value: 'Costliest turns' })
    turns.forEach((turn, i) => {
      const value = turn.usd === null ? `${fmtTokens(sumTokens(turn.tokens))} tokens` : fmtUsd(turn.usd)
      add({ key: `busiest-${i + 1}`, kind: 'row', tone: 'plain', label: `${i + 1}. ${turn.label}`, value })
    })
  }
  if (requests > 0) add({ key: 'spend-rule', kind: 'note', tone: 'dim', gap: true, value: 'Each request counts toward what it sent Claude. Dollars are API list prices.' })
  add({ key: 'limits-link', kind: 'line', tone: 'dim', textOnly: true, value: 'Context and plan limits: /redline' })
  return lines
}

// ------------------------------------------------------------ the lines

/** A line as plain text: a bar with its label padded to the column, its figures right-aligned, its clauses; a row with its value pushed to the right edge. */
function textOf(l: Draft, labelWidth: number, view: RedlineView): string {
  if (l.kind === 'bar') {
    const figures = (l.figures ?? []).map((f, i) => `  ${f.padStart(FIGURE_CELLS[view][i] ?? 0)}`).join('')
    const clauses = (l.clauses ?? []).length > 0 ? `  ${(l.clauses ?? []).join(', ')}` : ''
    return `${(l.label ?? '').padEnd(labelWidth)}  ${l.bar ?? ''}${figures}${clauses}`
  }
  if (l.kind === 'row') {
    const label = l.label ?? ''
    const value = l.value ?? ''
    return label.length + 2 + value.length <= TEXT_COLUMNS ? `${label}${value.padStart(TEXT_COLUMNS - label.length)}` : `${label}  ${value}`
  }
  return l.value ?? ''
}

export function detailLines(kept: RedlineGauge, now: number, view: RedlineView = 'overview'): DetailLine[] {
  // A gauge kept in session state by an earlier version lacks the newer fields: they read as empty.
  const g: RedlineGauge = { ...EMPTY_GAUGE, ...kept }
  const drafts = view === 'spend' ? spendView(g, now) : overview(g, now)
  const labelWidth = labelCells(drafts)
  return drafts.map(l => ({ ...l, text: textOf(l, labelWidth, view) }))
}

/**
 * Bolt's pose beside the head: asleep while nothing is measured (on the spend
 * view, while nothing is counted) and while a 5-hour or weekly plan window is
 * used up with its reset still to come; idle otherwise, a full context
 * included, since the hero says that.
 */
export function boltPose(kept: RedlineGauge, now: number, view: RedlineView = 'overview'): 'idle' | 'sleep' {
  const g: RedlineGauge = { ...EMPTY_GAUGE, ...kept }
  if (view === 'spend' ? requestsOf(g) === 0 : verdict(g, now).level === 'unknown') return 'sleep'
  const isOut = (l: RedlineLimit): boolean => {
    const reset = Date.parse(l.resetsAt ?? '')
    return (Number.isNaN(reset) || reset > now) && runOut(l, now)?.kind === 'out'
  }
  return g.limits.some(l => (l.kind === 'five_hour' || l.kind === 'seven_day') && isOut(l)) ? 'sleep' : 'idle'
}

/** The view's lines as text, one per line, each block parted by a blank one. */
function textLines(g: RedlineGauge, now: number, view: RedlineView): { text: string; gap: boolean }[] {
  return detailLines(g, now, view).map(l => ({ text: l.text, gap: l.gap === true }))
}

/** The same view as text, for a surface that places no pane. */
export function detailText(g: RedlineGauge, now: number, view: RedlineView = 'overview'): string {
  return textLines(g, now, view)
    .map(l => (l.gap ? `\n${l.text}` : l.text))
    .join('\n')
}

/**
 * The same view for a surface that places no pane, as transcript log rows:
 * the terminal draws a row's first 2000 characters, so the lines are grouped
 * under that, whole lines only; a block's blank line stays with the line it
 * parts, and a row never opens with one. None of it is command text, so the
 * model reads none of it.
 */
export function detailChunks(g: RedlineGauge, now: number, view: RedlineView = 'overview', max = 1900): string[] {
  const chunks: string[] = []
  let chunk = ''
  for (const { text, gap } of textLines(g, now, view)) {
    const piece = gap ? `\n${text}` : text
    if (chunk !== '' && chunk.length + 1 + piece.length > max) {
      chunks.push(chunk)
      chunk = text
    } else chunk = chunk === '' ? text : `${chunk}\n${piece}`
  }
  if (chunk !== '') chunks.push(chunk)
  return chunks
}
