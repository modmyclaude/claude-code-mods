// The light of the hour. Every scene is painted at an hour of its own (a
// dawn, a day, a dusk or a night). With the clock light on, the person's local
// time moves that light on from there: night comes down over a day scene, day
// lifts a night scene a little, and dawn and dusk each bring a warm glow low
// at one side. Nothing in a scene is drawn again: the light is a wash laid
// over the finished picture, a few soft pools at the two sides, at the end of
// the same document. The middle, where the chat column sits, is left alone.
//
// Pure: a time and the day and night hours in, plain numbers and markup out.
// register.tsx reads the clock; nothing here does.

import type { WardrobeSky } from '../types'
import { isDay } from './look'
import { ellipse, HEIGHT, mix, paint, radial, type Stop, WIDTH } from './scene-kit'
import type { Theme } from './themes'

/** The hours a scene may be painted at. */
export type Hour = 'dawn' | 'day' | 'dusk' | 'night'

/** Broad day: nothing dark, no glow. */
export const DAYLIGHT: WardrobeSky = { dark: 0, dawn: 0, dusk: 0 }

/** The light moves in steps of this many minutes, so a scene is set again a few times an hour at dawn and dusk and never between. */
export const SKY_STEP = 15
/** Dawn and dusk each run from this long before the day or the night starts ... */
const BEFORE = 90
/** ... to this long after it. */
const AFTER = 60
const DAY = 1440

const round2 = (x: number): number => Math.round(x * 100) / 100
const ease = (t: number): number => t * t * (3 - 2 * t)

/** How far `minute` is through the dawn or the dusk about `turn`, 0 to 1; undefined outside it. */
function through(minute: number, turn: number): number | undefined {
  const into = (((minute - (turn - BEFORE)) % DAY) + DAY) % DAY
  return into <= BEFORE + AFTER ? into / (BEFORE + AFTER) : undefined
}

/**
 * The light at `minute` after local midnight, for a day that starts at
 * `dayStarts` and a night that starts at `nightStarts` (the two hours `/wear
 * auto` goes by): dark through the night, light through the day, and between
 * them a dawn and a dusk two and a half hours long, each with a glow that
 * swells and fades. Where the two hours are the same there is no night at all.
 */
export function lightAt(minute: number, dayStarts: number, nightStarts: number): WardrobeSky {
  if (dayStarts === nightStarts) return DAYLIGHT
  const at = Math.floor(minute / SKY_STEP) * SKY_STEP
  const rising = through(at, dayStarts)
  if (rising !== undefined) return { dark: round2(1 - ease(rising)), dawn: round2(Math.sin(Math.PI * rising)), dusk: 0 }
  const setting = through(at, nightStarts)
  if (setting !== undefined) return { dark: round2(ease(setting)), dawn: 0, dusk: round2(Math.sin(Math.PI * setting)) }
  return isDay(at, dayStarts, nightStarts) ? DAYLIGHT : { dark: 1, dawn: 0, dusk: 0 }
}

/** Whether two lights are the same light: state crosses as JSON, so identity never is. */
export function sameLight(a: WardrobeSky | null | undefined, b: WardrobeSky | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null)
  return a.dark === b.dark && a.dawn === b.dawn && a.dusk === b.dusk
}

/**
 * The hour each scene is painted at, and how far the clock may move its light
 * (1 unless said): less for a room lit by its own lamps, and for the two looks
 * on a light page, where a deep shade would cost the words their contrast. A
 * look that is not here keeps its light whatever the hour: the two
 * accessibility looks, whose contrast is a promise.
 */
export const PAINTED: Readonly<Record<string, { at: Hour; reach?: number }>> = {
  noir: { at: 'night' },
  paper: { at: 'day', reach: 0.4 },
  'tokyo-night': { at: 'night' },
  dracula: { at: 'night' },
  catppuccin: { at: 'dusk' },
  solarized: { at: 'night', reach: 0.6 },
  nord: { at: 'night' },
  phosphor: { at: 'night', reach: 0.6 },
  graphite: { at: 'night' },
  clay: { at: 'dusk' },
  synthwave: { at: 'dusk' },
  'on-call': { at: 'night', reach: 0.6 },
  hardwood: { at: 'day', reach: 0.6 },
  gridiron: { at: 'night' },
  rink: { at: 'day', reach: 0.6 },
  halloween: { at: 'night' },
  christmas: { at: 'night' },
  spring: { at: 'day', reach: 0.5 },
  summer: { at: 'dusk' },
  autumn: { at: 'dusk' },
  easter: { at: 'dawn' },
  eid: { at: 'night' },
}

/** How dark the hour a scene is painted at is, on the scale `lightAt` answers in. */
const DARK_AT: Record<Hour, number> = { dawn: 0.4, day: 0, dusk: 0.4, night: 1 }

const NIGHT = '#0a1230'
const VIOLET = '#2c1648'
const DAY_SKY = '#bfd6f2'
/** The most a night lays over a scene painted by day, at the heart of each side. */
const SHADE = 0.55
/** The most a day lifts the sky of a scene painted at night, at the heart of each side. */
const LIFT = 0.4
/** The most a dawn or a dusk glows, at its heart. */
const GLOW = 0.34

/** An ellipse of light or of shade, in the scene's own units. */
export type Pool = { cx: number; cy: number; rx: number; ry: number }
/**
 * One part of the wash: a colour from the heart of a pool to its rim, and the
 * pools it fills. Every part is a pool at one side or at both, spent before the
 * middle of the picture: the chat column keeps the light its look gave it, and
 * the words on it their contrast.
 */
export type Layer = { kind: 'shade' | 'lift' | 'dawn' | 'dusk'; stops: readonly [Stop, Stop, Stop]; pools: readonly Pool[] }

const sides = (pool: Pool): readonly Pool[] => [pool, { ...pool, cx: WIDTH - pool.cx }]
/** Night stands down each side from top to foot. */
const SHADE_POOLS = sides({ cx: -100, cy: HEIGHT / 2, rx: 760, ry: 1400 })
/** Day comes in at the top of each side and thins before the ground, so a night scene keeps its dark roofs and hills. */
const LIFT_POOLS = sides({ cx: 40, cy: -40, rx: 620, ry: 760 })
/** Dawn glows low at the left, dusk low at the right. */
const DAWN_POOL: Pool = { cx: 150, cy: 640, rx: 520, ry: 430 }
const DUSK_POOL: Pool = { ...DAWN_POOL, cx: WIDTH - DAWN_POOL.cx }

/**
 * What the light `sky` lays over a look's scene, part by part; nothing for a
 * look the clock leaves alone, and nothing at the hour the scene is painted at.
 * A scene painted at dawn or dusk has its own low sun, so it takes no second
 * glow: it stands as painted at both ends of the day.
 */
export function washLayers(theme: Pick<Theme, 'id'>, sky: WardrobeSky): Layer[] {
  const painted = PAINTED[theme.id]
  if (painted === undefined) return []
  const reach = painted.reach ?? 1
  const layers: Layer[] = []
  const lay = (kind: Layer['kind'], amount: number, pools: readonly Pool[], heart: string, body: readonly [number, string, number], rim: string): void => {
    const core = round2(amount * reach)
    if (core > 0) layers.push({ kind, stops: [[0, heart, core], [body[0], body[1], round2(core * body[2])], [1, rim, 0]], pools })
  }
  const darker = sky.dark - DARK_AT[painted.at]
  // Dusk comes down violet before it is night.
  const shade = mix(NIGHT, VIOLET, 0.6 * sky.dusk)
  if (darker > 0) lay('shade', darker * SHADE, SHADE_POOLS, shade, [0.5, shade, 1], shade)
  if (darker < 0) lay('lift', -darker * LIFT, LIFT_POOLS, DAY_SKY, [0.45, DAY_SKY, 0.6], DAY_SKY)
  if (painted.at === 'dawn' || painted.at === 'dusk') return layers
  lay('dawn', sky.dawn * GLOW, [DAWN_POOL], '#ffe2a8', [0.3, '#ff9f7e', 0.55], '#ff9f7e')
  lay('dusk', sky.dusk * GLOW, [DUSK_POOL], '#ffc170', [0.3, '#f0677f', 0.55], '#b0509a')
  return layers
}

/** The wash as markup: its gradients in a defs of its own, then an ellipse for each pool, laid over the whole picture. Empty where there is nothing to lay. */
export function washOf(theme: Pick<Theme, 'id'>, sky: WardrobeSky): string {
  let defs = ''
  let body = ''
  for (const layer of washLayers(theme, sky)) {
    const id = `hour-${layer.kind}`
    defs += radial(id, layer.stops)
    for (const pool of layer.pools) body += ellipse(pool.cx, pool.cy, pool.rx, pool.ry, paint(id))
  }
  return body === '' ? '' : `<defs>${defs}</defs>${body}`
}

/** How strong a layer is at a place in the scene's own units, and in what colour: for the tests, which hold the wash to what the words over it need. */
export function layerAt(layer: Layer, x: number, y: number): { colour: string; alpha: number } {
  const [heart, body, rim] = layer.stops
  // Where two pools of one layer meet, the nearer one tells: they are laid one over the other, and the farther adds little.
  const r = Math.min(...layer.pools.map(pool => Math.hypot((x - pool.cx) / pool.rx, (y - pool.cy) / pool.ry)))
  if (r >= 1) return { colour: rim[1], alpha: 0 }
  const from = r <= body[0] ? heart : body
  const to = r <= body[0] ? body : rim
  const t = (r - from[0]) / (to[0] - from[0])
  return { colour: mix(from[1], to[1], t), alpha: (from[2] ?? 1) + ((to[2] ?? 1) - (from[2] ?? 1)) * t }
}
