// Turns the art in sprites.ts into pixels for one mood and frame, then into
// text cells (half-blocks: two pixels per cell) for every surface. Pure.

import type { HatchlingMood, HatchlingSpecies, HatchlingStage } from '../types'
import { CANVAS, CONFETTI, EGG, EGG_WORKING, FX, MOODS, SPECIES } from './sprites'
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
  species?: HatchlingSpecies
  shiny: boolean
  eggCalls: number
  /** The stage before an evolution (the evolve flash shows both). */
  from?: HatchlingStage
}

const UPPER = '▀' // ▀
const LOWER = '▄' // ▄
const FULL = '█' // █

export function speciesArt(id: HatchlingSpecies): SpeciesArt {
  const art = SPECIES.find(one => one.id === id)
  if (art === undefined) throw new Error(`unknown species ${id}`)
  return art
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

/** The canvas a view draws into; an evolution uses the bigger stage's. */
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
    drawEgg(frame, view, mood, pose)
    drawZ(frame, pose)
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

function drawEgg(frame: Frame, view: View, mood: HatchlingMood, pose: Pose): void {
  const body = EGG.body
  const x0 = Math.floor((frame.w - (body[0]?.length ?? 0)) / 2)
  const y0 = frame.h - body.length
  const cracks =
    mood === 'hatch' ? EGG.cracks[1] : view.eggCalls >= 21 ? EGG.cracks[1] : view.eggCalls >= 15 ? EGG.cracks[0] : []
  const isCrack = (x: number, y: number) => (cracks ?? []).some(([cx, cy]) => cx === x && cy === y)

  body.forEach((row, y) => {
    // A tilt moves the top half; a split lifts the top off like a lid.
    const isTop = y < 4
    const dx = isTop ? (pose.skew ?? 0) + (pose.split === true ? -1 : 0) : 0
    const dy = isTop && pose.split === true ? -1 : 0
    for (let x = 0; x < row.length; x += 1) {
      const letter = row[x] ?? '.'
      const color = isCrack(x, y) ? (EGG.palette.o ?? null) : letter === '.' ? null : (EGG.palette[letter] ?? null)
      if (color !== null) put(frame, x0 + x + dx, y0 + y + dy, color, !isCrack(x, y))
    }
  })
}

function drawShell(frame: Frame): void {
  const { w, h } = frame
  const bits: readonly (readonly [number, number, string])[] = [
    [0, h - 1, 'a'], [1, h - 1, 'b'], [0, h - 2, 'a'],
    [w - 1, h - 1, 'a'], [w - 2, h - 1, 'b'],
  ]
  for (const [x, y, letter] of bits) put(frame, x, y, EGG.palette[letter] ?? FX.flash, true)
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
