// The five seasonal packs' scenes: what /wear season puts behind the chat as
// the calendar turns. Same rules as scenes-looks.ts: the look's own colours,
// slow motion, and a finished picture at rest.

import { alpha, anim, circle, CROSS, drift, ellipse, FALL, group, HEIGHT, n, path, polygon, pulse, rect, rnd, skyline, SWAY, WIDTH } from './scene-kit'
import type { Scene } from './scene-kit'
import type { Theme } from './themes'

type Make = (theme: Theme) => Scene

const FLAP = '@keyframes flap{0%,100%{transform:scaleY(1)}50%{transform:scaleY(0.55)}}.flap{transform-box:fill-box;transform-origin:center;animation:flap 1.6s ease-in-out infinite}'
const BAT = 'M0 0q7 -9 14 0q7 -9 14 0l-14 7z'
const SPIN = '@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}.spin{transform-box:fill-box;transform-origin:center;animation:spin 8s linear infinite}'

/** A thing that falls in its lane while it spins and sways: the three motions on three nested groups. */
const tumbling = (x: number, y: number, inner: string) => group(group(group(inner, { class: 'spin' }), { class: 'sway' }), { transform: `translate(${n(x)} ${n(y)})` })

/** Pumpkins in a dark field under a crescent moon, bats and a little fog. */
const halloween: Make = ({ palette: p }) => {
  const moon = circle(1260, 170, 82, p.text) + circle(1296, 150, 74, p.bg) + circle(1260, 170, 130, alpha(p.text, 0.07), { class: 'halo' })
  let pumpkins = ''
  for (const [x, y, rad] of [
    [180, 846, 62],
    [330, 858, 46],
    [520, 850, 56],
    [700, 862, 40],
    [900, 854, 52],
  ]) {
    const ry = rad! * 0.8
    pumpkins +=
      ellipse(x!, y!, rad!, ry, p.accent) +
      ellipse(x!, y!, rad! * 0.55, ry, 'none', { stroke: alpha(p.bg, 0.35), 'stroke-width': 3 }) +
      rect(x! - 5, y! - ry - 12, 10, 14, p.ok) +
      group(
        polygon([[x! - rad! * 0.45, y! - 6], [x! - rad! * 0.15, y! - 6], [x! - rad! * 0.3, y! - ry * 0.55]], p.warn) +
          polygon([[x! + rad! * 0.15, y! - 6], [x! + rad! * 0.45, y! - 6], [x! + rad! * 0.3, y! - ry * 0.55]], p.warn) +
          path(`M${n(x! - rad! * 0.4)} ${n(y! + ry * 0.25)}q${n(rad! * 0.4)} ${n(ry * 0.5)} ${n(rad! * 0.8)} 0l${n(-rad! * 0.15)} ${n(-ry * 0.1)}l${n(-rad! * 0.5)} 0z`, { fill: p.warn }),
        { class: 'glow' },
      )
  }
  const bats = drift(13, 6, 'bat', 46, () => group(path(BAT, { fill: '#09060e' }), { class: 'flap' }))
  const fog = [
    [260, 790, 380, 36],
    [860, 820, 520, 44],
    [1340, 780, 360, 32],
  ]
    .map(([x, y, rx, ry]) => ellipse(x!, y!, rx!, ry!, alpha(p.special, 0.05), { class: 'fog' }))
    .join('')
  return {
    alt: 'A dark pumpkin field under a crescent moon, carved faces glowing softly, bats drifting through thin violet fog.',
    style: pulse('glow', 0.75, 1, 5) + pulse('halo', 0.04, 0.12, 8) + CROSS + anim('bat', 'cross') + FLAP + SWAY + '.fog{animation:sway 40s ease-in-out infinite}',
    body: moon + skyline(12, HEIGHT, 40, 160, 9, '#160f22') + pumpkins + fog + bats,
  }
}

/** Snow falling on pines, a string of lights breathing along the top. */
const christmas: Make = ({ palette: p }) => {
  const ground = polygon([[0, HEIGHT], [0, 850], [WIDTH, 830], [WIDTH, HEIGHT]], alpha(p.text, 0.92))
  let trees = ''
  ;[90, 260, 440, 1180, 1340, 1500].forEach((x, i) => {
    const fill = i % 2 === 0 ? '#0b2316' : '#113a26'
    const base = 850 - (i % 3) * 10
    trees += rect(x - 10, base - 30, 20, 40, '#3a2a1a')
    for (let tier = 0; tier < 3; tier += 1) {
      const w = 130 - tier * 30
      const top = base - 90 - tier * 80
      trees += polygon([[x - w / 2, top + 110], [x + w / 2, top + 110], [x, top]], fill)
    }
  })
  const bulbs: [number, number][] = []
  for (let i = 0; i < 14; i += 1) {
    const x = 40 + i * 117
    bulbs.push([x, 72 + 44 * Math.sin((x / WIDTH) * Math.PI)])
  }
  const string = path('M' + bulbs.map(([x, y]) => `${n(x)} ${n(y)}`).join('L'), { fill: 'none', stroke: alpha(p.muted, 0.5), 'stroke-width': 2 })
  const lights = bulbs.map(([x, y], i) => circle(x, y + 10, 7, i % 2 === 0 ? p.error : p.warn, { class: 'bulb', style: `animation-delay:${n(-i * 0.7)}s` })).join('')
  const snow = drift(14, 60, 'snow', 18, (x, y, k, pick) => circle(x, y, 2 + pick() * 3, alpha(p.text, 0.85)))
  return {
    alt: 'Snow falling on dark pines over a white ground, with a string of red and gold lights breathing along the top.',
    style: FALL + anim('snow', 'fall') + pulse('bulb', 0.55, 1, 6),
    body: string + lights + ground + trees + snow,
  }
}

/** Petals drifting over soft hills, stems growing, a small sun. */
const spring: Make = ({ palette: p }) => {
  const hills = path('M0 760q400 -140 800 -60t800 -40v200h-1600z', { fill: alpha(p.info, 0.16) }) + path('M0 820q500 -100 1000 -20t600 -30v140h-1600z', { fill: alpha(p.ok, 0.18) })
  const sun = circle(1320, 150, 64, alpha(p.warn, 0.45)) + circle(1320, 150, 100, alpha(p.warn, 0.1), { class: 'halo' })
  const petals = drift(15, 26, 'petal', 24, (x, y) => tumbling(x, y, ellipse(0, 0, 8, 4.5, alpha(p.special, 0.8))))
  let stems = ''
  ;[120, 220, 300].forEach((x, i) => {
    stems += path(`M${n(x)} 900q-30 -160 40 -300`, { fill: 'none', stroke: p.ok, 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-dasharray': 600, 'stroke-dashoffset': 0, class: 'grow', style: `animation-delay:${n(-i * 9)}s` })
    stems += ellipse(x + 10, 760 - i * 20, 22, 9, alpha(p.ok, 0.9), { transform: `rotate(-30 ${n(x + 10)} ${n(760 - i * 20)})` })
  })
  return {
    alt: 'Pink petals drifting over soft green and sky-blue hills, green stems growing at the left, a small sun at the top right.',
    style: FALL + anim('petal', 'fall') + SPIN + SWAY + '.sway{animation:sway 5s ease-in-out infinite}' + '@keyframes grow{from{stroke-dashoffset:600}to{stroke-dashoffset:0}}.grow{animation:grow 30s linear infinite}' + pulse('halo', 0.06, 0.16, 10),
    body: hills + sun + stems + petals,
  }
}

/** A sun setting into a rolling teal sea under a coral sky. */
const summer: Make = ({ palette: p }) => {
  const sky = ellipse(1180, 600, 700, 220, alpha(p.error, 0.14), { class: 'glow' }) + ellipse(1180, 600, 400, 130, alpha(p.warn, 0.14))
  const sun = circle(1180, 600, 112, p.accent)
  const sea = rect(0, 600, WIDTH, 300, alpha(p.info, 0.3))
  const wave = (y: number, opacity: number, seconds: number, width: number) => {
    let d = `M-400 ${n(y)}`
    for (let x = -400; x < WIDTH + 400; x += 200) d += 'q50 -14 100 0t100 0'
    return path(d, { fill: 'none', stroke: alpha(p.info, opacity), 'stroke-width': width, class: 'roll', style: `animation-duration:${n(seconds)}s` })
  }
  const waves = wave(640, 0.5, 14, 3) + wave(700, 0.4, 18, 4) + wave(770, 0.32, 22, 5) + wave(850, 0.25, 26, 6)
  const r = rnd(44)
  let sparkles = ''
  for (let i = 0; i < 20; i += 1) sparkles += rect(r() * WIDTH, 620 + r() * 260, 6, 2, alpha(p.text, 0.6), { class: 'twinkle', style: `animation-delay:${n(-r() * 4)}s` })
  return {
    alt: 'A yellow sun setting into a rolling teal sea under a coral and gold glow, sparkles on the water.',
    style:
      '@keyframes roll{from{transform:translateX(-200px)}to{transform:translateX(0)}}.roll{animation-name:roll;animation-timing-function:linear;animation-iteration-count:infinite}' +
      pulse('twinkle', 0.2, 0.9, 4) +
      pulse('glow', 0.1, 0.2, 12),
    body: sky + sun + sea + waves + sparkles,
  }
}

/** Leaves tumbling from bare branches onto mossy ground. */
const autumn: Make = ({ palette: p }) => {
  const ground = polygon([[0, HEIGHT], [0, 830], [WIDTH, 850], [WIDTH, HEIGHT]], alpha(p.ok, 0.35))
  const haze = ellipse(1300, 120, 420, 160, alpha(p.text, 0.06))
  const branch = { fill: 'none', stroke: '#4a2f1d', 'stroke-linecap': 'round' }
  const branches =
    path('M0 40q180 60 320 180q60 50 140 60', { ...branch, 'stroke-width': 10 }) +
    path('M200 150q60 -30 120 -10', { ...branch, 'stroke-width': 5 }) +
    path('M1600 60q-200 40 -340 160q-50 40 -120 50', { ...branch, 'stroke-width': 9 }) +
    path('M1360 170q-50 -40 -110 -20', { ...branch, 'stroke-width': 5 })
  const tints = [p.accent, p.warn, p.ok, p.special]
  const leaves = drift(16, 24, 'leaf', 22, (x, y, k) => tumbling(x, y, path('M0 0q10 -14 20 0q-10 14 -20 0z', { fill: alpha(tints[k % tints.length]!, 0.9) })))
  return {
    alt: 'Amber, rust and moss leaves tumbling from bare branches onto a mossy ground, under a faint cream haze.',
    style: FALL + anim('leaf', 'fall') + SPIN + SWAY + '.sway{animation:sway 6s ease-in-out infinite}',
    body: haze + ground + branches + leaves,
  }
}

export const SEASON_SCENES: Record<string, Make> = { halloween, christmas, spring, summer, autumn }
