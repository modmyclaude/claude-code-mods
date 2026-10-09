// Turns the art in sprites.ts (and Bolt's egg and the secret Bolt pet, from bolt.ts)
// into pixels for one mood and frame, then into text cells (half-blocks: two pixels
// per cell) for every surface. Pure.

import type { HatchlingKind, HatchlingMood, HatchlingRarity, HatchlingSpecies, HatchlingStage } from '../types'
import { BOLT_PALETTE, BOLT_SPRITES, boltCells } from './bolt'
import type { BoltSmallPose } from './bolt'
import { BOLT_MOODS, BOLT_PET, CANVAS, CONFETTI, EGG_WORKING, FX, MOODS, SPECIES } from './sprites'
import type { MoodArt, Pose, SpeciesArt } from './sprites'

/** A pixel: a #rrggbb colour, or null where nothing is drawn. */
export type Px = string | null

/** A letter drawn over a whole cell (the sleep z), in cell coordinates. */
export type Glyph = { col: number; row: number; ch: string; color: string }

/**
 * One drawn frame. `ink` marks the pixels a one-colour copy shows: the body,
 * but not the eyes or an open mouth, which read as holes in a silhouette.
 */
export type Frame = { w: number; h: number; px: Px[][]; ink: boolean[][]; glyphs: Glyph[] }

/** One text cell: a character and its colours (absent = the surface's own). */
export type Cell = { ch: string; fg?: string; bg?: string }

/** Just what the art needs to know about the pet. */
export type View = {
  stage: HatchlingStage
  species?: HatchlingKind
  shiny: boolean
  eggCalls: number
  /** The stage before an evolution (the evolve flash shows both). */
  from?: HatchlingStage
}

/** Tool calls an egg takes to hatch (pet.ts's rules read it from here, as the cracks do). */
export const HATCH_AT = 25

/** The egg shows crack 1, 2 and 3 from a quarter, half and three quarters of the way to hatching. */
export const CRACKS = [0.25, 0.5, 0.75] as const

const UPPER = '▀' // ▀
const LOWER = '▄' // ▄
const FULL = '█' // █

export function speciesArt(id: HatchlingSpecies): SpeciesArt {
  const art = SPECIES.find(one => one.id === id)
  if (art === undefined) throw new Error(`unknown species ${id}`)
  return art
}

/** What the band, cards and toasts say about a hatched pet: a species, or the secret Bolt. */
export function petInfo(kind: HatchlingKind): { name: string; rarity: HatchlingRarity; blurb: string; accent: string; shinyAccent: string } {
  return kind === 'bolt' ? BOLT_PET : speciesArt(kind)
}

/** Which frames play: a mood's own, or the working loop while idle. */
export function moodArt(mood: HatchlingMood, isWorking: boolean, stage: HatchlingStage): MoodArt {
  if (stage === 'egg') {
    if (mood === 'sleep') return MOODS.sleep
    return isWorking ? EGG_WORKING : { hold: 1, frames: [{ egg: true }] }
  }
  if (mood === 'idle' && isWorking) return MOODS.working
  return MOODS[mood]
}

export function poseAt(art: MoodArt, tick: number): Pose {
  const index = Math.floor(Math.max(0, tick) / art.hold) % art.frames.length
  return art.frames[index] ?? {}
}

/** The canvas a view draws into: its stage's (the evolve flash draws the old stage inside the new one's). */
export function canvasOf(view: View): { w: number; h: number } {
  return CANVAS[view.stage]
}

/** Draws one frame of the pet. */
export function drawFrame(view: View, mood: HatchlingMood, tick: number, isWorking: boolean): Frame {
  const { w, h } = canvasOf(view)
  const frame: Frame = {
    w,
    h,
    px: Array.from({ length: h }, () => Array<Px>(w).fill(null)),
    ink: Array.from({ length: h }, () => Array<boolean>(w).fill(false)),
    glyphs: [],
  }
  const pose = poseAt(moodArt(mood, isWorking, view.stage), tick)

  if (view.stage === 'egg' || pose.egg === true || view.species === undefined) {
    drawBolt(frame, eggPose(view, mood, pose))
    drawZ(frame, pose)
    return frame
  }

  if (view.species === 'bolt') {
    // The secret pet keeps Bolt's own poses at every stage, never shiny (MM-093).
    const art = BOLT_MOODS[mood === 'idle' && isWorking ? 'working' : mood]
    drawBolt(frame, art.frames[Math.floor(Math.max(0, tick) / art.hold) % art.frames.length] ?? 'idle')
    if (pose.shell === true) drawShell(frame)
    return frame
  }

  const art = speciesArt(view.species)
  const stage = pose.use === 'from' && view.from !== undefined && view.from !== 'egg' ? view.from : view.stage
  const rows = stage === 'baby' ? art.baby : stage === 'teen' ? art.teen : stage === 'adult' ? art.adult : art.baby
  const palette = view.shiny ? art.shiny : art.palette
  const face = palette[art.face] ?? null
  const bodyW = rows[0]?.length ?? 0
  const x0 = Math.floor((w - bodyW) / 2) + (pose.dx ?? 0)
  const y0 = h - rows.length + (pose.dy ?? 0)

  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const letter = row[x] ?? '.'
      const [color, isHole] = colorOf(letter, pose, palette, face)
      if (color === null) continue
      put(frame, x0 + x, y0 + y, pose.white === true ? FX.flash : color, !isHole)
    }
  })

  if (pose.shell === true) drawShell(frame)
  if (pose.drop !== undefined) {
    const x = Math.min(w - 1, x0 + bodyW)
    put(frame, x, y0 + 1 + pose.drop, FX.sweat, true)
    put(frame, x, y0 + 2 + pose.drop, FX.sweat, true)
  }
  if (pose.confetti !== undefined) drawConfetti(frame, pose.confetti)
  drawZ(frame, pose)
  return frame
}

function drawZ(frame: Frame, pose: Pose): void {
  if (pose.z === undefined) return
  frame.glyphs.push({ col: frame.w - 1, row: pose.z === 'Z' ? 0 : 1, ch: pose.z, color: FX.zzz })
}

/** The colour of one sprite letter under a pose, and whether it is a hole. */
function colorOf(
  letter: string,
  pose: Pose,
  palette: Readonly<Record<string, string>>,
  face: Px,
): [Px, boolean] {
  const eye = palette.E ?? FX.eye
  const eyes = pose.eyes ?? 'open'
  switch (letter) {
    case '.':
      return [null, false]
    case 'E':
      return eyes === 'closed' ? [face, false] : [eye, true]
    case 'e':
      return eyes === 'happy' ? [face, false] : [eye, true]
    case 'm':
      if (pose.mouth === 'open') return [palette.m ?? FX.mouth, true]
      if (pose.mouth === 'flat') return [palette.o ?? FX.eye, true]
      return [face, false]
    case 'h':
      return pose.blush === true ? [palette.h ?? FX.cheek, false] : [face, false]
    default:
      return [palette[letter] ?? null, false]
  }
}

function put(frame: Frame, x: number, y: number, color: string, isInk: boolean): void {
  const row = frame.px[y]
  const inkRow = frame.ink[y]
  if (row === undefined || inkRow === undefined || x < 0 || x >= frame.w) return
  row[x] = color
  inkRow[x] = isInk
}

/**
 * Which of Bolt's egg poses a frame shows: the lid lifting off as it hatches, the
 * cracks from a quarter, half and three quarters of the way, else upright or leaning
 * with the wobble. Bolt has no cracked lean, so a cracked egg keeps its crack on
 * every frame of the wobble.
 */
function eggPose(view: View, mood: HatchlingMood, pose: Pose): BoltSmallPose {
  if (pose.split === true) return 'egg-hatch'
  if (mood === 'hatch') return 'egg-crack-3'
  if (view.eggCalls >= CRACKS[2] * HATCH_AT) return 'egg-crack-3'
  if (view.eggCalls >= CRACKS[1] * HATCH_AT) return 'egg-crack-2'
  if (view.eggCalls >= CRACKS[0] * HATCH_AT) return 'egg-crack-1'
  const lean = pose.skew ?? 0
  return lean < 0 ? 'egg-wobble-l' : lean > 0 ? 'egg-wobble-r' : 'egg'
}

/**
 * One of Bolt's small poses (MM-091, brand/bolt-sprites): the egg, or the secret pet.
 * Drawn exactly as Bolt is drawn, bottom-centred: never tilted, split or recoloured
 * here; its own poses lean, crack, hatch and move. Its letters (the sleep z) come
 * from bolt.ts's own cells, so they sit where Bolt puts them.
 */
function drawBolt(frame: Frame, pose: BoltSmallPose): void {
  const rows: readonly string[] = BOLT_SPRITES.small[pose]
  const x0 = Math.floor((frame.w - (rows[0]?.length ?? 0)) / 2)
  const y0 = frame.h - rows.length
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const letter = row[x] ?? '.'
      // The crack's and the eyes' ink is a hole in the one-colour copy.
      if (letter !== '.') put(frame, x0 + x, y0 + y, BOLT_PALETTE[letter as keyof typeof BOLT_PALETTE], letter !== 'E')
    }
  })
  boltCells('small', pose).forEach((line, row) =>
    line.forEach((cell, col) => {
      if (![' ', UPPER, LOWER, FULL].includes(cell.ch)) {
        frame.glyphs.push({ col: x0 + col, row: Math.floor(y0 / 2) + row, ch: cell.ch, color: cell.fg ?? FX.zzz })
      }
    }),
  )
}

/** Bits of Bolt's eggshell around the newly hatched pet. */
function drawShell(frame: Frame): void {
  const { w, h } = frame
  const bits: readonly (readonly [number, number, keyof typeof BOLT_PALETTE])[] = [
    [0, h - 1, 'B'], [1, h - 1, 'S'], [0, h - 2, 'B'],
    [w - 1, h - 1, 'B'], [w - 2, h - 1, 'S'],
  ]
  for (const [x, y, letter] of bits) put(frame, x, y, BOLT_PALETTE[letter], true)
}

function drawConfetti(frame: Frame, pattern: number): void {
  const spots = CONFETTI[pattern % CONFETTI.length] ?? []
  spots.forEach(([x, y], i) => {
    // The patterns are laid out for a 10-wide canvas; stretch to this one.
    const sx = Math.round((x * (frame.w - 1)) / 9)
    if (frame.px[y]?.[sx] === null) {
      put(frame, sx, y, FX.confetti[(i + pattern) % FX.confetti.length] ?? FX.flash, true)
    }
  })
}

/** Packs a frame into text cells, two pixel rows per cell row. */
export function toCells(frame: Frame): Cell[][] {
  const out: Cell[][] = []
  for (let r = 0; r < frame.h / 2; r += 1) {
    const line: Cell[] = []
    for (let c = 0; c < frame.w; c += 1) {
      const glyph = frame.glyphs.find(one => one.row === r && one.col === c)
      if (glyph !== undefined) {
        line.push({ ch: glyph.ch, fg: glyph.color })
        continue
      }
      const top = frame.px[r * 2]?.[c] ?? null
      const bottom = frame.px[r * 2 + 1]?.[c] ?? null
      if (top === null && bottom === null) line.push({ ch: ' ' })
      else if (bottom === null) line.push({ ch: UPPER, fg: top ?? undefined })
      else if (top === null) line.push({ ch: LOWER, fg: bottom })
      else if (top === bottom) line.push({ ch: FULL, fg: top })
      else line.push({ ch: UPPER, fg: top, bg: bottom })
    }
    out.push(line)
  }
  return out
}

/** Merges a row of cells into runs of one style, for Text spans. */
export function toRuns(line: readonly Cell[]): { text: string; fg?: string; bg?: string }[] {
  const runs: { text: string; fg?: string; bg?: string }[] = []
  for (const cell of line) {
    const last = runs[runs.length - 1]
    if (last !== undefined && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.ch
    else runs.push({ text: cell.ch, fg: cell.fg, bg: cell.bg })
  }
  return runs
}

/** RasterProps.cells: base64 of little-endian u32 [codePoint, fg, bg] triplets. */
export function rasterCells(cells: readonly (readonly Cell[])[]): string {
  const DEFAULT = 0x01000000
  const count = cells.reduce((sum, line) => sum + line.length, 0)
  const view = new DataView(new ArrayBuffer(count * 12))
  let at = 0
  for (const line of cells) {
    for (const cell of line) {
      view.setUint32(at, cell.ch.codePointAt(0) ?? 32, true)
      view.setUint32(at + 4, cell.fg === undefined ? DEFAULT : parseInt(cell.fg.slice(1), 16), true)
      view.setUint32(at + 8, cell.bg === undefined ? DEFAULT : parseInt(cell.bg.slice(1), 16), true)
      at += 12
    }
  }
  let binary = ''
  const bytes = new Uint8Array(view.buffer)
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] ?? 0)
  return btoa(binary)
}

/** Unpacks RasterProps.cells back into characters (for tests and checks). */
export function rasterText(base64: string, columns: number): string[] {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  const view = new DataView(bytes.buffer)
  const lines: string[] = []
  let line = ''
  for (let at = 0; at + 12 <= bytes.length; at += 12) {
    line += String.fromCodePoint(view.getUint32(at, true))
    if (line.length === columns) {
      lines.push(line)
      line = ''
    }
  }
  return lines
}

/**
 * The frame as plain characters with no colour: a silhouette that pastes
 * anywhere monospace (chat, an issue, a tweet). Eyes and mouth are holes.
 */
export function monoLines(frame: Frame): string[] {
  const lines: string[] = []
  for (let r = 0; r < frame.h / 2; r += 1) {
    let line = ''
    for (let c = 0; c < frame.w; c += 1) {
      const top = frame.ink[r * 2]?.[c] === true
      const bottom = frame.ink[r * 2 + 1]?.[c] === true
      line += top && bottom ? FULL : top ? UPPER : bottom ? LOWER : ' '
    }
    lines.push(line)
  }
  return lines
}
