// ant-farm: watch your subagents work, and what they cost, live.
//
// Every model request (`turn.step`) is counted against the loop it ran in:
// a subagent (started at `agent.spawn`, finished at its `turn.complete`), the
// main loop, or another loop the engine runs. Per-subagent costs come from a
// small price table and are always estimates; the session's total and the
// budget alarm use Claude Code's own cost estimate (what /cost shows), with the
// table's estimate as the fallback where the engine gives none. While
// anything runs, one clock ticks to walk the ants and the timers; when
// everything is idle it stops.

import { atom, read, update } from 'claude-code'
import type { AgentStatus, EngineInterface, Register, TextProps, Timer, TurnStepResult } from 'claude-code'

import type { AntFarmAnt, AntFarmLoops, AntFarmStatus, AntFarmUsage } from '../types'
import { addRequest, budgetLevel, NO_USAGE, sumUsage } from './prices'
import { boltSprite } from './bolt-draw'
import { glyphRow } from './cells'
import {
  alarmText, ANT_WIDTH, antRows, bar, clean, fmtCost, fmtDuration, fmtEta, fmtTokens, fmtUsd, miniAnt,
  modelColors, nextAlarm, phaseOf, progressOf, shortModel, spendLabel, spendOf, statusText, trimAnts,
  viewAfterClose,
} from './show'
import type { Spend } from './show'

const PANE = 'ant-farm'
const TITLE = 'Ant farm'
/** One frame of the ants, and of every elapsed time shown. */
const TICK_MS = 500
/** Narrower than this, the pane keeps every column for the farm and Bolt steps out. */
const BOLT_MIN_COLUMNS = 40
/** Every this many ticks, running ants are checked against the engine's agent list. */
const RECONCILE_TICKS = 20
const MAX_ANTS = 200
/** The finished subagents the pane lists one by one; the rest are counted. */
const MAX_FINISHED_SHOWN = 50
/** A running ant silent this long (no request) no longer keeps the clock ticking on its own. */
const STALL_MS = 10 * 60_000

const ants = atom({ plugin: 'ant-farm', key: 'ants' } as const, [])
const loops = atom({ plugin: 'ant-farm', key: 'loops' } as const, { main: NO_USAGE, other: NO_USAGE })
const turn = atom({ plugin: 'ant-farm', key: 'turn' } as const, { isRunning: false, startedAt: 0 })
const alarm = atom({ plugin: 'ant-farm', key: 'alarm' } as const, { level: 0, budgetUsd: -1 })
const engineUsd = atom({ plugin: 'ant-farm', key: 'engineUsd' } as const, null)
const view = atom({ plugin: 'ant-farm', key: 'view' } as const, {
  isListInBand: false,
  isFinishedExpanded: false,
  isClosedByHand: false,
  hasOpenedUnasked: false,
})

const isRunning = (a: AntFarmAnt) => a.status === 'running'
// The untrusted texts of an ant, cleaned for drawing.
const taskOf = (a: AntFarmAnt) => clean(a.task)
const modelOf = (a: AntFarmAnt) => clean(shortModel(a.model) || a.type)

function sessionTotal(list: readonly AntFarmAnt[], l: AntFarmLoops): AntFarmUsage {
  return sumUsage([...list.map(a => a.usage), l.main, l.other])
}

/** Running first (oldest on top), then finished (latest on top). */
function ordered(list: readonly AntFarmAnt[]) {
  const running = list.filter(isRunning).sort((a, b) => a.startedAt - b.startedAt)
  const finished = list
    .filter(a => !isRunning(a))
    .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
  return { running, finished }
}

function endStatus(s: AgentStatus | undefined): AntFarmStatus | undefined {
  if (s === undefined || s === 'completed' || s === 'idle') return 'done'
  if (s === 'failed' || s === 'killed') return 'failed'
  return undefined
}

// Module variables hold only what a reload may lose: the options, the timer
// (a reload cancels it anyway), the last status text and a cache of loop ids.
// Helpers that take `$` live here at the top of the file, where the engine
// can follow `$` into them.
let budgetUsd = 2
let ticker: Timer | undefined
let ticks = 0
let docksPanes: boolean | undefined
let lastStatus: string | undefined
const notAgents = new Set<string>()

function stopTicker() {
  ticker?.cancel()
  ticker = undefined
}

function startTicker($: EngineInterface) {
  if (ticker === undefined) ticker = $.clock.every(TICK_MS, () => void tick($))
}

async function tick($: EngineInterface) {
  ticks += 1
  try {
    if (ticks % RECONCILE_TICKS === 0) await reconcile($)
    const now = await $.clock.now()
    const busy =
      (await read($, turn)).isRunning ||
      (await read($, ants)).some(a => isRunning(a) && now - (a.lastActiveAt ?? a.startedAt) < STALL_MS)
    if (!busy) stopTicker()
    $.ui.invalidate('ui.render')
  } catch {
    // A tick that fails only skips a frame.
  }
}

// A background subagent stopped from outside may never raise its
// turn.complete: the engine's own list settles it, so no ant runs forever.
async function reconcile($: EngineInterface) {
  const now = await $.clock.now()
  const suspects = (await read($, ants)).filter(a => isRunning(a) && !a.isWorkflow && now - a.startedAt > 5000)
  if (suspects.length === 0) return
  const listed = new Map((await $.agent.list()).map(info => [info.id, info.status] as const))
  const ended = new Map<string, AntFarmStatus>()
  for (const a of suspects) {
    const status = endStatus(listed.get(a.id))
    if (status !== undefined) ended.set(a.id, status)
  }
  if (ended.size === 0) return
  await update($, ants, list =>
    list.map(a => (isRunning(a) && ended.has(a.id) ? { ...a, status: ended.get(a.id) ?? 'done', endedAt: now } : a)),
  )
}

// Claude Code's own cost estimate for the session, or null where the host keeps
// no ledger or the call fails: the table's estimate stands in then.
async function engineTotal($: EngineInterface): Promise<number | null> {
  try {
    const usd = (await $.session.usage()).cost?.usd
    return typeof usd === 'number' && Number.isFinite(usd) ? usd : null
  } catch {
    return null
  }
}

/** The session's spend as drawn: the engine total last read, else the estimate. */
async function sessionSpend($: EngineInterface): Promise<Spend> {
  return spendOf(await read($, engineUsd), sessionTotal(await read($, ants), await read($, loops)))
}

// The status line and the alarm, after every counted request and turn end.
async function announce($: EngineInterface) {
  const usd = await engineTotal($)
  // A failed read keeps the last good total, so one hiccup cannot drop the
  // figure to the estimate and re-arm the alarm. Compared by value: state
  // crosses as JSON.
  if (usd !== null && usd !== (await read($, engineUsd))) await update($, engineUsd, () => usd)
  const spend = await sessionSpend($)
  const level = budgetLevel(spend.usd, budgetUsd)
  const text = statusText(spend, budgetUsd, level)
  if (text !== lastStatus) {
    lastStatus = text
    $.ui.status(text === undefined ? undefined : clean(text))
  }
  // nextAlarm alone decides; the read first only skips a write that would change nothing.
  const stored = await read($, alarm)
  const preview = nextAlarm(stored, level, budgetUsd)
  if (preview.toast === 0 && preview.alarm.level === stored.level && preview.alarm.budgetUsd === stored.budgetUsd) return
  let toast = 0 as 0 | 1 | 2
  await update($, alarm, a => {
    const next = nextAlarm(a, level, budgetUsd)
    toast = next.toast
    return next.alarm
  })
  if (toast !== 0) $.ui.toast(clean(alarmText(spend, budgetUsd, toast)), { timeoutMs: 8000 })
}

// Is this loop one of the session's agents? One the mod did not see start
// (it loaded mid-run, a forked skill) is taken from the engine's list; a
// loop the list does not name (compaction, memory) counts as "other".
async function knowAnt($: EngineInterface, id: string): Promise<boolean> {
  if ((await read($, ants)).some(a => a.id === id)) return true
  if (notAgents.has(id)) return false
  const info = (await $.agent.list()).find(a => a.id === id)
  if (info === undefined) {
    notAgents.add(id)
    return false
  }
  const now = await $.clock.now()
  const ant: AntFarmAnt = {
    id, task: info.description || info.type, type: info.type, model: '', status: 'running',
    startedAt: now, lastActiveAt: now, usage: NO_USAGE,
  }
  await update($, ants, list => (list.some(a => a.id === id) ? list : trimAnts([...list, ant], MAX_ANTS)))
  return true
}

// Counts one finished request. It runs just after the response is handed
// back, so it may land after that loop's turn.complete: `at` (when the
// response ended) tells a late count of a finished run, which leaves the ant
// finished, from a teammate's next turn, which wakes it.
async function recordStep(
  $: EngineInterface, agentId: string | undefined, requested: string, r: TurnStepResult, at: number,
) {
  if (r.usage === null && r.stopReason === null) return // no response arrived
  const model = r.usage?.model ?? requested
  if (agentId === undefined) {
    await update($, loops, l => ({ ...l, main: addRequest(l.main, model, r.usage) }))
  } else if (await knowAnt($, agentId)) {
    await update($, ants, list =>
      list.map(a => {
        if (a.id !== agentId) return a
        const usage = addRequest(a.usage, model, r.usage)
        const lastActiveAt = Math.max(a.lastActiveAt ?? a.startedAt, at)
        if (a.endedAt !== undefined && at <= a.endedAt) return { ...a, model, lastActiveAt, usage }
        const { endedAt: _, ...rest } = a
        return { ...rest, model, status: 'running' as const, lastActiveAt, usage }
      }),
    )
    if ((await read($, ants)).some(a => a.id === agentId && isRunning(a))) startTicker($)
  } else {
    await update($, loops, l => ({ ...l, other: addRequest(l.other, model, r.usage) }))
  }
  await announce($)
}

// Unasked, the pane opens at most once a session, only where it would be a
// sidebar (a surface that docks panes), and not after the person closed it
// by hand. Under 144 columns the engine keeps it waiting: the band lists the
// ants instead.
async function openUnasked($: EngineInterface) {
  if (docksPanes !== true) return
  if ((await $.ui.panes()).some(p => p.id === PANE)) return
  // Claim the one unasked open in the write itself, so two spawns at once open it once.
  let isClaimed = false
  await update($, view, v => {
    isClaimed = !v.hasOpenedUnasked && !v.isClosedByHand
    return isClaimed ? { ...v, hasOpenedUnasked: true } : v
  })
  if (!isClaimed) return
  const opened = await $.ui.open({ id: PANE, title: TITLE })
  if (!opened.isPlaced) await update($, view, v => ({ ...v, isListInBand: true }))
}

async function isPanePlaced($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
  } catch {
    return false
  }
}

export const register: Register = (on, options) => {
  budgetUsd = typeof options.budgetUsd === 'number' ? options.budgetUsd : 2

  // ------------------------------------------------------------ events

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'antfarm',
      description: 'Open the ant farm: every subagent this session, its progress and estimated cost',
      immediate: true,
    })
    return next(e)
  })

  // A /clear starts the session over, as /cost does; so does another session
  // taking this one's place.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      stopTicker()
      notAgents.clear()
      await update($, ants, () => [])
      await update($, loops, () => ({ main: NO_USAGE, other: NO_USAGE }))
      await update($, turn, () => ({ isRunning: false, startedAt: 0 }))
      await update($, alarm, () => ({ level: 0, budgetUsd: -1 }))
      await update($, engineUsd, () => null)
      lastStatus = undefined
      $.ui.status(undefined)
    }
    return next(e)
  })

  // No transcript text: the model would read it. The pane is the answer; a
  // pane that cannot be placed is explained in a toast.
  on('command.run', { command: 'antfarm' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    if (opened.isPlaced) {
      await update($, view, v => ({ ...v, isListInBand: false, isClosedByHand: false }))
      return {}
    }
    await update($, view, v => ({ ...v, isListInBand: true }))
    $.ui.toast(clean(`The pane cannot be placed here (${opened.reason}). The band above the prompt lists the subagents instead.`))
    return {}
  })

  // An observer, never a gate: it lets the spawn run first, then records the
  // started subagent. The handler only makes that explicit: whatever this hook
  // does, the spawn's own result stands.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined || result.agentId === undefined) return result
    const now = await $.clock.now()
    const ant: AntFarmAnt = {
      id: result.agentId,
      task: e.description || e.subagentType,
      type: e.subagentType,
      model: result.model,
      status: 'running',
      startedAt: now,
      lastActiveAt: now,
      usage: NO_USAGE,
      ...(e.workflow !== undefined ? { isWorkflow: true } : {}),
    }
    await update($, ants, list => trimAnts([...list.filter(a => a.id !== ant.id), ant], MAX_ANTS))
    startTicker($)
    await openUnasked($)
    return result
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    const now = await $.clock.now()
    await update($, turn, () => ({ isRunning: true, startedAt: now }))
    startTicker($)
    return started
  })

  // The stream passes through untouched. The response goes back at once; its
  // usage is counted just after, on the clock, so counting (a dozen host
  // calls) never delays a model request, and a count that fails is only
  // missing from the estimate.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    const at = await $.clock.now()
    $.clock.after(0, () => void recordStep($, e.agentId, e.model, response, at).catch(() => undefined))
    return response
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await update($, turn, t => ({ ...t, isRunning: false }))
    } else {
      const now = await $.clock.now()
      const status: AntFarmStatus = e.reason === 'answer' ? 'done' : 'failed'
      await update($, ants, list => list.map(a => (a.id === e.agentId ? { ...a, status, endedAt: now } : a)))
    }
    // The engine's total may have moved since the last request was counted.
    await announce($)
    return result
  })

  // The person closing the pane by hand also ends the band's list, and stops
  // the pane from opening again unasked this session.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    await update($, view, v => viewAfterClose(v, e.origin.kind))
    return result
  }).catch(($, e, next) => next(e))

  // ------------------------------------------------------------ drawing

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.viewport?.isFullscreen !== undefined) docksPanes = e.viewport.isFullscreen
    if (e.props.hasSurvey) return next(e)

    const list = await read($, ants)
    const v = await read($, view)
    const { running, finished } = ordered(list)
    const showList = v.isListInBand && list.length > 0 && !(await isPanePlaced($))
    if (!e.props.isWorking && running.length === 0 && !showList) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await $.clock.now()
    const t = await read($, turn)
    const spend = await sessionSpend($)
    const level = budgetLevel(spend.usd, budgetUsd)
    const tone = level === 2 ? { color: 'error' } : level === 1 ? { color: 'warning' } : { dimColor: true }
    const failed = finished.filter(a => a.status === 'failed').length
    const since =
      e.props.isWorking && t.isRunning ? t.startedAt
      : running.length > 0 ? Math.min(...running.map(a => a.startedAt))
      : undefined
    const colors = modelColors(list)
    const frame = Math.floor(now / TICK_MS)

    const summary = [
      ...(since !== undefined ? [fmtDuration(now - since)] : []),
      `${running.length} running / ${finished.length - failed} done`,
      ...(failed > 0 ? [`${failed} failed`] : []),
      spendLabel(spend),
    ].join(' · ')

    const items = [...running, ...finished]
    const room = Math.max(1, e.props.maxRows - 2)
    const shown = showList ? items.slice(0, room) : []
    const hidden = showList ? items.length - shown.length : 0
    // Other mods' bands are never erased by this one, and they draw first: an
    // overflowing ant list can then never push another mod's buttons out of view.
    // What is beneath may be the engine's own node, which the engine refuses
    // under a Box that sizes, hides or moves it (width, height, display,
    // overflow, position): only our own rows carry the band's width.
    const below = await next(e)

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="column" key="ant-farm" width={e.props.bodyColumns}>
          <Box flexDirection="row" key="band">
            <Box key="summary" flexDirection="row" flexGrow={1}>
              {glyphRow($.ui.resolve(e), e.surface, miniAnt(running.length > 0 ? 'running' : 'done', frame), tone)}
              <Text wrap="truncate-end" {...tone}>
                {' '}{summary}
              </Text>
            </Box>
            {showList ? (
              <Button key="hide-list" label="Hide" onPress={() => update($, view, x => ({ ...x, isListInBand: false }))} />
            ) : null}
          </Box>
          {shown.map(a => {
            const p = progressOf(a, list, now)
            const tail = isRunning(a) ? (p.etaMs !== null ? fmtEta(p.etaMs) : 'running') : a.status
            return (
              <Box flexDirection="row" key={`row-${a.id}`}>
                {glyphRow($.ui.resolve(e), e.surface, miniAnt(a.status, frame + phaseOf(a.id)), { color: colors.get(a.model) ?? 'subtle' })}
                <Text wrap="truncate-end" dimColor={!isRunning(a)}>
                  {' '}{taskOf(a)} · {modelOf(a)} · {fmtDuration((a.endedAt ?? now) - a.startedAt)} · {fmtTokens(a.usage.tokens)} tok · {fmtCost(a.usage)} · {tail}
                </Text>
              </Box>
            )
          })}
          {hidden > 0 ? <Text dimColor>+{hidden} more - /antfarm shows them all</Text> : null}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.viewport?.isFullscreen !== undefined) docksPanes = e.viewport.isFullscreen
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, ants)
    const v = await read($, view)
    const now = await $.clock.now()
    const { running, finished } = ordered(list)
    const subagents = sumUsage(list.map(a => a.usage))
    const spend = await sessionSpend($)
    const level = budgetLevel(spend.usd, budgetUsd)
    const colors = modelColors(list)
    const frame = Math.floor(now / TICK_MS)
    const lane = e.props.bodyColumns >= 40 ? ANT_WIDTH + 3 : ANT_WIDTH
    const failed = finished.filter(a => a.status === 'failed').length

    const firstStart = list.length > 0 ? Math.min(...list.map(a => a.startedAt)) : now
    const lastEnd = running.length > 0 ? now : Math.max(firstStart, ...finished.map(a => a.endedAt ?? a.startedAt))
    // Two totals that can differ: the subagents alone (price table) and the whole
    // session (Claude Code's own estimate where it keeps one), each named as such.
    // Short enough for the default pane width (MM-099).
    const source = spend.isEngine ? ' (Claude Code)' : ' (price table)'
    const budgetLine =
      budgetUsd > 0
        ? `Session ${spend.text} of ${fmtUsd(budgetUsd)} budget${source}${level === 2 ? ' - past 2x' : level === 1 ? ' - over' : ''}`
        : `Session ${spend.text}${source}`

    // A finished ant rests dim, a failed one in the error colour, a running one in its model's.
    const antPaint = (a: AntFarmAnt): TextProps =>
      a.status === 'failed' ? { color: 'error' } : isRunning(a) ? { color: colors.get(a.model) ?? 'subtle' } : { color: 'subtle', dimColor: true }
    const ui = $.ui.resolve(e)

    const card = (a: AntFarmAnt) => {
      const p = progressOf(a, list, now)
      const tone: TextProps = a.status === 'failed' ? { color: 'error' } : { dimColor: !isRunning(a) }
      const rows = antRows(a.status, frame + phaseOf(a.id), lane)
      const meta = [
        modelOf(a),
        a.status,
        fmtDuration((a.endedAt ?? now) - a.startedAt),
        ...(p.etaMs !== null ? [fmtEta(p.etaMs)] : []),
      ].join(' · ')
      return (
        <Box flexDirection="row" key={`ant-${a.id}`} marginBottom={1}>
          <Box key={`art-${a.id}`} flexDirection="column" width={lane} flexShrink={0}>
            {rows.map(row => glyphRow(ui, e.surface, row, antPaint(a)))}
          </Box>
          <Box flexDirection="column" flexGrow={1} marginLeft={1}>
            <Text bold={isRunning(a)} wrap="truncate-end">{taskOf(a)}</Text>
            <Text dimColor wrap="truncate-end">{meta}</Text>
            <Box flexDirection="row">
              {glyphRow(ui, e.surface, bar(p.fraction, 12), tone)}
              <Text wrap="truncate-end" {...tone}>
                {' '}{a.usage.requests} req · {fmtTokens(a.usage.tokens)} tok · {fmtCost(a.usage)}
              </Text>
            </Box>
          </Box>
        </Box>
      )
    }

    const line = (a: AntFarmAnt) => (
      <Box flexDirection="row" key={`line-${a.id}`}>
        {glyphRow(ui, e.surface, miniAnt(a.status, 0), antPaint(a))}
        <Text dimColor wrap="truncate-end">
          {' '}{a.status} · {taskOf(a)} · {modelOf(a)} · {fmtDuration((a.endedAt ?? now) - a.startedAt)} · {fmtTokens(a.usage.tokens)} tok · {fmtCost(a.usage)}
        </Text>
      </Box>
    )

    // Bolt keeps the farm (MM-091): a static sprite beside the totals, and asleep
    // while the farm is empty; only where the pane has room for it.
    const roomy = e.props.bodyColumns >= BOLT_MIN_COLUMNS
    const totals = (
      <Box key="totals">
        <Text bold wrap="truncate-end">
          Subagents {fmtCost(subagents)} (price table) · {fmtTokens(subagents.tokens)} tokens · {fmtDuration(lastEnd - firstStart)} wall
        </Text>
      </Box>
    )
    const budgetRow = (
      <Box key="budget">
        <Text wrap="truncate-end" {...(level === 2 ? { color: 'error' } : level === 1 ? { color: 'warning' } : { dimColor: true })}>
          {budgetLine}
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {roomy ? (
          <Box key="head" flexDirection="row" gap={1}>
            {list.length > 0 ? boltSprite($.ui.resolve(e), e.surface, { size: 'tiny', pose: 'idle' }) : null}
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              {totals}
              {budgetRow}
            </Box>
          </Box>
        ) : (
          [totals, budgetRow]
        )}
        <Box key="counts" marginBottom={1}>
          <Text dimColor wrap="truncate-end">
            {running.length} running · {finished.length - failed} done · {failed} failed
          </Text>
        </Box>
        {list.length === 0 ? (
          <Box key="empty" flexDirection="row" gap={2} alignItems="center">
            {roomy ? boltSprite($.ui.resolve(e), e.surface, { size: 'small', pose: 'sleep' }) : null}
            <Text dimColor>No subagents yet this session. Each one gets an ant here when it starts.</Text>
          </Box>
        ) : null}
        {running.map(card)}
        {finished.length > 0 ? (
          <Box flexDirection="row" key="finished-head">
            <Text dimColor>Finished · {finished.length} </Text>
            <Button
              key="toggle-finished"
              label={v.isFinishedExpanded ? 'Collapse' : 'Expand'}
              onPress={() => update($, view, x => ({ ...x, isFinishedExpanded: !x.isFinishedExpanded }))}
            />
          </Box>
        ) : null}
        {finished.slice(0, MAX_FINISHED_SHOWN).map(a => (v.isFinishedExpanded ? card(a) : line(a)))}
        {finished.length > MAX_FINISHED_SHOWN ? (
          <Box key="more-finished">
            <Text dimColor>+{finished.length - MAX_FINISHED_SHOWN} more finished</Text>
          </Box>
        ) : null}
      </Box>
    )
  })

  // $.ui.status takes text alone, so the colour of the budget alarm is drawn
  // here: a mark beside the prompt footer's mode labels, amber past the
  // budget, red past twice it. Under the budget the engine draws its own.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const spend = await sessionSpend($)
    const level = budgetLevel(spend.usd, budgetUsd)
    if (level === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const engine = await next(e)
    return (
      <Box flexDirection="row">
        {engine}
        <Box key="budget-mark">
          <Text color={level === 2 ? 'error' : 'warning'}>
            {e.props.modes.length > 0 ? ' · ' : ''}
            {spend.isEngine ? `Claude Code's estimate ${spend.text}` : spend.text} {level === 2 ? 'past 2x budget' : 'over budget'}
          </Text>
        </Box>
      </Box>
    )
  })
}
