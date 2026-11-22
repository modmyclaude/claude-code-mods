// Pure logic: what /wear means, which theme is worn when, and how times print.

import type { WardrobeLook } from '../types'
import { SPORTS, THEMES, themeById } from './themes'

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
  crt: 'phosphor',
  terminal: 'phosphor',
  grey: 'graphite',
  gray: 'graphite',
  terracotta: 'clay',
  retro: 'synthwave',
  pager: 'on-call',
  oncall: 'on-call',
  basketball: 'hardwood',
  hoops: 'hardwood',
  football: 'gridiron',
  hockey: 'rink',
  'eid-al-fitr': 'eid',
  fitr: 'eid',
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
  /** `everywhere`: the choice becomes every project's, and every pin is let go. */
  | { kind: 'wear'; choice: string; match?: true; everywhere?: true }
  | { kind: 'match' }
  | { kind: 'pin' }
  | { kind: 'unpin' }
  /** `/wear everywhere`: what this project wears now becomes every project's. */
  | { kind: 'everywhere'; match?: true }
  /** `/wear wallpaper [on|off]`: `on` is null for a plain ask of the state. */
  | { kind: 'wallpaper'; on: boolean | null }
  | { kind: 'unknown'; word: string }

/** The words that make a choice every project's: `/wear christmas everywhere`. */
const EVERYWHERE: readonly string[] = ['everywhere', '--everywhere']

/** `/wear` arguments as one command. */
export function parseWear(args: string): WearCommand {
  const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const match = parts.includes('--match')
  const everywhere = parts.some(part => EVERYWHERE.includes(part))
  const word = parts.filter(part => part !== '--match' && !EVERYWHERE.includes(part)).join(' ')
  if (word === 'match' || (word === '' && match)) return everywhere ? { kind: 'everywhere', match: true } : { kind: 'match' }
  if (word === '' && everywhere) return { kind: 'everywhere' }
  // `everywhere` belongs to a look: beside the list, a pin or the wallpaper it means nothing, and saying so beats dropping it.
  if (everywhere && (word === 'list' || word === 'pin' || word === 'unpin' || /^wallpapers?( |$)/.test(word))) return { kind: 'unknown', word: args.trim() }
  if (word === '' || word === 'list') return { kind: 'list' }
  if (word === 'pin') return { kind: 'pin' }
  if (word === 'unpin') return { kind: 'unpin' }
  if (word === 'wallpaper' || word === 'wallpapers') return { kind: 'wallpaper', on: null }
  if (/^wallpapers? (on|off)$/.test(word)) return { kind: 'wallpaper', on: word.endsWith('on') }
  const choice = choiceOf(word)
  if (choice === undefined) return { kind: 'unknown', word: args.trim() }
  return { kind: 'wear', choice, ...(match ? { match } : {}), ...(everywhere ? { everywhere } : {}) }
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

/** Easter Sunday of a year by the Western (Gregorian) reckoning, as [month, day]. */
export function easterOf(year: number): readonly [number, number] {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const sum = h + l - 7 * m + 114
  return [Math.floor(sum / 31), (sum % 31) + 1]
}

/**
 * The first day of Eid al-Fitr by the Umm al-Qura calendar, as [year, month,
 * day], through 2040. The day itself follows the sighting of the new moon, so
 * where a person lives it may fall a day either side; past the table the look
 * is still worn by name.
 */
export const EID_AL_FITR: readonly (readonly [number, number, number])[] = [
  [2026, 3, 20],
  [2027, 3, 9],
  [2028, 2, 26],
  [2029, 2, 14],
  [2030, 2, 4],
  [2031, 1, 24],
  [2032, 1, 14],
  [2033, 1, 3],
  [2033, 12, 23],
  [2034, 12, 12],
  [2035, 12, 1],
  [2036, 11, 19],
  [2037, 11, 9],
  [2038, 10, 29],
  [2039, 10, 19],
  [2040, 10, 7],
]

/** The two holiday looks `season` may wear on their days, each only where its setting asks. */
export const HOLIDAYS: readonly { theme: string; setting: 'seasonEaster' | 'seasonEid'; when: string }[] = [
  { theme: 'easter', setting: 'seasonEaster', when: 'Good Friday to Easter Monday' },
  { theme: 'eid', setting: 'seasonEid', when: 'Eid al-Fitr and the two days after' },
]

/** Whole local days from one local date to the reading `ms`: 0 on the day itself. */
function daysFrom(year: number, month: number, day: number, ms: number): number {
  const date = new Date(ms)
  const here = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  // Rounded, so the hour a clock change adds or takes never moves a day.
  return Math.round((here - new Date(year, month - 1, day).getTime()) / 86_400_000)
}

/** The holiday look a `$.clock.now()` reading (local date) falls in, among those asked for; undefined on any other day. */
export function holidayOf(ms: number, asked: Readonly<{ seasonEaster: boolean; seasonEid: boolean }>): string | undefined {
  const year = new Date(ms).getFullYear()
  if (asked.seasonEaster) {
    const since = daysFrom(year, ...easterOf(year), ms)
    if (since >= -2 && since <= 1) return 'easter'
  }
  if (asked.seasonEid) {
    for (const [y, month, day] of EID_AL_FITR) {
      if (Math.abs(y - year) > 1) continue
      const since = daysFrom(y, month, day, ms)
      if (since >= 0 && since <= 2) return 'eid'
    }
  }
  return undefined
}

/** The theme the season calls for at a `$.clock.now()` reading (local date): a holiday asked for first, then the calendar. */
export function seasonOf(ms: number, asked?: Readonly<{ seasonEaster: boolean; seasonEid: boolean }>): string {
  const holiday = asked === undefined ? undefined : holidayOf(ms, asked)
  if (holiday !== undefined) return holiday
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
  return (HOLIDAYS.find(holiday => holiday.theme === theme) ?? SEASONS.find(season => season.theme === theme))?.when
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

/** `gameDay` as weekdays (0 is Sunday): `sunday`, `sat sun`, `mon, thu`; three letters are enough. Words that are no weekday come back in `unknown`. */
export function parseGameDays(text: string): { days: number[]; unknown: string[] } {
  const days = new Set<number>()
  const unknown: string[] = []
  for (const word of text.toLowerCase().split(/[\s,;/+&]+/).filter(word => word !== '' && word !== 'and')) {
    const at = word.length >= 3 ? WEEKDAYS.findIndex(day => day.startsWith(word.replace(/s$/, '')) || day === word) : -1
    if (at === -1) unknown.push(word)
    else days.add(at)
  }
  return { days: [...days].sort((a, b) => a - b), unknown }
}

/** The weekdays of a game day setting, in words: `Sunday`, `Saturday and Sunday`. */
export function gameDaysText(days: readonly number[]): string {
  const names = days.map(day => `${WEEKDAYS[day]!.charAt(0).toUpperCase()}${WEEKDAYS[day]!.slice(1)}`)
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** How much a scene moves: all of it, half the small things at half the speed, or not at all. */
export type Motion = 'full' | 'calm' | 'still'
/** How heavily the desktop frosts its panels over a scene. */
export type Glass = 'light' | 'default' | 'heavy'

export type Settings = {
  dayTheme: string
  nightTheme: string
  dayStarts: number
  nightStarts: number
  /** Whether wearing a look also sets Claude Code's own theme to match it. */
  matchTheme: boolean
  /** A team's two colours for the sports looks, each `#rrggbb`, or empty for the look's own. */
  teamPrimary: string
  teamSecondary: string
  /** The weekdays (0 is Sunday) on which `auto` and `season` wear the game look; none, and there is no game day. */
  gameDays: readonly number[]
  /** The sports look a game day wears. */
  gameLook: string
  motion: Motion
  glass: Glass
  /** Whether `season` wears the Easter look from Good Friday to Easter Monday. */
  seasonEaster: boolean
  /** Whether `season` wears the Eid look on Eid al-Fitr and the two days after. */
  seasonEid: boolean
}

const FALLBACK = { dayTheme: 'paper', nightTheme: 'tokyo-night', dayStarts: '07:00', nightStarts: '19:00' }

/** What a setting this version added is when nothing is stored for it: an older install keeps drawing as it did. */
export const ADDED = { teamPrimary: '', teamSecondary: '', gameDays: [], gameLook: 'hardwood', motion: 'full', glass: 'default', seasonEaster: false, seasonEid: false } as const satisfies Partial<Settings>

/** A colour as `#rrggbb`, from `#rgb`, `rrggbb` or `#RRGGBB`; undefined for anything else. */
export function hexOf(text: string): string | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim())
  if (!m) return undefined
  const digits = m[1]!.toLowerCase()
  return `#${digits.length === 3 ? [...digits].map(d => d + d).join('') : digits}`
}

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
  // A switch is what it was installed as until the setting says otherwise: matching on (an older install, with no
  // such setting stored, matches too), the holiday looks off.
  const flag = (key: 'matchTheme' | 'seasonEaster' | 'seasonEid', installed: boolean): boolean => {
    const value = options[key]
    if (value === undefined) return installed
    if (typeof value === 'boolean') return value
    problems.push(`${key} "${String(value)}" is not on or off; using ${installed ? 'on' : 'off'}`)
    return installed
  }
  const colour = (key: 'teamPrimary' | 'teamSecondary'): string => {
    const value = options[key]
    if (value === undefined || value === '') return ''
    const hex = typeof value === 'string' ? hexOf(value) : undefined
    if (hex !== undefined) return hex
    problems.push(`${key} "${String(value)}" is not a colour like #1f4e9c; using the look's own`)
    return ''
  }
  const oneOf = <T extends string>(key: 'gameLook' | 'motion' | 'glass', allowed: readonly T[], fallback: T): T => {
    const value = options[key]
    if (value === undefined) return fallback
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
    problems.push(`${key} "${String(value)}" is not one of ${allowed.join(', ')}; using ${fallback}`)
    return fallback
  }
  const gameDays = (): number[] => {
    const value = options.gameDay
    if (value === undefined || value === '') return []
    const { days, unknown } = typeof value === 'string' ? parseGameDays(value) : { days: [], unknown: [String(value)] }
    if (unknown.length > 0) problems.push(`gameDay "${unknown.join(' ')}" is not a weekday; left out`)
    return days
  }
  return {
    settings: {
      dayTheme: theme('dayTheme'),
      nightTheme: theme('nightTheme'),
      dayStarts: clock('dayStarts'),
      nightStarts: clock('nightStarts'),
      matchTheme: flag('matchTheme', true),
      teamPrimary: colour('teamPrimary'),
      teamSecondary: colour('teamSecondary'),
      gameDays: gameDays(),
      gameLook: oneOf('gameLook', SPORTS, ADDED.gameLook),
      motion: oneOf<Motion>('motion', ['full', 'calm', 'still'], ADDED.motion),
      glass: oneOf<Glass>('glass', ['light', 'default', 'heavy'], ADDED.glass),
      seasonEaster: flag('seasonEaster', false),
      seasonEid: flag('seasonEid', false),
    },
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
  if (choice !== AUTO && choice !== SEASON) return { theme: choice, choice, scope, phase: null, root: input.root }
  // A game day outranks the clock and the calendar, for the two choices that change by themselves; a look worn by name stays.
  if (input.settings.gameDays.includes(new Date(input.now).getDay())) return { theme: input.settings.gameLook, choice, scope, phase: 'game', root: input.root }
  if (choice === SEASON) return { theme: seasonOf(input.now, input.settings), choice, scope, phase: null, root: input.root }
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
