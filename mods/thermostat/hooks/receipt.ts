// The /thermostat receipt as structured lines, after brand/UI-STANDARD.md: a
// hero with the cache's state, the window's bar and the next send's price
// beneath; label and value rows for what was paid, held, pinged and saved,
// each detail dim beneath its row, nothing for a figure still at zero; one
// footnote. The pane draws them by kind; where no pane can be placed, each
// line's plain `text` goes to the transcript, so the two can never disagree.

import type { ThermostatAuth, ThermostatReceipt, ThermostatWarm } from '../types'
import { describeTtlSource, formatDuration, formatTokens, formatUsd } from './thermo'
import type { Guard, Temperature, Ttl } from './thermo'

/** How the pane draws a line: the title (text view only), the hero, the window's bar, a dim line under a row, a label and value row, the footnote. */
export type ReceiptKind = 'title' | 'hero' | 'bar' | 'sub' | 'row' | 'note'
export type ReceiptTone = 'success' | 'warning' | 'subtle' | 'plain'

export type ReceiptLine = {
  key: string
  kind: ReceiptKind
  tone: ReceiptTone
  /** The line as plain text, for the transcript note. */
  text: string
  /** A row's label. */
  label?: string
  /** The words: a row's value (drawn at the right edge), the hero, a sub-line, the words beside the bar, the note. */
  value?: string
  /** The window's bar: glyphs, drawn apart from the words on the desktop. */
  bar?: string
}

/** What the receipt reads off the moment's snapshot. */
export type ReceiptInput = {
  now: number
  tokens: number
  warm: Pick<ThermostatWarm, 'until'> | null
  auth: ThermostatAuth | null
  ttl: Pick<Ttl, 'source'>
  ttlMs: number
  temp: Temperature
  family: string
  warmUsd: number
  coldUsd: number
}

const CELLS = 10

/** How much of the window is left, as a bar of `cells`: full at the start, empty at the end. */
export function warmBar(msLeft: number, ttlMs: number, cells = CELLS): string {
  const filled = ttlMs <= 0 ? 0 : Math.max(0, Math.min(cells, Math.round((msLeft / ttlMs) * cells)))
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

export function receiptLines(s: ReceiptInput, r: ThermostatReceipt, total: number | undefined, guard: Guard): ReceiptLine[] {
  const lines: ReceiptLine[] = []
  const add = (key: string, kind: ReceiptKind, tone: ReceiptTone, words: { label?: string; value?: string; bar?: string }): void => {
    const text =
      kind === 'row' ? `${words.label ?? ''}: ${words.value ?? ''}` : kind === 'sub' ? `  ${words.value ?? ''}` : kind === 'bar' ? `${words.bar ?? ''} ${words.value ?? ''}` : (words.value ?? '')
    lines.push({ key, kind, tone, text, ...(words.label === undefined ? {} : { label: words.label }), ...(words.value === undefined ? {} : { value: words.value }), ...(words.bar === undefined ? {} : { bar: words.bar }) })
  }

  // For the transcript note only: the pane's title bar already names the mod.
  add('title', 'title', 'plain', { value: 'Thermostat receipt for this session' })

  // The hero: the cache right now, the window it has, and what the next send costs.
  const window = `${formatDuration(s.ttlMs)} window, ${describeTtlSource(s.ttl.source)}`
  const tokens = `${formatTokens(s.tokens)} tokens, ${s.family} prices`
  switch (s.temp.kind) {
    case 'empty':
      add('state', 'hero', 'subtle', { value: 'Nothing cached yet' })
      add('window', 'sub', 'subtle', { value: window })
      break
    case 'off':
      add('state', 'hero', 'subtle', { value: 'Caching looks off' })
      add('window', 'sub', 'subtle', { value: 'the last large request neither read nor wrote the cache' })
      break
    case 'warm':
      add('state', 'hero', s.temp.isAmber ? 'warning' : 'success', { value: `Warm · ${formatDuration(s.temp.msLeft)} left` })
      add('window', 'bar', 'subtle', { bar: warmBar(s.temp.msLeft, s.ttlMs), value: window })
      add('next', 'sub', 'subtle', { value: `Next send ≈${formatUsd(s.warmUsd)} warm, ≈${formatUsd(s.coldUsd)} cold (${tokens})` })
      break
    case 'cold':
      add('state', 'hero', 'subtle', { value: `Cold · ${formatTokens(s.tokens)} to re-read` })
      add('window', 'sub', 'subtle', { value: `cold for ${formatDuration(s.temp.msAgo)}; ${window}` })
      add('next', 'sub', 'subtle', { value: `Next send ≈${formatUsd(s.coldUsd)} cold, ≈${formatUsd(s.warmUsd)} warm (${tokens})` })
      break
  }

  // Rows: a figure each, its detail dim beneath. A figure still at zero draws no row.
  const isQuiet = r.coldSends === 0 && r.held === 0 && r.pings === 0 && s.warm === null
  if (isQuiet) add('quiet', 'sub', 'subtle', { value: 'Nothing paid cold, held or pinged yet' })
  if (r.coldSends > 0) {
    add('cold', 'row', 'plain', { label: 'Cold sends paid', value: `${r.coldSends}` })
    add('cold-detail', 'sub', 'subtle', { value: `${formatTokens(r.coldTokens)} tokens re-read, ≈${formatUsd(r.coldExtraUsd)} more than warm` })
  }
  if (r.held > 0) {
    add('held', 'row', 'plain', { label: 'Prompts held', value: `${r.held}` })
    if (r.clearedAfterHold > 0) add('held-detail', 'sub', 'subtle', { value: `${r.clearedAfterHold} answered with /clear, ≈${formatUsd(r.clearAvoidedUsd)} not spent` })
  }
  if (r.pings > 0 || s.warm !== null) {
    add('pings', 'row', 'plain', { label: 'Keep-warm pings', value: `${r.pings}` })
    const parts = [`≈${formatUsd(r.pingUsd)}`]
    if (r.rescued > 0) parts.push(`${r.rescued} send${r.rescued === 1 ? '' : 's'} found the cache warm thanks to them, ≈${formatUsd(r.rescuedUsd)} not spent`)
    if (s.warm !== null) parts.push(`running now, ${formatDuration(s.warm.until - s.now)} left`)
    add('pings-detail', 'sub', 'subtle', { value: parts.join(' · ') })
  }
  const saved = r.clearAvoidedUsd + r.rescuedUsd - r.pingUsd
  if (!isQuiet && saved !== 0) {
    add('saved', 'row', saved < 0 ? 'warning' : 'plain', { label: 'Saved', value: saved > 0 ? `≈${formatUsd(saved)}` : `-≈${formatUsd(-saved)}` })
    add('saved-detail', 'sub', 'subtle', { value: saved > 0 ? 'not spent, less what the pings cost' : 'the pings cost more than they saved' })
  }
  if (total !== undefined) {
    add('total', 'row', 'plain', { label: 'Session total', value: `≈${formatUsd(total)}` })
    add('total-detail', 'sub', 'subtle', { value: "Claude Code's estimate, as /cost shows it" })
  }
  add('guard', 'row', 'plain', { label: 'Guard', value: guard })

  add('note', 'note', 'subtle', { value: `Dollars are API list prices.${s.auth === 'bearer' ? ' On a subscription these measure plan usage, not a bill.' : ''}` })
  return lines
}

/** The same receipt as text, for the transcript note. */
export function receiptText(lines: readonly ReceiptLine[]): string {
  return lines.map(l => l.text).join('\n')
}
