// The /redline detail view as plain lines, each keyed. The pane draws them as
// Text rows (colouring by `tone`); where no surface places the pane, the same
// lines print as the command's text, so the two can never disagree.

import type { RedlineGauge } from '../types'
import {
  bar,
  busiest,
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
import type { Level } from './gauge'

export type Tone = Level | 'dim' | 'title' | 'plain'

export type DetailLine = { key: string; text: string; tone: Tone }

const LABEL = 13
const row = (label: string, text: string): string => `${label.padEnd(LABEL)}${text}`
const more = (text: string): string => `${''.padEnd(LABEL)}${text}`

export function detailLines(g: RedlineGauge, now: number, barCells = 20): DetailLine[] {
  const lines: DetailLine[] = []
  const add = (key: string, text: string, tone: Tone = 'plain') => lines.push({ key, text, tone })

  add('title', 'Redline - context, cost and pace', 'title')

  // Context fill against the window Claude Code reports for the model.
  const percent = percentOf(g)
  const level = levelOf(percent)
  if (percent === undefined || g.contextTokens === null || g.window === null) {
    add('context', row('Context', 'no reading yet - it appears after the next reply'), 'dim')
  } else {
    const word = levelWord(level)
    add('context', row('Context', `${bar(percent, barCells)} ${percent}%${word ? ` ${word}` : ''}`), level)
    const model = g.model ? ` · ${g.model}` : ''
    add('context-used', more(`${fmtTokens(g.contextTokens)} of ${fmtTokens(g.window)} tokens in the window${model}`), 'dim')
  }

  const growth = contextGrowth(g.samples, now)
  const pace = fmtPace(paceEta(g.samples, g.window, now))
  add(
    'pace',
    pace && growth
      ? row('Pace', `${pace} at the last 10 minutes' rate (+${fmtTokens(growth.perMs * 60_000)} tokens/min)`)
      : row('Pace', 'no estimate - the context has not grown for a minute of the last 10'),
    pace ? 'plain' : 'dim',
  )

  const rate = tokensPerMinute(g.flow, now, g.trackingSince)
  add('rate', row('Throughput', `${fmtTokens(rate)} new tokens/min over the last ${SPAN_MS / 60_000} minutes`))
  add('rate-note', more('new = uncached input + cache writes + output; cache reads are not counted'), 'dim')

  // Token counts: every request redline has seen, main loop and subagents.
  const t = g.totals
  add(
    'tokens',
    row('Tokens', `input ${fmtTokens(t.input)} · output ${fmtTokens(t.output)} · cache read ${fmtTokens(t.cacheRead)} · cache write ${fmtTokens(t.cacheWrite)}`),
  )
  const requests = g.turns.reduce((n, turn) => n + turn.requests, 0)
  const since = g.trackingSince === null ? '' : `, since redline started counting ${fmtDuration(now - g.trackingSince)} ago`
  add('tokens-note', more(`${requests} model requests${since}`), 'dim')

  // Cost: Claude Code's ledger when it keeps one, the price table beside it.
  if (g.ledgerUsd !== null) add('cost', row('Cost', `${fmtUsd(g.ledgerUsd, false)} this session, Claude Code's own figure (as /cost shows it)`))
  if (g.unpriced.length > 0) {
    add('cost-table', row(g.ledgerUsd === null ? 'Cost' : '', `no price for ${g.unpriced.join(', ')} - tokens only`), 'dim')
  } else if (requests > 0) {
    const u = g.tableUsd
    const family = g.model ? priceRow(g.model)?.label : undefined
    const by = family ? `redline's price table (${family})` : `redline's price table`
    const what = g.ledgerUsd === null ? '' : 'for the requests counted, '
    add(
      'cost-table',
      row(g.ledgerUsd === null ? 'Cost' : '', `${fmtUsd(sumTokens(u))} ${what}by ${by}: input ${fmtUsd(u.input)} · output ${fmtUsd(u.output)} · cache read ${fmtUsd(u.cacheRead)} · cache write ${fmtUsd(u.cacheWrite)}`),
      'dim',
    )
  }

  add('session', row('Session', g.sessionStartedAt === null ? 'start time unknown' : fmtDuration(now - g.sessionStartedAt)))

  // Plan windows, as the API's last response reported them.
  add('limits-title', 'Plan limits', 'title')
  if (g.limits.length === 0) {
    add('limits-none', '  none reported for this session: Claude Code shares the 5-hour and weekly windows on a Claude plan, after the first reply', 'dim')
  }
  for (const l of g.limits) {
    const pct = Math.round(l.percentUsed)
    const reset = Date.parse(l.resetsAt ?? '')
    const resets = Number.isNaN(reset) ? '' : ` · resets in ${fmtDuration(Math.max(0, reset - now))}`
    const r = runOut(l, now)
    const out =
      r === undefined ? '' : r.kind === 'at' ? ` · ${fmtRunOut(r)} at this window's pace so far` : r.kind === 'out' ? ' · used up' : ' · on pace to reset first'
    const tone: Tone = r?.kind === 'out' || r?.kind === 'at' ? 'red' : levelOf(pct)
    add(`limit-${l.kind}`, `  ${limitLabel(l.kind).padEnd(LABEL - 2)}${bar(Math.min(100, pct), 10)} ${pct}%${resets}${out}`, tone)
  }

  add('busiest-title', 'Busiest turns', 'title')
  const top = busiest(g)
  if (top.length === 0) add('busiest-none', '  none yet', 'dim')
  top.forEach((turn, i) => {
    const usd = turn.usd === null ? 'no price' : fmtUsd(turn.usd)
    add(`busiest-${i + 1}`, `  ${i + 1}. ${fmtTokens(sumTokens(turn.tokens))} tok · ${turn.requests} req · ${usd} · ${turn.label}`)
  })
  return lines
}

/** The same view as text, for a surface that places no pane. */
export function detailText(g: RedlineGauge, now: number): string {
  return ['```text', ...detailLines(g, now, 10).map(l => l.text), '```'].join('\n')
}
