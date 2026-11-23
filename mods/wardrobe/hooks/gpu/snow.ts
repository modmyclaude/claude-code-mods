// The christmas look on the GPU: deep snow that falls over the vector scene,
// parts around the pointer, blows from where the bare scene is pressed, and
// falls faster and aslant while Claude works; a warm light around the prompt box and
// on the tree. The desktop app plays this file; the engine only reads it. The
// scene beneath is whole without it, which is what shows under Reduce Motion
// or where the app plays no shader.

import { buffer, clamp, composer, dt, exp, first, floor, fract, length, max, min, mix, picture, pointer, pointerCount, px, shader, shapes, sin, size, smoothstep, step, time, values, vec2, vec3, vec4 } from 'claude-code/shader'
import type { Buffer } from 'claude-code/shader'

/** What register.tsx sends: whether Claude works. The pointer is the app's own to follow; no hook hears it. */
const live = values({ work: [0, 1] })

/** How many flakes fall. */
const FLAKES = 440
/** How much of the window's height the slowest flake falls in a second. */
const FALL = 0.011

/**
 * What lasts between frames, in two texels. The first: how far the snow has
 * fallen (x), so a change of pace never makes a flake jump, and the gust still
 * blowing (y), which a press on the bare scene starts and time lets die. The
 * second: where that press was (x, y), 0 to 1.
 */
const air: Buffer = buffer({ size: [2, 1], float: 32, filter: 'nearest' }, p => {
  const was = air.at(vec2(0, 0))
  const from = air.at(vec2(1, 0))
  const ptr = pointer(0)
  const pressed = ptr.down * (1 - ptr.over) * min(pointerCount, 1)
  const fallen = fract(was.x + dt * FALL * (1 + 0.9 * live.work))
  const blowing = max(was.y * exp(-dt * 0.8), pressed)
  const weather = first ? vec4(0, 0, 0, 1) : vec4(fallen, blowing, 0, 1)
  const place = first ? vec4(0.5, 0.5, 0, 1) : vec4(mix(from.x, ptr.where.x, pressed), mix(from.y, ptr.where.y, pressed), 0, 1)
  return p.cell.x < 0.5 ? weather : place
})

/** A steady number from 0 to 1 for each seed. */
const rand = (n: number) => fract(sin(n * 91.3458) * 47453.5453)

/** A place in the scene's own 1600x900 units, in the window's points: the scene fills the window and is cut at the long side. */
const inWindow = (x: number, y: number) => {
  const k = max(size.x / 1600, size.y / 900)
  return vec2(size.x / 2 + (x - 800) * k, size.y / 2 - (y - 450) * k)
}

/** The light: around the prompt box, on the tree while Claude works, and a small lantern at the pointer. */
const light = picture(p => {
  const low = vec2(vec2(composer.x, composer.y) * size)
  const high = vec2(vec2(composer.z, composer.w) * size)
  const outside = vec2(max(max(low - p.point, p.point - high), 0))
  const hasBox = step(0.001, composer.z - composer.x)
  const breath = 1 + 0.12 * sin(time * 1.3) * live.work
  const hearth = exp(-length(outside) / 150) * (0.24 + 0.24 * live.work) * breath * hasBox
  const k = max(size.x / 1600, size.y / 900)
  const tree = exp(-length(p.point - inWindow(262, 640)) / (150 * k)) * 0.22 * live.work * breath
  const ptr = pointer(0)
  const lantern = exp(-length(p.point - ptr.at) / 100) * 0.14 * min(pointerCount, 1) * exp(-ptr.gone * 2)
  const glow = min(0.6, hearth + tree + lantern)
  return vec4(vec3(1, 0.8, 0.5) * glow, glow)
})

/** The snow: one soft point a flake, near ones large, fast and out of focus, far ones small and slow. */
const snow = shapes(
  { count: 1, instances: FLAKES, draw: 'points', cover: 1 },
  (_vertex, i) => {
    const state = air.at(vec2(0, 0))
    const near = rand(i + 0.37)
    // A whole number of falls for each turn of `fallen`, so its wrap never shows.
    const pace = floor(2 + near * 4.99)
    const fall = fract(rand(i * 1.31 + 7) + state.x * pace)
    const sway = sin(time * (0.5 + rand(i * 2.17)) + rand(i * 3.7) * 6.283) * (0.006 + 0.012 * near)
    const slant = live.work * 0.16 * (0.4 + near) * fall
    // Wider than the window, so a flake never crosses it at a jump.
    const x = -0.1 + 1.2 * fract(rand(i * 5.11 + 3) + sway + slant)
    let spot = vec2(vec2(x, 1.04 - 1.08 * fall) * size)
    // The pointer parts the snow.
    const ptr = pointer(0)
    const away = vec2(spot - ptr.at)
    const far = length(away)
    const part = smoothstep(150, 0, far) * 70 * (0.4 + near) * min(pointerCount, 1) * exp(-ptr.gone * 3)
    spot = vec2(spot + (away / max(far, 1)) * part)
    // A press on the bare scene blows it outward from there.
    const from = air.at(vec2(1, 0))
    const blown = vec2(spot - vec2(from.x, from.y) * size)
    const reach = length(blown)
    spot = vec2(spot + (blown / max(reach, 1)) * state.y * (0.4 + near) * 160 * exp(-reach / 500))
    return { at: vec2((spot / size) * 2 - 1), size: clamp(mix(2.5, 16, near * near) / px, 1, 64), a: vec4(near, rand(i * 7.9), 0, 0) }
  },
  s => {
    const near = s.a.x
    const r = length(s.coord - 0.5) * 2
    const alpha = smoothstep(1, mix(0.4, 0, near), r) * mix(0.75, 0.36, near) * (0.75 + 0.25 * s.a.y)
    return vec4(vec3(0.96, 0.98, 1) * alpha, alpha)
  },
)

export default shader({ fps: 30, passes: [air, light, snow] })
