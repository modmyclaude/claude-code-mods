// Pure drawing helpers: the terminal's breath bar in text cells, the desktop's
// circle as SVG markup, and how much of each fits the band's width.

import { BOLT_PALETTE, BOLT_SPRITES } from './bolt'
import { clamp01 } from './breath'
import type { PhaseName } from './breath'

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

// ---------------------------------------------------------------- the desktop guide (MM-110)

/** One step of the desktop guide: its words, how long it takes, the fill it eases from and to. */
export type GuideStep = { phase: PhaseName; ms: number; from: number; to: number }
export type GuidePose = 'calm' | 'idle'

/** The guide's size in CSS pixels, fixed: a size change would reload the drawing (MM-110). */
export const GUIDE_SIZE = { width: 72, height: 72 } as const

const round = (n: number): number => Math.round(n * 100) / 100
const pct = (at: number, total: number): string => `${round((100 * at) / total)}%`

/** Bolt's small pose as crisp pixel rects, 2 units a pixel, one rect per run of a colour. */
function boltRects(pose: GuidePose): string {
  const palette = BOLT_PALETTE as Readonly<Record<string, string>>
  let out = ''
  BOLT_SPRITES.small[pose].forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const key = row[x]!
      let n = 1
      while (row[x + n] === key) n += 1
      if (palette[key] !== undefined) out += `<rect x="${x * 2}" y="${y * 2}" width="${n * 2}" height="2" fill="${palette[key]}"/>`
      x += n
    }
  })
  return out
}

/**
 * The desktop breathing guide: Bolt in his calm pose with a soft halo that
 * swells on the in-breath and settles on the out-breath, on continuous eased
 * keyframes. The step's words stay beside it as text, so the drawing never
 * changes mid-span: built once per span of breathing, with the same props, it
 * is never reloaded and never restarts (MM-110). `delayMs` is how far into
 * the steps it opens. Bolt and the halo are always drawn; reduced motion (the
 * setting or the system's) keeps them still.
 */
export function guideSvg(steps: readonly GuideStep[], opts: { motion: Motion; delayMs: number; loop: boolean; pose: GuidePose }): string {
  const total = steps.reduce((n, s) => n + s.ms, 0)
  const isMoving = opts.motion !== 'still' && total > 0
  const [r0, r1] = opts.motion === 'gentle' ? [15, 19] : [12, 21]
  const grow = opts.motion === 'gentle' ? 0.03 : 0.06
  const r = (f: number) => round(r0 + (r1 - r0) * clamp01(f))
  const scale = (f: number) => round(1 + grow * clamp01(f))
  const eased = 'animation-timing-function:cubic-bezier(.45,0,.55,1)'
  const run = (name: string) =>
    `animation:${name} ${Math.round(total)}ms linear ${-Math.round(Math.max(0, opts.delayMs))}ms ${opts.loop ? 'infinite' : '1'} both`
  let css = '.h{fill:#C8F53C;fill-opacity:.2}@media (prefers-color-scheme:dark){.h{fill-opacity:.16}}.b{transform-box:fill-box;transform-origin:center}'
  const last = steps[steps.length - 1]
  if (total > 0 && last) {
    let at = 0
    const halo: string[] = []
    const body: string[] = []
    for (const s of steps) {
      halo.push(`${pct(at, total)}{r:${r(s.from)}px;${eased}}`)
      body.push(`${pct(at, total)}{transform:scale(${scale(s.from)});${eased}}`)
      at += s.ms
    }
    halo.push(`100%{r:${r(last.to)}px}`)
    body.push(`100%{transform:scale(${scale(last.to)})}`)
    if (isMoving) css += `@keyframes h{${halo.join('')}}@keyframes b{${body.join('')}}.h{${run('h')}}.b{${run('b')}}`
  }
  css += '@media (prefers-reduced-motion:reduce){.h,.b{animation:none}}'
  const still = r(isMoving ? steps[0]?.from ?? 0.5 : 0.5)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" width="${GUIDE_SIZE.width}" height="${GUIDE_SIZE.height}">` +
    `<style>${css}</style>` +
    `<circle class="h" cx="22" cy="22" r="${still}"/>` +
    `<g transform="translate(12 12)" shape-rendering="crispEdges"><g class="b">${boltRects(opts.pose)}</g></g>` +
    '</svg>'
  )
}
