// The summer look on the GPU: the whole sea glinting and the sun's path
// glittering on it, wider and brighter while Claude works, with a second
// glitter on the water under the pointer; rings that spread on the water from where it is pressed; fireflies
// among the palms that shy from the pointer and all light at a press; the
// sun's glow and a gold light around the prompt box. The desktop app plays
// this file; the engine only reads it. The scene beneath is whole without it.

import { abs, buffer, clamp, composer, dot, dt, exp, first, floor, fract, length, max, min, mix, picture, pointer, pointerCount, pow, px, shader, shapes, sin, size, smoothstep, step, time, values, vec2, vec3, vec4 } from 'claude-code/shader'
import type { Buffer } from 'claude-code/shader'

/** What register.tsx sends: whether Claude works. */
const live = values({ work: [0, 1] })

/** How many fireflies are out when Claude works; half of them at rest. */
const FLIES = 70

/**
 * What lasts between frames, in two texels. The first: the light still in the
 * fireflies after a press (y), which time lets die. The second: where the bare
 * scene was last pressed (x, y), 0 to 1, and how many seconds ago (z), which
 * starts long past so no ring shows before a press.
 */
const air: Buffer = buffer({ size: [2, 1], float: 32, filter: 'nearest' }, p => {
  const was = air.at(vec2(0, 0))
  const from = air.at(vec2(1, 0))
  const ptr = pointer(0)
  const pressed = ptr.down * (1 - ptr.over) * min(pointerCount, 1)
  const lit = max(was.y * exp(-dt * 1.4), pressed)
  const weather = first ? vec4(0, 0, 0, 1) : vec4(0, lit, 0, 1)
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

/** A ring `at` points out from its middle, `reach` points from a pixel to that middle. */
const ringAt = (reach: number, at: number, soft: number) => smoothstep(soft, 0, abs(reach - at)) * step(0, at)

/** The water and the light: the glitter, the rings, the sun's glow, the prompt box and the pointer. */
const water = picture(p => {
  const k = max(size.x / 1600, size.y / 900)
  const from = air.at(vec2(1, 0))
  // The pixel in the scene's own 1600x900 units, y down as the scene has it.
  const x = 800 + (p.point.x - size.x / 2) / k
  const y = 450 - (p.point.y - size.y / 2) / k
  // The sea runs from the horizon to the sand, which climbs at the right.
  const shore = mix(800, 692, smoothstep(1000, 1300, x))
  const sea = smoothstep(590, 600, y) * (1 - smoothstep(shore - 46, shore - 8, y))
  const far = clamp((y - 594) / 190, 0, 1)
  // Glitter: short dashes in rows, each row set off from the next, each dash lit now and then in its own time.
  const row = floor(y / 6)
  const along = x + fract(sin(row * 37.7) * 4375.85) * 16
  const cell = vec2(floor(along / 16), row)
  const seed = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453)
  const twinkle = pow(0.5 + 0.5 * sin(time * (1.5 + 3 * seed) + seed * 40), 8)
  const acrossDash = fract(along / 16)
  const dash = smoothstep(0.1, 0.35, acrossDash) * smoothstep(0.9, 0.65, acrossDash) * (1 - abs(fract(y / 6) - 0.5) * 2)
  // A few dashes glint anywhere on the water; the sun's path is thick with them.
  const anywhere = step(0.7, fract(seed * 7.13)) * (0.24 + 0.2 * live.work)
  const spread = (30 + far * 150) * (1 + 0.5 * live.work)
  const off = (x - 1030) / spread
  const path = exp(-off * off)
  const ptr = pointer(0)
  const there = min(pointerCount, 1) * exp(-ptr.gone * 2)
  const under = exp(-length(p.point - ptr.at) / 100) * there
  const glitter = sea * twinkle * dash * (anywhere + path * (0.5 + 0.35 * live.work) + under * 0.7)
  // A press on the water: three rings spreading, flattened as the water lies.
  const out = vec2(p.point - vec2(from.x, from.y) * size)
  const reach = length(vec2(out.x, out.y * 2.6))
  const run = from.z * 150 * k
  const rings = (ringAt(reach, run, 7 * k) + 0.6 * ringAt(reach, run - 34 * k, 7 * k) + 0.35 * ringAt(reach, run - 68 * k, 7 * k)) * exp(-from.z * 0.9) * 0.4 * sea
  const breath = 1 + 0.12 * sin(time * 1.1) * live.work
  const sun = exp(-length(p.point - inWindow(1030, 582)) / (300 * k)) * 0.14 * live.work * breath
  const low = vec2(vec2(composer.x, composer.y) * size)
  const high = vec2(vec2(composer.z, composer.w) * size)
  const outside = vec2(max(max(low - p.point, p.point - high), 0))
  const hasBox = step(0.001, composer.z - composer.x)
  const hearth = exp(-length(outside) / 150) * (0.2 + 0.22 * live.work) * breath * hasBox
  const lantern = exp(-length(p.point - ptr.at) / 100) * 0.12 * there
  const colour = vec3(vec3(1, 0.98, 0.88) * glitter + vec3(0.8, 0.95, 0.95) * rings + vec3(1, 0.82, 0.4) * (sun + hearth + lantern))
  const all = glitter + rings + sun + hearth + lantern
  const kept = min(0.7, all) / max(all, 0.0001)
  return vec4(colour * kept, all * kept)
})

/** The fireflies: each wanders about its own place among the palms in one wing and blinks in its own time. */
const flies = shapes(
  { count: 1, instances: FLIES, draw: 'points', cover: 1 },
  (_vertex, i) => {
    const state = air.at(vec2(0, 0))
    const near = rand(i + 0.37)
    // Half in the left wing, half in the right, in the scene's own units.
    const isLeft = rand(i * 6.7) < 0.5
    const homeX = isLeft ? mix(40, 470, rand(i * 5.11 + 3)) : mix(1150, 1560, rand(i * 5.11 + 3))
    const homeY = isLeft ? mix(330, 780, rand(i * 2.9)) : mix(380, 700, rand(i * 2.9))
    const wander = vec2(sin(time * 0.31 * (0.6 + rand(i * 2.17)) + rand(i * 3.7) * 6.283) * 46, sin(time * 0.23 * (0.6 + rand(i * 1.31 + 7)) + rand(i * 4.3) * 6.283) * 34)
    let spot = inWindow(homeX + wander.x, homeY + wander.y)
    // They shy from the pointer.
    const ptr = pointer(0)
    const away = vec2(spot - ptr.at)
    const far = length(away)
    spot = vec2(spot + (away / max(far, 1)) * smoothstep(150, 0, far) * 80 * min(pointerCount, 1) * exp(-ptr.gone * 3))
    const blink = pow(0.5 + 0.5 * sin(time * (0.8 + 1.2 * rand(i * 7.9)) + rand(i * 9.1) * 6.283), 3)
    const out = step(rand(i * 9.7), 0.5 + 0.5 * live.work)
    return { at: vec2((spot / size) * 2 - 1), size: clamp(mix(5, 12, near) / px, 1, 64), a: vec4(near, max(blink, state.y) * out, 0, 0) }
  },
  s => {
    const core = smoothstep(1, 0, length(s.coord - 0.5) * 2)
    const alpha = core * core * s.a.y * 0.8
    return vec4(mix(vec3(0.8, 1, 0.5), vec3(1, 1, 0.82), core) * alpha, alpha)
  },
)

export default shader({ fps: 30, passes: [air, water, flies] })
