// Rain Check's pure parts: which usage window ran out, when a waiting prompt
// goes out, and the words the band, the hold and the toasts say. Nothing here
// touches the engine, so the tests can pin every case directly.

import type { RainCheckLimit, RainCheckQueued } from '../types'

/** One usage window as Claude Code reports it (`SessionRateLimit`). */
export type Window = { kind: string; percentUsed: number; resetsAt?: string }

/** A waiting prompt goes out this long after the reset, so it lands in the new window. */
export const AFTER_RESET_MS = 60_000
/** The countdown moves by the minute. */
export const TICK_MS = 60_000
/** What a turn the limit cut off is picked up with. */
export const CONTINUE_TEXT = 'Continue where you left off. Your usage limit has reset.'
/** A turn that hit `rate_limit` names its window only when one is this full; below it the 429 was a passing one. */
const NEAR_FULL = 95
/** How much of the waiting prompt the band shows. */
const PREVIEW_CHARS = 72

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** When a window resets, or NaN when it does not say. */
function resetOf(window: Window): number {
  return Date.parse(window.resetsAt ?? '')
}

/** The window that is out now (used up, resetting later), the latest reset if several are; null when none is. */
export function outWindow(windows: readonly Window[], now: number): RainCheckLimit | null {
  let out: RainCheckLimit | null = null
  for (const window of windows) {
    const resetsAt = resetOf(window)
    if (window.percentUsed < 100 || Number.isNaN(resetsAt) || resetsAt <= now) continue
    if (out === null || resetsAt > out.resetsAt) out = { kind: window.kind, resetsAt }
  }
  return out
}

/**
 * The window a turn that ended on `rate_limit` ran into: one that reads used
 * up, else the fullest at 95% or more (the last reading can trail the
 * refusal). Null when none is near full: that 429 passes on its own, and an
 * API key reports no windows at all.
 */
export function cutOffWindow(windows: readonly Window[], now: number): RainCheckLimit | null {
  const out = outWindow(windows, now)
  if (out !== null) return out
  let fullest: Window | null = null
  for (const window of windows) {
    const resetsAt = resetOf(window)
    if (Number.isNaN(resetsAt) || resetsAt <= now || window.percentUsed < NEAR_FULL) continue
    if (fullest === null || window.percentUsed > fullest.percentUsed) fullest = window
  }
  return fullest === null ? null : { kind: fullest.kind, resetsAt: resetOf(fullest) }
}

/** `8am`, `8:01am`, or `Tue 8am` when it is not today: the way Claude Code names a reset. */
export function clockWords(at: number, now: number): string {
  const date = new Date(at)
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const time = `${hours % 12 === 0 ? 12 : hours % 12}${minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`}${hours < 12 ? 'am' : 'pm'}`
  return date.toDateString() === new Date(now).toDateString() ? time : `${DAYS[date.getDay()]} ${time}`
}

/** `45s`, `14m`, `2h 14m`, `3d 4h`: rounded up, never "0m". */
export function untilWords(ms: number): string {
  if (ms <= 0) return 'now'
  if (ms < 60_000) return `${Math.ceil(ms / 1000)}s`
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`
}

/** When a prompt queued now goes out: just after the reset. */
export function sendTime(limit: Pick<RainCheckLimit, 'resetsAt'>): number {
  return limit.resetsAt + AFTER_RESET_MS
}

/** The band's line while a prompt waits. */
export function waitingLine(queued: RainCheckQueued, now: number): string {
  const what = queued.source === 'continue' ? 'Continues' : 'Sends'
  return `${what} ${clockWords(queued.sendAt, now)} · in ${untilWords(queued.sendAt - now)}`
}

/** The band's line while a window is out and nothing waits. */
export function limitLine(limit: RainCheckLimit, now: number): string {
  return `Usage limit reached · resets ${clockWords(limit.resetsAt, now)} · in ${untilWords(limit.resetsAt - now)}`
}

/** Text made safe to draw: no control characters, one line, cut to `max` with an ellipsis. */
export function oneLine(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  return chars.length <= max ? flat : `${chars.slice(0, Math.max(1, max - 1)).join('')}…`
}

/** The waiting prompt as the band shows it, in quotes. */
export function preview(queued: RainCheckQueued, columns: number): string {
  return `"${oneLine(queued.text, Math.max(8, Math.min(PREVIEW_CHARS, columns - 4)))}"`
}

/** What a held send says (at most 20 words: the desktop shows it as the reason a hook held the prompt). */
export function holdText(queued: RainCheckQueued, now: number, isAdded: boolean, hasFiles: boolean): string {
  const when = `${clockWords(queued.sendAt, now)} (in ${untilWords(queued.sendAt - now)})`
  const lead = isAdded ? `Added to the waiting prompt: sends ${when}.` : `Usage limit reached. This prompt waits and sends ${when}.`
  return `${lead}${hasFiles ? ' Only the text waits: attach files again then.' : ' Cancel above the prompt.'}`
}

/** A held prompt and whatever already waits (another held prompt, or the pick-up), sent together as one. */
export function joined(waiting: RainCheckQueued | null, text: string, sendAt: number): RainCheckQueued {
  return { text: waiting === null ? text : `${waiting.text}\n\n${text}`, sendAt, source: 'held' }
}
