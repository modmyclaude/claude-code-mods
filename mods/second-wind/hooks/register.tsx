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

import { LONG_MS, frameAt, guideSpan, softFinish } from './breath'
import { GUIDE_SIZE, barCells, barWidth, fitHead, guideSvg, shownFill } from './draw'
import {
  CARD_TEXT, SAFETY, TICK_MS, USAGE, draftAfter, foldLine, planOf, readSettings, shareCard, statusText, unknownWord,
} from './settings'
import type { Settings } from './settings'
import { EMPTY_STATS, SWITCH_ON, addCounts, isOn, localDay, parseStats, parseSwitch } from './stats'
import type { Stats, Switch } from './stats'
import type { SecondWindDesk, SecondWindRun } from '../types'

const RUN = { plugin: 'second-wind', key: 'run' } as const
const NOW = { plugin: 'second-wind', key: 'now' } as const
const TYPING = { plugin: 'second-wind', key: 'isTyping' } as const
const CARD = { plugin: 'second-wind', key: 'card' } as const
const DESK = { plugin: 'second-wind', key: 'desk' } as const

const run = atom(RUN, null)
const clock = atom(NOW, 0)
const typing = atom(TYPING, false)
const card = atom(CARD, null)
const desk = atom(DESK, null)

/** A desktop guide drawn again this long after it was built is rebuilt from now, so the reload lands in step. */
const REBUILD_MS = 1500

const FADE_MS = 3000 // the fold line dims after this
const FOLD_MS = 6000 // and clears after this
const ACCENT = 'suggestion' // theme keys only: the band follows the person's theme
const QUIET = 'subtle'

type Spec = { kind: 'every' | 'after'; ms: number }

// The switch (`enabled`, which /config and the modmyclaude hub flip): off, Second Wind
// draws nothing, arms nothing and keeps no timer. The engine reloads the mod with the
// new value; the config.set hook below is the same switch at once. Not `isOn`, which
// is the /breathe on and off kept in the store.
let isEnabled = true
const OFF_TEXT = 'Second Wind is off. /mods or /config turns it on.'

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
// The main turn in flight, so a surface that attaches mid-turn can still arm it.
let mainTurn: { id: string; startedAt: number } | null = null

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
  // Switched off: a tick that still lands stops its timer instead.
  if (!isEnabled) {
    want($, null)
    return
  }
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
  await syncDesk($, cur, now)
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

/** What the desktop should draw for the run now: the guide for its span, the fold line, or nothing. */
function deskView(r: SecondWindRun | null, now: number): SecondWindDesk | null {
  if (r === null) return null
  if (r.phase === 'folded') {
    return r.fold === null ? null : { kind: 'fold', key: `fold:${r.fold.until}`, text: r.fold.text, isFaded: now >= r.fold.fadeAt }
  }
  const span = guideSpan(r, now)
  if (span === null) return null
  return {
    kind: 'guide',
    key: span.key,
    phase: r.phase === 'finishing' ? 'finishing' : 'breathing',
    at: now - span.offsetMs,
    segments: span.segments.map(s => ({ steps: s.steps.map(st => ({ phase: st.phase, ms: st.ms, from: st.from, to: st.to })), loop: s.loop, atMs: s.atMs })),
    pose: span.pose,
    words: span.words,
    label: span.label,
    still: span.still,
  }
}

/** What a desk view amounts to on screen: a write that changes nothing here is skipped. */
const deskKey = (v: SecondWindDesk | null): string => (v === null ? '' : v.kind === 'fold' ? `${v.key}:${v.isFaded}` : v.key)

/**
 * Writes the desktop's view when, and only when, it changed. Each write draws the
 * desktop band again, and the desktop re-sets the guide's frame on every draw
 * (seen live), so the view holds for a whole span of breathing.
 */
async function syncDesk($: EngineInterface, r: SecondWindRun | null, now: number): Promise<void> {
  const next = deskView(r, now)
  if (deskKey(next) !== deskKey(await read($, desk))) await $.state.set(DESK, next)
}

/** After a hot reload the run is still in $.state but its timer is gone. */
function heal($: EngineInterface, hasRun: boolean): void {
  if (!hasRun || timer !== null || isHealing) return
  isHealing = true
  $.clock.after(0, () => {
    isHealing = false
    void pump($)
  })
}

async function stop($: EngineInterface): Promise<void> {
  await $.state.set(RUN, null)
  await $.state.set(CARD, null)
  await $.state.set(DESK, null)
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

/** Who may turn the mod off or write the clipboard: the person typing. */
const PERSON_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])
const PERSON_ONLY: ReadonlySet<string> = new Set(['off', 'snooze', 'card'])

/** /breathe and its arguments. */
async function breathe($: EngineInterface, args: string, origin: string): Promise<{ text: string }> {
  const arg = args.trim().toLowerCase()
  if (PERSON_ONLY.has(arg) && !PERSON_ORIGINS.has(origin)) {
    return { text: `Second Wind only does /breathe ${arg} when you type it yourself.` }
  }
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

/** A main turn began: clear an unanswered card, and arm the turn's run. */
async function begin($: EngineInterface, turnId: string): Promise<void> {
  mainTurn = { id: turnId, startedAt: await $.clock.now() }
  if ((await read($, card)) !== null) await $.state.set(CARD, null)
  await arm($)
}

/**
 * Arms the main turn's run once something can draw it; safe to call again.
 * A plain -p run or an SDK host with no client attached draws nothing, so it
 * gets no run: no timer and no counts. A surface that
 * attaches mid-turn arms it then, and its breath starts no earlier than that.
 */
async function arm($: EngineInterface): Promise<void> {
  const t = mainTurn
  if (t === null) return
  const now = await $.clock.now()
  if (!isOn(await loadSwitch($), localDay(now))) return
  if ((await $.session.surfaces()).length === 0) return
  const fresh: SecondWindRun = {
    id: t.id, phase: 'waiting', turnStartedAt: t.startedAt, breathStartedAt: Math.max(t.startedAt + settings.delayMs, now),
    plan: planOf(settings), isLong: false, finish: null, fold: null,
  }
  await changeRun($, cur => {
    // Main turns never overlap and a subagent raises no turn.start, so a run
    // still waiting or breathing for another turn lost its turn.complete: it
    // is dropped uncounted, never inherited.
    if (cur !== null && (cur.phase === 'waiting' || cur.phase === 'breathing')) return cur.id === t.id ? cur : fresh
    // Asked again mid-exhale: carry on, now for this turn.
    if (cur !== null && cur.phase === 'finishing') return { ...cur, id: t.id, phase: 'breathing', finish: null }
    return fresh
  })
  await pump($)
}

/** Drops a run that no surface can show, or whose turn is gone, counting nothing. */
async function drop($: EngineInterface, r: SecondWindRun): Promise<void> {
  await changeRun($, cur => (cur?.id === r.id && cur.phase === r.phase ? null : cur))
  await pump($)
}

/** The main turn answered (or was interrupted): finish softly, or drop a run that never showed. */
async function end($: EngineInterface, turnId: string, isAborted: boolean): Promise<void> {
  mainTurn = null
  const now = await $.clock.now()
  const r = await read($, run)
  if (r === null || (r.phase !== 'waiting' && r.phase !== 'breathing')) return
  // Breaths count only for the turn that armed them: a run left over from a
  // turn whose own turn.complete never came is dropped, not folded in here.
  if (r.id !== turnId) return drop($, r)
  const isQuick = r.phase === 'waiting'
  const finish = softFinish(r.plan, now - r.breathStartedAt, isAborted)
  await changeRun($, cur => {
    if (cur?.id !== r.id || cur.phase !== r.phase) return cur
    return isQuick ? null : { ...cur, phase: 'finishing', finish: { at: now, ...finish } }
  })
  await pump($)
}

/** The desktop guide's markup for the span it was built for, and when. */
let guide: { key: string; source: string; shown: boolean; builtAt: number } = { key: '', source: '', shown: false, builtAt: 0 }

export const register: Register = (on, options) => {
  isEnabled = options.enabled !== false
  settings = readSettings(options)
  timer = null
  isBusy = false
  isAgain = false
  isHealing = false
  lastStatus = null
  isMirroring = false
  typingShown = undefined
  mainTurn = null

  // Off drops the breath in progress uncounted, as /breathe off does; on, the next turn shows it.
  on('config.set', { key: 'second-wind.enabled' }, async ($, e, next) => {
    const set = await next(e)
    if (set.deny === undefined && typeof set.value === 'boolean') {
      isEnabled = set.value
      if (!isEnabled) {
        mainTurn = null
        try {
          await stop($)
        } catch {
          // A tick that still lands stops its timer instead.
        }
      }
      $.ui.invalidate('ui.render')
    }
    return set
  })

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

  // The answer is for the person, not the model: a dim
  // transcript line Claude never reads, and an empty result.
  on('command.run', { command: 'breathe' }, async ($, e) => {
    if (!isEnabled) {
      $.ui.toast(OFF_TEXT)
      return {}
    }
    // One log line per line: the desktop app runs a multi-line log together.
    for (const line of (await breathe($, e.args, e.origin.kind)).text.split('\n')) $.ui.log(line)
    return {}
  }).catch(($) => {
    $.ui.log('Second Wind could not answer that just now.')
    return {}
  })

  // A client joining mid-turn (the desktop app, a phone) arms the turn it can now
  // show; one leaving the session with nothing attached drops the run uncounted.
  on('session.attach', async ($, e, next) => {
    const r = await next(e)
    try {
      await arm($)
    } catch {
      // The band waits for the next turn instead.
    }
    return r
  })

  on('session.detach', async ($, e, next) => {
    const r = await next(e)
    if (!isEnabled) return r
    try {
      const cur = await read($, run)
      if (cur !== null && (cur.phase === 'waiting' || cur.phase === 'breathing') && (await $.session.surfaces()).length === 0) await drop($, cur)
    } catch {
      // The turn's end clears it instead.
    }
    return r
  })

  // Only the main conversation raises turn.start: a subagent's run never does.
  on('turn.start', async ($, e, next) => {
    if (!isEnabled) return next(e)
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
    if (isEnabled && e.agentId === undefined) {
      try {
        await end($, e.turnId, e.isAborted)
      } catch {
        // The answer shows whatever happens here.
      }
    }
    return next(e)
  })

  // The band shrinks to one line while the person types. The prompt line says
  // whether the box holds a draft on the terminal and the desktop alike; the
  // desktop app draws its own composer and raises no prompt.edit. A render hook cannot write state, so the write waits one clock turn.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (!isEnabled) return next(e)
    const isDraft = e.props.isDraft
    if (isDraft !== typingShown) {
      $.clock.after(0, () => {
        if (isEnabled) noteTyping($, isDraft)
      })
    }
    return next(e)
  })

  // The terminal's own prompt box also reports each edit as it lands, a beat
  // before its prompt line redraws. Never awaited: the edit passes through
  // untouched and at once.
  on('prompt.edit', ($, e, next) => {
    if (isEnabled) noteTyping($, draftAfter(e).length > 0)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', ($, e, next) => {
    if (isEnabled) noteTyping($, false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isEnabled || e.props.hasSurvey) return next(e)

    // The desktop runs the guide in a frame of its own, and re-sets that frame on every draw of
    // the band, identical tree or not (seen live four times). So this path reads only
    // what changes at a span's edges: the desk view, the draft and the card. Never the per-tick
    // clock, never the run (its isLong flips at 60 s). With motion off it draws words like the
    // terminal, below.
    if (e.surface === 'desktop' && settings.motion !== 'still') {
      const view = await read($, desk)
      const isTyping = await read($, typing)
      const offered = await read($, card)
      if (view !== null && view.kind === 'guide' && view.phase === 'breathing' && !e.props.isWorking) {
        // Its turn.complete was lost (a reload at the wrong moment, a mod above that kept it):
        // draw nothing and stop its clock; the next turn.start drops it uncounted. A guide drawn
        // after this is a fresh frame, so it is rebuilt from now.
        guide = { ...guide, shown: false }
        want($, null)
        return next(e)
      }
      heal($, view !== null)
      const rest = await next(e)
      if (view === null && offered === null) return rest
      const { Box, Text, Button, Svg } = $.ui.resolve(e)
      const motion = settings.motion
      const rows: RenderNode[] = []
      if (offered !== null) {
        rows.push(
          <Box key="sw-card" flexDirection="row" gap={1}>
            <Text bold color={ACCENT} wrap="truncate-end">{CARD_TEXT[offered.kind]}</Text>
            <Button key="sw-did" label="Did it" variant="primary" onPress={() => answerCard($, true)} />
            <Button key="sw-skip" label="Skip" onPress={() => answerCard($, false)} />
          </Box>,
        )
      }
      if (view !== null && view.kind === 'fold') {
        rows.push(
          <Box key="sw-fold">
            <Text dimColor={view.isFaded} color={view.isFaded ? QUIET : undefined} wrap="truncate-end">{view.text}</Text>
          </Box>,
        )
      } else if (view !== null && (isTyping || e.props.maxRows < 3)) {
        // One quiet line while the next prompt is typed, or when the band has under three rows:
        // what holds for the span, never a countdown, so the line is drawn once.
        guide = { ...guide, shown: false }
        rows.push(
          <Box key="sw-compact">
            <Text dimColor wrap="truncate-end">{view.still ?? view.label}</Text>
          </Box>,
        )
      } else if (view !== null) {
        const now = await $.clock.now()
        const key = `${view.key}:${motion}`
        // Built once per span. A draw that lands later anyway (a card, a draft cleared, a resize)
        // loads the frame again, so it is rebuilt from now and lands in step instead of jumping back.
        if (guide.key !== key || !guide.shown || now - guide.builtAt > REBUILD_MS) {
          const source = guideSvg(view.segments, { motion, delayMs: Math.max(0, now - view.at), pose: view.pose, words: view.words })
          guide = { key, shown: true, builtAt: now, source }
        }
        rows.push(
          <Box key="sw-breath" flexDirection="row" gap={2} alignItems="center">
            <Svg key="sw-guide" source={guide.source} alt="Breathing guide" width={GUIDE_SIZE.width} height={GUIDE_SIZE.height} isInteractive />
            <Box key="sw-head" flexDirection="column">
              {view.still !== null ? (
                <Box key="sw-cue">
                  <Text bold color={ACCENT} wrap="truncate-end">{view.still}</Text>
                </Box>
              ) : null}
              <Box key="sw-caption">
                <Text dimColor>{view.label}</Text>
              </Box>
            </Box>
          </Box>,
        )
      }
      // What other mods draw here comes first.
      return (
        <Box key="second-wind" flexDirection="column">
          {rest}
          {rows}
        </Box>
      )
    }

    const r = await read($, run)
    const now = await read($, clock)
    const isTyping = await read($, typing)
    const offered = await read($, card)
    // A run still `breathing` while no turn works lost its turn.complete (a
    // reload at the wrong moment, a mod above that kept it): draw nothing for
    // it and stop its clock. A draw while a turn works wakes it; the next
    // turn.start drops it uncounted.
    const isOrphan = r !== null && r.phase === 'breathing' && !e.props.isWorking
    if (isOrphan) want($, null)
    else heal($, r !== null)
    const rest = await next(e)

    const frame = r !== null && !isOrphan ? frameAt(r, now) : null
    const folded = r !== null && r.phase === 'folded' ? r.fold : null
    if (frame === null && folded === null && offered === null) return rest

    const { Box, Text, Button } = $.ui.resolve(e)
    const cols = Math.max(1, Math.floor(e.props.bodyColumns))
    const motion = settings.motion
    const rows: RenderNode[] = []

    if (offered !== null) {
      // Click, or Tab and Enter: no hotkeys, as d and s are other band mods'
      // Dismiss, Deny, Done and Skip.
      rows.push(
        <Box key="sw-card" flexDirection="row" gap={1}>
          <Text bold color={ACCENT} wrap="truncate-end">{CARD_TEXT[offered.kind]}</Text>
          <Button key="sw-did" label="Did it" variant="primary" onPress={() => answerCard($, true)} />
          <Button key="sw-skip" label="Skip" onPress={() => answerCard($, false)} />
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
      if (motion !== 'still' && !isSmall) {
        const [left, body, right] = barCells(fill, barWidth(cols))
        shape = (
          <Box key="sw-shape" flexDirection="row">
            <Text color={QUIET}>{left}</Text>
            <Text color={ACCENT}>{body}</Text>
            <Text color={QUIET}>{right}</Text>
          </Box>
        )
      }
      if (isSmall) {
        const room = cols - frame.cue.length - 1
        const mini = e.surface === 'terminal' && motion !== 'still' && room >= 4 ? barCells(fill, Math.min(8, room)).join('') : null
        rows.push(
          <Box key="sw-compact" flexDirection="row" gap={1}>
            <Text dimColor wrap="truncate-end">{frame.cue}</Text>
            {mini !== null ? <Text dimColor>{mini}</Text> : null}
          </Box>,
        )
      } else {
        const head = fitHead(frame.cue, frame.caption, cols)
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
          <Box key="sw-breath" flexDirection="column">
            {words}
            {shape}
          </Box>,
        )
      }
    }

    // What other mods draw here comes first: a tight band
    // clips the breath, never another mod's hold or prompt.
    return (
      <Box key="second-wind" flexDirection="column">
        {rest}
        {rows}
      </Box>
    )
  })

  // The spinner carries the phase only in the terminal, and only when Claude Code shows nothing of
  // its own there. The desktop's turn row is left alone: swapping Claude's word in and out read as
  // flashing, and the band's guide already breathes (seen live).
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!isEnabled || e.props.message !== null || e.surface === 'desktop') return next(e)
    const r = await read($, run)
    if (r === null) return next(e)
    const frame = frameAt(r, await read($, clock))
    if (frame === null) return next(e)
    return next({ ...e, props: { ...e.props, word: frame.word } })
  })
}
