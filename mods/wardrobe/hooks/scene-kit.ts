// The kit every wallpaper scene is drawn with: one SVG document, pure vector,
// animated by its own CSS, drawn so that it also reads as a finished picture
// with the animation taken out (the desktop app draws it that way for a person
// who asked for reduced motion).
//
// A scene is built in depth: a sky, then far, middle and near layers that sway
// by different amounts on one slow beat, so the picture has parallax, then
// whatever falls or drifts through it, then a vignette.
//
// What the engine refuses in a backdrop, and so nothing here writes: a link
// that leaves the document (only a local fragment may be named), an embedded
// picture or font, an import, a script, CDATA, a backslash, a bare ampersand,
// a comment of any kind, a control character. tests/scenes.test.ts holds every
// scene to that list.

/** The scene's own box: 16 by 9, in user units. `slice` crops it to any window. */
export const WIDTH = 1600
export const HEIGHT = 900
/** How far a layer is drawn past each side, so its sway never shows an edge. */
export const BLEED = 80

/** A scene's drawing: its CSS, its gradients, its body over the ground, where Bolt stands, and what it shows for a reader who cannot see it. */
export type Scene = { style: string; body: string; alt: string; defs?: string; bolt?: { x: number; y: number } }

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

/** An opacity as the markup carries it: two decimals, so a faint layer stays faint instead of rounding away to nothing. */
export function op(x: number): string {
  const r = Math.round(x * 100) / 100
  return String(r === 0 ? 0 : r)
}

// How much of a scene's small things are drawn: 1 for the wallpaper, less for a
// gallery thumbnail, which wants the picture and not its every snowflake.
let detail = 1

/** Draws with fewer small things, as a thumbnail wants. */
export function withDetail<T>(k: number, make: () => T): T {
  const was = detail
  detail = k
  try {
    return make()
  } finally {
    detail = was
  }
}

/** A count scaled to the detail being drawn, never under one. */
export const few = (count: number): number => Math.max(1, Math.round(count * detail))

/** A spacing widened for a thumbnail: the same line, fewer points along it. */
export const coarse = (step: number): number => step / Math.max(detail, 0.34)

/** The whole document: the style block first, the gradients, then the drawing over a ground of one colour. */
export function svg(ground: string, style: string, body: string, defs = ''): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="xMidYMid slice">` +
    `<style>${style}</style>` +
    (defs === '' ? '' : `<defs>${defs}</defs>`) +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${ground}"/>` +
    body +
    '</svg>'
  )
}

type Attrs = Record<string, string | number | undefined>

function attrs(a: Attrs): string {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${typeof v === 'number' ? (k.includes('opacity') ? op(v) : n(v)) : v}"`)
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

// Colour.

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

/** Two colours mixed: `t` 0 is all `a`, 1 is all `b`. */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [channels(a), channels(b)]
  return '#' + x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('')
}

/** Hex colour with an alpha, as `#rrggbbaa`, for layers over the ground. */
export function alpha(hex: string, a: number): string {
  const v = Math.max(0, Math.min(255, Math.round(a * 255)))
  return `${hex.slice(0, 7)}${v.toString(16).padStart(2, '0')}`
}

// Gradients, kept in the document's own defs and named by a local fragment.

/** One stop of a gradient: where (0 to 1), the colour, and how opaque (1 unless said). */
export type Stop = readonly [number, string, number?]

const stops = (list: readonly Stop[]): string =>
  list.map(([at, colour, a]) => `<stop offset="${op(at)}" stop-color="${colour}"${a === undefined ? '' : ` stop-opacity="${op(a)}"`}/>`).join('')

/** A gradient that runs down its box, or along (`x2`, `y2`) when given. */
export function linear(id: string, list: readonly Stop[], x2 = 0, y2 = 1): string {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="${n(x2)}" y2="${n(y2)}">${stops(list)}</linearGradient>`
}

/** A gradient that runs out from the middle of its box. */
export function radial(id: string, list: readonly Stop[]): string {
  return `<radialGradient id="${id}">${stops(list)}</radialGradient>`
}

/** A glow: the colour at its heart, fading to nothing at the rim. */
export const glow = (id: string, colour: string, core = 1): string =>
  radial(id, [
    [0, colour, core],
    [0.35, colour, core * 0.4],
    [1, colour, 0],
  ])

/** The paint that names a gradient of this document. */
export const paint = (id: string): string => `url(#${id})`

// Depth.

/** The one slow beat the layers sway on, each by its own amount. */
export const PARALLAX =
  '@keyframes p-far{0%,100%{transform:translateX(-6px)}50%{transform:translateX(6px)}}' +
  '@keyframes p-mid{0%,100%{transform:translateX(-15px)}50%{transform:translateX(15px)}}' +
  '@keyframes p-near{0%,100%{transform:translateX(-28px)}50%{transform:translateX(28px)}}' +
  '.p-far{animation:p-far 64s ease-in-out infinite}.p-mid{animation:p-mid 64s ease-in-out infinite}.p-near{animation:p-near 64s ease-in-out infinite}'

/** One depth of the picture: `far` sways least, `near` most. */
export const layer = (depth: 'far' | 'mid' | 'near', body: string): string => group(body, { class: `p-${depth}` })

/** Darkens the corners so the eye rests in the picture: its gradient and its rect. */
export function vignette(id: string, colour: string, strength: number): { defs: string; body: string } {
  return {
    defs: radial(id, [
      [0.5, colour, 0],
      [1, colour, strength],
    ]),
    body: `<rect x="-200" y="-150" width="${WIDTH + 400}" height="${HEIGHT + 300}" fill="${paint(id)}"/>`,
  }
}

/** Smooth noise along a line, 0 to 1: the same seed and place give the same height. */
export function noise(seed: number): (x: number) => number {
  const r = rnd(seed)
  const table = Array.from({ length: 256 }, () => r())
  return x => {
    const i = Math.floor(x)
    const f = x - i
    const u = f * f * (3 - 2 * f)
    const a = table[i & 255]!
    const b = table[(i + 1) & 255]!
    return a + (b - a) * u
  }
}

/**
 * A ridge line across the picture: its height at any x, and its silhouette
 * down to the foot as a path. `rough` adds finer folds; `sharp` turns rolling
 * hills into peaks.
 */
export function ridge(seed: number, baseY: number, amp: number, wavelength: number, options: { rough?: number; sharp?: boolean; step?: number } = {}): { y: (x: number) => number; d: string } {
  const { rough = 3, sharp = false, step = 20 } = options
  const at = noise(seed)
  const y = (x: number): number => {
    let sum = 0
    let size = 1
    let total = 0
    for (let o = 0; o < rough; o += 1) {
      const v = at(((x + 4000) / wavelength) * 2 ** o + o * 17)
      sum += (sharp ? 1 - Math.abs(2 * v - 1) : v) * size
      total += size
      size /= 2
    }
    return baseY - amp * (sum / total)
  }
  let d = `M${-BLEED} ${HEIGHT}`
  const stride = coarse(step)
  for (let x = -BLEED; x <= WIDTH + BLEED; x += stride) d += `L${n(x)} ${n(y(x))}`
  return { y, d: `${d}L${n(WIDTH + BLEED)} ${n(y(WIDTH + BLEED))}L${WIDTH + BLEED} ${HEIGHT}z` }
}

/** One pine as part of a path: three tiers and a trunk, standing on `base`. */
export function pineD(x: number, base: number, h: number): string {
  let d = ''
  for (let tier = 0; tier < 3; tier += 1) {
    const top = base - h + tier * h * 0.22
    const foot = top + h * 0.44
    const half = h * (0.12 + tier * 0.07)
    d += `M${n(x)} ${n(top)}L${n(x + half)} ${n(foot)}L${n(x - half)} ${n(foot)}z`
  }
  return d + `M${n(x - h * 0.025)} ${n(base - h * 0.14)}h${n(h * 0.05)}V${n(base + 4)}h${n(-h * 0.05)}z`
}

/** A stand of pines along a line, each on the ground beneath it, as one path. */
export function pinesD(seed: number, count: number, from: number, to: number, ground: (x: number) => number, minH: number, maxH: number): string {
  const r = rnd(seed)
  let d = ''
  const total = few(count)
  for (let i = 0; i < total; i += 1) {
    const x = from + ((i + r() * 0.8) / total) * (to - from)
    d += pineD(x, ground(x) + 3, minH + r() * (maxH - minH))
  }
  return d
}

/** A block of buildings as one path, with the places its windows may be lit and its rooftops. */
export function city(seed: number, baseY: number, minH: number, maxH: number, widths: readonly [number, number], gap = 0): { d: string; cells: [number, number][]; tops: { x: number; y: number; w: number }[] } {
  const r = rnd(seed)
  let d = ''
  const cells: [number, number][] = []
  const tops: { x: number; y: number; w: number }[] = []
  let x = -BLEED
  while (x < WIDTH + BLEED) {
    const w = widths[0] + r() * (widths[1] - widths[0])
    const h = minH + r() * r() * (maxH - minH)
    const top = baseY - h
    d += `M${n(x)} ${HEIGHT}V${n(top)}h${n(w)}V${HEIGHT}z`
    // A stepped crown or a mast on some roofs.
    const crown = r()
    if (crown < 0.3) d += `M${n(x + w * 0.2)} ${n(top)}v${n(-h * 0.07)}h${n(w * 0.6)}v${n(h * 0.07)}z`
    else if (crown < 0.5) d += `M${n(x + w * 0.5 - 1.5)} ${n(top)}v${n(-18 - r() * 40)}h3V${n(top)}z`
    tops.push({ x, y: top, w })
    // A thumbnail keeps every fourth place a window may be lit.
    for (let wx = x + 7; wx < x + w - 9; wx += 13) for (let wy = top + 12; wy < baseY - 10; wy += 19) if (detail === 1 || (Math.round(wx) + Math.round(wy)) % 4 === 0) cells.push([wx, wy])
    x += w + gap * r()
  }
  return { d, cells, tops }
}

/** Small rectangles as one path: lit windows, bricks, glints. */
export const cellsD = (cells: readonly (readonly [number, number])[], w: number, h: number): string =>
  cells.map(([x, y]) => `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`).join('')

/** A sky of stars, most still, some twinkling out of step (class `tw`). */
export function stars(seed: number, count: number, yMax: number, colour: string): string {
  const r = rnd(seed)
  let out = ''
  const total = few(count)
  for (let i = 0; i < total; i += 1) {
    const more: Attrs = { opacity: 0.35 + r() * 0.6 }
    if (i % 4 === 0) {
      more.class = 'tw'
      more.style = `animation-delay:${n(-r() * 9)}s`
    }
    out += circle(r() * WIDTH, r() * r() * yMax, 0.7 + r() * 1.3, colour, more)
  }
  return out
}

/** A cloud: a few soft lobes on a flat foot, one colour, as see-through as `opacity` says (on the whole cloud, so its lobes never show through each other). */
export function cloud(x: number, y: number, w: number, fill: string, opacity: number, more: Attrs = {}): string {
  const h = w * 0.22
  return group(
    ellipse(x, y, w * 0.5, h * 0.55, fill) + ellipse(x - w * 0.22, y - h * 0.35, w * 0.24, h * 0.6, fill) + ellipse(x + w * 0.12, y - h * 0.55, w * 0.3, h * 0.75, fill) + ellipse(x + w * 0.34, y - h * 0.15, w * 0.2, h * 0.45, fill),
    { opacity, ...more },
  )
}

/**
 * `count` small things that drift across the whole picture on one animation,
 * each started at a different point of its loop (a negative delay), so that at
 * rest they lie spread over the canvas where their markup puts them.
 */
export function drift(seed: number, count: number, cls: string, duration: number, draw: (x: number, y: number, k: number, pick: () => number) => string): string {
  const r = rnd(seed)
  let out = ''
  const total = few(count)
  for (let i = 0; i < total; i += 1) {
    const x = r() * WIDTH
    const y = r() * HEIGHT
    const delay = -(r() * duration)
    const dur = duration * (0.8 + r() * 0.4)
    const drawn = draw(x, y, i, r)
    // A duration of nothing scatters the things and leaves them still.
    out += duration <= 0 ? drawn : group(drawn, { class: cls, style: `animation-duration:${n(dur)}s;animation-delay:${n(delay)}s` })
  }
  return out
}

/** The CSS of a class that runs one keyframe set forever, linear unless said. */
export function anim(cls: string, frames: string, timing = 'linear'): string {
  return `.${cls}{animation-name:${frames};animation-timing-function:${timing};animation-iteration-count:infinite}`
}

/** Keyframes that move a thing down its lane and back round, as snow, rain and leaves fall. */
export const FALL = '@keyframes fall{from{transform:translateY(-950px)}to{transform:translateY(950px)}}'
/** Keyframes that lift a thing up its lane and back round, as embers and bubbles rise. */
export const RISE = '@keyframes rise{from{transform:translateY(950px)}to{transform:translateY(-950px)}}'
/** Keyframes that carry a thing across the width and back round, as bats, trains and clouds cross. */
export const CROSS = '@keyframes cross{from{transform:translateX(-1700px)}to{transform:translateX(1700px)}}'
/** Keyframes that sway a thing a little either way. */
export const SWAY = '@keyframes sway{0%,100%{transform:translateX(-18px)}50%{transform:translateX(18px)}}'
/** Keyframes that bob a thing up and down a little. */
export const BOB = '@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}'
/** A wing beat, for a class `flap` on the thing that beats. */
export const FLAP = '@keyframes flap{0%,100%{transform:scaleY(1)}50%{transform:scaleY(0.5)}}.flap{transform-box:fill-box;transform-origin:center;animation:flap 1.6s ease-in-out infinite}'
/** A slow turn about a thing's own middle, for a class `spin`. */
export const SPIN = '@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}.spin{transform-box:fill-box;transform-origin:center;animation:spin 8s linear infinite}'
/** A thing that bends from its foot, as grass and reeds do, for a class `bend`. */
export const BEND = '@keyframes bend{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}.bend{transform-box:fill-box;transform-origin:center bottom;animation:bend 7s ease-in-out infinite}'
/** Smoke: puffs that lift, widen and thin, for a class `puff`. */
export const SMOKE = '@keyframes puff{0%{transform:translate(0,0) scale(0.5);opacity:0.5}100%{transform:translate(26px,-110px) scale(2);opacity:0.02}}.puff{transform-box:fill-box;transform-origin:center;animation:puff 9s ease-out infinite}'

/** Three puffs of smoke from one place, out of step. */
export function smoke(x: number, y: number, colour: string): string {
  return [0, 3, 6].map(delay => circle(x, y, 9, colour, { opacity: 0.3, class: 'puff', style: `animation-delay:${n(-delay)}s` })).join('')
}

/**
 * A class that breathes a thing's opacity between `lo` and `hi`, with keyframes
 * of its own. Give the element its rest opacity in the markup, so it reads
 * finished with no motion.
 */
export function pulse(cls: string, lo: number, hi: number, seconds: number, timing = 'ease-in-out'): string {
  return `@keyframes ${cls}{0%,100%{opacity:${op(lo)}}50%{opacity:${op(hi)}}}.${cls}{animation:${cls} ${n(seconds)}s ${timing} infinite}`
}

/** A thing that falls in its lane while it spins and sways: the three motions on three nested groups. */
export const tumbling = (x: number, y: number, inner: string): string => group(group(group(inner, { class: 'spin' }), { class: 'sway' }), { transform: `translate(${n(x)} ${n(y)})` })

/** Where a scene wants Bolt drawn among its layers (so Bolt sways with the ground beneath); absent, Bolt is drawn last. */
export const BOLT_HERE = '<g id="bolt-here"/>'

/** Snow on the heights of a ridge: a band along its line, thicker the higher the ground, with a ragged lower edge. */
export function capsD(y: (x: number) => number, snowline: number, step = 20): string {
  let top = ''
  let foot = ''
  let k = 0
  for (let x = -BLEED; x <= WIDTH + BLEED; x += coarse(step)) {
    const at = y(x)
    const depth = Math.max(0, (snowline - at) * 0.55)
    top += `${top === '' ? 'M' : 'L'}${n(x)} ${n(at)}`
    foot = `L${n(x)} ${n(at + depth * (k % 2 === 0 ? 1 : 0.55))}` + foot
    k += 1
  }
  return `${top}${foot}z`
}

/** A repeating tile kept in the document's defs, for hatching and dots: a texture tells two areas apart where colour alone might not. */
export function pattern(id: string, w: number, h: number, body: string): string {
  return `<pattern id="${id}" width="${n(w)}" height="${n(h)}" patternUnits="userSpaceOnUse">${body}</pattern>`
}

/**
 * A class that carries a thing round an ellipse, one lap in `seconds`, starting
 * `phase` of the way round: the keyframes, and the resting place for a picture
 * with no motion.
 */
export function orbit(cls: string, cx: number, cy: number, rx: number, ry: number, seconds: number, phase: number): string {
  const at = (t: number) => {
    const a = (t + phase) * Math.PI * 2
    return `translate(${n(cx + Math.cos(a) * rx)}px,${n(cy + Math.sin(a) * ry)}px)`
  }
  let frames = ''
  const steps = 36
  for (let i = 0; i <= steps; i += 1) frames += `${n((i / steps) * 100)}%{transform:${at(i / steps)}}`
  return `@keyframes ${cls}{${frames}}.${cls}{transform:${at(0)};animation:${cls} ${n(seconds)}s linear infinite}`
}
