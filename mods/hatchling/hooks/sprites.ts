// All of hatchling's art, as data. Nothing here runs: art.ts turns it into
// pixels. Every species is an original design.
//
// A sprite is a list of rows, one letter per pixel. The renderer packs two
// pixel rows into one text row with half-block characters, so a sprite 10
// pixels tall is 5 rows on screen.
//
//   .  transparent         o  outline          a  body
//   b  body shade          c  light / belly    d  f g  accents
//   w  white               E  eye (upper)      e  eye (lower)
//   m  mouth               h  cheek
//
// E, e, m and h change with the mood (art.ts): open eyes are E+e, closed eyes
// keep only e, happy eyes keep only E; the mouth and cheeks show when happy.

import type { HatchlingMood, HatchlingRarity, HatchlingSpecies, HatchlingStage } from '../types'

export type Palette = Readonly<Record<string, string>>

export type SpeciesArt = {
  id: HatchlingSpecies
  name: string
  rarity: HatchlingRarity
  /** One line for the card. */
  blurb: string
  /** Letter the closed eye and hidden mouth fall back to. */
  face: string
  palette: Palette
  shiny: Palette
  /** Colour of the name in the band. */
  accent: string
  shinyAccent: string
  baby: readonly string[]
  teen: readonly string[]
  adult: readonly string[]
}

/** Canvas per stage, in pixels: room for a jump above the body. */
export const CANVAS: Readonly<Record<HatchlingStage, { w: number; h: number }>> = {
  egg: { w: 10, h: 10 },
  baby: { w: 10, h: 10 },
  teen: { w: 12, h: 10 },
  adult: { w: 16, h: 12 },
}

/** Colours shared by every species: eyes, mouth, effects. */
export const FX = {
  eye: '#1d1a2b',
  mouth: '#c8405c',
  cheek: '#ff8fab',
  sweat: '#7fd3ff',
  zzz: '#aab4d8',
  flash: '#ffffff',
  confetti: ['#ffd166', '#ff6fae', '#5ee0d0', '#9b8cff'],
} as const

export const RARITY_COLOR: Readonly<Record<HatchlingRarity, string>> = {
  common: '#9aa3b5',
  uncommon: '#5fcf80',
  rare: '#5aa9ff',
  legendary: '#ffc93c',
}

// ---------------------------------------------------------------- the egg

export const EGG = {
  palette: {
    o: '#6f6a5a',
    a: '#f4ecd6',
    b: '#d8c9a2',
    c: '#ffffff',
    d: '#6cc4b0',
    f: '#e88fb4',
  } as Palette,
  body: [
    '...oo...',
    '..oaco..',
    '.oacaao.',
    '.oaaabo.',
    'oadaaabo',
    'oaaadabo',
    'oafaaabo',
    'oaaaabbo',
    '.oaabbo.',
    '..oooo..',
  ],
  /** Cracks drawn in outline colour as the egg nears 25 calls: [x, y]. */
  cracks: [
    [[4, 3], [3, 4]],
    [[4, 3], [3, 4], [4, 5], [5, 4], [6, 5]],
  ] as readonly (readonly (readonly [number, number])[])[],
}

// ---------------------------------------------------------------- species

export const SPECIES: readonly SpeciesArt[] = [
  {
    id: 'pebblet',
    name: 'Pebblet',
    rarity: 'common',
    blurb: 'A river stone that grew moss and opinions.',
    face: 'a',
    accent: '#8fd17f',
    shinyAccent: '#e8c27a',
    palette: { o: '#3d4352', a: '#9aa3b4', b: '#737c90', c: '#c9d0db', d: '#63b35a', f: '#3f7f3a', g: '#f59bbd', w: '#fff6c9' },
    shiny: { o: '#5b4526', a: '#ddb873', b: '#b48a4a', c: '#f4dfab', d: '#73cfc3', f: '#3f948a', g: '#ffffff', w: '#ffe066' },
    baby: [
      '..ddfd..',
      '.dddddd.',
      'oaEaaEbo',
      'oheaaeho',
      'ocammabo',
      '.obbbbo.',
      '.oo..oo.',
    ],
    teen: [
      '....g.....',
      '..ddfdd...',
      '.dddddddd.',
      'oaaEaaEabo',
      'oaheaaehbo',
      'ocaammaabo',
      '.obbbbbbo.',
      '..oo..oo..',
    ],
    adult: [
      '......gwg.....',
      '....dd.f......',
      '..dddddfdddd..',
      '.dddddddddddd.',
      'oddcaaaaaaddbo',
      'oacaEaaaaEaabo',
      'oaaheaaaaehabo',
      'oaaaaammaaaabo',
      '.obbbbbbbbbbo.',
      '..ooo....ooo..',
    ],
  },
  {
    id: 'fluffle',
    name: 'Fluffle',
    rarity: 'common',
    blurb: 'Mostly fluff. The rest is also fluff.',
    face: 'd',
    accent: '#c6b1f2',
    shinyAccent: '#8fe3c6',
    palette: { a: '#b9a3e3', b: '#9480c4', c: '#e9e0ff', d: '#f7ead0', f: '#ff9fc2' },
    shiny: { a: '#9fe3c9', b: '#6fbf9f', c: '#e2fbf0', d: '#fff4d9', f: '#ffb0c4' },
    baby: [
      '..cccc..',
      '.aaaaaa.',
      'baEddEab',
      'bheddehb',
      'bfdmmdfb',
      '.aaaaaa.',
      '..b..b..',
    ],
    teen: [
      '...cccc...',
      '.baaccaab.',
      'bfaaaaaafb',
      'bfaEddEafb',
      'bfheddehfb',
      '.badmmdab.',
      '..aaaaaa..',
      '..bb..bb..',
    ],
    adult: [
      '.....cccc.....',
      '...aaaccaaa...',
      '..baaaaaaaab..',
      '.bfaaEddEaafb.',
      '.bfaheddehafb.',
      '.bfaadmmdaafb.',
      '.bfcaaaaaacfb.',
      '.bfaaaaaaaafb.',
      '.bb.aaaaaa.bb.',
      '....bb..bb....',
    ],
  },
  {
    id: 'coilsnail',
    name: 'Coilsnail',
    rarity: 'common',
    blurb: 'Carries a spool of thread it never unwinds.',
    face: 'a',
    accent: '#5cc8b9',
    shinyAccent: '#f19ac0',
    palette: { o: '#22535b', a: '#56bfb1', b: '#3a8f84', c: '#9ee8dc', d: '#f6dcae', f: '#d4864a', g: '#9c5426' },
    shiny: { o: '#6b2f4b', a: '#ee9bbd', b: '#c9729a', c: '#ffd3e6', d: '#e9ecf7', f: '#8d96c9', g: '#555e99' },
    baby: [
      'E.E.....',
      'e.e..ff.',
      'aaa.fddf',
      'aaaafdgf',
      'ahmafddf',
      'aaaaaff.',
      'bbbbbbbb',
    ],
    teen: [
      '.E.E......',
      '.e.e..fff.',
      '.a.a.fdddf',
      'aaaa.fdffd',
      'aaaaafdgfd',
      'ahmaafddfd',
      'caaaaaffff',
      'bbbbbbbbbb',
    ],
    adult: [
      '.E..E.........',
      '.e..e...ffff..',
      '.a..a..fddddf.',
      '.aaaa.fddffddf',
      'aaaaaafdfddfdf',
      'aaaaaafdfgfdfd',
      'ahmaaafdffdddf',
      'aaaaaafddddff.',
      'caaaaaaffffbb.',
      'bbbbbbbbbbbbbb',
    ],
  },
  {
    id: 'nimbit',
    name: 'Nimbit',
    rarity: 'uncommon',
    blurb: 'A pocket raincloud. Drizzles when nervous.',
    face: 'a',
    accent: '#9fd2ff',
    shinyAccent: '#ffa8c4',
    palette: { o: '#7f97c4', a: '#f3f7ff', b: '#cfdcf2', c: '#ffffff', d: '#7cc7ff', f: '#a9bbd9' },
    shiny: { o: '#b46a7e', a: '#ffe1d3', b: '#f6b9a6', c: '#fff4ee', d: '#ff8fbd', f: '#e5a2ad' },
    baby: [
      '..ooo...',
      '.occcooo',
      'occaacco',
      'oaEaaEao',
      'oheaaeho',
      'obammabo',
      '.obbbbo.',
      '..f..f..',
    ],
    teen: [
      '..occoooo.',
      '.occaaccco',
      'occaaaaaco',
      'oaaEaaEaao',
      'oaheaaehao',
      'obaammaabo',
      '.obbbbbbo.',
      '..f.d..f..',
    ],
    adult: [
      '.....ooo......',
      '..ooocccoooo..',
      '.occccaaaccco.',
      'occaaaaaaaacco',
      'oaaaaaaaaaaaao',
      'oaaaEaaaaEaaao',
      'oaaheaaaaehaao',
      'obaaaammaaaabo',
      '.obbbbbbbbbbo.',
      '..d.f.d.f..d..',
    ],
  },
  {
    id: 'lampwing',
    name: 'Lampwing',
    rarity: 'uncommon',
    blurb: 'Its belly glows brighter the later you work.',
    face: 'c',
    accent: '#ffd36b',
    shinyAccent: '#8fe9ff',
    palette: { o: '#4a3428', a: '#c99a6b', b: '#93693f', c: '#f2dcb8', d: '#ffd65e', f: '#7a54a6', w: '#fff7d6' },
    shiny: { o: '#26405e', a: '#9cc6ea', b: '#6a95c2', c: '#e8f4ff', d: '#8ff0ff', f: '#e46fb1', w: '#ffffff' },
    baby: [
      '.b....b.',
      '..b..b..',
      'aaccccaa',
      'afEccEfa',
      'abecceba',
      '.bcmmcb.',
      '..cddc..',
    ],
    teen: [
      '.b......b.',
      '..b....b..',
      'aaa.cc.aaa',
      'afaccccafa',
      'afaEccEafa',
      'abaecceaba',
      '.b.cmmc.b.',
      '...cddc...',
    ],
    adult: [
      '...b......b...',
      '....b....b....',
      'aaaa.cccc.aaaa',
      'afwfaccccafwfa',
      'affaaEccEaaffa',
      'abaabeccebaaba',
      '.bab.hmmh.bab.',
      '..bb.cddc.bb..',
      '.....cddc.....',
      '......cc......',
    ],
  },
  {
    id: 'foldling',
    name: 'Foldling',
    rarity: 'rare',
    blurb: 'Folded from a page of someone else\'s notes.',
    face: 'a',
    accent: '#3fb8aa',
    shinyAccent: '#ffd36b',
    palette: { o: '#6a6e7f', a: '#f7f3ea', b: '#d6d0c2', c: '#ffffff', d: '#35a99c', f: '#237a70' },
    shiny: { o: '#7a5a1e', a: '#f6d980', b: '#d9b450', c: '#fff2b8', d: '#d8434f', f: '#9e2632' },
    baby: [
      'd......d',
      'ad....da',
      'aad..daa',
      '.acEEca.',
      '.aaeeaa.',
      '..bmmb..',
      '...bb...',
    ],
    teen: [
      'd........d',
      'ad......da',
      'aad....daa',
      '.aaEccEaa.',
      '.baeaaeab.',
      '..bhmmhb..',
      '...bddb...',
      '....bb....',
    ],
    adult: [
      'd............d',
      'ad..........da',
      'aad........daa',
      'aaad..cc..daaa',
      'aaaadcaacdaaaa',
      '.aaaaEaaEaaaa.',
      '.baaaeaaeaaab.',
      '..bbahmmhabb..',
      '....bdddfb....',
      '.....bddb.....',
    ],
  },
  {
    id: 'geobug',
    name: 'Geobug',
    rarity: 'rare',
    blurb: 'Plain rock outside. Make it grin and the crystals show.',
    face: 'b',
    accent: '#c08cff',
    shinyAccent: '#5fe39a',
    palette: { o: '#241d2c', a: '#5c5066', b: '#433950', c: '#8c7f98', d: '#b57cff', f: '#ead2ff', g: '#7a3fd1', E: '#fdf6ff', m: '#ff9ccf' },
    shiny: { o: '#1d2a24', a: '#566a60', b: '#3d4f46', c: '#8aa397', d: '#4fe08a', f: '#d2ffe0', g: '#1f9e57', E: '#fbfff6', m: '#ffd36b' },
    baby: [
      '.c....c.',
      '..c..c..',
      '.acddca.',
      'acdfgdca',
      'abEbbEba',
      'ahebbeha',
      '.abmmba.',
      '.c.cc.c.',
    ],
    teen: [
      '.c......c.',
      '..acddca..',
      '.acdfgfdca',
      'acddgdgdca',
      'abbEbbEbba',
      'abhebbehba',
      '.abbmmbba.',
      'c.c.cc.c.c',
    ],
    adult: [
      '..c........c..',
      '...c......c...',
      '....acddca....',
      '..acdfgfdfca..',
      '.acdgdfgdgdca.',
      'acddfgdfgddfca',
      'abbbEbbbbEbbba',
      'abbhebbbbehbba',
      '.abbbbmmbbbba.',
      'c.c.c.cc.c.c.c',
    ],
  },
  {
    id: 'starwhelp',
    name: 'Starwhelp',
    rarity: 'legendary',
    blurb: 'A dragon small enough to sleep in a teacup. Hoards stars.',
    face: 'a',
    accent: '#a99bff',
    shinyAccent: '#e8ecff',
    palette: { o: '#1c1745', a: '#4d40b5', b: '#342986', c: '#9a8ef5', d: '#ffd36b', f: '#ff8fd8', g: '#9ee8ff', E: '#fff3c4', m: '#ff8fd8', h: '#ff8fd8' },
    shiny: { o: '#39407a', a: '#e8ecff', b: '#b8c1ee', c: '#ffffff', d: '#ffd36b', f: '#7fd3ff', g: '#ffb3e6', E: '#232a66', m: '#e2507a' },
    baby: [
      'd......d',
      '.daaaad.',
      'oaEaaEao',
      'oheaaeho',
      'oaammaao',
      'bocccob.',
      '.oo..oof',
    ],
    teen: [
      '..d....d..',
      '..daaaad..',
      'b.oagaao.b',
      'bboEaaEobb',
      'bboeaaeobb',
      'b.ohmmho.b',
      '..occcco..',
      '..oo..oof.',
    ],
    adult: [
      '...d......d...',
      '....daaaad....',
      '...oagaaaao...',
      'f..oaaaaaao..f',
      'fboaaEaaEaaobf',
      'fbbaheaaehabbf',
      '.bboaammaaobb.',
      '...occcccco...',
      '...oaccccao.f.',
      '...oo....oof..',
    ],
  },
]

// ---------------------------------------------------------------- moods

/**
 * One frame of a mood, as a recipe applied to the stage's sprite.
 *
 * `dy`/`dx` move the body; `eyes`, `mouth`, `blush` set the face; `drop`
 * slides a sweat drop; `z` draws the sleep letter; `confetti` picks a confetti
 * pattern; `white` flashes the silhouette; `use` picks which stage an
 * evolution frame shows; `skew` tilts the egg; `split` cracks it open.
 */
export type Pose = {
  dy?: number
  dx?: number
  eyes?: 'open' | 'closed' | 'happy'
  mouth?: 'open' | 'flat'
  blush?: boolean
  drop?: number
  z?: 'z' | 'Z'
  confetti?: number
  white?: boolean
  use?: 'from' | 'to'
  egg?: boolean
  skew?: number
  split?: boolean
  shell?: boolean
}

export type MoodArt = {
  /** Ticks each frame stays up. */
  hold: number
  frames: readonly Pose[]
}

const HAPPY: Pose = { eyes: 'happy', mouth: 'open', blush: true }

export const MOODS: Readonly<Record<HatchlingMood | 'working', MoodArt>> = {
  // Still while nothing happens; the working loop is what breathes.
  idle: { hold: 1, frames: [{}] },
  working: { hold: 2, frames: [{}, { dy: -1 }, { eyes: 'closed' }] },
  happy: { hold: 1, frames: [{ ...HAPPY, dy: -1 }, { ...HAPPY }] },
  sweat: {
    hold: 1,
    frames: [
      { dx: -1, drop: 0, mouth: 'flat' },
      { dx: 1, drop: 1, mouth: 'flat' },
      { drop: 2, mouth: 'flat' },
    ],
  },
  cheer: {
    hold: 1,
    frames: [
      { ...HAPPY, dy: -2, confetti: 0 },
      { ...HAPPY, dy: -1, confetti: 1 },
      { ...HAPPY, confetti: 2 },
    ],
  },
  sleep: {
    hold: 2,
    frames: [
      { eyes: 'closed', blush: true, z: 'z' },
      { eyes: 'closed', blush: true, z: 'Z' },
    ],
  },
  hatch: {
    hold: 2,
    frames: [
      { egg: true, skew: -1 },
      { egg: true, skew: 1 },
      { egg: true, split: true },
      { ...HAPPY, shell: true },
      { ...HAPPY, dy: -1, confetti: 1 },
    ],
  },
  evolve: {
    hold: 2,
    frames: [
      { use: 'from', white: true },
      { use: 'to', white: true },
      { use: 'from', white: true },
      { use: 'to', white: true },
      { use: 'to', ...HAPPY, confetti: 0 },
      { use: 'to', ...HAPPY, dy: -1, confetti: 2 },
    ],
  },
}

/** Egg wobble while Claude works: tilt left, upright, tilt right. */
export const EGG_WORKING: MoodArt = {
  hold: 2,
  frames: [{ egg: true }, { egg: true, skew: -1 }, { egg: true }, { egg: true, skew: 1 }],
}

/** Where confetti lands, as [x, y] on the canvas, per pattern. */
export const CONFETTI: readonly (readonly (readonly [number, number])[])[] = [
  [[1, 0], [8, 1], [0, 3]],
  [[2, 1], [9, 0], [1, 5]],
  [[0, 1], [7, 0], [9, 4]],
]
