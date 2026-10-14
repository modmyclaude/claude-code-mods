// halftime: small games above the prompt while Claude works, and the whistle
// that hands the keyboard straight back the moment Claude needs you.
//
// The wiring lives here; the rules live in pure modules:
//   engine.ts  the session state machine (start, whistle, resume, input)
//   games/*    the four games, seeded and deterministic
//   view.ts    what the board shows; board.tsx only paints it
//   bests.ts   bests and totals in the store, compare-and-set
//   share.ts   the share line and the scorecard

import { atom, read, update } from 'claude-code'
import { boltSprite } from './bolt-draw'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { HalftimeGameId, HalftimeReason, HalftimeRun, HalftimeSession, HalftimeStats } from '../types'
import { addTotals, loadStats, saveBest, saveDaily, type Store } from './bests'
import {
  EMPTY_SESSION, close, countdownTick, needsYou, offer, onMessage, openPicker, parseMsg, pauseForTyping,
  resume, setPractice, showBoard, startGame, turnComplete, turnStart, unsaved, workAgain,
} from './engine'
import { GAME_IDS, gameOf, isGameId } from './games'
import { scorecard } from './share'
import { boardView } from './view'

const EMPTY_STATS: HalftimeStats = { auto: false, last: null, best: {}, daily: {}, playedMs: 0, waitPlayedMs: 0, runs: 0 }

const session = atom({ plugin: 'halftime', key: 'session' } as const, EMPTY_SESSION)
const stats = atom({ plugin: 'halftime', key: 'stats' } as const, EMPTY_STATS)

/** Auto mode offers a game once a main-loop turn has run this long. */
export const OFFER_AFTER_MS = 10_000
/** Owed play time is written to the store at least this often while a run is in play. */
const FLUSH_EVERY_MS = 60_000

const REASON_TEXT: Record<HalftimeReason, string> = {
  permission: 'a permission prompt - play comes back once Claude moves on',
  question: 'Claude has a question for you - play comes back once it moves on',
  input: 'a tool wants your input - play comes back once Claude moves on',
  turn: 'the turn is over - your move',
}

/** Which loop an event came from: '' for the main conversation, else the subagent's id. */
const loopOf = (id: unknown) => (typeof id === 'string' && id.length > 0 ? id : '')

/** The main conversation's turns only: a subagent's carry its `agentId` and change nothing. */
const isMain = (input: object) => loopOf((input as { agentId?: unknown }).agentId) === ''

const resumable = (run: HalftimeRun | null) => run !== null && run.status !== 'over'

// The switch (`enabled`, which /config and the modmyclaude hub flip): off, Halftime draws
// nothing, blows no whistle and keeps no timer. The engine reloads the mod with the new
// value; the config.set hook below is the same switch at once.
let isOn = true
const OFF_TEXT = 'Halftime is off. /mods or /config turns it on.'

/** The store as bests.ts reads it (every call still spelled `$.store.<op>(...)` here). */
const storeOf = ($: EngineInterface): Store => ({
  get: key => $.store.get(key),
  set: (key, value) => $.store.set(key, value),
})

/**
 * What the module keeps outside `$.state`: timers and in-flight guards, never
 * anything drawn. A reload starts a fresh environment (the old timers are
 * dropped with it) and `register` resets this.
 */
const mod = {
  countdown: null as Timer | null,
  offer: null as Timer | null,
  flushing: false,
  typing: false,
  saving: new Set<number>(),
}

/** The 3-2-1's tick. Switched off, a tick that still lands stops the countdown instead. */
function countdownTicked($: EngineInterface) {
  if (isOn) return void apply($, countdownTick)
  mod.countdown?.cancel()
  mod.countdown = null
}

/** One pure transition at the current time, then whatever it calls for. */
async function apply($: EngineInterface, change: (s: HalftimeSession, now: number) => HalftimeSession): Promise<HalftimeSession> {
  const now = await $.clock.now()
  const current = await read($, session)
  // A transition that changes nothing hands back the same object: no write, so nothing redraws.
  if (change(current, now) === current) return current
  let before = current
  const after = await update($, session, s => {
    before = s
    return change(s, now)
  })
  await followUp($, before, after)
  return after
}

async function followUp($: EngineInterface, before: HalftimeSession, after: HalftimeSession) {
  // The 3-2-1 is the only timer the hooks module runs during a run, and only while counting.
  const counting = after.phase === 'board' && after.run?.status === 'countdown'
  if (counting && !mod.countdown) mod.countdown = $.clock.every(1000, () => countdownTicked($))
  if (!counting && mod.countdown) {
    mod.countdown.cancel()
    mod.countdown = null
  }
  if (after.run && after.run.id !== before.run?.id) {
    await remember($, after.run.game)
  }
  if (unsaved(after) && after.run) await saveResult($, after.run.id)
  const leftPlay = before.run?.status === 'live' && after.run?.status !== 'live'
  if (after.owed[2] > 0 || after.owed[0] >= FLUSH_EVERY_MS || (leftPlay && after.owed[0] > 0)) await flush($)
}

async function remember($: EngineInterface, game: HalftimeGameId) {
  await $.store.set('last', game)
  await update($, stats, st => ({ ...st, last: game }))
}

/** Compares a finished run with the stored bests (re-read first) and records the outcome. */
async function saveResult($: EngineInterface, runId: number) {
  if (mod.saving.has(runId)) return
  mod.saving.add(runId)
  const run = (await read($, session)).run
  if (!run || run.id !== runId || !run.result) return
  const score = run.result.score
  let best = (await read($, stats)).best[run.game] ?? null
  let isBest = false
  if (score !== null) {
    const saved = await saveBest(storeOf($), run.game, score)
    best = saved.best
    isBest = saved.isBest
    const day = run.mode === 'daily' ? await saveDaily(storeOf($), run.game, run.day, score) : null
    await update($, stats, st => ({
      ...st,
      best: { ...st.best, [run.game]: saved.best },
      daily: day ? { ...st.daily, [run.game]: day } : st.daily,
    }))
  }
  await update($, session, s =>
    s.run && s.run.id === runId && s.run.result
      ? { ...s, run: { ...s.run, result: { ...s.run.result, best, isBest, saved: true } } }
      : s,
  )
}

/** Adds owed play time and runs to the stored totals; one flush at a time. */
async function flush($: EngineInterface) {
  if (mod.flushing) return
  mod.flushing = true
  try {
    const owed = (await read($, session)).owed
    if (owed[0] === 0 && owed[1] === 0 && owed[2] === 0) return
    const totals = await addTotals(storeOf($), owed)
    await update($, session, s => {
      const left: [number, number, number] = [s.owed[0] - owed[0], s.owed[1] - owed[1], s.owed[2] - owed[2]]
      return { ...s, owed: left }
    })
    await update($, stats, st => ({ ...st, ...totals }))
  } finally {
    mod.flushing = false
  }
}

/** The whistle, from any loop: freeze and hide the board. */
function whistle($: EngineInterface, reason: HalftimeReason, loop: string) {
  return apply($, (s, now) => needsYou(s, reason, loop, now))
}

/**
 * Pauses a run in play just after the current draw: a drawing never writes, so
 * a render hook that sees the keys leave the board schedules the pause instead.
 */
function pauseSoon($: EngineInterface) {
  $.clock.after(0, () => {
    if (isOn) void apply($, pauseForTyping)
  })
}

async function setAuto($: EngineInterface, auto: boolean) {
  await $.store.set('auto', auto)
  await update($, stats, st => ({ ...st, auto }))
}

/**
 * True while a surface that draws the band (the terminal or the desktop app) is
 * attached. VS Code, mobile and a `-p` run draw none (not isInteractive).
 */
async function banded($: EngineInterface): Promise<boolean> {
  const surfaces = await $.session.surfaces().catch(() => [])
  return surfaces.some(s => s === 'terminal' || s === 'desktop')
}

/** Runs `/halftime <args>` and says what happened, in one line for the person. */
async function command($: EngineInterface, args: string): Promise<string> {
  const [word = '', extra = ''] = args.trim().toLowerCase().split(/\s+/)
  if (word === '' || word === 'games' || word === 'pick') {
    await apply($, openPicker)
    return scorecard(await read($, stats))
  }
  if (isGameId(word)) {
    await apply($, (s, now) => startGame(s, word, extra === 'practice' || (extra !== 'daily' && s.practice), now))
    return `${word} is above the prompt - click the board (or ctrl+x tab, then a key) to play`
  }
  if (word === 'auto') {
    const current = (await read($, stats)).auto
    const auto = extra === 'on' ? true : extra === 'off' ? false : !current
    await setAuto($, auto)
    return auto
      ? `auto is on: once a turn has run ${OFFER_AFTER_MS / 1000}s, a line above the prompt offers a game (it never takes your keys)`
      : 'auto is off'
  }
  if (word === 'off' || word === 'close') {
    await apply($, close)
    return 'closed'
  }
  return `/halftime opens the picker; /halftime ${GAME_IDS.join('|')} [practice] starts one; /halftime auto [on|off]; /halftime off closes it`
}

async function copy($: EngineInterface, text: string, surface: 'terminal' | 'desktop' | 'mobile' | 'vscode') {
  const copied = await $.ui.copy({ text, surface })
  $.ui.toast(copied.isCopied ? 'result copied' : 'this surface cannot copy - select the line instead')
}

export const register: Register = (on, options) => {
  isOn = options.enabled !== false
  mod.countdown = null
  mod.offer = null
  mod.flushing = false
  mod.typing = false
  mod.saving.clear()

  // Off pauses a run in play and closes the band, as /halftime off does; on, /halftime opens it again.
  on('config.set', { key: 'halftime.enabled' }, async ($, e, next) => {
    const set = await next(e)
    if (set.deny === undefined && typeof set.value === 'boolean') {
      isOn = set.value
      if (!isOn) {
        mod.offer?.cancel()
        mod.offer = null
        try {
          await apply($, close)
        } catch {
          // A countdown tick that still lands stops it instead.
        }
      }
      $.ui.invalidate('ui.render')
    }
    return set
  })

  on('session.start', async ($, e, next) => {
    // Runs at once, mid-turn too: playing while Claude works is the point.
    await $.command.register({
      name: 'halftime',
      description: 'Play a small game above the prompt while Claude works',
      argumentHint: '[cratehop | tailchase | merge | sweep | auto | off]',
      immediate: true,
    })
    try {
      const loaded = await loadStats(storeOf($))
      await update($, stats, () => loaded)
    } catch (err) {
      $.ui.log(`halftime: could not read its store (${String(err)}); bests start empty`, { to: 'debug' })
    }
    // A reload keeps the session's state but not the old timers: pick a countdown back up.
    const s = await read($, session)
    if (isOn && s.phase === 'board' && s.run?.status === 'countdown' && !mod.countdown) mod.countdown = $.clock.every(1000, () => countdownTicked($))
    return next(e)
  })

  // The answer is for the person, never the model: a command's `text` is
  // a transcript row the model reads, so where the band draws, a toast says it and the
  // command answers {}. VS Code and mobile draw no band: there the row is the only place
  // to show anything, and the CommandOutput hook below draws the scorecard in it.
  on('command.run', { command: 'halftime' }, async ($, e) => {
    if (!isOn) {
      // Where no band is drawn (VS Code, mobile) the command's own row is the answer, as for the scorecard.
      if (!(await banded($))) return { text: OFF_TEXT }
      $.ui.toast(OFF_TEXT)
      return {}
    }
    const said = await command($, e.args)
    if (await banded($)) {
      $.ui.toast(said)
      return {}
    }
    return { text: scorecard(await read($, stats)) }
  }).catch($ => {
    try {
      $.ui.toast('that did not work - try /halftime again')
    } catch {
      // Nothing left to say it with.
    }
    return {}
  })

  // The band: picker, offer, board or whistle line.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isOn) return next(e)
    // A survey owns the band: yield it, and pause a run in play (the keys are the survey's now).
    if (e.props.hasSurvey) {
      const s = await read($, session)
      if (s.phase === 'board' && s.run?.status === 'live') pauseSoon($)
      return next(e)
    }
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const s = await read($, session)
    if (s.phase === 'off') return next(e)
    const { Box, Text, Button, Client } = $.ui.resolve(e)
    // Stack with what other mods draw here instead of replacing it. Their
    // lines sit above ours, so a tight band clips the game, never another mod's prompt.
    const below = await next(e)
    const hasBelow = below !== null && below !== undefined
    const stack = (mine: JSX.Element) =>
      hasBelow ? (
        <Box flexDirection="column">
          {below}
          {mine}
        </Box>
      ) : (
        mine
      )
    const st = await read($, stats)
    const now = await $.clock.now()
    const cols = Math.max(16, e.props.bodyColumns)

    const gameButtons = (prefix: string) =>
      GAME_IDS.map(g => (
        <Button
          key={`${prefix}:${g}`}
          label={g}
          {...(st.last === g ? { variant: 'primary' as const } : {})}
          onPress={() => apply($, (s2, t) => startGame(s2, g, s2.practice, t))}
        />
      ))
    const closeButton = <Button key="close" label="close" role="dismiss" dimColor onPress={() => apply($, close)} />

    if (s.phase === 'offer') {
      return stack(
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text>Claude is still working - play while you wait?</Text>
          {resumable(s.run) && s.run ? <Button key="offer:back" label={`back to ${s.run.game}`} onPress={() => apply($, showBoard)} /> : null}
          {gameButtons('offer')}
          <Button key="not-now" label="not now" dimColor onPress={() => apply($, close)} />
        </Box>
      )
    }

    if (s.phase === 'picker') {
      const run = s.run
      return stack(
        <Box flexDirection="row" columnGap={1}>
          {/* Bolt beside the picker: two rows tall, as the picker is. */}
          {boltSprite($.ui.resolve(e), e.surface, { size: 'tiny', pose: 'idle' }, 'bolt')}
          <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Text bold>halftime</Text>
            {gameButtons('pick')}
            {resumable(run) && run ? <Button key="resume" label={`back to ${run.game}`} onPress={() => apply($, showBoard)} /> : null}
            <Button key="mode" label={s.practice ? 'practice' : 'daily'} dimColor onPress={() => apply($, s2 => setPractice(s2, !s2.practice))} />
            <Button
              key="auto"
              label={st.auto ? 'auto: on' : 'auto: off'}
              dimColor
              onPress={async () => setAuto($, !(await read($, stats)).auto)}
            />
            {closeButton}
          </Box>
          <Text dimColor wrap="truncate-end">{scorecard(st)}</Text>
          </Box>
        </Box>
      )
    }

    if (s.phase === 'whistle') {
      const run = s.run
      const over = run?.status === 'over' && run.result ? run.result : null
      const line = (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text bold color="warning">whistle: Claude needs you</Text>
          <Text dimColor>- {REASON_TEXT[s.whistle ?? 'turn']}</Text>
          {s.whistle === 'turn' && resumable(run) ? <Button key="play-on" label="play on" onPress={() => apply($, resume)} /> : null}
          {over ? <Button key="copy" label="copy result" onPress={press => copy($, over.share, press.surface)} /> : null}
          {closeButton}
        </Box>
      )
      // The result stays on screen, so where copy has no clipboard (the desktop app)
      // the person can select it instead.
      return stack(
        over ? (
          <Box flexDirection="column">
            {line}
            <Text dimColor wrap="truncate-end">{over.share}</Text>
          </Box>
        ) : (
          line
        ),
      )
    }

    // The board.
    const run = s.run
    if (!run) return below
    const result = run.status === 'over' ? run.result : null
    // One row for the buttons under the board when there is room; a tight band keeps the board.
    const wanted = gameOf(run.game).rows + 3
    const roomy = e.props.maxRows >= wanted || result !== null || run.status !== 'live'
    const boardRows = Math.max(4, e.props.maxRows - (roomy ? 1 : 0) - (hasBelow ? 1 : 0))
    const props = boardView(run, st, cols, boardRows, now)
    return stack(
      <Box flexDirection="column">
        <Client key={`board-${run.id}-${run.epoch}`} module="./board.tsx" props={{ ...props, cells: e.surface === 'desktop' }} />
        {roomy ? (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {result ? <Text wrap="truncate-end">{result.share}</Text> : null}
            {result ? <Button key="copy" label="copy" onPress={press => copy($, result.share, press.surface)} /> : null}
            {result ? (
              <Button key="again" label="again" onPress={() => apply($, (s2, t) => startGame(s2, run.game, run.mode === 'practice', t))} />
            ) : null}
            <Button key="games" label="games" dimColor onPress={() => apply($, openPicker)} />
            {closeButton}
          </Box>
        ) : null}
      </Box>
    )
  })

  // VS Code and mobile have no band and no board: the command's row is the scorecard.
  on('ui.render', { component: 'CommandOutput', props: { command: 'halftime' } }, async ($, e, next) => {
    if (!isOn || (e.surface !== 'mobile' && e.surface !== 'vscode')) return next(e)
    const { Text } = $.ui.resolve(e)
    return (
      <Text wrap="truncate-end">
        {scorecard(await read($, stats))}
        <Text dimColor> (games play in the terminal and the desktop app)</Text>
      </Text>
    )
  })

  // Typing at the prompt means the keys left the board: a run in play pauses instead of
  // playing on unattended. Drawing never writes, so the pause is scheduled for just after.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (!isOn) return next(e)
    const isDraft = e.props.isDraft
    if (isDraft && !mod.typing) pauseSoon($)
    mod.typing = isDraft
    return next(e)
  }).catch(($, e, next) => next(e))

  // The board's posts: input and frame ticks. Off-shape data is dropped unread.
  on('ui.message', async ($, e, next) => {
    if (!isOn) return next(e)
    const msg = parseMsg(e.data)
    if (msg) await apply($, (s, now) => onMessage(s, msg, now))
    return next(e)
  })

  // Main-loop turns: start resumes from the whistle (3-2-1) and may arm the offer.
  on('turn.start', async ($, e, next) => {
    if (!isOn || !isMain(e)) return next(e)
    const s = await apply($, (s0, now) => turnStart(s0, e.turnId, now))
    mod.offer?.cancel()
    mod.offer = null
    if ((await read($, stats)).auto && s.phase === 'off') {
      const turnId = e.turnId
      mod.offer = $.clock.after(OFFER_AFTER_MS, () => void apply($, s2 => offer(s2, turnId)))
    }
    return next(e)
  })

  // ... and its end is the whistle: your move.
  on('turn.complete', async ($, e, next) => {
    if (!isOn || !isMain(e)) return next(e)
    mod.offer?.cancel()
    mod.offer = null
    await apply($, turnComplete)
    return next(e)
  })

  // Needs-you signals from any loop: a subagent's permission prompt needs you too. The
  // answer passes on unread, so a prompt another hook settles still blows the whistle;
  // play comes back when that step's tools finish.
  on('classic.PermissionRequest', async ($, e, next) => {
    if (!isOn) return next(e)
    await whistle($, 'permission', loopOf(e.agent_id))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Elicitation', async ($, e, next) => {
    if (!isOn) return next(e)
    await whistle($, 'input', loopOf(e.agent_id))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Notification', async ($, e, next) => {
    if (!isOn) return next(e)
    const kind = String(e.notification_type)
    if (/permission/.test(kind)) await whistle($, 'permission', loopOf(e.agent_id))
    else if (/elicitation/.test(kind)) await whistle($, 'input', loopOf(e.agent_id))
    return next(e)
  }).catch(($, e, next) => next(e))

  // A question for the person: observe it, never answer or deny it.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (!isOn) return next(e)
    await whistle($, 'question', loopOf(e.agentId))
    return next(e)
  }).catch(($, e, next) => next(e))

  // The loop that asked has its answer and moved on: Claude is working again.
  on('classic.PostToolBatch', async ($, e, next) => {
    if (!isOn) return next(e)
    const s = await read($, session)
    if (s.asking.includes(loopOf(e.agent_id))) await apply($, s0 => workAgain(s0, loopOf(e.agent_id)))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (!isOn) return next(e)
    try {
      await apply($, close)
    } catch {
      // Exits stay fast: the totals catch up next session.
    }
    return next(e)
  })
}

