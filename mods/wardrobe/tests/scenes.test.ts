// Every wallpaper scene, held to what the desktop app accepts in a backdrop
// and to what a finished picture needs: pure vector, under the size limit,
// its CSS plain, its paints its own, every moving part resting where its
// markup puts it, depth in three layers, Bolt in the look's costume in it.
// And its gallery thumbnail: the same picture, lighter and still.
// Pure functions: the same on every engine.

import { describe, expect, test } from 'claude-code/testing'

import { costumeOf, dressedPixels } from '../hooks/costume'
import { WINGS } from '../hooks/scene-kit'
import { glassFor, hasScene, SCENE_LIMIT, sceneOf, sceneSize } from '../hooks/scenes'
import { wornTheme } from '../hooks/tailor'
import { FAMILIES, SPORTS, THEMES, themeById } from '../hooks/themes'

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
      // Bolt stands whole in the right wing, clear of the chat column's frost even as the near layer sways, and off the
      // foot, where the message box sits.
      const place = /\.bolt\{transform:translate\((\d+)px,(\d+)px\) scale\(12\)/.exec(style)
      expect(place).not.toBeNull()
      expect(Number(place![1]) - 28).toBeGreaterThanOrEqual(WINGS.right.from)
      expect(Number(place![1]) + 120).toBeLessThanOrEqual(WINGS.right.to)
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

  test('the thumbnails of any one family, all the gallery draws at a time, stay light', () => {
    for (const family of FAMILIES) {
      const total = family.ids.reduce((sum, id) => sum + sceneOf(themeById(id)!, { thumb: true })!.source.length, 0)
      expect(total, family.name).toBeLessThan(200_000)
    }
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

  test('the glass setting moves it a step either way; the accessibility looks never go lighter', () => {
    const dracula = themeById('dracula')!
    expect(glassFor(dracula, 'default')).toEqual(glassFor(dracula))
    expect(glassFor(dracula, 'light')).toEqual({ blur: 8, tint: '#282a36', opacity: 0.4 })
    expect(glassFor(dracula, 'heavy')).toEqual({ blur: 24, tint: '#282a36', opacity: 0.76 })
    for (const theme of THEMES) {
      const [light, plain, heavy] = [glassFor(theme, 'light'), glassFor(theme), glassFor(theme, 'heavy')]
      expect(light.opacity, theme.id).toBeLessThanOrEqual(plain.opacity ?? 0)
      expect(heavy.opacity, theme.id).toBeGreaterThan(plain.opacity ?? 1)
      for (const glass of [light, heavy]) {
        expect(glass.blur).toBeGreaterThanOrEqual(0)
        expect(glass.blur).toBeLessThanOrEqual(64)
        expect(glass.opacity).toBeGreaterThan(0.3)
        expect(glass.opacity).toBeLessThanOrEqual(1)
        expect(glass.tint).toBe(plain.tint)
      }
    }
    for (const id of ['high-contrast', 'colorblind']) expect(glassFor(themeById(id)!, 'light'), id).toEqual(glassFor(themeById(id)!))
  })
})

describe('how much a scene moves', () => {
  /** Every animation time a document names, in seconds: the CSS shorthand and the inline durations. */
  const times = (source: string) => [...source.matchAll(/animation:[a-z0-9-]+ ([0-9.]+)s/g), ...source.matchAll(/animation-duration:([0-9.]+)s/g)].map(m => Number(m[1]))

  for (const theme of THEMES) {
    test(`${theme.id}: calm is the same picture with fewer small things at half the speed; still is the whole picture at rest`, () => {
      const full = sceneOf(theme)!
      const calm = sceneOf(theme, { motion: 'calm' })!
      const still = sceneOf(theme, { motion: 'still' })!
      expect(sceneOf(theme, { motion: 'full' })).toBe(full)
      for (const scene of [calm, still]) {
        heldAsADocument(scene.source, theme.palette.bg)
        expect(scene.alt).toBe(full.alt)
        expect(count(scene.source, 'class="bolt"')).toBe(1)
      }
      // Calm: nothing new moves, nothing runs under two seconds, and every rule's animation takes twice as long.
      expect(times(full.source).length).toBeGreaterThan(0)
      expect(Math.min(...times(calm.source))).toBeGreaterThanOrEqual(2)
      const paced = (source: string) => [...styleOf(source).matchAll(/animation:([a-z0-9-]+) ([0-9.]+)s/g)].map(m => [m[1]!, Number(m[2])] as const)
      const [quick, slow] = [paced(full.source), paced(calm.source)]
      expect(slow.map(([name]) => name)).toEqual(quick.map(([name]) => name))
      slow.forEach(([name, seconds], i) => expect(seconds, name).toBe(Math.round(quick[i]![1] * 2 * 10) / 10))
      expect(count(calm.source, '<')).toBeLessThanOrEqual(count(full.source, '<'))
      expect(count(calm.source, '@keyframes')).toBe(count(full.source, '@keyframes'))
      // Its lines are as fine as the wallpaper's: only what drifts is thinned.
      expect(calm.source.length).toBeGreaterThan(sceneOf(theme, { thumb: true })!.source.length)
      // Still: every part of the picture, and nothing that moves one.
      expect(still.source).not.toContain('animation')
      expect(still.source).not.toContain('@keyframes')
      expect(count(still.source, '<')).toBe(count(full.source, '<') - count(styleOf(full.source), '<'))
      expect(styleOf(still.source)).toMatch(/\.bolt\{transform:translate\(\d+px,\d+px\) scale\(12\)\}/)
      // Asking for one never changes another.
      expect(sceneOf(theme)).toBe(full)
      expect(sceneOf(theme, { motion: 'calm' })).toBe(calm)
    })
  }
})

describe('calm thins what drifts and nothing else', () => {
  /** The silhouettes a scene draws edge to edge: its ridges and its skylines, each one long path from the left bleed. */
  const lines = (source: string) => [...source.matchAll(/ d="(M-80 900[LV][^"]*)"/g)].map(m => m[1]!)

  for (const id of ['dracula', 'nord', 'tokyo-night', 'noir']) {
    test(`${id}: its ridges and skylines are the wallpaper's own, point for point; only a thumbnail draws them coarser`, () => {
      const theme = themeById(id)!
      const full = lines(sceneOf(theme)!.source)
      expect(full.length).toBeGreaterThan(1)
      expect(lines(sceneOf(theme, { motion: 'calm' })!.source)).toEqual(full)
      expect(lines(sceneOf(theme, { motion: 'still' })!.source)).toEqual(full)
      // A ridge is drawn with fewer points in a thumbnail; a skyline is the same blocks at any size.
      const thumb = lines(sceneOf(theme, { thumb: true })!.source)
      if (id === 'dracula' || id === 'nord') expect(thumb.join('').length).toBeLessThan(full.join('').length)
      else expect(thumb).toEqual(full)
    })
  }
})

describe('a sports look in a team colours has a picture of its own', () => {
  const TEAM = { teamPrimary: '#14306b', teamSecondary: '#f2b824' }
  for (const id of SPORTS) {
    test(`${id}: the same picture in other paint, held to the same rules, thumbnail and all`, () => {
      const stock = themeById(id)!
      const worn = wornTheme(id, TEAM)!
      const [own, team] = [sceneOf(stock)!, sceneOf(worn)!]
      heldAsADocument(team.source, worn.palette.bg)
      expect(team.source).not.toBe(own.source)
      expect(team.alt).toBe(own.alt)
      expect(count(team.source, '<')).toBe(count(own.source, '<'))
      // The colours as given paint it: mixed toward the look, so neither is there raw, and the look's own accent no longer leads.
      expect(count(team.source, stock.palette.accent)).toBeLessThan(count(own.source, stock.palette.accent))
      const thumb = sceneOf(worn, { thumb: true })!
      heldAsADocument(thumb.source, worn.palette.bg)
      expect(thumb.source).not.toBe(sceneOf(stock, { thumb: true })!.source)
      expect(thumb.source).not.toContain('animation')
      // Asking for the team's never changes the look's own, nor the other way round.
      expect(sceneOf(stock)).toBe(own)
      expect(sceneOf(worn)).toBe(team)
    })
  }
})
