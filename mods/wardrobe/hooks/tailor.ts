// A sports look in a team's colours. The two colours come from the settings
// (`teamPrimary`, `teamSecondary`) and take the place of the look's accent and
// special: the stripe on every row, the icons and chips painted in those roles,
// Bolt's costume, the app's own accents and the scene's seats and banners.
// Nothing here names a team: the colours are the person's to give.

import { contrast, lifted } from './contrast'
import type { Settings } from './look'
import { SPORTS, themeById, type Theme } from './themes'

export type Team = Pick<Settings, 'teamPrimary' | 'teamSecondary'>

/** The bar a colour that words are drawn in must clear on the look's background. */
const READABLE = 4.5

const tailored = new Map<string, Theme>()

/** Whether the settings give a team colour, and the look is one that wears them. */
export function isTailored(id: string, team: Team): boolean {
  return SPORTS.includes(id) && (team.teamPrimary !== '' || team.teamSecondary !== '')
}

/**
 * The look as it is worn: the theme itself, or, for a sports look where the
 * settings give a team's colours, the same look with those colours as its
 * accent and special. A colour too dark (or, on a light look, too pale) to be
 * read on the look's background is moved toward white (or black) only as far
 * as reading takes; the colours as given are kept in `team` for the scene,
 * which paints seats and banners with them, never words.
 */
export function wornTheme(id: string, team: Team): Theme | undefined {
  const theme = themeById(id)
  if (theme === undefined || !isTailored(id, team)) return theme
  const key = `${id} ${team.teamPrimary} ${team.teamSecondary}`
  const kept = tailored.get(key)
  if (kept !== undefined) return kept
  const { bg } = theme.palette
  const pole = theme.tone === 'dark' ? '#ffffff' : '#000000'
  const primary = team.teamPrimary === '' ? theme.palette.accent : team.teamPrimary
  const secondary = team.teamSecondary === '' ? theme.palette.special : team.teamSecondary
  const out: Theme = {
    ...theme,
    palette: { ...theme.palette, accent: lifted(primary, bg, READABLE, pole), special: lifted(secondary, bg, READABLE, pole) },
    team: { primary, secondary },
  }
  tailored.set(key, out)
  return out
}

/** What to say of the team colours when a sports look goes on: that they are worn, and which had to be moved to be read. Empty for any other look, or with no colours given. */
export function teamNote(id: string, team: Team): string {
  const theme = themeById(id)
  if (theme === undefined || !isTailored(id, team)) return ''
  const moved = [team.teamPrimary, team.teamSecondary].filter(colour => colour !== '' && contrast(colour, theme.palette.bg) < READABLE)
  if (moved.length === 0) return ' In your team colours.'
  return ` In your team colours; ${moved.join(' and ')} ${moved.length === 1 ? 'was' : 'were'} ${theme.tone === 'dark' ? 'lightened' : 'darkened'} to be read on ${id}.`
}

/**
 * What tells one drawing of a look from another: its name, the two colours a
 * team may change, and the colours as given, which the scene paints with and
 * which two different pairs can share once moved to be read.
 */
export function lookKey(theme: Theme): string {
  const given = theme.team === undefined ? '' : ` ${theme.team.primary} ${theme.team.secondary}`
  return `${theme.id} ${theme.palette.accent} ${theme.palette.special}${given}`
}
