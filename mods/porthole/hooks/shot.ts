// Pure screenshot planning: the Chrome command line, viewport and picture sizes,
// and which temp paths the mod may clean up. No `$` here; register.tsx does the I/O.

import type { PortholeMode } from '../types'

/** CSS viewport widths, per the spec: a phone and a laptop. */
export const VIEWPORT_WIDTH: Record<PortholeMode, number> = { mobile: 390, desktop: 1280 }
/** A phone screen's height, so a mobile shot keeps a phone's shape. */
export const MOBILE_HEIGHT = 844
/** Chrome stops loading and shoots anyway after this long (its own --timeout). */
export const LOAD_TIMEOUT_MS = 15_000
/** A terminal cell is about twice as tall as it is wide; used to keep pictures unstretched. */
export const CELL_ASPECT = 2

/** Where Chrome is usually installed. macOS app bundles first, then names looked up on PATH. */
export const MAC_CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
]
export const PATH_CHROMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']

export type Size = { width: number; height: number }
export type Room = { columns: number; rows: number }

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

/**
 * The browser window for a shot. Mobile is a phone (390 x 844). Desktop is 1280 wide
 * and as tall as the pane's shape asks, so the picture fills the pane it lands in.
 */
export function shotSize(mode: PortholeMode, room?: Room): Size {
  if (mode === 'mobile') return { width: VIEWPORT_WIDTH.mobile, height: MOBILE_HEIGHT }
  const width = VIEWPORT_WIDTH.desktop
  if (room === undefined || room.columns < 1 || room.rows < 1) return { width, height: 800 }
  return { width, height: clamp(Math.round((width * room.rows * CELL_ASPECT) / room.columns), 480, 4096) }
}

/** The largest box of cells inside `room` that shows a `px`-sized picture without stretching it. */
export function fitBox(px: Size, room: Room): Room {
  const columns = clamp(Math.floor(room.columns), 1, 255)
  const rows = clamp(Math.floor(room.rows), 1, 255)
  const rowsAtFullWidth = Math.round((columns * px.height) / px.width / CELL_ASPECT)
  if (rowsAtFullWidth <= rows) return { columns, rows: Math.max(1, rowsAtFullWidth) }
  const columnsAtFullHeight = Math.round((rows * CELL_ASPECT * px.width) / px.height)
  return { columns: clamp(columnsAtFullHeight, 1, columns), rows }
}

/**
 * The whole Chrome command line, as argv (no shell). A fresh profile inside the
 * run folder every time: no cookies, no signed-in accounts, nothing shared with the
 * person's own browser. The URL comes last, after `--`, and is always an http(s)
 * href besides, so it can never be read as a switch.
 */
export function chromeArgv(chrome: string, run: { dir: string; size: Size; url: string }): string[] {
  return [
    chrome,
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--use-mock-keychain',
    '--force-device-scale-factor=1',
    `--timeout=${LOAD_TIMEOUT_MS}`,
    `--user-data-dir=${run.dir}/profile`,
    `--window-size=${run.size.width},${run.size.height}`,
    `--screenshot=${run.dir}/shot.png`,
    '--', // ends the switches: the URL is never read as one
    run.url,
  ]
}

/** Chrome's own line once the PNG is on disk (`22337 bytes written to file ...`). */
export const WRITTEN = /written to file/i

/** The temp folder to make run folders in: $TMPDIR without its trailing slash, else /tmp. */
export function tempRoot(tmpdir: string | undefined): string {
  const root = (tmpdir ?? '').replace(/\/+$/, '')
  return root.startsWith('/') ? root : '/tmp'
}

/** The mktemp template for one run folder. */
export const runTemplate = (root: string): string => `${root}/porthole.XXXXXX`

/** True only for a run folder mktemp made from runTemplate(root). */
export function isRunDir(path: string, root: string): boolean {
  if (!path.startsWith(`${root}/porthole.`)) return false
  return /^[A-Za-z0-9]{6,}$/.test(path.slice(root.length + '/porthole.'.length))
}

/** The only paths the mod ever hands to `rm -rf`: a run folder, or the profile inside one. */
export function isRemovable(path: string, root: string): boolean {
  const dir = path.endsWith('/profile') ? path.slice(0, -'/profile'.length) : path
  return isRunDir(dir, root)
}

/** The last line of Chrome's stderr, without its `[pid:tid:...]` prefix, short enough for one row. */
export function lastLine(text: string): string {
  const lines = text
    .split('\n')
    .map(line => line.replace(/^\[[^\]]*\]\s*/, '').trim())
    .filter(line => line !== '')
  return (lines.at(-1) ?? '').slice(0, 200)
}
