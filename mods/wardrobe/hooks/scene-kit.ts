// The small kit every wallpaper scene is drawn with: one SVG document, pure
// vector, animated by its own CSS, drawn so that it also reads as a finished
// picture with the animation taken out (the desktop app draws it that way for a
// person who asked for reduced motion).
//
// What the engine refuses in a backdrop, and so nothing here writes: `url()`
// (but a local `#fragment`), `href`, `<image>`, `data:`, `@import`,
// `@font-face`, CDATA, `<?`, a backslash, a bare `&`, a comment of any kind,
// a control character. scenes.test.tsx holds every scene to that list.

/** The scene's own box: 16 by 9, in user units. `slice` crops it to any window. */
export const WIDTH = 1600
export const HEIGHT = 900

/** A scene's drawing: its own CSS, its body over the ground, and what it shows for a reader who cannot see it. */
export type Scene = { style: string; body: string; alt: string }

/** A deterministic pseudo-random stream: the same seed draws the same scene every time. */
export function rnd(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** A number as the markup carries it: at most one decimal, no `-0`. */
export function n(x: number): string {
  const r = Math.round(x * 10) / 10
  return String(r === 0 ? 0 : r)
}

/** The whole document: the style block first, then the drawing, over a ground of one colour. */
export function svg(ground: string, style: string, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="xMidYMid slice">` +
    `<style>${style}</style>` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${ground}"/>` +
    body +
    '</svg>'
  )
}

type Attrs = Record<string, string | number | undefined>

function attrs(a: Attrs): string {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${typeof v === 'number' ? n(v) : v}"`)
    .join('')
}

export const rect = (x: number, y: number, w: number, h: number, fill: string, more: Attrs = {}): string =>
  `<rect${attrs({ x, y, width: w, height: h, fill, ...more })}/>`
export const circle = (cx: number, cy: number, r: number, fill: string, more: Attrs = {}): string =>
  `<circle${attrs({ cx, cy, r, fill, ...more })}/>`
export const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string, more: Attrs = {}): string =>
  `<ellipse${attrs({ cx, cy, rx, ry, fill, ...more })}/>`
export const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, more: Attrs = {}): string =>
  `<line${attrs({ x1, y1, x2, y2, stroke, ...more })}/>`
export const path = (d: string, more: Attrs = {}): string => `<path${attrs({ d, ...more })}/>`
export const polygon = (points: readonly (readonly [number, number])[], fill: string, more: Attrs = {}): string =>
  `<polygon${attrs({ points: points.map(([x, y]) => `${n(x)},${n(y)}`).join(' '), fill, ...more })}/>`
export const group = (body: string, more: Attrs = {}): string => `<g${attrs(more)}>${body}</g>`

/**
 * A ragged silhouette along the bottom: `count` blocks of varying width and
 * height, as a city, a hill line or a tree line wants. Returns the polygon.
 */
export function skyline(seed: number, baseY: number, minH: number, maxH: number, count: number, fill: string, more: Attrs = {}): string {
  const r = rnd(seed)
  const points: [number, number][] = [[0, HEIGHT], [0, baseY]]
  let x = 0
  const step = WIDTH / count
  for (let i = 0; i < count; i += 1) {
    const w = step * (0.6 + r() * 0.8)
    const h = minH + r() * (maxH - minH)
    points.push([x, baseY - h], [x + w, baseY - h])
    x += w
  }
  points.push([WIDTH, baseY], [WIDTH, HEIGHT])
  return polygon(points, fill, more)
}

/**
 * `count` small things that drift across the whole picture on one animation,
 * each started at a different point of its loop (a negative delay), so that at
 * rest they lie spread over the canvas where their markup puts them.
 */
export function drift(
  seed: number,
  count: number,
  cls: string,
  duration: number,
  draw: (x: number, y: number, k: number, pick: () => number) => string,
): string {
  const r = rnd(seed)
  let out = ''
  for (let i = 0; i < count; i += 1) {
    const x = r() * WIDTH
    const y = r() * HEIGHT
    const delay = -(r() * duration)
    const dur = duration * (0.8 + r() * 0.4)
    out += group(draw(x, y, i, r), { class: cls, style: `animation-duration:${n(dur)}s;animation-delay:${n(delay)}s` })
  }
  return out
}

/** The CSS of a class that runs one keyframe set forever, linear unless said. */
export function anim(cls: string, frames: string, timing = 'linear'): string {
  return `.${cls}{animation-name:${frames};animation-timing-function:${timing};animation-iteration-count:infinite}`
}

/** Keyframes that move a thing down its lane and back round, as snow, rain and leaves fall. */
export const FALL = '@keyframes fall{from{transform:translateY(-950px)}to{transform:translateY(950px)}}'
/** Keyframes that carry a thing across the width and back round, as bats, trains and clouds cross. */
export const CROSS = '@keyframes cross{from{transform:translateX(-1700px)}to{transform:translateX(1700px)}}'
/** Keyframes that sway a thing a little either way. */
export const SWAY = '@keyframes sway{0%,100%{transform:translateX(-18px)}50%{transform:translateX(18px)}}'
/** Keyframes that bob a thing up and down a little. */
export const BOB = '@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}'

/**
 * A class that breathes a thing's opacity between `lo` and `hi`, with keyframes
 * of its own. Give the element its rest opacity in the markup, so it reads
 * finished with no motion.
 */
/** An opacity as the markup carries it: two decimals, so a faint layer stays faint instead of rounding away to nothing. */
function opacityOf(x: number): string {
  const r = Math.round(x * 100) / 100
  return String(r === 0 ? 0 : r)
}

export function pulse(cls: string, lo: number, hi: number, seconds: number, timing = 'ease-in-out'): string {
  return `@keyframes ${cls}{0%,100%{opacity:${opacityOf(lo)}}50%{opacity:${opacityOf(hi)}}}.${cls}{animation:${cls} ${n(seconds)}s ${timing} infinite}`
}

/** Hex colour with an alpha, as `#rrggbbaa`, for layers over the ground. */
export function alpha(hex: string, a: number): string {
  const v = Math.max(0, Math.min(255, Math.round(a * 255)))
  return `${hex}${v.toString(16).padStart(2, '0')}`
}
