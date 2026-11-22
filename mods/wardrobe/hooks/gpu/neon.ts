// The tokyo-night look on the GPU: light rain lit pink, cyan and violet by the
// signs, brighter near the pointer; the haze of the signs in both wings, which
// swells while Claude works; a ring of light that runs out from where the bare
// scene is pressed; a light around the prompt box that drifts from pink to
// cyan. The desktop app plays this file; the engine only reads it. The scene
// beneath is whole without it.

import { abs, buffer, composer, dt, exp, first, floor, fract, length, max, min, mix, normalize, picture, pointer, pointerCount, shader, shapes, sin, size, smoothstep, step, time, values, vec2, vec3, vec4 } from 'claude-code/shader'
import type { Buffer } from 'claude-code/shader'

/** What register.tsx sends: whether Claude works. */
const live = values({ work: [0, 1] })

/** How many drops fall when the rain is at its heaviest. */
const DROPS = 260
/** How many turns of the rain's own clock pass in a second; a drop falls three to six times a turn. */
const FALL = 0.13

/**
 * What lasts between frames, in two texels. The first: how far the rain has
 * fallen (x). The second: where the bare scene was last pressed (x, y), 0 to
 * 1, and how many seconds ago (z), which starts long past so no ring shows
 * before a press.
 */
const air: Buffer = buffer({ size: [2, 1], float: 32, filter: 'nearest' }, p => {
  const was = air.at(vec2(0, 0))
  const from = air.at(vec2(1, 0))
  const ptr = pointer(0)
  const pressed = ptr.down * (1 - ptr.over) * min(pointerCount, 1)
  const fallen = fract(was.x + dt * FALL * (1 + 0.4 * live.work))
  const weather = first ? vec4(0, 0, 0, 1) : vec4(fallen, 0, 0, 1)
  const place = first ? vec4(0.5, 0.5, 30, 1) : vec4(mix(from.x, ptr.where.x, pressed), mix(from.y, ptr.where.y, pressed), mix(min(from.z + dt, 30), 0, pressed), 1)
  return p.cell.x < 0.5 ? weather : place
})

/** A steady number from 0 to 1 for each seed. */
const rand = (n: number) => fract(sin(n * 91.3458) * 47453.5453)

/** A place in the scene's own 1600x900 units, in the window's points: the scene fills the window and is cut at the long side. */
const inWindow = (x: number, y: number) => {
  const k = max(size.x / 1600, size.y / 900)
  return vec2(size.x / 2 + (x - 800) * k, size.y / 2 - (y - 450) * k)
}

/** The three colours of the signs. */
const pink = () => vec3(0.97, 0.46, 0.56)
const cyan = () => vec3(0.49, 0.81, 1)
const violet = () => vec3(0.73, 0.6, 0.97)

/** A ring `at` points out from its middle, `reach` points from a pixel to that middle. */
const ringAt = (reach: number, at: number, soft: number) => smoothstep(soft, 0, abs(reach - at)) * step(0, at)

/** The light: around the prompt box, the haze of the signs, a lantern at the pointer, and the ring from a press. */
const light = picture(p => {
  const k = max(size.x / 1600, size.y / 900)
  const from = air.at(vec2(1, 0))
  const low = vec2(vec2(composer.x, composer.y) * size)
  const high = vec2(vec2(composer.z, composer.w) * size)
  const outside = vec2(max(max(low - p.point, p.point - high), 0))
  const hasBox = step(0.001, composer.z - composer.x)
  const breath = 1 + 0.14 * sin(time * 1.3) * live.work
  const hearth = exp(-length(outside) / 150) * (0.18 + 0.22 * live.work) * breath * hasBox
  const swell = 0.07 + 0.13 * live.work
  const left = exp(-length(p.point - inWindow(270, 520)) / (230 * k)) * swell * (1 + 0.2 * sin(time * 0.9))
  const right = exp(-length(p.point - inWindow(1330, 470)) / (230 * k)) * swell * (1 + 0.2 * sin(time * 0.7 + 2))
  const ptr = pointer(0)
  const lantern = exp(-length(p.point - ptr.at) / 110) * 0.16 * min(pointerCount, 1) * exp(-ptr.gone * 2)
  // The press: a ring that runs out, a fainter one behind it, both dying as they go.
  const reach = length(p.point - vec2(from.x, from.y) * size)
  const run = from.z * 420
  const ring = (ringAt(reach, run, 26) + 0.6 * ringAt(reach, run - 70, 20)) * exp(-from.z * 1.5) * 0.4
  const drift = 0.5 + 0.5 * sin(time * 0.35)
  const colour = vec3(pink() * left + cyan() * right + mix(pink(), cyan(), drift) * hearth + violet() * lantern + mix(cyan(), pink(), drift) * ring)
  const all = hearth + left + right + lantern + ring
  const kept = min(0.6, all) / max(all, 0.0001)
  return vec4(colour * kept, all * kept)
})

/** The rain: one thin streak a drop, each lit by one of the three signs. */
const rain = shapes(
  { count: 6, instances: DROPS, draw: 'triangles', cover: 1 },
  (corner, i) => {
    const state = air.at(vec2(0, 0))
    const near = rand(i + 0.37)
    // A whole number of falls for each turn of `fallen`, so its wrap never shows.
    const pace = floor(3 + near * 3.99)
    const fall = fract(rand(i * 1.31 + 7) + state.x * pace)
    const lean = 0.05 + 0.04 * near + 0.05 * live.work
    const head = vec2(vec2(-0.05 + 1.2 * rand(i * 5.11 + 3) - lean * fall, 1.04 - 1.1 * fall) * size)
    const way = normalize(vec2(-lean * size.x, -1.1 * size.y))
    const side = vec2(-way.y, way.x)
    // The six corners of two triangles: across the streak (0 or 1), and from its head (0) to its tail (1).
    const cx = step(0.5, corner) * step(corner, 1.5) + step(3.5, corner)
    const cy = step(1.5, corner) * step(corner, 3.5) + step(4.5, corner)
    const spot = vec2(head - way * mix(12, 40, near) * cy + side * mix(1.2, 2.2, near) * (cx - 0.5))
    // Lit by the pointer's lantern, thinner while Claude rests.
    const ptr = pointer(0)
    const lit = 1 + 2 * exp(-length(head - ptr.at) / 90) * min(pointerCount, 1) * exp(-ptr.gone * 3)
    const falls = step(rand(i * 9.7), 0.55 + 0.45 * live.work)
    const sign = rand(i * 4.3)
    const tint = sign < 0.34 ? pink() : sign < 0.67 ? cyan() : violet()
    return { at: vec2((spot / size) * 2 - 1), a: vec4(near, cy, cx, lit * falls), b: vec4(mix(vec3(0.75, 0.79, 0.96), tint, 0.6), 0) }
  },
  s => {
    const soft = smoothstep(0, 0.5, 1 - abs(s.a.z - 0.5) * 2)
    const alpha = min(0.85, (1 - s.a.y) * soft * mix(0.36, 0.6, s.a.x) * s.a.w)
    return vec4(vec3(s.b.x, s.b.y, s.b.z) * alpha, alpha)
  },
)

export default shader({ fps: 30, passes: [air, light, rain] })
