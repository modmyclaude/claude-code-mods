// All of hatchling's art, as data. Nothing here runs: art.ts turns it into
// pixels. Every species is an original design, drawn to read at baby size
// (MM-093): a closed outline, light from the top left (a 1-2 px highlight
// there, shade on the right and bottom), eyes inside the body, no stray pixels.
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
import { BOLT_PALETTE } from './bolt'
import type { BoltSmallPose } from './bolt'

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
  secret: BOLT_PALETTE.B,
}

// ---------------------------------------------------------------- the egg

// The egg is Bolt's, the modmyclaude mascot (MM-091): its upright, leaning,
// cracked and hatching poses live in bolt.ts, copied in from brand/bolt-sprites;
// art.ts picks one per frame.

// ---------------------------------------------------------------- the secret

/**
 * One egg in 100 hatches Bolt instead of a species (MM-093). Bolt is drawn from
 * bolt.ts exactly as Bolt is drawn: never shiny, recoloured, flashed or moved
 * (BRAND.md), and the same at every stage; only the stage text grows.
 */
export const BOLT_PET = {
  id: 'bolt',
  name: 'Bolt',
  rarity: 'secret',
  blurb: "It was Bolt's egg all along.",
  accent: BOLT_PALETTE.B,
  /** Bolt is never shiny: the same lime. */
  shinyAccent: BOLT_PALETTE.B,
} as const

/**
 * Bolt's own small pose for each mood: at rest when idle or watching Claude work,
 * a jump to bounce on a good tool call, the sweat drop on a failed one, a cheer
 * for passing tests, a hatch and a stage-up, and asleep after 5 quiet minutes.
 */
export const BOLT_MOODS: Readonly<Record<HatchlingMood | 'working', { hold: number; frames: readonly BoltSmallPose[] }>> = {
  idle: { hold: 1, frames: ['idle'] },
  working: { hold: 1, frames: ['idle'] },
  happy: { hold: 1, frames: ['jump', 'idle'] },
  sweat: { hold: 1, frames: ['sweat'] },
  cheer: { hold: 1, frames: ['cheer', 'idle'] },
  sleep: { hold: 1, frames: ['sleep'] },
  hatch: { hold: 1, frames: ['cheer'] },
  evolve: { hold: 1, frames: ['cheer'] },
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
      '..dddd..',
      '.ddddfd.',
      'ocEaaEbo',
      'oheaaeho',
      'oaammabo',
      '.obbbbo.',
      '..oooo..',
    ],
    teen: [
      '...ddgd...',
      '.ddddddfd.',
      'ocaEaaEabo',
      'oaheaaehbo',
      'oaaammaabo',
      'oaaaaaaabo',
      '.obbbbbbo.',
      '..oooooo..',
    ],
    adult: [
      '.........g....',
      '....ddddgwgd..',
      '..ddddddfgddd.',
      '.ddfddddddddfd',
      'ocaaaaaaaaaabo',
      'oaaaEaaaaEaabo',
      'oaaheaaaaehabo',
      'oaaaaammaaaabo',
      '.obbbbbbbbbbo.',
      '..oooooooooo..',
    ],
  },
  {
    id: 'fluffle',
    name: 'Fluffle',
    rarity: 'common',
    blurb: 'Mostly fluff. The rest is also fluff.',
    face: 'a',
    accent: '#c6b1f2',
    shinyAccent: '#8fe3c6',
    palette: { a: '#b9a3e3', b: '#9480c4', c: '#e9e0ff', d: '#f7ead0', f: '#ff9fc2' },
    shiny: { a: '#9fe3c9', b: '#6fbf9f', c: '#e2fbf0', d: '#fff4d9', f: '#ffb0c4' },
    baby: [
      '..bbbb..',
      '.bccaab.',
      'bbaaaabb',
      'bfEaaEfb',
      'bfeaaefb',
      'bfammafb',
      'bb.bb.bb',
    ],
    teen: [
      '...bbbb...',
      '..bccaab..',
      '.bbaaaabb.',
      'bfaEaaEafb',
      'bfheaaehfb',
      'bfaammaafb',
      'bfbaddabfb',
      'bb.bbbb.bb',
    ],
    adult: [
      '.....bbbb.....',
      '...bbccaabb...',
      '..bccaaaaaab..',
      '.bbbaaaaaabbb.',
      'bfbaaEaaEaabfb',
      'bfbaaeaaeaabfb',
      'bfbahammahabfb',
      'bfbaaddddaabfb',
      '.bbbaddddabbb.',
      '...bbbbbbbb...',
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
      'o..o....',
      'ocaofffg',
      'oEao.dd.',
      'oeho.dd.',
      'omaafffg',
      'oabbbbbo',
      '.oooooo.',
    ],
    teen: [
      '.o..o.....',
      '.o..o.....',
      'ocaaaofffg',
      'oaEaao.dd.',
      'oaehao.dd.',
      'omaaaafffg',
      'oaabbbbbbo',
      '.oooooooo.',
    ],
    adult: [
      '.o...o........',
      '.o...o..gffffg',
      'oocaaoo..dddd.',
      'oaaaaao..dgdd.',
      'oaEaaao..dddd.',
      'oaehaao..ddgd.',
      'omaaaaao.dddd.',
      'oaaaaaaagffffg',
      'oabbbbbbbbbbbo',
      '.oooooooooooo.',
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
      '...oo...',
      '..occo..',
      '.ocaaaoo',
      'oaEaaEao',
      'oheaaeho',
      'oaammabo',
      '.oooooo.',
      '..d..d..',
    ],
    teen: [
      '...oooo...',
      '..occaao..',
      '.oocaaaaoo',
      'oacEaaEaao',
      'oaheaaehbo',
      'oaaammaabo',
      '.oooooooo.',
      '..d..d..d.',
    ],
    adult: [
      '.....oooo.....',
      '....occaao....',
      '.oooccaaaaooo.',
      'occaaaaaaaaaao',
      'oaaaEaaaaEaaao',
      'oaaaeaaaaeaabo',
      'oaahaammaahabo',
      '.obbbbbbbbbbo.',
      '..oooooooooo..',
      '..d..d..d..d..',
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
      '..bccb..',
      '.oEccEo.',
      'oaecceao',
      'ofammafo',
      'oaaddaao',
      '.oowdoo.',
    ],
    teen: [
      '..b....b..',
      '...bccb...',
      '..oEccEo..',
      '.oaecceao.',
      'oafammafao',
      'offaddaffo',
      'oaaadwaaao',
      '.oooddooo.',
    ],
    adult: [
      '...b......b...',
      'oo..b.cc.b..oo',
      'oaoo.bccb.ooao',
      'oafaaEccEaafao',
      'oaffaecceaffao',
      'oaaaahmmhaaaao',
      '.oaaaoccoaaao.',
      '..oaaodwoaao..',
      '...ooowdooo...',
      '......dd......',
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
      'o......o',
      'od....fo',
      'ocd..fbo',
      'oaadfbbo',
      '.oEabEo.',
      '.oemmeo.',
      '..odfo..',
    ],
    teen: [
      'o........o',
      'od......fo',
      'ocd....fbo',
      'oaad..fbbo',
      'oaaadfbbbo',
      '.oaEabEbo.',
      '..oemmeo..',
      '...odfo...',
    ],
    adult: [
      'o............o',
      'od..........fo',
      'ocd...oo...fbo',
      'oaad.oabo.fbbo',
      'oaaadaabbfbbbo',
      '.oaaaEabEbbbo.',
      '..oaaeabebbo..',
      '...oahmmhbo...',
      '....oaabbo....',
      '.....odfo.....',
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
      '..aaaa..',
      '.accfda.',
      'cacdgfac',
      '.adgdga.',
      '.aaaaaa.',
      'caEbbEac',
      '.aebbea.',
      '..amma..',
    ],
    teen: [
      '...aaaa...',
      '..accfda..',
      'cacdfgdgac',
      '.adgdgdga.',
      '.aaaaaaaa.',
      'cabEbbEbac',
      '.abebbeba.',
      'c.abmmba.c',
    ],
    adult: [
      '....aaaaaa....',
      '..aacccfdbaa..',
      '.accfdgdgdbba.',
      'cacfdgfgdgdbac',
      '.acdgdgdgdgba.',
      'caaaaaaaaaaaac',
      '..abbEbbEbba..',
      '.cabbebbebbac.',
      '..abbbmmbbba..',
      '...aaaaaaaa...',
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
      '.d....d.',
      '.ocggao.',
      'oaEaaEao',
      'oheaaeho',
      'boammaob',
      '.occcco.',
      '.bb..bbd',
    ],
    teen: [
      '..d....d..',
      '..ocggao..',
      '.ocaaaaao.',
      'boaEaaEaob',
      'bboeaaeobb',
      '.bohmmhob.',
      '..occcco..',
      '..bb..bbdf',
    ],
    adult: [
      '...d......d...',
      '...dd....dd...',
      '....ocggao....',
      '...ocaaaaao...',
      'bb.oaEaaEao.bb',
      'bbboheaaehobbb',
      '.bboaammaaobb.',
      '...oaccccao.d.',
      '...occccccodfd',
      '....bb..bb..d.',
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
 * evolution frame shows; `skew` leans the egg and `split` lifts its lid (Bolt's
 * egg poses, art.ts).
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
