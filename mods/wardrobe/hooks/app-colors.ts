// The look as the desktop and mobile apps wear it themselves: one palette per
// look, for the app's own page, cards, panels, text, borders and accents, sent
// with `$.theme.set` beside the scene. Made from the look's own colours by one
// rule, so the app and the rows wardrobe draws can never drift apart.
//
// `make-colors.js` is Claude Code's own helper, copied in as its guide to looks
// asks and left as it is: a palette is about a hundred colours under names a
// mod cannot guess, and the helper writes them from a few anchors.

import type { ThemeColors } from 'claude-code'

import { lifted } from './contrast'
import { makeColors } from './make-colors.js'
import { mix } from './scene-kit'
import { lookKey } from './tailor'
import type { Theme } from './themes'

/** The code highlighting theme a look pairs with, where a well-known one shares its palette; a surface keeps its own for a name it does not offer. */
const CODE_THEME: Record<string, string> = {
  dracula: 'dracula',
  nord: 'nord',
  'tokyo-night': 'tokyo-night',
  solarized: 'solarized-dark',
  catppuccin: 'catppuccin-mocha',
}

/** The name a surface may show for the look's palette: `Tokyo night (wardrobe)`. */
export function paletteLabel(theme: Pick<Theme, 'id'>): string {
  const words = theme.id.replace(/-/g, ' ')
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} (wardrobe)`
}

/** The line the helper writes when the desktop app would ignore the whole palette. */
export const isRefusal = (line: string): boolean => line.startsWith("Desktop won't paint")

type Anchors = Record<'surface-0' | 'surface-1' | 'surface-2' | 'surface-3' | 'text-primary' | 'text-secondary' | 'text-muted', string>

/**
 * The few colours the palette grows from. The page is the look's background;
 * cards, panels and menus step a little toward the text, staying close so a
 * card reads as paper on paper. A light look's page sits a shade under its
 * cards, as the design system lays a light mode out. Words come first: the
 * main text stands at least `want` to one on every surface and the quiet text
 * 4.5 to one, moved toward white (or black, on a light look) only as far as
 * that takes.
 */
export function anchorsOf(theme: Theme, want = 7): Anchors {
  const p = theme.palette
  const isDark = theme.tone === 'dark'
  const toward = (k: number) => mix(p.bg, p.text, k)
  const surfaces = isDark ? [p.bg, toward(0.02), toward(0.04), toward(0.055)] : [toward(0.035), toward(0.018), p.bg, p.bg]
  // The surface the text has least contrast on: the lightest of a dark look, the darkest of a light one.
  const hardest = isDark ? surfaces[3]! : surfaces[0]!
  const pole = isDark ? '#ffffff' : '#000000'
  const primary = lifted(p.text, hardest, want, pole)
  const muted = lifted(p.muted, hardest, 4.5, pole)
  return { 'surface-0': surfaces[0]!, 'surface-1': surfaces[1]!, 'surface-2': surfaces[2]!, 'surface-3': surfaces[3]!, 'text-primary': primary, 'text-secondary': mix(primary, muted, 0.5), 'text-muted': muted }
}

const made = new Map<string, { colors: ThemeColors; problems: string[] }>()

/**
 * The look's palette for the app, and what the helper says of its contrast.
 * The desktop app ignores a whole palette that holds one pair of text under
 * three to one, so the main text is raised, a step at a time, until the helper
 * names no such pair; tests/app-colors.test.ts holds every look to that.
 */
export function appColors(theme: Theme): { colors: ThemeColors; problems: string[] } {
  // A sports look in a team's colours is a palette of its own.
  const key = lookKey(theme)
  const hit = made.get(key)
  if (hit !== undefined) return hit
  const p = theme.palette
  // High contrast paints its diff words black on a bright ground, so its added and removed marks take the status colours instead.
  const plainDiff = theme.id === 'high-contrast'
  const code = CODE_THEME[theme.id]
  let out: { colors: ThemeColors; problems: string[] } | undefined
  for (const want of [7, 9, 11, 14, 21]) {
    const mode = { gray: { anchors: anchorsOf(theme, want) }, git: { added: plainDiff ? p.ok : theme.diff.addFg, removed: plainDiff ? p.error : theme.diff.removeFg } }
    const { theme: colors, problems } = makeColors({
      label: paletteLabel(theme),
      id: `wardrobe-${theme.id}`,
      only: theme.tone,
      roles: { accent: p.accent, danger: p.error, success: p.ok, warning: p.warn, pro: p.special },
      ...(theme.tone === 'dark' ? { dark: mode } : { light: mode }),
      ...(code === undefined ? {} : { codeTheme: { [theme.tone]: code } }),
      ...(theme.id === 'high-contrast' ? { contrast: 'more' as const } : {}),
    })
    out = { colors, problems }
    if (!problems.some(isRefusal)) break
  }
  made.set(key, out!)
  return out!
}
