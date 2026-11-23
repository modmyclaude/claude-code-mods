// The noir look on the GPU: hard rain over the vector city, heavier while
// Claude works and dry in a ring around the pointer; a searchlight from the
// lamp on the left roofs that turns to follow the pointer over the bare
// scene; sheet lightning
// where the bare scene is pressed; a cold light around the prompt box. The
// desktop app plays this file; the engine only reads it. The scene beneath is
// whole without it.

import { abs, atan, buffer, clamp, composer, cos, dot, dt, exp, first, floor, fract, length, max, min, mix, normalize, picture, pointer, pointerCount, shader, shapes, sin, size, smoothstep, step, time, values, vec2, vec3, vec4 } from 'claude-code/shader'
import type { Buffer } from 'claude-code/shader'

/** What register.tsx sends: whether Claude works. */
const live = values({ work: [0, 1] })

/** How many drops fall when the rain is at its heaviest. */
const DROPS = 360
/** How many turns of the rain's own clock pass in a second; a drop falls four to eight times a turn. */
const FALL = 0.2

/**
 * What lasts between frames, in two texels. The first: how far the rain has
 * fallen (x), the lightning still in the sky (y), which a press on the bare
 * scene starts and time lets die, and where the searchlight is in its sweep
 * (z). The second: where that press was (x, y), 0 to 1.
 */
const air: Buffer = buffer({ size: [2, 1], float: 32, filter: 'nearest' }, p => {
  const was = air.at(vec2(0, 0))
  const from = air.at(vec2(1, 0))
  const ptr = pointer(0)
  const pressed = ptr.down * (1 - ptr.over) * min(pointerCount, 1)
  const fallen = fract(was.x + dt * FALL * (1 + 0.5 * live.work))
  const flash = max(was.y * exp(-dt * 3), pressed)
  const sweep = fract(was.z + dt * (0.02 + 0.05 * live.work))
  const weather = first ? vec4(0, 0, 0, 1) : vec4(fallen, flash, sweep, 1)
  const place = first ? vec4(0.5, 0.8, 0, 1) : vec4(mix(from.x, ptr.where.x, pressed), mix(from.y, ptr.where.y, pressed), 0, 1)
  return p.cell.x < 0.5 ? weather : place
})

/** A steady number from 0 to 1 for each seed. */
const rand = (n: number) => fract(sin(n * 91.3458) * 47453.5453)

/** A place in the scene's own 1600x900 units, in the window's points: the scene fills the window and is cut at the long side. */
const inWindow = (x: number, y: number) => {
  const k = max(size.x / 1600, size.y / 900)
  return vec2(size.x / 2 + (x - 800) * k, size.y / 2 - (y - 450) * k)
}

/** The light: around the prompt box, the searchlight's beam, and the lightning. */
const light = picture(p => {
  const k = max(size.x / 1600, size.y / 900)
  const state = air.at(vec2(0, 0))
  const from = air.at(vec2(1, 0))
  const low = vec2(vec2(composer.x, composer.y) * size)
  const high = vec2(vec2(composer.z, composer.w) * size)
  const outside = vec2(max(max(low - p.point, p.point - high), 0))
  const hasBox = step(0.001, composer.z - composer.x)
  const breath = 1 + 0.12 * sin(time * 1.3) * live.work
  const hearth = exp(-length(outside) / 150) * (0.16 + 0.2 * live.work) * breath * hasBox
  // The beam turns about the lamp: by itself a slow sweep of the clouds, and to the pointer while one is over the
  // bare scene. Over the chat it keeps to its sweep, so nothing chases the pointer behind the words.
  const lamp = inWindow(330, 760)
  const ptr = pointer(0)
  const there = min(pointerCount, 1) * exp(-ptr.gone * 1.5) * (1 - ptr.over)
  const toPointer = vec2(ptr.at - lamp)
  const sweeping = sin(state.z * 6.2832) * 0.5
  const turned = mix(sweeping, clamp(atan(toPointer.x, toPointer.y), -1.2, 1.2), there)
  const aim = vec2(sin(turned), cos(turned))
  const out = vec2(p.point - lamp)
  const along = max(dot(out, aim), 0)
  const across = length(out - aim * dot(out, aim))
  const wide = 10 * k + along * 0.085
  const beam = smoothstep(wide, wide * 0.25, across) * smoothstep(0, 30 * k, along) * exp(-along / (900 * k)) * (0.13 + 0.07 * live.work)
  const strike = vec2(vec2(from.x, from.y) * size)
  const lightning = (exp(-length(p.point - strike) / (420 * k)) * 0.3 + 0.05) * state.y
  const glow = min(0.6, hearth + beam + lightning)
  return vec4(vec3(0.9, 0.93, 1) * glow, glow)
})

/** The rain: one thin streak a drop, near ones long and fast, far ones short and slow, all leaning the way they fall. */
const rain = shapes(
  { count: 6, instances: DROPS, draw: 'triangles', cover: 1 },
  (corner, i) => {
    const state = air.at(vec2(0, 0))
    const near = rand(i + 0.37)
    // A whole number of falls for each turn of `fallen`, so its wrap never shows.
    const pace = floor(4 + near * 4.99)
    const fall = fract(rand(i * 1.31 + 7) + state.x * pace)
    // How far left of where it started a drop lands, of the window's width: more while Claude works.
    const lean = 0.1 + 0.06 * near + 0.1 * live.work
    const head = vec2(vec2(-0.05 + 1.3 * rand(i * 5.11 + 3) - lean * fall, 1.04 - 1.1 * fall) * size)
    const way = normalize(vec2(-lean * size.x, -1.1 * size.y))
    const side = vec2(-way.y, way.x)
    // The six corners of two triangles: across the streak (0 or 1), and from its head (0) to its tail (1).
    const cx = step(0.5, corner) * step(corner, 1.5) + step(3.5, corner)
    const cy = step(1.5, corner) * step(corner, 3.5) + step(4.5, corner)
    const spot = vec2(head - way * mix(16, 64, near) * cy + side * mix(0.9, 2, near) * (cx - 0.5))
    // Dry around the pointer, thinner while Claude rests, brighter under lightning.
    const ptr = pointer(0)
    const dry = 1 - smoothstep(130, 50, length(head - ptr.at)) * min(pointerCount, 1) * exp(-ptr.gone * 3)
    const falls = step(rand(i * 9.7), 0.6 + 0.4 * live.work)
    return { at: vec2((spot / size) * 2 - 1), a: vec4(near, cy, cx, dry * falls * (1 + state.y)) }
  },
  s => {
    const soft = smoothstep(0, 0.5, 1 - abs(s.a.z - 0.5) * 2)
    const alpha = min(0.8, (1 - s.a.y) * soft * mix(0.3, 0.5, s.a.x) * s.a.w)
    return vec4(vec3(0.91, 0.91, 0.93) * alpha, alpha)
  },
)

export default shader({ fps: 30, passes: [air, light, rain] })
