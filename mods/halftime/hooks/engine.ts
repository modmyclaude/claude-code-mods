// The session state machine, pure: every event the mod hears becomes one of
// these transitions over the session in `$.state`. Nothing here waits, draws
// or stores; register.tsx does that around them.
//
// The whistle in one paragraph: anything that needs the person (a permission
// prompt, a question, an input request, the main turn ending) freezes the run
// and hides the board, so the keys go back to the prompt. The loops that
// asked are remembered; once each has moved on (its tool batch resolved) or a
// new main turn starts, the run comes back with a 3-2-1. Subagent turns
// starting and ending are not needs-you signals and change nothing here.

import type { HalftimeGameId, HalftimeReason, HalftimeRun, HalftimeSession } from '../types'
import { gameOf } from './games'
import { normalizeKey } from './games/kit'
import { dailySeed, dayKey, practiceSeed } from './rng'
import { shareLine } from './share'

export const COUNTDOWN = 3
/** The longest a realtime tick may advance, so a stalled frame never jumps the game. */
export const MAX_TICK_MS = 200
/**
 * A realtime run with no key or click for this long pauses itself. Esc tells
 * the mod nothing, so this is how a run someone walked away from stops ticking.
 */
export const IDLE_PAUSE_MS = 20_000

export const EMPTY_SESSION: HalftimeSession = {
  phase: 'off', practice: false, run: null, whistle: null, asking: [], turn: null, nextId: 1, owed: [0, 0, 0],
}

/**
 * What the board posts: its instance id, its arming count, its input queue, whether a frame
 * ticked, and the run and epoch it was drawn for (a post from an earlier one is dropped).
 */
export type BoardMsg = { iid: string; arm: number; ev: [number, string][]; tick: boolean; rid?: unknown; ep?: unknown }

/** Board posts come from code: anything off-shape is dropped, never trusted. */
export function parseMsg(data: unknown): BoardMsg | null {
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (typeof d.iid !== 'string' || d.iid.length === 0 || d.iid.length > 64) return null
  if (typeof d.arm !== 'number' || !Number.isInteger(d.arm) || d.arm < 0) return null
  if (!Array.isArray(d.ev) || d.ev.length > 64) return null
  const ev: [number, string][] = []
  for (const item of d.ev) {
    if (!Array.isArray(item) || typeof item[0] !== 'number' || !Number.isInteger(item[0]) || typeof item[1] !== 'string' || item[1].length > 32) return null
    ev.push([item[0], item[1]])
  }
  // The run and epoch are only ever compared with the run's own (onMessage): any other value drops the post.
  return { iid: d.iid, arm: d.arm, ev, tick: d.tick === true, ...(d.rid === undefined ? {} : { rid: d.rid }), ...(d.ep === undefined ? {} : { ep: d.ep }) }
}

const turnActive = (s: HalftimeSession) => s.turn !== null

/** Adds play time to the run and to what the stored totals are owed. */
function credit(s: HalftimeSession, run: HalftimeRun, ms: number): [HalftimeSession, HalftimeRun] {
  if (ms <= 0) return [s, run]
  const wait = turnActive(s) ? ms : 0
  return [
    { ...s, owed: [s.owed[0] + ms, s.owed[1] + wait, s.owed[2]] },
    { ...run, playedMs: run.playedMs + ms, waitPlayedMs: run.waitPlayedMs + wait },
  ]
}

/**
 * Counts a realtime run's play since the last input. Ticks only hold it back
 * (`run.pending`) until the person shows they are still there; a run that
 * idles out drops it instead, so time nobody played is never counted.
 */
function confirm(s: HalftimeSession, run: HalftimeRun): [HalftimeSession, HalftimeRun] {
  const [ms, wait] = run.pending
  if (ms === 0 && wait === 0) return [s, run]
  return [
    { ...s, owed: [s.owed[0] + ms, s.owed[1] + wait, s.owed[2]] },
    { ...run, playedMs: run.playedMs + ms, waitPlayedMs: run.waitPlayedMs + wait, pending: [0, 0] },
  ]
}

/** Closes a turn-based run's live stretch up to now (realtime runs are counted per tick). */
function checkpoint(s: HalftimeSession, run: HalftimeRun, now: number): [HalftimeSession, HalftimeRun] {
  if (run.status !== 'live' || run.liveSince === 0) return [s, run]
  const [s2, r2] = credit(s, run, now - run.liveSince)
  return [s2, { ...r2, liveSince: now }]
}

/**
 * Takes a run out of play: no tick, no clock, until it goes live again. What
 * was played up to now counts (an idle pause empties `pending` first).
 * `keysLeft`: the keys went elsewhere, so the board comes back as a fresh one
 * that waits for a click (only p, pressed on the board itself, keeps it).
 */
function leaveLive(s: HalftimeSession, run: HalftimeRun, now: number, status: HalftimeRun['status'], held: boolean, keysLeft = true): [HalftimeSession, HalftimeRun] {
  const [s2, r2] = checkpoint(...confirm(s, run), now)
  return [s2, { ...r2, status, held, lastAt: 0, liveSince: 0, count: 0, epoch: r2.epoch + (keysLeft ? 1 : 0) }]
}

/** In play. A turn-based run's clock starts at the first touch, a realtime one at the first tick. */
function goLive(run: HalftimeRun, now: number, touched: boolean): HalftimeRun {
  const turnBased = !gameOf(run.game).realtime
  return { ...run, status: 'live', held: false, count: 0, lastAt: 0, liveSince: turnBased && touched ? now : 0, inputAt: now }
}

/** A run's share line, counting the main turn still running. */
export function shareOf(s: HalftimeSession, run: HalftimeRun, score: number | null, now: number): { line: string; waitMs: number } {
  const running = s.turn && run.status !== 'over' ? Math.max(0, now - Math.max(s.turn.startedAt, run.createdAt)) : 0
  const waitMs = run.waitMs + running
  const line = shareLine({ mode: run.mode, day: run.day, game: run.game, score, playedMs: run.playedMs, waitMs, waitPlayedMs: run.waitPlayedMs })
  return { line, waitMs }
}

/** The run just ended: freeze its clock, write its share line, owe it to the totals. */
function finish(s: HalftimeSession, run: HalftimeRun, now: number): HalftimeSession {
  const [s2, r2] = checkpoint(...confirm(s, run), now)
  const score = gameOf(run.game).score(r2.g, r2.playedMs)
  const { line, waitMs } = shareOf(s2, r2, score, now)
  const over: HalftimeRun = {
    ...r2, status: 'over', held: false, lastAt: 0, liveSince: 0, waitMs,
    result: { score, best: null, isBest: false, share: line, saved: false },
  }
  return { ...s2, run: over, owed: [s2.owed[0], s2.owed[1], s2.owed[2] + 1] }
}

/** The picker takes the band; a run in play pauses first, so nothing runs unseen. */
export function openPicker(s: HalftimeSession, now: number): HalftimeSession {
  if (s.run && (s.run.status === 'live' || s.run.status === 'countdown')) {
    const [s2, run] = leaveLive(s, s.run, now, 'paused', false)
    return { ...s2, run, phase: 'picker', whistle: null }
  }
  if (s.phase === 'picker') return s
  // The person came back on their own: a run the whistle held just waits for their click now.
  const run = s.run && s.run.held ? { ...s.run, held: false } : s.run
  return { ...s, run, phase: 'picker', whistle: null }
}

export function setPractice(s: HalftimeSession, practice: boolean): HalftimeSession {
  return { ...s, practice }
}

/** A fresh run of `game`, waiting on the board for the click that starts it. */
export function startGame(s: HalftimeSession, game: HalftimeGameId, practice: boolean, now: number): HalftimeSession {
  // Leaving a run mid-play still credits the time it was played.
  let base = s
  if (s.run && s.run.status === 'live') base = { ...leaveLive(s, s.run, now, 'paused', false)[0] }
  const id = base.nextId
  const day = dayKey(now)
  const mode = practice ? 'practice' : 'daily'
  const seed = practice ? practiceSeed(game, now, id) : dailySeed(game, day)
  const run: HalftimeRun = {
    id, game, mode, day, seed, g: gameOf(game).init(seed), status: 'ready', count: 0, held: false, epoch: 0,
    createdAt: now, lastAt: 0, liveSince: 0, inputAt: 0, pending: [0, 0], playedMs: 0, waitPlayedMs: 0, waitMs: 0,
    input: { iid: '', seq: 0, arm: 0 }, result: null,
  }
  return { ...base, phase: 'board', whistle: null, practice, run, nextId: id + 1 }
}

/** Shows the run's board again as it was left (a paused run waits for a click). */
export function showBoard(s: HalftimeSession, now: number): HalftimeSession {
  if (!s.run) return openPicker(s, now)
  return { ...s, run: { ...s.run, held: false }, phase: 'board', whistle: null }
}

/** Hides the band. A run in play is paused first, so nothing runs unseen. */
export function close(s: HalftimeSession, now: number): HalftimeSession {
  if (s.run && (s.run.status === 'live' || s.run.status === 'countdown')) {
    const [s2, run] = leaveLive(s, s.run, now, 'paused', false)
    return { ...s2, run, phase: 'off', whistle: null }
  }
  return { ...s, phase: 'off', whistle: null }
}

/** The whistle: freeze, hide the board, say why. `loop` is '' for the main conversation. */
export function needsYou(s: HalftimeSession, reason: HalftimeReason, loop: string, now: number): HalftimeSession {
  const asking = reason === 'turn' ? [] : s.asking.includes(loop) ? s.asking : [...s.asking, loop]
  if (s.phase === 'offer' || s.phase === 'picker') return { ...s, phase: 'off', asking }
  if (s.phase === 'whistle') return { ...s, whistle: reason, asking }
  if (s.phase !== 'board' || !s.run) return asking === s.asking ? s : { ...s, asking }
  let next: HalftimeSession = s
  let run = s.run
  if (run.status === 'live' || run.status === 'countdown' || run.status === 'paused') [next, run] = leaveLive(s, run, now, 'paused', true)
  else if (run.status === 'ready') run = { ...run, held: true, epoch: run.epoch + 1 }
  return { ...next, run, phase: 'whistle', whistle: reason, asking }
}

/** Back from the whistle: a frozen run gets its 3-2-1; one not yet started just shows again. */
export function resume(s: HalftimeSession): HalftimeSession {
  const run = s.run
  if (!run || run.status === 'over') return { ...s, phase: 'off', whistle: null, asking: [] }
  if (run.status === 'ready') return { ...s, phase: 'board', whistle: null, run: { ...run, held: false } }
  return { ...s, phase: 'board', whistle: null, run: { ...run, status: 'countdown', count: COUNTDOWN, held: false } }
}

/** A loop that asked the person has moved on (its tool batch resolved). */
export function workAgain(s: HalftimeSession, loop: string): HalftimeSession {
  if (!s.asking.includes(loop)) return s
  const asking = s.asking.filter(a => a !== loop)
  if (asking.length > 0 || s.phase !== 'whistle' || s.whistle === 'turn') return { ...s, asking }
  return resume({ ...s, asking })
}

/** A main-loop turn began: Claude is working again. */
export function turnStart(s: HalftimeSession, id: string, now: number): HalftimeSession {
  let next: HalftimeSession = { ...s, turn: { id, startedAt: now }, asking: [] }
  if (next.run && next.run.status === 'live') {
    // Time played before the turn began was not played while waiting.
    const [s2, run] = checkpoint(s, next.run, now)
    next = { ...s2, turn: { id, startedAt: now }, asking: [], run }
  }
  if (next.phase === 'whistle') return resume(next)
  if (next.phase === 'offer') return { ...next, phase: 'off' }
  return next
}

/** The main-loop turn ended: whistle, then book the turn time the run overlapped. */
export function turnComplete(s: HalftimeSession, now: number): HalftimeSession {
  const turn = s.turn
  const blown = needsYou(s, 'turn', '', now)
  let run = blown.run
  if (run && turn && run.status !== 'over') run = { ...run, waitMs: run.waitMs + Math.max(0, now - Math.max(turn.startedAt, run.createdAt)) }
  return { ...blown, run, turn: null, asking: [], phase: blown.phase === 'offer' ? 'off' : blown.phase }
}

export function countdownTick(s: HalftimeSession, now: number): HalftimeSession {
  const run = s.run
  if (s.phase !== 'board' || !run || run.status !== 'countdown') return s
  if (run.count > 1) return { ...s, run: { ...run, count: run.count - 1 } }
  return { ...s, run: goLive(run, now, false) }
}

/** Auto mode's offer, only if this same main turn is still running and nothing is up. */
export function offer(s: HalftimeSession, turnId: string): HalftimeSession {
  return s.turn?.id === turnId && s.phase === 'off' ? { ...s, phase: 'offer' } : s
}

/** The person started typing at the prompt: a run in play pauses rather than play on unattended. */
export function pauseForTyping(s: HalftimeSession, now: number): HalftimeSession {
  if (s.phase !== 'board' || !s.run || s.run.status !== 'live') return s
  const [s2, run] = leaveLive(s, s.run, now, 'paused', false)
  return { ...s2, run }
}

/** Keys every game shares: p pauses and resumes, r starts over once a run has ended. */
export const SHARED_KEYS: Readonly<Record<string, string>> = { p: 'pause', r: 'again' }

/** Applies one board post: arming, then queued keys and clicks in order, then the frame's tick. */
export function onMessage(s: HalftimeSession, msg: BoardMsg, now: number): HalftimeSession {
  if (s.phase !== 'board' || !s.run) return s
  // A board drawn for another run, or before the keys last left, is not the one on screen now.
  if ((msg.rid !== undefined && msg.rid !== s.run.id) || (msg.ep !== undefined && msg.ep !== s.run.epoch)) return s
  const game = gameOf(s.run.game)
  const same = msg.iid === s.run.input.iid
  const lastSeq = same ? s.run.input.seq : 0
  const lastArm = same ? s.run.input.arm : 0
  const seq = msg.ev.reduce((m, [n]) => Math.max(m, n), lastSeq)
  let next: HalftimeSession = s
  let run: HalftimeRun = { ...s.run, input: { iid: msg.iid, seq, arm: Math.max(lastArm, msg.arm) } }

  // Any new key or click is the person still at the board: the play since their last one
  // counts, and the idle clock starts over.
  if (msg.arm > lastArm || msg.ev.some(([n]) => n > lastSeq)) [next, run] = confirm(next, { ...run, inputAt: now })

  // A click on a board that was not in play is the person taking the keys: start, or go on.
  if (msg.arm > lastArm && (run.status === 'ready' || (run.status === 'paused' && !run.held))) run = goLive(run, now, true)

  for (const [n, raw] of msg.ev) {
    if (n <= lastSeq) continue
    if (raw.startsWith('click:')) {
      const [cx, cy, button] = raw.slice(6).split(',')
      if (run.status === 'live' && game.click && cx !== undefined && cy !== undefined && button !== undefined) {
        if (!game.realtime && run.liveSince === 0) run = { ...run, liveSince: now }
        run = { ...run, g: game.click(run.g, Number(cx), Number(cy), button) }
      }
      continue
    }
    // Only mapped keys act, and no map holds Enter, y, n or a digit (games.test.ts checks every map).
    const key = normalizeKey(raw)
    const shared = SHARED_KEYS[key]
    if (shared === 'pause') {
      if (run.status === 'live') [next, run] = leaveLive(next, run, now, 'paused', false, false)
      else if (run.status === 'paused' && !run.held) run = goLive(run, now, true)
      continue
    }
    if (shared === 'again') {
      if (run.status === 'over') return startGame({ ...next, run }, run.game, run.mode === 'practice', now)
      continue
    }
    const action = game.controls[key]
    if (action && run.status === 'live') {
      if (!game.realtime && run.liveSince === 0) run = { ...run, liveSince: now }
      run = { ...run, g: game.act(run.g, action) }
    }
  }

  if (msg.tick && run.status === 'live' && game.realtime && game.step) {
    if (now - run.inputAt >= IDLE_PAUSE_MS) {
      // Nobody has touched it in a while (Esc, or a walk-away): pause, which stops the
      // board's frame clock, and drop the idle stretch so it never counts as play.
      ;[next, run] = leaveLive(next, { ...run, pending: [0, 0] }, now, 'paused', false)
      return { ...next, run }
    }
    const dt = run.lastAt > 0 ? Math.max(0, Math.min(MAX_TICK_MS, now - run.lastAt)) : 0
    const wait = turnActive(next) ? dt : 0
    run = { ...run, lastAt: now, pending: [run.pending[0] + dt, run.pending[1] + wait], g: game.step(run.g, dt) }
  }

  if (run.status === 'live' && game.isOver(run.g)) return finish(next, run, now)
  return { ...next, run }
}

/** Whether a run's result still waits for its best to be compared and stored. */
export const unsaved = (s: HalftimeSession) => s.run?.status === 'over' && s.run.result !== null && !s.run.result.saved
