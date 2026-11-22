// The nord look on the GPU: three curtains of aurora that flow over the sky,
// brighter and quicker while Claude works and brightest above the pointer; a
// fold of light that runs along them from where the bare scene is pressed;
// ice crystals that hang in the air and glitter; a cold light around the
// prompt box. The desktop app plays this file; the engine only reads it. The
// scene beneath is whole without it.

import { abs, buffer, clamp, composer, dt, exp, first, floor, fract, length, max, min, mix, picture, pointer, pointerCount, pow, px, shader, shapes, sin, size, smoothstep, step, time, values, vec2, vec3, vec4 } from 'claude-code/shader'
import type { Buffer } from 'claude-code/shader'

/** What register.tsx sends: whether Claude works. */
const live = values({ work: [0, 1] })

/** How many crystals hang in the air. */
const CRYSTALS = 150
/** How many turns the curtains make in a second at rest: one a minute. */
const FLOW = 1 / 60

/**
 * What lasts between frames, in two texels. The first: where the curtains are
 * in their turn (x), so a change of pace never makes them jump, and how far
 * the crystals have sunk (y). The second: where the bare scene was last
 * pressed (x, y), 0 to 1, and how many seconds ago (z), which starts long past.
 */
const air: Buffer = buffer({ size: [2, 1], float: 32, filter: 'nearest' }, p => {
  const was = air.at(vec2(0, 0))
  const from = air.at(vec2(1, 0))
  const ptr = pointer(0)
  const pressed = ptr.down * (1 - ptr.over) * min(pointerCount, 1)
  const flowed = fract(was.x + dt * FLOW * (1 + 1.4 * live.work))
  const sunk = fract(was.y + dt * 0.004)
  const weather = first ? vec4(0, 0, 0, 1) : vec4(flowed, sunk, 0, 1)
  const place = first ? vec4(0.5, 0.5, 30, 1) : vec4(mix(from.x, ptr.where.x, pressed), mix(from.y, ptr.where.y, pressed), mix(min(from.z + dt, 30), 0, pressed), 1)
  return p.cell.x < 0.5 ? weather : place
})

/** A steady number from 0 to 1 for each seed. */
const rand = (n: number) => fract(sin(n * 91.3458) * 47453.5453)

/**
 * How bright one curtain is at a place in the scene's own units: it hangs from
 * a slow wave, bright just under its top edge and fading to its foot, in
 * upright rays that shift. `turn` is the turn of the curtains, 0 to 2 PI, and
 * goes in only in whole multiples, so its wrap never shows.
 */
const curtain = (x: number, y: number, turn: number, top: number, depth: number, n: number) => {
  const edge = top + sin(x / 190 + n * 2.1 + turn) * 46 + sin(x / 67 + n - turn * 2) * 16
  const deep = depth * (0.72 + 0.28 * sin(x / 113 + n * 1.3 + turn))
  const down = (y - edge) / deep
  const hang = smoothstep(0, 0.16, down) * (1 - smoothstep(0.16, 1, down))
  const rays = 0.6 + 0.4 * sin(x / 19 + n * 1.7 + 2.5 * sin(x / 71 + turn * 3 + n))
  return hang * hang * rays
}

/** The sky: the three curtains, and the light around the prompt box and at the pointer. */
const sky = picture(p => {
  const k = max(size.x / 1600, size.y / 900)
  const state = air.at(vec2(0, 0))
  const from = air.at(vec2(1, 0))
  // The pixel, the pointer and the press in the scene's own 1600x900 units, y down as the scene has it.
  const x = 800 + (p.point.x - size.x / 2) / k
  const y = 450 - (p.point.y - size.y / 2) / k
  const ptr = pointer(0)
  const there = min(pointerCount, 1) * exp(-ptr.gone * 2)
  const over = exp(-abs(p.point.x - ptr.at.x) / (170 * k)) * there
  const fold = smoothstep(110 * k, 0, abs(abs(p.point.x - from.x * size.x) - from.z * 520 * k)) * exp(-from.z * 0.9)
  const turn = state.x * 6.2832
  const breath = 1 + 0.12 * sin(time * 0.9) * live.work
  // Kept to the sky: the curtains fade out before the mountains' shoulders.
  const strength = (0.17 + 0.3 * live.work) * (1 + 0.9 * over + 1.4 * fold) * breath * (1 - smoothstep(330, 480, y))
  const green = curtain(x, y, turn, 150, 330, 0) * strength
  const blue = curtain(x, y, turn, 230, 300, 1) * strength
  const rose = curtain(x, y, turn, 110, 260, 2) * strength
  const low = vec2(vec2(composer.x, composer.y) * size)
  const high = vec2(vec2(composer.z, composer.w) * size)
  const outside = vec2(max(max(low - p.point, p.point - high), 0))
  const hasBox = step(0.001, composer.z - composer.x)
  const hearth = exp(-length(outside) / 150) * (0.18 + 0.22 * live.work) * breath * hasBox
  const lantern = exp(-length(p.point - ptr.at) / 100) * 0.12 * there
  const colour = vec3(vec3(0.64, 0.75, 0.55) * green + vec3(0.53, 0.75, 0.82) * (blue + hearth + lantern) + vec3(0.77, 0.64, 0.75) * rose)
  const all = green + blue + rose + hearth + lantern
  const kept = min(0.6, all) / max(all, 0.0001)
  return vec4(colour * kept, all * kept)
})

/** The crystals: small points that sink very slowly and glitter, each in its own time, brighter near the pointer and after a press. */
const dust = shapes(
  { count: 1, instances: CRYSTALS, draw: 'points', cover: 1 },
  (_vertex, i) => {
    const state = air.at(vec2(0, 0))
    const from = air.at(vec2(1, 0))
    const near = rand(i + 0.37)
    // A whole number of falls for each turn of `sunk`, so its wrap never shows.
    const pace = floor(1 + near * 1.99)
    const fall = fract(rand(i * 1.31 + 7) + state.y * pace)
    const sway = sin(time * (0.2 + 0.3 * rand(i * 2.17)) + rand(i * 3.7) * 6.283) * 0.012
    const spot = vec2(vec2(-0.05 + 1.1 * fract(rand(i * 5.11 + 3) + sway), 1.04 - 1.08 * fall) * size)
    const ptr = pointer(0)
    const lit = exp(-length(spot - ptr.at) / 120) * min(pointerCount, 1) * exp(-ptr.gone * 3)
    const glint = pow(0.5 + 0.5 * sin(time * (1.5 + 2 * rand(i * 7.9)) + rand(i * 4.3) * 6.283), 4)
    const shine = (0.12 + 0.88 * glint) * (1 + 2 * lit + 2 * exp(-from.z * 2))
    return { at: vec2((spot / size) * 2 - 1), size: clamp((mix(1.6, 5, near * near) * (1 + lit)) / px, 1, 64), a: vec4(near, min(shine, 1.6), 0, 0) }
  },
  s => {
    const r = length(s.coord - 0.5) * 2
    const alpha = min(0.9, smoothstep(1, 0, r) * mix(0.5, 0.34, s.a.x) * s.a.y)
    return vec4(vec3(0.93, 0.96, 1) * alpha, alpha)
  },
)

export default shader({ fps: 30, passes: [air, sky, dust] })
