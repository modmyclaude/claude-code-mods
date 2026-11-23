// The light of the hour, as pure functions: the light a clock time gives, the
// wash that light lays over each look's scene, and what the wash is held to.
// It stays at the two sides of the picture, so the chat column in the middle
// keeps the light its look gave it and the words on it their contrast; the two
// accessibility looks take none of it; a thumbnail never does. The same on
// every engine.

import { describe, expect, test } from 'claude-code/testing'

import { contrast } from '../hooks/contrast'
import { LANE, mix } from '../hooks/scene-kit'
import { glassFor, SCENE_LIMIT, sceneOf } from '../hooks/scenes'
import { DAYLIGHT, layerAt, lightAt, PAINTED, sameLight, SKY_STEP, washLayers, washOf } from '../hooks/sky'
import { THEMES, themeById } from '../hooks/themes'

/** The day and night hours as installed: 07:00 and 19:00, in minutes. */
const [DAY, NIGHT] = [7 * 60, 19 * 60]
const light = (hours: number, minutes = 0) => lightAt(hours * 60 + minutes, DAY, NIGHT)
/** Every step of a day, as installed. */
const STEPS = Array.from({ length: 1440 / SKY_STEP }, (_, i) => i * SKY_STEP)
/** Every light a day as installed passes through, each once. */
const LIGHTS = [...new Map(STEPS.map(minute => [JSON.stringify(lightAt(minute, DAY, NIGHT)), lightAt(minute, DAY, NIGHT)])).values()]

const REFUSED = /url\((?!#[a-z0-9-]+\))|href|<image|data:|@import|@font-face|CDATA|<\?|\\|&(?!(amp|lt|gt|quot|apos);)|<!--|\/\*|image-set|src\(|cross-fade|foreignObject|feImage|<script|\son[a-z]+=/i
const count = (text: string, part: string) => text.split(part).length - 1

describe('the light a clock time gives', () => {
  test('light by day, dark by night, and a dawn and a dusk between them, each with a glow that swells and fades', () => {
    expect(light(12)).toEqual(DAYLIGHT)
    expect(light(0)).toEqual({ dark: 1, dawn: 0, dusk: 0 })
    expect(light(3, 30)).toEqual({ dark: 1, dawn: 0, dusk: 0 })
    // Dawn runs from an hour and a half before the day starts to an hour after it.
    expect(light(5, 15)).toEqual({ dark: 1, dawn: 0, dusk: 0 })
    expect(light(5, 30)).toEqual({ dark: 1, dawn: 0, dusk: 0 })
    expect(light(6, 45)).toEqual({ dark: 0.5, dawn: 1, dusk: 0 })
    expect(light(8)).toEqual({ dark: 0, dawn: 0, dusk: 0 })
    expect(light(8, 15)).toEqual(DAYLIGHT)
    // Dusk the same about the hour the night starts.
    expect(light(17, 15)).toEqual(DAYLIGHT)
    expect(light(18, 45)).toEqual({ dark: 0.5, dawn: 0, dusk: 1 })
    expect(light(20)).toEqual({ dark: 1, dawn: 0, dusk: 0 })
    expect(light(20, 15)).toEqual({ dark: 1, dawn: 0, dusk: 0 })
  })

  test('it moves in steps of a quarter of an hour, never jumps, and every number is a plain one', () => {
    let before = lightAt(1425, DAY, NIGHT)
    for (const minute of STEPS) {
      const now = lightAt(minute, DAY, NIGHT)
      // The whole step is one light.
      for (const into of [1, 7, SKY_STEP - 1]) expect(lightAt(minute + into, DAY, NIGHT)).toEqual(now)
      for (const value of [now.dark, now.dawn, now.dusk]) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
        // Two decimals at most, so a light that stands still is the same light as JSON carries it.
        expect(Math.abs(value * 100 - Math.round(value * 100))).toBeLessThan(1e-9)
        expect(String(value).length).toBeLessThanOrEqual(4)
      }
      expect(Math.abs(now.dark - before.dark), `dark at ${minute}`).toBeLessThanOrEqual(0.16)
      expect(Math.abs(now.dawn - before.dawn), `dawn at ${minute}`).toBeLessThanOrEqual(0.32)
      expect(Math.abs(now.dusk - before.dusk), `dusk at ${minute}`).toBeLessThanOrEqual(0.32)
      // Dawn and dusk never glow at once.
      expect(now.dawn * now.dusk).toBe(0)
      before = now
    }
    // All day and all night it stands still: a day passes through few lights.
    expect(LIGHTS.length).toBeLessThan(24)
    expect(STEPS.filter(minute => sameLight(lightAt(minute, DAY, NIGHT), DAYLIGHT)).length).toBeGreaterThan(30)
  })

  test('the day and night hours are the settings: an early day, a day that crosses midnight, and no night at all', () => {
    expect(lightAt(4 * 60 + 45, 5 * 60, 22 * 60)).toEqual({ dark: 0.5, dawn: 1, dusk: 0 })
    expect(lightAt(21 * 60 + 45, 5 * 60, 22 * 60)).toEqual({ dark: 0.5, dawn: 0, dusk: 1 })
    // A day from 20:00 to 06:00: light at midnight, dark at noon.
    expect(lightAt(0, 20 * 60, 6 * 60)).toEqual(DAYLIGHT)
    expect(lightAt(12 * 60, 20 * 60, 6 * 60)).toEqual({ dark: 1, dawn: 0, dusk: 0 })
    expect(lightAt(19 * 60 + 45, 20 * 60, 6 * 60)).toEqual({ dark: 0.5, dawn: 1, dusk: 0 })
    // A dawn that crosses midnight.
    expect(lightAt(23 * 60 + 45, 0, 12 * 60)).toEqual({ dark: 0.5, dawn: 1, dusk: 0 })
    for (const minute of [0, 300, 720, 1200]) expect(lightAt(minute, 420, 420)).toEqual(DAYLIGHT)
  })

  test('two lights are the same by their numbers; none is only the same as none', () => {
    expect(sameLight(light(12), { dark: 0, dawn: 0, dusk: 0 })).toBe(true)
    expect(sameLight(light(12), light(0))).toBe(false)
    expect(sameLight(light(6, 45), light(18, 45))).toBe(false)
    expect(sameLight(null, null)).toBe(true)
    expect(sameLight(undefined, null)).toBe(true)
    expect(sameLight(null, light(12))).toBe(false)
    expect(sameLight(light(12), null)).toBe(false)
  })
})

describe('the wash a light lays over a scene', () => {
  test('every look is painted at an hour of its own, but the two accessibility looks, which the clock leaves alone', () => {
    const left = THEMES.map(theme => theme.id).filter(id => !Object.hasOwn(PAINTED, id))
    expect(left).toEqual(['high-contrast', 'colorblind'])
    for (const id of Object.keys(PAINTED)) expect(themeById(id), id).toBeDefined()
    for (const [id, painted] of Object.entries(PAINTED)) {
      expect(['dawn', 'day', 'dusk', 'night'], id).toContain(painted.at)
      expect(painted.reach ?? 1, id).toBeGreaterThan(0)
      expect(painted.reach ?? 1, id).toBeLessThanOrEqual(1)
    }
    // A look on a light page is moved the least: a deep shade there would cost the words their contrast.
    for (const theme of THEMES) if (theme.tone === 'light') expect(PAINTED[theme.id]!.reach, theme.id).toBeLessThanOrEqual(0.5)
    for (const id of left) for (const now of LIGHTS) expect(washOf({ id }, now), id).toBe('')
    expect(washOf({ id: 'a-look-not-yet-made' }, light(0))).toBe('')
  })

  test('at the hour a scene is painted at nothing is laid; night comes down over a day scene, day lifts a night scene, dawn and dusk glow', () => {
    const kinds = (id: string, now = light(12)) => washLayers({ id }, now).map(layer => layer.kind)
    // As painted.
    expect(washOf({ id: 'dracula' }, light(0))).toBe('')
    expect(washOf({ id: 'spring' }, light(12))).toBe('')
    expect(washOf({ id: 'rink' }, light(12))).toBe('')
    // Moved on.
    expect(kinds('dracula', light(12))).toEqual(['lift'])
    expect(kinds('spring', light(0))).toEqual(['shade'])
    expect(kinds('dracula', light(6, 45))).toEqual(['lift', 'dawn'])
    expect(kinds('dracula', light(18, 45))).toEqual(['lift', 'dusk'])
    expect(kinds('spring', light(6, 45))).toEqual(['shade', 'dawn'])
    expect(kinds('spring', light(18, 45))).toEqual(['shade', 'dusk'])
    // A scene painted at dawn or dusk has its own low sun: it is shaded and lifted, and never takes a second glow.
    for (const id of ['summer', 'autumn', 'clay', 'synthwave', 'catppuccin', 'easter']) {
      expect(kinds(id, light(0)), id).toEqual(['shade'])
      expect(kinds(id, light(12)), id).toEqual(['lift'])
      for (const now of LIGHTS) for (const kind of kinds(id, now)) expect(['shade', 'lift'], id).toContain(kind)
    }
    // Dawn is at the left and dusk at the right; shade and lift stand at both sides.
    const pools = (id: string, now: ReturnType<typeof light>, kind: string) => washLayers({ id }, now).find(layer => layer.kind === kind)!.pools
    expect(pools('dracula', light(6, 45), 'dawn').map(pool => pool.cx)).toEqual([150])
    expect(pools('dracula', light(18, 45), 'dusk').map(pool => pool.cx)).toEqual([1450])
    expect(pools('dracula', light(12), 'lift').map(pool => pool.cx)).toEqual([40, 1560])
    expect(pools('spring', light(0), 'shade').map(pool => pool.cx)).toEqual([-100, 1700])
    // A look moved less is washed less.
    const heart = (id: string, now: ReturnType<typeof light>) => washLayers({ id }, now)[0]!.stops[0][2]!
    expect(heart('paper', light(0))).toBeLessThan(heart('spring', light(0)))
    expect(heart('spring', light(0))).toBeLessThan(heart('rink', light(0)))
    expect(heart('on-call', light(12))).toBeLessThan(heart('dracula', light(12)))
  })

  test('the wash is plain markup the desktop app accepts: gradients of its own under names of its own, an ellipse for each pool, nothing drawn invisible', () => {
    for (const theme of THEMES) {
      for (const now of LIGHTS) {
        const wash = washOf(theme, now)
        const layers = washLayers(theme, now)
        if (layers.length === 0) {
          expect(wash).toBe('')
          continue
        }
        expect(REFUSED.exec(wash)?.[0], theme.id).toBeUndefined()
        expect(wash.startsWith('<defs><radialGradient id="hour-'), theme.id).toBe(true)
        expect(count(wash, '<defs>')).toBe(1)
        expect(count(wash, '</defs>')).toBe(1)
        expect(count(wash, '<radialGradient')).toBe(layers.length)
        expect(count(wash, '</radialGradient>')).toBe(layers.length)
        expect(count(wash, '<ellipse')).toBe(layers.reduce((sum, layer) => sum + layer.pools.length, 0))
        expect(wash).not.toMatch(/(?<!stop-)opacity="0"/)
        expect(wash).not.toContain('class=')
        expect(wash).not.toContain('style=')
        const ids = [...wash.matchAll(/ id="([a-z0-9-]+)"/g)].map(m => m[1]!)
        expect(new Set(ids).size).toBe(ids.length)
        for (const m of wash.matchAll(/url\(#([a-z0-9-]+)\)/g)) expect(ids).toContain(m[1]!)
        for (const layer of layers) {
          // A layer is there to be seen, never heavy, and spent at its rim.
          expect(layer.stops[0][2]!).toBeGreaterThan(0)
          expect(layer.stops[0][2]!).toBeLessThanOrEqual(0.55)
          expect(layer.stops[1][2]!).toBeLessThanOrEqual(layer.stops[0][2]!)
          expect(layer.stops[2][2]).toBe(0)
        }
      }
    }
  })

  test('every scene in every light is still one document under the limit, the scene itself untouched beneath the wash', () => {
    for (const theme of THEMES) {
      const plain = sceneOf(theme)!
      const ids = [...plain.source.matchAll(/ id="([a-z0-9-]+)"/g)].map(m => m[1]!)
      expect(ids.filter(id => id.startsWith('hour-')), theme.id).toEqual([])
      let longest = plain.source.length
      for (const now of LIGHTS) {
        const lit = sceneOf(theme, { light: now })!
        const wash = washOf(theme, now)
        expect(lit.alt).toBe(plain.alt)
        if (wash === '') expect(lit).toBe(plain)
        else expect(lit.source).toBe(`${plain.source.slice(0, -6)}${wash}</svg>`)
        longest = Math.max(longest, lit.source.length)
      }
      expect(longest, theme.id).toBeLessThan(SCENE_LIMIT)
      expect(longest - plain.source.length, theme.id).toBeLessThan(1200)
    }
  })

  test('a light asked for twice is one scene; a new light never changes the scene as painted; calm and still take the light, a thumbnail never', () => {
    const dracula = themeById('dracula')!
    const plain = sceneOf(dracula)!
    const noon = sceneOf(dracula, { light: light(12) })!
    expect(sceneOf(dracula, { light: light(12) })).toBe(noon)
    expect(sceneOf(dracula, { light: { dark: 0, dawn: 0, dusk: 0 } })).toBe(noon)
    const dawn = sceneOf(dracula, { light: light(6, 45) })!
    expect(dawn.source).not.toBe(noon.source)
    expect(dawn.source).toContain('hour-dawn')
    expect(noon.source).not.toContain('hour-dawn')
    expect(sceneOf(dracula)).toBe(plain)
    expect(sceneOf(dracula, { light: null })).toBe(plain)
    expect(plain.source).not.toContain('hour-')
    for (const motion of ['calm', 'still'] as const) {
      const moved = sceneOf(dracula, { motion, light: light(12) })!
      expect(moved.source).toBe(`${sceneOf(dracula, { motion })!.source.slice(0, -6)}${washOf(dracula, light(12))}</svg>`)
      expect(sceneOf(dracula, { motion })!.source).not.toContain('hour-')
    }
    // Still is still: the light adds nothing that moves.
    expect(sceneOf(dracula, { motion: 'still', light: light(6, 45) })!.source).not.toContain('animation')
    expect(sceneOf(dracula, { thumb: true, light: light(12) })).toBe(sceneOf(dracula, { thumb: true }))
  })
})

describe('the words over a scene keep their contrast in every light', () => {
  /** A colour with a layer of another laid over it. */
  const under = (ground: string, layers: ReturnType<typeof washLayers>, x: number, y: number) =>
    layers.reduce((colour, layer) => {
      const at = layerAt(layer, x, y)
      return mix(colour, at.colour, at.alpha)
    }, ground)

  test('the middle of the chat column takes none of the wash at all', () => {
    for (const theme of THEMES) {
      for (const now of LIGHTS) {
        for (const layer of washLayers(theme, now)) {
          for (let x = 680; x <= 920; x += 40) for (let y = 0; y <= 900; y += 100) expect(layerAt(layer, x, y).alpha, `${theme.id} ${layer.kind} at ${x},${y}`).toBe(0)
        }
      }
    }
  })

  test('at its edges, under the glass, the words and the quiet words lose at most a sixth of their contrast and stay readable', () => {
    for (const theme of THEMES) {
      const glass = glassFor(theme)
      const { bg, text, muted } = theme.palette
      // The column as the look paints it: the ground under the glass, which is tinted with the ground.
      const panel = (scene: string) => mix(scene, glass.tint ?? bg, glass.opacity ?? 0.5)
      const [plainText, plainMuted] = [contrast(text, panel(bg)), contrast(muted, panel(bg))]
      let worst = { text: plainText, muted: plainMuted }
      for (const now of LIGHTS) {
        const layers = washLayers(theme, now)
        for (let x = LANE.from; x <= LANE.to; x += 40) {
          for (let y = 0; y <= 900; y += 50) {
            const over = panel(under(bg, layers, x, y))
            worst = { text: Math.min(worst.text, contrast(text, over)), muted: Math.min(worst.muted, contrast(muted, over)) }
          }
        }
      }
      expect(worst.text / plainText, `${theme.id} text`).toBeGreaterThan(5 / 6)
      expect(worst.muted / plainMuted, `${theme.id} muted`).toBeGreaterThan(5 / 6)
      expect(worst.text, `${theme.id} text`).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('the strength of a pool: whole at its heart, less at its body, nothing at its rim and past it', () => {
    const [shade] = washLayers({ id: 'spring' }, light(0))
    const pool = shade!.pools[0]!
    const core = shade!.stops[0][2]!
    expect(layerAt(shade!, pool.cx, pool.cy).alpha).toBe(core)
    expect(Math.abs(layerAt(shade!, pool.cx + pool.rx * 0.5, pool.cy).alpha - core)).toBeLessThan(1e-9)
    expect(Math.abs(layerAt(shade!, pool.cx + pool.rx * 0.75, pool.cy).alpha - core / 2)).toBeLessThan(1e-9)
    expect(layerAt(shade!, pool.cx + pool.rx, pool.cy).alpha).toBe(0)
    expect(layerAt(shade!, 800, 450).alpha).toBe(0)
    // The other side is its mirror.
    expect(Math.abs(layerAt(shade!, 1600 - (pool.cx + pool.rx * 0.75), pool.cy).alpha - core / 2)).toBeLessThan(1e-9)
  })
})
