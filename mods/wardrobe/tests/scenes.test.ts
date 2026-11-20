// Every wallpaper scene, held to what the desktop app accepts in a backdrop
// and to what a finished picture needs: pure vector, under the size limit,
// its CSS plain, its paints its own, every moving part resting where its
// markup puts it, depth in three layers, Bolt in the look's costume in it.
// And its gallery thumbnail: the same picture, lighter and still.
// Pure functions: the same on every engine.

import { describe, expect, test } from 'claude-code/testing'

import { costumeOf, dressedPixels } from '../hooks/costume'
import { glassFor, hasScene, SCENE_LIMIT, sceneOf, sceneSize } from '../hooks/scenes'
import { THEMES } from '../hooks/themes'

// What the engine refuses in a backdrop's Svg, in one breath: pictures, fonts,
// fetches, links, scripts' hiding places, and comments (plain ones are
// allowed, but no scene needs one, so none has one). A `url()` is refused
// unless it names a paint of the document's own, which is held separately.
const REFUSED = /url\((?!#[a-z0-9-]+\))|href|<image|data:|@import|@font-face|CDATA|<\?|\\|&(?!(amp|lt|gt|quot|apos);)|<!--|\/\*|image-set|src\(|cross-fade|foreignObject|feImage|<script|\son[a-z]+=/i
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/
const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"><style>'

/** The scenes with no depth to sway, by design: a sheet of paper, an orrery seen from above, and high contrast, whose shapes keep their places. */
const FLAT = new Set(['paper', 'solarized', 'high-contrast'])

const count = (text: string, part: string) => text.split(part).length - 1
const styleOf = (source: string) => source.slice(source.indexOf('<style>') + 7, source.indexOf('</style>'))

/** What every picture is held to, a scene and its thumbnail alike. */
function heldAsADocument(source: string, ground: string): void {
  expect(source.startsWith(HEAD)).toBe(true)
  expect(source.endsWith('</svg>')).toBe(true)
  expect(source.length).toBeLessThan(SCENE_LIMIT)
  expect(REFUSED.exec(source)?.[0]).toBeUndefined()
  expect(CONTROL.test(source)).toBe(false)
  expect(count(source, '<style>')).toBe(1)
  expect(count(source, '</style>')).toBe(1)
  for (const tag of ['g', 'svg', 'defs', 'linearGradient', 'radialGradient', 'pattern']) expect(count(source, `<${tag}`), tag).toBe(count(source, `</${tag}>`))
  expect(source).toContain(`<rect width="1600" height="900" fill="${ground}"/>`)
  expect(styleOf(source)).not.toContain('<')
  // Every paint named is one the document defines, once.
  const ids = [...source.matchAll(/ id="([a-z0-9-]+)"/g)].map(m => m[1]!)
  expect(new Set(ids).size, 'an id is defined twice').toBe(ids.length)
  for (const m of source.matchAll(/url\(#([a-z0-9-]+)\)/g)) expect(ids.includes(m[1]!), `${m[1]} is painted with but not defined`).toBe(true)
  // At rest (reduced motion takes the animation out): nothing is drawn invisible. A gradient may fade to nothing.
  expect(source).not.toMatch(/(?<!stop-)opacity="0"/)
  expect(styleOf(source)).not.toMatch(/opacity:0[;}]/)
}

describe('every look has a scene', () => {
  for (const theme of THEMES) {
    test(`${theme.id}: one pure-vector picture under the limit, its CSS plain, its parts at rest in view, Bolt in costume at the right`, () => {
      expect(hasScene(theme)).toBe(true)
      const scene = sceneOf(theme)!
      const { source, alt } = scene

      heldAsADocument(source, theme.palette.bg)
      expect(source.length).toBeGreaterThan(5000)
      expect(sceneSize(theme)).toBe(source.length)

      // The CSS: every animation named is defined, and nothing flashes: none runs shorter than a second.
      const style = styleOf(source)
      const defined = new Set([...style.matchAll(/@keyframes ([a-z0-9-]+)/g)].map(m => m[1]))
      const named = [...style.matchAll(/animation(?:-name)?:([a-z0-9-]+)/g)].map(m => m[1]!)
      expect(named.length).toBeGreaterThan(0)
      for (const name of named) expect(defined.has(name), `${name} is animated but not defined`).toBe(true)
      for (const m of style.matchAll(/animation:[a-z0-9-]+ ([0-9.]+)s/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(1)
      for (const m of source.matchAll(/animation-duration:([0-9.]+)s/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(1)

      // Depth: a far, a middle and a near layer, each swaying a little more than the one behind it.
      for (const depth of ['p-far', 'p-mid', 'p-near']) {
        if (FLAT.has(theme.id)) expect(source, depth).not.toContain(`class="${depth}"`)
        else {
          expect(source, depth).toContain(`class="${depth}"`)
          expect(style, depth).toContain(`@keyframes ${depth}{`)
        }
      }

      // Bolt, in the look's costume, breathing light: one rect per pixel, a costume colour among them where the look has one.
      expect(count(source, 'class="bolt"')).toBe(1)
      expect(source).toContain('class="light"')
      const { grid } = dressedPixels(theme, 'small', 'idle')
      const pixels = grid.flat().filter(fill => fill !== undefined).length
      const from = source.indexOf('<g class="bolt">')
      const bolt = source.slice(from, source.indexOf('</g>', from))
      expect(count(bolt, '<rect')).toBe(pixels)
      const costume = costumeOf(theme)
      if (costume && costume.small.length > 0) {
        const paints = Object.values(costume.paint).map(role => (role === 'bg' ? theme.palette.bg : theme.palette[role]))
        expect(paints.some(colour => bolt.includes(`fill="${colour}"`))).toBe(true)
      }
      // Bolt stands at the right, off the middle and the foot, where the words and the message box sit.
      const place = /\.bolt\{transform:translate\((\d+)px,(\d+)px\) scale\(12\)/.exec(style)
      expect(place).not.toBeNull()
      expect(Number(place![1])).toBeGreaterThan(1100)
      expect(Number(place![1])).toBeLessThan(1400)
      expect(Number(place![2])).toBeLessThan(720)

      // The words for a reader who cannot see it.
      expect(alt).toMatch(/\.$/)
      expect(alt).toContain(theme.id)

      // The same scene every time: nothing random.
      expect(sceneOf(theme)!.source).toBe(source)
    })

    test(`${theme.id}: its gallery thumbnail is the same picture, lighter, with nothing moving`, () => {
      const scene = sceneOf(theme)!
      const thumb = sceneOf(theme, { thumb: true })!
      heldAsADocument(thumb.source, theme.palette.bg)
      expect(thumb.alt).toBe(scene.alt)
      expect(thumb.source.length).toBeLessThan(scene.source.length)
      expect(thumb.source.length).toBeLessThan(40_000)
      // Still: its CSS keeps where things stand (Bolt, and whatever a rule places) and nothing that moves them.
      const style = styleOf(thumb.source)
      expect(style).toMatch(/\.bolt\{transform:translate\(\d+px,\d+px\) scale\(12\)\}/)
      expect(thumb.source).not.toContain('animation')
      expect(thumb.source).not.toContain('@keyframes')
      expect(style).not.toContain('{}')
      expect(count(thumb.source, 'class="bolt"')).toBe(1)
      // Every place the moving scene's rules give a thing, the still one gives too.
      const places = (css: string) => [...css.replace(/@keyframes [a-z0-9-]+\{(?:[^{}]*\{[^{}]*\})*\}/g, '').matchAll(/(\.[a-z0-9-]+)\{[^}]*?(transform:[^;}]+)/g)].map(m => `${m[1]} ${m[2]}`)
      expect(places(style)).toEqual(places(styleOf(scene.source)))
      // And no class is left that no rule speaks for.
      const ruled = new Set([...style.matchAll(/\.([a-z0-9-]+)\{/g)].map(m => m[1]))
      for (const m of thumb.source.matchAll(/ class="([^"]*)"/g)) expect(ruled.has(m[1]!), m[1]).toBe(true)
      // Asking for one never changes the other.
      expect(sceneOf(theme)!.source).toBe(scene.source)
    })
  }

  test('the fourteen thumbnails together stay light enough for one gallery', () => {
    const total = THEMES.reduce((sum, theme) => sum + sceneOf(theme, { thumb: true })!.source.length, 0)
    expect(total).toBeLessThan(320_000)
  })

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
