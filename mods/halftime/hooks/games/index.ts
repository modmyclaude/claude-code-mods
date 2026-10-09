// The four games by id. Each is typed on its own state; the engine handles a
// run's state as the union and looks the game up by the run's id.

import type { HalftimeGameId, HalftimeGameState } from '../../types'
import { hurdle } from './hurdle'
import type { Game } from './kit'
import { merge } from './merge'
import { tailchase } from './tailchase'
import { sweep } from './sweep'

export const GAME_IDS: readonly HalftimeGameId[] = ['hurdle', 'tailchase', 'merge', 'sweep']

const GAMES = { hurdle, tailchase, merge, sweep }

/** The game a run plays; its state is the matching member of the union by construction. */
export function gameOf(id: HalftimeGameId): Game<HalftimeGameState> {
  return GAMES[id] as unknown as Game<HalftimeGameState>
}

export function isGameId(value: unknown): value is HalftimeGameId {
  return typeof value === 'string' && (GAME_IDS as readonly string[]).includes(value)
}

/** How a score reads: sweep is a clear time, the rest are counts. */
export function scoreText(game: HalftimeGameId, score: number | null): string {
  if (score === null) return '-'
  return game === 'sweep' ? `${score}s` : String(score)
}

/** Whether `a` beats `b` for that game (sweep's lower time wins). */
export function beats(game: HalftimeGameId, a: number, b: number | undefined): boolean {
  if (b === undefined) return true
  return gameOf(game).better === 'lower' ? a < b : a > b
}
