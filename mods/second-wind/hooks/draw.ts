// Pure drawing helpers: the terminal's breath bar in text cells, the desktop's
// circle as SVG markup, and how much of each fits the band's width.

import { clamp01 } from './breath'
import type { FrameStep } from './breath'

export type Motion = 'full' | 'gentle' | 'still'

/** Gentle motion keeps the shape from emptying all the way: less travel, same pace. */
export const shownFill = (fill: number, motion: Motion): number =>
  motion === 'gentle' ? 0.35 + 0.65 * clamp01(fill) : clamp01(fill)

export const TRACK = '─'
export const BAR_MAX = 40
export const BAR_MIN = 6

/**
 * A bar `width` cells wide (rounded down to even) that fills from its middle
 * outward, at half-cell steps on each side: [left track, body, right track].
 */
export function barCells(fill: number, width: number): [string, string, string] {
  const half = Math.max(1, Math.floor(width / 2))
  const units = Math.round(clamp01(fill) * half * 2) // half-cells filled per side
  const full = Math.floor(units / 2)
  const part = units % 2
  const track = TRACK.repeat(half - full - part)
  const body = (part === 1 ? '▐' : '') + '█'.repeat(full * 2) + (part === 1 ? '▌' : '')
  return [track, body, track]
}

/** The bar's width for a band `columns` cells wide. */
export const barWidth = (columns: number): number => Math.max(2, Math.min(BAR_MAX, Math.floor(columns)))

/**
 * The head row's parts that fit: the cue always (cut if it must be), the
 * caption only with two cells to spare beside it.
 */
export function fitHead(cue: string, caption: string, columns: number): { cue: string; caption: string | null } {
  const room = Math.max(1, Math.floor(columns))
  const shortCue = cue.length > room ? cue.slice(0, Math.max(1, room - 1)) + '…' : cue
  return { cue: shortCue, caption: shortCue.length + 2 + caption.length <= room ? caption : null }
}

/** The circle's radius in a 100-unit box: full motion travels further than gentle; still does not travel. */
export function radius(fill: number, motion: Motion): number {
  const f = clamp01(fill)
  const r = motion === 'still' ? 30 : motion === 'gentle' ? 26 + 18 * f : 14 + 30 * f
  return Math.round(r * 100) / 100
}

/**
 * The desktop circle. With motion it animates the current step from start to
 * end by itself (SMIL in the sandboxed frame), so the markup stays the same
 * for the whole step and the surface never repaints it mid-breath. Colours sit
 * at partial opacity and follow the surface's light or dark scheme: markup
 * cannot name theme keys.
 */
export function circleSvg(step: FrameStep, fill: number, motion: Motion, px: number): { source: string; isInteractive: boolean } {
  const ring =
    '<style>.r{fill:none;stroke:#7d8590;stroke-opacity:.45}.c{fill:#4a8fd8;fill-opacity:.5}' +
    '@media (prefers-color-scheme:dark){.r{stroke:#b4bcc8}.c{fill:#86b8f0}}</style>' +
    '<circle class="r" cx="50" cy="50" r="47" stroke-width="2"/>'
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${px}" height="${px}">`
  const isMoving = motion !== 'still' && step.from !== step.to && step.ms > 0
  if (!isMoving) {
    return { source: `${head}${ring}<circle class="c" cx="50" cy="50" r="${radius(motion === 'still' ? 0 : fill, motion)}"/></svg>`, isInteractive: false }
  }
  const r0 = radius(step.from, motion)
  const r1 = radius(step.to, motion)
  const animate =
    `<animate attributeName="r" from="${r0}" to="${r1}" dur="${Math.round(step.ms)}ms" begin="0s" fill="freeze"` +
    ' calcMode="spline" keyTimes="0;1" keySplines="0.45 0 0.55 1"/>'
  return { source: `${head}${ring}<circle class="c" cx="50" cy="50" r="${r0}">${animate}</circle></svg>`, isInteractive: true }
}
