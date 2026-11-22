// The two holiday looks' scenes: Easter morning and the night of Eid al-Fitr. Places and light, no figures.
// Each is a function of the theme, so every colour comes from the look's own
// palette and the picture stays on-look. Every moving part rests where its
// markup puts it, so the still picture the desktop draws under reduced motion
// is a finished one.

import { alpha, anim, BEND, BLEED, BOLT_HERE, circle, cloud, coarse, CROSS, drift, ellipse, few, FLAP, glow, group, HEIGHT, layer, linear, mix, n, paint, PARALLAX, path, pattern, polygon, pulse, radial, rect, ridge, RISE, rnd, stars, SWAY, vignette, WIDTH } from './scene-kit'
import type { Scene } from './scene-kit'
import type { Theme } from './themes'

type Make = (theme: Theme) => Scene

/** A cypress as a path: a tall flame of a tree standing on `base`. */
const cypressD = (x: number, base: number, h: number, w: number): string =>
  `M${n(x)} ${n(base)}C${n(x - w)} ${n(base - h * 0.2)} ${n(x - w * 0.7)} ${n(base - h * 0.78)} ${n(x)} ${n(base - h)}C${n(x + w * 0.7)} ${n(base - h * 0.78)} ${n(x + w)} ${n(base - h * 0.2)} ${n(x)} ${n(base)}zM${n(x - 3)} ${n(base - 4)}h6v${n(h * 0.06 + 8)}h-6z`

/** Easter morning: dawn behind the hills, three crosses far off, the tomb open and lit from within, lilies in the garden. */
const easter: Make = ({ palette: p }) => {
  const r = rnd(33)
  const v = vignette('ea-vig', mix(p.bg, '#000000', 0.7), 0.62)
  const gold = p.accent
  const stone = mix(p.muted, p.bg, 0.5)
  const leaf = mix(mix(p.ok, p.bg, 0.66), '#000000', 0.2)
  const [sx, sy] = [716, 604]
  const defs =
    linear('ea-sky', [
      [0, mix(p.bg, '#000000', 0.4)],
      [0.26, p.bg],
      [0.46, mix(p.bg, p.special, 0.36)],
      [0.58, mix(p.special, p.warn, 0.5)],
      [0.66, mix(p.warn, gold, 0.6)],
      [0.74, mix(gold, p.text, 0.45)],
      [1, mix(gold, p.text, 0.3)],
    ]) +
    radial('ea-sun', [
      [0, mix(p.text, '#ffffff', 0.7)],
      [0.7, mix(p.text, gold, 0.35)],
      [1, gold],
    ]) +
    glow('ea-halo', mix(gold, p.text, 0.35), 0.6) +
    radial('ea-tomb', [
      [0, mix(p.text, '#ffffff', 0.5)],
      [0.5, mix(gold, p.text, 0.4)],
      [1, mix(gold, p.bg, 0.5)],
    ]) +
    glow('ea-spill', mix(gold, p.text, 0.3), 0.5) +
    radial('ea-stone', [
      [0, mix(stone, p.text, 0.3)],
      [0.7, stone],
      [1, mix(stone, p.bg, 0.45)],
    ]) +
    linear('ea-rock', [
      [0, mix(stone, gold, 0.22)],
      [0.5, stone],
      [1, mix(stone, p.bg, 0.5)],
    ]) +
    glow('ea-mist', mix(p.text, p.special, 0.45), 0.2) +
    v.defs
  // The sun, half risen, and its rays: each is a stack of wedges, shorter and shorter, so it fades as it leaves the sun.
  let rays = ''
  const reaches = [170, 250, 340, 440, 560, 700, 860, 1040].filter((_, i) => few(8) === 8 || i % 2 === 1)
  for (let i = 0; i < 9; i += 1) {
    const a = Math.PI * (1.08 + (i / 8) * 0.84)
    const half = 0.03 + (i % 2) * 0.016
    const tip = (len: number, da: number): [number, number] => [sx + Math.cos(a + da) * len, sy + Math.sin(a + da) * len]
    for (const len of reaches) rays += polygon([[sx, sy], tip(len, -half), tip(len, half)], alpha(mix(gold, p.text, 0.4), reaches.length === 8 ? 0.034 : 0.07))
  }
  const sun = circle(sx, sy, 560, paint('ea-halo'), { class: 'ea-halo' }) + group(rays, { class: 'ea-rays' }) + circle(sx, sy, 86, paint('ea-sun'))
  const clouds =
    group(cloud(250, 214, 400, mix(p.special, p.bg, 0.35), 0.34), { class: 'ea-cl', style: 'animation-duration:240s;animation-delay:-70s' }) +
    group(cloud(1300, 150, 340, mix(p.special, p.bg, 0.45), 0.32), { class: 'ea-cl', style: 'animation-duration:290s;animation-delay:-160s' }) +
    group(cloud(1210, 318, 300, mix(p.warn, p.special, 0.45), 0.34), { class: 'ea-cl', style: 'animation-duration:210s;animation-delay:-120s' }) +
    group(cloud(450, 404, 320, mix(p.warn, p.special, 0.5), 0.36), { class: 'ea-cl', style: 'animation-duration:260s;animation-delay:-30s' })
  // Far: two lines of hills in the haze, and the hill of the three crosses against the light.
  const haze = ridge(31, 620, 130, 760, { rough: 2 })
  const hills = ridge(32, 668, 110, 520)
  const hillTone = mix(mix(p.bg, p.special, 0.26), '#000000', 0.12)
  const calvary = 'M800 680C900 600 960 468 1044 462C1126 468 1200 590 1330 680z'
  const cross = (x: number, base: number, h: number): string => `M${n(x - 2)} ${n(base)}v${n(-h)}h4v${n(h)}zM${n(x - h * 0.3)} ${n(base - h * 0.72)}h${n(h * 0.6)}v4h${n(-h * 0.6)}z`
  const crosses = path(cross(1044, 466, 50) + cross(996, 478, 34) + cross(1092, 478, 34), { fill: mix(p.bg, '#000000', 0.5) })
  // Middle: rolling ground, the rock with the tomb cut into it, the stone rolled aside, an olive tree and cypresses.
  const land = ridge(34, 738, 60, 700, { rough: 2 })
  const landTone = mix(mix(p.bg, p.ok, 0.16), '#000000', 0.3)
  const rock = 'M112 790Q128 700 150 668Q176 574 268 548Q352 500 452 524Q560 532 606 612Q646 700 672 790z'
  const rockLight = path('M268 548Q352 500 452 524Q560 532 606 612Q646 700 672 790', { fill: 'none', stroke: alpha(mix(gold, p.text, 0.3), 0.6), 'stroke-width': 3.5, 'stroke-linejoin': 'round' })
  const cracks = path('M210 600l18 34l-10 40M520 566l-14 40l12 30M300 560l8 26M580 660l-16 30l6 36M176 700l22 18', { fill: 'none', stroke: alpha(mix(p.bg, '#000000', 0.4), 0.55), 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
  const door = 'M318 790V690a46 46 0 0 1 92 0V790z'
  const tomb =
    ellipse(364, 800, 210, 30, paint('ea-spill'), { class: 'ea-glow' }) +
    path('M306 790V690a58 58 0 0 1 116 0V790z', { fill: mix(stone, p.bg, 0.5) }) +
    path(door, { fill: mix(p.bg, '#000000', 0.5) }) +
    path(door, { fill: paint('ea-tomb'), opacity: 0.86, class: 'ea-glow' }) +
    path('M330 790V700a34 34 0 0 1 68 0', { fill: 'none', stroke: alpha(mix(p.text, '#ffffff', 0.5), 0.5), 'stroke-width': 2 }) +
    path('M300 792H560', { fill: 'none', stroke: alpha(mix(p.bg, '#000000', 0.5), 0.6), 'stroke-width': 5, 'stroke-linecap': 'round' })
  const rolled =
    ellipse(494, 792, 70, 9, alpha(mix(p.bg, '#000000', 0.6), 0.5)) +
    circle(494, 726, 64, paint('ea-stone')) +
    path('M494 662a64 64 0 0 1 60 86', { fill: 'none', stroke: alpha(mix(gold, p.text, 0.3), 0.65), 'stroke-width': 3, 'stroke-linecap': 'round' }) +
    path('M462 700q20 -18 46 -8M470 752q26 12 50 -6M516 716l10 14', { fill: 'none', stroke: alpha(mix(p.bg, '#000000', 0.3), 0.4), 'stroke-width': 2.2, 'stroke-linecap': 'round' })
  // An olive: a bent trunk and a soft crown of leaf.
  const olive = (x: number, base: number, k: number): string => {
    const dark = mix(leaf, '#000000', 0.15)
    let crown = ''
    for (const [dx, dy, rx, ry] of [[-34, -128, 46, 30], [22, -142, 52, 32], [-4, -164, 44, 28], [50, -116, 36, 24], [-58, -108, 30, 20]] as const) crown += ellipse(x + dx * k, base + dy * k, rx * k, ry * k, dark)
    for (const [dx, dy, rx, ry] of [[30, -150, 30, 12], [-22, -138, 26, 10], [4, -172, 24, 9]] as const) crown += ellipse(x + dx * k, base + dy * k, rx * k, ry * k, alpha(mix(p.ok, gold, 0.35), 0.3))
    return path(`M${n(x - 9 * k)} ${n(base)}C${n(x - 4 * k)} ${n(base - 50 * k)} ${n(x - 22 * k)} ${n(base - 70 * k)} ${n(x - 6 * k)} ${n(base - 120 * k)}M${n(x + 2 * k)} ${n(base - 70 * k)}C${n(x + 12 * k)} ${n(base - 96 * k)} ${n(x + 26 * k)} ${n(base - 102 * k)} ${n(x + 30 * k)} ${n(base - 128 * k)}`, { fill: 'none', stroke: mix(p.bg, '#000000', 0.5), 'stroke-width': 12 * k, 'stroke-linecap': 'round' }) + group(crown, { class: 'bend', style: 'animation-duration:11s' })
  }
  const trees = path(cypressD(690, land.y(690) + 6, 150, 21) + cypressD(742, land.y(742) + 6, 112, 17) + cypressD(1452, land.y(1452) + 6, 190, 25) + cypressD(1506, land.y(1506) + 6, 140, 20) + cypressD(880, land.y(880) + 6, 96, 15), { fill: mix(leaf, '#000000', 0.3) })
  const way = path('M364 792C420 812 640 800 700 838C760 876 820 884 900 900H560C600 870 520 836 318 792z', { fill: alpha(mix(gold, p.text, 0.3), 0.16) })
  // Near: the garden. Its ground rises at the right, where Bolt stands; lilies grow along it between two tall cypresses.
  const lawn = ridge(35, 846, 40, 900, { rough: 2 })
  const groundY = (x: number): number => lawn.y(x) - 150 * Math.exp(-(((x - 1300) / 210) ** 2))
  let crest = ''
  for (let x = -BLEED; x <= WIDTH + BLEED; x += coarse(20)) crest += `${crest === '' ? 'M' : 'L'}${n(x)} ${n(groundY(x))}`
  const ground = `${crest}L${WIDTH + BLEED} ${HEIGHT}L${-BLEED} ${HEIGHT}z`
  const soil = mix(mix(p.bg, p.ok, 0.12), '#000000', 0.36)
  const lily = (x: number, i: number): string => {
    const base = groundY(x) + 6
    const h = 54 + r() * 46
    const lean = (r() - 0.5) * 26
    const turn = (r() - 0.5) * 70
    const k = 0.85 + r() * 0.5
    const [tx, ty] = [x + lean, base - h]
    const stem = mix(p.ok, p.bg, 0.45)
    const flower =
      path('M0 2C-5 -8 -15 -16 -24 -27C-13 -25 -6 -25 0 -34C6 -25 13 -25 24 -27C15 -16 5 -8 0 2z', { fill: p.text }) +
      path('M0 2C-5 -8 -15 -16 -24 -27C-14 -20 -6 -14 0 -6z', { fill: mix(p.text, p.special, 0.3) }) +
      path('M0 -6l-6 -13M0 -6l0 -16M0 -6l6 -13', { fill: 'none', stroke: mix(gold, p.warn, 0.4), 'stroke-width': 1.6, 'stroke-linecap': 'round' }) +
      circle(-6, -20, 2, gold) +
      circle(0, -23, 2, gold) +
      circle(6, -20, 2, gold)
    return group(
      path(`M${n(x)} ${n(base)}Q${n(x - lean * 0.4)} ${n(base - h * 0.55)} ${n(tx)} ${n(ty)}`, { fill: 'none', stroke: stem, 'stroke-width': 3, 'stroke-linecap': 'round' }) +
        path(`M${n(x)} ${n(base - h * 0.3)}q-18 -8 -24 -26q18 4 24 26zM${n(x + lean * 0.2)} ${n(base - h * 0.5)}q16 -6 20 -24q-16 6 -20 24z`, { fill: stem }) +
        group(flower, { transform: `translate(${n(tx)} ${n(ty)}) rotate(${n(turn)}) scale(${n(k)})` }),
      { class: 'bend', style: `animation-delay:${n(-i * 0.9)}s` },
    )
  }
  let lilies = ''
  const beds = Math.max(8, few(17))
  for (let i = 0; i < beds; i += 1) {
    // Kept off the rise where Bolt stands.
    const x = i % 4 === 3 ? 1420 + r() * 150 : 70 + ((i + r() * 0.7) / beds) * 1060
    lilies += lily(x, i)
  }
  let blades = ''
  for (let x = -BLEED; x < WIDTH + BLEED; x += coarse(23)) {
    const at = x + r() * 14
    blades += `M${n(at)} ${n(groundY(at) + 4)}l${n(-4 - r() * 4)} ${n(-12 - r() * 12)}l${n(7 + r() * 3)} ${n(10 + r() * 8)}z`
  }
  const framing = path(cypressD(34, 900, 470, 62) + cypressD(1566, groundY(1566) + 40, 430, 58) + cypressD(1484, groundY(1484) + 20, 250, 34), { fill: mix(soil, '#000000', 0.35) })
  const birds = drift(36, 5, 'ea-bird', 80, (x, y, k, pick) => group(path('M-13 0q6 -9 13 0q7 -9 13 0', { fill: 'none', stroke: mix(p.bg, '#000000', 0.2), 'stroke-width': 2.4, 'stroke-linecap': 'round', transform: `translate(${n(x)} ${n(90 + y * 0.36)}) scale(${n(0.8 + pick() * 0.9)})` }), { class: 'flap' }))
  const motes = drift(37, 28, 'ea-mote', 95, (x, y, k, pick) => circle(x, y, 1.2 + pick() * 1.8, alpha(k % 3 === 0 ? p.text : k % 3 === 1 ? gold : p.special, 0.5)))
  const mist =
    ellipse(360, 742, 560, 44, paint('ea-mist'), { class: 'ea-mist' }) + ellipse(1180, 728, 520, 40, paint('ea-mist'), { class: 'ea-mist', style: 'animation-duration:57s' }) + ellipse(780, 800, 700, 46, paint('ea-mist'), { opacity: 0.8, class: 'ea-mist', style: 'animation-duration:66s' })
  return {
    alt: 'Easter morning: dawn gold rising behind violet hills, three small crosses on a far hill, a rock tomb with its round stone rolled aside and soft light within, and a garden of white lilies between tall cypresses.',
    bolt: { x: 1240, y: 566 },
    defs,
    style:
      PARALLAX +
      CROSS +
      anim('ea-cl', 'cross') +
      anim('ea-bird', 'cross') +
      FLAP +
      RISE +
      anim('ea-mote', 'rise') +
      BEND +
      SWAY +
      '.ea-mist{animation:sway 48s ease-in-out infinite}' +
      pulse('tw', 0.15, 0.8, 6) +
      pulse('ea-halo', 0.8, 1, 10) +
      pulse('ea-glow', 0.72, 1, 7) +
      `@keyframes ea-rays{0%,100%{transform:rotate(-2.5deg)}50%{transform:rotate(2.5deg)}}.ea-rays{transform-origin:${sx}px ${sy}px;animation:ea-rays 38s ease-in-out infinite}`,
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('ea-sky')) +
      stars(38, 44, 240, p.text) +
      sun +
      clouds +
      layer('far', path(haze.d, { fill: mix(mix(p.bg, p.special, 0.4), p.warn, 0.12) }) + path(calvary, { fill: hillTone }) + crosses + path(hills.d, { fill: mix(hillTone, '#000000', 0.14) })) +
      layer('mid', path(land.d, { fill: landTone }) + trees + olive(210, 796, 1.15) + path(rock, { fill: paint('ea-rock') }) + cracks + rockLight + tomb + rolled + way + olive(1010, land.y(1010) + 8, 0.8)) +
      mist +
      layer('near', path(ground, { fill: soil }) + path(crest, { fill: 'none', stroke: alpha(mix(gold, p.special, 0.5), 0.26), 'stroke-width': 2.4 }) + path(blades, { fill: mix(leaf, '#000000', 0.1) }) + framing + lilies + BOLT_HERE) +
      birds +
      motes +
      v.body,
  }
}

/** The night of Eid al-Fitr: a thin crescent over domes and minarets, strings of lanterns, a lit gateway with one great lantern. */
const eid: Make = ({ palette: p }) => {
  const r = rnd(57)
  const v = vignette('ei-vig', mix(p.bg, '#000000', 0.85), 0.68)
  const gold = p.accent
  const brass = mix(gold, p.bg, 0.55)
  const night = mix(p.bg, '#000000', 0.58)
  const tints = [p.warn, gold, p.special, p.info, p.error]
  const defs =
    linear('ei-sky', [
      [0, mix(p.bg, '#000000', 0.6)],
      [0.4, p.bg],
      [0.64, mix(p.bg, p.info, 0.26)],
      [0.78, mix(mix(p.bg, p.info, 0.3), gold, 0.24)],
      [1, mix(p.bg, gold, 0.16)],
    ]) +
    linear('ei-moon', [
      [0, mix(p.text, '#ffffff', 0.6)],
      [1, mix(p.text, gold, 0.4)],
    ]) +
    glow('ei-halo', mix(p.text, gold, 0.4), 0.34) +
    glow('ei-lamp', mix(p.warn, gold, 0.5), 0.6) +
    tints.map((c, i) => glow(`ei-g${i}`, c, 0.5)).join('') +
    linear('ei-pane', [
      [0, mix(p.text, gold, 0.4)],
      [1, mix(p.warn, gold, 0.4)],
    ]) +
    linear('ei-arch', [
      [0, mix(gold, p.text, 0.3)],
      [1, p.warn],
    ]) +
    pattern('ei-lattice', 30, 30, path('M15 0L30 15L15 30L0 15z', { fill: 'none', stroke: gold, 'stroke-width': 1.3 }) + circle(15, 15, 5.5, 'none', { stroke: gold, 'stroke-width': 1.1 }) + circle(0, 0, 3, gold) + circle(30, 0, 3, gold) + circle(0, 30, 3, gold) + circle(30, 30, 3, gold)) +
    v.defs
  // The crescent: one circle with another taken out of it, alone in the sky.
  const [mx, my] = [1012, 330]
  const moon =
    circle(mx, my, 330, paint('ei-halo'), { class: 'ei-halo' }) + path(`M${n(mx + 36.5)} ${n(my - 64.4)}A74 74 0 1 0 ${n(mx + 36.5)} ${n(my + 64.4)}A66 66 0 1 1 ${n(mx + 36.5)} ${n(my - 64.4)}z`, { fill: paint('ei-moon'), transform: `rotate(-28 ${mx} ${my})` })
  // Domes and minarets as path pieces.
  const dome = (x: number, base: number, w: number, h: number): string =>
    `M${n(x - w / 2)} ${n(base)}C${n(x - w * 0.62)} ${n(base - h * 0.62)} ${n(x - w * 0.16)} ${n(base - h * 0.8)} ${n(x)} ${n(base - h)}C${n(x + w * 0.16)} ${n(base - h * 0.8)} ${n(x + w * 0.62)} ${n(base - h * 0.62)} ${n(x + w / 2)} ${n(base)}zM${n(x - 1.5)} ${n(base - h + 4)}v${n(-h * 0.16 - 8)}h3v${n(h * 0.16 + 8)}z`
  const minaret = (x: number, base: number, h: number, w: number): string =>
    `M${n(x - w / 2)} ${n(base)}V${n(base - h * 0.7)}h${n(w)}V${n(base)}z` +
    `M${n(x - w * 0.85)} ${n(base - h * 0.7)}h${n(w * 1.7)}v${n(-w * 0.34)}h${n(-w * 1.7)}z` +
    `M${n(x - w * 0.36)} ${n(base - h * 0.7)}V${n(base - h * 0.9)}h${n(w * 0.72)}V${n(base - h * 0.7)}z` +
    `M${n(x - w * 0.6)} ${n(base - h * 0.9)}h${n(w * 1.2)}v${n(-w * 0.26)}h${n(-w * 1.2)}z` +
    `M${n(x - w * 0.42)} ${n(base - h * 0.9 - w * 0.26)}L${n(x)} ${n(base - h)}L${n(x + w * 0.42)} ${n(base - h * 0.9 - w * 0.26)}z` +
    `M${n(x - 1.2)} ${n(base - h)}v${n(-w * 0.7)}h2.4v${n(w * 0.7)}z`
  // A window with a pointed head.
  const light = (x: number, y: number, w: number, h: number): string => `M${n(x)} ${n(y + h)}V${n(y + h * 0.4)}Q${n(x)} ${n(y + h * 0.1)} ${n(x + w / 2)} ${n(y)}Q${n(x + w)} ${n(y + h * 0.1)} ${n(x + w)} ${n(y + h * 0.4)}V${n(y + h)}z`
  // Far: the old town along the horizon, small and hazy.
  let town = ''
  let townLit = ''
  for (let x = -BLEED; x < WIDTH + BLEED; ) {
    const w = 36 + r() * 70
    const h = 26 + r() * 62
    town += `M${n(x)} 700V${n(672 - h)}h${n(w)}V700z`
    const kind = r()
    if (kind < 0.2) town += dome(x + w / 2, 672 - h, w * 0.7, w * 0.5)
    else if (kind < 0.36) town += minaret(x + w / 2, 672 - h, 70 + r() * 70, 9)
    if (r() < 0.6) townLit += light(x + 6 + r() * (w - 18), 678 - h + r() * (h - 16), 5, 9)
    x += w + r() * 8
  }
  // Middle: the mosque. A great dome between two lesser, four minarets, an arcade of lit arches; houses and palms either side.
  const dusk = mix(p.bg, '#000000', 0.42)
  const hall =
    'M330 740V592h500V740z' +
    'M420 592V528h320V592z' +
    dome(580, 528, 250, 176) +
    dome(380, 592, 104, 74) +
    dome(780, 592, 104, 74) +
    minaret(300, 740, 372, 26) +
    minaret(860, 740, 372, 26) +
    minaret(232, 740, 264, 20) +
    minaret(928, 740, 264, 20)
  let arches = ''
  let archGlow = ''
  for (let i = 0; i < 7; i += 1) {
    const x = 352 + i * 66
    arches += light(x, 640, 40, 100)
    archGlow += ellipse(x + 20, 700, 46, 70, paint('ei-lamp'), { opacity: 0.5 })
  }
  let upperLit = ''
  for (let i = 0; i < 5; i += 1) upperLit += light(446 + i * 60, 546, 22, 34)
  const rim = path('M455 528C424 424 540 388 580 352', { fill: 'none', stroke: alpha(mix(p.text, p.info, 0.4), 0.5), 'stroke-width': 3, 'stroke-linecap': 'round' }) + path('M328 592C318 550 364 532 380 518M287 478V380M847 478V380', { fill: 'none', stroke: alpha(mix(p.text, p.info, 0.4), 0.38), 'stroke-width': 2.4, 'stroke-linecap': 'round' })
  let houses = ''
  let houseLit = ''
  for (const [x, w, h] of [[-60, 150, 130], [84, 120, 96], [1000, 130, 110], [1120, 160, 150], [1290, 120, 104], [1420, 180, 136], [1590, 120, 100]] as const) {
    houses += `M${x} 760V${740 - h}h${w}V760zM${x + 8} ${740 - h}v-10h${w - 16}v10z`
    for (let k = 0; k < 3; k += 1) if (r() < 0.75) houseLit += light(x + 16 + k * ((w - 44) / 2), 740 - h + 24 + (k % 2) * 30, 12, 20)
  }
  const palm = (x: number, base: number, h: number, i: number): string => {
    let fronds = ''
    for (const [dx, dy] of [[-64, -6], [-52, -38], [-22, -56], [18, -56], [50, -36], [62, -4], [-36, 16], [38, 18]] as const) fronds += `M${n(x + h * 0.08)} ${n(base - h)}Q${n(x + h * 0.08 + dx * 0.5)} ${n(base - h + dy - 14)} ${n(x + h * 0.08 + dx)} ${n(base - h + dy + 12)}`
    return (
      path(`M${n(x)} ${n(base)}Q${n(x - h * 0.06)} ${n(base - h * 0.5)} ${n(x + h * 0.08)} ${n(base - h)}`, { fill: 'none', stroke: dusk, 'stroke-width': 9, 'stroke-linecap': 'round' }) +
      group(path(fronds, { fill: 'none', stroke: mix(dusk, p.ok, 0.16), 'stroke-width': 6, 'stroke-linecap': 'round' }), { class: 'bend', style: `animation-duration:${n(9 + i * 2)}s` })
    )
  }
  const quarter =
    path(houses + `M${-BLEED} 900V752H${WIDTH + BLEED}V900z`, { fill: dusk }) + path(houseLit, { fill: mix(p.warn, gold, 0.4), opacity: 0.9 }) + path(hall, { fill: mix(dusk, '#000000', 0.12) }) + rim + archGlow + path(arches, { fill: paint('ei-arch'), opacity: 0.92, class: 'ei-warm' }) + path(upperLit, { fill: mix(gold, p.text, 0.3), opacity: 0.85 }) + palm(150, 752, 170, 0) + palm(1010, 752, 150, 1) + palm(1076, 752, 108, 2)
  // Strings of lanterns across the top, each lantern swaying on its cord.
  const strings: [number, number, number, number, number, number][] = [
    [-40, 66, 330, 250, 700, 52],
    [560, 34, 870, 214, 1160, 150],
  ]
  let cords = ''
  let hung = ''
  strings.forEach(([x0, y0, x1, y1, x2, y2], s) => {
    cords += `M${x0} ${y0}Q${x1} ${y1} ${x2} ${y2}`
    const count = Math.max(4, few(s === 0 ? 7 : 6))
    for (let i = 0; i < count; i += 1) {
      const t = (i + 0.7) / (count + 0.4)
      const x = (1 - t) ** 2 * x0 + 2 * t * (1 - t) * x1 + t ** 2 * x2
      const y = (1 - t) ** 2 * y0 + 2 * t * (1 - t) * y1 + t ** 2 * y2
      const c = (i + s * 2) % tints.length
      const size = 0.9 + ((i * 7 + s * 3) % 4) * 0.12
      hung += group(
        circle(x, y + 34 * size, 44, paint(`ei-g${c}`), { opacity: 0.8 }) +
          path(`M${n(x)} ${n(y)}v${n(12 * size)}`, { fill: 'none', stroke: brass, 'stroke-width': 1.6 }) +
          path(`M${n(x - 7 * size)} ${n(y + 16 * size)}l${n(7 * size)} ${n(-6 * size)}l${n(7 * size)} ${n(6 * size)}zM${n(x - 6 * size)} ${n(y + 50 * size)}h${n(12 * size)}l${n(-6 * size)} ${n(8 * size)}z`, { fill: brass }) +
          path(`M${n(x - 9 * size)} ${n(y + 16 * size)}h${n(18 * size)}l${n(3 * size)} ${n(12 * size)}v${n(12 * size)}l${n(-3 * size)} ${n(10 * size)}h${n(-18 * size)}l${n(-3 * size)} ${n(-10 * size)}v${n(-12 * size)}z`, { fill: mix(tints[c]!, p.text, 0.25) }) +
          path(`M${n(x - 3.4 * size)} ${n(y + 17 * size)}v${n(32 * size)}M${n(x + 3.4 * size)} ${n(y + 17 * size)}v${n(32 * size)}`, { fill: 'none', stroke: alpha(brass, 0.8), 'stroke-width': 1.3 }),
        { class: 'ei-hang', style: `animation-delay:${n(-(i * 1.3 + s * 2.1))}s` },
      )
    }
  })
  const garland = path(cords, { fill: 'none', stroke: alpha(brass, 0.9), 'stroke-width': 2 }) + hung
  // Near: a garden wall along the foot, and at the right a terrace under a pointed gateway, its great lantern over Bolt, a palm in a pot.
  let wallD = `M${-BLEED} 900V836H1100V900z`
  for (let x = -BLEED; x < 1090; x += coarse(44)) wallD += `M${n(x)} 836v-16q11 -12 22 0v16z`
  // Three small lamps stand on the wall.
  const posts = [196, 520, 846]
    .map((x, i) => circle(x, 794, 70, paint(`ei-g${i}`), { opacity: 0.7, class: 'ei-warm' }) + path(`M${x - 8} 820h16l-2 -8h-12zM${x - 6} 780l6 -8l6 8z`, { fill: brass }) + rect(x - 7, 780, 14, 32, mix(tints[i]!, p.text, 0.3), { rx: 2 }) + path(`M${x} 780v32`, { fill: 'none', stroke: alpha(brass, 0.8), 'stroke-width': 1.4 }))
    .join('')
  const wallTop = path(`M${-BLEED} 836H1100`, { fill: 'none', stroke: alpha(gold, 0.2), 'stroke-width': 2 })
  const gate = 'M1150 900V120H1700V900H1560V430Q1560 292 1378 232Q1196 292 1196 430V900z'
  const gateway =
    path(gate, { fill: night }) +
    path(gate, { fill: paint('ei-lattice'), opacity: 0.2 }) +
    path('M1196 900V430Q1196 292 1378 232Q1560 292 1560 430V900', { fill: 'none', stroke: alpha(gold, 0.5), 'stroke-width': 4, 'stroke-linejoin': 'round' }) +
    path('M1176 900V424Q1178 272 1378 208Q1578 272 1580 424V900', { fill: 'none', stroke: alpha(gold, 0.22), 'stroke-width': 2 }) +
    rect(1140, 420, 66, 16, brass, { rx: 3 }) +
    rect(1550, 420, 66, 16, brass, { rx: 3 }) +
    rect(1130, 104, 600, 20, mix(night, gold, 0.2))
  const terrace =
    rect(1196, 636, 364, 54, night) +
    rect(1196, 636, 364, 54, paint('ei-lattice'), { opacity: 0.5 }) +
    rect(1190, 628, 376, 9, brass, { rx: 3 }) +
    path('M1070 900V738h40v-24h40v-24H1700V900z', { fill: mix(night, '#000000', 0.18) }) +
    path('M1150 690H1700', { fill: 'none', stroke: alpha(gold, 0.35), 'stroke-width': 3 }) +
    ellipse(1378, 698, 220, 16, paint('ei-lamp'), { opacity: 0.5, class: 'ei-warm' })
  const [lx, ly] = [1420, 312]
  const lantern =
    path(`M1378 232Q1400 262 ${lx} ${ly - 30}V${ly}`, { fill: 'none', stroke: brass, 'stroke-width': 2.4 }) +
    group(
      circle(lx, ly + 62, 190, paint('ei-lamp'), { opacity: 0.9, class: 'ei-warm' }) +
        path(`M${lx - 12} ${ly + 8}l12 -12l12 12zM${lx - 22} ${ly + 22}l8 -14h28l8 14zM${lx - 14} ${ly + 122}h28l-14 20z`, { fill: brass }) +
        path(`M${lx - 26} ${ly + 22}h52l8 26v44l-8 30h-52l-8 -30v-44z`, { fill: paint('ei-pane') }) +
        path(`M${lx - 26} ${ly + 22}h52l8 26v44l-8 30h-52l-8 -30v-44zM${lx - 9} ${ly + 22}v100M${lx + 9} ${ly + 22}v100M${lx - 34} ${ly + 48}h68M${lx - 34} ${ly + 92}h68`, { fill: 'none', stroke: brass, 'stroke-width': 3, 'stroke-linejoin': 'round' }),
      { class: 'ei-swing' },
    )
  let potFronds = ''
  for (const [dx, dy] of [[-78, -30], [-60, -82], [-22, -112], [22, -110], [58, -78], [74, -26]] as const) potFronds += `M1502 640Q${1502 + dx * 0.4} ${640 + dy - 20} ${1502 + dx} ${640 + dy + 22}`
  const pot =
    group(path(potFronds, { fill: 'none', stroke: mix(mix(p.ok, p.bg, 0.55), '#000000', 0.2), 'stroke-width': 7, 'stroke-linecap': 'round' }) + path(potFronds, { fill: 'none', stroke: alpha(mix(p.ok, gold, 0.3), 0.4), 'stroke-width': 1.6, 'stroke-linecap': 'round' }), { class: 'bend', style: 'animation-duration:10s' }) +
    path('M1476 690l6 -48h40l6 48z', { fill: brass }) +
    rect(1478, 640, 48, 8, mix(gold, p.bg, 0.3), { rx: 2 })
  const lights = drift(58, 24, 'ei-light', 110, (x, y, k, pick) => circle(x, y, 1.4 + pick() * 1.9, alpha(k % 2 === 0 ? p.warn : gold, 0.55)))
  return {
    alt: 'The night of Eid al-Fitr: a thin crescent moon over a skyline of domes and minarets with warm lit arches, strings of coloured lanterns across a teal sky, and a pointed gateway with one great lantern over a terrace and a potted palm.',
    bolt: { x: 1236, y: 570 },
    defs,
    style:
      PARALLAX +
      RISE +
      anim('ei-light', 'rise') +
      BEND +
      pulse('tw', 0.2, 1, 5) +
      pulse('ei-halo', 0.78, 1, 9) +
      pulse('ei-warm', 0.74, 1, 6) +
      '@keyframes ei-hang{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}.ei-hang{transform-box:fill-box;transform-origin:center top;animation:ei-hang 6s ease-in-out infinite}' +
      `@keyframes ei-swing{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}.ei-swing{transform-origin:${lx}px ${ly - 30}px;animation:ei-swing 8s ease-in-out infinite}`,
    body:
      rect(0, 0, WIDTH, HEIGHT, paint('ei-sky')) +
      stars(59, 130, 600, p.text) +
      moon +
      layer('far', path(town, { fill: mix(p.bg, p.info, 0.2) }) + path(townLit, { fill: mix(p.warn, gold, 0.5), opacity: 0.8 }) + rect(-BLEED, 698, WIDTH + 2 * BLEED, 80, mix(p.bg, p.info, 0.2))) +
      layer('mid', quarter) +
      layer('near', path(wallD, { fill: mix(night, p.info, 0.05), stroke: alpha(gold, 0.3), 'stroke-width': 1.6 }) + wallTop + posts + gateway + terrace + pot + lantern + BOLT_HERE + garland) +
      lights +
      v.body,
  }
}

export const HOLIDAY_SCENES: Record<string, Make> = { easter, eid }
