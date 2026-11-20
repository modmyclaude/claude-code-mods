// The nine everyday looks' scenes. Each is a function of the theme, so every
// colour comes from the look's own palette and the picture stays on-look.
// Every moving part rests where its markup puts it, so the still picture the
// desktop draws under reduced motion is a finished one.

import { alpha, anim, BEND, BOB, BOLT_HERE, capsD, cellsD, circle, city, cloud, coarse, CROSS, drift, ellipse, FALL, few, FLAP, glow, group, HEIGHT, layer, line, linear, mix, n, orbit, paint, PARALLAX, path, pattern, pineD, pinesD, polygon, pulse, radial, rect, ridge, RISE, rnd, SMOKE, smoke, stars, SWAY, vignette, WIDTH } from './scene-kit'
import type { Scene } from './scene-kit'
import type { Theme } from './themes'

type Make = (theme: Theme) => Scene

const BAT = 'M0 0c3 -8 9 -9 13 -4l2 -3l2 3c4 -5 10 -4 13 4c-4 -3 -7 -2 -9 1c-2 -3 -4 -3 -6 0c-2 -3 -4 -3 -6 0c-2 -3 -5 -4 -9 -1z'

/** A castle on a crag against a full moon, pines below, bats and mist. */
const dracula: Make = ({ palette: p }) => {
  const night = mix(p.bg, '#000000', 0.55)
  const stone = mix(p.bg, '#000000', 0.62)
  const v = vignette('dr-vig', '#04040a', 0.62)
  const defs =
    linear('dr-sky', [
      [0, night],
      [0.5, p.bg],
      [0.78, mix(p.bg, p.accent, 0.32)],
      [1, mix(p.bg, p.special, 0.3)],
    ]) +
    radial('dr-moon', [
      [0, '#ffffff'],
      [0.75, p.text],
      [1, mix(p.text, p.accent, 0.3)],
    ]) +
    glow('dr-halo', mix(p.text, p.accent, 0.4), 0.42) +
    glow('dr-mist', mix(p.special, p.text, 0.25), 0.2) +
    glow('dr-lamp', p.warn, 0.5) +
    v.defs
  const [mx, my] = [455, 225]
  const moon =
    circle(mx, my, 430, paint('dr-halo'), { class: 'halo' }) +
    circle(mx, my, 122, paint('dr-moon')) +
    [
      [-38, -30, 22],
      [30, 12, 30],
      [-12, 52, 16],
      [52, -52, 12],
    ]
      .map(([x, y, r]) => circle(mx + x!, my + y!, r!, alpha(p.accent, 0.1)))
      .join('')
  const clouds =
    group(cloud(260, 300, 520, mix(p.bg, p.accent, 0.35), 0.5), { class: 'cl', style: 'animation-duration:210s;animation-delay:-80s' }) +
    group(cloud(1180, 170, 420, mix(p.bg, p.accent, 0.3), 0.4), { class: 'cl', style: 'animation-duration:260s;animation-delay:-150s' })
  const far = ridge(50, 690, 330, 620, { sharp: true })
  const far2 = ridge(52, 730, 200, 380, { sharp: true })
  const mid = ridge(51, 800, 150, 560)
  // The castle: towers, a keep with a spire, a curtain wall, on a crag at the left.
  let castle = 'M-80 900L-80 730L30 690L110 612L180 590L236 524L604 524L640 580L706 606L770 700L880 760L960 900z'
  const tower = (x: number, top: number, w: number, roof: number) => {
    castle += `M${x} 530V${top}h${w}V530zM${x - 9} ${top}L${x + w / 2} ${top - roof}L${x + w + 9} ${top}z`
  }
  tower(250, 372, 58, 78)
  tower(532, 392, 58, 70)
  tower(326, 338, 30, 56)
  tower(486, 352, 26, 50)
  castle += 'M384 530V306h76V530zM374 306L422 170L470 306z'
  castle += 'M300 530V452h240V530z'
  for (let x = 300; x < 540; x += 22) castle += `M${x} 452v-13h11v13z`
  for (let x = 384; x < 460; x += 19) castle += `M${x} 306v-11h10v11z`
  const slits = [
    [272, 410],
    [288, 458],
    [554, 428],
    [570, 470],
    [338, 372],
    [496, 384],
    [404, 344],
    [432, 344],
    [418, 400],
    [404, 452],
    [432, 452],
  ]
  const lit = slits.map(([x, y], i) => path(`M${x} ${y! + 18}v-12a4 4 0 0 1 8 0v12z`, { fill: p.warn, opacity: 0.9, class: i % 3 === 0 ? 'cwin' : undefined })).join('')
  const lamps = slits.filter((_, i) => i % 2 === 0).map(([x, y]) => circle(x! + 4, y! + 10, 26, paint('dr-lamp'))).join('')
  const gate = path('M408 530v-30a14 14 0 0 1 28 0v30z', { fill: mix(p.warn, stone, 0.72) })
  const flag = path('M422 170v-22l20 7l-20 7z', { fill: p.error, class: 'flag' })
  const pines = path(pinesD(54, 34, 820, 1700, mid.y, 46, 120), { fill: mix(p.bg, '#000000', 0.5) })
  const mist = [
    [280, 770, 520, 54, 46],
    [820, 815, 640, 60, 58],
    [1340, 760, 460, 46, 52],
    [560, 850, 700, 50, 64],
  ]
    .map(([x, y, rx, ry, s]) => ellipse(x!, y!, rx!, ry!, paint('dr-mist'), { class: 'mist', style: `animation-duration:${s}s` }))
    .join('')
  // The near ground, a rise at the right where Bolt stands, gravestones and two bare trees.
  const ground = path('M-80 900V846Q200 806 430 848T800 862Q1000 858 1110 770Q1220 682 1330 684Q1470 690 1680 790V900z', { fill: mix(p.bg, '#000000', 0.78) })
  let stones = ''
  for (const [x, y, w] of [
    [330, 840, 20],
    [420, 852, 26],
    [520, 858, 18],
    [640, 862, 24],
    [760, 866, 18],
  ]) stones += `M${x} ${y! + 6}v-${w! + 8}a${w! / 2} ${w! / 2} 0 0 1 ${w} 0v${w! + 8}z`
  const branch = { fill: 'none', stroke: mix(p.bg, '#000000', 0.82), 'stroke-linecap': 'round' }
  const trees =
    path('M64 900C54 790 88 700 78 604', { ...branch, 'stroke-width': 18 }) +
    path('M78 700C120 652 150 640 196 598M80 652C50 612 40 572 18 540M78 606C96 560 122 538 142 498', { ...branch, 'stroke-width': 7 }) +
    path('M150 640C170 620 176 600 172 572M112 548C100 522 104 500 96 478M40 574C30 560 12 552 -8 552M176 612C196 604 212 606 228 596', { ...branch, 'stroke-width': 3.5 }) +
    path('M1560 900C1568 800 1540 720 1552 640', { ...branch, 'stroke-width': 15 }) +
    path('M1550 720C1510 680 1490 668 1452 640M1552 660C1580 620 1596 600 1620 580M1552 644C1536 600 1516 580 1500 548', { ...branch, 'stroke-width': 6 }) +
    path('M1490 668C1476 648 1474 632 1478 610M1516 582C1524 562 1520 544 1528 524', { ...branch, 'stroke-width': 3 })
  const bats = drift(6, 9, 'bat', 54, (x, y, k, pick) => group(path(BAT, { fill: '#0d0a14', transform: `translate(${n(x)} ${n(40 + y * 0.5)}) scale(${n(1.1 + pick() * 1.5)})` }), { class: 'flap' }))
  const motes = drift(7, 16, 'mote', 80, (x, y, k, pick) => circle(x, y, 1.2 + pick() * 1.6, alpha(k % 2 === 0 ? p.accent : p.special, 0.5)))
  return {
    alt: 'A castle on a crag against a huge full moon, lit windows glowing, pines and mountains below, bats crossing and violet mist drifting over a graveyard.',
    bolt: { x: 1240, y: 566 },
    defs,
    style:
      PARALLAX +
      CROSS +
      anim('bat', 'cross') +
      anim('cl', 'cross') +
      FLAP +
      RISE +
      anim('mote', 'rise') +
      SWAY +
      '.mist{animation:sway 44s ease-in-out infinite}' +
      pulse('halo', 0.75, 1, 9) +
      pulse('cwin', 0.5, 0.95, 4) +
      pulse('tw', 0.25, 1, 5) +
      '@keyframes flag{0%,100%{transform:skewY(0)}50%{transform:skewY(14deg)}}.flag{transform-box:fill-box;transform-origin:left center;animation:flag 3s ease-in-out infinite}',
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('dr-sky')) +
      stars(60, 110, 620, p.text) +
      moon +
      clouds +
      layer('far', path(far.d, { fill: mix(p.bg, p.accent, 0.24) }) + path(far2.d, { fill: mix(p.bg, p.accent, 0.12) })) +
      layer('mid', path(mid.d, { fill: mix(p.bg, '#000000', 0.34) }) + pines + path(castle, { fill: stone }) + lamps + gate + lit + flag) +
      mist +
      layer('near', ground + path(stones, { fill: mix(p.bg, '#000000', 0.66) }) + trees + BOLT_HERE) +
      bats +
      motes +
      v.body,
  }
}

/** Rain over a dark city from a rooftop: lit windows, one red sign, searchlights on the clouds. */
const noir: Make = ({ palette: p }) => {
  const r = rnd(7)
  const v = vignette('no-vig', '#000000', 0.7)
  const defs =
    linear('no-sky', [
      [0, '#050505'],
      [0.45, p.bg],
      [0.74, '#2b2b2b'],
      [1, '#1a1a1a'],
    ]) +
    linear('no-beam', [
      [0, p.text, 0],
      [1, p.text, 0.2],
    ]) +
    glow('no-red', p.error, 0.55) +
    glow('no-fog', p.muted, 0.12) +
    glow('no-lamp', p.text, 0.3) +
    v.defs
  const far = city(1, 700, 50, 250, [26, 64])
  const mid = city(2, 800, 110, 430, [52, 116])
  const lit = mid.cells.filter(() => r() < 0.17)
  const dim = far.cells.filter(() => r() < 0.1)
  let flicker = ''
  for (let i = 0; i < 12; i += 1) {
    const [x, y] = mid.cells[Math.floor(r() * mid.cells.length)]!
    flicker += rect(x, y, 5, 9, p.text, { opacity: 0.7, class: 'win', style: `animation-delay:${n(-r() * 9)}s` })
  }
  const beam = (x: number, cls: string) => polygon([[x, 760], [x - 150, -60], [x + 110, -60]], paint('no-beam'), { class: cls })
  const sign = rect(404, 452, 13, 104, p.error, { rx: 3, opacity: 0.92, class: 'sign' }) + circle(410, 504, 110, paint('no-red'), { class: 'sign' })
  const beacons = mid.tops
    .filter((t, i) => i % 4 === 1 && t.y < 620)
    .map(t => circle(t.x + t.w / 2, t.y - 4, 3, p.error, { opacity: 0.9, class: 'beacon' }))
    .join('')
  const fog = ellipse(420, 690, 700, 90, paint('no-fog'), { class: 'fog' }) + ellipse(1250, 730, 620, 80, paint('no-fog'), { class: 'fog', style: 'animation-duration:58s' })
  // The rooftop in front: a parapet, a water tower, a stair hut, pipes and a mast.
  const dark = '#070707'
  let roof = `M-80 900V806h1760V900zM-80 806v-12h1760v12z`
  roof += 'M96 794V690h12v104zM196 794V690h12v104zM100 716l100 60v8l-100 -60zM200 716l-100 60v8l100 -60z'
  roof += 'M84 694V590q0 -10 10 -10h116q10 0 10 10v104zM78 582L152 532L226 582z'
  roof += 'M560 794V716h130v78zM552 716h146v-9h-146zM600 794v-52h34v52z'
  roof += 'M880 794v-150h5v150zM866 664h33v4h-33zM872 684h21v4h-21z'
  roof += 'M1010 794v-26h70v26zM1024 768v-14h10v14zM1056 768v-22h8v22z'
  const hoops = path('M84 620h136M84 656h136', { fill: 'none', stroke: '#1d1d1d', 'stroke-width': 3 })
  const door = rect(604, 746, 26, 48, '#1c1c1c') + circle(617, 730, 46, paint('no-lamp')) + rect(612, 724, 10, 5, p.text, { opacity: 0.85 })
  const rainFar = drift(11, 46, 'rain', 2.6, (x, y) => line(x, y, x - 3, y + 22, alpha(p.muted, 0.28), { 'stroke-width': 1 }))
  const rainNear = drift(12, 34, 'rain', 1.7, (x, y) => line(x, y, x - 6, y + 46, alpha(p.text, 0.42), { 'stroke-width': 1.4 }))
  return {
    alt: 'Rain over a dark city seen from a rooftop: lit windows, one red neon sign, two searchlights sweeping the clouds, a water tower at the left.',
    bolt: { x: 1240, y: 676 },
    defs,
    style:
      PARALLAX +
      FALL +
      anim('rain', 'fall') +
      SWAY +
      '.fog{animation:sway 46s ease-in-out infinite}' +
      pulse('win', 0.25, 0.85, 7) +
      pulse('sign', 0.6, 1, 5) +
      pulse('beacon', 0.2, 1, 3) +
      '@keyframes sweep-a{0%,100%{transform:rotate(-16deg)}50%{transform:rotate(12deg)}}.beam-a{transform-origin:330px 760px;animation:sweep-a 31s ease-in-out infinite}' +
      '@keyframes sweep-b{0%,100%{transform:rotate(14deg)}50%{transform:rotate(-12deg)}}.beam-b{transform-origin:1180px 760px;animation:sweep-b 37s ease-in-out infinite}',
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('no-sky')) +
      beam(330, 'beam-a') +
      beam(1180, 'beam-b') +
      layer('far', path(far.d, { fill: '#1e1e1e' }) + path(cellsD(dim, 3, 5), { fill: p.text, opacity: 0.3 })) +
      fog +
      layer('mid', path(mid.d, { fill: '#141414' }) + path(cellsD(lit, 5, 9), { fill: p.text, opacity: 0.5 }) + flicker + sign + beacons) +
      rainFar +
      layer('near', path(roof, { fill: dark }) + hoops + door + BOLT_HERE) +
      rainNear +
      v.body,
  }
}

/** A neon city at night: signs glowing, a lattice tower, a lit train on a viaduct, a pale moon. */
const tokyoNight: Make = ({ palette: p }) => {
  const r = rnd(21)
  const v = vignette('tn-vig', '#05050c', 0.6)
  const signColours = [p.special, p.error, p.info, p.ok, p.warn, p.accent]
  const defs =
    linear('tn-sky', [
      [0, mix(p.bg, '#000000', 0.5)],
      [0.45, p.bg],
      [0.72, mix(p.bg, p.special, 0.36)],
      [0.86, mix(p.bg, p.error, 0.34)],
      [1, mix(p.bg, p.error, 0.2)],
    ]) +
    radial('tn-moon', [
      [0, '#ffffff'],
      [1, mix(p.text, p.special, 0.35)],
    ]) +
    glow('tn-halo', mix(p.text, p.special, 0.5), 0.3) +
    signColours.map((c, i) => glow(`tn-g${i}`, c, 0.5)).join('') +
    glow('tn-head', p.warn, 0.7) +
    v.defs
  const moon = circle(1290, 210, 330, paint('tn-halo')) + circle(1290, 210, 96, paint('tn-moon'), { opacity: 0.92 })
  const far = city(3, 660, 70, 330, [24, 58])
  const mid = city(4, 780, 150, 480, [54, 124])
  const farLit = far.cells.filter(() => r() < 0.14)
  const windows = [p.accent, p.info, p.warn].map((c, k) => path(cellsD(mid.cells.filter(() => r() < 0.075), 6, 9), { fill: c, opacity: 0.62 - k * 0.06 })).join('')
  let glints = ''
  for (let i = 0; i < 14; i += 1) {
    const [x, y] = mid.cells[Math.floor(r() * mid.cells.length)]!
    glints += rect(x, y, 6, 9, i % 2 === 0 ? p.info : p.warn, { opacity: 0.8, class: 'tw', style: `animation-delay:${n(-r() * 8)}s` })
  }
  // The lattice tower: two legs closing to a mast, braced, with three beacons.
  const [tx, tb, tt] = [372, 700, 150]
  let tower = `M${tx - 52} ${tb}L${tx - 5} ${tt}M${tx + 52} ${tb}L${tx + 5} ${tt}M${tx} ${tt}V${tt - 54}`
  for (let k = 0; k < 9; k += 1) {
    const y = tb - k * 60
    const half = 52 - ((tb - y) / (tb - tt)) * 47
    const next = 52 - ((tb - y + 60) / (tb - tt)) * 47
    if (y - 60 < tt) break
    tower += `M${n(tx - half)} ${y}h${n(half * 2)}M${n(tx - half)} ${y}L${n(tx + next)} ${y - 60}M${n(tx + half)} ${y}L${n(tx - next)} ${y - 60}`
  }
  const lattice = path(tower, { fill: 'none', stroke: mix(p.bg, p.special, 0.55), 'stroke-width': 2.2 }) + [tt - 54, 330, 520].map((y, i) => circle(tx, y, 3.5, p.error, { class: 'beacon', style: `animation-delay:${n(-i * 0.8)}s` })).join('')
  // Signs on the taller blocks: an upright bar of light, with its glow.
  let signs = ''
  mid.tops
    .filter(t => t.y < 600 && t.w > 70 && t.x > 60 && t.x < 1500)
    .slice(0, 7)
    .forEach((t, i) => {
      const k = i % signColours.length
      const [x, y, h] = [t.x + 10 + (i % 2) * (t.w - 34), t.y + 26, 70 + (i % 3) * 26]
      signs += circle(x + 7, y + h / 2, h * 0.9, paint(`tn-g${k}`), { class: 'sign', style: `animation-delay:${n(-i * 1.3)}s` }) + rect(x, y, 14, h, signColours[k]!, { rx: 3, opacity: 0.95 })
      for (let s = 0; s < 3; s += 1) signs += rect(x + 3, y + 8 + (s * (h - 16)) / 3, 8, (h - 16) / 3 - 6, mix(signColours[k]!, '#ffffff', 0.6), { rx: 1.5 })
    })
  // The viaduct and its train.
  let viaduct = `M-80 742h1760v9h-1760z`
  for (let x = -40; x < WIDTH + 80; x += 130) viaduct += `M${x} 751h12v60h-12z`
  let train = ''
  for (let i = 0; i < 8; i += 1) train += rect(i * 62, 716, 58, 26, mix(p.bg, p.muted, 0.32), { rx: 4 }) + rect(i * 62 + 6, 721, 46, 9, p.warn, { opacity: 0.9, rx: 2 })
  train += circle(8 * 62 + 4, 730, 30, paint('tn-head')) + rect(8 * 62 - 6, 726, 8, 6, '#ffffff')
  // The near roofs, their railings and tanks, and the wires overhead with birds on them.
  let roofs = 'M-80 900V842h420v-22h260v34h300v-48h220v30h180v-44h320V900z'
  roofs += 'M360 820v-34h60v34zM372 786v-12h36v12zM960 806v-28h46v28zM1080 806v-60h6v60zM1070 760h26v4h-26zM1500 792v-40h70v40z'
  for (let x = 1200; x < 1380; x += 16) roofs += `M${x} 836v-22h3v22z`
  roofs += 'M1196 814h188v3h-188z'
  const wires = path('M-80 96Q500 190 1000 132T1680 150M-80 132Q520 236 1000 176T1680 196', { fill: 'none', stroke: mix(p.bg, '#000000', 0.5), 'stroke-width': 2 })
  const birds = [640, 668, 704, 1080].map(x => ellipse(x, 150 - (x > 1000 ? 16 : 0) + (x - 640) * 0.02, 7, 5, mix(p.bg, '#000000', 0.5)) + circle(x + 5, 144 - (x > 1000 ? 16 : 0) + (x - 640) * 0.02, 3.4, mix(p.bg, '#000000', 0.5))).join('')
  const rain = drift(22, 40, 'rain', 2.2, (x, y) => line(x, y, x - 3, y + 26, alpha(p.text, 0.24), { 'stroke-width': 1 }))
  return {
    alt: 'A neon city at night: signs glowing pink, violet and cyan, a lattice tower blinking red, a lit train crossing a viaduct under a pale moon, light rain falling.',
    bolt: { x: 1236, y: 696 },
    defs,
    style:
      PARALLAX +
      CROSS +
      '.train{animation:cross 38s linear infinite}' +
      FALL +
      anim('rain', 'fall') +
      pulse('tw', 0.3, 1, 6) +
      pulse('sign', 0.55, 1, 5) +
      pulse('beacon', 0.15, 1, 2.4),
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('tn-sky')) +
      stars(23, 60, 420, p.text) +
      moon +
      layer('far', path(far.d, { fill: mix(p.bg, p.accent, 0.2) }) + path(cellsD(farLit, 3, 4), { fill: p.info, opacity: 0.4 }) + lattice) +
      layer('mid', path(mid.d, { fill: mix(p.bg, '#000000', 0.36) }) + windows + glints + signs + path(viaduct, { fill: mix(p.bg, '#000000', 0.55) }) + group(train, { class: 'train' })) +
      rain +
      layer('near', path(roofs, { fill: mix(p.bg, '#000000', 0.72) }) + BOLT_HERE) +
      wires +
      birds +
      v.body,
  }
}

/** Aurora over snow-capped mountains and a frozen lake, a cabin with a lit window. */
const nord: Make = ({ palette: p }) => {
  const r = rnd(33)
  const v = vignette('nd-vig', '#0b0e14', 0.55)
  const bands = [p.ok, p.accent, p.special]
  const defs =
    linear('nd-sky', [
      [0, mix(p.bg, '#000000', 0.5)],
      [0.55, p.bg],
      [0.8, mix(p.bg, p.accent, 0.3)],
      [1, mix(p.bg, p.accent, 0.16)],
    ]) +
    bands
      .map((c, i) =>
        linear(`nd-a${i}`, [
          [0, c, 0],
          [0.16, c, 0.6],
          [1, c, 0],
        ]),
      )
      .join('') +
    linear('nd-snow', [
      [0, mix(p.bg, p.text, 0.62)],
      [1, mix(p.bg, p.text, 0.3)],
    ]) +
    linear('nd-lake', [
      [0, mix(p.bg, p.ok, 0.4)],
      [0.5, mix(p.bg, p.accent, 0.34)],
      [1, mix(p.bg, p.special, 0.26)],
    ], 1, 0) +
    glow('nd-lamp', p.warn, 0.6) +
    v.defs
  // Each curtain: upright strips along a slow wave, each fading at both ends, some breathing as rays.
  const curtain = (i: number, y: number, depth: number, seconds: number) => {
    let strips = ''
    const stride = coarse(24)
    for (let x = -140; x < WIDTH + 140; x += stride) {
      const top = y + Math.sin(x / 190 + i * 2.1) * 46 + Math.sin(x / 67 + i) * 16
      const h = depth * (0.72 + 0.28 * Math.sin(x / 113 + i * 1.3)) * (0.75 + r() * 0.5)
      const isRay = r() < 0.28
      strips += rect(x, top, stride * 1.25, h, paint(`nd-a${i}`), isRay ? { opacity: 0.8, class: 'ray', style: `animation-delay:${n(-r() * 8)}s` } : { opacity: 0.3 + r() * 0.4 })
    }
    return group(strips, { class: 'aurora', style: `animation-duration:${seconds}s` })
  }
  const aurora = curtain(0, 150, 330, 30) + curtain(1, 230, 300, 38) + curtain(2, 110, 260, 46)
  const far = ridge(9, 700, 380, 640, { sharp: true })
  const far2 = ridge(10, 740, 240, 420, { sharp: true })
  const mid = ridge(11, 800, 110, 500)
  const lake = ellipse(760, 852, 560, 40, paint('nd-lake'), { opacity: 0.75 }) + [0, 1, 2, 3].map(k => rect(380 + k * 190, 838 + k * 6, 150, 2, p.text, { opacity: 0.35, class: 'tw', style: `animation-delay:${-k * 2}s` })).join('')
  const snow = path('M-80 900V812Q120 780 330 806T700 836Q900 850 1040 800Q1180 700 1320 696Q1480 700 1680 772V900z', { fill: paint('nd-snow') })
  const drifts = path('M-80 900V860Q300 830 620 862T1180 850Q1420 820 1680 850V900z', { fill: mix(p.bg, p.text, 0.74), opacity: 0.6 })
  // The cabin: logs, a snowy roof, a lit window, smoke from the chimney.
  const cabin =
    circle(252, 782, 70, paint('nd-lamp')) +
    path('M180 808V760h150v48zM300 742v-28h16v28z', { fill: mix(p.bg, '#000000', 0.45) }) +
    path('M166 764L255 716L344 764z', { fill: mix(p.bg, p.text, 0.8) }) +
    rect(240, 774, 26, 22, p.warn, { class: 'lampw' }) +
    path('M253 774v22M240 785h26', { fill: 'none', stroke: mix(p.bg, '#000000', 0.45), 'stroke-width': 2 }) +
    smoke(308, 706, p.muted)
  const dark = mix(p.bg, '#000000', 0.48)
  const bigPines = path(pineD(60, 846, 250) + pineD(150, 838, 170) + pineD(1500, 800, 230) + pineD(1584, 812, 300) + pineD(1420, 742, 120), { fill: dark })
  const capsOn = (x: number, base: number, h: number) => {
    let d = ''
    for (let tier = 0; tier < 3; tier += 1) {
      const top = base - h + tier * h * 0.22
      const half = h * (0.12 + tier * 0.07)
      d += `M${n(x)} ${n(top)}L${n(x + half * 0.5)} ${n(top + h * 0.2)}L${n(x)} ${n(top + h * 0.15)}L${n(x - half * 0.5)} ${n(top + h * 0.2)}z`
    }
    return d
  }
  const pineSnow = path(capsOn(60, 846, 250) + capsOn(150, 838, 170) + capsOn(1500, 800, 230) + capsOn(1584, 812, 300) + capsOn(1420, 742, 120), { fill: mix(p.bg, p.text, 0.78) })
  const flakes = drift(34, 34, 'snow', 26, (x, y, k, pick) => circle(x, y, 1.4 + pick() * 2.2, alpha(p.text, 0.75)))
  const shooting = line(980, 120, 1060, 96, p.text, { 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.3, class: 'shoot' })
  return {
    alt: 'Curtains of green, blue and violet aurora waving over snow-capped mountains and a frozen lake, a cabin with a lit window and chimney smoke, pines in the snow, stars twinkling.',
    bolt: { x: 1262, y: 580 },
    defs,
    style:
      PARALLAX +
      '@keyframes wave{0%,100%{transform:skewX(-7deg) translateX(-50px)}50%{transform:skewX(7deg) translateX(50px)}}.aurora{transform-origin:800px 300px;animation-name:wave;animation-timing-function:ease-in-out;animation-iteration-count:infinite}' +
      pulse('ray', 0.25, 0.9, 7) +
      pulse('tw', 0.25, 1, 6) +
      pulse('lampw', 0.75, 1, 5) +
      FALL +
      anim('snow', 'fall') +
      SMOKE +
      '@keyframes shoot{0%,86%{transform:translate(0,0);opacity:0.3}88%{opacity:0.9}100%{transform:translate(-420px,130px);opacity:0.02}}.shoot{animation:shoot 23s linear infinite}',
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('nd-sky')) +
      stars(35, 150, 640, p.text) +
      shooting +
      aurora +
      layer('far', path(far.d, { fill: mix(p.bg, p.accent, 0.16) }) + path(capsD(far.y, 560), { fill: mix(p.bg, p.text, 0.6) }) + path(far2.d, { fill: mix(p.bg, '#000000', 0.12) }) + path(capsD(far2.y, 640), { fill: mix(p.bg, p.text, 0.42) })) +
      layer('mid', path(mid.d, { fill: mix(p.bg, '#000000', 0.3) }) + path(pinesD(36, 30, -60, 1700, mid.y, 40, 100), { fill: mix(p.bg, '#000000', 0.42) })) +
      layer('near', snow + lake + cabin + drifts + bigPines + pineSnow + BOLT_HERE) +
      flakes +
      v.body,
  }
}

/** A pastel dusk from a windowsill: a crescent moon, soft hills, a sleeping cat, fairy lights. */
const catppuccin: Make = ({ palette: p }) => {
  const r = rnd(8)
  const tints = [p.accent, p.special, p.warn, p.info, p.ok, p.error]
  const crust = mix(p.bg, '#000000', 0.5)
  const v = vignette('cp-vig', '#0b0b14', 0.55)
  const defs =
    linear('cp-sky', [
      [0, mix(p.bg, '#000000', 0.3)],
      [0.4, p.bg],
      [0.66, mix(p.bg, p.accent, 0.42)],
      [0.82, mix(p.bg, p.special, 0.55)],
      [1, mix(p.bg, p.warn, 0.5)],
    ]) +
    glow('cp-halo', p.warn, 0.3) +
    tints.map((c, i) => glow(`cp-b${i}`, c, 0.55)).join('') +
    glow('cp-lamp', p.warn, 0.55) +
    v.defs
  const moon = circle(1130, 170, 250, paint('cp-halo')) + path('M1118 96A78 78 0 1 0 1204 214A62 62 0 1 1 1118 96z', { fill: mix(p.warn, '#ffffff', 0.5) })
  const clouds =
    group(cloud(300, 250, 460, p.special, 0.2), { class: 'cl', style: 'animation-duration:320s;animation-delay:-150s' }) +
    group(cloud(900, 360, 380, p.accent, 0.2), { class: 'cl', style: 'animation-duration:380s;animation-delay:-190s' }) +
    group(cloud(1380, 420, 420, p.warn, 0.18), { class: 'cl', style: 'animation-duration:420s;animation-delay:-220s' })
  const h1 = ridge(81, 650, 170, 760)
  const h2 = ridge(82, 720, 150, 560)
  const h3 = ridge(83, 790, 130, 460)
  // A village on the middle hill: little gabled houses with a lit window each.
  let houses = ''
  let lamps = ''
  let lit = ''
  for (let i = 0; i < 9; i += 1) {
    const x = 560 + i * 62 + r() * 24
    const y = h2.y(x) + 4
    const w = 26 + r() * 16
    houses += `M${n(x)} ${n(y)}v${n(-w * 0.7)}l${n(w / 2)} ${n(-w * 0.5)}l${n(w / 2)} ${n(w * 0.5)}v${n(w * 0.7)}z`
    lit += `M${n(x + w * 0.35)} ${n(y - w * 0.5)}h${n(w * 0.3)}v${n(w * 0.28)}h${n(-w * 0.3)}z`
    lamps += circle(x + w / 2, y - w * 0.36, 22, paint('cp-lamp'))
  }
  const bubbles = drift(8, 20, 'bubble', 46, (x, y, k, pick) => {
    const rad = 12 + pick() * 30
    return circle(x, y, rad, paint(`cp-b${k % tints.length}`), { opacity: 0.5 }) + circle(x, y, rad * 0.62, 'none', { stroke: alpha(tints[k % tints.length]!, 0.35), 'stroke-width': 1.2 })
  })
  // The fairy lights: a sagging wire, a bulb every so often, each with its glow.
  let wire = 'M-40 54'
  let bulbs = ''
  for (let i = 0; i < 6; i += 1) {
    const x0 = -40 + i * 280
    wire += `Q${x0 + 140} ${150 - (i % 2) * 24} ${x0 + 280} 54`
    for (let k = 1; k < 5; k += 1) {
      const t = k / 5
      const x = x0 + 280 * t
      const y = 54 + (150 - (i % 2) * 24 - 54) * 2 * t * (1 - t)
      const c = tints[(i * 4 + k) % tints.length]!
      bulbs += circle(x, y + 12, 24, paint(`cp-b${(i * 4 + k) % tints.length}`), { class: 'bulb', style: `animation-delay:${n(-(i * 4 + k) * 0.9)}s` }) + ellipse(x, y + 10, 5, 7.5, mix(c, '#ffffff', 0.35))
    }
  }
  // The sill: a cat asleep, a plant, a stack of books, and room for Bolt.
  const sill = path('M-80 900V812h1760V900zM-80 812v-12h1760v12z', { fill: crust })
  const cat = group(
    ellipse(300, 786, 116, 46, mix(p.bg, '#000000', 0.62)) +
      circle(396, 762, 42, mix(p.bg, '#000000', 0.62)) +
      polygon([[366, 734], [372, 694], [396, 726]], mix(p.bg, '#000000', 0.62)) +
      polygon([[410, 726], [430, 696], [434, 738]], mix(p.bg, '#000000', 0.62)) +
      path('M188 790q-70 -8 -52 -64', { fill: 'none', stroke: mix(p.bg, '#000000', 0.62), 'stroke-width': 15, 'stroke-linecap': 'round' }) +
      path('M378 766q8 6 16 0M406 766q8 6 16 0', { fill: 'none', stroke: alpha(p.special, 0.7), 'stroke-width': 2.4, 'stroke-linecap': 'round' }),
    { class: 'cat' },
  )
  let leaves = ''
  ;[-34, -18, -4, 12, 28].forEach((a, i) => {
    leaves += group(path(`M560 742q${a * 1.6} ${-70 - i * 6} ${a * 3} ${-118 - (i % 2) * 22}q${-a * 0.5} 70 ${-a * 3} ${118 + (i % 2) * 22}z`, { fill: mix(p.ok, p.bg, 0.3 + (i % 2) * 0.18) }), { class: 'bend', style: `animation-delay:${-i * 1.1}s` })
  })
  const plant = leaves + path('M530 800l8 -58h44l8 58z', { fill: mix(p.error, p.bg, 0.4) }) + rect(526, 738, 68, 9, mix(p.error, p.bg, 0.25), { rx: 3 })
  const books =
    rect(1440, 772, 130, 28, mix(p.accent, p.bg, 0.45), { rx: 3 }) +
    rect(1452, 748, 110, 24, mix(p.warn, p.bg, 0.45), { rx: 3 }) +
    rect(1446, 726, 96, 22, mix(p.info, p.bg, 0.5), { rx: 3 }) +
    path('M1440 786h130M1452 760h110M1446 737h96', { fill: 'none', stroke: alpha(p.text, 0.2), 'stroke-width': 2 })
  return {
    alt: 'A pastel dusk seen from a windowsill: a crescent moon, soft clouds and rolling hills with a little village, a cat asleep beside a plant, fairy lights along the top and slow pastel bubbles rising.',
    bolt: { x: 1240, y: 682 },
    defs,
    style:
      PARALLAX +
      CROSS +
      anim('cl', 'cross') +
      RISE +
      anim('bubble', 'rise') +
      BEND +
      pulse('bulb', 0.45, 1, 6) +
      pulse('tw', 0.3, 1, 6) +
      '@keyframes breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.015,1.05)}}.cat{transform-box:fill-box;transform-origin:center bottom;animation:breathe 5s ease-in-out infinite}',
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('cp-sky')) +
      stars(84, 70, 420, p.text) +
      moon +
      clouds +
      layer('far', path(h1.d, { fill: mix(p.bg, p.accent, 0.36) })) +
      layer('mid', path(h2.d, { fill: mix(p.bg, p.special, 0.2) }) + lamps + path(houses, { fill: mix(p.bg, '#000000', 0.3) }) + path(lit, { fill: p.warn, opacity: 0.9 }) + path(h3.d, { fill: mix(p.bg, p.info, 0.1) })) +
      bubbles +
      path(wire, { fill: 'none', stroke: alpha(p.muted, 0.55), 'stroke-width': 2 }) +
      bulbs +
      layer('near', sill + cat + plant + books + BOLT_HERE) +
      v.body,
  }
}

/** An orrery: a golden sun at the lower left, planets on fine orbit lines, a comet. */
const solarized: Make = ({ palette: p }) => {
  const r = rnd(41)
  const [sx, sy] = [150, 780]
  const squash = 0.44
  const v = vignette('so-vig', '#00151b', 0.6)
  const worlds = [
    { rx: 330, size: 9, colour: p.muted, seconds: 58, phase: 0.86 },
    { rx: 480, size: 15, colour: p.warn, seconds: 96, phase: 0.74 },
    { rx: 650, size: 17, colour: p.accent, seconds: 140, phase: 0.9 },
    { rx: 830, size: 12, colour: p.error, seconds: 200, phase: 0.8 },
    { rx: 1120, size: 34, colour: p.special, seconds: 330, phase: 0.87 },
    { rx: 1390, size: 26, colour: p.info, seconds: 460, phase: 0.93 },
  ]
  const defs =
    linear('so-sky', [
      [0, mix(p.bg, '#000000', 0.45)],
      [0.6, p.bg],
      [1, mix(p.bg, p.warn, 0.14)],
    ], 0.6, 1) +
    radial('so-sun', [
      [0, '#fff8d8'],
      [0.45, mix(p.warn, '#ffe27a', 0.8)],
      [1, mix(p.warn, p.error, 0.5)],
    ]) +
    glow('so-corona', mix(p.warn, p.error, 0.25), 0.5) +
    glow('so-neb1', p.special, 0.16) +
    glow('so-neb2', p.info, 0.14) +
    linear('so-tail', [
      [0, p.text, 0.7],
      [1, p.text, 0],
    ], 1, 0) +
    worlds
      .map((w, i) =>
        radial(`so-w${i}`, [
          [0, mix(w.colour, '#ffffff', 0.45)],
          [0.6, w.colour],
          [1, mix(w.colour, '#000000', 0.55)],
        ]),
      )
      .join('') +
    v.defs
  const nebula = ellipse(1180, 180, 520, 240, paint('so-neb1')) + ellipse(760, 90, 460, 180, paint('so-neb2'))
  const orbits = worlds.map((w, i) => ellipse(sx, sy, w.rx, w.rx * squash, 'none', { stroke: alpha(p.text, i % 2 === 0 ? 0.26 : 0.18), 'stroke-width': 1.3, 'stroke-dasharray': i % 2 === 0 ? undefined : '3 9' })).join('')
  // The belt between the fourth and fifth worlds: small rocks along their own ellipse.
  let belt = ''
  for (let i = 0; i < few(90); i += 1) {
    const a = -Math.PI * (0.02 + 0.5 * r())
    const d = 950 + r() * 70
    belt += circle(sx + Math.cos(a) * d, sy + Math.sin(a) * d * squash, 0.8 + r() * 1.8, p.muted, { opacity: 0.25 + r() * 0.45 })
  }
  const sun = circle(sx, sy, 560, paint('so-corona'), { class: 'corona' }) + [210, 260, 320].map((rad, i) => circle(sx, sy, rad, 'none', { stroke: alpha(p.warn, [0.3, 0.2, 0.1][i]!), 'stroke-width': 2, class: 'ring' })).join('') + circle(sx, sy, 160, paint('so-sun'))
  const planets = worlds
    .map((w, i) => {
      let body = circle(0, 0, w.size, paint(`so-w${i}`))
      if (i === 4) body += [-12, 0, 13].map(y => rect(-w.size, y - 3, w.size * 2, 5, alpha(p.bg, 0.22), { rx: 2 })).join('') + circle(0, 0, w.size, 'none', { stroke: alpha(p.bg, 0.3), 'stroke-width': 1 })
      if (i === 5) body = ellipse(0, 0, w.size * 1.9, w.size * 0.5, 'none', { stroke: alpha(p.text, 0.6), 'stroke-width': 4, transform: 'rotate(-18)' }) + body + path(`M${n(-w.size * 1.86)} ${n(w.size * 0.58)}A${n(w.size * 1.9)} ${n(w.size * 0.5)} -18 0 0 ${n(w.size * 1.86)} ${n(-w.size * 0.58)}`, { fill: 'none', stroke: alpha(p.text, 0.75), 'stroke-width': 4 })
      if (i === 2) body += circle(w.size * 1.9, -w.size * 0.9, 4, p.text, { opacity: 0.8 })
      return group(body, { class: `so-o${i}` })
    })
    .join('')
  const comet = group(rect(0, -2, 220, 4, paint('so-tail'), { rx: 2 }) + circle(0, 0, 5, '#ffffff'), { class: 'comet' })
  // A small rock for Bolt to stand on.
  const rock = path('M1196 700l30 -14l64 -6l70 4l44 12l-18 22l-60 14l-86 -4z', { fill: mix(p.bg, p.text, 0.34) }) + path('M1196 700l30 -14l64 -6l70 4l44 12l-70 6l-80 2z', { fill: mix(p.bg, p.text, 0.5) })
  return {
    alt: 'An orrery in deep teal space: a golden sun at the lower left with six worlds circling it on fine orbit lines, a banded giant and a ringed planet among them, a belt of rocks, a comet and stars.',
    bolt: { x: 1236, y: 566 },
    defs,
    style:
      worlds.map((w, i) => orbit(`so-o${i}`, sx, sy, w.rx, w.rx * squash, w.seconds, w.phase)).join('') +
      pulse('tw', 0.25, 1, 6) +
      pulse('corona', 0.75, 1, 10) +
      '@keyframes ring{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}.ring{transform-origin:150px 780px;animation:ring 12s ease-in-out infinite}' +
      '@keyframes comet{0%{transform:translate(1500px,60px) rotate(-14deg)}100%{transform:translate(-400px,520px) rotate(-14deg)}}.comet{transform:translate(1180px,140px) rotate(-14deg);animation:comet 90s linear infinite}' +
      BOB +
      '.rock{animation:bob 4s ease-in-out infinite}',
    body: rect(0, 0, WIDTH, HEIGHT, paint('so-sky')) + nebula + stars(42, 170, 900, p.text) + orbits + belt + sun + comet + planets + group(rock, { class: 'rock' }) + v.body,
  }
}

/** Ruled paper: watercolour washes, a coffee ring, pencil doodles, a pen line writing itself. */
const paper: Make = ({ palette: p }) => {
  const pencil = { fill: 'none', stroke: alpha(p.muted, 0.6), 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
  const v = vignette('pa-vig', p.warn, 0.16)
  const defs = glow('pa-w0', p.accent, 0.16) + glow('pa-w1', p.special, 0.14) + glow('pa-w2', p.ok, 0.14) + glow('pa-w3', p.warn, 0.14) + glow('pa-hole', mix(p.bg, '#000000', 0.25), 0.5) + v.defs
  const washes =
    ellipse(240, 180, 420, 260, paint('pa-w0'), { class: 'wash' }) +
    ellipse(1380, 700, 480, 300, paint('pa-w1'), { class: 'wash', style: 'animation-duration:52s' }) +
    ellipse(1260, 120, 360, 200, paint('pa-w2'), { class: 'wash', style: 'animation-duration:60s' }) +
    ellipse(360, 800, 420, 220, paint('pa-w3'), { class: 'wash', style: 'animation-duration:68s' })
  let rules = ''
  for (let y = 96; y < HEIGHT; y += 56) rules += `M0 ${y}h${WIDTH}`
  const lines = path(rules, { fill: 'none', stroke: alpha(p.info, 0.2), 'stroke-width': 1.2 }) + path(`M176 0V${HEIGHT}M184 0V${HEIGHT}`, { fill: 'none', stroke: alpha(p.error, 0.3), 'stroke-width': 1.4 })
  const holes = [150, 450, 750].map(y => circle(78, y, 30, paint('pa-hole')) + circle(78, y, 17, mix(p.bg, '#000000', 0.14)) + circle(78, y + 1.5, 16, mix(p.bg, '#000000', 0.07))).join('')
  const ring =
    circle(1316, 236, 86, 'none', { stroke: alpha(p.warn, 0.2), 'stroke-width': 9 }) +
    circle(1316, 236, 80, 'none', { stroke: alpha(p.warn, 0.14), 'stroke-width': 2, 'stroke-dasharray': '120 40 60 30' }) +
    circle(1420, 300, 5, alpha(p.warn, 0.2)) +
    circle(1436, 322, 3, alpha(p.warn, 0.18))
  const pen = path('M230 716c70 -110 140 -110 210 0s140 110 210 0s140 -110 210 0s140 110 210 0c40 -60 80 -70 120 -30', {
    fill: 'none',
    stroke: p.accent,
    'stroke-width': 3.2,
    'stroke-linecap': 'round',
    'stroke-dasharray': 2400,
    'stroke-dashoffset': 0,
    class: 'pen',
  })
  // Pencil doodles, kept to the edges: a plane and its looping trail, a cactus, a graph, a spiral sun, mountains.
  const plane = group(path('M0 0l64 -22l-40 44l-6 -18zM18 4l46 -26', { ...pencil, stroke: alpha(p.text, 0.7) }), { class: 'plane' })
  const trail = path('M330 150q120 70 230 -10t160 30q40 50 -20 70t-50 -50q40 -80 250 -50', { ...pencil, 'stroke-dasharray': '4 12' })
  const cactus = path('M1500 560v-150q0 -22 22 -22t22 22v150M1500 500h-26q-18 0 -18 -18v-30M1544 470h24q18 0 18 -18v-40M1470 560h110l-10 60h-90z', pencil) + path('M1510 420l-8 -6M1534 440l8 -6M1512 470l-8 -4M1534 500l8 -4', pencil)
  const graph = path('M250 500v-150M250 500h190M262 480q40 -10 60 -60t90 -70', pencil) + path('M244 362l6 -12l6 12M428 494l12 6l-12 6', pencil)
  const sun = path('M640 60m-4 0a4 4 0 1 0 8 0a8 8 0 1 0 -16 0a12 12 0 1 0 24 0a16 16 0 1 0 -32 0a20 20 0 1 0 40 0', pencil)
  const peaks = path('M1060 830l60 -90l40 50l50 -80l70 120M1150 760l10 -14l12 14M1206 724l10 -14l12 16', pencil)
  const clip = path('M990 -10v70q0 16 -16 16t-16 -16v-56q0 -10 10 -10t10 10v48', { fill: 'none', stroke: alpha(p.muted, 0.8), 'stroke-width': 3.2, 'stroke-linecap': 'round' })
  const specks = drift(31, 40, 'speck', 0, (x, y, k, pick) => circle(x, y, 0.8 + pick() * 1.2, alpha(p.warn, 0.16)))
  return {
    alt: 'A sheet of warm ruled paper with a red margin and punch holes: soft watercolour washes, a coffee ring, pencil doodles of a paper plane, a cactus and a small graph, and one blue pen line writing itself across the page.',
    bolt: { x: 1240, y: 598 },
    defs,
    style:
      SWAY +
      '.wash{animation:sway 44s ease-in-out infinite}' +
      '@keyframes draw{from{stroke-dashoffset:2400}to{stroke-dashoffset:0}}.pen{animation:draw 40s linear infinite}' +
      '@keyframes plane{0%,100%{transform:translate(760px,150px) rotate(-6deg)}50%{transform:translate(800px,128px) rotate(4deg)}}.plane{transform:translate(770px,146px);animation:plane 9s ease-in-out infinite}',
    body: washes + specks + lines + holes + ring + trail + plane + cactus + graph + sun + peaks + pen + clip + v.body,
  }
}

/** Sharp white line on black: a dotted sky drifting, an outlined sun on a yellow horizon, a floor of fine lines. */
const highContrast: Make = ({ palette: p }) => {
  const thin = { fill: 'none', stroke: alpha(p.text, 0.3), 'stroke-width': 1.5 }
  const defs = pattern('hc-dots', 50, 50, circle(25, 25, 1.4, alpha(p.text, 0.4)))
  const sky = group(rect(-100, -100, WIDTH + 200, 760, paint('hc-dots')), { class: 'dots' })
  const horizon = 640
  // The floor: lines to one vanishing point, and cross lines that close up toward the horizon.
  let floor = ''
  for (let k = -14; k <= 14; k += 1) floor += `M800 ${horizon}L${800 + k * 190} ${HEIGHT}`
  for (let k = 1; k <= 9; k += 1) floor += `M0 ${n(horizon + 260 * (k / 9) ** 2.2)}h${WIDTH}`
  // The sun: an outline half-disc on the horizon, cut by level bars.
  let sun = `M1010 ${horizon}A190 190 0 0 1 1390 ${horizon}`
  for (let k = 1; k <= 5; k += 1) {
    const y = horizon - k * 30
    const half = Math.sqrt(190 * 190 - (k * 30) ** 2)
    sun += `M${n(1200 - half)} ${y}h${n(half * 2)}`
  }
  const bold = { fill: 'none', stroke: alpha(p.text, 0.42), 'stroke-width': 3 }
  const shapes =
    group(circle(190, 170, 78, 'none', bold) + circle(190, 170, 108, 'none', { ...thin, 'stroke-dasharray': '4 12', class: 'turn' }), { class: 'float' }) +
    group(rect(1300, 70, 150, 150, 'none', bold) + rect(1274, 44, 202, 202, 'none', { ...thin, 'stroke-dasharray': '4 12' }), { class: 'float', style: 'animation-delay:-2s' }) +
    group(polygon([[330, 520], [470, 520], [400, 400]], 'none', bold), { class: 'float', style: 'animation-delay:-4s' }) +
    group(polygon([[690, 250], [750, 310], [690, 370], [630, 310]], 'none', bold), { class: 'float', style: 'animation-delay:-1s' })
  return {
    alt: 'A calm black field in sharp white line: a dotted sky drifting slowly, an outlined sun on a yellow horizon, a floor of fine lines running to one point, and an outline circle, square, triangle and diamond floating above.',
    defs,
    style:
      '@keyframes slide{from{transform:translate(-50px,-50px)}to{transform:translate(0,0)}}.dots{animation:slide 40s linear infinite}' +
      BOB +
      '.float{animation:bob 9s ease-in-out infinite}' +
      '@keyframes turn{from{transform:rotate(0)}to{transform:rotate(360deg)}}.turn{transform-origin:190px 170px;animation:turn 120s linear infinite}',
    body: sky + path(floor, thin) + path(sun, { fill: 'none', stroke: alpha(p.text, 0.5), 'stroke-width': 2.5 }) + line(0, horizon, WIDTH, horizon, alpha(p.accent, 0.6), { 'stroke-width': 2.5 }) + shapes,
  }
}

/** Hills in blue and orange told apart by pattern as well as colour, four kites of four shapes. */
const colorblind: Make = ({ palette: p, diff }) => {
  const blue = diff.addFg
  const orange = diff.removeFg
  const v = vignette('cb-vig', '#07080b', 0.5)
  const defs =
    linear('cb-sky', [
      [0, mix(p.bg, '#000000', 0.35)],
      [0.6, p.bg],
      [1, mix(p.bg, blue, 0.26)],
    ]) +
    pattern('cb-hatch', 16, 16, path('M-4 4l8 -8M0 16l16 -16M12 20l8 -8', { fill: 'none', stroke: alpha('#ffffff', 0.2), 'stroke-width': 2 })) +
    pattern('cb-dots', 18, 18, circle(9, 9, 2.6, alpha('#000000', 0.34))) +
    glow('cb-sun', p.warn, 0.35) +
    v.defs
  const sun = circle(1180, 250, 300, paint('cb-sun')) + circle(1180, 250, 58, p.warn) + [92, 128, 166].map((rad, i) => circle(1180, 250, rad, 'none', { stroke: alpha(p.warn, [0.5, 0.32, 0.18][i]!), 'stroke-width': 3, class: 'ring' })).join('')
  const hills = [
    { h: ridge(91, 640, 170, 820), colour: mix(p.bg, blue, 0.34), tex: 'cb-hatch', depth: 'far' as const },
    { h: ridge(92, 720, 150, 620), colour: mix(p.bg, orange, 0.5), tex: 'cb-dots', depth: 'mid' as const },
    { h: ridge(93, 800, 120, 520), colour: mix(p.bg, blue, 0.56), tex: 'cb-hatch', depth: 'mid' as const },
  ]
  const land = hills.map(({ h, colour, tex, depth }) => layer(depth, path(h.d, { fill: colour }) + path(h.d, { fill: paint(tex) }))).join('')
  const near = 'M-80 900V850Q260 800 560 846T1000 850Q1130 800 1220 700Q1300 672 1380 700Q1500 760 1680 800V900z'
  const ground = path(near, { fill: mix(p.bg, orange, 0.72) }) + path(near, { fill: paint('cb-dots') })
  // Four kites, told apart by shape: each with a tail of its own shape and a string to the ground.
  const kite = (kind: number, x: number, y: number, colour: string, home: [number, number]) => {
    const s = 44
    const shape =
      kind === 0
        ? polygon([[0, -s], [s, s * 0.8], [-s, s * 0.8]], colour)
        : kind === 1
          ? circle(0, 0, s * 0.9, colour)
          : kind === 2
            ? polygon([[0, -s * 1.1], [s * 0.9, 0], [0, s * 1.1], [-s * 0.9, 0]], colour)
            : rect(-s * 0.8, -s * 0.8, s * 1.6, s * 1.6, colour)
    let tail = ''
    for (let k = 1; k <= 3; k += 1) {
      const [tx, ty] = [-k * 16, s + k * 26]
      tail += kind === 0 ? polygon([[tx, ty - 8], [tx + 8, ty + 6], [tx - 8, ty + 6]], colour) : kind === 1 ? circle(tx, ty, 6, colour) : kind === 2 ? polygon([[tx, ty - 8], [tx + 7, ty], [tx, ty + 8], [tx - 7, ty]], colour) : rect(tx - 6, ty - 6, 12, 12, colour)
    }
    const string = line(x, y + s, home[0], home[1], alpha(p.text, 0.3), { 'stroke-width': 1.2 })
    return string + group(group(shape + path(`M0 ${s}q-10 40 -50 ${s + 40}`, { fill: 'none', stroke: alpha(p.text, 0.4), 'stroke-width': 1.5 }) + tail, { class: 'kite', style: `animation-delay:${-kind * 1.7}s` }), { transform: `translate(${x} ${y})` })
  }
  const kites = kite(0, 230, 220, blue, [120, 840]) + kite(1, 520, 130, orange, [420, 830]) + kite(2, 820, 250, blue, [760, 846]) + kite(3, 1460, 430, orange, [1560, 780])
  const bits = drift(17, 22, 'bit', 70, (x, y, k) => (k % 2 === 0 ? rect(x, y, 7, 7, blue, { opacity: 0.45 }) : circle(x, y, 4, orange, { opacity: 0.5 })))
  return {
    alt: 'Layered hills in blue and orange, told apart by pattern as well as colour, hatched and dotted, under a ringed yellow sun, with four kites above them: a triangle, a disc, a diamond and a square.',
    bolt: { x: 1240, y: 566 },
    defs,
    style:
      PARALLAX +
      FALL +
      anim('bit', 'fall') +
      '@keyframes kite{0%,100%{transform:translate(0,0) rotate(-4deg)}50%{transform:translate(14px,-16px) rotate(5deg)}}.kite{animation:kite 8s ease-in-out infinite}' +
      '@keyframes ring{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}.ring{transform-origin:1180px 250px;animation:ring 11s ease-in-out infinite}',
    body: rect(0, 0, WIDTH, HEIGHT, paint('cb-sky')) + sun + land + kites + bits + layer('near', ground + BOLT_HERE) + v.body,
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
