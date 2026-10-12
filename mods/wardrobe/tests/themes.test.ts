import { describe, expect, test } from 'claude-code/testing'

import { contrast, hue, luminance, rgbOf } from '../hooks/contrast'
import { KINDS, ROLES, STATUSES, THEMES, kindOf, themeById } from '../hooks/themes'

describe('contrast()', () => {
  // Known WCAG values: black on white is 21:1, #767676 is the lightest grey
  // that passes AA (4.5:1) on white and #777777 the darkest that fails.
  const cases: [string, string, number][] = [
    ['#000000', '#ffffff', 21],
    ['#ffffff', '#000000', 21],
    ['#123456', '#123456', 1],
    ['#767676', '#ffffff', 4.54],
    ['#777777', '#ffffff', 4.48],
    ['#ff0000', '#ffffff', 4.0],
    ['#0000ff', '#ffffff', 8.59],
    ['#fff', '#000', 21],
  ]
  for (const [a, b, ratio] of cases) {
    test(`${a} on ${b} is ${ratio}:1`, () => {
      expect(Math.round(contrast(a, b) * 100) / 100).toBe(ratio)
    })
  }

  test('luminance runs from 0 (black) to 1 (white)', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBe(1)
  })

  test('only hex colours are read', () => {
    expect(rgbOf('#0a0b0c')).toEqual([10, 11, 12])
    expect(rgbOf('red')).toBeUndefined()
    expect(rgbOf('#12345')).toBeUndefined()
    expect(() => contrast('red', '#000000')).toThrow('not a hex colour')
  })

  const hues: [string, number][] = [
    ['#ff0000', 0],
    ['#00ff00', 120],
    ['#0000ff', 240],
    ['#ff8000', 30],
    ['#808080', 0],
  ]
  for (const [hex, degrees] of hues) {
    test(`hue of ${hex} is ${degrees}`, () => {
      expect(Math.round(hue(hex))).toBe(degrees)
    })
  }
})

describe('the themes', () => {
  test('are exactly the ones the prompt names, the seasonal packs included', () => {
    expect(THEMES.map(theme => theme.id).sort()).toEqual(
      ['catppuccin', 'colorblind', 'dracula', 'high-contrast', 'noir', 'nord', 'paper', 'solarized', 'tokyo-night', 'halloween', 'christmas', 'spring', 'summer', 'autumn'].sort(),
    )
    expect(themeById('paper')?.tone).toBe('light')
    expect(themeById('spring')?.tone).toBe('light')
    expect(themeById('default')).toBeUndefined()
  })

  test('every mark and every icon is one single-width BMP character: no emoji, no variation selector', () => {
    for (const theme of THEMES) {
      for (const glyph of [theme.mark, ...Object.values(theme.icons), ...Object.values(theme.status)]) {
        const points = [...glyph].map(c => c.codePointAt(0) ?? 0)
        expect(points, `${theme.id} ${glyph}`).toHaveLength(1)
        const point = points[0] ?? 0
        expect(point, `${theme.id} ${glyph}`).toBeLessThan(0x10000)
        expect(point === 0xfe0f || point === 0xfe0e, `${theme.id} ${glyph}`).toBe(false)
        // Nothing from the blocks a terminal may draw double width: East Asian wide ranges, the block elements.
        expect(point >= 0x1100 && point <= 0x115f, `${theme.id} ${glyph}`).toBe(false)
        expect(point >= 0x2e80 && point <= 0xa4cf, `${theme.id} ${glyph}`).toBe(false)
        expect(point >= 0xac00 && point <= 0xd7a3, `${theme.id} ${glyph}`).toBe(false)
        expect(point >= 0xf900 && point <= 0xfaff, `${theme.id} ${glyph}`).toBe(false)
        expect(point >= 0xfe30 && point <= 0xfe4f, `${theme.id} ${glyph}`).toBe(false)
        expect(point >= 0xff00 && point <= 0xff60, `${theme.id} ${glyph}`).toBe(false)
        expect(point >= 0x2580 && point <= 0x259f, `${theme.id} ${glyph}`).toBe(false)
      }
    }
  })

  // The bar each theme is held to: WCAG AAA (7:1) for high-contrast, AA
  // (4.5:1) for every other. Every colour wardrobe paints sits on the theme's
  // own background, so these pairs are the pairs on screen.
  const MIN: Record<string, number> = { 'high-contrast': 7 }

  for (const theme of THEMES) {
    const min = MIN[theme.id] ?? 4.5

    test(`${theme.id}: added diff lines meet ${min}:1`, () => {
      expect(contrast(theme.diff.addFg, theme.diff.addBg)).toBeGreaterThanOrEqual(min)
    })

    test(`${theme.id}: removed diff lines meet ${min}:1`, () => {
      expect(contrast(theme.diff.removeFg, theme.diff.removeBg)).toBeGreaterThanOrEqual(min)
    })

    for (const role of ROLES) {
      test(`${theme.id}: ${role} text meets ${min}:1`, () => {
        expect(contrast(theme.palette[role], theme.palette.bg)).toBeGreaterThanOrEqual(min)
      })
    }

    test(`${theme.id}: every tool kind has its own icon, so colour is never the only cue`, () => {
      const icons = KINDS.map(kind => theme.icons[kind])
      expect(new Set(icons).size).toBe(KINDS.length)
      for (const icon of icons) expect([...icon].length).toBe(1)
    })

    test(`${theme.id}: every status has its own glyph`, () => {
      expect(new Set(STATUSES.map(status => theme.status[status])).size).toBe(STATUSES.length)
    })
  }

  test('colorblind diffs are blue (added) and orange (removed), never red or green', () => {
    const { diff } = themeById('colorblind')!
    for (const blue of [diff.addFg, diff.addBg]) {
      expect(hue(blue)).toBeGreaterThanOrEqual(190)
      expect(hue(blue)).toBeLessThanOrEqual(240)
    }
    for (const orange of [diff.removeFg, diff.removeBg]) {
      expect(hue(orange)).toBeGreaterThanOrEqual(20)
      expect(hue(orange)).toBeLessThanOrEqual(45)
    }
  })

  test('colorblind icons differ by shape, not only by colour', () => {
    // One shape family per glyph: no two kinds share a silhouette.
    const SHAPE: Record<string, string> = {
      '▸': 'triangle pointing right',
      '●': 'solid disc',
      '◆': 'diamond',
      '■': 'square',
      '▲': 'triangle pointing up',
      '✚': 'upright cross',
      '▼': 'triangle pointing down',
      '≡': 'three bars',
      '⊕': 'ring with a cross',
      '∴': 'three dots',
    }
    const { icons } = themeById('colorblind')!
    const shapes = KINDS.map(kind => SHAPE[icons[kind]])
    expect(shapes.includes(undefined as never)).toBe(false)
    expect(new Set(shapes).size).toBe(KINDS.length)
  })
})

describe('kindOf()', () => {
  const cases: [string, string][] = [
    ['Bash', 'shell'],
    ['Read', 'read'],
    ['Edit', 'edit'],
    ['Write', 'write'],
    ['Grep', 'search'],
    ['WebFetch', 'web'],
    ['Agent', 'agent'],
    ['TodoWrite', 'todo'],
    ['mcp__github__create_issue', 'mcp'],
    ['SomethingNew', 'other'],
  ]
  for (const [tool, kind] of cases) {
    test(`${tool} is ${kind}`, () => {
      expect(kindOf(tool)).toBe(kind)
    })
  }
})
