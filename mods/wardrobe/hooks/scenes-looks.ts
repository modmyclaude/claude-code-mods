// The nine everyday looks' scenes. Each is a function of the theme, so a
// colour comes from the look's own palette and the picture stays on-look.
// Every moving part rests where its markup puts it, so the still picture the
// desktop draws under reduced motion is a finished one.

import { alpha, anim, circle, CROSS, drift, ellipse, FALL, group, HEIGHT, line, n, path, polygon, pulse, rect, rnd, skyline, SWAY, WIDTH } from './scene-kit'
import type { Scene } from './scene-kit'
import type { Theme } from './themes'

type Make = (theme: Theme) => Scene

const FLAP = '@keyframes flap{0%,100%{transform:scaleY(1)}50%{transform:scaleY(0.55)}}.flap{transform-box:fill-box;transform-origin:center;animation:flap 1.6s ease-in-out infinite}'
const BAT = 'M0 0q7 -9 14 0q7 -9 14 0l-14 7z'

/** Rain over a dark city, a searchlight sweeping the sky. */
const noir: Make = ({ palette: p }) => {
  const r = rnd(7)
  let windows = ''
  for (let i = 0; i < 70; i += 1) {
    windows += rect(r() * WIDTH, 520 + r() * 330, 4, 7, p.text, { opacity: n(0.35 + r() * 0.4), class: i % 5 === 0 ? 'win' : undefined })
  }
  const rain = drift(11, 48, 'rain', 2, (x, y) => line(x, y, x - 4, y + 34, alpha(p.muted, 0.45), { 'stroke-width': 1 }))
  const beam = polygon([[220, HEIGHT], [520, 0], [740, 0]], alpha(p.text, 0.06), { class: 'beam' })
  return {
    alt: 'A rainy night over a dark city block: lit windows, slow rain and a searchlight sweeping the sky.',
    style:
      FALL +
      anim('rain', 'fall') +
      pulse('win', 0.3, 0.9, 7) +
      '@keyframes sweep{0%,100%{transform:rotate(-13deg)}50%{transform:rotate(13deg)}}.beam{transform-origin:220px 900px;animation:sweep 28s ease-in-out infinite}',
    body: skyline(1, HEIGHT, 140, 440, 24, '#1a1a1a') + windows + skyline(2, HEIGHT, 50, 260, 16, '#131313') + beam + rain,
  }
}

/** Ruled paper with a margin, faint ink blots and a pen line drawing itself. */
const paper: Make = ({ palette: p }) => {
  let rules = ''
  for (let y = 96; y < HEIGHT; y += 56) rules += line(0, y, WIDTH, y, alpha(p.info, 0.14), { 'stroke-width': 1 })
  const margin = line(180, 0, 180, HEIGHT, alpha(p.error, 0.22), { 'stroke-width': 2 })
  const blots = [
    [320, 240, 160],
    [1180, 700, 210],
    [1420, 180, 110],
  ]
    .map(([x, y, rad], i) => circle(x!, y!, rad!, alpha(p.accent, 0.05), { class: `blot${i}` }))
    .join('')
  const pen = path('M140 640c80 -120 160 -120 240 0s160 120 240 0s160 -120 240 0s160 120 240 0s160 -120 240 0s120 90 200 20', {
    fill: 'none',
    stroke: p.accent,
    'stroke-width': 3,
    'stroke-linecap': 'round',
    'stroke-dasharray': 4200,
    'stroke-dashoffset': 0,
    class: 'pen',
  })
  return {
    alt: 'Warm ruled paper with a red margin, a few faint ink blots and one blue pen line writing itself across the page.',
    style:
      SWAY +
      '.blot0{animation:sway 38s ease-in-out infinite}.blot1{animation:sway 46s ease-in-out infinite reverse}.blot2{animation:sway 52s ease-in-out infinite}' +
      '@keyframes draw{from{stroke-dashoffset:4200}to{stroke-dashoffset:0}}.pen{animation:draw 36s linear infinite}',
    body: rules + margin + blots + pen,
  }
}

/** A neon skyline at night, signs breathing, a train crossing a bridge. */
const tokyoNight: Make = ({ palette: p }) => {
  const r = rnd(21)
  let windows = ''
  for (let i = 0; i < 90; i += 1) {
    windows += rect(r() * WIDTH, 540 + r() * 340, 5, 6, i % 3 === 0 ? p.info : p.accent, { opacity: 0.6, class: i % 6 === 0 ? 'glow' : undefined })
  }
  const signs = [
    [300, 560, p.special],
    [640, 600, p.error],
    [1380, 580, p.special],
    [1500, 640, p.accent],
  ]
    .map(([x, y, c]) => rect(Number(x), Number(y), 10, 90, String(c), { opacity: 0.9, class: 'sign' }))
    .join('')
  let stars = ''
  for (let i = 0; i < 30; i += 1) stars += circle(r() * WIDTH, r() * 380, 1.2, alpha(p.text, 0.6))
  const bridge = line(0, 700, WIDTH, 700, alpha(p.muted, 0.35), { 'stroke-width': 3 })
  let train = ''
  for (let i = 0; i < 6; i += 1) train += rect(i * 44, 684, 38, 12, p.info) + rect(i * 44 + 6, 687, 26, 4, alpha(p.text, 0.8))
  return {
    alt: 'A neon city at night in cool blues: lit towers, breathing signs, stars, and a small train crossing a bridge.',
    style: CROSS + '.train{animation:cross 34s linear infinite}' + pulse('glow', 0.4, 0.95, 6) + pulse('sign', 0.55, 1, 5),
    body: stars + skyline(3, 700, 120, 380, 28, alpha(p.text, 0.07)) + bridge + group(train, { class: 'train' }) + skyline(4, HEIGHT, 160, 420, 18, '#111320') + windows + signs,
  }
}

/** A castle on a slate hill under a full moon, bats drifting through mist. */
const dracula: Make = ({ palette: p }) => {
  const hills = skyline(5, HEIGHT, 60, 220, 10, '#1f2130')
  let castle = ''
  for (const [x, y, w] of [
    [1000, 520, 60],
    [1090, 470, 80],
    [1200, 540, 56],
  ]) {
    castle += rect(x!, y!, w!, HEIGHT - y!, '#171822')
    for (let m = 0; m < w! / 14; m += 1) castle += rect(x! + m * 14, y! - 12, 8, 12, '#171822')
    castle += rect(x! + w! / 2 - 5, y! + 60, 10, 16, p.warn, { opacity: 0.85, class: 'cwin' })
  }
  const moon = circle(1180, 170, 72, p.text) + circle(1180, 170, 118, alpha(p.text, 0.08), { class: 'halo' })
  const bats = drift(6, 7, 'bat', 48, () => group(path(BAT, { fill: '#15101f' }), { class: 'flap' }))
  const mist = [
    [300, 760, 420, 40],
    [900, 800, 520, 50],
    [1300, 740, 380, 36],
  ]
    .map(([x, y, rx, ry]) => ellipse(x!, y!, rx!, ry!, alpha(p.special, 0.06), { class: 'mist' }))
    .join('')
  return {
    alt: 'A castle on a slate hill under a full moon, bats drifting past and violet mist on the ground.',
    style: CROSS + anim('bat', 'cross') + FLAP + pulse('halo', 0.05, 0.14, 9) + pulse('cwin', 0.5, 1, 4) + SWAY + '.mist{animation:sway 44s ease-in-out infinite}',
    body: moon + hills + castle + mist + bats,
  }
}

/** Pastel bubbles rising past a sleeping cat on a ledge. */
const catppuccin: Make = ({ palette: p }) => {
  const tints = [p.accent, p.info, p.ok, p.special, p.warn]
  const bubbles = drift(8, 18, 'bubble', 40, (x, y, k, pick) => circle(x, y, 14 + pick() * 34, alpha(tints[k % tints.length]!, 0.2)))
  const ledge = rect(100, 820, 360, 80, '#181825')
  const cat =
    ellipse(280, 804, 112, 44, '#11111b') +
    circle(372, 776, 40, '#11111b') +
    polygon([[344, 748], [352, 712], [372, 744]], '#11111b') +
    polygon([[388, 744], [404, 712], [408, 750]], '#11111b') +
    path('M170 800q-60 -10 -40 -60', { fill: 'none', stroke: '#11111b', 'stroke-width': 14, 'stroke-linecap': 'round' })
  return {
    alt: 'Soft pastel bubbles rising slowly past a cat asleep on a ledge.',
    style:
      '@keyframes rise{from{transform:translateY(950px)}to{transform:translateY(-950px)}}' +
      anim('bubble', 'rise') +
      '@keyframes breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.02,1.05)}}.cat{transform-box:fill-box;transform-origin:center bottom;animation:breathe 5s ease-in-out infinite}',
    body: bubbles + ledge + group(cat, { class: 'cat' }),
  }
}

/** A low sun with breathing halos over a shimmering sea. */
const solarized: Make = ({ palette: p }) => {
  const glow = ellipse(1120, 640, 520, 180, alpha(p.warn, 0.08))
  const rings = [140, 200, 270]
    .map((rad, i) => circle(1120, 640, rad, 'none', { stroke: alpha(p.warn, [0.28, 0.16, 0.08][i]!), 'stroke-width': 2, class: 'ring' }))
    .join('')
  const sun = circle(1120, 640, 90, p.warn)
  let sea = rect(0, 640, WIDTH, 260, alpha(p.info, 0.1))
  let k = 0
  for (let y = 656; y < HEIGHT; y += 24) {
    sea += rect(-100, y, WIDTH + 200, 6, alpha(p.info, 0.14), { class: 'stripe', style: `animation-delay:${n(-k * 3.7)}s` })
    k += 1
  }
  return {
    alt: 'A low amber sun with breathing halo rings over a slow, shimmering teal sea.',
    style: '@keyframes breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}.ring{transform-origin:1120px 640px;animation:breathe 12s ease-in-out infinite}' + SWAY + '.stripe{animation:sway 30s ease-in-out infinite}',
    body: glow + rings + sun + sea,
  }
}

/** Aurora over snowy ridges, stars twinkling. */
const nord: Make = ({ palette: p }) => {
  const r = rnd(33)
  let stars = ''
  for (let i = 0; i < 40; i += 1) stars += circle(r() * WIDTH, r() * 520, 1.5 + r() * 1.1, p.text, { opacity: n(0.5 + r() * 0.4), class: i % 4 === 0 ? 'twinkle' : undefined })
  const ribbon = (y: number, colour: string, seconds: number) =>
    path(`M-200 ${n(y)}q200 -120 400 0t400 0t400 0t400 0t400 0v140q-200 120 -400 0t-400 0t-400 0t-400 0t-400 0z`, {
      fill: alpha(colour, 0.2),
      class: 'aurora',
      style: `animation-duration:${n(seconds)}s`,
    })
  const aurora = ribbon(180, p.accent, 26) + ribbon(300, p.ok, 34) + ribbon(240, p.special, 30)
  return {
    alt: 'Three ribbons of aurora waving over snowy ridges, with stars twinkling above.',
    style:
      '@keyframes wave{0%,100%{transform:skewX(-6deg) translateX(-60px)}50%{transform:skewX(6deg) translateX(60px)}}.aurora{transform-origin:center;animation-name:wave;animation-timing-function:ease-in-out;animation-iteration-count:infinite}' +
      pulse('twinkle', 0.3, 1, 6),
    body: stars + aurora + skyline(9, HEIGHT, 80, 300, 12, '#3b4252') + skyline(10, HEIGHT, 40, 180, 9, '#434c5e'),
  }
}

/** A calm white grid drifting over black, one outline shape in each corner. */
const highContrast: Make = ({ palette: p }) => {
  let grid = ''
  for (let x = -100; x <= WIDTH + 100; x += 100) grid += line(x, -100, x, HEIGHT + 100, alpha(p.text, 0.14), { 'stroke-width': 1 })
  for (let y = -100; y <= HEIGHT + 100; y += 100) grid += line(-100, y, WIDTH + 100, y, alpha(p.text, 0.14), { 'stroke-width': 1 })
  const stroke = { stroke: alpha(p.text, 0.22), 'stroke-width': 3 }
  const shapes =
    circle(160, 150, 90, 'none', stroke) +
    rect(1340, 60, 180, 180, 'none', stroke) +
    polygon([[120, 780], [260, 780], [190, 660]], 'none', stroke) +
    polygon([[1430, 700], [1510, 780], [1430, 860], [1350, 780]], 'none', stroke)
  return {
    alt: 'A calm white grid drifting slowly over black, with an outline circle, square, triangle and diamond in the corners.',
    style: '@keyframes slide{from{transform:translate(-100px,-100px)}to{transform:translate(0,0)}}.grid{animation:slide 60s linear infinite}',
    body: group(grid, { class: 'grid' }) + shapes,
  }
}

/** Blue and orange shapes, told apart by shape, gliding in calm lanes. */
const colorblind: Make = ({ palette: p, diff }) => {
  const blue = diff.addFg
  const orange = diff.removeFg
  const shape = (kind: number, x: number, y: number, colour: string) => {
    const more = { opacity: 0.32 }
    if (kind === 0) return polygon([[x, y - 36], [x + 36, y + 28], [x - 36, y + 28]], colour, more)
    if (kind === 1) return circle(x, y, 34, colour, more)
    if (kind === 2) return polygon([[x, y - 38], [x + 38, y], [x, y + 38], [x - 38, y]], colour, more)
    return rect(x - 30, y - 30, 60, 60, colour, more)
  }
  let lanes = ''
  ;[110, 290, 470, 650].forEach((y, lane) => {
    let row = ''
    for (let k = 0; k < 4; k += 1) row += shape(lane, 160 + k * 560, y, k % 2 === 0 ? blue : orange)
    lanes += group(row, { class: 'lane', style: `animation-duration:${n(70 + lane * 9)}s;animation-direction:${lane % 2 === 0 ? 'normal' : 'reverse'}` })
  })
  const dots = drift(17, 24, 'dot', 60, (x, y, k) => circle(x, y, 3, k % 2 === 0 ? blue : orange, { opacity: 0.4 }))
  return {
    alt: 'Blue and orange triangles, discs, diamonds and squares gliding slowly in calm lanes.',
    style: '@keyframes lane{from{transform:translateX(0)}to{transform:translateX(-560px)}}.lane{animation-name:lane;animation-timing-function:linear;animation-iteration-count:infinite}' + FALL + anim('dot', 'fall'),
    body: lanes + dots,
  }
}

export const LOOK_SCENES: Record<string, Make> = {
  noir,
  paper,
  'tokyo-night': tokyoNight,
  dracula,
  catppuccin,
  solarized,
  nord,
  'high-contrast': highContrast,
  colorblind,
}
