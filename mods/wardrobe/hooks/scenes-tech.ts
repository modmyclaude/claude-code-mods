// The five tech looks' scenes: the rooms and screens of people who build software.
// Each is a function of the theme, so every colour comes from the look's own
// palette and the picture stays on-look. Every moving part rests where its
// markup puts it, so the still picture the desktop draws under reduced motion
// is a finished one.

import { alpha, anim, BEND, BLEED, BOLT_HERE, cellsD, circle, coarse, CROSS, drift, ellipse, FLAP, glow, group, HEIGHT, layer, line, linear, mix, n, noise, paint, PARALLAX, path, pattern, polygon, pulse, radial, rect, ridge, RISE, rnd, SMOKE, smoke, SPIN, stars, SWAY, vignette, WIDTH } from './scene-kit'
import type { Scene } from './scene-kit'
import type { Theme } from './themes'

type Make = (theme: Theme) => Scene

/** Lines of output as bars, one path: each line a few words long, some indented. */
function outputD(seed: number, x: number, y: number, w: number, rows: number, pitch: number, h: number): string {
  const r = rnd(seed)
  let d = ''
  for (let row = 0; row < rows; row += 1) {
    let at = x + (r() < 0.3 ? pitch * 1.4 : 0)
    const end = x + w * (0.3 + r() * 0.68)
    while (at < end) {
      const word = Math.min(coarse(12) + r() * coarse(40), end - at)
      d += `M${n(at)} ${n(y + row * pitch)}h${n(word)}v${n(h)}h${n(-word)}z`
      at += word + h * 1.2
    }
  }
  return d
}

/** A mug, seen from the side, standing on `base`. */
const mugD = (x: number, base: number, w: number, h: number): string =>
  `M${n(x)} ${n(base - h)}h${n(w)}v${n(h - 4)}q0 4 -4 4h${n(-(w - 8))}q-4 0 -4 -4zM${n(x + w)} ${n(base - h * 0.78)}q${n(w * 0.42)} 0 ${n(w * 0.42)} ${n(h * 0.28)}t${n(-w * 0.42)} ${n(h * 0.28)}v${n(-h * 0.14)}q${n(w * 0.2)} 0 ${n(w * 0.2)} ${n(-h * 0.14)}t${n(-w * 0.2)} ${n(-h * 0.14)}z`

/** A dim terminal room: a green CRT on a desk, an amber one farther back, reel cabinets on the wall, scanlines over everything. */
const phosphor: Make = ({ palette: p }) => {
  const r = rnd(31)
  const v = vignette('ph-vig', '#000000', 0.74)
  const defs =
    linear('ph-wall', [
      [0, mix(p.bg, '#000000', 0.6)],
      [0.5, p.bg],
      [0.7, mix(p.bg, p.accent, 0.08)],
      [1, mix(p.bg, '#000000', 0.35)],
    ]) +
    radial('ph-screen', [
      [0, mix(p.bg, p.accent, 0.34)],
      [1, mix(p.bg, p.accent, 0.1)],
    ]) +
    radial('ph-amber', [
      [0, mix(p.bg, p.warn, 0.34)],
      [1, mix(p.bg, p.warn, 0.1)],
    ]) +
    glow('ph-halo', p.accent, 0.36) +
    glow('ph-warm', p.warn, 0.24) +
    glow('ph-pool', p.accent, 0.22) +
    linear('ph-band', [
      [0, p.accent, 0],
      [0.5, p.accent, 0.07],
      [1, p.accent, 0],
    ]) +
    pattern('ph-scan', 8, 6, rect(0, 0, 8, 1.5, alpha(p.accent, 0.06))) +
    v.defs

  // The far wall: cabinets shoulder to shoulder, tape reels on most, a bank of status lights on the rest.
  const steel = mix(p.bg, p.text, 0.06)
  const trim = mix(p.bg, p.accent, 0.22)
  const cw = 176
  let cabinets = ''
  let frames = ''
  let vents = ''
  let reels = ''
  let blink = ''
  const green: [number, number][] = []
  const amber: [number, number][] = []
  for (let i = 0, x = -BLEED - 8; x < WIDTH + BLEED; i += 1, x += cw) {
    cabinets += `M${x + 3} 616V168h${cw - 6}V616z`
    frames += `M${x + 16} 188h${cw - 32}v168h${-(cw - 32)}zM${x + 16} 376h${cw - 32}v220h${-(cw - 32)}z`
    for (let y = 520; y < 590; y += 12) vents += `M${x + 30} ${y}h${cw - 60}`
    if (i % 3 !== 1) {
      for (const cx of [x + 54, x + cw - 54]) {
        reels +=
          circle(cx, 262, 31, mix(p.bg, p.text, 0.1), { stroke: trim, 'stroke-width': 2 }) +
          group(path(`M${cx - 25} 262h50M${cx} 237v50`, { fill: 'none', stroke: mix(p.bg, p.accent, 0.36), 'stroke-width': 4 }), { class: 'spin' }) +
          circle(cx, 262, 8, mix(p.bg, p.accent, 0.5))
      }
      reels += path(`M${x + 54} 293L${x + cw / 2} 334L${x + cw - 54} 293`, { fill: 'none', stroke: mix(p.bg, p.text, 0.22), 'stroke-width': 2 })
      for (let k = 0; k < 6; k += 1) (r() < 0.25 ? amber : green).push([x + 34 + k * 19, 398])
    } else {
      for (let row = 0; row < 7; row += 1) for (let col = 0; col < 6; col += 1) if (r() < 0.62) (r() < 0.16 ? amber : green).push([x + 34 + col * 19, 206 + row * 20])
      blink += rect(x + 34 + 19 * Math.floor(r() * 6), 206 + 20 * Math.floor(r() * 7), 9, 6, i % 2 === 0 ? p.accent : p.warn, { opacity: 0.9, class: 'lamp', style: `animation-delay:${n(-r() * 6)}s` })
    }
    for (let row = 0; row < 4; row += 1) for (let col = 0; col < 6; col += 1) if (r() < 0.3) (r() < 0.2 ? amber : green).push([x + 34 + col * 19, 420 + row * 20])
    if (i % 2 === 0) blink += rect(x + 34 + 19 * Math.floor(r() * 6), 420 + 20 * Math.floor(r() * 4), 9, 6, p.accent, { opacity: 0.9, class: 'lamp', style: `animation-delay:${n(-r() * 6)}s` })
  }
  const racks =
    path(cabinets, { fill: steel }) +
    path(frames, { fill: mix(p.bg, '#000000', 0.3), stroke: mix(p.bg, p.text, 0.1), 'stroke-width': 1.5 }) +
    path(vents, { fill: 'none', stroke: mix(p.bg, p.text, 0.09), 'stroke-width': 3 }) +
    reels +
    path(cellsD(green, 9, 6), { fill: p.accent, opacity: 0.5 }) +
    path(cellsD(amber, 9, 6), { fill: p.warn, opacity: 0.55 }) +
    blink
  const floor = rect(-BLEED, 616, WIDTH + 2 * BLEED, HEIGHT - 616, mix(p.bg, '#000000', 0.45))

  // The amber terminal farther back, on a cart of its own.
  const shell = mix(p.bg, p.text, 0.2)
  const second =
    circle(1010, 500, 250, paint('ph-warm'), { class: 'warm' }) +
    rect(902, 572, 216, 44, mix(p.bg, p.text, 0.11)) +
    rect(916, 616, 8, 30, mix(p.bg, p.text, 0.08)) +
    rect(1096, 616, 8, 30, mix(p.bg, p.text, 0.08)) +
    rect(920, 426, 180, 146, mix(shell, p.bg, 0.25), { rx: 12 }) +
    rect(934, 438, 152, 112, paint('ph-amber'), { rx: 14 }) +
    path(outputD(35, 946, 452, 126, 7, 12, 4.5), { fill: p.warn, opacity: 0.82 }) +
    rect(946, 536, 7, 9, p.warn, { class: 'cur', opacity: 0.9, style: 'animation-delay:-0.7s' })

  // The desk and the big terminal on it.
  const deskTop = mix(p.bg, p.text, 0.1)
  const cables = path('M590 560C668 566 640 640 716 652M604 600C700 610 690 652 790 656M1100 560C1150 566 1128 630 1180 652', { fill: 'none', stroke: mix(p.bg, '#000000', 0.5), 'stroke-width': 6, 'stroke-linecap': 'round' })
  const [sx, sy, sw, sh] = [214, 340, 332, 230]
  const crt =
    rect(300, 628, 160, 26, mix(shell, '#000000', 0.3), { rx: 6 }) +
    rect(170, 300, 420, 334, shell, { rx: 22 }) +
    rect(170, 596, 420, 38, mix(shell, '#000000', 0.18), { rx: 12 }) +
    rect(192, 320, 376, 270, mix(shell, '#000000', 0.5), { rx: 26 }) +
    rect(sx, sy, sw, sh, paint('ph-screen'), { rx: 30 }) +
    path(outputD(32, sx + 26, sy + 26, sw - 60, 11, 15.5, 6), { fill: p.accent, opacity: 0.9 }) +
    path(outputD(34, sx + 26, sy + 26, sw - 190, 1, 15.5, 6), { fill: p.text }) +
    path(`M${sx + 26} ${sy + 198}l8 5l-8 5z`, { fill: p.warn }) +
    rect(sx + 42, sy + 198, 64, 10, p.accent, { opacity: 0.9 }) +
    rect(sx + 114, sy + 196, 11, 15, p.accent, { class: 'cur', opacity: 0.95 }) +
    polygon([[sx + 26, sy + 8], [sx + 150, sy + 8], [sx + 60, sy + 96], [sx + 12, sy + 96]], alpha(p.text, 0.04)) +
    circle(556, 615, 4, p.ok, { class: 'lamp' }) +
    path('M206 612h120M206 620h120', { fill: 'none', stroke: mix(shell, '#000000', 0.4), 'stroke-width': 3 })
  let keys = ''
  for (let row = 0; row < 3; row += 1) for (let k = 0; k < 15; k += 1) keys += `M${254 + k * 19 - row * 5} ${662 + row * 8}h14v5h-14z`
  const keyboard = polygon([[244, 656], [540, 656], [556, 690], [224, 690]], mix(shell, '#000000', 0.28)) + path(keys, { fill: mix(shell, p.text, 0.22) })
  const mug = path(mugD(646, 656, 38, 46), { fill: mix(p.bg, p.text, 0.26) }) + rect(646, 620, 38, 5, mix(p.bg, p.warn, 0.4))
  const desk = rect(-BLEED, 650, WIDTH + 2 * BLEED, 60, deskTop) + rect(-BLEED, 650, WIDTH + 2 * BLEED, 3, mix(p.bg, p.accent, 0.24)) + ellipse(212, 676, 280, 24, paint('ph-pool'))

  // The near edge of the desk, where Bolt stands, with a stack of disks beside.
  const front = mix(p.bg, '#000000', 0.5)
  const edge =
    rect(-BLEED, 690, WIDTH + 2 * BLEED, HEIGHT - 690, front) +
    rect(-BLEED, 690, WIDTH + 2 * BLEED, 5, mix(p.bg, p.accent, 0.2)) +
    path('M120 760h380v100h-380zM560 760h380v100h-380zM1000 760h380v100h-380z', { fill: mix(front, '#000000', 0.3), stroke: mix(p.bg, p.text, 0.08), 'stroke-width': 2 }) +
    path('M270 792h80M710 792h80M1150 792h80', { fill: 'none', stroke: mix(p.bg, p.text, 0.2), 'stroke-width': 5, 'stroke-linecap': 'round' })
  const disks =
    rect(1436, 674, 96, 16, mix(p.bg, p.text, 0.16)) +
    rect(1444, 660, 96, 14, mix(p.bg, p.text, 0.22)) +
    rect(1432, 646, 96, 14, mix(p.bg, p.text, 0.18)) +
    rect(1446, 650, 34, 6, p.warn, { opacity: 0.7 }) +
    rect(1458, 664, 34, 6, p.accent, { opacity: 0.6 })
  const motes = drift(33, 26, 'mote', 80, (x, y, k, pick) => circle(x, y, 1 + pick() * 1.6, alpha(k % 5 === 0 ? p.warn : p.accent, 0.38)))
  return {
    alt: 'A dim terminal room: a big green-screen terminal glowing on a desk with a keyboard and a mug, a smaller amber terminal farther back, a wall of reel cabinets with status lights, and scanlines drifting down.',
    bolt: { x: 1276, y: 570 },
    defs,
    style:
      PARALLAX +
      RISE +
      anim('mote', 'rise') +
      SPIN +
      SMOKE +
      pulse('cur', 0.25, 1, 2) +
      pulse('lamp', 0.3, 1, 3.4) +
      pulse('halo', 0.82, 1, 6) +
      pulse('warm', 0.75, 1, 7) +
      '@keyframes scan{from{transform:translateY(0)}to{transform:translateY(6px)}}.scan{animation:scan 2.4s linear infinite}' +
      '@keyframes band{from{transform:translateY(-420px)}to{transform:translateY(760px)}}.band{animation:band 12s linear infinite}',
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('ph-wall')) +
      layer('far', racks + floor + group(second, { transform: 'translate(-210 0)' })) +
      circle(212, 510, 520, paint('ph-halo'), { class: 'halo' }) +
      layer('mid', desk + group(cables + crt + keyboard + mug + smoke(665, 612, mix(p.text, p.accent, 0.3)), { transform: 'translate(-62 182) scale(0.72)' })) +
      motes +
      layer('near', edge + disks + BOLT_HERE) +
      rect(-20, -12, WIDTH + 40, HEIGHT + 24, paint('ph-scan'), { class: 'scan' }) +
      rect(-20, 200, WIDTH + 40, 170, paint('ph-band'), { class: 'band' }) +
      v.body,
  }
}

/** A quiet commit graph drawn like constellations over a slate night, seen from behind a desk. */
const graphite: Make = ({ palette: p }) => {
  const v = vignette('gr-vig', '#000000', 0.62)
  const defs =
    linear('gr-sky', [
      [0, mix(p.bg, '#000000', 0.5)],
      [0.55, p.bg],
      [1, mix(p.bg, p.accent, 0.14)],
    ]) +
    pattern('gr-dots', 44, 44, circle(22, 22, 1.2, alpha(p.muted, 0.26))) +
    glow('gr-node', p.accent, 0.55) +
    glow('gr-neb', p.accent, 0.11) +
    glow('gr-neb2', p.special, 0.09) +
    glow('gr-rim', p.accent, 0.42) +
    v.defs

  // The graph: time runs left to right, the main lane straight through, branches leaving it and coming home.
  const step = 76
  const X = (col: number) => -60 + col * step
  const branches: readonly { lane: number; from: number; to: number; parent: number; open?: boolean }[] = [
    { lane: 1, from: 1, to: 6, parent: 2 },
    { lane: 0, from: 3, to: 5, parent: 1 },
    { lane: 3, from: 4, to: 11, parent: 2 },
    { lane: 4, from: 7, to: 9, parent: 3 },
    { lane: 1, from: 10, to: 16, parent: 2 },
    { lane: 0, from: 12, to: 15, parent: 1 },
    { lane: 3, from: 14, to: 21, parent: 2 },
    { lane: 4, from: 16, to: 20, parent: 3, open: true },
    { lane: 1, from: 19, to: 24, parent: 2, open: true },
  ]
  const graph = (seed: number, lanes: readonly number[], bright: boolean): string => {
    const r = rnd(seed)
    const colours = [p.special, p.info, p.accent, p.ok, p.warn]
    const main = lanes[2]!
    let out = line(X(-1), main, X(25), main, p.accent, { 'stroke-width': bright ? 3 : 2.4, opacity: bright ? 0.95 : 0.8 })
    let nodes = ''
    let halos = ''
    const node = (x: number, y: number, colour: string, kind: 'commit' | 'merge' | 'head') => {
      if (kind === 'merge') nodes += circle(x, y, 8.5, p.bg, { stroke: colour, 'stroke-width': 2.6 }) + circle(x, y, 3.2, colour)
      else if (kind === 'head') {
        halos += circle(x, y, 30, paint('gr-node'), { class: 'node', opacity: 0.9, style: `animation-delay:${n(-r() * 6)}s` })
        nodes += circle(x, y, 8, colour) + circle(x, y, 13, 'none', { stroke: colour, 'stroke-width': 1.6, opacity: 0.6 })
      } else {
        // A commit here and there breathes, on the bright graph alone.
        if (bright && r() < 0.14) halos += circle(x, y, 20, paint('gr-node'), { class: 'node', opacity: 0.8, style: `animation-delay:${n(-r() * 6)}s` })
        nodes += circle(x, y, 5.6, colour)
      }
    }
    for (const b of branches) {
      const [y, yp, colour] = [lanes[b.lane]!, lanes[b.parent]!, colours[b.lane]!]
      const [x0, x1, x2] = [X(b.from - 1), X(b.from), X(b.to)]
      let d = `M${x0} ${yp}C${x0 + step / 2} ${yp} ${x0 + step / 2} ${y} ${x1} ${y}H${x2}`
      if (b.open !== true) d += `C${x2 + step / 2} ${y} ${x2 + step / 2} ${yp} ${x2 + step} ${yp}`
      out += path(d, { fill: 'none', stroke: colour, 'stroke-width': 2.4, opacity: bright ? 0.78 : 0.7 })
      for (let col = b.from; col <= b.to; col += 1) {
        const last = col === b.to
        if (!last && col !== b.from && r() < 0.28) continue
        node(X(col), y, colour, last && b.open === true ? 'head' : 'commit')
      }
      if (b.open !== true) node(x2 + step, yp, colours[b.parent]!, 'merge')
    }
    for (let col = 0; col <= 24; col += 1) {
      if (branches.some(b => b.parent === 2 && b.open !== true && b.to + 1 === col)) continue
      if (r() < 0.86) node(X(col), main, p.accent, 'commit')
    }
    return halos + out + nodes
  }
  // Two more graphs far off, small and faint; a thumbnail keeps the nearer of them.
  const farGraph =
    group(graph(46, [150, 215, 280, 345, 410], false), { transform: 'translate(-180 20) scale(0.62)', opacity: 0.22 }) +
    (coarse(1) === 1 ? group(graph(48, [150, 215, 280, 345, 410], false), { transform: 'translate(560 330) scale(0.5)', opacity: 0.15 }) : '')
  const nebulae = ellipse(380, 300, 620, 300, paint('gr-neb')) + ellipse(1250, 420, 560, 280, paint('gr-neb2'))

  // The desk in front: the back of a monitor lit from its far side, books, a mug, a plant.
  const dark = mix(p.bg, '#000000', 0.42)
  const darker = mix(p.bg, '#000000', 0.74)
  const monitor =
    ellipse(360, 604, 470, 290, paint('gr-rim'), { class: 'rim' }) +
    ellipse(360, 764, 420, 16, paint('gr-rim')) +
    path('M168 492h384q20 0 20 20v186q0 20 -20 20h-384q-20 0 -20 -20v-186q0 -20 20 -20z', { fill: dark, stroke: mix(p.bg, p.accent, 0.55), 'stroke-width': 2.5 }) +
    path('M176 500h368q14 0 14 14v20h-396v-20q0 -14 14 -14z', { fill: mix(dark, p.text, 0.05) }) +
    path('M290 560h140M290 576h140M290 592h140M290 608h140M290 624h140', { fill: 'none', stroke: darker, 'stroke-width': 5, 'stroke-linecap': 'round' }) +
    rect(336, 656, 48, 30, mix(dark, '#000000', 0.3), { rx: 4 }) +
    path('M330 718h60l8 34h-76z', { fill: darker }) +
    rect(272, 750, 176, 12, darker, { rx: 4 }) +
    circle(536, 702, 3, p.accent, { class: 'led' })
  const books =
    rect(660, 742, 150, 18, mix(p.bg, p.special, 0.2)) +
    rect(668, 726, 132, 16, mix(p.bg, p.info, 0.2)) +
    rect(676, 712, 140, 14, mix(p.bg, p.warn, 0.18)) +
    path(mugD(880, 760, 34, 42), { fill: dark })
  let leaves = ''
  for (const [dx, dy, bend] of [[-70, -86, -30], [-36, -124, -10], [4, -140, 8], [44, -118, 26], [76, -78, 40], [-92, -40, -50], [96, -34, 52]] as const) {
    leaves += `M1470 708Q${1470 + bend} ${708 + dy * 0.6} ${1470 + dx} ${708 + dy}Q${1470 + bend + 16} ${708 + dy * 0.45} 1476 708z`
  }
  const plant = group(path(leaves, { fill: mix(p.ok, p.bg, 0.5) }), { class: 'bend' }) + path('M1436 706h72l-10 54h-52z', { fill: mix(p.bg, p.warn, 0.26) }) + rect(1432, 700, 80, 10, mix(p.bg, p.warn, 0.34), { rx: 3 })
  const desk = rect(-BLEED, 760, WIDTH + 2 * BLEED, HEIGHT - 760, darker) + rect(-BLEED, 760, WIDTH + 2 * BLEED, 3, mix(p.bg, p.accent, 0.26))
  const motes = drift(43, 18, 'mote', 96, (x, y, k, pick) => circle(x, y, 1 + pick() * 1.4, alpha(k % 3 === 0 ? p.accent : p.text, 0.26)))
  return {
    alt: 'A commit graph drawn like constellations across a slate night sky: a blue main line with coloured branches leaving and merging back, seen from behind a desk with a monitor, books and a plant.',
    bolt: { x: 1276, y: 640 },
    defs,
    style:
      PARALLAX +
      RISE +
      anim('mote', 'rise') +
      BEND +
      pulse('node', 0.35, 1, 6) +
      pulse('tw', 0.25, 0.95, 5) +
      pulse('led', 0.4, 1, 3) +
      pulse('rim', 0.8, 1, 9) +
      '@keyframes gflow{0%,100%{transform:translateX(-34px)}50%{transform:translateX(34px)}}.gflow{animation:gflow 150s ease-in-out infinite}',
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('gr-sky')) +
      rect(0, 0, WIDTH, HEIGHT, paint('gr-dots')) +
      nebulae +
      stars(44, 70, 760, p.text) +
      layer('far', farGraph) +
      layer('mid', group(graph(45, [170, 252, 334, 416, 498], true), { class: 'gflow' })) +
      motes +
      layer('near', group(monitor, { transform: 'translate(-36 213) scale(0.72)' }) + books + group(plant, { transform: 'translate(46 0)' }) + desk + BOLT_HERE) +
      v.body,
  }
}

const BIRD = 'M0 0q7 -9 15 -1q8 -8 15 1'

/** Desert dunes at dusk: a low sun, a far mesa, terracotta dunes, three clay pots in the near sand. */
const clay: Make = ({ palette: p }) => {
  const v = vignette('cl-vig', mix(p.bg, '#000000', 0.7), 0.6)
  const sand = mix(p.accent, p.warn, 0.4)
  const defs =
    linear('cl-sky', [
      [0, mix(p.bg, '#000000', 0.3)],
      [0.22, mix(p.bg, p.special, 0.12)],
      [0.42, mix(mix(p.bg, p.special, 0.5), p.accent, 0.26)],
      [0.56, mix(p.accent, p.special, 0.3)],
      [0.64, mix(p.accent, p.warn, 0.55)],
      [1, mix(p.accent, p.warn, 0.4)],
    ]) +
    radial('cl-sun', [
      [0, mix(p.warn, '#ffffff', 0.75)],
      [0.6, mix(p.warn, '#ffffff', 0.25)],
      [1, mix(p.warn, p.accent, 0.5)],
    ]) +
    glow('cl-halo', mix(p.warn, p.accent, 0.3), 0.6) +
    // A dune is palest at its crest and deepens down its face, so the crest in front of it stands clear.
    linear('cl-d0', [
      [0, mix(sand, p.special, 0.3)],
      [0.24, mix(p.accent, p.special, 0.35)],
      [1, mix(p.accent, p.special, 0.35)],
    ]) +
    linear('cl-da', [
      [0, mix(sand, '#ffffff', 0.12)],
      [0.26, mix(p.accent, p.bg, 0.22)],
      [1, mix(p.accent, p.bg, 0.22)],
    ]) +
    linear('cl-d1', [
      [0, mix(p.accent, p.warn, 0.36)],
      [0.36, mix(p.accent, p.bg, 0.4)],
      [1, mix(p.accent, p.bg, 0.5)],
    ]) +
    linear('cl-d2', [
      [0, mix(p.accent, p.bg, 0.3)],
      [0.5, mix(p.bg, p.accent, 0.3)],
      [1, mix(p.bg, '#000000', 0.2)],
    ]) +
    linear('cl-near', [
      [0, mix(p.bg, p.accent, 0.3)],
      [1, mix(p.bg, '#000000', 0.5)],
    ]) +
    v.defs
  const [sunX, sunY] = [236, 496]
  const sun = circle(sunX, sunY, 560, paint('cl-halo'), { class: 'halo' }) + circle(sunX, sunY, 132, paint('cl-sun'))
  const shimmer = [0, 1, 2, 3, 4].map(k => ellipse(260 + k * 250, 546 + (k % 3) * 9, 300 - k * 20, 2.6, alpha(mix(p.warn, '#ffffff', 0.5), 0.26), { class: 'shim', style: `animation-duration:${7 + k * 2}s` })).join('')

  // Far: two buttes and the first line of dunes.
  const rock = mix(p.accent, p.bg, 0.42)
  const mesa =
    polygon([[1200, 580], [1242, 474], [1270, 466], [1282, 438], [1492, 434], [1504, 460], [1542, 470], [1592, 580]], rock) +
    polygon([[1282, 438], [1492, 434], [1504, 460], [1270, 466]], mix(rock, p.warn, 0.22)) +
    path('M1310 470v96M1360 468v100M1418 468v100M1472 466v104', { fill: 'none', stroke: mix(rock, p.bg, 0.3), 'stroke-width': 5 }) +
    polygon([[96, 580], [130, 508], [146, 502], [152, 482], [236, 480], [244, 502], [262, 510], [290, 580]], mix(rock, p.special, 0.2)) +
    polygon([[1010, 580], [1034, 520], [1090, 516], [1120, 580]], mix(rock, p.special, 0.25))
  const far = ridge(71, 626, 92, 640, { rough: 2 })
  const midA = ridge(77, 692, 110, 800, { rough: 2 })
  const mid = ridge(72, 752, 112, 940, { rough: 2 })
  const mid2 = ridge(73, 816, 84, 760, { rough: 2 })
  // The sun is low at the left: a dune is bright where it climbs toward the right and in shadow where it falls away,
  // a band under its crest as deep as the slope is steep.
  const slope = (y: (x: number) => number, lit: boolean, deep: number): string => {
    let top = ''
    let foot = ''
    for (let x = -BLEED; x <= WIDTH + BLEED; x += coarse(24)) {
      const fall = (y(x + 90) - y(x)) * (lit ? -2.2 : 2.4)
      const band = Math.max(0, Math.min(deep, fall))
      top += `${top === '' ? 'M' : 'L'}${n(x)} ${n(y(x))}`
      foot = `L${n(x)} ${n(y(x) + band)}${foot}`
    }
    return `${top}${foot}z`
  }
  const dune = (r: { y: (x: number) => number; d: string }, fill: string, deep: number): string =>
    path(r.d, { fill }) + path(slope(r.y, true, deep), { fill: mix(p.warn, '#ffffff', 0.4), opacity: 0.42 }) + path(slope(r.y, false, deep * 1.5), { fill: mix(p.accent, '#000000', 0.5), opacity: 0.4 })
  // Wind ripples on the middle dune, following its line.
  let ripples = ''
  for (const drop of [56, 78, 104]) {
    let d = ''
    for (let x = -BLEED; x <= WIDTH + BLEED; x += coarse(70)) d += `${d === '' ? 'M' : 'L'}${n(x)} ${n(mid.y(x) + drop + Math.sin(x / 90 + drop) * 5)}`
    ripples += d
  }
  const cactus = (x: number, base: number, h: number): string =>
    path(`M${x} ${base}V${base - h}`, { fill: 'none', stroke: mix(p.ok, p.bg, 0.62), 'stroke-width': n(h * 0.15), 'stroke-linecap': 'round' }) +
    path(`M${x} ${n(base - h * 0.36)}h${n(-h * 0.24)}v${n(-h * 0.26)}M${x} ${n(base - h * 0.5)}h${n(h * 0.22)}v${n(-h * 0.22)}`, { fill: 'none', stroke: mix(p.ok, p.bg, 0.62), 'stroke-width': n(h * 0.1), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
  const agave = (x: number, base: number, size: number, fill: string): string => {
    let d = ''
    for (let k = -4; k <= 4; k += 1) {
      const a = (k * 20 * Math.PI) / 180
      const len = size * (1 - Math.abs(k) * 0.08)
      d += `M${n(x - size * 0.07)} ${n(base)}L${n(x + Math.sin(a) * len)} ${n(base - Math.cos(a) * len)}L${n(x + size * 0.07)} ${n(base)}z`
    }
    return path(d, { fill })
  }

  // Near: dark sand rising at the right, three pots at the left, agave and grass.
  const pot = (x: number, base: number, w: number, h: number, fill: string): string =>
    path(
      `M${n(x - w * 0.22)} ${n(base - h)}h${n(w * 0.44)}l${n(-w * 0.04)} ${n(h * 0.1)}q${n(w * 0.38)} ${n(h * 0.2)} ${n(w * 0.32)} ${n(h * 0.5)}q${n(-w * 0.04)} ${n(h * 0.3)} ${n(-w * 0.26)} ${n(h * 0.4)}h${n(-w * 0.48)}q${n(-w * 0.22)} ${n(-h * 0.1)} ${n(-w * 0.26)} ${n(-h * 0.4)}q${n(-w * 0.06)} ${n(-h * 0.3)} ${n(w * 0.32)} ${n(-h * 0.5)}z`,
      { fill },
    ) +
    path(`M${n(x - w * 0.47)} ${n(base - h * 0.5)}h${n(w * 0.94)}M${n(x - w * 0.5)} ${n(base - h * 0.38)}h${n(w)}`, { fill: 'none', stroke: mix(fill, '#000000', 0.35), 'stroke-width': n(h * 0.035) }) +
    rect(x - w * 0.24, base - h - 3, w * 0.48, 7, mix(fill, p.warn, 0.3), { rx: 3 }) +
    ellipse(x - w * 0.24, base - h * 0.5, w * 0.06, h * 0.2, alpha(mix(p.warn, '#ffffff', 0.5), 0.2))
  const pots = pot(150, 812, 96, 118, mix(p.accent, p.bg, 0.18)) + pot(256, 818, 74, 84, mix(p.accent, p.warn, 0.3)) + pot(334, 826, 58, 60, mix(p.accent, p.bg, 0.4))
  const ground = path('M-80 900V820Q200 790 430 830T800 852Q1000 848 1110 772Q1220 702 1330 704Q1470 708 1680 800V900z', { fill: paint('cl-near') })
  let tufts = ''
  for (const [x, y] of [[90, 808], [470, 834], [560, 842], [1040, 816], [1420, 722], [1580, 760]] as const) {
    tufts += group(path(`M${x} ${y}q-10 -26 -22 -34M${x} ${y}q-2 -30 -4 -44M${x} ${y}q8 -26 18 -36M${x} ${y}q14 -18 30 -22`, { fill: 'none', stroke: mix(p.warn, p.bg, 0.55), 'stroke-width': 2.4, 'stroke-linecap': 'round' }), { class: 'bend' })
  }
  const birds = drift(74, 5, 'bird', 84, (x, y, k, pick) =>
    group(path(BIRD, { fill: 'none', stroke: mix(p.bg, '#000000', 0.3), 'stroke-width': 2.4, 'stroke-linecap': 'round', transform: `translate(${n(x)} ${n(130 + y * 0.3)}) scale(${n(0.9 + pick() * 0.9)})` }), { class: 'flap' }),
  )
  const blown = drift(75, 22, 'sand', 56, (x, y, k, pick) => circle(x, 520 + y * 0.42, 1 + pick() * 1.5, alpha(mix(p.warn, '#ffffff', 0.3), 0.42)))
  return {
    alt: 'Desert dunes at dusk: a big low sun at the left in a terracotta and sand sky, a flat-topped mesa far off at the right, rolling dunes with cactus and agave, and three clay pots in the near sand.',
    bolt: { x: 1276, y: 588 },
    defs,
    style:
      PARALLAX +
      CROSS +
      anim('bird', 'cross') +
      anim('sand', 'cross') +
      FLAP +
      BEND +
      SWAY +
      '.shim{animation:sway 9s ease-in-out infinite}' +
      pulse('halo', 0.8, 1, 10) +
      pulse('tw', 0.25, 1, 5),
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('cl-sky')) +
      stars(76, 46, 230, p.text) +
      sun +
      shimmer +
      layer('far', mesa + dune(far, paint('cl-d0'), 30)) +
      layer(
        'mid',
        dune(midA, paint('cl-da'), 40) +
          cactus(1500, midA.y(1500) + 8, 84) +
          dune(mid, paint('cl-d1'), 46) +
          path(ripples, { fill: 'none', stroke: alpha(mix(p.accent, p.bg, 0.6), 0.4), 'stroke-width': 2 }) +
          cactus(760, mid.y(760) + 8, 124) +
          dune(mid2, paint('cl-d2'), 30) +
          agave(980, mid2.y(980) + 6, 54, mix(p.ok, p.bg, 0.6)) +
          cactus(60, mid2.y(60) + 8, 150),
      ) +
      birds +
      blown +
      layer('near', ground + agave(640, 852, 78, mix(p.ok, p.bg, 0.72)) + agave(1510, 748, 62, mix(p.ok, p.bg, 0.72)) + pots + tufts + BOLT_HERE) +
      v.body,
  }
}

/** A banded sun over a grid floor running to the horizon, faceted mountains, palms and light trails. */
const synthwave: Make = ({ palette: p }) => {
  const v = vignette('sy-vig', '#05020d', 0.62)
  const [vx, hz] = [800, 540]
  const defs =
    linear('sy-sky', [
      [0, mix(p.bg, '#000000', 0.55)],
      [0.3, p.bg],
      [0.48, mix(p.bg, p.special, 0.42)],
      [0.6, mix(p.bg, p.accent, 0.62)],
      [1, mix(p.bg, p.accent, 0.3)],
    ]) +
    linear('sy-sun', [
      [0, p.warn],
      [0.45, mix(p.warn, p.accent, 0.55)],
      [1, p.accent],
    ]) +
    glow('sy-halo', mix(p.accent, p.warn, 0.25), 0.5) +
    linear('sy-floor', [
      [0, mix(p.bg, p.accent, 0.34)],
      [0.3, mix(p.bg, p.special, 0.16)],
      [1, mix(p.bg, '#000000', 0.5)],
    ]) +
    glow('sy-hz', p.info, 0.5) +
    glow('sy-pool', p.accent, 0.4) +
    linear('sy-tr-a', [[0, p.info, 0], [1, p.info, 0.9]], 1, 0) +
    linear('sy-tr-b', [[0, p.accent, 0], [1, p.accent, 0.9]], 1, 0) +
    v.defs

  // The sun: slits through its lower half, wider toward the foot.
  const [sunY, sunR] = [392, 206]
  const gap = mix(p.bg, p.special, 0.5)
  let slits = ''
  for (const [dy, h] of [[6, 5], [38, 8], [70, 11], [102, 14], [134, 17]] as const) {
    const half = Math.sqrt(sunR * sunR - (dy + h / 2) ** 2) + 4
    slits += rect(vx - half, sunY + dy, half * 2, h, gap)
  }
  const sun = circle(vx, sunY, 640, paint('sy-halo'), { class: 'halo' }) + circle(vx, sunY, sunR, paint('sy-sun')) + slits

  // Mountains in facets, low in the middle so the sun stands clear.
  const range = (seed: number, base: number, height: number, stepX: number, lowest: number): { d: string; facets: string } => {
    const r = rnd(seed)
    const stride = coarse(stepX)
    const points: [number, number][] = []
    for (let x = -BLEED - stride; x <= WIDTH + BLEED + stride; x += stride) {
      const side = Math.min(1, Math.abs(x - vx) / 720)
      const up = (points.length % 2 === 0 ? 0.3 : 1) * (0.55 + r() * 0.45)
      points.push([x, base - height * (lowest + (1 - lowest) * side * side) * up])
    }
    let d = `M${-BLEED - stride} ${base}`
    let facets = ''
    points.forEach(([x, y], i) => {
      d += `L${n(x)} ${n(y)}`
      if (i % 2 === 1) facets += `M${n(x)} ${n(y)}L${n(x + stride * 0.3)} ${base}M${n(x)} ${n(y)}L${n(x - stride * 0.6)} ${base}M${n(x)} ${n(y)}L${n(x + stride * 0.85)} ${base}`
    })
    return { d: `${d}L${WIDTH + BLEED + stride} ${base}z`, facets }
  }
  const back = range(81, hz + 2, 250, 120, 0.12)
  const front = range(82, hz + 2, 170, 150, 0.06)

  // The floor: lanes meeting at the horizon, cross lines coming toward the viewer.
  let lanes = ''
  for (let k = -18; k <= 18; k += 1) lanes += `M${vx + k * 8} ${hz}L${vx + k * 190} ${HEIGHT}`
  const depth = (z: number) => hz + 360 / z
  let cross = ''
  let rules = ''
  const count = 15
  for (let i = 0; i < count; i += 1) {
    const y = depth(i + 1)
    let frames = ''
    for (let s = 0; s <= 4; s += 1) frames += `${s * 25}%{transform:translateY(${n(Math.min(depth(i + 1 - s / 4 + 0.0001), 1500) - y)}px)}`
    rules += `@keyframes sy-l${i}{${frames}}.sy-l${i}{animation:sy-l${i} 2.6s linear infinite}`
    cross += line(-BLEED, y, WIDTH + BLEED, y, p.accent, { 'stroke-width': 1 + 2.4 / (i + 1), opacity: 0.38 + 0.5 / (i + 1), class: `sy-l${i}` })
  }
  const floor =
    rect(-BLEED, hz, WIDTH + 2 * BLEED, HEIGHT - hz, paint('sy-floor')) +
    ellipse(vx, hz + 70, 300, 70, paint('sy-pool')) +
    path(lanes, { fill: 'none', stroke: p.accent, 'stroke-width': 1.5, opacity: 0.6 }) +
    cross +
    ellipse(vx, hz, 980, 34, paint('sy-hz')) +
    rect(-BLEED, hz - 1.5, WIDTH + 2 * BLEED, 3, mix(p.info, '#ffffff', 0.3))

  // Near: dark ground rising at the right, palms at both edges.
  const ink = mix(p.bg, '#000000', 0.74)
  const palm = (x: number, base: number, h: number, lean: number): string => {
    const [tx, ty, s] = [x + lean, base - h, h / 280]
    let fronds = ''
    for (const [ex, ey] of [[-170, 60], [-132, -6], [-70, -56], [66, -58], [130, -8], [172, 58], [-96, 104], [100, 102]] as const) {
      const [cx, cy] = [tx + ex * s * 0.5, ty + (ey - 84) * s]
      fronds += `M${n(tx)} ${n(ty)}Q${n(cx)} ${n(cy)} ${n(tx + ex * s)} ${n(ty + ey * s)}Q${n(cx)} ${n(cy + 46 * s)} ${n(tx)} ${n(ty + 10 * s)}z`
    }
    return group(path(`M${x} ${base}Q${n(x + lean * 0.2)} ${n(base - h * 0.55)} ${n(tx)} ${n(ty)}`, { fill: 'none', stroke: ink, 'stroke-width': n(12 * s), 'stroke-linecap': 'round' }) + path(fronds, { fill: ink }) + circle(tx, ty, 9 * s, ink), { class: 'bend' })
  }
  const ground = path('M-80 900V846Q160 800 380 846T760 880Q960 884 1090 790Q1200 706 1330 704Q1470 706 1680 780V900z', { fill: ink })
  const rim = path('M-80 846Q160 800 380 846T760 880Q960 884 1090 790Q1200 706 1330 704Q1470 706 1680 780', { fill: 'none', stroke: mix(p.bg, p.accent, 0.4), 'stroke-width': 2 })
  const trails = drift(83, 7, 'trail', 22, (x, y, k, pick) => rect(x, 300 + y * 0.24, 130 + pick() * 170, 2.4, paint(k % 2 === 0 ? 'sy-tr-a' : 'sy-tr-b'), { rx: 1 }))
  const motes = drift(84, 16, 'mote', 70, (x, y, k, pick) => circle(x, y, 1.1 + pick() * 1.5, alpha(k % 2 === 0 ? p.info : p.accent, 0.5)))
  return {
    alt: 'A banded sun setting over a glowing grid floor that runs to the horizon, faceted mountains either side, palm trees in silhouette and light trails across an indigo sky.',
    bolt: { x: 1276, y: 588 },
    defs,
    style: PARALLAX + CROSS + anim('trail', 'cross') + RISE + anim('mote', 'rise') + BEND + pulse('halo', 0.78, 1, 8) + pulse('tw', 0.25, 1, 5) + rules,
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('sy-sky')) +
      stars(85, 120, 470, p.text) +
      trails +
      sun +
      layer(
        'far',
        path(back.d, { fill: mix(p.bg, p.special, 0.26), stroke: p.special, 'stroke-width': 1.5, 'stroke-opacity': 0.7 }) +
          path(back.facets, { fill: 'none', stroke: p.special, 'stroke-width': 1, opacity: 0.38 }) +
          path(front.d, { fill: mix(p.bg, '#000000', 0.3), stroke: p.info, 'stroke-width': 1.8, 'stroke-opacity': 0.85 }) +
          path(front.facets, { fill: 'none', stroke: p.info, 'stroke-width': 1, opacity: 0.42 }),
      ) +
      layer('mid', floor) +
      motes +
      layer('near', palm(1478, 716, 300, -34) + palm(1574, 742, 226, 30) + palm(118, 836, 340, 44) + ground + rim + BOLT_HERE) +
      v.body,
  }
}

/** An operations room at night: a wall of dashboards, a desk with two monitors and a pager glowing red. */
const onCall: Make = ({ palette: p }) => {
  const r = rnd(91)
  const v = vignette('oc-vig', '#000000', 0.68)
  const defs =
    linear('oc-wall', [
      [0, mix(p.bg, '#000000', 0.5)],
      [0.6, p.bg],
      [1, mix(p.bg, '#000000', 0.3)],
    ]) +
    glow('oc-spill', p.info, 0.1) +
    glow('oc-red', p.error, 0.5) +
    glow('oc-amb', p.accent, 0.4) +
    glow('oc-mon', p.info, 0.22) +
    linear('oc-area', [
      [0, p.info, 0.45],
      [1, p.info, 0.02],
    ]) +
    linear('oc-sweep', [[0, p.ok, 0], [1, p.ok, 0.14]], 1, 0) +
    v.defs
  const frame = mix(p.bg, p.text, 0.13)
  const glass = mix(p.bg, p.text, 0.045)
  const quiet = mix(p.bg, p.text, 0.2)
  const panel = (x: number, y: number, w: number, h: number): string =>
    rect(x, y, w, h, glass, { rx: 10, stroke: frame, 'stroke-width': 1.5 }) + rect(x + 16, y + 14, 64, 6, quiet, { rx: 3 }) + circle(x + w - 20, y + 17, 3.5, quiet) + circle(x + w - 34, y + 17, 3.5, quiet)
  // A heartbeat: a flat line, a small wave, a spike, a slow wave, `beats` times over.
  const beatD = (x: number, y: number, w: number, h: number, beats: number): string => {
    const span = w / beats
    let d = `M${n(x)} ${n(y)}`
    for (let b = 0; b < beats; b += 1) {
      d += `h${n(span * 0.3)}l${n(span * 0.05)} ${n(-h * 0.1)}l${n(span * 0.05)} ${n(h * 0.1)}h${n(span * 0.08)}l${n(span * 0.04)} ${n(h * 0.14)}l${n(span * 0.06)} ${n(-h * 0.72)}l${n(span * 0.06)} ${n(h * 0.84)}l${n(span * 0.04)} ${n(-h * 0.26)}h${n(span * 0.1)}q${n(span * 0.06)} ${n(-h * 0.16)} ${n(span * 0.12)} 0h${n(span * 0.1)}`
    }
    return d
  }
  const trace = (x: number, y: number, w: number, h: number, beats: number, colour: string, cls: string): string =>
    path(beatD(x, y, w, h, beats), { fill: 'none', stroke: colour, 'stroke-width': 7, opacity: 0.16, 'stroke-linejoin': 'round' }) + path(beatD(x, y, w, h, beats), { fill: 'none', stroke: colour, 'stroke-width': 2.4, opacity: 0.9, 'stroke-linejoin': 'round', class: cls })
  const gridlines = (x: number, y: number, w: number, h: number): string => {
    let d = ''
    for (let k = 1; k < 4; k += 1) d += `M${x} ${n(y + (h * k) / 4)}h${w}`
    return path(d, { fill: 'none', stroke: frame, 'stroke-width': 1, opacity: 0.7 })
  }

  // Row one: a long healthy trace, the status grid, request bars, a gauge.
  const a = panel(380, 120, 560, 190) + gridlines(396, 150, 528, 140) + rect(396, 152, 44, 140, paint('oc-sweep'), { class: 'sweep' }) + trace(396, 244, 528, 104, 6, p.ok, 'trace')
  let dots = ''
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const [cx, cy, k] = [118 + col * 29, 162 + row * 28, row * 8 + col]
      if (k === 13) dots += circle(cx, cy, 30, paint('oc-amb'), { class: 'amb' }) + circle(cx, cy, 8, p.accent, { class: 'amb' })
      else if (k === 29) dots += circle(cx, cy, 38, paint('oc-red'), { class: 'red' }) + circle(cx, cy, 8, p.error, { class: 'red' })
      else dots += circle(cx, cy, 7.5, p.ok, { opacity: 0.45 + r() * 0.4 })
    }
  }
  const b = panel(90, 120, 260, 190) + dots
  let bars = ''
  let hot = ''
  for (let k = 0; k < 12; k += 1) {
    const h = 26 + r() * 70 + (k > 8 ? 34 : 0)
    const d = `M${990 + k * 19} ${292 - h}h12v${n(h)}h-12z`
    if (k > 8) hot += d
    else bars += d
  }
  const c = panel(970, 120, 260, 190) + gridlines(986, 150, 228, 142) + path(bars, { fill: p.info, opacity: 0.75 }) + path(hot, { fill: p.accent, opacity: 0.9 })
  const [gx, gy, gr] = [1390, 262, 78]
  const needle = (-28 * Math.PI) / 180
  const d =
    panel(1260, 120, 260, 190) +
    path(`M${gx - gr} ${gy}A${gr} ${gr} 0 0 1 ${gx + gr} ${gy}`, { fill: 'none', stroke: frame, 'stroke-width': 16, 'stroke-linecap': 'round' }) +
    path(`M${gx - gr} ${gy}A${gr} ${gr} 0 0 1 ${n(gx + Math.sin(needle + 0.5) * gr)} ${n(gy - Math.cos(needle + 0.5) * gr)}`, { fill: 'none', stroke: p.warn, 'stroke-width': 16, 'stroke-linecap': 'round', opacity: 0.9 }) +
    path(`M${gx} ${gy}L${n(gx + Math.sin(needle + 0.5) * (gr - 16))} ${n(gy - Math.cos(needle + 0.5) * (gr - 16))}`, { fill: 'none', stroke: p.text, 'stroke-width': 4, 'stroke-linecap': 'round' }) +
    circle(gx, gy, 8, p.text)

  // Row two: an area chart, a heat map, the trace that raised the page, uptime rows.
  const wave = noise(92)
  let area = 'M106 504'
  let top = ''
  for (let x = 106; x <= 334; x += coarse(12)) {
    const y = 470 - wave(x / 34) * 78
    area += `L${n(x)} ${n(y)}`
    top += `${top === '' ? 'M' : 'L'}${n(x)} ${n(y)}`
  }
  const e = panel(90, 340, 260, 180) + gridlines(106, 370, 228, 134) + path(`${area}L334 504z`, { fill: paint('oc-area') }) + path(top, { fill: 'none', stroke: p.info, 'stroke-width': 2.2 })
  const cool: [number, number][] = []
  const warm: [number, number][] = []
  const cold: [number, number][] = []
  for (let row = 0; row < 6; row += 1) for (let col = 0; col < 11; col += 1) (r() < 0.12 ? warm : r() < 0.5 ? cool : cold).push([398 + col * 22, 374 + row * 22])
  const f = panel(380, 340, 270, 180) + path(cellsD(cold, 18, 18), { fill: p.ok, opacity: 0.22 }) + path(cellsD(cool, 18, 18), { fill: p.ok, opacity: 0.6 }) + path(cellsD(warm, 18, 18), { fill: p.accent, opacity: 0.9 }) + rect(398 + 7 * 22, 374 + 2 * 22, 18, 18, p.error, { class: 'red' })
  const g = ellipse(955, 430, 360, 150, paint('oc-red'), { class: 'alarm', opacity: 0.5 }) + panel(680, 340, 550, 180) + gridlines(696, 370, 518, 134) + trace(696, 456, 518, 96, 9, p.error, 'trace-b')
  let up = ''
  let down = ''
  for (let row = 0; row < 5; row += 1) for (let k = 0; k < 20; k += 1) if (r() < 0.07) down += `M${1278 + k * 11.4} ${374 + row * 27}h8v16h-8z`
  else up += `M${1278 + k * 11.4} ${374 + row * 27}h8v16h-8z`
  const h = panel(1260, 340, 260, 180) + path(up, { fill: p.ok, opacity: 0.6 }) + path(down, { fill: p.accent, opacity: 0.95 })
  const wall = ellipse(800, 320, 980, 330, paint('oc-spill')) + a + b + c + d + e + f + g + h + rect(-BLEED, 600, WIDTH + 2 * BLEED, HEIGHT - 600, mix(p.bg, '#000000', 0.4))

  // The desk: two monitors, a keyboard, the pager, a mug and a rubber duck.
  const shell = mix(p.bg, p.text, 0.14)
  const monitor = (x: number, seed: number, colours: readonly [string, string]): string =>
    circle(x + 135, 520, 250, paint('oc-mon')) +
    rect(x + 115, 606, 40, 36, mix(shell, '#000000', 0.3)) +
    rect(x + 70, 636, 130, 10, mix(shell, '#000000', 0.2), { rx: 4 }) +
    rect(x, 428, 270, 184, shell, { rx: 10 }) +
    rect(x + 10, 438, 250, 160, mix(p.bg, p.info, 0.1), { rx: 4 }) +
    path(outputD(seed, x + 24, 452, 210, 9, 15, 5.5), { fill: colours[0], opacity: 0.75 }) +
    path(outputD(seed + 1, x + 24, 452 + 15 * 3, 150, 2, 15 * 3, 5.5), { fill: colours[1], opacity: 0.95 })
  let keys = ''
  for (let row = 0; row < 3; row += 1) for (let k = 0; k < 14; k += 1) keys += `M${418 + k * 18 - row * 4} ${656 + row * 8}h13v5h-13z`
  const keyboard = polygon([[408, 650], [676, 650], [690, 684], [392, 684]], mix(shell, '#000000', 0.25)) + path(keys, { fill: mix(shell, p.text, 0.2) })
  const pager =
    circle(930, 630, 150, paint('oc-red'), { class: 'pager', opacity: 0.9 }) +
    rect(880, 612, 100, 38, mix(p.bg, p.text, 0.24), { rx: 7 }) +
    rect(890, 621, 58, 16, p.error, { rx: 3, class: 'pager', opacity: 0.95 }) +
    circle(964, 629, 5, p.error, { class: 'pager' }) +
    rect(970, 602, 4, 12, mix(p.bg, p.text, 0.3))
  const mug = path(mugD(1016, 650, 36, 44), { fill: mix(p.bg, p.text, 0.3) }) + rect(1016, 616, 36, 5, mix(p.bg, p.accent, 0.5))
  const duck = ellipse(1118, 638, 19, 13, p.warn) + circle(1132, 620, 10, p.warn) + polygon([[1140, 618], [1152, 622], [1140, 626]], p.special) + circle(1135, 617, 1.8, p.bg) + polygon([[1099, 634], [1088, 626], [1102, 628]], p.warn)
  const desk = rect(-BLEED, 644, WIDTH + 2 * BLEED, 66, mix(p.bg, p.text, 0.09)) + rect(-BLEED, 644, WIDTH + 2 * BLEED, 3, mix(p.bg, p.text, 0.2))

  // Near: the desk front, a chair back, Bolt.
  const front = mix(p.bg, '#000000', 0.55)
  const seat = mix(p.bg, '#000000', 0.3)
  const chair =
    path('M438 900V792q0 -22 22 -22h30v130zM760 900V792q0 -22 -22 -22h-30v130z', { fill: mix(seat, '#000000', 0.4) }) +
    path('M482 900V700q0 -66 66 -66h104q66 0 66 66V900z', { fill: seat, stroke: mix(p.bg, p.text, 0.22), 'stroke-width': 2 }) +
    path('M516 690h168M516 730h168M516 770h168M516 810h168M516 850h168', { fill: 'none', stroke: mix(seat, '#000000', 0.35), 'stroke-width': 3 })
  const edge =
    rect(-BLEED, 700, WIDTH + 2 * BLEED, HEIGHT - 700, front) +
    rect(-BLEED, 700, WIDTH + 2 * BLEED, 4, mix(p.bg, p.text, 0.16)) +
    path('M60 752h330v112h-330zM860 752h330v112h-330zM1250 752h330v112h-330z', { fill: mix(front, '#000000', 0.25), stroke: mix(p.bg, p.text, 0.08), 'stroke-width': 2 }) +
    path('M190 780h70M990 780h70M1380 780h70', { fill: 'none', stroke: mix(p.bg, p.text, 0.2), 'stroke-width': 5, 'stroke-linecap': 'round' })
  const motes = drift(93, 16, 'mote', 96, (x, y, k, pick) => circle(x, y, 1 + pick() * 1.4, alpha(k % 4 === 0 ? p.accent : p.text, 0.24)))
  return {
    alt: 'An operations room at night: a wall of dashboards with heartbeat traces, bar charts and a grid of status lights, one amber and one red; a desk with two monitors, a pager glowing red, a mug and a rubber duck.',
    bolt: { x: 1276, y: 580 },
    defs,
    style:
      PARALLAX +
      RISE +
      anim('mote', 'rise') +
      SMOKE +
      pulse('trace', 0.6, 1, 2.4) +
      pulse('trace-b', 0.45, 1, 1.6) +
      pulse('amb', 0.4, 1, 3.2) +
      pulse('red', 0.3, 1, 2.2) +
      pulse('alarm', 0.2, 0.6, 2.2) +
      pulse('pager', 0.35, 1, 1.8) +
      '@keyframes sweep{from{transform:translateX(0)}to{transform:translateX(484px)}}.sweep{animation:sweep 7s linear infinite}',
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('oc-wall')) +
      layer('far', wall) +
      layer('mid', desk + monitor(84, 94, [p.info, p.ok]) + monitor(640, 96, [p.muted, p.accent]) + group(keyboard, { transform: 'translate(176 0)' }) + group(pager, { transform: 'translate(530 0)' }) + group(mug + smoke(1034, 608, mix(p.text, p.bg, 0.3)), { transform: 'translate(-650 0)' }) + duck) +
      motes +
      layer('near', edge + group(chair, { transform: 'translate(176 0)' }) + BOLT_HERE) +
      v.body,
  }
}

export const TECH_SCENES: Record<string, Make> = { phosphor, graphite, clay, synthwave, 'on-call': onCall }
