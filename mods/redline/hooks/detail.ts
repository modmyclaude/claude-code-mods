// The /redline detail view as structured lines, each keyed: a hero line, label
// and value rows, bars, items and one footnote, after brand/UI-STANDARD.md.
// The pane draws them by kind; where no surface places the pane, each line's
// plain `text` prints as the command's answer, so the two can never disagree.

import type { RedlineGauge, RedlineLimit, RedlineSpend } from '../types'
import {
  bar,
  busiest,
  clean,
  contextGrowth,
  fmtDuration,
  fmtPace,
  fmtRunOut,
  fmtTokens,
  fmtUsd,
  levelOf,
  levelWord,
  limitLabel,
  paceEta,
  percentOf,
  runOut,
  SPAN_MS,
  tokensPerMinute,
} from './gauge'
import { priceRow, sumTokens } from './prices'
import { modelLabel, spendLabel } from './spend'
import type { Level } from './gauge'

export type Tone = Level | 'dim' | 'title' | 'plain'

/** How the pane draws a line: a section title, the hero, a label and value row, a dim line under a row, a labelled bar, a list item, the footnote. */
export type Kind = 'title' | 'hero' | 'row' | 'sub' | 'bar' | 'item' | 'note'

export type DetailLine = {
  key: string
  /** The line as plain text, for a surface that places no pane. */
  text: string
  tone: Tone
  kind: Kind
  /** Rows and bars: the label on the left. */
  label?: string
  /** The words: a row's value (drawn right-aligned), the text beside a bar, a title, an item, the note. */
  value?: string
  /** The hero's and a plan window's bar: glyphs, drawn apart from the words on the desktop. */
  bar?: string
}

/** The label column of the plain-text view. */
const LABEL = 13
const padded = (label: string, text: string): string => `${label.padEnd(LABEL)}${text}`

export function detailLines(g: RedlineGauge, now: number, barCells = 10): DetailLine[] {
  const lines: DetailLine[] = []
  // Model ids, plan window kinds and prompts are outside text: cleaned here, at the one
  // place every line passes, before the pane or the command draws it.
  const add = (key: string, kind: Kind, tone: Tone, words: { label?: string; value?: string; bar?: string; text?: string }): void => {
    const label = words.label === undefined ? undefined : clean(words.label)
    const value = words.value === undefined ? undefined : clean(words.value)
    const text =
      words.text !== undefined
        ? clean(words.text)
        : kind === 'row' || kind === 'bar'
          ? padded(label ?? '', `${words.bar ? `${words.bar} ` : ''}${value ?? ''}`)
          : kind === 'sub' || kind === 'item'
            ? padded('', value ?? '')
            : (value ?? '')
    lines.push({ key, text, tone, kind, ...(label === undefined ? {} : { label }), ...(value === undefined ? {} : { value }), ...(words.bar === undefined ? {} : { bar: words.bar }) })
  }

  // For the text view only: the pane's title bar already names the mod.
  add('title', 'title', 'title', { value: 'Redline - context, cost and pace' })

  // The hero: context fill against the window Claude Code reports for the model, its bar beneath.
  const percent = percentOf(g)
  const level = levelOf(percent)
  if (percent === undefined || g.contextTokens === null || g.window === null) {
    add('context', 'hero', 'dim', { value: 'No context reading yet', text: padded('Context', 'no reading yet') })
    add('context-used', 'sub', 'dim', { value: 'it appears after the next reply' })
  } else {
    const word = levelWord(level)
    const state = `${percent}%${word ? ` ${word}` : ''}`
    add('context', 'hero', level, { value: `Context ${state}`, text: padded('Context', state) })
    add('context-used', 'bar', level, { label: '', bar: bar(percent, barCells), value: `${fmtTokens(g.contextTokens)} of ${fmtTokens(g.window)} tokens${g.model ? ` · ${g.model}` : ''}` })
  }

  const growth = contextGrowth(g.samples, now)
  const pace = fmtPace(paceEta(g.samples, g.window, now))
  add('pace', 'row', pace && growth ? 'plain' : 'dim', { label: 'Pace', value: pace && growth ? pace : 'not enough data yet' })
  if (pace && growth) add('pace-rate', 'sub', 'dim', { value: `the context grows +${fmtTokens(growth.perMs * 60_000)} tokens/min` })

  const rate = tokensPerMinute(g.flow, now, g.trackingSince)
  add('rate', 'row', 'plain', { label: 'Throughput', value: `${fmtTokens(rate)} new tokens/min` })

  // Token counts and cost: every request redline has seen, main loop and subagents. Nothing is
  // drawn for figures that are zero before the first request.
  const t = g.totals
  const requests = g.turns.reduce((n, turn) => n + turn.requests, 0)
  if (requests > 0) {
    add('tokens', 'row', 'plain', { label: 'Tokens', value: fmtTokens(sumTokens(t)) })
    add('tokens-detail', 'sub', 'dim', { value: `input ${fmtTokens(t.input)} · output ${fmtTokens(t.output)} · cache read ${fmtTokens(t.cacheRead)} · cache write ${fmtTokens(t.cacheWrite)}` })
  }
  // One headline: Claude Code's own estimate when it keeps one, else the price table's; the rest beneath.
  const family = g.model ? priceRow(g.model)?.label : undefined
  const table = g.unpriced.length === 0 && requests > 0 ? fmtUsd(sumTokens(g.tableUsd)) : undefined
  if (g.ledgerUsd !== null || requests > 0) {
    const headline = g.ledgerUsd !== null ? fmtUsd(g.ledgerUsd) : (table ?? 'no price')
    add('cost', 'row', headline === 'no price' ? 'dim' : 'plain', { label: 'Cost', value: headline })
    const u = g.tableUsd
    const parts = `input ${fmtUsd(u.input)} · output ${fmtUsd(u.output)} · cache read ${fmtUsd(u.cacheRead)} · cache write ${fmtUsd(u.cacheWrite)}`
    const by = `redline's price table${family ? ` (${family})` : ''}`
    if (g.unpriced.length > 0) add('cost-table', 'sub', 'dim', { value: `no price for ${g.unpriced.join(', ')} - tokens only` })
    else if (table !== undefined && g.ledgerUsd !== null) {
      add('cost-table', 'sub', 'dim', { value: `Claude Code's estimate for the whole session (as /cost shows it); ${table} for the requests redline counted, by ${by}: ${parts}` })
    } else if (table !== undefined) add('cost-table', 'sub', 'dim', { value: `by ${by}: ${parts}` })
    else add('cost-table', 'sub', 'dim', { value: "Claude Code's estimate for the whole session (as /cost shows it)" })
  }

  add('session', 'row', g.sessionStartedAt === null ? 'dim' : 'plain', { label: 'Session', value: g.sessionStartedAt === null ? 'start time unknown' : fmtDuration(now - g.sessionStartedAt) })
  if (requests > 0) add('requests', 'row', 'plain', { label: 'Requests', value: `${requests}` })
  else add('requests-none', 'sub', 'dim', { value: 'no model requests counted yet' })

  // Plan windows, as the API's last response reported them: a bar each, its words beside it.
  add('limits-title', 'title', 'title', { value: 'Plan limits' })
  if (g.limits.length === 0) {
    add('limits-none', 'sub', 'dim', { value: 'none reported for this session: Claude Code shares the 5-hour and weekly windows on a Claude plan, after the first reply' })
  }
  for (const l of g.limits) {
    const pct = Math.round(l.percentUsed)
    const reset = Date.parse(l.resetsAt ?? '')
    // Past its reset the figure is stale: say so, and judge no run-out on it.
    const isPast = !Number.isNaN(reset) && reset <= now
    const resets = Number.isNaN(reset) ? '' : isPast ? ` · reset ${fmtDuration(now - reset)} ago, a new figure after the next reply` : ` · resets in ${fmtDuration(reset - now)}`
    const r = isPast ? undefined : runOut(l, now, g.limitHistory[l.kind])
    const basis = r !== undefined && r.kind !== 'out' ? (r.basis === 'recent' ? ' (recent rate)' : ' (average)') : ''
    const out = r === undefined ? '' : r.kind === 'at' ? ` · ${fmtRunOut(r)}${basis}` : r.kind === 'out' ? ' · used up' : ` · resets first${basis}`
    const tone: Tone = r?.kind === 'out' || r?.kind === 'at' ? 'red' : isPast ? 'dim' : levelOf(pct)
    add(`limit-${l.kind}`, 'bar', tone, { label: limitLabel(l.kind), bar: bar(Math.min(100, pct), 10), value: `${pct}%${resets}${out}` })
  }

  add('busiest-title', 'title', 'title', { value: 'Busiest turns' })
  const top = busiest(g)
  if (top.length === 0) add('busiest-none', 'sub', 'dim', { value: 'none yet' })
  top.forEach((turn, i) => {
    const usd = turn.usd === null ? 'no price' : fmtUsd(turn.usd)
    add(`busiest-${i + 1}`, 'item', 'plain', { value: `${i + 1}. ${fmtTokens(sumTokens(turn.tokens))} tok · ${turn.requests} req · ${usd} · ${turn.label}` })
  })

  // Where the money went: each kind of work the requests carried, by cost; then by model.
  add('spend-title', 'title', 'title', { value: 'Where the money went' })
  const kinds = Object.entries(g.spend)
  if (kinds.length === 0) add('spend-none', 'sub', 'dim', { value: 'nothing yet' })
  else {
    const byCost = (a: RedlineSpend, b: RedlineSpend) => (b.usd ?? -1) - (a.usd ?? -1) || sumTokens(b.tokens) - sumTokens(a.tokens)
    const priced = kinds.reduce((sum, [, e]) => sum + (e.usd ?? 0), 0)
    const row = (e: RedlineSpend) => {
      const share = e.usd !== null && priced > 0 ? Math.round((100 * e.usd) / priced) : 0
      const inputSide = e.tokens.input + e.tokens.cacheRead + e.tokens.cacheWrite
      const cache = inputSide > 0 ? `cache ${Math.round((100 * e.tokens.cacheRead) / inputSide)}%` : 'no input'
      return { share, words: `${e.usd === null ? 'no price' : `${fmtUsd(e.usd)} · ${share}%`} · ${e.requests} req · ${cache}` }
    }
    for (const [kind, e] of kinds.sort(([, a], [, b]) => byCost(a, b))) {
      const { label, prefix } = spendLabel(kind)
      const { share, words } = row(e)
      add(`spend-${kind}`, 'bar', 'plain', { label, bar: bar(e.usd === null ? 0 : share, 10), value: `${prefix}${words}` })
    }
    add('spend-rule', 'sub', 'dim', {
      value: "each request is charged to the kinds of tool results it carried, split evenly when it carried several; a turn's first request is the prompt, a subagent's requests are subagents; list-price estimates",
    })
    add('models-title', 'title', 'title', { value: 'By model' })
    for (const [model, e] of Object.entries(g.byModel).sort(([, a], [, b]) => byCost(a, b))) {
      const { share, words } = row(e)
      add(`model-${model}`, 'bar', 'plain', { label: modelLabel(model), bar: bar(e.usd === null ? 0 : share, 10), value: words })
    }
  }

  // The one footnote: what the figures count, and over what span.
  const since = g.trackingSince === null ? '' : ` Counting since redline started, ${fmtDuration(now - g.trackingSince)} ago.`
  add('note', 'note', 'dim', {
    value: `New tokens are uncached input, cache writes and output; cache reads are not counted. Throughput is over the last ${SPAN_MS / 60_000} minutes, pace over the last 10, and run-out from the window's average or the last 15 minutes when that is faster.${since}`,
  })
  return lines
}

/**
 * Bolt's pose beside the context row: crashed once the context is
 * full or a 5-hour or weekly plan window is spent (OUT, its reset still to
 * come), idle otherwise.
 */
export function boltPose(g: RedlineGauge, now: number): 'idle' | 'crash' {
  const percent = percentOf(g)
  if (percent !== undefined && percent >= 100) return 'crash'
  const isOut = (l: RedlineLimit) => {
    const reset = Date.parse(l.resetsAt ?? '')
    return (Number.isNaN(reset) || reset > now) && runOut(l, now)?.kind === 'out'
  }
  return g.limits.some(l => (l.kind === 'five_hour' || l.kind === 'seven_day') && isOut(l)) ? 'crash' : 'idle'
}

/** The same view as text, for a surface that places no pane. */
export function detailText(g: RedlineGauge, now: number): string {
  return ['```text', ...detailLines(g, now, 10).map(l => l.text), '```'].join('\n')
}

/**
 * The same view for a surface that places no pane, as transcript log rows:
 * the terminal draws a row's first 2000 characters, so the lines are grouped
 * under that, whole lines only. None of it is command text, so the model
 * reads none of it.
 */
export function detailChunks(g: RedlineGauge, now: number, max = 1900): string[] {
  const chunks: string[] = []
  let chunk = ''
  for (const line of detailLines(g, now, 10).map(l => l.text)) {
    if (chunk !== '' && chunk.length + 1 + line.length > max) {
      chunks.push(chunk)
      chunk = ''
    }
    chunk = chunk === '' ? line : `${chunk}\n${line}`
  }
  if (chunk !== '') chunks.push(chunk)
  return chunks
}
