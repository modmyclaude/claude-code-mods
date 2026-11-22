// The halloween look on the GPU: embers that rise from the pumpkin patch, more
// of them while Claude works, that gather and circle about the pointer and
// flare outward from where the bare scene is pressed; low violet fog that
// rolls along the ground and opens around the pointer; firelight on the two
// patches and around the prompt box, flickering as a candle does. The desktop
// app plays this file; the engine only reads it. The scene beneath is whole
// without it.

import { buffer, clamp, composer, dt, exp, first, floor, fract, length, max, min, mix, picture, pointer, pointerCount, px, shader, shapes, sin, size, smoothstep, step, time, values, vec2, vec3, vec4 } from 'claude-code/shader'
import type { Buffer } from 'claude-code/shader'

/** What register.tsx sends: whether Claude works. */
const live = values({ work: [0, 1] })

/** How many embers rise when the fire is at its highest. */
const EMBERS = 240
/** How many turns of the embers' own clock pass in a second; an ember rises one to three times a turn. */
const RISE = 0.03

/**
 * What lasts between frames, in two texels. The first: how far the embers
 * have risen (x), so a change of pace never makes one jump, the flare still
 * in the fire (y), which a press on the bare scene starts and time lets die,
 * and how far the fog has rolled (z). The second: where that press was (x, y),
 * 0 to 1.
 */
const air: Buffer = buffer({ size: [2, 1], float: 32, filter: 'nearest' }, p => {
  const was = air.at(vec2(0, 0))
  const from = air.at(vec2(1, 0))
  const ptr = pointer(0)
  const pressed = ptr.down * (1 - ptr.over) * min(pointerCount, 1)
  const risen = fract(was.x + dt * RISE * (1 + 0.8 * live.work))
  const flare = max(was.y * exp(-dt * 1.2), pressed)
  const rolled = fract(was.z + dt / 90)
  const weather = first ? vec4(0, 0, 0, 1) : vec4(risen, flare, rolled, 1)
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

/** The fog and the firelight: on the ground, on the two pumpkin patches, around the prompt box and at the pointer. */
const mist = picture(p => {
  const k = max(size.x / 1600, size.y / 900)
  const state = air.at(vec2(0, 0))
  // The pixel in the scene's own 1600x900 units, y down as the scene has it.
  const x = 800 + (p.point.x - size.x / 2) / k
  const y = 450 - (p.point.y - size.y / 2) / k
  const ptr = pointer(0)
  const there = min(pointerCount, 1) * exp(-ptr.gone * 2)
  const about = exp(-length(p.point - ptr.at) / 120) * there
  // The fog lies in a band over the ground and rolls; its turn goes in only in whole multiples, so its wrap never shows.
  const turn = state.z * 6.2832
  const band = smoothstep(560, 700, y) * (1 - smoothstep(800, 900, y))
  const roll = 0.5 + 0.5 * sin(x / 210 + turn + 2 * sin(x / 97 - turn * 2) + y / 60)
  const fog = band * (0.35 + 0.65 * roll) * (0.1 + 0.07 * live.work) * (1 - 0.85 * about)
  const flicker = 1 + (0.06 * sin(time * 7.3) + 0.04 * sin(time * 12.1 + 1)) * (0.5 + 0.5 * live.work)
  const patches = exp(-length(p.point - inWindow(250, 850)) / (170 * k)) + exp(-length(p.point - inWindow(1450, 742)) / (120 * k))
  const fire = patches * (0.05 + 0.11 * live.work + 0.2 * state.y) * flicker
  const low = vec2(vec2(composer.x, composer.y) * size)
  const high = vec2(vec2(composer.z, composer.w) * size)
  const outside = vec2(max(max(low - p.point, p.point - high), 0))
  const hasBox = step(0.001, composer.z - composer.x)
  const hearth = exp(-length(outside) / 150) * (0.16 + 0.18 * live.work) * flicker * hasBox
  const wisp = exp(-length(p.point - ptr.at) / 90) * 0.14 * there
  const colour = vec3(vec3(0.72, 0.56, 0.95) * fog + vec3(1, 0.58, 0.2) * (fire + hearth) + vec3(1, 0.72, 0.3) * wisp)
  const all = fog + fire + hearth + wisp
  const kept = min(0.6, all) / max(all, 0.0001)
  return vec4(colour * kept, all * kept)
})

/** The embers: one soft point each, rising from the patches and the ground between, wavering, dying as they climb. */
const sparks = shapes(
  { count: 1, instances: EMBERS, draw: 'points', cover: 1 },
  (_vertex, i) => {
    const state = air.at(vec2(0, 0))
    const from = air.at(vec2(1, 0))
    const near = rand(i + 0.37)
    // A whole number of rises for each turn of `risen`, so its wrap never shows.
    const pace = floor(1 + near * 2.99)
    const life = fract(rand(i * 1.31 + 7) + state.x * pace)
    // Four in ten from the left patch, three from the right, the rest from anywhere along the ground.
    const which = rand(i * 6.7)
    const along = rand(i * 5.11 + 3)
    const home = which < 0.4 ? mix(110, 400, along) : which < 0.7 ? mix(1380, 1520, along) : mix(0, 1600, along)
    const waver = sin(life * 9 + rand(i * 3.7) * 6.283) * 26 + sin(time * 0.7 + i) * 10
    let spot = inWindow(home + waver + 60 * life, mix(850, 220 + 200 * rand(i * 2.9), life))
    // They gather about the pointer and circle it.
    const ptr = pointer(0)
    const there = min(pointerCount, 1) * exp(-ptr.gone * 2)
    const to = vec2(ptr.at - spot)
    const far = length(to)
    const pull = smoothstep(240, 60, far) * 0.6 * there
    spot = vec2(spot + to * pull + (vec2(-to.y, to.x) / max(far, 1)) * sin(time * 1.7 + i) * 26 * pull)
    // A press on the bare scene throws them outward from there.
    const blown = vec2(spot - vec2(from.x, from.y) * size)
    const reach = length(blown)
    spot = vec2(spot + (blown / max(reach, 1)) * state.y * (0.4 + near) * 140 * exp(-reach / 420))
    const fade = smoothstep(0, 0.08, life) * (1 - smoothstep(0.55, 1, life))
    const flick = 0.7 + 0.3 * sin(time * (5 + 6 * rand(i * 2.17)) + i)
    const burns = step(rand(i * 9.7), 0.45 + 0.55 * live.work)
    return { at: vec2((spot / size) * 2 - 1), size: clamp((mix(2.5, 9, near * near) * (1 + 0.5 * state.y)) / px, 1, 64), a: vec4(near, min(1, fade * flick * burns * (1 + state.y)), rand(i * 7.9), 0) }
  },
  s => {
    const core = smoothstep(1, 0, length(s.coord - 0.5) * 2)
    const alpha = core * core * s.a.y * 0.85
    return vec4(mix(vec3(1, 0.55, 0.17), vec3(1, 0.82, 0.4), s.a.z * core) * alpha, alpha)
  },
)

export default shader({ fps: 30, passes: [air, mist, sparks] })
