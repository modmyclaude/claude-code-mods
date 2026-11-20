// Every wallpaper scene, held to what the desktop app accepts in a backdrop
// and to what a finished picture needs: pure vector, under the size limit,
// its CSS plain, every moving part resting where its markup puts it, Bolt in
// the look's costume in it. Pure functions: the same on every engine.

import { describe, expect, test } from 'claude-code/testing'

import { costumeOf, dressedPixels } from '../hooks/costume'
import { glassFor, hasScene, SCENE_LIMIT, sceneOf, sceneSize } from '../hooks/scenes'
import { THEMES } from '../hooks/themes'

// What the engine refuses in a backdrop's Svg, in one breath: pictures, fonts,
// fetches, scripts' hiding places, and comments (plain ones are allowed, but
// no scene needs one, so none has one).
const REFUSED = /url\(|href|<image|data:|@import|@font-face|CDATA|<\?|\\|&(?!(amp|lt|gt|quot|apos);)|<!--|\/\*|image-set|src\(|cross-fade|foreignObject|feImage|<script|on[a-z]+=/i
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/
const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"><style>'

const count = (text: string, part: string) => text.split(part).length - 1

describe('every look has a scene', () => {
  for (const theme of THEMES) {
    test(`${theme.id}: one pure-vector picture under the limit, its CSS plain, its parts at rest in view, Bolt in costume at the right`, () => {
      expect(hasScene(theme)).toBe(true)
      const scene = sceneOf(theme)!
      const { source, alt } = scene

      // The document: one svg, the style first, the ground second, nothing the engine refuses.
      expect(source.startsWith(HEAD)).toBe(true)
      expect(source.endsWith('</svg>')).toBe(true)
      expect(source.length).toBeGreaterThan(1500)
      expect(source.length).toBeLessThan(SCENE_LIMIT)
      expect(sceneSize(theme)).toBe(source.length)
      expect(REFUSED.test(source)).toBe(false)
      expect(CONTROL.test(source)).toBe(false)
      expect(count(source, '<style>')).toBe(1)
      expect(count(source, '</style>')).toBe(1)
      for (const tag of ['g', 'svg']) expect(count(source, `<${tag}`), tag).toBe(count(source, `</${tag}>`))
      expect(source).toContain(`<rect width="1600" height="900" fill="${theme.palette.bg}"/>`)

      // The CSS: no element inside the style block, and every animation named is defined.
      const style = source.slice(source.indexOf('<style>') + 7, source.indexOf('</style>'))
      expect(style).not.toContain('<')
      const defined = new Set([...style.matchAll(/@keyframes ([a-z-]+)/g)].map(m => m[1]))
      const named = [...style.matchAll(/animation(?:-name)?:([a-z-]+)/g)].map(m => m[1]!)
      expect(named.length).toBeGreaterThan(0)
      for (const name of named) expect(defined.has(name), `${name} is animated but not defined`).toBe(true)
      // Nothing flashes: no animation shorter than a second.
      for (const m of style.matchAll(/animation:[a-z-]+ ([0-9.]+)s/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(1)

      // At rest (reduced motion takes the animation out): nothing is drawn invisible.
      expect(source).not.toMatch(/opacity="0"/)
      expect(style).not.toMatch(/opacity:0[;}]/)

      // Bolt, in the look's costume, breathing light: one rect per pixel, a costume colour among them where the look has one.
      expect(source).toContain('class="bolt"')
      expect(source).toContain('class="light"')
      const { grid } = dressedPixels(theme, 'small', 'idle')
      const pixels = grid.flat().filter(fill => fill !== undefined).length
      const bolt = source.slice(source.indexOf('<g class="bolt">'))
      expect(count(bolt, '<rect')).toBe(pixels)
      const costume = costumeOf(theme)
      if (costume && costume.small.length > 0) {
        const paints = Object.values(costume.paint).map(role => (role === 'bg' ? theme.palette.bg : theme.palette[role]))
        expect(paints.some(colour => bolt.includes(`fill="${colour}"`))).toBe(true)
      }

      // The words for a reader who cannot see it.
      expect(alt).toMatch(/\.$/)
      expect(alt).toContain(theme.id)

      // The same scene every time: nothing random.
      expect(sceneOf(theme)!.source).toBe(source)
    })
  }

  test('the glass over a scene is within the engine bounds, tinted with the look, heavier for the accessibility looks', () => {
    for (const theme of THEMES) {
      const glass = glassFor(theme)
      expect(glass.blur).toBeGreaterThanOrEqual(0)
      expect(glass.blur).toBeLessThanOrEqual(64)
      expect(glass.opacity).toBeGreaterThan(0)
      expect(glass.opacity).toBeLessThanOrEqual(1)
      expect(glass.tint).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(glassFor(THEMES.find(t => t.id === 'high-contrast')!).opacity).toBeGreaterThan(0.8)
    expect(glassFor(THEMES.find(t => t.id === 'colorblind')!).opacity).toBeGreaterThan(0.7)
    expect(glassFor(THEMES.find(t => t.id === 'dracula')!).tint).toBe('#282a36')
  })
})
