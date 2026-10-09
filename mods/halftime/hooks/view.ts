// What the board shows, worked out in the hooks module: the board's surface
// module only paints these rows and reports input, so it knows no game.

import type { HalftimeRun, HalftimeStats, HalftimeSweep } from '../types'
import { gameOf, scoreText } from './games'
import { BOLD, DIM, paint, type Grid, type Seg } from './games/kit'
import { SHARED_KEYS } from './engine'

/** The props the board's surface module draws from (plain data). */
export type BoardProps = {
  rid: number
  /** In play: the board ticks (realtime games) once it holds the keys. */
  live: boolean
  tick: number
  /** The only keys the board passes on; Enter, y, n and digits are never among them. */
  keys: string[]
  /** The last input event applied, by board instance: [iid, seq]. */
  ack: [string, number]
  title: Seg[]
  rows: Seg[][]
  /** Field geometry for clicks; the field starts on the board's second row. */
  grid: Grid | null
  hint: string
  wait: string
  needClick: boolean
  showHint: boolean
  /** The keyboard pad (MM-081): [letter, word], one per action, for a terminal that sends no clicks. */
  pad: [string, string][]
}

const PAD_ORDER = 'wasdxfpr'
const PAD_WORDS: Readonly<Record<string, string>> = { w: 'up', a: 'left', s: 'down', d: 'right', x: 'open', f: 'flag', p: 'pause', r: 'again' }

/** One letter per action (wasd before hjkl), then pause, or again once the run is over; each with its word. */
export function padFor(run: HalftimeRun): [string, string][] {
  const byAction = new Map<string, string>()
  for (const [key, action] of Object.entries(gameOf(run.game).controls)) {
    if (/^[a-z]$/.test(key) && PAD_ORDER.includes(key) && !byAction.has(action)) byAction.set(action, key)
  }
  // A plain one-word action names itself (cratehop's jump); the rest take the letter's word.
  const pad: [string, string][] = [...byAction].map(([action, key]) => [key, /^[a-z]+$/.test(action) && action !== 'reveal' ? action : PAD_WORDS[key] ?? key])
  pad.push(run.status === 'over' ? ['r', 'again'] : ['p', 'pause'])
  return pad.sort((a, b) => PAD_ORDER.indexOf(a[0]) - PAD_ORDER.indexOf(b[0]))
}

/** Keys a game's board may pass on: its controls plus pause and again (no map holds a forbidden key). */
export function keysFor(run: HalftimeRun): string[] {
  return [...Object.keys(gameOf(run.game).controls), ...Object.keys(SHARED_KEYS)]
}

/** Play time as of now (a turn-based run's live stretch is still open). */
export const playedNow = (run: HalftimeRun, now: number) => run.playedMs + (run.liveSince > 0 ? Math.max(0, now - run.liveSince) : 0)

function liveScore(run: HalftimeRun, now: number): string {
  if (run.game === 'sweep') {
    const g = run.g as HalftimeSweep
    const flags = g.flag.reduce((n, f) => n + f, 0)
    const mines = g.mines.reduce((n, m) => n + m, 0)
    return `${flags}/${mines} flagged  ${Math.round(playedNow(run, now) / 1000)}s`
  }
  return scoreText(run.game, gameOf(run.game).score(run.g, run.playedMs))
}

function overText(run: HalftimeRun): string {
  const score = run.result?.score ?? null
  const shown = scoreText(run.game, score)
  if (run.game === 'cratehop') return `crashed at ${shown}`
  if (run.game === 'tailchase') return (run.g as { won: boolean }).won ? `filled the field: ${shown}` : `bit your own tail at ${shown}`
  if (run.game === 'merge') return `no moves left at ${shown}`
  return score === null ? 'boom - a mine' : `cleared in ${shown}`
}

function waitText(run: HalftimeRun): string {
  switch (run.status) {
    case 'ready':
      return gameOf(run.game).realtime ? 'click the board to start - the run begins on your click' : 'click the board to start'
    case 'countdown':
      return `back in ${run.count}...`
    case 'live':
      return 'click the board to take the keys'
    case 'paused':
      return 'paused - click the board, or press p, to go on'
    case 'over': {
      const r = run.result
      const best = !r || !r.saved || r.score === null ? '' : r.isBest ? '  new personal best' : `  best ${scoreText(run.game, r.best)}`
      return `${overText(run)}${best}  ·  r: again`
    }
  }
}

/** The board for a run, sized to the band's body: `cols` across, `rows` for the whole board. */
export function boardView(run: HalftimeRun, stats: HalftimeStats, cols: number, rows: number, now: number): BoardProps {
  const game = gameOf(run.game)
  // The field comes first: in a tight band the hint line goes before any field row does.
  const showHint = rows >= game.rows + 2
  const fieldRows = showHint ? game.rows : Math.max(3, rows - 1)
  const drawn = game.draw(run.g, cols, fieldRows)
  const best = stats.best[run.game]
  const title: Seg[] = paint([
    [game.title, 'text', undefined, BOLD],
    ['  '],
    [liveScore(run, now), 'text'],
    [`  best ${scoreText(run.game, best ?? null)}`, 'subtle', undefined, DIM],
    [run.mode === 'daily' ? `  daily ${run.day.slice(5)}` : '  practice', 'subtle', undefined, DIM],
  ])
  return {
    rid: run.id,
    live: run.status === 'live',
    tick: game.realtime ? game.tickMs : 0,
    keys: keysFor(run),
    pad: padFor(run),
    ack: [run.input.iid, run.input.seq],
    title,
    rows: drawn.rows,
    grid: drawn.grid ?? null,
    hint: game.hint,
    wait: waitText(run),
    needClick: run.status === 'countdown',
    showHint,
  }
}
