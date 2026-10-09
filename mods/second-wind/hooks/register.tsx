// Second Wind: while the main conversation's turn runs, a calm band above the
// prompt guides a breath, an eye rest or a stretch, sized to the wait.
//
// The wiring: turn.start arms a run, a timer shows it after the delay, a
// clock timer redraws it while it is visible, turn.complete (main loop only)
// asks for a soft finish, and the fold line clears itself. Everything the
// band draws is computed from the wall clock ($.clock.now), never from how
// many frames ran. No files, processes, network or model calls.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode, Timer } from 'claude-code'

import { LONG_MS, frameAt, softFinish } from './breath'
import { barCells, barWidth, circleSvg, fitHead, shownFill } from './draw'
import {
  CARD_TEXT, SAFETY, TICK_MS, USAGE, draftAfter, foldLine, planOf, readSettings, shareCard, statusText, unknownWord,
} from './settings'
import type { Settings } from './settings'
import { EMPTY_STATS, SWITCH_ON, addCounts, isOn, localDay, parseStats, parseSwitch } from './stats'
import type { Stats, Switch } from './stats'
import type { SecondWindRun } from '../types'

const RUN = { plugin: 'second-wind', key: 'run' } as const
const NOW = { plugin: 'second-wind', key: 'now' } as const
const TYPING = { plugin: 'second-wind', key: 'isTyping' } as const
const CARD = { plugin: 'second-wind', key: 'card' } as const

const run = atom(RUN, null)
const clock = atom(NOW, 0)
const typing = atom(TYPING, false)
const card = atom(CARD, null)

const FADE_MS = 3000 // the fold line dims after this
const FOLD_MS = 6000 // and clears after this
const ACCENT = 'suggestion' // theme keys only: the band follows the person's theme
const QUIET = 'subtle'

type Spec = { kind: 'every' | 'after'; ms: number }

// Bookkeeping for this load of the module, reset by register(). A hot reload
// drops it with the timers it names; `heal` restarts them from $.state.
let settings: Settings = readSettings({})
let timer: (Spec & { handle: Timer }) | null = null
let isBusy = false
let isAgain = false
let isHealing = false
let lastStatus: string | null = null
let isMirroring = false
let typingShown: boolean | undefined

/** The one timer a run needs next: none when idle, a tick only while it moves. */
export function timerFor(r: SecondWindRun | null, now: number, tickMs: number): Spec | null {
  if (r === null) return null
  switch (r.phase) {
    case 'waiting':
      return { kind: 'after', ms: Math.max(0, r.breathStartedAt - now) }
    case 'breathing':
    case 'finishing':
      return { kind: 'every', ms: tickMs }
    case 'folded': {
      if (r.fold === null) return { kind: 'after', ms: 0 }
      const at = now < r.fold.fadeAt ? r.fold.fadeAt : r.fold.until
      return { kind: 'after', ms: Math.max(0, at - now) }
    }
  }
}

/** `update` on the run, typed so the phase literals hold. */
const changeRun = ($: EngineInterface, fn: (cur: SecondWindRun | null) => SecondWindRun | null): Promise<SecondWindRun | null> =>
  update($, run, fn)

async function loadStats($: EngineInterface): Promise<Stats> {
  try {
    return parseStats(await $.store.get('stats'))
  } catch {
    return EMPTY_STATS
  }
}

async function loadSwitch($: EngineInterface): Promise<Switch> {
  try {
    return parseSwitch(await $.store.get('switch'))
  } catch {
    return SWITCH_ON
  }
}

function want($: EngineInterface, spec: Spec | null): void {
  if (spec === null) {
    timer?.handle.cancel()
    timer = null
    return
  }
  if (timer !== null && timer.kind === 'every' && spec.kind === 'every' && timer.ms === spec.ms) return
  timer?.handle.cancel()
  if (spec.kind === 'every') {
    timer = { ...spec, handle: $.clock.every(spec.ms, () => void pump($)) }
    return
  }
  const mine: Spec & { handle: Timer } = {
    ...spec,
    handle: $.clock.after(spec.ms, () => {
      if (timer === mine) timer = null
      void pump($)
    }),
  }
  timer = mine
}

/** Runs `step` one at a time; a call that lands mid-step runs it once more after. */
async function pump($: EngineInterface): Promise<void> {
  if (isBusy) {
    isAgain = true
    return
  }
  isBusy = true
  try {
    do {
      isAgain = false
      await step($)
    } while (isAgain)
  } catch {
    // A failed step leaves the timer as it was; the next tick tries again.
  } finally {
    isBusy = false
  }
}

/** Moves the run along by the wall clock, publishes the time, and picks the next timer. */
async function step($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const r = await read($, run)
  if (r !== null) {
    if (r.phase === 'waiting' && now >= r.breathStartedAt) {
      await changeRun($, cur => (cur?.id === r.id && cur.phase === 'waiting' ? { ...cur, phase: 'breathing' } : cur))
    } else if (r.phase === 'breathing' && !r.isLong && now - r.turnStartedAt > LONG_MS) {
      await markLong($, r.id)
    } else if (r.phase === 'finishing' && r.finish !== null && now >= r.finish.at + r.finish.ms) {
      await fold($, r, now)
    } else if (r.phase === 'folded' && (r.fold === null || now >= r.fold.until)) {
      await changeRun($, cur => (cur?.id === r.id && cur.phase === 'folded' ? null : cur))
    }
  }
  await $.state.set(NOW, now)
  const cur = await read($, run)
  const text = cur === null ? null : cur.phase === 'folded' ? (cur.fold?.text ?? null) : (frameAt(cur, now)?.cue ?? null)
  await mirrorStatus($, text)
  want($, timerFor(cur, now, TICK_MS[settings.motion]))
}

/** The turn passed 60 seconds: count a long turn, and maybe offer the movement card. */
async function markLong($: EngineInterface, id: string): Promise<void> {
  await changeRun($, cur => (cur?.id === id ? { ...cur, isLong: true } : cur))
  try {
    const stats = await loadStats($)
    const next: Stats = { ...stats, longTurns: stats.longTurns + 1 }
    await $.store.set('stats', next)
    if (settings.movementCard && next.longTurns % 5 === 0) {
      await $.state.set(CARD, { kind: (next.longTurns / 5) % 2 === 1 ? 'stand' : 'squats' })
    }
  } catch {
    // Counting is best effort; the breath goes on.
  }
}

/** The closing exhale is done: record the counts and fold into one line. */
async function fold($: EngineInterface, r: SecondWindRun, now: number): Promise<void> {
  const f = r.finish
  const day = localDay(now)
  let stats: Stats | null = null
  if (f !== null && f.breaths > 0) {
    try {
      stats = addCounts(await loadStats($), day, { breaths: f.breaths, eyeRests: f.eyeRests, stretches: f.stretches })
      await $.store.set('stats', stats)
    } catch {
      stats = null // the line still says this turn's breaths
    }
  }
  await changeRun($, cur => {
    if (cur?.id !== r.id || cur.phase !== 'finishing') return cur
    if (f === null || f.breaths === 0) return null // nothing worth a line: clear quietly
    return { ...cur, phase: 'folded', fold: { text: foldLine(f.breaths, stats, day), fadeAt: now + FADE_MS, until: now + FOLD_MS } }
  })
}

/** Mobile and VS Code draw neither the band nor the spinner: there the cue rides the status line. */
async function mirrorStatus($: EngineInterface, text: string | null): Promise<void> {
  if (text === lastStatus) return
  lastStatus = text
  let isRemoteOnly = false
  if (text !== null) {
    try {
      const surfaces = await $.session.surfaces()
      isRemoteOnly = surfaces.length > 0 && !surfaces.some(s => s === 'terminal' || s === 'desktop')
    } catch {
      isRemoteOnly = false
    }
  }
  if (isRemoteOnly && text !== null) {
    $.ui.status(text)
    isMirroring = true
  } else if (isMirroring) {
    $.ui.status(undefined)
    isMirroring = false
  }
}

/** After a hot reload the run is still in $.state but its timer is gone. */
function heal($: EngineInterface, r: SecondWindRun | null): void {
  if (r === null || timer !== null || isHealing) return
  isHealing = true
  $.clock.after(0, () => {
    isHealing = false
    void pump($)
  })
}

async function stop($: EngineInterface): Promise<void> {
  await $.state.set(RUN, null)
  await $.state.set(CARD, null)
  want($, null)
  await mirrorStatus($, null)
}

/** Typing never waits on this: the write is fired and forgotten, and only when the answer changes. */
function noteTyping($: EngineInterface, isTyping: boolean): void {
  if (typingShown === isTyping) return
  typingShown = isTyping
  $.state.set(TYPING, isTyping).catch(() => {
    typingShown = undefined
  })
}

async function answerCard($: EngineInterface, didIt: boolean): Promise<void> {
  await $.state.set(CARD, null)
  if (!didIt) return
  try {
    const now = await $.clock.now()
    await $.store.set('stats', addCounts(await loadStats($), localDay(now), { moves: 1 }))
  } catch {
    // The card is gone either way.
  }
}

async function saveSwitch($: EngineInterface, next: Switch): Promise<boolean> {
  try {
    await $.store.set('switch', next)
    return true
  } catch {
    return false
  }
}

const NOT_SAVED = 'Second Wind could not save that. Try again.'

async function copyCard($: EngineInterface, text: string): Promise<string> {
  try {
    const r = await $.ui.copy({ text })
    if (r.isCopied) return `Copied your stats card:\n\n${text}`
    return `Could not copy it (${r.reason}). Here it is to copy by hand:\n\n${text}`
  } catch {
    return `Could not copy it. Here it is to copy by hand:\n\n${text}`
  }
}

/** /breathe and its arguments. */
async function breathe($: EngineInterface, args: string): Promise<{ text: string }> {
  const arg = args.trim().toLowerCase()
  const now = await $.clock.now()
  const day = localDay(now)
  const sw = await loadSwitch($)
  noteTyping($, false)
  switch (arg) {
    case '':
    case 'stats':
    case 'status':
      return { text: statusText(await loadStats($), sw, day, settings) }
    case 'help':
      return { text: `Second Wind guides a breath, an eye rest or a stretch while Claude works.\n${USAGE}\n${SAFETY}` }
    case 'off':
      if (!(await saveSwitch($, { ...sw, off: true }))) return { text: NOT_SAVED }
      await stop($)
      return { text: 'Second Wind is off. /breathe on brings it back.' }
    case 'on':
      if (!(await saveSwitch($, SWITCH_ON))) return { text: NOT_SAVED }
      return { text: `Second Wind is on. It shows once a turn has run ${settings.delayMs / 1000}s.` }
    case 'snooze':
      if (!(await saveSwitch($, { ...sw, snoozeDay: day }))) return { text: NOT_SAVED }
      await stop($)
      return { text: 'Second Wind is snoozed for the rest of today. /breathe on brings it back sooner.' }
    case 'card':
      return { text: await copyCard($, shareCard(await loadStats($), day)) }
    default:
      return { text: unknownWord(arg) }
  }
}

/** A main turn began: arm a run, or keep the one already breathing. */
async function begin($: EngineInterface, turnId: string): Promise<void> {
  const now = await $.clock.now()
  if (!isOn(await loadSwitch($), localDay(now))) return
  if ((await read($, card)) !== null) await $.state.set(CARD, null)
  const fresh: SecondWindRun = {
    id: turnId, phase: 'waiting', turnStartedAt: now, breathStartedAt: now + settings.delayMs,
    plan: planOf(settings), isLong: false, finish: null, fold: null,
  }
  await changeRun($, cur => {
    if (cur !== null && (cur.phase === 'waiting' || cur.phase === 'breathing')) return cur // already breathing: never restart
    if (cur !== null && cur.phase === 'finishing') return { ...cur, phase: 'breathing', finish: null } // asked again mid-exhale: carry on
    return fresh
  })
  await pump($)
}

/** The main turn answered (or was interrupted): finish softly, or drop a run that never showed. */
async function end($: EngineInterface, isAborted: boolean): Promise<void> {
  const now = await $.clock.now()
  const r = await read($, run)
  if (r === null || (r.phase !== 'waiting' && r.phase !== 'breathing')) return
  const isQuick = r.phase === 'waiting'
  const finish = softFinish(r.plan, now - r.breathStartedAt, isAborted)
  await changeRun($, cur => {
    if (cur?.id !== r.id || cur.phase !== r.phase) return cur
    return isQuick ? null : { ...cur, phase: 'finishing', finish: { at: now, ...finish } }
  })
  await pump($)
}

export const register: Register = (on, options) => {
  settings = readSettings(options)
  timer = null
  isBusy = false
  isAgain = false
  isHealing = false
  lastStatus = null
  isMirroring = false
  typingShown = undefined

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'breathe',
        description: "Second Wind: today's breaths and settings, or on, off, snooze, card",
        argumentHint: '[on|off|snooze|card|help]',
        immediate: true,
      })
    } catch {
      // Without the command the band still works.
    }
    return next(e)
  })

  on('command.run', { command: 'breathe' }, ($, e) => breathe($, e.args)).catch(() => ({
    text: 'Second Wind could not answer that just now.',
  }))

  // Only the main conversation raises turn.start: a subagent's run never does.
  on('turn.start', async ($, e, next) => {
    try {
      await begin($, e.turnId)
    } catch {
      // The turn runs whatever happens here.
    }
    return next(e)
  })

  // A subagent's completion carries its agentId and is ignored: only the main
  // loop's answer folds the band.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      try {
        await end($, e.isAborted)
      } catch {
        // The answer shows whatever happens here.
      }
    }
    return next(e)
  })

  // The band shrinks to one line while the person types. Never awaited: the
  // edit passes through untouched and at once.
  on('prompt.edit', ($, e, next) => {
    noteTyping($, draftAfter(e).length > 0)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', ($, e, next) => {
    noteTyping($, false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const r = await read($, run)
    const now = await read($, clock)
    const isTyping = await read($, typing)
    const offered = await read($, card)
    heal($, r)
    const rest = await next(e)

    // A run still `breathing` while no turn works was orphaned (a reload at the
    // wrong moment): draw nothing for it.
    const frame = r !== null && !(r.phase === 'breathing' && !e.props.isWorking) ? frameAt(r, now) : null
    const folded = r !== null && r.phase === 'folded' ? r.fold : null
    if (frame === null && folded === null && offered === null) return rest

    const { Box, Text, Button } = $.ui.resolve(e)
    const cols = Math.max(1, Math.floor(e.props.bodyColumns))
    const motion = settings.motion
    const rows: RenderNode[] = []

    if (offered !== null) {
      rows.push(
        <Box key="sw-card" flexDirection="row" gap={1}>
          <Text bold color={ACCENT} wrap="truncate-end">{CARD_TEXT[offered.kind]}</Text>
          <Button key="sw-did" label="Did it" hotkey="d" variant="primary" onPress={() => answerCard($, true)} />
          <Button key="sw-skip" label="Skip" hotkey="s" onPress={() => answerCard($, false)} />
        </Box>,
      )
    }

    if (folded !== null) {
      const isFaded = motion !== 'still' && now >= folded.fadeAt
      rows.push(
        <Box key="sw-fold">
          <Text dimColor={isFaded} color={isFaded ? QUIET : undefined} wrap="truncate-end">{folded.text}</Text>
        </Box>,
      )
    } else if (frame !== null) {
      const fill = shownFill(frame.fill, motion)
      // One quiet line while the next prompt is typed, or when the band has under three rows to give.
      const isSmall = isTyping || e.props.maxRows < 3
      let shape: RenderNode | null = null
      if (motion !== 'still') {
        if (e.surface === 'desktop') {
          const { Svg } = $.ui.resolve(e)
          const svg = circleSvg(frame.step, fill, motion, isSmall ? 16 : 40)
          shape = <Svg source={svg.source} alt={`Breathing guide: ${frame.word}`} isInteractive={svg.isInteractive} />
        } else if (!isSmall) {
          const [left, body, right] = barCells(fill, barWidth(cols))
          shape = (
            <Box key="sw-shape" flexDirection="row">
              <Text color={QUIET}>{left}</Text>
              <Text color={ACCENT}>{body}</Text>
              <Text color={QUIET}>{right}</Text>
            </Box>
          )
        }
      }
      if (isSmall) {
        const room = cols - frame.cue.length - 1
        const mini = e.surface === 'terminal' && motion !== 'still' && room >= 4 ? barCells(fill, Math.min(8, room)).join('') : null
        rows.push(
          <Box key="sw-compact" flexDirection="row" gap={1}>
            {e.surface === 'desktop' ? shape : null}
            <Text dimColor wrap="truncate-end">{frame.cue}</Text>
            {mini !== null ? <Text dimColor>{mini}</Text> : null}
          </Box>,
        )
      } else {
        const head = fitHead(frame.cue, frame.caption, e.surface === 'desktop' && shape !== null ? Math.max(1, cols - 6) : cols)
        const words = (
          <Box key="sw-head" flexDirection="row">
            <Box key="sw-cue">
              <Text bold color={ACCENT} wrap="truncate-end">{head.cue}</Text>
            </Box>
            {head.caption !== null ? (
              <Box key="sw-caption" marginLeft={2}>
                <Text dimColor>{head.caption}</Text>
              </Box>
            ) : null}
          </Box>
        )
        rows.push(
          e.surface === 'desktop' && shape !== null ? (
            <Box key="sw-breath" flexDirection="row" gap={1} alignItems="center">
              {shape}
              {words}
            </Box>
          ) : (
            <Box key="sw-breath" flexDirection="column">
              {words}
              {shape}
            </Box>
          ),
        )
      }
    }

    return (
      <Box key="second-wind" flexDirection="column">
        {rows}
        {rest}
      </Box>
    )
  })

  // The spinner carries the phase only when Claude Code shows nothing of its
  // own there: no status message, and on the desktop no step of its own.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.props.message !== null) return next(e)
    if (e.surface === 'desktop' && e.props.word !== 'Working') return next(e)
    const r = await read($, run)
    if (r === null) return next(e)
    const frame = frameAt(r, await read($, clock))
    if (frame === null) return next(e)
    return next({ ...e, props: { ...e.props, word: frame.word } })
  })
}
