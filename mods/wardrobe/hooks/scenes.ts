// Wallpapers: one animated scene behind the chat for each look, drawn by the
// desktop app from one SVG document, with Bolt in the look's costume in it.
// Nothing here draws by itself: register.tsx sets the backdrop with
// `$.theme.set` and answers the `Backdrop` render with the scene of the look
// that is worn.

import type { ThemeBackdropGlass } from 'claude-code'

import { dressedPixels } from './costume'
import type { Glass, Motion } from './look'
import { BOLT_HERE, group, rect, svg, withDetail } from './scene-kit'
import type { Scene } from './scene-kit'
import { HOLIDAY_SCENES } from './scenes-holiday'
import { LOOK_SCENES } from './scenes-looks'
import { SEASON_SCENES } from './scenes-seasons'
import { SPORT_SCENES } from './scenes-sport'
import { TECH_SCENES } from './scenes-tech'
import { lookKey } from './tailor'
import type { Theme } from './themes'

export type { Scene }
export type SceneOf = (theme: Theme) => Scene

/** The engine's ceiling for one Svg document. */
export const SCENE_LIMIT = 131_072

const SCENES: Record<string, SceneOf> = { ...LOOK_SCENES, ...TECH_SCENES, ...SPORT_SCENES, ...SEASON_SCENES, ...HOLIDAY_SCENES }

/** Whether a look has a scene (every shipped look does; a theme added without one draws nothing). */
export function hasScene(theme: Pick<Theme, 'id'>): boolean {
  return Object.hasOwn(SCENES, theme.id)
}

const drawn = new Map<string, { source: string; alt: string }>()

/** Declarations with the motion taken out: what places a thing stays, what moves it goes. */
const atRest = (css: string): string[] => css.split(';').filter(rule => rule !== '' && !rule.startsWith('animation'))

/**
 * A scene's CSS as a still picture needs it: no keyframes and no animation,
 * and every place a rule gives a thing (a planet on its orbit, the paper
 * plane) kept, so the picture rests exactly as reduced motion shows it.
 */
function stillStyle(style: string): string {
  let out = ''
  let i = 0
  while (i < style.length) {
    if (style[i] === '@') {
      // Keyframes (and any other at-rule) hold blocks inside a block: skipped whole, by counting braces.
      let depth = 0
      do {
        if (style[i] === '{') depth += 1
        if (style[i] === '}') depth -= 1
        i += 1
      } while (i < style.length && !(depth === 0 && style[i - 1] === '}'))
      continue
    }
    const open = style.indexOf('{', i)
    const end = style.indexOf('}', i)
    if (open === -1 || end === -1) break
    const kept = atRest(style.slice(open + 1, end))
    if (kept.length > 0) out += `${style.slice(i, open)}{${kept.join(';')}}`
    i = end + 1
  }
  return out
}

/** A scene's body for a still picture: no timing left in a `style`, and no class the still CSS has no rule for. */
function stillBody(body: string, style: string): string {
  const ruled = new Set([...style.matchAll(/\.([a-z0-9-]+)\{/g)].map(m => m[1]))
  return body
    .replace(/ style="([^"]*)"/g, (_whole, css: string) => {
      const kept = atRest(css)
      return kept.length === 0 ? '' : ` style="${kept.join(';')}"`
    })
    .replace(/ class="([^"]*)"/g, (whole, name: string) => (ruled.has(name) ? whole : ''))
}

/** How much of a scene's small things a gallery thumbnail keeps. */
const THUMB_DETAIL = 0.25
/** How much of what drifts calm motion keeps, and how many times slower everything moves. */
const CALM_DETAIL = 0.5
const CALM_SLOWER = 2

/** A scene's CSS or body with every animation time made `k` times longer: durations, and the delays that spread things along a loop. */
function slowed(text: string, k: number): string {
  return text.replace(/animation(?:-duration|-delay)?:[^;}"]*/g, declaration => declaration.replace(/(?<=[\s:])(-?\d+(?:\.\d+)?)s\b/g, (_whole, seconds: string) => `${Math.round(Number(seconds) * k * 10) / 10}s`))
}

/** Where Bolt stands when a scene names no place: at the right, off the middle and the foot, where the words and the message box sit. */
const BOLT_AT = { x: 1240, y: 560 }
/** One Bolt pixel, in the scene's units. */
const BOLT_SCALE = 12

/**
 * Bolt in the look's costume, small, where the scene stands it: one rect per
 * pixel, bobbing a little, the antenna light breathing.
 */
export function boltInScene(theme: Theme, at: { x: number; y: number } = BOLT_AT): { style: string; body: string } {
  const { grid } = dressedPixels(theme, 'small', 'idle')
  let body = ''
  grid.forEach((row, y) =>
    row.forEach((fill, x) => {
      if (fill === undefined) return
      const isLight = y === 0 && (x === 4 || x === 5)
      body += rect(x, y, 1, 1, fill, isLight ? { class: 'light' } : {})
    }),
  )
  const [x, y] = [Math.round(at.x), Math.round(at.y)]
  const stand = `translate(${x}px,${y}px) scale(${BOLT_SCALE})`
  const style =
    `@keyframes bolt-bob{0%,100%{transform:${stand}}50%{transform:translate(${x}px,${y - 6}px) scale(${BOLT_SCALE})}}` +
    `.bolt{transform:${stand};animation:bolt-bob 4s ease-in-out infinite}` +
    '@keyframes light{0%,100%{opacity:1}50%{opacity:0.55}}.light{animation:light 3s ease-in-out infinite}'
  return { style, body: group(body, { class: 'bolt' }) }
}

/**
 * The whole SVG document of a look's wallpaper, Bolt included; undefined for a
 * look with no scene. A thumbnail is the same picture with fewer small things
 * in it and nothing moving, for the gallery. `motion` is the person's setting:
 * `calm` keeps half of what drifts and moves everything at half the speed,
 * `still` is the whole picture at rest, as reduced motion shows it.
 */
export function sceneOf(theme: Theme, options: { thumb?: boolean; motion?: Motion } = {}): { source: string; alt: string } | undefined {
  const make = SCENES[theme.id]
  if (make === undefined) return undefined
  const thumb = options.thumb === true
  const motion = options.motion ?? 'full'
  // A scene is the same every time, and the desktop asks for it on every redraw: drawn once, kept.
  const key = `${lookKey(theme)} ${thumb ? 'thumb' : motion}`
  const kept = drawn.get(key)
  if (kept !== undefined) return kept
  const scene = thumb ? withDetail(THUMB_DETAIL, () => make(theme)) : motion === 'calm' ? withDetail(CALM_DETAIL, () => make(theme), 1) : make(theme)
  const bolt = boltInScene(theme, scene.bolt)
  const whole = scene.body.includes(BOLT_HERE) ? scene.body.replace(BOLT_HERE, bolt.body) : scene.body + bolt.body
  // A still picture keeps the places its CSS gives and drops the motion, Bolt's among them.
  const moving = scene.style + bolt.style
  const still = thumb || motion === 'still'
  const style = still ? stillStyle(moving) : motion === 'calm' ? slowed(moving, CALM_SLOWER) : moving
  const body = still ? stillBody(whole, style) : motion === 'calm' ? slowed(whole, CALM_SLOWER) : whole
  const out = {
    source: svg(theme.palette.bg, style, body, scene.defs),
    alt: `${scene.alt} Bolt, in the ${theme.id} costume, stands at the right.`,
  }
  drawn.set(key, out)
  return out
}

/**
 * How the desktop frosts its panels over the scene: tinted with the look's own
 * background so the chat reads as the look, heavier for the two accessibility
 * looks so text contrast stays what their README promises. The person's
 * setting moves it a step either way; the accessibility looks never go lighter.
 */
export function glassFor(theme: Theme, glass: Glass = 'default'): ThemeBackdropGlass {
  const careful = theme.id === 'high-contrast' || theme.id === 'colorblind'
  const base: { blur: number; tint: string; opacity: number } =
    theme.id === 'high-contrast'
      ? { blur: 24, tint: '#000000', opacity: 0.86 }
      : theme.id === 'colorblind'
        ? { blur: 20, tint: theme.palette.bg, opacity: 0.72 }
        : { blur: 14, tint: theme.palette.bg, opacity: theme.tone === 'light' ? 0.5 : 0.56 }
  if (glass === 'heavy') return { ...base, blur: base.blur + 10, opacity: Math.min(0.92, Math.round((base.opacity + 0.2) * 100) / 100) }
  if (glass === 'light' && !careful) return { ...base, blur: base.blur - 6, opacity: Math.round((base.opacity - 0.16) * 100) / 100 }
  return base
}

/** The scene's size in characters, for the tests. */
export function sceneSize(theme: Theme): number {
  return sceneOf(theme)?.source.length ?? 0
}
