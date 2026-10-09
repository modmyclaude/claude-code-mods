// Settings, and every sentence Second Wind writes outside the band itself:
// /breathe's answers, the fold line, the share card. Pure.

import type { PluginOptions } from 'claude-code'

import { LABELS, plural } from './breath'
import type { Motion } from './draw'
import { isOn, streakOn, todayOn } from './stats'
import type { Stats, Switch } from './stats'
import type { SecondWindPaced, SecondWindPlan } from '../types'

export type Settings = {
  pattern: SecondWindPaced
  motion: Motion
  delayMs: number
  eyeRest: boolean
  stretch: boolean
  movementCard: boolean
}

export const SAFETY = 'Breathe gently and never strain. If you feel lightheaded, stop and breathe normally.'

/** How often the band redraws while it moves: often for full motion, once a second for still. */
export const TICK_MS: Readonly<Record<Motion, number>> = { full: 125, gentle: 500, still: 1000 }

const MAX_DELAY_S = 600

export function readSettings(options: PluginOptions): Settings {
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback
  const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
  const raw = options.delaySeconds
  const seconds = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(MAX_DELAY_S, Math.max(0, raw)) : 3
  return {
    pattern: pick(options.pattern, ['slow', 'box'] as const, 'slow'),
    motion: pick(options.motion, ['full', 'gentle', 'still'] as const, 'full'),
    delayMs: Math.round(seconds * 1000),
    eyeRest: flag(options.eyeRest, true),
    stretch: flag(options.stretch, true),
    movementCard: flag(options.movementCard, false),
  }
}

export const planOf = (s: Settings): SecondWindPlan => ({ pattern: s.pattern, delayMs: s.delayMs, eyeRest: s.eyeRest, stretch: s.stretch })

const onOff = (b: boolean): string => (b ? 'on' : 'off')

export function settingsLine(s: Settings): string {
  return [
    `pattern ${s.pattern} (${LABELS[s.pattern]})`,
    `motion ${s.motion}`,
    `delay ${s.delayMs / 1000}s`,
    `eye rest ${onOff(s.eyeRest)}`,
    `stretch ${onOff(s.stretch)}`,
    `movement card ${onOff(s.movementCard)}`,
  ].join(' · ')
}

export const USAGE = 'Use /breathe, /breathe on, /breathe off, /breathe snooze or /breathe card.'

/** What /breathe answers: today's counts, the streak, the settings, the switch and the safety line. */
export function statusText(stats: Stats, sw: Switch, day: string, s: Settings): string {
  const t = todayOn(stats, day)
  const streak = streakOn(stats, day)
  const state = sw.off ? 'off (/breathe on turns it back on)' : !isOn(sw, day) ? 'snoozed for the rest of today' : 'on'
  const today = [plural(t.breaths, 'breath'), plural(t.eyeRests, 'eye rest'), plural(t.stretches, 'stretch', 'stretches')]
  if (s.movementCard || t.moves > 0) today.push(plural(t.moves, 'move'))
  return [
    `Second Wind is ${state}.`,
    `Today: ${today.join(' · ')} · ${streak}-day streak`,
    `All time: ${plural(stats.all.breaths, 'breath')} while Claude worked`,
    `Settings: ${settingsLine(s)} (change them in /config)`,
    USAGE,
    SAFETY,
  ].join('\n')
}

/** The line the band folds into once Claude answers. */
export function foldLine(breaths: number, stats: Stats | null, day: string): string {
  const head = `${plural(breaths, 'breath')} while Claude worked`
  if (stats === null) return head
  return `${head} · ${todayOn(stats, day).breaths} today · ${streakOn(stats, day)}-day streak`
}

/** The small text card /breathe card copies. */
export function shareCard(stats: Stats, day: string): string {
  const t = todayOn(stats, day)
  const lines = [
    'Second Wind',
    `${plural(t.breaths, 'breath')} today · ${streakOn(stats, day)}-day streak`,
    `${plural(stats.all.breaths, 'breath')} while Claude worked, all time`,
  ]
  const extras = [
    ...(t.eyeRests > 0 ? [plural(t.eyeRests, 'eye rest')] : []),
    ...(t.stretches > 0 ? [plural(t.stretches, 'stretch', 'stretches')] : []),
    ...(t.moves > 0 ? [plural(t.moves, 'move')] : []),
  ]
  if (extras.length > 0) lines.push(`${extras.join(' · ')} today`)
  return lines.join('\n')
}

/** The two movement cards. */
export const CARD_TEXT: Readonly<Record<'stand' | 'squats', string>> = { stand: 'Stand up and stretch', squats: '10 squats' }

// OSC (ESC ] or C1 U+009D, to BEL or ST), CSI (ESC [ or C1 U+009B), then any other escape.
const ANSI =
  /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u009d[^\u0007\u001b\u009c]*(?:\u0007|\u009c|\u001b\\)?|\u001b\[[0-?]*[ -/]*[@-~]|\u009b[0-?]*[ -/]*[@-~]|\u001b[ -/]*[0-~]?/g
const BREAKS = /\r\n?|[\n\t\u2028\u2029]/g
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
// Zero-width, bidi overrides and isolates, invisible fillers, tag characters, variation selectors.
const INVISIBLE =
  /[\u00ad\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufffb\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu

/**
 * Untrusted text made safe to show on one line (API-GOTCHAS #31). Everything
 * the band, spinner and status line draw is Second Wind's own words and
 * numbers; the one thing it repeats from outside is a word typed after
 * /breathe. ANSI sequences go, line breaks and tabs become spaces, any other
 * C0, DEL or C1 becomes U+FFFD, invisible or bidi characters go.
 */
export function clean(text: string): string {
  return text.replace(ANSI, '').replace(BREAKS, ' ').replace(CONTROL, '\uFFFD').replace(INVISIBLE, '')
}

/** What /breathe answers to a word it does not know. */
export const unknownWord = (word: string): string => `Second Wind does not know "${clean(word)}". ${USAGE}`

/** The prompt box's text after one edit, from the splice `prompt.edit` carries. */
export const draftAfter = (e: { text: string; start: number; end: number; inputText: string }): string =>
  e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
