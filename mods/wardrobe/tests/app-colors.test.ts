// The palette each look gives the desktop and mobile apps. The desktop app
// ignores a whole palette that holds one pair of text under three to one, and
// says nothing when it does, so every look is held here to a palette the
// helper finds no such pair in, and to words a person can read on every
// surface it paints. Pure functions: the same on every engine.

import { describe, expect, test } from 'claude-code/testing'

import { anchorsOf, appColors, isRefusal, paletteLabel } from '../hooks/app-colors'
import { contrast } from '../hooks/contrast'
import { checkColors } from '../hooks/make-colors.js'
import { THEMES, themeById } from '../hooks/themes'

describe('every look has a palette for the app', () => {
  for (const theme of THEMES) {
    test(`${theme.id}: a whole ${theme.tone} palette the desktop app will paint, its words readable on every surface`, () => {
      const { colors, problems } = appColors(theme)
      expect(problems.filter(isRefusal)).toEqual([])
      expect(checkColors(colors).filter(isRefusal)).toEqual([])

      // One mode only, the look's own; the name a settings list may show; an id of wardrobe's own.
      expect(colors.v).toBe(1)
      expect(colors.id).toBe(`wardrobe-${theme.id}`)
      expect(colors.label).toBe(paletteLabel(theme))
      expect(Object.keys(colors.inputs)).toEqual([theme.tone])
      const tokens = colors.inputs[theme.tone]!
      expect(Object.keys(tokens).length).toBeGreaterThan(90)
      for (const [name, value] of Object.entries(tokens)) expect(typeof value, name).toBe('string')

      // The page is the look's own background, or within a shade of it on a light look, whose page sits under its cards.
      const anchors = anchorsOf(theme)
      const page = theme.tone === 'dark' ? anchors['surface-0'] : anchors['surface-2']
      expect(page).toBe(theme.palette.bg)
      const surfaces = [anchors['surface-0'], anchors['surface-1'], anchors['surface-2'], anchors['surface-3']]
      for (const surface of surfaces) expect(contrast(surface, theme.palette.bg)).toBeLessThan(1.35)

      // Words first: the main text at least seven to one on every surface, the quiet text four and a half.
      for (const surface of surfaces) {
        expect(contrast(anchors['text-primary'], surface), `text on ${surface}`).toBeGreaterThanOrEqual(7)
        expect(contrast(anchors['text-muted'], surface), `quiet text on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }

      // The same palette every time: made once, kept.
      expect(appColors(theme)).toBe(appColors(theme))
    })
  }

  test('a dark look keeps its darkest surface for the page; a light look lays its last two surfaces alike, as the app asks', () => {
    for (const theme of THEMES) {
      const a = anchorsOf(theme)
      if (theme.tone === 'light') expect(a['surface-2']).toBe(a['surface-3'])
      else expect(contrast(a['surface-3'], '#ffffff')).toBeLessThanOrEqual(contrast(a['surface-0'], '#ffffff'))
    }
  })

  test('the look pairs with a code theme of the same name where a well-known one shares its colours, and high contrast asks for more', () => {
    expect(appColors(themeById('dracula')!).colors.codeTheme).toEqual({ dark: 'dracula' })
    expect(appColors(themeById('nord')!).colors.codeTheme).toEqual({ dark: 'nord' })
    expect(appColors(themeById('paper')!).colors.codeTheme).toBeUndefined()
    expect(appColors(themeById('high-contrast')!).colors.contrast).toBe('more')
    expect(appColors(themeById('dracula')!).colors.contrast).toBeUndefined()
    expect(paletteLabel({ id: 'tokyo-night' })).toBe('Tokyo night (wardrobe)')
  })
})
