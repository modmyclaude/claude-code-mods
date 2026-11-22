// The five seasonal packs' scenes: what /wear season puts behind the chat as
// the calendar turns. Same rules as scenes-looks.ts: the look's own colours,
// depth in three layers, slow motion, and a finished picture at rest.

import { alpha, anim, BEND, BOB, BOLT_HERE, capsD, circle, cloud, CROSS, drift, ellipse, FALL, few, FLAP, glow, group, HEIGHT, layer, line, linear, mix, n, paint, PARALLAX, path, pineD, polygon, pulse, radial, rect, ridge, RISE, rnd, SMOKE, smoke, SPIN, stars, SWAY, tumbling, vignette, WIDTH } from './scene-kit'
import type { Scene } from './scene-kit'
import type { Theme } from './themes'

type Make = (theme: Theme) => Scene

const BAT = 'M0 0c3 -8 9 -9 13 -4l2 -3l2 3c4 -5 10 -4 13 4c-4 -3 -7 -2 -9 1c-2 -3 -4 -3 -6 0c-2 -3 -4 -3 -6 0c-2 -3 -5 -4 -9 -1z'

/** A bare tree as strokes: a trunk, then boughs, then twigs, each thinner. */
function bareTree(parts: readonly [string, number][], stroke: string): string {
  return parts.map(([d, w]) => path(d, { fill: 'none', stroke, 'stroke-width': w, 'stroke-linecap': 'round' })).join('')
}

/** A string of lights along the top: a sagging wire, a bulb every so often, each with its glow (gradients `id0`, `id1`, ...). */
function lights(id: string, colours: readonly string[], sag: number): string {
  let wire = 'M-40 46'
  let bulbs = ''
  for (let i = 0; i < 6; i += 1) {
    const x0 = -40 + i * 280
    const low = sag - (i % 2) * 22
    wire += `Q${x0 + 140} ${low} ${x0 + 280} 46`
    for (let k = 1; k < 5; k += 1) {
      const t = k / 5
      const x = x0 + 280 * t
      const y = 46 + (low - 46) * 2 * t * (1 - t)
      const c = (i * 4 + k) % colours.length
      bulbs += circle(x, y + 12, 26, paint(`${id}${c}`), { class: 'bulb', style: `animation-delay:${n(-(i * 4 + k) * 0.9)}s` }) + ellipse(x, y + 10, 5, 7.5, mix(colours[c]!, '#ffffff', 0.3))
    }
  }
  return path(wire, { fill: 'none', stroke: '#00000066', 'stroke-width': 2 }) + bulbs
}

/** A haunted house on a hill under a crescent moon, carved pumpkins, ghosts, a spider. */
const halloween: Make = ({ palette: p }) => {
  const v = vignette('hw-vig', '#030106', 0.66)
  const dark = mix(p.bg, '#000000', 0.55)
  const defs =
    linear('hw-sky', [
      [0, mix(p.bg, '#000000', 0.5)],
      [0.5, mix(p.bg, p.info, 0.1)],
      [0.8, mix(p.bg, p.accent, 0.4)],
      [1, mix(p.bg, p.accent, 0.22)],
    ]) +
    glow('hw-halo', mix(p.text, p.accent, 0.3), 0.36) +
    glow('hw-fire', p.accent, 0.5) +
    glow('hw-lamp', p.warn, 0.55) +
    glow('hw-fog', p.special, 0.16) +
    v.defs
  const moon = circle(1336, 190, 330, paint('hw-halo'), { class: 'halo' }) + path('M1316 96A98 98 0 1 0 1430 246A80 80 0 1 1 1316 96z', { fill: p.text })
  const clouds =
    group(cloud(420, 210, 520, mix(p.bg, p.info, 0.3), 0.45), { class: 'cl', style: 'animation-duration:240s;animation-delay:-70s' }) + group(cloud(1300, 330, 440, mix(p.bg, p.accent, 0.3), 0.35), { class: 'cl', style: 'animation-duration:300s;animation-delay:-190s' })
  const far = ridge(121, 700, 240, 700)
  // The house on its hill: crooked blocks, a witch-hat tower, lit windows.
  let house = 'M-80 1100V720Q120 640 260 590L560 590Q760 660 900 780L960 1100z'
  house += 'M250 596V430l16 -6V596zM266 596V424h184l8 172z'
  house += 'M240 432L356 330L474 428z'
  house += 'M452 596V372l70 6l-6 218zM436 380L490 236L540 384z'
  house += 'M190 596V500l68 -8v104zM178 504L226 452L270 498z'
  house += 'M300 366v-56l22 2v38z'
  house += 'M488 236v-26'
  const lit = [
    [296, 470, 26, 36],
    [372, 464, 26, 36],
    [470, 430, 22, 34],
    [476, 310, 16, 26],
    [212, 530, 22, 28],
    [340, 380, 20, 20],
  ]
  const windows = lit.map(([x, y, w, h], i) => circle(x! + w! / 2, y! + h! / 2, 46, paint('hw-lamp')) + rect(x!, y!, w!, h!, p.warn, { opacity: 0.92, class: i % 2 === 0 ? 'flick' : undefined, style: `animation-delay:${-i * 1.3}s` }) + path(`M${x! + w! / 2} ${y}v${h}M${x} ${y! + h! / 2}h${w}`, { fill: 'none', stroke: dark, 'stroke-width': 2.5 })).join('')
  const door = path('M330 596v-52a16 16 0 0 1 32 0v52z', { fill: mix(p.accent, dark, 0.7) })
  const ghost = (x: number, y: number, s: number, delay: number) =>
    group(
      path(`M${x} ${y}c0 ${-36 * s} ${44 * s} ${-36 * s} ${44 * s} 0v${40 * s}l${-7 * s} ${-8 * s}l${-7 * s} ${8 * s}l${-8 * s} ${-8 * s}l${-8 * s} ${8 * s}l${-7 * s} ${-8 * s}l${-7 * s} ${8 * s}z`, { fill: alpha(p.text, 0.55) }) +
        circle(x + 15 * s, y - 4 * s, 3.4 * s, dark) +
        circle(x + 29 * s, y - 4 * s, 3.4 * s, dark),
      { class: 'ghost', style: `animation-delay:${delay}s` },
    )
  const ghosts = ghost(1180, 500, 1, 0) + ghost(70, 500, 0.8, -2.5)
  // Pumpkins in the patch, each carved and lit from inside, with the light it throws on the ground.
  const pumpkin = (x: number, y: number, rad: number, k: number) => {
    const ry = rad * 0.8
    const eye = (side: number) => polygon([[x + side * rad * 0.42, y - ry * 0.05], [x + side * rad * 0.14, y - ry * 0.05], [x + side * rad * 0.28, y - ry * 0.5]], p.warn)
    return (
      ellipse(x, y + ry * 0.9, rad * 1.7, ry * 0.5, paint('hw-fire'), { class: 'glow', style: `animation-delay:${-k * 0.9}s` }) +
      ellipse(x, y, rad, ry, mix(p.accent, '#000000', 0.18)) +
      ellipse(x, y, rad * 0.62, ry, mix(p.accent, '#ffffff', 0.08)) +
      ellipse(x, y, rad * 0.26, ry, p.accent) +
      path(`M${x} ${y - ry}q${rad * 0.1} ${-ry * 0.34} ${rad * 0.3} ${-ry * 0.4}`, { fill: 'none', stroke: mix(p.ok, '#000000', 0.35), 'stroke-width': rad * 0.16, 'stroke-linecap': 'round' }) +
      group(eye(-1) + eye(1) + path(`M${x - rad * 0.46} ${y + ry * 0.22}l${rad * 0.16} ${ry * 0.14}l${rad * 0.14} ${-ry * 0.12}l${rad * 0.16} ${ry * 0.14}l${rad * 0.16} ${-ry * 0.14}l${rad * 0.14} ${ry * 0.12}l${rad * 0.16} ${-ry * 0.14}q${-rad * 0.46} ${ry * 0.62} ${-rad * 0.92} 0z`, { fill: p.warn }), { class: 'flick', style: `animation-delay:${-k * 1.1}s` })
    )
  }
  const patch = pumpkin(170, 840, 58, 0) + pumpkin(330, 858, 42, 1) + pumpkin(700, 846, 64, 2) + pumpkin(860, 866, 40, 3) + pumpkin(900, 856, 50, 4) + pumpkin(1450, 742, 46, 5)
  const ground = path('M-80 900V806Q200 780 440 812T820 838Q1010 836 1110 770Q1220 690 1330 690Q1470 696 1680 780V900z', { fill: mix(p.bg, '#000000', 0.7) })
  let fence = ''
  for (let x = 610; x < 1090; x += 34) fence += `M${x} 842v-58l5 -9l5 9v58z`
  fence += 'M604 800h490v5h-490zM604 824h490v5h-490z'
  const bark = mix(p.bg, '#000000', 0.8)
  const trees =
    bareTree(
      [
        ['M1556 900C1566 800 1536 720 1548 620', 18],
        ['M1546 716C1500 676 1480 664 1440 640M1548 660C1580 620 1596 596 1622 574M1548 630C1530 586 1508 566 1490 530', 7],
        ['M1480 664C1464 644 1462 626 1466 604M1508 566C1516 546 1512 528 1520 508M1440 640C1420 636 1404 624 1390 610', 3.4],
      ],
      bark,
    ) +
    // An owl on the bough, its eyes blinking.
    ellipse(1462, 624, 17, 22, bark) +
    polygon([[1447, 608], [1451, 594], [1458, 606]], bark) +
    polygon([[1466, 606], [1473, 594], [1477, 608]], bark) +
    group(circle(1455, 618, 5, p.ok) + circle(1469, 618, 5, p.ok) + circle(1455, 618, 2, bark) + circle(1469, 618, 2, bark), { class: 'blink' })
  // The web in the corner, and its spider on a thread.
  let web = ''
  for (let k = 0; k < 6; k += 1) {
    const a = (Math.PI / 2) * (k / 5)
    web += `M1600 0L${n(1600 - Math.cos(a) * 250)} ${n(Math.sin(a) * 250)}`
  }
  for (const rad of [70, 130, 190, 244]) {
    web += `M${1600 - rad} 0`
    for (let k = 1; k <= 5; k += 1) {
      const a = (Math.PI / 2) * (k / 5)
      const mid = (Math.PI / 2) * ((k - 0.5) / 5)
      web += `Q${n(1600 - Math.cos(mid) * rad * 0.86)} ${n(Math.sin(mid) * rad * 0.86)} ${n(1600 - Math.cos(a) * rad)} ${n(Math.sin(a) * rad)}`
    }
  }
  const spider = group(line(1418, 0, 1418, 168, alpha(p.text, 0.4), { 'stroke-width': 1 }) + circle(1418, 176, 9, bark) + circle(1418, 164, 5, bark) + path('M1410 172l-14 -8M1410 178l-15 2M1410 182l-12 10M1426 172l14 -8M1426 178l15 2M1426 182l12 10', { fill: 'none', stroke: bark, 'stroke-width': 2, 'stroke-linecap': 'round' }), { class: 'spider' })
  const fog = [
    [300, 760, 520, 50, 44],
    [900, 800, 640, 56, 56],
    [1380, 770, 420, 44, 50],
  ]
    .map(([x, y, rx, ry, s]) => ellipse(x!, y!, rx!, ry!, paint('hw-fog'), { class: 'fog', style: `animation-duration:${s}s` }))
    .join('')
  const bats = drift(13, 8, 'bat', 52, (x, y, k, pick) => group(path(BAT, { fill: '#050308', transform: `translate(${n(x)} ${n(50 + y * 0.45)}) scale(${n(1 + pick() * 1.5)})` }), { class: 'flap' }))
  const embers = drift(14, 16, 'ember', 60, (x, y, k, pick) => circle(x, y, 1.3 + pick() * 1.6, alpha(k % 3 === 0 ? p.warn : p.accent, 0.7)))
  return {
    alt: 'A haunted house on a hill under a crescent moon, its windows lit orange, a patch of carved pumpkins glowing in front, two small ghosts, an owl on a bare tree, bats, a spider on its web and thin violet fog.',
    bolt: { x: 1276, y: 572 },
    defs,
    style:
      PARALLAX +
      CROSS +
      anim('bat', 'cross') +
      anim('cl', 'cross') +
      FLAP +
      RISE +
      anim('ember', 'rise') +
      SWAY +
      '.fog{animation:sway 44s ease-in-out infinite}' +
      BOB +
      '.ghost{animation:bob 6s ease-in-out infinite}.spider{animation:bob 7s ease-in-out infinite}' +
      pulse('halo', 0.75, 1, 9) +
      pulse('glow', 0.6, 1, 4) +
      pulse('flick', 0.72, 1, 3) +
      pulse('tw', 0.25, 1, 5) +
      '@keyframes blink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(0.1)}}.blink{transform-box:fill-box;transform-origin:center;animation:blink 6s linear infinite}',
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('hw-sky')) +
      stars(122, 90, 560, p.text) +
      moon +
      clouds +
      layer('far', path(far.d, { fill: mix(p.bg, p.info, 0.2) })) +
      layer('mid', group(path(house, { fill: dark, stroke: dark, 'stroke-width': 3 }) + windows + door, { transform: 'translate(-66 118) scale(0.8)' }) + ghosts) +
      fog +
      layer('near', ground + path(fence, { fill: mix(p.bg, '#000000', 0.82) }) + patch + trees + BOLT_HERE) +
      path(web, { fill: 'none', stroke: alpha(p.text, 0.28), 'stroke-width': 1.2 }) +
      spider +
      bats +
      embers +
      v.body,
  }
}

/** A snowy village on Christmas Eve: a sleigh across the moon, a decorated tree, lights and snow. */
const christmas: Make = ({ palette: p }) => {
  const r = rnd(141)
  const v = vignette('xm-vig', '#020a06', 0.6)
  const bulbs = [p.accent, p.warn, p.ok, p.info]
  const snowy = mix(p.bg, p.text, 0.9)
  const dark = mix(p.bg, '#000000', 0.5)
  const defs =
    linear('xm-sky', [
      [0, mix(p.bg, '#000000', 0.55)],
      [0.55, p.bg],
      [0.85, mix(p.bg, p.info, 0.26)],
      [1, mix(p.bg, p.info, 0.14)],
    ]) +
    radial('xm-moon', [
      [0, '#ffffff'],
      [1, mix(p.text, p.info, 0.3)],
    ]) +
    glow('xm-halo', mix(p.text, p.info, 0.4), 0.36) +
    bulbs.map((c, i) => glow(`xm-b${i}`, c, 0.6)).join('') +
    glow('xm-lamp', p.special, 0.6) +
    glow('xm-far', p.special, 0.95) +
    linear('xm-snow', [
      [0, snowy],
      [1, mix(p.bg, p.text, 0.55)],
    ]) +
    v.defs
  // The moon stands in the right wing, clear of the chat column.
  const moon = circle(1340, 172, 330, paint('xm-halo')) + circle(1340, 172, 92, paint('xm-moon'))
  // The sleigh: three reindeer, the reins, the sleigh and its driver, small against the moon.
  const deer = (x: number) =>
    ellipse(x, 0, 17, 6.5, dark) + path(`M${x + 12} -3l12 -12l8 1l-3 6l-8 2zM${x + 22} -16l-3 -10M${x + 25} -15l4 -9M${x - 12} 2l-12 14M${x - 6} 4l-2 16M${x + 8} 4l10 13M${x + 13} 2l16 7`, { fill: dark, stroke: dark, 'stroke-width': 2.4, 'stroke-linecap': 'round' })
  const sleigh = group(
    deer(0) +
      deer(52) +
      deer(104) +
      path('M-14 -2L-62 2', { fill: 'none', stroke: dark, 'stroke-width': 1.5 }) +
      path('M-124 14q-10 0 -10 -10M-128 14h62q12 0 14 -12M-120 6h44l8 -14h-14l-6 6h-32z', { fill: dark, stroke: dark, 'stroke-width': 3, 'stroke-linecap': 'round' }) +
      circle(-92, -12, 7, dark) +
      polygon([[-98, -17], [-88, -30], [-84, -16]], dark) +
      circle(-110, -8, 9, dark),
    { class: 'sleigh' },
  )
  const far = ridge(142, 700, 300, 620, { sharp: true })
  const hill = ridge(143, 790, 90, 700)
  // The village: gabled houses with snow on the roof at either side of the chat column, a lit window or two, a chimney and
  // its smoke. Under the column itself, where the app frosts the picture, only their window light: soft glows that read as a
  // far village through the frost.
  let walls = ''
  let roofs = ''
  let panes = ''
  let lamps = ''
  let smokes = ''
  const house = (x: number, w: number, k: number, steeple: boolean) => {
    const h = w * (0.62 + r() * 0.3)
    const y = hill.y(x + w / 2) + 6
    if (steeple) {
      walls += `M${n(x)} ${n(y)}v${n(-h * 2.1)}h${n(w * 0.6)}v${n(h * 2.1)}z`
      roofs += `M${n(x - 6)} ${n(y - h * 2.1)}l${n(w * 0.3 + 6)} ${n(-h * 0.9)}l${n(w * 0.3 + 6)} ${n(h * 0.9)}z`
      panes += `M${n(x + w * 0.2)} ${n(y - h * 0.9)}h${n(w * 0.2)}v${n(h * 0.34)}h${n(-w * 0.2)}z`
      lamps += circle(x + w * 0.3, y - h * 1.6, 15, paint('xm-lamp')) + circle(x + w * 0.3, y - h * 1.6, 8, mix(p.text, p.special, 0.4))
      return
    }
    walls += `M${n(x)} ${n(y)}v${n(-h)}h${n(w)}v${n(h)}zM${n(x + w * 0.66)} ${n(y - h)}v${n(-h * 0.62)}h${n(w * 0.16)}v${n(h * 0.62)}z`
    roofs += `M${n(x - 8)} ${n(y - h + 3)}l${n(w / 2 + 8)} ${n(-h * 0.62)}l${n(w / 2 + 8)} ${n(h * 0.62)}z`
    panes += `M${n(x + w * 0.16)} ${n(y - h * 0.68)}h${n(w * 0.24)}v${n(h * 0.36)}h${n(-w * 0.24)}z` + (k % 2 === 0 ? `M${n(x + w * 0.58)} ${n(y - h * 0.68)}h${n(w * 0.24)}v${n(h * 0.36)}h${n(-w * 0.24)}z` : '')
    lamps += circle(x + w * 0.28, y - h * 0.5, 30, paint('xm-lamp'))
    if (k % 2 === 1) smokes += smoke(x + w * 0.74, y - h * 1.66, p.muted)
  }
  ;[392, 462].forEach((x, k) => house(x + r() * 12, 54 + r() * 26, k, false))
  house(1084, 56, 0, true)
  ;[1128, 1190].forEach((x, k) => house(x + r() * 10, 52 + r() * 24, k + 1, false))
  let farLights = ''
  for (let i = 0; i < 7; i += 1) {
    const x = 570 + i * 74 + r() * 30
    farLights += circle(x, hill.y(x) - 12, 34 + r() * 18, paint('xm-far'))
  }
  let villagePines = ''
  let pineCaps = ''
  for (let i = 0; i < 12; i += 1) {
    const x = 470 + i * 78 + r() * 30
    const h = 56 + r() * 60
    villagePines += pineD(x, hill.y(x) + 4, h)
    pineCaps += `M${n(x)} ${n(hill.y(x) + 4 - h)}l${n(h * 0.09)} ${n(h * 0.2)}l${n(-h * 0.09)} ${n(-h * 0.06)}l${n(-h * 0.09)} ${n(h * 0.06)}z`
  }
  // The big tree at the left: snow on each tier, garlands, ornaments, a glowing topper, gifts beneath.
  const [bx, by, bh] = [262, 850, 440]
  let tree = ''
  let caps = ''
  let garland = ''
  let baubles = ''
  for (let tier = 0; tier < 5; tier += 1) {
    const top = by - bh + tier * bh * 0.16
    const foot = top + bh * 0.34
    const half = bh * (0.09 + tier * 0.058)
    tree += `M${bx} ${n(top)}L${n(bx + half)} ${n(foot)}Q${bx} ${n(foot + 16)} ${n(bx - half)} ${n(foot)}z`
    caps += `M${bx} ${n(top)}L${n(bx + half * 0.42)} ${n(top + (foot - top) * 0.42)}Q${bx} ${n(top + (foot - top) * 0.3)} ${n(bx - half * 0.42)} ${n(top + (foot - top) * 0.42)}z`
    garland += `M${n(bx - half * 0.86)} ${n(foot - 14)}Q${bx} ${n(foot + 12)} ${n(bx + half * 0.86)} ${n(foot - 22)}`
    for (let k = 0; k < 2 + tier; k += 1) {
      const t = (k + 0.5) / (2 + tier)
      const ox = bx - half * 0.8 + t * half * 1.6
      const oy = foot - 16 + Math.sin(t * Math.PI) * 14
      const c = (tier + k) % bulbs.length
      baubles += circle(ox, oy, 20, paint(`xm-b${c}`), { class: 'bulb', style: `animation-delay:${n(-(tier * 3 + k) * 0.7)}s` }) + circle(ox, oy, 6.5, bulbs[c]!)
    }
  }
  const bigTree =
    rect(bx - 14, by - 26, 28, 40, mix(p.bg, '#000000', 0.6)) +
    path(tree, { fill: mix(p.bg, p.ok, 0.22) }) +
    path(caps, { fill: snowy, opacity: 0.92 }) +
    path(garland, { fill: 'none', stroke: p.special, 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.85 }) +
    baubles +
    circle(bx, by - bh - 6, 46, paint('xm-lamp'), { class: 'topper' }) +
    circle(bx, by - bh - 6, 11, mix(p.special, '#ffffff', 0.5))
  const gift = (x: number, y: number, w: number, h: number, box: string, bow: string) => rect(x, y - h, w, h, box, { rx: 3 }) + rect(x + w / 2 - 4, y - h, 8, h, bow) + rect(x, y - h * 0.62, w, 7, bow) + path(`M${x + w / 2} ${y - h}q-16 -18 -22 -4q10 8 22 4q16 -18 22 -4q-10 8 -22 4z`, { fill: bow })
  const gifts = gift(318, 866, 62, 48, p.accent, p.special) + gift(136, 872, 54, 40, p.info, p.text) + gift(372, 874, 40, 32, p.ok, p.accent)
  // A snowman at the right, past the lamp.
  const [sx, sy] = [1478, 838]
  const snowman =
    circle(sx, sy, 38, snowy) +
    circle(sx, sy - 52, 28, snowy) +
    circle(sx, sy - 92, 20, snowy) +
    rect(sx - 16, sy - 122, 32, 16, dark) +
    rect(sx - 24, sy - 108, 48, 5, dark) +
    path(`M${sx - 22} ${sy - 68}q22 12 44 0l-2 12q-20 10 -40 0zM${sx + 16} ${sy - 62}l12 26l-10 2z`, { fill: p.accent }) +
    circle(sx - 7, sy - 96, 2.4, dark) +
    circle(sx + 7, sy - 96, 2.4, dark) +
    polygon([[sx, sy - 90], [sx - 20, sy - 86], [sx, sy - 84]], p.warn) +
    path(`M${sx - 26} ${sy - 50}l-30 -18M${sx + 26} ${sy - 50}l32 -14`, { fill: 'none', stroke: mix(p.bg, '#000000', 0.6), 'stroke-width': 3, 'stroke-linecap': 'round' })
  // A street lamp at the right, by Bolt.
  const lamp = rect(1404, 640, 7, 170, dark) + path('M1392 640h31l-5 -30h-21z', { fill: dark }) + circle(1407, 624, 60, paint('xm-lamp'), { class: 'topper' }) + rect(1400, 614, 14, 22, mix(p.special, '#ffffff', 0.4))
  const snow = path('M-80 900V830Q160 800 400 836T780 850Q1000 850 1150 806Q1240 704 1340 694Q1480 700 1680 780V900z', { fill: paint('xm-snow') })
  const drifts = path('M-80 900V872Q300 846 640 874T1220 866Q1440 840 1680 866V900z', { fill: snowy, opacity: 0.7 })
  const flakesFar = drift(144, 46, 'snow', 34, (x, y, k, pick) => circle(x, y, 1 + pick() * 1.4, alpha(p.text, 0.6)))
  const flakesMid = drift(145, 34, 'snow', 22, (x, y, k, pick) => circle(x, y, 2 + pick() * 2, alpha(p.text, 0.8)))
  const flakesNear = drift(146, 14, 'snow', 14, (x, y, k, pick) => circle(x, y, 4 + pick() * 3, alpha(p.text, 0.9)))
  return {
    alt: 'A snowy village on Christmas Eve: a sleigh crossing a full moon at the right, a big decorated tree with gifts at the left, lit houses with smoking chimneys at either side and far window lights between them, a street lamp and a snowman by the right edge, coloured lights strung along the top and snow falling.',
    bolt: { x: 1276, y: 578 },
    defs,
    style:
      PARALLAX +
      FALL +
      anim('snow', 'fall') +
      SMOKE +
      pulse('bulb', 0.5, 1, 5) +
      pulse('topper', 0.7, 1, 6) +
      pulse('tw', 0.25, 1, 6) +
      '@keyframes sleigh{0%{transform:translate(-320px,270px) rotate(-8deg)}50%{transform:translate(820px,124px) rotate(0)}100%{transform:translate(1760px,254px) rotate(8deg)}}.sleigh{transform:translate(1392px,203px) rotate(5deg);animation:sleigh 96s linear -77s infinite}',
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('xm-sky')) +
      stars(147, 120, 600, p.text) +
      moon +
      sleigh +
      layer('far', path(far.d, { fill: mix(p.bg, p.info, 0.2) }) + path(capsD(far.y, 600), { fill: mix(p.bg, p.text, 0.66) })) +
      layer('mid', path(hill.d, { fill: mix(p.bg, p.text, 0.5) }) + path(villagePines, { fill: mix(p.bg, '#000000', 0.35) }) + path(pineCaps, { fill: snowy }) + farLights + lamps + path(walls, { fill: mix(p.bg, '#000000', 0.4) }) + path(roofs, { fill: snowy }) + path(panes, { fill: p.special, opacity: 0.95 }) + smokes) +
      flakesFar +
      layer('near', snow + bigTree + gifts + snowman + lamp + drifts + BOLT_HERE) +
      lights('xm-b', bulbs, 150) +
      flakesMid +
      flakesNear +
      v.body,
  }
}

/** A spring morning: a cherry branch in blossom, petals over green hills, tulips, butterflies. */
const spring: Make = ({ palette: p }) => {
  const r = rnd(151)
  const pink = mix(p.special, '#ffffff', 0.55)
  const leaf = mix(p.ok, '#ffffff', 0.25)
  const v = vignette('sp-vig', p.warn, 0.14)
  const defs =
    linear('sp-sky', [
      [0, mix(p.bg, p.info, 0.3)],
      [0.55, mix(p.bg, p.info, 0.1)],
      [1, mix(p.bg, p.special, 0.1)],
    ]) +
    glow('sp-sun', '#ffd75f', 0.55) +
    linear('sp-meadow', [
      [0, mix(p.bg, p.ok, 0.6)],
      [1, mix(p.bg, p.ok, 0.82)],
    ]) +
    v.defs
  let rays = ''
  for (let k = 0; k < 12; k += 1) rays += polygon([[1310, 150], [1310 + Math.cos((k / 12) * Math.PI * 2 - 0.07) * 330, 150 + Math.sin((k / 12) * Math.PI * 2 - 0.07) * 330], [1310 + Math.cos((k / 12) * Math.PI * 2 + 0.07) * 330, 150 + Math.sin((k / 12) * Math.PI * 2 + 0.07) * 330]], '#ffd75f', { opacity: 0.12 })
  const sun = group(rays, { class: 'rays' }) + circle(1310, 150, 240, paint('sp-sun')) + circle(1310, 150, 62, '#ffe9a6')
  const clouds =
    group(cloud(520, 190, 360, '#ffffff', 0.85), { class: 'cl', style: 'animation-duration:260s;animation-delay:-90s' }) +
    group(cloud(980, 300, 280, '#ffffff', 0.7), { class: 'cl', style: 'animation-duration:320s;animation-delay:-200s' }) +
    group(cloud(1480, 380, 320, '#ffffff', 0.75), { class: 'cl', style: 'animation-duration:380s;animation-delay:-40s' })
  const far = ridge(152, 640, 180, 800)
  const mid = ridge(153, 730, 150, 620)
  // Blossoming trees on the middle hill: a trunk and a crown of pink discs.
  let trunks = ''
  let crowns = ''
  for (let i = 0; i < 11; i += 1) {
    const x = 380 + i * 110 + r() * 50
    const y = mid.y(x) + 3
    const s = 0.7 + r() * 0.6
    trunks += `M${n(x - 3 * s)} ${n(y)}v${n(-40 * s)}h${n(6 * s)}v${n(40 * s)}z`
    for (const [dx, dy, rad] of [
      [0, -56, 26],
      [-20, -44, 20],
      [20, -46, 21],
      [-6, -72, 17],
    ]) crowns += circle(x + dx! * s, y + dy! * s, rad! * s, i % 3 === 0 ? mix(pink, '#ffffff', 0.35) : pink, { opacity: 0.92 })
  }
  const stream = path('M620 900Q700 840 640 800T760 740Q820 716 800 700', { fill: 'none', stroke: mix(p.bg, p.info, 0.45), 'stroke-width': 26, 'stroke-linecap': 'round', opacity: 0.8 })
  // The cherry branch from the top left, with five-petal blossoms and buds.
  const bark = mix(p.warn, '#000000', 0.35)
  const branch = bareTree(
    [
      ['M-30 60Q160 90 330 190T640 250', 16],
      ['M210 124Q280 80 370 76M330 190Q360 260 430 300M470 230Q540 180 620 176', 8],
      ['M370 76Q410 60 440 30M430 300Q470 320 520 316M620 176Q660 160 690 120M140 96Q150 150 190 180', 4],
    ],
    bark,
  )
  const blossom = (x: number, y: number, s: number) => {
    let petals = ''
    for (let k = 0; k < 5; k += 1) petals += ellipse(0, -9 * s, 6.4 * s, 9 * s, k % 2 === 0 ? pink : mix(pink, '#ffffff', 0.4), { transform: `rotate(${k * 72})` })
    return group(petals + circle(0, 0, 3.4 * s, mix(p.special, p.warn, 0.4)), { transform: `translate(${n(x)} ${n(y)})` })
  }
  let blossoms = ''
  for (const [x, y] of [
    [60, 70], [150, 92], [230, 116], [300, 86], [372, 72], [438, 34], [330, 186], [380, 250], [432, 298], [520, 318], [470, 228], [548, 190], [620, 176], [688, 122], [640, 250], [190, 178], [270, 160], [580, 240],
  ]) blossoms += blossom(x!, y!, 1 + r() * 0.5)
  const petals = drift(155, 28, 'petal', 26, (x, y) => tumbling(x, y, ellipse(0, 0, 8, 4.6, alpha(pink, 0.9))))
  // The meadow in front: grass that bends, tulips and daisies at the corners.
  const meadow = path('M-80 900V820Q200 780 460 826T860 848Q1020 846 1110 780Q1210 692 1330 690Q1470 696 1680 790V900z', { fill: paint('sp-meadow') })
  let grass = ''
  const blades = few(46)
  for (let i = 0; i < blades; i += 1) {
    const x = i < blades / 2 ? -20 + (i / blades) * 2 * 500 + r() * 10 : 1100 + ((i - blades / 2) / blades) * 2 * 560 + r() * 10
    const y = i < blades / 2 ? 842 - Math.sin((x / 520) * Math.PI) * 26 : 800 - Math.sin(((x - 1100) / 560) * Math.PI) * 96 + 30
    const h = 30 + r() * 44
    grass += group(path(`M${n(x)} ${n(y + 30)}q${n(-4 + r() * 8)} ${n(-h * 0.6)} ${n(-8 + r() * 16)} ${n(-h)}q${n(2)} ${n(h * 0.5)} ${n(7)} ${n(h)}z`, { fill: i % 3 === 0 ? leaf : mix(p.ok, p.bg, 0.2) }), { class: 'bend', style: `animation-delay:${n(-r() * 7)}s` })
  }
  const tulip = (x: number, y: number, h: number, colour: string) =>
    group(
      path(`M${x} ${y}v${-h}`, { fill: 'none', stroke: mix(p.ok, '#000000', 0.1), 'stroke-width': 4, 'stroke-linecap': 'round' }) +
        path(`M${x} ${y - h * 0.3}q-22 -8 -26 -40q22 6 26 40zM${x} ${y - h * 0.2}q20 -10 22 -38q-20 8 -22 38z`, { fill: leaf }) +
        path(`M${x - 15} ${y - h - 24}q0 30 15 30t15 -30l-8 10l-7 -12l-7 12z`, { fill: colour }),
      { class: 'bend' },
    )
  const daisy = (x: number, y: number) => {
    let petals = ''
    for (let k = 0; k < 8; k += 1) petals += ellipse(0, -9, 3.6, 8, '#ffffff', { transform: `rotate(${k * 45})` })
    return path(`M${x} ${y + 34}v-30`, { fill: 'none', stroke: mix(p.ok, '#000000', 0.1), 'stroke-width': 3 }) + group(petals + circle(0, 0, 4.6, '#f5c542'), { transform: `translate(${x} ${y})` })
  }
  const flowers =
    tulip(70, 880, 110, mix(p.error, '#ffffff', 0.15)) +
    tulip(128, 890, 86, pink) +
    tulip(190, 884, 124, mix(p.special, '#ffffff', 0.2)) +
    tulip(1530, 850, 104, mix(p.error, '#ffffff', 0.15)) +
    tulip(1586, 866, 84, pink) +
    daisy(262, 826) +
    daisy(330, 842) +
    daisy(1150, 800) +
    daisy(1470, 792) +
    daisy(410, 852)
  const butterfly = (x: number, y: number, colour: string, delay: number) =>
    group(group(group(ellipse(-9, 0, 10, 7, colour, { class: 'wing' }) + ellipse(9, 0, 10, 7, colour, { class: 'wing' }) + rect(-1.2, -7, 2.4, 14, mix(p.text, p.bg, 0.2), { rx: 1 }), { class: 'flutter', style: `animation-delay:${delay}s` }), { transform: `translate(${x} ${y})` }), { class: 'fly', style: `animation-delay:${delay * 9}s` })
  const butterflies = butterfly(760, 420, mix(p.info, '#ffffff', 0.3), -1) + butterfly(1060, 560, mix(p.warn, '#ffd75f', 0.7), -3) + butterfly(300, 520, pink, -5)
  return {
    alt: 'A bright spring morning: a cherry branch in blossom at the top left, pink petals drifting over green hills dotted with blossoming trees, tulips and daisies in the grass, butterflies and soft white clouds under a pale sun.',
    bolt: { x: 1276, y: 572 },
    defs,
    style:
      PARALLAX +
      CROSS +
      anim('cl', 'cross') +
      FALL +
      anim('petal', 'fall') +
      SPIN +
      SWAY +
      '.sway{animation:sway 5s ease-in-out infinite}' +
      BEND +
      '@keyframes rays{from{transform:rotate(0)}to{transform:rotate(360deg)}}.rays{transform-origin:1310px 150px;animation:rays 180s linear infinite}' +
      '@keyframes wing{0%,100%{transform:scaleX(1)}50%{transform:scaleX(0.3)}}.wing{transform-origin:0 0;animation:wing 1.2s ease-in-out infinite}' +
      '@keyframes flutter{0%,100%{transform:translate(0,0)}25%{transform:translate(30px,-22px)}50%{transform:translate(64px,4px)}75%{transform:translate(26px,20px)}}.flutter{animation:flutter 11s ease-in-out infinite}' +
      '@keyframes fly{0%,100%{transform:translateX(-60px)}50%{transform:translateX(60px)}}.fly{animation:fly 37s ease-in-out infinite}',
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('sp-sky')) +
      sun +
      clouds +
      layer('far', path(far.d, { fill: mix(p.bg, p.info, 0.3) })) +
      layer('mid', path(mid.d, { fill: mix(p.bg, p.ok, 0.4) }) + path(trunks, { fill: bark }) + crowns + stream) +
      butterflies +
      layer('near', meadow + grass + flowers + BOLT_HERE) +
      branch +
      blossoms +
      petals +
      v.body,
  }
}

/** A summer sunset at the beach: the sun into a teal sea, a sailboat, gulls, palms. */
const summer: Make = ({ palette: p }) => {
  const r = rnd(44)
  const horizon = 590
  const v = vignette('su-vig', '#020814', 0.55)
  const sand = mix(p.bg, p.warn, 0.42)
  const dark = mix(p.bg, '#000000', 0.62)
  const defs =
    linear('su-sky', [
      [0, mix(p.bg, '#000000', 0.35)],
      [0.4, p.bg],
      [0.72, mix(p.bg, p.special, 0.5)],
      [0.9, mix(p.error, p.warn, 0.25)],
      [1, mix(p.warn, '#ffffff', 0.2)],
    ]) +
    linear('su-sea', [
      [0, mix(p.bg, p.info, 0.5)],
      [0.35, mix(p.bg, p.info, 0.26)],
      [1, mix(p.bg, '#000000', 0.2)],
    ]) +
    radial('su-sun', [
      [0, '#fffbe0'],
      [0.6, p.accent],
      [1, mix(p.accent, p.error, 0.55)],
    ]) +
    glow('su-glow', mix(p.warn, p.error, 0.4), 0.55) +
    linear('su-sand', [
      [0, mix(sand, p.error, 0.2)],
      [1, mix(p.bg, p.warn, 0.2)],
    ]) +
    glow('su-lamp', p.warn, 0.6) +
    v.defs
  const [sx, sy] = [1030, horizon - 8]
  const sun = circle(sx, sy, 440, paint('su-glow'), { class: 'glow' }) + circle(sx, sy, 118, paint('su-sun'))
  const streaks = [
    [700, 470, 520, 12, p.special, 0.4],
    [1240, 430, 420, 10, p.error, 0.36],
    [980, 520, 640, 9, p.warn, 0.4],
    [420, 400, 380, 9, p.special, 0.26],
    [1420, 510, 360, 8, p.warn, 0.3],
  ]
    .map(([x, y, rx, ry, c, a], i) => ellipse(Number(x), Number(y), Number(rx), Number(ry), String(c), { opacity: Number(a), class: 'streak', style: `animation-duration:${50 + i * 9}s` }))
    .join('')
  const sea = rect(-BLEED_X, horizon, WIDTH + BLEED_X * 2, HEIGHT - horizon, paint('su-sea'))
  // The sun's path on the water: short bright dashes that widen toward the shore and shimmer.
  let glitter = ''
  for (let i = 0; i < 46; i += 1) {
    const t = r()
    const y = horizon + 6 + t * 250
    const spread = 30 + t * 150
    glitter += rect(sx - spread + r() * spread * 2 - 14, y, 14 + t * 30, 2.4 + t * 2, i % 3 === 0 ? '#fffbe0' : p.accent, { opacity: 0.75 - t * 0.3, class: 'tw', style: `animation-delay:${n(-r() * 5)}s`, rx: 1.2 })
  }
  const wave = (y: number, opacity: number, seconds: number, width: number) => {
    let d = `M-400 ${n(y)}`
    for (let x = -400; x < WIDTH + 400; x += 200) d += 'q50 -12 100 0t100 0'
    return path(d, { fill: 'none', stroke: alpha(mix(p.info, '#ffffff', 0.3), opacity), 'stroke-width': width, class: 'roll', style: `animation-duration:${n(seconds)}s` })
  }
  const waves = wave(626, 0.4, 16, 2) + wave(668, 0.34, 20, 2.6) + wave(720, 0.28, 24, 3.4)
  const island = path(`M150 ${horizon}q60 -40 150 -34q40 -22 90 -4q70 6 110 38z`, { fill: mix(p.bg, p.special, 0.28) }) + path(`M318 ${horizon - 36}q6 -40 -4 -64M314 ${horizon - 100}q-30 -14 -46 4M314 ${horizon - 100}q-10 -28 -40 -26M314 ${horizon - 100}q20 -24 46 -10M314 ${horizon - 100}q30 -4 42 18`, { fill: 'none', stroke: mix(p.bg, p.special, 0.2), 'stroke-width': 4, 'stroke-linecap': 'round' })
  const boat = group(path(`M640 ${horizon - 2}h58l-10 12h-38z`, { fill: dark }) + polygon([[668, horizon - 4], [668, horizon - 62], [700, horizon - 6]], mix(p.text, p.error, 0.2), { opacity: 0.9 }) + polygon([[664, horizon - 4], [664, horizon - 50], [640, horizon - 6]], mix(p.text, p.warn, 0.2), { opacity: 0.8 }), { class: 'boat' })
  const gulls = drift(45, 6, 'gull', 70, (x, y, k, pick) => group(path('M-12 0q6 -8 12 0q6 -8 12 0', { fill: 'none', stroke: mix(p.bg, '#000000', 0.2), 'stroke-width': 2.4, 'stroke-linecap': 'round', transform: `translate(${n(x)} ${n(120 + y * 0.36)}) scale(${n(0.8 + pick() * 0.9)})` }), { class: 'flap' }))
  // The beach in front, its foam, and the palms leaning in from both sides.
  const beach = path('M-80 900V800Q160 770 420 812T820 850Q1000 850 1110 780Q1220 694 1330 692Q1480 696 1680 760V900z', { fill: paint('su-sand') })
  const foam = path('M-80 806Q160 776 420 818T820 856Q1000 856 1100 794', { fill: 'none', stroke: alpha('#ffffff', 0.5), 'stroke-width': 5, 'stroke-linecap': 'round', class: 'foam' }) + path('M-80 790Q160 760 420 802T820 840Q990 842 1080 792', { fill: 'none', stroke: alpha('#ffffff', 0.22), 'stroke-width': 3, 'stroke-linecap': 'round', class: 'foam', style: 'animation-delay:-3s' })
  const palm = (x: number, y: number, lean: number, h: number) => {
    const [tx, ty] = [x + lean, y - h]
    let fronds = ''
    ;[-150, -110, -64, -20, 26, 70].forEach((a, i) => {
      const rad = ((a - 90) * Math.PI) / 180
      const len = h * 0.42 * (i % 2 === 0 ? 1 : 0.86)
      const [ex, ey] = [tx + Math.cos(rad) * len, ty + Math.sin(rad) * len + len * 0.42]
      const [cx, cy] = [tx + Math.cos(rad) * len * 0.55, ty + Math.sin(rad) * len * 0.75 - 26]
      fronds += group(path(`M${n(tx)} ${n(ty)}Q${n(cx)} ${n(cy)} ${n(ex)} ${n(ey)}Q${n(cx + 6)} ${n(cy + 30)} ${n(tx)} ${n(ty)}z`, { fill: dark }), { class: 'frond', style: `transform-origin:${n(tx)}px ${n(ty)}px;animation-delay:${-i * 0.8}s` })
    })
    return path(`M${x} ${y}Q${n(x + lean * 0.2)} ${n(y - h * 0.6)} ${n(tx)} ${n(ty)}`, { fill: 'none', stroke: dark, 'stroke-width': h * 0.045, 'stroke-linecap': 'round' }) + fronds + circle(tx - 6, ty + 10, 8, dark) + circle(tx + 8, ty + 12, 7, dark)
  }
  const palms = palm(60, 900, 110, 520) + palm(-10, 900, 60, 380) + palm(1580, 900, -90, 470)
  const board = group(ellipse(0, 0, 17, 86, mix(p.info, p.bg, 0.2)) + rect(-2.5, -80, 5, 160, alpha('#ffffff', 0.7)) + rect(-15, -12, 30, 9, p.error), { transform: 'translate(1470 742) rotate(12)' })
  // A string of lanterns between the palms at the left.
  let lanterns = path('M170 404Q420 500 700 360', { fill: 'none', stroke: alpha('#000000', 0.45), 'stroke-width': 2 })
  for (let k = 1; k < 7; k += 1) {
    const t = k / 7
    const x = 170 + (700 - 170) * t
    const y = (1 - t) * (1 - t) * 404 + 2 * t * (1 - t) * 500 + t * t * 360
    lanterns += circle(x, y + 14, 30, paint('su-lamp'), { class: 'bulb', style: `animation-delay:${-k * 0.8}s` }) + rect(x - 7, y + 4, 14, 20, [p.warn, p.error, p.accent, p.info][k % 4]!, { rx: 5 })
  }
  return {
    alt: 'A summer sunset at the beach: the sun sinking into a teal sea with a glittering path, a sailboat and an island on the horizon, gulls overhead, lanterns strung between palms leaning in from the sides and slow waves lapping the sand.',
    bolt: { x: 1276, y: 574 },
    defs,
    style:
      PARALLAX +
      CROSS +
      anim('gull', 'cross') +
      FLAP +
      SWAY +
      '.streak{animation:sway 50s ease-in-out infinite}.foam{animation:sway 9s ease-in-out infinite}' +
      BOB +
      '.boat{animation:bob 6s ease-in-out infinite}' +
      '@keyframes roll{from{transform:translateX(-200px)}to{transform:translateX(0)}}.roll{animation-name:roll;animation-timing-function:linear;animation-iteration-count:infinite}' +
      '@keyframes frond{0%,100%{transform:rotate(-2.5deg)}50%{transform:rotate(3deg)}}.frond{animation:frond 6s ease-in-out infinite}' +
      pulse('tw', 0.2, 0.95, 4) +
      pulse('glow', 0.8, 1, 12) +
      pulse('bulb', 0.55, 1, 5),
    body:
      rect(0, 0, WIDTH, horizon + 4, paint('su-sky')) +
      stars(46, 40, 260, p.text) +
      sun +
      streaks +
      sea +
      glitter +
      layer('far', island) +
      layer('mid', boat + waves) +
      gulls +
      layer('near', beach + foam + board + BOLT_HERE) +
      palms +
      lanterns +
      v.body,
  }
}
const BLEED_X = 80

/** A golden autumn dusk: a low sun behind russet hills, a forest in colour, hay bales, geese, leaves falling. */
const autumn: Make = ({ palette: p }) => {
  const r = rnd(161)
  const tints = [p.accent, p.warn, p.ok, p.error, mix(p.accent, p.error, 0.5)]
  const v = vignette('au-vig', '#0a0603', 0.6)
  const bark = mix(p.bg, '#000000', 0.55)
  const defs =
    linear('au-sky', [
      [0, mix(p.bg, '#000000', 0.4)],
      [0.42, mix(p.bg, p.warn, 0.14)],
      [0.74, mix(p.bg, p.warn, 0.56)],
      [1, mix(p.bg, p.accent, 0.66)],
    ]) +
    radial('au-sun', [
      [0, '#fff3d0'],
      [1, mix(p.accent, p.text, 0.35)],
    ]) +
    glow('au-glow', mix(p.accent, p.text, 0.2), 0.5) +
    glow('au-mist', p.text, 0.14) +
    linear('au-field', [
      [0, mix(p.bg, p.accent, 0.4)],
      [1, mix(p.bg, p.warn, 0.18)],
    ]) +
    v.defs
  const sun = circle(232, 556, 460, paint('au-glow'), { class: 'glow' }) + circle(232, 556, 124, paint('au-sun'), { opacity: 0.94 })
  const clouds = group(cloud(820, 250, 420, mix(p.warn, p.text, 0.3), 0.2), { class: 'cl', style: 'animation-duration:300s;animation-delay:-120s' }) + group(cloud(1340, 360, 320, mix(p.accent, p.text, 0.3), 0.18), { class: 'cl', style: 'animation-duration:360s;animation-delay:-40s' })
  const far = ridge(162, 680, 190, 760)
  const mid = ridge(163, 760, 130, 560)
  // The forest on the hills: round crowns in the season's colours, lighter on the sunward side.
  const forest = (seed: number, count: number, ground: (x: number) => number, size: number, shade: number) => {
    const pick = rnd(seed)
    let trunks = ''
    let crowns = ''
    for (let i = 0; i < count; i += 1) {
      const x = -60 + (i / count) * (WIDTH + 120) + pick() * 30
      const y = ground(x) + 4
      const s = size * (0.7 + pick() * 0.7)
      const c = mix(tints[Math.floor(pick() * tints.length)]!, p.bg, shade)
      trunks += `M${n(x - 2.5 * s)} ${n(y)}v${n(-34 * s)}h${n(5 * s)}v${n(34 * s)}z`
      crowns += circle(x, y - 50 * s, 26 * s, c) + circle(x - 16 * s, y - 38 * s, 18 * s, c) + circle(x + 17 * s, y - 40 * s, 19 * s, c) + circle(x - 8 * s, y - 60 * s, 13 * s, mix(c, p.text, 0.16))
    }
    return path(trunks, { fill: bark }) + crowns
  }
  const geese = group(
    [0, 1, 2, 3, 4, 5, 6, 7, 8].map(k => {
      const row = Math.ceil(k / 2)
      const side = k % 2 === 0 ? 1 : -1
      return group(path('M-9 0q5 -6 9 0q5 -6 9 0', { fill: 'none', stroke: mix(p.bg, '#000000', 0.5), 'stroke-width': 2.2, 'stroke-linecap': 'round', transform: `translate(${-row * 30} ${k === 0 ? 0 : side * row * 15})` }), { class: 'flap', style: `animation-delay:${-k * 0.17}s` })
    }).join(''),
    { class: 'geese' },
  )
  // The field in front: hay bales, a scarecrow, a fence, and the leaves already down.
  const field = path('M-80 900V812Q200 782 460 822T860 846Q1020 846 1110 780Q1210 694 1330 692Q1470 698 1680 786V900z', { fill: paint('au-field') })
  const bale = (x: number, y: number, s: number) =>
    ellipse(x, y, 48 * s, 40 * s, mix(p.accent, p.bg, 0.3)) + ellipse(x - 30 * s, y, 20 * s, 40 * s, mix(p.accent, p.text, 0.2)) + [10, 20, 30].map(k => ellipse(x - 30 * s, y, (20 - k * 0.55) * s, (40 - k * 1.1) * s, 'none', { stroke: alpha(p.bg, 0.3), 'stroke-width': 1.6 })).join('')
  const bales = bale(424, 814, 1) + bale(700, 836, 0.8) + bale(930, 822, 0.66)
  const scarecrow =
    path('M250 850V690M190 720H310', { fill: 'none', stroke: bark, 'stroke-width': 7, 'stroke-linecap': 'round' }) +
    path('M214 716h72l10 70h-92z', { fill: mix(p.error, p.bg, 0.45) }) +
    circle(250, 690, 20, mix(p.special, p.bg, 0.2)) +
    path('M222 678h56l-10 -8l-8 -28h-20l-8 28z', { fill: bark }) +
    path('M190 720l-14 10M190 720l-12 -8M310 720l14 10M310 720l12 -8', { fill: 'none', stroke: mix(p.accent, p.text, 0.2), 'stroke-width': 3, 'stroke-linecap': 'round' })
  let fence = ''
  for (let x = 1120; x < 1620; x += 70) fence += `M${x} ${n(790 - Math.sin(((x - 1100) / 560) * Math.PI) * 92 + 26)}v-50h9v50z`
  let litter = ''
  for (let i = 0; i < few(60); i += 1) {
    const x = r() * WIDTH
    const y = 838 + r() * 58
    litter += path(`M${n(x)} ${n(y)}q7 -9 14 0q-7 9 -14 0z`, { fill: tints[i % tints.length]!, opacity: 0.55 + r() * 0.35, transform: `rotate(${n(r() * 360)} ${n(x + 7)} ${n(y)})` })
  }
  // The bough from the top right, with what leaves it has left, and the ones falling.
  const bough = bareTree(
    [
      ['M1640 30Q1440 70 1290 180T1040 250', 17],
      ['M1420 96Q1370 60 1290 60M1290 180Q1270 250 1200 290M1160 222Q1100 170 1030 170', 8],
      ['M1290 60Q1250 50 1220 22M1200 290Q1160 310 1110 304M1030 170Q990 156 964 120M1500 70Q1490 120 1450 150', 4],
    ],
    bark,
  )
  const maple = 'M0 -14l4 6l7 -3l-2 8l8 3l-7 5l3 7l-9 -2l-4 9l-4 -9l-9 2l3 -7l-7 -5l8 -3l-2 -8l7 3z'
  let onBough = ''
  for (const [x, y] of [
    [1580, 52], [1500, 78], [1430, 104], [1360, 70], [1290, 62], [1222, 28], [1300, 176], [1262, 240], [1204, 288], [1118, 302], [1160, 220], [1090, 180], [1030, 172], [968, 124], [1456, 148], [1380, 150],
  ]) onBough += group(path(maple, { fill: tints[Math.floor(r() * tints.length)]!, class: 'hang', style: `animation-delay:${n(-r() * 5)}s` }), { transform: `translate(${x} ${y}) rotate(${n(r() * 360)}) scale(${n(1.3 + r() * 0.9)})` })
  const leaves = drift(164, 26, 'leaf', 24, (x, y, k, pick) => tumbling(x, y, path(maple, { fill: alpha(tints[k % tints.length]!, 0.92), transform: `scale(${n(1 + pick() * 0.8)})` })))
  const mist = ellipse(500, 770, 640, 56, paint('au-mist'), { class: 'mist' }) + ellipse(1250, 800, 560, 50, paint('au-mist'), { class: 'mist', style: 'animation-duration:58s' })
  return {
    alt: 'A golden autumn dusk: a low hazy sun behind russet hills, a forest in amber, rust and olive, hay bales and a scarecrow in the field, geese flying in a V, and leaves tumbling from a bough onto the leaf-strewn ground.',
    bolt: { x: 1276, y: 574 },
    defs,
    style:
      PARALLAX +
      CROSS +
      anim('cl', 'cross') +
      '.geese{animation:cross 120s linear infinite}' +
      FLAP +
      FALL +
      anim('leaf', 'fall') +
      SPIN +
      SWAY +
      '.sway{animation:sway 6s ease-in-out infinite}.mist{animation:sway 46s ease-in-out infinite}' +
      pulse('glow', 0.8, 1, 11) +
      '@keyframes hang{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(6deg)}}.hang{transform-box:fill-box;transform-origin:center top;animation:hang 5s ease-in-out infinite}',
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('au-sky')) +
      sun +
      clouds +
      group(geese, { transform: 'translate(900 190)' }) +
      layer('far', path(far.d, { fill: mix(p.bg, p.warn, 0.34) }) + forest(165, 26, far.y, 0.8, 0.5)) +
      layer('mid', path(mid.d, { fill: mix(p.bg, p.warn, 0.2) }) + forest(166, 20, mid.y, 1.25, 0.24)) +
      mist +
      layer('near', field + litter + bales + scarecrow + path(fence, { fill: bark }) + path('M1100 772q260 -110 540 -10', { fill: 'none', stroke: bark, 'stroke-width': 5 }) + BOLT_HERE) +
      bough +
      onBough +
      leaves +
      v.body,
  }
}

export const SEASON_SCENES: Record<string, Make> = { halloween, christmas, spring, summer, autumn }
