// Crossroads: when Claude finishes a turn, three specific next prompts wait
// in a band above the prompt. 1, 2 or 3 in an empty prompt drafts one (it is
// never sent for you), 0 dismisses, and each item is a button too. The
// engine's own guess (the dim ghost text) is option 1 at no cost; a small
// model writes the rest from a compact, redacted digest of the turn.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, PromptFilled, PromptOrigin, Register, UiPressArgument } from 'claude-code'

import type { CrossroadsItem, CrossroadsKind, CrossroadsView } from '../types'
import {
  AGENT_POLL_MS,
  AGENT_WAIT_MS,
  ENGINE_WAIT_MS,
  MAX_TEXT,
  MAX_TOKENS,
  MODEL,
  TIMEOUT_MS,
  arrange,
  buildDigest,
  buildRequest,
  busyAgents,
  clean,
  clip,
  endsWithNumberedOptions,
  isTrivial,
  parseReply,
  pickSlashCommands,
  riskOf,
  sameText,
} from './logic'
import type { EngineGuess, Request } from './logic'
import {
  addUsage,
  coerceRecord,
  coerceUsage,
  dayOf,
  decideTurn,
  formatStatus,
  projectKey,
  recordOutcome,
  topKinds,
} from './learn'
import type { Outcome, ProjectRecord } from './learn'

const PLUGIN = 'crossroads'
const IDLE: CrossroadsView = { phase: 'idle' }
const view = atom({ plugin: 'crossroads', key: 'view' } as const, IDLE)

// Control flow the band never draws from (a hot reload starting it afresh is
// harmless). `epoch` moves on at every prompt and turn start: work begun for
// an older epoch is stale and its result is dropped.
const live = {
  epoch: 0,
  isTurnRunning: false,
  /** The epoch a list was last started for, so one turn never asks twice. */
  startedFor: -1,
  stop: undefined as AbortController | undefined,
  engine: undefined as { epoch: number; guess: EngineGuess } | undefined,
  nudge: undefined as (() => void) | undefined,
  /** The list on screen, kept to learn from what the person does next. */
  shown: undefined as { epoch: number; items: CrossroadsItem[] } | undefined,
  /** The suggestion the person took into the prompt (or copied), until they submit. */
  take: undefined as { text: string; kind: CrossroadsKind } | undefined,
  /** The small model was refused here (a blocked alias); said once, then quiet. */
  isModelRefused: false,
}

// The engine follows `$` only into functions declared at the top level of
// this file, so every helper that touches `$` lives out here.

function debug($: EngineInterface, text: string) {
  $.ui.log(`crossroads: ${text}`, { to: 'debug' })
}

/** The conversation moved on: drop in-flight work and wake anything waiting. */
function moveOn() {
  live.epoch += 1
  live.engine = undefined
  live.stop?.abort()
  live.stop = undefined
  live.nudge?.()
}

async function clearView($: EngineInterface) {
  await update($, view, () => IDLE)
}

/** Writes the band only while `at` is still the current epoch. */
async function showFor($: EngineInterface, at: number, next: CrossroadsView) {
  if (at !== live.epoch) return
  await update($, view, current => (at === live.epoch ? next : current))
}

async function isEnabled($: EngineInterface): Promise<boolean> {
  return (await $.store.get('enabled')) !== false
}

/** Waits `ms`, or less when something nudges (a guess arrived, an agent ended, the person moved on). */
function pause($: EngineInterface, ms: number): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      timer.cancel()
      if (live.nudge === done) live.nudge = undefined
      resolve()
    }
    const timer = $.clock.after(ms, done)
    live.nudge = done
  })
}

function engineGuessFor(at: number): EngineGuess | null {
  return live.engine?.epoch === at ? live.engine.guess : null
}

// The engine guesses only where a terminal draws the prompt (not on desktop),
// and not when its setting is off. Unknown counts as "may": waiting costs a
// few seconds, never a wrong answer.
async function engineMayGuess($: EngineInterface): Promise<boolean> {
  const surfaces = await $.session.surfaces()
  if (!surfaces.includes('terminal')) return false
  try {
    const rows = await $.config.list()
    const row = rows.find(one => one.kind === 'boolean' && /prompt.?suggest/i.test(`${one.key} ${one.label}`))

    return row?.value !== false
  } catch {
    return true
  }
}

/** True once no background subagent is running; false when the turn went stale or the wait hit its cap. */
async function awaitAgents($: EngineInterface, at: number): Promise<boolean> {
  const deadline = (await $.clock.now()) + AGENT_WAIT_MS
  for (;;) {
    if (at !== live.epoch) return false
    if (busyAgents(await $.agent.list()) === 0) return true
    if ((await $.clock.now()) >= deadline) return false
    await pause($, AGENT_POLL_MS)
  }
}

async function projectStoreKey($: EngineInterface): Promise<string> {
  return projectKey(await $.session.root())
}

// Read just before writing: another session may have written since (last write wins).
async function editRecord($: EngineInterface, change: (record: ProjectRecord) => ProjectRecord): Promise<ProjectRecord> {
  const key = await projectStoreKey($)
  const next = change(coerceRecord(await $.store.get(key)))
  await $.store.set(key, next)

  return next
}

/** The back-off decision for this eligible turn, stored as it is made. */
async function gateTurn($: EngineInterface): Promise<{ isAllowed: boolean; record: ProjectRecord }> {
  const key = await projectStoreKey($)
  const decided = decideTurn(coerceRecord(await $.store.get(key)))
  await $.store.set(key, decided.record)

  return decided
}

async function recordUsage($: EngineInterface, result: ModelCompleteResult) {
  const day = dayOf(await $.clock.now())
  await $.store.set('usage', addUsage(await $.store.get('usage'), day, result.usage))
}

async function refuseModel($: EngineInterface, why: string) {
  if (live.isModelRefused) return
  live.isModelRefused = true
  debug($, `model refused: ${why}`)
  $.ui.toast(`Crossroads: the small model is not available here (${clip(clean(why), 80)}). No suggestions this session.`)
}

async function readEnv($: EngineInterface): Promise<string | undefined> {
  try {
    return (await $.env.get('ANTHROPIC_DEFAULT_HAIKU_MODEL')) ?? (await $.env.get('ANTHROPIC_SMALL_FAST_MODEL'))
  } catch {
    return undefined
  }
}

// One small-model call, cancelled when the person moves on. The `haiku` alias
// can be refused (a gateway, an allowlist): then the provider's own small
// model id from the environment is tried once, and otherwise nothing runs.
type Answered = Extract<ModelCompleteResult, { isAnswered: true }>

async function askModel($: EngineInterface, request: Request): Promise<Answered | null> {
  const stop = new AbortController()
  live.stop = stop
  const ask = { ...request, maxTokens: MAX_TOKENS, effort: 'low', timeoutMs: TIMEOUT_MS } as const
  try {
    let result: ModelCompleteResult
    try {
      result = await $.model.complete({ ...ask, model: MODEL }, { signal: stop.signal })
    } catch (refusal) {
      const other = await readEnv($)
      if (other === undefined || other === MODEL) {
        await refuseModel($, String(refusal))

        return null
      }
      try {
        result = await $.model.complete({ ...ask, model: other }, { signal: stop.signal })
      } catch (again) {
        await refuseModel($, String(again))

        return null
      }
    }
    await recordUsage($, result)
    if (!result.isAnswered) debug($, `no suggestions: ${result.reason}`)

    return result.isAnswered ? result : null
  } finally {
    if (live.stop === stop) live.stop = undefined
  }
}

// After a main-loop answer: digest, gates, the engine's guess, one call, the band.
async function suggestAfterTurn($: EngineInterface, at: number, answer: string) {
  if (at !== live.epoch || live.startedFor === at) return
  live.startedFor = at
  try {
    if (live.isModelRefused || !(await isEnabled($))) return
    const messages = await $.session.messages()
    const listed = await $.command.list().catch(() => [])
    const digest = buildDigest(messages, answer, pickSlashCommands(messages, listed, PLUGIN))
    if (isTrivial(answer, digest.toolUses, digest.question)) return

    const { isAllowed, record } = await gateTurn($)
    if (!isAllowed) return debug($, 'backing off this turn')

    if (!(await awaitAgents($, at))) return
    await showFor($, at, { phase: 'loading', epoch: at })

    let engine = engineGuessFor(at)
    if (engine === null && (await engineMayGuess($))) {
      await pause($, ENGINE_WAIT_MS)
      engine = engineGuessFor(at)
    }
    if (at !== live.epoch) return

    const want = engine ? 2 : 3
    const request = buildRequest(digest, { want, already: engine?.text ?? null, topKinds: topKinds(record) })
    const result = await askModel($, request)
    // Submitted while the call ran: whatever came back is for a moment that has passed.
    if (at !== live.epoch) return
    const parsed = result ? parseReply(result.text, want) : null
    if (!parsed) return await clearView($)

    // A safe guess that arrived during the call still takes option 1 (ghost
    // and option 1 agree); a risky late one stays out of a list made without it.
    const late = engineGuessFor(at)
    const items = arrange(engine ?? (late && !late.risky ? late : null), parsed)
    live.shown = { epoch: at, items }
    await showFor($, at, { phase: 'shown', epoch: at, items, digits: !endsWithNumberedOptions(answer) })
  } catch (error) {
    debug($, `no suggestions: ${String(error)}`)
    if (at === live.epoch) await clearView($)
  }
}

// The engine's guess landed after the list was drawn without it: it takes
// option 1 so the ghost text and option 1 still agree. A risky guess is kept
// from the ghost text anyway, so it never displaces a safe suggestion.
function needsGuess(current: CrossroadsView, at: number): boolean {
  return current.phase === 'shown' && current.epoch === at && !current.items.some(item => item.fromEngine)
}

async function mergeLateGuess($: EngineInterface, at: number, guess: EngineGuess) {
  if (guess.risky || !needsGuess(await read($, view), at)) return
  await update($, view, current => {
    if (current.phase !== 'shown' || !needsGuess(current, at)) return current
    const items = arrange(guess, current.items.filter(item => !item.fromEngine))
    live.shown = { epoch: at, items }

    return { ...current, items }
  })
}

async function learn($: EngineInterface, outcome: Outcome) {
  await editRecord($, record => recordOutcome(record, outcome))
}

/** What the person did with the list, judged when they submit. */
function outcomeOf(
  text: string,
  shown: { items: CrossroadsItem[] } | undefined,
  take: { text: string; kind: CrossroadsKind } | undefined,
): Outcome | null {
  if (take) return { type: sameText(take.text, text) ? 'taken' : 'edited', kind: take.kind }
  if (!shown) return null
  const typed = shown.items.find(item => sameText(item.text, text))
  if (typed) return { type: 'taken', kind: typed.kind }

  return { type: 'ignored', kinds: shown.items.map(item => item.kind) }
}

/** A prompt the person sent: typed, from their phone or app, or through this band's Send. */
function isPersons(origin: PromptOrigin): boolean {
  return (
    origin.kind === 'composer' ||
    origin.kind === 'bridge' ||
    origin.kind === 'sdk' ||
    (origin.kind === 'plugin' && origin.name === PLUGIN)
  )
}

// A press on an item: draft it in the prompt. Where no prompt box can take it
// (the desktop app), copy it instead and offer an explicit Send.
async function pick($: EngineInterface, press: UiPressArgument, index: number) {
  const current = await read($, view)
  if (current.phase !== 'shown') return
  const item = current.items[index]
  if (!item) return
  let draft = ''
  try {
    draft = (await $.prompt.read()).text
  } catch {
    draft = ''
  }
  // Append, never replace: a click must not wipe what the person typed.
  const separator = draft !== '' && !/\s$/.test(draft) ? ' ' : ''
  let filled: PromptFilled | undefined
  try {
    filled = await $.prompt.fill({ text: separator + item.text, mode: 'append' })
  } catch {
    filled = undefined
  }
  if (filled?.refusal === 'dialog') {
    $.ui.toast('Crossroads: close the open dialog, then pick again.')

    return
  }
  live.take = { text: item.text, kind: item.kind }
  live.shown = undefined
  if (filled?.isFilled) {
    await clearView($)

    return
  }
  // No prompt box took it (the desktop app draws its own, `no_composer`):
  // copying is harmless whatever the cause, and Send waits for a press.
  let isCopied = false
  try {
    isCopied = (await $.ui.copy({ text: item.text, surface: press.surface })).isCopied
  } catch {
    isCopied = false
  }
  await update($, view, (): CrossroadsView => ({ phase: 'copied', epoch: current.epoch, item, isCopied }))
}

async function dismiss($: EngineInterface) {
  const shown = live.shown
  live.shown = undefined
  live.take = undefined
  await clearView($)
  if (shown) await learn($, { type: 'ignored', kinds: shown.items.map(item => item.kind) })
}

// The desktop fallback's Send: submits the copied suggestion as the person's
// own words, only on this explicit press. The band is cleared first, so a
// second press finds nothing to send.
async function send($: EngineInterface) {
  const taken: { item?: CrossroadsItem; epoch: number } = { epoch: live.epoch }
  await update($, view, current => {
    if (current.phase !== 'copied') return current
    taken.item = current.item
    taken.epoch = current.epoch

    return IDLE
  })
  const item = taken.item
  if (!item) return
  // Counted here, not by the prompt.submit hook (which may not see this
  // plugin's own submit), so the take is counted exactly once.
  live.take = undefined
  let refusal: string | undefined
  try {
    refusal = (await $.prompt.submit({ text: item.text, asUser: true })).drop
  } catch (error) {
    refusal = String(error)
  }
  if (refusal !== undefined) {
    $.ui.toast(`Crossroads: the prompt was not sent (${clip(clean(refusal), 80)}).`)
    live.take = { text: item.text, kind: item.kind }
    await update($, view, (): CrossroadsView => ({ phase: 'copied', epoch: taken.epoch, item, isCopied: true }))

    return
  }
  await learn($, { type: 'taken', kind: item.kind })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: PLUGIN,
      description: 'Next-step suggestions: today\'s calls and cost, or on / off / forget',
      argumentHint: '[on|off|forget]',
      immediate: true,
    })

    return next(e)
  })

  // A new turn: the old list is gone (a prompt's own hook has already judged it).
  on('turn.start', async ($, e, next) => {
    live.isTurnRunning = true
    live.shown = undefined
    live.take = undefined
    moveOn()
    await clearView($)

    return next(e)
  })

  // Subagents raise turn.complete too: only the main loop's answer gets a
  // list, and a subagent finishing only wakes a list waiting on it.
  on('turn.complete', ($, e, next) => {
    if (e.agentId !== undefined) {
      live.nudge?.()

      return next(e)
    }
    live.isTurnRunning = false
    if (e.reason === 'answer' && !e.isAborted) {
      const at = live.epoch
      const answer = e.answer
      // Detached on the clock, so the turn's end is never held up by the model.
      $.clock.after(0, () => void suggestAfterTurn($, at, answer))
    }

    return next(e)
  })

  // Anything submitted clears the band at once and makes in-flight work stale.
  // It never blocks a prompt: if learning fails, the prompt still goes in.
  on('prompt.submit', async ($, e, next) => {
    const shown = live.shown
    const take = live.take
    live.shown = undefined
    live.take = undefined
    moveOn()
    await clearView($)
    const entered = await next(e)
    if (entered.drop === undefined && isPersons(e.origin)) {
      const outcome = outcomeOf(e.text, shown, take)
      if (outcome) await learn($, outcome)
    }

    return entered
  }).catch(($, e, next) => next(e))

  // The engine's own guess: passed through untouched (it becomes option 1),
  // unless it is risky, in which case it never becomes the ghost text. Our
  // copy of it is cleaned: it is drawn in the band and may be drafted.
  on('prompt.suggest', async ($, e, next) => {
    if (e.origin.kind !== 'suggestion' || !(await isEnabled($))) return next(e)
    const text = clean(e.text)
    const guess: EngineGuess = { text, risky: riskOf(text) !== null }
    // A guess made while a turn runs belongs to no finished turn.
    if (!live.isTurnRunning) {
      const at = live.epoch
      live.engine = { epoch: at, guess }
      live.nudge?.()
      await mergeLateGuess($, at, guess)
    }

    return guess.risky ? { isShown: false } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { isShown: false }))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      moveOn()
      live.shown = undefined
      live.take = undefined
      await clearView($)
    }

    return next(e)
  })

  on('command.run', { command: PLUGIN }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off') {
      await $.store.set('enabled', false)
      moveOn()
      live.shown = undefined
      await clearView($)

      return { text: 'Crossroads is off. /crossroads on turns it back on.' }
    }
    if (arg === 'on') {
      await $.store.set('enabled', true)

      return { text: 'Crossroads is on. Suggestions appear after your next turn.' }
    }
    if (arg === 'forget') {
      await $.store.delete(await projectStoreKey($))

      return { text: 'Crossroads forgot what it had counted for this project.' }
    }
    if (arg !== '') return { text: 'Usage: /crossroads (calls and cost today), /crossroads on, /crossroads off, /crossroads forget' }
    const day = dayOf(await $.clock.now())
    const usage = coerceUsage(await $.store.get('usage'), day)
    const record = coerceRecord(await $.store.get(await projectStoreKey($)))

    return { text: formatStatus(await isEnabled($), usage, record) }
  }).catch(() => ({ text: 'Crossroads could not read its counts.' }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) return next(e)
    const current = await read($, view)
    if (current.phase === 'idle' || e.props.isWorking) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const width = Math.max(24, e.props.bodyColumns)
    // Every suggestion drawn below is untrusted (the model's, the engine's): it
    // passes through clean() here even when it was cleaned on the way in.
    // Stack on top of what other mods draw here instead of replacing it (API-GOTCHAS #25).
    const below = await next(e)
    const stack = (mine: JSX.Element) => (
      <Box flexDirection="column">
        {mine}
        {below}
      </Box>
    )

    if (current.phase === 'loading') return stack(<Text dimColor>crossroads: finding three ways forward...</Text>)

    if (current.phase === 'copied') {
      const { item, isCopied } = current

      return stack(
        <Box flexDirection="column">
          <Box>
            <Text dimColor>{isCopied ? 'Copied to your clipboard: ' : 'Could not copy it. The suggestion: '}</Text>
            <Text>{clip(clean(item.text), width)}</Text>
            {item.risk !== null && <Text color="warning">{` (${item.risk})`}</Text>}
          </Box>
          <Box columnGap={2}>
            <Button key="send" label="Send this prompt now" variant="secondary" onPress={() => void send($)} />
            <Button key="dismiss" label="Close" plain dimColor role="dismiss" onPress={() => void dismiss($)} />
          </Box>
        </Box>,
      )
    }

    const { items, digits } = current
    // One line when it fits, as "1: run the tests · 2: ... · 0: dismiss"; else one per row.
    const lineWidth =
      items.reduce((sum, item) => sum + 3 + item.text.length + (item.risk ? item.risk.length + 3 : 0) + 3, 0) + 12
    const isOneLine = lineWidth <= width
    const rows = items.map((item, index) => {
      const n = String(index + 1)
      const room = isOneLine ? MAX_TEXT : Math.max(12, width - 4 - (item.risk ? item.risk.length + 3 : 0))

      return (
        <Box key={`item-${n}`}>
          <Button
            key={`pick-${n}`}
            plain
            // A risky suggestion is click-only: one stray digit must never draft a push or deploy.
            {...(digits && item.risk === null ? { hotkey: n } : {})}
            label={clip(clean(item.text), room)}
            onPress={press => void pick($, press, index)}
          />
          {item.risk !== null && <Text color="warning">{` (${item.risk})`}</Text>}
          {isOneLine && <Text dimColor>{' · '}</Text>}
        </Box>
      )
    })

    return stack(
      <Box flexDirection={isOneLine ? 'row' : 'column'}>
        {rows}
        <Box>
          <Button
            key="dismiss"
            plain
            dimColor
            role="dismiss"
            {...(digits ? { hotkey: '0' } : {})}
            label="dismiss"
            onPress={() => void dismiss($)}
          />
          {!digits && <Text dimColor>{'  (number keys answer Claude this turn)'}</Text>}
        </Box>
      </Box>,
    )
  })
}
