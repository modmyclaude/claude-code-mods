// The three sports looks' scenes. A team's two colours, where the settings give them, paint the seats, the banners, the
// court's paint and the end zones; a rink's ice keeps its own blue and red lines.
// Each is a function of the theme, so every colour comes from the look's own
// palette and the picture stays on-look. Every moving part rests where its
// markup puts it, so the still picture the desktop draws under reduced motion
// is a finished one.

import { alpha, anim, BLEED, BOLT_HERE, circle, coarse, drift, ellipse, few, glow, group, HEIGHT, layer, line, linear, mix, n, paint, PARALLAX, path, pattern, polygon, pulse, radial, rect, RISE, rnd, stars, SWAY, vignette, WIDTH } from './scene-kit'
import type { Scene } from './scene-kit'
import { themeById } from './themes'
import type { Theme } from './themes'

type Make = (theme: Theme) => Scene
type Palette = Theme['palette']
type Place = readonly [number, number]

/** The two colours a sports scene paints its seats, banners and lines with: the team's where the settings give them, else the look's own. Never words. */
function colours(theme: Theme): { primary: string; secondary: string } {
  const p = theme.palette
  return theme.team ? { primary: mix(theme.team.primary, p.accent, 0.25), secondary: mix(theme.team.secondary, p.special, 0.25) } : { primary: p.accent, secondary: p.special }
}

/**
 * A playing surface seen from above one long side. `at(x, z)` puts a place on
 * it on the picture (x along its length from the middle, z across it from the
 * near side, in the sport's own units), `up` lifts that place off the ground,
 * `trace` joins places into a path, and `arc` walks a circle lying on it.
 */
function surface(halfLength: number, depth: number, nearY: number, farY: number, nearHalf: number, farHalf: number) {
  const s0 = nearHalf / halfLength
  const s1 = farHalf / halfLength
  const d = (s1 * depth) / (s0 - s1)
  const f = s0 * d
  const c = (nearY - farY) / (s0 - s1)
  const horizon = nearY - c * s0
  const scale = (z: number): number => f / (z + d)
  const at = (x: number, z: number): [number, number] => [WIDTH / 2 + x * scale(z), horizon + c * scale(z)]
  const up = (x: number, z: number, h: number): [number, number] => {
    const [px, py] = at(x, z)
    return [px, py - h * scale(z)]
  }
  const join = (points: readonly Place[], close: boolean): string => points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${n(px)} ${n(py)}`).join('') + (close ? 'z' : '')
  const trace = (places: readonly Place[], close = false): string => join(places.map(([x, z]) => at(x, z)), close)
  const lifted = (places: readonly Place[], h: number): [number, number][] => places.map(([x, z]) => up(x, z, h))
  /** A wall standing on a line of places, from height `h0` to `h1`. */
  const wall = (places: readonly Place[], h0: number, h1: number): string => join([...lifted(places, h0), ...lifted(places, h1).reverse()], true)
  const arc = (cx: number, cz: number, r: number, a0: number, a1: number, count = 28): [number, number][] => {
    // A thumbnail keeps enough of a curve to stay round.
    const steps = Math.max(Math.min(count, 14), Math.round(count / coarse(1)))
    return Array.from({ length: steps + 1 }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / steps
      return [cx + Math.cos(a) * r, cz + Math.sin(a) * r] as [number, number]
    })
  }
  return { at, up, scale, join, trace, lifted, wall, arc }
}

const TURN = Math.PI * 2

/**
 * The bowl of an indoor arena around the playing surface: an upper tier under
 * the rafters, lamps and plain banners (far), a lower tier with its tunnels
 * (middle), beams of light, and a scoreboard hung over the middle that shows
 * light and no figures. Seats in the two colours, by section.
 */
function arena(id: string, p: Palette, primary: string, secondary: string, floorY: number): { defs: string; style: string; far: string; mid: string; beams: string } {
  const dark = mix(p.bg, '#000000', 0.55)
  const steel = mix(p.bg, p.text, 0.14)
  const seat = (name: string, colour: string) =>
    pattern(`${id}-${name}`, 14, 13, rect(2, 4, 10, 8, mix(colour, p.bg, 0.42), { rx: 2 }) + rect(2, 4, 10, 2.5, mix(colour, p.bg, 0.12), { rx: 1 }))
  const defs =
    seat('s1', primary) +
    seat('s2', secondary) +
    seat('s3', mix(p.muted, p.bg, 0.3)) +
    linear(`${id}-dim`, [
      [0, dark, 0.92],
      [1, dark, 0.1],
    ]) +
    linear(`${id}-beam`, [
      [0, p.text, 0.3],
      [0.7, p.text, 0.06],
      [1, p.text, 0],
    ]) +
    linear(`${id}-screen`, [
      [0, mix(p.warn, p.text, 0.5)],
      [1, mix(p.warn, p.bg, 0.3)],
    ]) +
    glow(`${id}-lamp`, p.text, 0.55) +
    glow(`${id}-score`, p.warn, 0.34) +
    glow(`${id}-tunnel`, p.warn, 0.5)
  const tier = (top: number, height: number, shift: number): string => {
    let out = rect(-BLEED, top, WIDTH + 2 * BLEED, height, dark)
    let k = shift
    for (let x = -BLEED - 20; x < WIDTH + BLEED; x += 196) {
      out += rect(x + 7, top + 4, 182, height - 8, paint(`${id}-${k % 3 === 2 ? 's3' : k % 3 === 1 ? 's2' : 's1'}`))
      k += 1
    }
    return out
  }
  // Far: the upper tier, dimming toward the roof, the truss, its lamps and the banners.
  const upperTop = 226
  const lowerTop = floorY - 156
  const upper = tier(upperTop, lowerTop - upperTop - 26, 0) + rect(-BLEED, upperTop - 40, WIDTH + 2 * BLEED, lowerTop - upperTop + 20, paint(`${id}-dim`))
  let truss = `M${-BLEED} 66H${WIDTH + BLEED}M${-BLEED} 104H${WIDTH + BLEED}`
  for (let x = -BLEED; x < WIDTH + BLEED; x += coarse(76)) truss += `M${n(x)} 104L${n(x + coarse(38))} 66L${n(x + coarse(76))} 104`
  const rafters = path(truss, { fill: 'none', stroke: steel, 'stroke-width': 3 }) + path(`M${-BLEED} 30H${WIDTH + BLEED}`, { fill: 'none', stroke: mix(p.bg, p.text, 0.07), 'stroke-width': 5 })
  const lampAt = [190, 430, 1170, 1410, 620, 980]
  const lamps = lampAt
    .map((x, i) => circle(x, 112, 150, paint(`${id}-lamp`), { opacity: 0.8, class: 'lampg', style: `animation-delay:${n(-i * 1.7)}s` }) + rect(x - 24, 104, 48, 9, p.text, { rx: 2, opacity: 0.95 }) + rect(x - 30, 98, 60, 7, steel))
    .join('')
  const beams = lampAt
    .slice(0, few(6))
    .map((x, i) => polygon([[x - 22, 112], [x + 22, 112], [x + 190 + (i % 2) * 40, floorY + 250], [x - 190 - (i % 2) * 40, floorY + 250]], paint(`${id}-beam`), { opacity: 0.5, class: 'beam', style: `animation-delay:${n(-i * 2.3)}s` }))
    .join('')
  const banner = (x: number, i: number): string => {
    const [w, h] = [58, 132 - (i % 3) * 14]
    const [own, other] = i % 2 === 0 ? [primary, secondary] : [secondary, primary]
    return group(
      rect(x - 5, 104, w + 10, 5, steel) + path(`M${x} 108h${w}v${h}l${-w / 2} -17l${-w / 2} 17z`, { fill: mix(own, p.bg, 0.25) }) + rect(x, 108 + h * 0.3, w, 9, mix(other, p.bg, 0.2)) + rect(x, 108 + h * 0.3 + 14, w, 3, mix(other, p.bg, 0.2)),
      { class: 'ban', style: `animation-delay:${n(-i * 1.3)}s` },
    )
  }
  const banners = [116, 204, 292, 1250, 1338, 1426].map(banner).join('')
  // The scoreboard: a box on cables with four faces of light and a ring under it.
  const [bx, by] = [WIDTH / 2, 62]
  const face = (x: number, w: number, skew: number): string =>
    polygon([[x, by + 8], [x + w, by + 8 + skew], [x + w, by + 96 + skew * 0.4], [x, by + 96]], paint(`${id}-screen`), { opacity: 0.86, class: 'screen' }) +
    [0, 1, 2].map(k => rect(x + 10, by + 22 + k * 22, (w - 20) * (0.9 - k * 0.24), 8, mix(p.text, p.warn, 0.3), { rx: 2, opacity: 0.6 })).join('')
  const score =
    circle(bx, by + 56, 300, paint(`${id}-score`), { opacity: 0.9, class: 'scoreg' }) +
    path(`M${bx - 70} 0V${by}M${bx + 70} 0V${by}M${bx - 24} 0V${by}M${bx + 24} 0V${by}`, { fill: 'none', stroke: steel, 'stroke-width': 2 }) +
    polygon([[bx - 118, by], [bx + 118, by], [bx + 104, by + 106], [bx - 104, by + 106]], mix(p.bg, '#000000', 0.5), { stroke: steel, 'stroke-width': 3 }) +
    face(bx - 98, 92, 0) +
    face(bx + 6, 92, 0) +
    ellipse(bx, by + 118, 122, 13, mix(p.bg, '#000000', 0.4), { stroke: mix(primary, p.bg, 0.2), 'stroke-width': 5 }) +
    ellipse(bx, by + 118, 96, 8, mix(secondary, p.bg, 0.45), { opacity: 0.7 })
  // Middle: the lower tier, its tunnels glowing, and the rail above the floor.
  let tunnels = ''
  for (let x = 176; x < WIDTH; x += 392) tunnels += ellipse(x + 22, lowerTop + 78, 70, 44, paint(`${id}-tunnel`), { opacity: 0.6 }) + rect(x, lowerTop + 58, 44, 34, mix(p.bg, '#000000', 0.7), { rx: 3 }) + rect(x + 6, lowerTop + 64, 32, 28, mix(p.warn, p.bg, 0.45), { rx: 2 })
  const lower = tier(lowerTop, 138, 1) + tunnels + rect(-BLEED, lowerTop - 26, WIDTH + 2 * BLEED, 26, mix(p.bg, '#000000', 0.66)) + path(`M${-BLEED} ${lowerTop - 26}H${WIDTH + BLEED}`, { fill: 'none', stroke: steel, 'stroke-width': 2 })
  let boards = rect(-BLEED, floorY - 20, WIDTH + 2 * BLEED, 22, mix(p.bg, '#000000', 0.42))
  for (let x = -BLEED, k = 0; x < WIDTH + BLEED; x += 152, k += 1) boards += rect(x + 4, floorY - 16, 144, 12, mix(k % 2 === 0 ? primary : secondary, p.bg, 0.38), { rx: 2, opacity: 0.85 })
  const style =
    pulse('lampg', 0.6, 0.9, 11) +
    pulse('beam', 0.34, 0.6, 13) +
    pulse('screen', 0.7, 0.95, 6) +
    pulse('scoreg', 0.7, 1, 6) +
    '@keyframes ban{0%,100%{transform:rotate(-1.4deg)}50%{transform:rotate(1.4deg)}}.ban{transform-box:fill-box;transform-origin:center top;animation:ban 9s ease-in-out infinite}'
  return { defs, style, far: upper + rafters + lamps + banners + score, mid: lower + boards, beams }
}

/** An empty basketball arena under the lights: a maple floor, the painted lane and arc, two hoops, a ball bouncing. */
const hardwood: Make = theme => {
  const p = theme.palette
  const { primary, secondary } = colours(theme)
  const s = surface(47, 50, 886, 566, 760, 500)
  const v = vignette('hw-vig', mix(p.bg, '#000000', 0.8), 0.72)
  const hall = arena('hw', p, primary, secondary, 566)
  // The floor's own colours never follow a team: maple, the rim and the ball stay what they are.
  const maple = mix(mix(p.warn, p.text, 0.5), p.bg, 0.2)
  const orange = mix(p.error, p.warn, 0.5)
  const chalk = alpha(p.text, 0.9)
  const defs =
    hall.defs +
    linear('hw-air', [
      [0, mix(p.bg, '#000000', 0.7)],
      [0.5, mix(p.bg, '#000000', 0.35)],
      [1, p.bg],
    ]) +
    linear('hw-floor', [
      [0, mix(maple, p.bg, 0.42)],
      [0.45, mix(maple, p.bg, 0.12)],
      [1, mix(maple, p.bg, 0.3)],
    ]) +
    glow('hw-pool', mix(p.text, p.warn, 0.3), 0.36) +
    radial('hw-ball', [
      [0, mix(orange, p.text, 0.35)],
      [0.6, orange],
      [1, mix(orange, p.bg, 0.5)],
    ]) +
    v.defs
  const court: Place[] = [[-47, 0], [47, 0], [47, 50], [-47, 50]]
  let planks = ''
  for (let z = 2.5; z < 50; z += coarse(2.5)) planks += s.trace([[-47, z], [47, z]])
  // Each end: the painted lane, the free-throw circle, the arc, and the hoop on its arm.
  const reach = Math.asin(22 / 23.75)
  const end = (side: 1 | -1): { paintwork: string; lines: string; hoop: string } => {
    const lane: Place[] = [[47 * side, 17], [28 * side, 17], [28 * side, 33], [47 * side, 33]]
    const middle = side === 1 ? Math.PI : 0
    const arc = s.arc(41.75 * side, 25, 23.75, middle - reach, middle + reach, 36)
    const lines =
      s.trace(lane, true) +
      s.trace(s.arc(28 * side, 25, 6, 0, TURN), true) +
      s.trace([[47 * side, side === 1 ? 47 : 3], ...arc, [47 * side, side === 1 ? 3 : 47]]) +
      s.trace(s.arc(41.75 * side, 25, 4, middle - Math.PI / 2, middle + Math.PI / 2, 14))
    // The hoop, seen from the side: a padded base behind the line, an arm, the glass edge-on, the rim and its net.
    const dark = mix(p.bg, '#000000', 0.5)
    const [fx, fy] = s.at(54 * side, 25)
    const [ax, ay] = s.up(53.5 * side, 25, 9.6)
    const [gx, gy] = s.up(43.4 * side, 25, 11.2)
    const glass = [s.up(43 * side, 21.6, 13.2), s.up(43 * side, 28.4, 13.2), s.up(43 * side, 28.4, 9.4), s.up(43 * side, 21.6, 9.4)]
    const [rx, ry] = s.up(41.4 * side, 25, 10)
    let net = ''
    for (let k = -2; k <= 2; k += 1) net += `M${n(rx + k * 7.5)} ${n(ry + 2)}L${n(rx + k * 4.4)} ${n(ry + 30)}`
    net += `M${n(rx - 13)} ${n(ry + 11)}H${n(rx + 13)}M${n(rx - 10.6)} ${n(ry + 21)}H${n(rx + 10.6)}`
    const hoop =
      ellipse(fx, fy + 4, 46, 9, alpha('#000000', 0.34)) +
      rect(fx - 24, fy - 62, 48, 64, mix(primary, p.bg, 0.5), { rx: 6 }) +
      rect(fx - 24, fy - 62, 48, 10, mix(primary, p.bg, 0.25), { rx: 5 }) +
      path(`M${n(fx)} ${n(fy - 58)}L${n(ax)} ${n(ay)}L${n(gx)} ${n(gy)}`, { fill: 'none', stroke: dark, 'stroke-width': 11, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }) +
      path(`M${n(fx)} ${n(fy - 58)}L${n(ax)} ${n(ay)}L${n(gx)} ${n(gy)}`, { fill: 'none', stroke: mix(p.bg, p.text, 0.2), 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }) +
      polygon(glass, alpha(p.text, 0.2), { stroke: alpha(p.text, 0.85), 'stroke-width': 2.4 }) +
      polygon([s.up(43 * side, 24, 11.7), s.up(43 * side, 26, 11.7), s.up(43 * side, 26, 10.1), s.up(43 * side, 24, 10.1)], 'none', { stroke: orange, 'stroke-width': 1.6 }) +
      path(net, { fill: 'none', stroke: alpha(p.text, 0.8), 'stroke-width': 1.3 }) +
      ellipse(rx, ry, 17, 5, 'none', { stroke: orange, 'stroke-width': 3.4 })
    return { paintwork: path(s.trace(lane, true), { fill: mix(primary, maple, 0.16), opacity: 0.94 }), lines, hoop }
  }
  const [right, left] = [end(1), end(-1)]
  const centre = s.arc(0, 25, 6, 0, TURN)
  const lines = path(s.trace(court, true) + s.trace([[0, 0], [0, 50]]) + s.trace(centre, true) + right.lines + left.lines, { fill: 'none', stroke: chalk, 'stroke-width': 3, 'stroke-linejoin': 'round' })
  const [px, py] = s.at(0, 25)
  // Light on the boards: a pool in the middle and the lamps' long reflections.
  let shine = ellipse(px, py + 8, 560, 104, paint('hw-pool'))
  for (const [x, w] of [[300, 46], [560, 30], [1040, 30], [1300, 46]] as const) shine += polygon([[x - w, 572], [x + w, 572], [x + w * 2.4, 880], [x - w * 2.4, 880]], alpha(p.text, 0.045))
  // The ball: mid-bounce where it is drawn, its shadow waiting on the floor.
  const [ballX, floorY] = s.at(12, 17)
  const ball =
    ellipse(ballX, floorY + 2, 17, 4.6, alpha('#000000', 0.36), { class: 'hw-shade' }) +
    group(
      circle(ballX, floorY - 74, 16, paint('hw-ball')) + path(`M${n(ballX - 16)} ${n(floorY - 74)}h32M${n(ballX)} ${n(floorY - 90)}v32M${n(ballX - 11)} ${n(floorY - 85.5)}q9 11.5 0 23M${n(ballX + 11)} ${n(floorY - 85.5)}q-9 11.5 0 23`, { fill: 'none', stroke: mix(p.bg, '#000000', 0.3), 'stroke-width': 1.2, opacity: 0.8 }),
      { class: 'hw-ball' },
    )
  // Courtside: the backs of the front row along the foot of the picture.
  let chairs = ''
  for (let x = -BLEED; x < WIDTH + BLEED; x += coarse(50)) chairs += `M${n(x)} ${HEIGHT}v-26a9 9 0 0 1 9 -9h24a9 9 0 0 1 9 9v26z`
  const front = rect(-BLEED, HEIGHT - 12, WIDTH + 2 * BLEED, 12, mix(p.bg, '#000000', 0.7)) + path(chairs, { fill: mix(mix(primary, p.bg, 0.6), '#000000', 0.35) })
  const dust = drift(41, 30, 'hw-dust', 90, (x, y, k, pick) => circle(x, y * 0.8, 1 + pick() * 1.5, alpha(k % 3 === 0 ? p.warn : p.text, 0.3 + pick() * 0.25)))
  return {
    alt: 'An empty basketball arena under the lights: a maple floor with its painted lanes, arcs and centre circle, a hoop at each end, tiers of seats in two colours, plain banners and a glowing scoreboard overhead, and one ball bouncing.',
    bolt: { x: 1112, y: 566 },
    defs,
    style:
      PARALLAX +
      hall.style +
      RISE +
      anim('hw-dust', 'rise') +
      '@keyframes hw-ball{0%,100%{transform:translateY(60px);animation-timing-function:ease-out}50%{transform:translateY(-64px);animation-timing-function:ease-in}}.hw-ball{animation:hw-ball 2.6s linear infinite}' +
      pulse('hw-shade', 0.5, 1, 2.6),
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('hw-air')) +
      layer('far', hall.far) +
      layer('mid', hall.mid) +
      hall.beams +
      layer(
        'near',
        rect(-BLEED, 566, WIDTH + 2 * BLEED, HEIGHT - 566, mix(maple, p.bg, 0.74)) +
          path(s.trace(court, true), { fill: paint('hw-floor') }) +
          path(planks, { fill: 'none', stroke: mix(maple, p.bg, 0.5), 'stroke-width': 1, opacity: 0.5 }) +
          shine +
          right.paintwork +
          left.paintwork +
          path(s.trace(centre, true), { fill: mix(secondary, maple, 0.2), opacity: 0.92 }) +
          lines +
          left.hoop +
          right.hoop +
          ball +
          ellipse(1172, 688, 66, 9, alpha('#000000', 0.32)) +
          BOLT_HERE +
          front,
      ) +
      dust +
      v.body,
  }
}

/** A football stadium at night: the field in its stripes, an end zone in the team's colour, the posts, the crowd's lights, a ball in the air. */
const gridiron: Make = theme => {
  const p = theme.palette
  const { primary, secondary } = colours(theme)
  const r = rnd(73)
  const s = surface(60, 53.3, 892, 592, 880, 600)
  const v = vignette('gi-vig', mix(p.bg, '#000000', 0.85), 0.74)
  // Turf, chalk, the posts and the ball keep their own colours whatever the team.
  const turf = mix(p.ok, p.bg, 0.6)
  const gold = mix(p.warn, p.text, 0.3)
  const leather = mix(mix(p.warn, p.error, 0.4), p.bg, 0.45)
  const dark = mix(p.bg, '#000000', 0.55)
  const steel = mix(p.bg, p.text, 0.16)
  const defs =
    linear('gi-sky', [
      [0, mix(p.bg, '#000000', 0.6)],
      [0.2, mix(mix(p.bg, p.info, 0.1), '#000000', 0.3)],
      [0.4, mix(p.bg, p.info, 0.24)],
      [1, p.bg],
    ]) +
    linear('gi-turf', [
      [0, mix(turf, p.bg, 0.4), 0.55],
      [0.5, turf, 0],
      [1, mix(turf, p.bg, 0.5), 0.5],
    ]) +
    linear('gi-beam', [
      [0, p.text, 0.2],
      [0.55, p.text, 0.05],
      [1, p.text, 0],
    ]) +
    linear('gi-dim', [
      [0, dark, 0.7],
      [1, dark, 0],
    ]) +
    glow('gi-lamp', p.text, 0.6) +
    glow('gi-haze', mix(p.text, p.info, 0.4), 0.22) +
    glow('gi-pool', mix(p.text, p.ok, 0.4), 0.2) +
    glow('gi-mist', mix(p.text, p.ok, 0.5), 0.24) +
    pattern('gi-s1', 12, 11, rect(1.5, 3, 9, 6, mix(primary, p.bg, 0.5), { rx: 1.5 })) +
    pattern('gi-s2', 12, 11, rect(1.5, 3, 9, 6, mix(secondary, p.bg, 0.55), { rx: 1.5 })) +
    pattern('gi-s3', 12, 11, rect(1.5, 3, 9, 6, mix(p.muted, p.bg, 0.62), { rx: 1.5 })) +
    glow('gi-glow', mix(p.text, p.ok, 0.35), 0.3) +
    v.defs
  // Far: the upper deck against the sky, its floodlight towers, the crowd's lights.
  const deck = `M${-BLEED} 336Q${WIDTH / 2} 262 ${WIDTH + BLEED} 336V480H${-BLEED}z`
  const brim = (x: number): number => 336 - 37 * (1 - ((x - WIDTH / 2) / (WIDTH / 2 + BLEED)) ** 2)
  const crowd = (count: number, top: (x: number) => number, foot: number): string => {
    let out = ''
    const total = few(count)
    const tints = [p.text, p.warn, mix(primary, p.text, 0.5), mix(secondary, p.text, 0.5), p.info]
    for (let i = 0; i < total; i += 1) {
      const x = -BLEED + r() * (WIDTH + 2 * BLEED)
      const y = top(x) + 10 + r() * (foot - top(x) - 16)
      const twinkles = i % 3 === 0
      out += circle(x, y, 0.9 + r() * 1.3, tints[i % tints.length]!, twinkles ? { opacity: 0.4 + r() * 0.5, class: 'tw', style: `animation-delay:${n(-r() * 8)}s` } : { opacity: 0.25 + r() * 0.5 })
    }
    return out
  }
  const tower = (x: number, i: number): string => {
    const top = brim(x) - 150
    let bank = ''
    for (let row = 0; row < 3; row += 1) for (let col = 0; col < 6; col += 1) bank += `M${n(x - 45 + col * 15.5)} ${n(top + 5 + row * 13)}h11v9h-11z`
    return (
      circle(x, top + 22, 270, paint('gi-haze'), { opacity: 0.85, class: 'lampg', style: `animation-delay:${n(-i * 2.1)}s` }) +
      path(`M${n(x - 5)} ${n(brim(x) + 6)}L${n(x - 3)} ${n(top + 40)}h6L${n(x + 5)} ${n(brim(x) + 6)}zM${n(x - 16)} ${n(brim(x) + 6)}L${n(x)} ${n(top + 70)}L${n(x + 16)} ${n(brim(x) + 6)}`, { fill: 'none', stroke: steel, 'stroke-width': 3 }) +
      rect(x - 52, top, 104, 46, mix(p.bg, '#000000', 0.5), { rx: 4, stroke: steel, 'stroke-width': 2 }) +
      path(bank, { fill: p.text, opacity: 0.96 }) +
      circle(x, top + 22, 96, paint('gi-lamp'), { opacity: 0.9 })
    )
  }
  const towerAt = [150, 520, 1080, 1450]
  const towers = towerAt.map(tower).join('')
  // Each bank's light falls over the stands toward the middle of the field.
  const beams = towerAt
    .map((x, i) => {
      const lean = (WIDTH / 2 - x) * 0.36
      return polygon([[x - 46, brim(x) - 106], [x + 46, brim(x) - 106], [x + lean + 300, 800], [x + lean - 300, 800]], paint('gi-beam'), { opacity: 0.42, class: 'beam', style: `animation-delay:${n(-i * 3.1)}s` })
    })
    .join('')
  let aisles = ''
  for (let x = -BLEED + 30; x < WIDTH + BLEED; x += coarse(146)) aisles += `M${n(x)} ${n(brim(x) + 4)}V470`
  let boxes = ''
  for (let x = 566; x < 1034; x += coarse(26)) boxes += `M${n(x)} 392h20v11h-20z`
  let ribbon = rect(-BLEED, 458, WIDTH + 2 * BLEED, 20, mix(p.bg, '#000000', 0.62))
  for (let x = -BLEED, k = 0; x < WIDTH + BLEED; x += 132, k += 1) ribbon += rect(x + 4, 462, 124, 9, mix(k % 2 === 0 ? primary : secondary, p.bg, 0.3), { rx: 2, opacity: 0.85 })
  const upper =
    ellipse(WIDTH / 2, 360, 1000, 240, paint('gi-glow')) +
    path(deck, { fill: mix(p.bg, '#000000', 0.3) }) +
    path(deck, { fill: paint('gi-s3'), opacity: 0.75 }) +
    path(aisles, { fill: 'none', stroke: mix(p.bg, '#000000', 0.5), 'stroke-width': 6 }) +
    path(deck, { fill: paint('gi-dim') }) +
    rect(548, 384, 504, 27, mix(p.bg, '#000000', 0.6), { rx: 4 }) +
    path(boxes, { fill: mix(p.warn, p.text, 0.3), opacity: 0.85 }) +
    path(`M${-BLEED} 336Q${WIDTH / 2} 262 ${WIDTH + BLEED} 336`, { fill: 'none', stroke: mix(p.bg, p.text, 0.3), 'stroke-width': 3 }) +
    crowd(150, x => brim(x) + 6, 452) +
    ribbon
  // Middle: the lower deck in the two colours, more lights, and the wall at the field's edge.
  let lower = rect(-BLEED, 474, WIDTH + 2 * BLEED, 104, dark)
  for (let x = -BLEED - 10, k = 0; x < WIDTH + BLEED; x += 180, k += 1) lower += rect(x + 6, 482, 168, 88, paint(k % 2 === 0 ? 'gi-s1' : 'gi-s2'), { opacity: 0.8 })
  lower += rect(-BLEED, 466, WIDTH + 2 * BLEED, 12, mix(p.bg, '#000000', 0.7)) + crowd(120, () => 480, 572)
  const wall =
    rect(-BLEED, 572, WIDTH + 2 * BLEED, 24, mix(p.bg, '#000000', 0.38)) + rect(-BLEED, 572, WIDTH + 2 * BLEED, 4, mix(primary, p.bg, 0.3)) + rect(-BLEED, 590, WIDTH + 2 * BLEED, 3, mix(secondary, p.bg, 0.45))
  // Near: the field. Stripes every five yards, the end zones, chalk lines and hash marks, the posts.
  const field: Place[] = [[-60, 0], [60, 0], [60, 53.3], [-60, 53.3]]
  let pale = ''
  for (let x = -50; x < 50; x += 10) pale += s.trace([[x, 0], [x + 5, 0], [x + 5, 53.3], [x, 53.3]], true)
  let yards = ''
  for (let x = -45; x <= 45; x += 5) yards += s.trace([[x, 0], [x, 53.3]])
  const marks = [1.2, 20, 33.3, 52.1]
    .map(z => {
      const [x0, y] = s.at(-49, z)
      const [x1] = s.at(49, z)
      const step = s.scale(z)
      return line(x0, y, x1, y, alpha(p.text, 0.8), { 'stroke-width': n(0.44 * step), 'stroke-dasharray': `${n(0.14 * step)} ${n(0.86 * step)}` })
    })
    .join('')
  const zone = (side: 1 | -1, colour: string): string => {
    const places: Place[] = [[50 * side, 0], [60 * side, 0], [60 * side, 53.3], [50 * side, 53.3]]
    let bars = ''
    for (let z = 4; z < 53; z += coarse(7)) bars += s.trace([[51 * side, z], [59 * side, z + 3.4], [59 * side, z + 5.4], [51 * side, z + 2]], true)
    return path(s.trace(places, true), { fill: mix(colour, p.bg, 0.3) }) + path(bars, { fill: mix(colour, p.text, 0.3), opacity: 0.45 })
  }
  const post = (side: 1 | -1): string => {
    const z = 26.65
    const [fx, fy] = s.at(62.2 * side, z)
    const [nx, ny] = s.up(62.2 * side, z, 2.5)
    const [cx, cy] = s.up(60 * side, z, 3.33)
    const [lx, ly] = s.up(60 * side, z - 3.1, 3.33)
    const [rx, ry] = s.up(60 * side, z + 3.1, 3.33)
    const [ltx, lty] = s.up(60 * side, z - 3.1, 13)
    const [rtx, rty] = s.up(60 * side, z + 3.1, 13)
    const d = `M${n(fx)} ${n(fy)}L${n(nx)} ${n(ny)}Q${n(nx)} ${n(cy)} ${n(cx)} ${n(cy)}M${n(lx)} ${n(ly)}L${n(rx)} ${n(ry)}M${n(lx)} ${n(ly)}L${n(ltx)} ${n(lty)}M${n(rx)} ${n(ry)}L${n(rtx)} ${n(rty)}`
    return (
      ellipse(fx, fy + 2, 20, 4, alpha('#000000', 0.4)) +
      path(d, { fill: 'none', stroke: mix(gold, p.bg, 0.55), 'stroke-width': 8, 'stroke-linecap': 'round' }) +
      path(d, { fill: 'none', stroke: gold, 'stroke-width': 4.4, 'stroke-linecap': 'round' }) +
      rect(fx - 7, fy - 34, 14, 34, mix(primary, p.bg, 0.3), { rx: 5 }) +
      path(`M${n(ltx)} ${n(lty)}l8 3l-8 4zM${n(rtx)} ${n(rty)}l8 3l-8 4z`, { fill: mix(p.error, p.warn, 0.4), class: 'gi-flag' })
    )
  }
  const pylons = ([[50, 0.4], [50, 52.9], [60, 0.4], [60, 52.9]] as const).flatMap(([x, z]) => [1, -1].map(side => {
    const [px, py] = s.at(x * side, z)
    return rect(px - 3, py - 12, 6, 12, mix(p.error, p.warn, 0.45), { rx: 1 })
  })).join('')
  const [mx, my] = s.at(0, 26)
  const chalk =
    path(yards, { fill: 'none', stroke: alpha(p.text, 0.72), 'stroke-width': 2.2 }) +
    path(s.trace([[-50, 0], [-50, 53.3]]) + s.trace([[50, 0], [50, 53.3]]), { fill: 'none', stroke: alpha(p.text, 0.92), 'stroke-width': 4 }) +
    path(s.trace(field, true), { fill: 'none', stroke: alpha(p.text, 0.92), 'stroke-width': 5, 'stroke-linejoin': 'round' }) +
    marks
  // The ball: at the top of its arc where it is drawn; three groups carry it across, lift it and wobble it.
  const ballShape =
    ellipse(0, 0, 23, 12.5, leather) + path('M-23 0q23 -17 46 0', { fill: 'none', stroke: mix(leather, p.text, 0.25), 'stroke-width': 2 }) + path('M-9 -5h18M-6 -8v6M0 -8.6v7M6 -8v6', { fill: 'none', stroke: alpha(p.text, 0.9), 'stroke-width': 1.6 }) + path('M-15 -9.6v19M15 -9.6v19', { fill: 'none', stroke: alpha(p.text, 0.75), 'stroke-width': 2.2 })
  const ball = group(group(group(group(group(ballShape, { transform: 'rotate(-16)' }), { class: 'gi-wob' }), { transform: 'translate(590 214)' }), { class: 'gi-arc', style: 'animation-delay:-9s' }), { class: 'gi-fly', style: 'animation-delay:-9s' })
  const mist =
    ellipse(360, 604, 620, 46, paint('gi-mist'), { class: 'gi-mist' }) + ellipse(1240, 622, 560, 40, paint('gi-mist'), { class: 'gi-mist', style: 'animation-duration:58s' }) + ellipse(800, 760, 760, 60, paint('gi-mist'), { opacity: 0.7, class: 'gi-mist', style: 'animation-duration:71s' })
  // The near rail along the foot of the picture.
  let rail = `M${-BLEED} ${HEIGHT}V${HEIGHT - 20}H${WIDTH + BLEED}V${HEIGHT}z`
  for (let x = -BLEED; x < WIDTH + BLEED; x += coarse(64)) rail += `M${n(x)} ${HEIGHT - 20}v-22h5v22z`
  const front = path(rail, { fill: mix(p.bg, '#000000', 0.78) }) + path(`M${-BLEED} ${HEIGHT - 42}H${WIDTH + BLEED}`, { fill: 'none', stroke: mix(p.bg, '#000000', 0.6), 'stroke-width': 5 })
  const motes = drift(74, 26, 'gi-mote', 80, (x, y, k, pick) => circle(x, y * 0.75, 1 + pick() * 1.4, alpha(k % 2 === 0 ? p.text : p.warn, 0.28 + pick() * 0.3)))
  return {
    alt: 'A football stadium at night: a striped field with chalk yard lines and hash marks, an end zone in colour at each end, yellow goalposts, floodlight towers over stands full of small lights, low mist, and a ball spiralling across the sky.',
    bolt: { x: 1196, y: 574 },
    defs,
    style:
      PARALLAX +
      RISE +
      anim('gi-mote', 'rise') +
      SWAY +
      '.gi-mist{animation:sway 47s ease-in-out infinite}' +
      pulse('tw', 0.2, 1, 5) +
      pulse('lampg', 0.66, 0.92, 12) +
      pulse('beam', 0.3, 0.5, 14) +
      '@keyframes gi-fly{from{transform:translateX(-1500px)}to{transform:translateX(1500px)}}.gi-fly{animation:gi-fly 18s linear infinite}' +
      '@keyframes gi-arc{0%,100%{transform:translateY(330px);animation-timing-function:ease-out}50%{transform:translateY(0);animation-timing-function:ease-in}}.gi-arc{animation:gi-arc 18s linear infinite}' +
      '@keyframes gi-wob{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}.gi-wob{transform-box:fill-box;transform-origin:center;animation:gi-wob 1.4s ease-in-out infinite}' +
      '@keyframes gi-flag{0%,100%{transform:scaleX(1)}50%{transform:scaleX(0.55)}}.gi-flag{transform-box:fill-box;transform-origin:left center;animation:gi-flag 2.6s ease-in-out infinite}',
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('gi-sky')) +
      stars(75, 80, 300, p.text) +
      layer('far', towers + upper + beams) +
      layer('mid', lower + wall) +
      layer(
        'near',
        rect(-BLEED, 592, WIDTH + 2 * BLEED, HEIGHT - 592, mix(turf, p.bg, 0.55)) +
          path(s.trace(field, true), { fill: turf }) +
          path(pale, { fill: mix(turf, p.text, 0.09) }) +
          zone(1, primary) +
          zone(-1, secondary) +
          path(s.trace(field, true), { fill: paint('gi-turf') }) +
          ellipse(mx, my, 600, 120, paint('gi-pool')) +
          chalk +
          pylons +
          post(-1) +
          post(1) +
          ellipse(1256, 696, 66, 9, alpha('#000000', 0.34)) +
          BOLT_HERE +
          front,
      ) +
      mist +
      ball +
      motes +
      v.body,
  }
}

/** A hockey rink under arena lights: the ice with its lines and circles, boards and glass, a net at each end, skate traces, a puck sliding. */
const rink: Make = theme => {
  const p = theme.palette
  const { primary, secondary } = colours(theme)
  const r = rnd(88)
  const s = surface(100, 85, 884, 590, 880, 590)
  const v = vignette('rk-vig', mix(p.bg, '#000000', 0.8), 0.72)
  const hall = arena('rk', p, primary, secondary, 566)
  const ice = mix(p.text, p.info, 0.22)
  const white = mix(p.text, '#ffffff', 0.4)
  const defs =
    hall.defs +
    linear('rk-air', [
      [0, mix(p.bg, '#000000', 0.7)],
      [0.5, mix(p.bg, '#000000', 0.3)],
      [1, p.bg],
    ]) +
    linear('rk-ice', [
      [0, mix(ice, p.bg, 0.42)],
      [0.4, mix(ice, p.bg, 0.2)],
      [1, mix(ice, p.bg, 0.34)],
    ]) +
    linear('rk-glass', [
      [0, p.text, 0.2],
      [1, p.text, 0.05],
    ]) +
    glow('rk-pool', white, 0.42) +
    glow('rk-mist', mix(p.text, p.info, 0.5), 0.2) +
    pattern('rk-net', 7, 7, path('M0 0L7 7M7 0L0 7', { fill: 'none', stroke: alpha(p.text, 0.7), 'stroke-width': 0.9 })) +
    v.defs
  // The sheet: a rectangle with round corners, walked once; its far half and its near half carry the boards.
  const corner = (cx: number, cz: number, a0: number): [number, number][] => s.arc(cx, cz, 28, a0, a0 + Math.PI / 2, 12)
  const farSide: Place[] = [[100, 28], ...corner(72, 57, 0), ...corner(-72, 57, Math.PI / 2), [-100, 28]]
  const nearSide: Place[] = [[-100, 28], ...corner(-72, 28, Math.PI), ...corner(72, 28, Math.PI * 1.5), [100, 28]]
  const sheet = s.trace([...farSide, ...nearSide], true)
  // How far across the sheet a line at `x` may run before it meets a round corner.
  const reachAt = (x: number): number => (Math.abs(x) <= 72 ? 0 : 28 - Math.sqrt(28 ** 2 - (Math.abs(x) - 72) ** 2))
  const band = (x: number, w: number): string => s.trace([[x - w, reachAt(x)], [x + w, reachAt(x)], [x + w, 85 - reachAt(x)], [x - w, 85 - reachAt(x)]], true)
  const ring = (x: number, z: number): string => s.trace(s.arc(x, z, 15, 0, TURN), true)
  const dot = (x: number, z: number, colour: string): string => {
    const [px, py] = s.at(x, z)
    return ellipse(px, py, 1.1 * s.scale(z), 0.42 * s.scale(z), colour)
  }
  // The ice is marked the same in every arena: the look's own blue and red, whatever the team's colours are. The boards, the seats and the banners are the team's.
  const own = themeById(theme.id)?.palette ?? p
  const [blue, red] = [own.accent, own.special]
  const ends = [1, -1] as const
  const markings =
    path(band(0, 0.6), { fill: red, opacity: 0.9 }) +
    path(band(25, 0.6) + band(-25, 0.6), { fill: blue, opacity: 0.9 }) +
    path(band(89, 0.14) + band(-89, 0.14), { fill: red, opacity: 0.8 }) +
    path(ring(0, 42.5), { fill: 'none', stroke: blue, 'stroke-width': 2.4, opacity: 0.9 }) +
    path(ends.map(side => ring(69 * side, 20.5) + ring(69 * side, 64.5)).join(''), { fill: 'none', stroke: red, 'stroke-width': 2.4, opacity: 0.9 }) +
    ends.map(side => path(s.trace([[89 * side, 36.5], ...s.arc(89 * side, 42.5, 6, side === 1 ? Math.PI * 1.5 : Math.PI * 0.5, side === 1 ? Math.PI * 0.5 : -Math.PI * 0.5, 12)], true), { fill: mix(blue, ice, 0.45), opacity: 0.8 })).join('') +
    dot(0, 42.5, blue) +
    ends.map(side => dot(69 * side, 20.5, red) + dot(69 * side, 64.5, red) + dot(20 * side, 20.5, red) + dot(20 * side, 64.5, red)).join('')
  // A net: red posts and bar, white mesh behind.
  const net = (side: 1 | -1): string => {
    const red = mix(p.error, secondary, 0.3)
    const front: Place[] = [[89 * side, 38.4], [89 * side, 46.6]]
    const back: Place[] = [[94 * side, 39.4], [94 * side, 45.6]]
    const [a, b] = [s.up(front[0]![0], front[0]![1], 5.6), s.up(front[1]![0], front[1]![1], 5.6)]
    const [a0, b0] = [s.at(front[0]![0], front[0]![1]), s.at(front[1]![0], front[1]![1])]
    const [c0, d0] = [s.at(back[0]![0], back[0]![1]), s.at(back[1]![0], back[1]![1])]
    const [c, d] = [s.up(back[0]![0], back[0]![1], 2.2), s.up(back[1]![0], back[1]![1], 2.2)]
    const mesh = s.join([a, b, d, d0, c0, c], true) + s.join([a0, a, c, c0], true) + s.join([b0, b, d, d0], true)
    return path(mesh, { fill: alpha(p.text, 0.3) }) + path(mesh, { fill: paint('rk-net') }) + path(s.join([a0, a, b, b0], false), { fill: 'none', stroke: red, 'stroke-width': 4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })
  }
  // Skate traces: long curves cut into the ice, each fading out and back in its own time.
  const cut = (x: number, z: number, radius: number, from: number, sweep: number, i: number): string =>
    path(s.trace(s.arc(x, z, radius, from, from + sweep, 16)), { fill: 'none', stroke: mix(white, p.bg, 0.12), 'stroke-width': 1.5, 'stroke-linecap': 'round', opacity: 0.55, class: 'rk-cut', style: `animation-duration:${n(9 + (i % 4) * 2.5)}s;animation-delay:${n(-i * 1.9)}s` })
  let cuts = ''
  for (let i = 0; i < few(11); i += 1) cuts += cut(-78 + r() * 156, 14 + r() * 56, 12 + r() * 30, r() * TURN, 1 + r() * 2.2, i)
  const [px, py] = s.at(0, 42)
  let shine = ellipse(px, py, 580, 110, paint('rk-pool'))
  for (const [x, w] of [[300, 44], [560, 30], [1040, 30], [1300, 44]] as const) shine += polygon([[x - w, 596], [x + w, 596], [x + w * 2.3, 884], [x - w * 2.3, 884]], alpha(white, 0.07))
  // The boards: white with a kick strip in the team's colour and a cap rail; the glass above, with its posts.
  const boards = (side: readonly Place[], near: boolean): string => {
    let stanchions = ''
    side.forEach(([x, z], i) => {
      if (i % 3 !== 0) return
      const [x0, y0] = s.up(x, z, 3.6)
      const [x1, y1] = s.up(x, z, 9.4)
      stanchions += `M${n(x0)} ${n(y0)}L${n(x1)} ${n(y1)}`
    })
    const glass = path(s.wall(side, 3.6, 9.4), { fill: paint('rk-glass') }) + path(stanchions + s.join(s.lifted(side, 9.4), false), { fill: 'none', stroke: alpha(p.text, near ? 0.3 : 0.4), 'stroke-width': 1.4 })
    const face = near
      ? path(s.wall(side, 0, 3.6), { fill: mix(p.bg, '#000000', 0.5) }) + path(s.wall(side, 0, 0.7), { fill: mix(p.bg, '#000000', 0.68) })
      : path(s.wall(side, 0, 3.6), { fill: mix(white, p.bg, 0.16) }) + path(s.wall(side, 0, 0.7), { fill: mix(primary, p.bg, 0.12) }) + path(s.wall(side, 1.5, 2.3), { fill: mix(secondary, p.bg, 0.3), opacity: 0.55 })
    return glass + face + path(s.join(s.lifted(side, 3.6), false), { fill: 'none', stroke: near ? mix(p.bg, p.text, 0.3) : mix(secondary, p.bg, 0.15), 'stroke-width': 3, 'stroke-linejoin': 'round' })
  }
  const [puckX, puckY] = s.at(-14, 31)
  const puck = group(ellipse(puckX, puckY + 2, 11, 3, alpha('#000000', 0.25)) + ellipse(puckX, puckY, 9, 3.4, mix(p.bg, '#000000', 0.6)) + ellipse(puckX, puckY - 1.4, 9, 3, mix(p.bg, '#000000', 0.3)), { class: 'rk-puck' })
  const mist =
    ellipse(340, 640, 600, 48, paint('rk-mist'), { class: 'rk-mist' }) + ellipse(1220, 700, 620, 54, paint('rk-mist'), { class: 'rk-mist', style: 'animation-duration:61s' }) + ellipse(760, 820, 800, 60, paint('rk-mist'), { opacity: 0.8, class: 'rk-mist', style: 'animation-duration:73s' })
  const frost = drift(89, 34, 'rk-frost', 85, (x, y, k, pick) => circle(x, y * 0.85, 0.9 + pick() * 1.5, alpha(k % 2 === 0 ? white : p.info, 0.3 + pick() * 0.3)))
  return {
    alt: 'A hockey rink under arena lights: bright ice with a centre line, two more lines and face-off circles, white boards with glass above, a net at each end, tiers of seats in two colours, plain banners overhead, faint skate traces and a puck sliding.',
    bolt: { x: 1246, y: 568 },
    defs,
    style:
      PARALLAX +
      hall.style +
      RISE +
      anim('rk-frost', 'rise') +
      SWAY +
      '.rk-mist{animation:sway 49s ease-in-out infinite}' +
      '@keyframes rk-cut{0%,100%{opacity:0.12}50%{opacity:0.7}}.rk-cut{animation-name:rk-cut;animation-timing-function:ease-in-out;animation-iteration-count:infinite}' +
      '@keyframes rk-puck{0%,100%{transform:translateX(-190px)}50%{transform:translateX(230px)}}.rk-puck{animation:rk-puck 17s ease-in-out infinite}',
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('rk-air')) +
      layer('far', hall.far) +
      layer('mid', hall.mid) +
      hall.beams +
      layer(
        'near',
        rect(-BLEED, 566, WIDTH + 2 * BLEED, HEIGHT - 566, mix(p.bg, '#000000', 0.35)) +
          boards(farSide, false) +
          path(sheet, { fill: paint('rk-ice') }) +
          shine +
          markings +
          cuts +
          net(-1) +
          net(1) +
          puck +
          ellipse(1306, 690, 66, 9, alpha(mix(p.bg, '#000000', 0.5), 0.3)) +
          BOLT_HERE +
          boards(nearSide, true) +
          rect(-BLEED, 884, WIDTH + 2 * BLEED, 20, mix(p.bg, '#000000', 0.72)),
      ) +
      mist +
      frost +
      v.body,
  }
}

export const SPORT_SCENES: Record<string, Make> = { hardwood, gridiron, rink }
