// Pure logic: what /wear means, which theme is worn when, and how times print.

import type { WardrobeLook } from '../types'
import { THEMES, themeById } from './themes'

/** Claude Code's own drawing: wardrobe restyles nothing. */
export const DEFAULT = 'default'
/** A light theme by day and a dark one by night. */
export const AUTO = 'auto'
/** The seasonal pack the date calls for (SEASONS). */
export const SEASON = 'season'

/** Every word `/wear <choice>` accepts as a whole name. */
export const CHOICES: readonly string[] = [DEFAULT, ...THEMES.map(theme => theme.id), AUTO, SEASON]

const ALIASES: Record<string, string> = {
  xmas: 'christmas',
  noel: 'christmas',
  fall: 'autumn',
  spooky: 'halloween',
  hc: 'high-contrast',
  highcontrast: 'high-contrast',
  contrast: 'high-contrast',
  cb: 'colorblind',
  colourblind: 'colorblind',
  'colour-blind': 'colorblind',
  'color-blind': 'colorblind',
  tokyo: 'tokyo-night',
  tokyonight: 'tokyo-night',
  mocha: 'catppuccin',
  light: 'paper',
  off: DEFAULT,
  none: DEFAULT,
  reset: DEFAULT,
  plain: DEFAULT,
}

/** A word as a choice (theme id, `auto` or `default`), or undefined. */
export function choiceOf(word: string): string | undefined {
  const w = word.trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (w === '') return undefined
  if (CHOICES.includes(w)) return w
  const alias = ALIASES[w]
  if (alias !== undefined) return alias
  // A unique prefix is enough: `drac` is dracula, `c` is ambiguous.
  const hits = CHOICES.filter(id => id.startsWith(w))
  return hits.length === 1 ? hits[0] : undefined
}

/** Whether a stored value is still a choice this version knows. */
export function isChoice(value: unknown): value is string {
  return typeof value === 'string' && CHOICES.includes(value)
}

export type WearCommand =
  | { kind: 'list' }
  | { kind: 'wear'; choice: string }
  | { kind: 'pin' }
  | { kind: 'unpin' }
  | { kind: 'unknown'; word: string }

/** `/wear` arguments as one command. */
export function parseWear(args: string): WearCommand {
  const word = args.trim().toLowerCase()
  if (word === '' || word === 'list') return { kind: 'list' }
  if (word === 'pin') return { kind: 'pin' }
  if (word === 'unpin') return { kind: 'unpin' }
  const choice = choiceOf(word)
  return choice === undefined ? { kind: 'unknown', word: args.trim() } : { kind: 'wear', choice }
}

/** `HH:MM` (24-hour, `7:05` too) as minutes after midnight, or undefined. */
export function parseClock(text: string): number | undefined {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(text)
  if (!m) return undefined
  const hours = Number(m[1])
  const minutes = Number(m[2])
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : undefined
}

/** Whether `minute` (after midnight) falls in the day, from `dayStarts` to `nightStarts`. */
export function isDay(minute: number, dayStarts: number, nightStarts: number): boolean {
  if (dayStarts === nightStarts) return true // no night at all
  // A day that crosses midnight (day 20:00, night 06:00) is the wrapped range.
  return dayStarts < nightStarts
    ? minute >= dayStarts && minute < nightStarts
    : minute >= dayStarts || minute < nightStarts
}

/** Local minutes after midnight for a `$.clock.now()` reading. */
export function minuteOfDay(ms: number): number {
  const date = new Date(ms)
  return date.getHours() * 60 + date.getMinutes()
}

/**
 * What `/wear season` wears when, by the local date. The first window that
 * holds the date wins, so Halloween sits inside autumn; a window may cross the
 * year's end. The rest of winter (Jan 7 to Feb) has no pack of its own and
 * wears nord, the frost theme.
 */
export const SEASONS: readonly { theme: string; from: readonly [number, number]; to: readonly [number, number]; when: string }[] = [
  { theme: 'halloween', from: [10, 15], to: [11, 1], when: 'Oct 15 to Nov 1' },
  { theme: 'christmas', from: [12, 1], to: [1, 6], when: 'Dec 1 to Jan 6' },
  { theme: 'spring', from: [3, 1], to: [5, 31], when: 'Mar 1 to May 31' },
  { theme: 'summer', from: [6, 1], to: [8, 31], when: 'Jun 1 to Aug 31' },
  { theme: 'autumn', from: [9, 1], to: [11, 30], when: 'Sep 1 to Nov 30, Halloween aside' },
  { theme: 'nord', from: [1, 7], to: [2, 29], when: 'Jan 7 to the end of Feb' },
]

/** The theme the season calls for at a `$.clock.now()` reading (local date). */
export function seasonOf(ms: number): string {
  const date = new Date(ms)
  const day = (date.getMonth() + 1) * 100 + date.getDate()
  const key = ([month, dayOfMonth]: readonly [number, number]) => month * 100 + dayOfMonth
  for (const season of SEASONS) {
    const from = key(season.from)
    const to = key(season.to)
    const inside = from <= to ? day >= from && day <= to : day >= from || day <= to
    if (inside) return season.theme
  }
  return 'nord'
}

/** The window of the year a theme is the season's, in words, or undefined. */
export function seasonWindow(theme: string): string | undefined {
  return SEASONS.find(season => season.theme === theme)?.when
}

export type Settings = {
  dayTheme: string
  nightTheme: string
  dayStarts: number
  nightStarts: number
}

const FALLBACK = { dayTheme: 'paper', nightTheme: 'tokyo-night', dayStarts: '07:00', nightStarts: '19:00' }

/** The userConfig values, checked; anything unusable falls back and is named in `problems`. */
export function settingsFrom(options: Readonly<Record<string, unknown>>): { settings: Settings; problems: string[] } {
  const problems: string[] = []
  const theme = (key: 'dayTheme' | 'nightTheme'): string => {
    const value = options[key]
    if (typeof value === 'string' && (value === DEFAULT || themeById(value))) return value
    problems.push(`${key} "${String(value)}" is not a theme; using ${FALLBACK[key]}`)
    return FALLBACK[key]
  }
  const clock = (key: 'dayStarts' | 'nightStarts'): number => {
    const value = options[key]
    const minute = typeof value === 'string' ? parseClock(value) : undefined
    if (minute !== undefined) return minute
    problems.push(`${key} "${String(value)}" is not HH:MM; using ${FALLBACK[key]}`)
    return parseClock(FALLBACK[key]) ?? 0
  }
  return {
    settings: { dayTheme: theme('dayTheme'), nightTheme: theme('nightTheme'), dayStarts: clock('dayStarts'), nightStarts: clock('nightStarts') },
    problems,
  }
}

/**
 * The project's pin if it has one, else the global choice, else Claude Code's
 * own look; `auto` and `season` resolved for `now` (a `$.clock.now()` reading).
 */
export function resolveLook(input: {
  root: string
  global: unknown
  pins: unknown
  now: number
  settings: Settings
}): WardrobeLook {
  const pin = pinsOf(input.pins)[input.root]
  const choice = pin ?? (isChoice(input.global) ? input.global : DEFAULT)
  const scope = pin === undefined ? 'global' : 'project'
  if (choice === SEASON) return { theme: seasonOf(input.now), choice, scope, phase: null, root: input.root }
  if (choice !== AUTO) return { theme: choice, choice, scope, phase: null, root: input.root }
  const { dayTheme, nightTheme, dayStarts, nightStarts } = input.settings
  const phase = isDay(minuteOfDay(input.now), dayStarts, nightStarts) ? 'day' : 'night'
  return { theme: phase === 'day' ? dayTheme : nightTheme, choice, scope, phase, root: input.root }
}

/** The stored pins, keeping only entries this version understands. */
export function pinsOf(value: unknown): Record<string, string> {
  const pins: Record<string, string> = {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return pins
  for (const [root, choice] of Object.entries(value)) if (isChoice(choice)) pins[root] = choice
  return pins
}

export function sameLook(a: WardrobeLook | undefined, b: WardrobeLook): boolean {
  return a !== undefined && a.theme === b.theme && a.choice === b.choice && a.scope === b.scope && a.phase === b.phase && a.root === b.root
}

/** `HH:MM` for minutes after midnight. */
export function clockText(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

/** A tool call's time: `840ms`, `1.2s`, `14s`, `1m 4s`. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const rounded = Math.round(ms)
  if (rounded < 1000) return `${rounded}ms`
  if (rounded < 9950) return `${(rounded / 1000).toFixed(1)}s`
  return formatDuration(rounded)
}

/** A turn's length: `3s`, `1m 4s`, `2m`, `1h 5m`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
}
