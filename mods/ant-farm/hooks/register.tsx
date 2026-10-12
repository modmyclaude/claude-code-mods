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
//
// The pane is a mission control: what each subagent is doing right now comes
// from the chunks of its model requests (thinking, text, a tool named), its
// tool calls and the permission verdicts on them; the activity timeline keeps
// the last eighty of those. Nothing shown is inferred.

import { atom, read, update } from 'claude-code'
import type { AgentStatus, EngineInterface, Register, Timer, ToolCallResult, TurnStepResult } from 'claude-code'

import type { AntFarmAnt, AntFarmEvent, AntFarmLoops, AntFarmStatus, AntFarmUsage } from '../types'
import { addRequest, budgetLevel, NO_USAGE, sumUsage } from './prices'
import { glyphRow } from './cells'
import { drawControl } from './control'
import { redact } from './redact'
import {
  FRESH_MS, moveSelection, nextN, ordered, pushEvent, pushHistory, SETTLE_MS, stopWarning, toolSummary,
} from './mission'
import type { AntFarmPhase, LivePhase } from './mission'
import {
  alarmText, clean, fmtCost, fmtDuration, fmtEta, fmtTokens, miniAnt, modelColors, nextAlarm, phaseOf,
  progressOf, spendLabel, spendOf, statusText, trimAnts, viewAfterClose,
} from './show'
import type { Spend } from './show'

const PANE = 'ant-farm'
const TITLE = 'Ant farm'
/** The body columns /antfarm asks the dock for: two cards side by side. */
const PANE_COLUMNS = 84
/**
 * A moment after a pane opens, ask for a draw again. On the desktop app the
 * first draw of a pane opened by a command did not land once (the pane said
 * nothing had been drawn until a resize asked again); the second ask costs one
 * render and makes the pane whole either way.
 */
const OPEN_NUDGE_MS = 300
/** One frame of the ants, and of every elapsed time shown. */
const TICK_MS = 500
/** Every this many ticks, running ants are checked against the engine's agent list. */
const RECONCILE_TICKS = 20
const MAX_ANTS = 200
/** A running ant silent this long (no request) no longer keeps the clock ticking on its own. */
const STALL_MS = 10 * 60_000

const ants = atom({ plugin: 'ant-farm', key: 'ants' } as const, [])
const loops = atom({ plugin: 'ant-farm', key: 'loops' } as const, { main: NO_USAGE, other: NO_USAGE })
const turn = atom({ plugin: 'ant-farm', key: 'turn' } as const, { isRunning: false, startedAt: 0 })
const alarm = atom({ plugin: 'ant-farm', key: 'alarm' } as const, { level: 0, budgetUsd: -1 })
const engineUsd = atom({ plugin: 'ant-farm', key: 'engineUsd' } as const, null)
const events = atom({ plugin: 'ant-farm', key: 'events' } as const, [])
const view = atom({ plugin: 'ant-farm', key: 'view' } as const, {
  isListInBand: false,
  isFinishedExpanded: false,
  isClosedByHand: false,
  hasOpenedUnasked: false,
})

const isRunning = (a: AntFarmAnt) => a.status === 'running'
// The untrusted texts of an ant, cleaned for drawing.
const taskOf = (a: AntFarmAnt) => clean(a.task)
const modelOf = (a: AntFarmAnt) => clean(shortModelOf(a))
const shortModelOf = (a: AntFarmAnt) => a.model.replace(/^.*?claude-/, '') || a.type

function sessionTotal(list: readonly AntFarmAnt[], l: AntFarmLoops): AntFarmUsage {
  return sumUsage([...list.map(a => a.usage), l.main, l.other])
}

function endStatus(s: AgentStatus | undefined): AntFarmStatus | undefined {
  if (s === undefined || s === 'completed' || s === 'idle') return 'done'
  if (s === 'failed' || s === 'killed') return 'failed'
  return undefined
}

// Module variables hold only what a reload may lose: the options, the timer
// (a reload cancels it anyway), the last status text, a cache of loop ids and
// the live phase of each running subagent (seconds old at most; a reload
// starts it over at "working"). Helpers that take `$` live here at the top of
// the file, where the engine can follow `$` into them.
let budgetUsd = 0
let ticker: Timer | undefined
let ticks = 0
let docksPanes: boolean | undefined
let lastStatus: string | undefined
const notAgents = new Set<string>()
const live = new Map<string, LivePhase>()

/** Notes what a subagent was last seen doing; the clock stamps when, off the hook's path. */
function setPhase($: EngineInterface, id: string, phase: AntFarmPhase, detail?: string) {
  const was = live.get(id)
  if (was !== undefined && was.phase === phase && was.detail === detail) return
  const next: LivePhase = detail !== undefined ? { phase, detail } : { phase }
  live.set(id, next)
  $.clock.now().then(now => {
    if (live.get(id) === next) next.since = now
  }).catch(() => undefined)
}

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
    const list = await read($, ants)
    const newest = (await read($, events)).at(-1)
    // Busy while anything runs, and for the moment a finished card keeps its
    // colour and the newest row its weight, so those transitions complete.
    const busy =
      (await read($, turn)).isRunning ||
      list.some(a => isRunning(a) && now - (a.lastActiveAt ?? a.startedAt) < STALL_MS) ||
      list.some(a => a.endedAt !== undefined && now - a.endedAt < SETTLE_MS) ||
      (newest !== undefined && now - newest.at < FRESH_MS)
    if (!busy) stopTicker()
    $.ui.invalidate('ui.render')
  } catch {
    // A tick that fails only skips a frame.
  }
}

// A background subagent stopped from outside may never raise its
// turn.complete: the engine's own list settles it, so no ant runs forever.
// The same list says which running agents the engine holds (waiting).
async function reconcile($: EngineInterface) {
  const now = await $.clock.now()
  const suspects = (await read($, ants)).filter(a => isRunning(a) && !a.isWorkflow && now - a.startedAt > 5000)
  if (suspects.length === 0) return
  const listed = new Map((await $.agent.list()).map(info => [info.id, info.status] as const))
  const ended = new Map<string, AntFarmStatus>()
  for (const a of suspects) {
    const status = endStatus(listed.get(a.id))
    if (status !== undefined) ended.set(a.id, status)
    else if (listed.get(a.id) === 'waiting') setPhase($, a.id, 'waiting', 'held by the engine')
    else if (live.get(a.id)?.detail === 'held by the engine') setPhase($, a.id, 'working')
  }
  if (ended.size === 0) return
  await update($, ants, list =>
    list.map(a => (isRunning(a) && ended.has(a.id) ? { ...a, status: ended.get(a.id) ?? 'done', endedAt: now } : a)),
  )
  const settled = suspects.filter(a => ended.has(a.id))
  for (const a of settled) live.delete(a.id)
  await update($, events, list =>
    settled.reduce(
      (acc, a) => pushEvent(acc, { at: now, kind: ended.get(a.id) === 'failed' ? 'failed' : 'done', agentId: a.id, text: a.task, detail: 'settled from the agent list' }),
      list,
    ),
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
  if (toast !== 0) {
    const text = alarmText(spend, budgetUsd, toast)
    $.ui.toast(clean(text), { timeoutMs: 8000 })
    const now = await $.clock.now()
    await update($, events, list => pushEvent(list, { at: now, kind: 'warning', text }))
    startTicker($) // the row is bold for a moment, even with nothing running
  }
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
  await update($, ants, list => {
    if (list.some(a => a.id === id)) return list
    const ant: AntFarmAnt = {
      id, task: info.description || info.type, type: info.type, model: '', status: 'running',
      startedAt: now, lastActiveAt: now, usage: NO_USAGE, n: nextN(list),
      ...(info.parentId !== undefined ? { parentId: info.parentId } : {}),
    }
    return trimAnts([...list, ant], MAX_ANTS)
  })
  return true
}

// Counts one finished request. It runs just after the response is handed
// back, so it may land after that loop's turn.complete: `at` (when the
// response ended) tells a late count of a finished run, which leaves the ant
// finished, from a teammate's next turn, which wakes it.
async function recordStep(
  $: EngineInterface, agentId: string | undefined, requested: string, r: TurnStepResult, at: number,
) {
  const hasResponse = !(r.usage === null && r.stopReason === null)
  if (!hasResponse && agentId === undefined) return // no response arrived
  const model = r.usage?.model ?? requested
  if (agentId === undefined) {
    await update($, loops, l => ({ ...l, main: addRequest(l.main, model, r.usage) }))
  } else if (await knowAnt($, agentId)) {
    const warning = stopWarning(r.stopReason, hasResponse)
    if (hasResponse) {
      await update($, ants, list =>
        list.map(a => {
          if (a.id !== agentId) return a
          const usage = addRequest(a.usage, model, r.usage)
          const history = pushHistory(a.history, usage.tokens - a.usage.tokens)
          const lastActiveAt = Math.max(a.lastActiveAt ?? a.startedAt, at)
          if (a.endedAt !== undefined && at <= a.endedAt) return { ...a, model, lastActiveAt, usage, history }
          const { endedAt: _, ...rest } = a
          return { ...rest, model, status: 'running' as const, lastActiveAt, usage, history }
        }),
      )
      if ((await read($, ants)).some(a => a.id === agentId && isRunning(a))) startTicker($)
    }
    if (warning !== undefined) await update($, events, list => pushEvent(list, { at, kind: 'warning', agentId, text: warning }))
  } else if (hasResponse) {
    await update($, loops, l => ({ ...l, other: addRequest(l.other, model, r.usage) }))
  }
  if (hasResponse) await announce($)
}

// Notes one finished tool call of a subagent on its ant and the timeline:
// after the result went back, off the tool's path.
async function recordTool($: EngineInterface, agentId: string, tool: string, summary: { kind: 'tool' | 'file'; text: string }, result: ToolCallResult) {
  if (!(await knowAnt($, agentId))) return
  const now = await $.clock.now()
  const deny = typeof result.deny === 'string' ? result.deny : undefined
  const isError = deny === undefined && result.isError === true
  const failed = deny !== undefined || isError
  await update($, ants, list =>
    list.map(a =>
      a.id !== agentId ? a : {
        ...a,
        tools: (a.tools ?? 0) + 1,
        ...(summary.kind === 'file' ? { edits: (a.edits ?? 0) + 1 } : {}),
        ...(failed ? { errors: (a.errors ?? 0) + 1 } : {}),
      },
    ),
  )
  // Redacted whole, then cut: a cut never leaves half a credential behind.
  const detail = deny !== undefined ? `refused: ${firstWords(redact(deny))}` : isError ? firstWords(redact(typeof result.text === 'string' ? result.text : 'failed')) : undefined
  await update($, events, list =>
    pushEvent(list, {
      at: now, kind: failed ? 'error' : summary.kind, agentId, text: summary.text, ...(detail !== undefined ? { detail } : {}),
    }),
  )
}

/** The first line of a text, at most 60 characters. */
function firstWords(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? ''
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
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
  else nudgeAfterOpen($)
}

/** One more draw shortly after an open, so a first draw that did not land is drawn after all. */
function nudgeAfterOpen($: EngineInterface) {
  $.clock.after(OPEN_NUDGE_MS, () => $.ui.invalidate('ui.render'))
}

async function isPanePlaced($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
  } catch {
    return false
  }
}

export const register: Register = (on, options) => {
  budgetUsd = typeof options.budgetUsd === 'number' ? options.budgetUsd : 0

  // ------------------------------------------------------------ events

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'antfarm',
      description: 'Open the ant farm: mission control for every subagent this session, its activity and estimated cost',
      immediate: true,
    })
    // A reload of the code (session.start fires again) loses the module's
    // clock while the kept state may still say something runs: start it again,
    // so the pane keeps moving instead of waiting for the next event.
    const kept = await read($, ants)
    if ((await read($, turn)).isRunning || kept.some(isRunning)) startTicker($)
    return next(e)
  })

  // A /clear starts the session over, as /cost does; so does another session
  // taking this one's place.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      stopTicker()
      notAgents.clear()
      live.clear()
      await update($, ants, () => [])
      await update($, loops, () => ({ main: NO_USAGE, other: NO_USAGE }))
      await update($, turn, () => ({ isRunning: false, startedAt: 0 }))
      await update($, alarm, () => ({ level: 0, budgetUsd: -1 }))
      await update($, engineUsd, () => null)
      await update($, events, () => [])
      await update($, view, v => {
        const { selectedId: _, ...rest } = v
        return rest
      })
      lastStatus = undefined
      $.ui.status(undefined)
    }
    return next(e)
  })

  // No transcript text: the model would read it. The pane is the answer; a
  // pane that cannot be placed is explained in a toast.
  on('command.run', { command: 'antfarm' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
    if (opened.isPlaced) {
      await update($, view, v => ({ ...v, isListInBand: false, isClosedByHand: false }))
      nudgeAfterOpen($)
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
    const agentId = result.agentId
    const now = await $.clock.now()
    let parentN: number | undefined
    await update($, ants, list => {
      parentN = e.parentAgentId !== undefined ? list.find(a => a.id === e.parentAgentId)?.n : undefined
      const ant: AntFarmAnt = {
        id: agentId,
        task: e.description || e.subagentType,
        type: e.subagentType,
        model: result.model,
        status: 'running',
        startedAt: now,
        lastActiveAt: now,
        usage: NO_USAGE,
        n: nextN(list.filter(a => a.id !== agentId)),
        ...(e.parentAgentId !== undefined ? { parentId: e.parentAgentId } : {}),
        ...(e.workflow !== undefined ? { isWorkflow: true } : {}),
      }
      return trimAnts([...list.filter(a => a.id !== agentId), ant], MAX_ANTS)
    })
    setPhase($, agentId, 'starting')
    await update($, events, list =>
      pushEvent(list, {
        at: now, kind: e.parentAgentId !== undefined ? 'handoff' : 'spawn', agentId, text: e.description || e.subagentType,
        ...(e.parentAgentId !== undefined ? { detail: parentN !== undefined ? `from #${parentN}` : 'from another agent' } : {}),
      }),
    )
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

  // The stream passes through untouched, each chunk yielded as it came; a
  // subagent's chunks say what it is doing (thinking, writing, naming a tool).
  // The response goes back at once; its usage is counted just after, on the
  // clock, so counting (a dozen host calls) never delays a model request, and
  // a count that fails is only missing from the estimate.
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    let item = await stream.next()
    while (item.done !== true) {
      const chunk = item.value
      if (e.agentId !== undefined) {
        if (chunk.kind === 'thinking') setPhase($, e.agentId, 'thinking')
        else if (chunk.kind === 'text') setPhase($, e.agentId, 'writing')
        else if (chunk.kind === 'tool') setPhase($, e.agentId, 'tool', clean(chunk.name))
      }
      yield chunk
      item = await stream.next()
    }
    const response = item.value
    const at = await $.clock.now()
    $.clock.after(0, () => void recordStep($, e.agentId, e.model, response, at).catch(() => undefined))
    return response
  })

  // A subagent's tool call: what it runs now, then what came of it. The
  // call itself is untouched: its result goes back as the engine made it.
  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) return next(e)
    const agentId = e.agentId
    const summary = toolSummary(e.tool, e as unknown as Record<string, unknown>) // secret shapes already replaced
    setPhase($, agentId, 'tool', clean(summary.text))
    const result = await next(e)
    setPhase($, agentId, 'working')
    $.clock.after(0, () => void recordTool($, agentId, e.tool, summary, result).catch(() => undefined))
    return result
  }).catch(($, e, next) => next(e))

  // The permission verdict on a subagent's tool call: `ask` means the person
  // is being asked, and the subagent waits on them.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (e.agentId !== undefined && verdict.decision === 'ask') setPhase($, e.agentId, 'waiting', `permission for ${clean(e.tool)}`)
    return verdict
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await update($, turn, t => ({ ...t, isRunning: false }))
    } else {
      const agentId = e.agentId
      const now = await $.clock.now()
      const status: AntFarmStatus = e.reason === 'answer' ? 'done' : 'failed'
      live.delete(agentId)
      let task: string | undefined
      let startedAt: number | undefined
      await update($, ants, list =>
        list.map(a => {
          if (a.id !== agentId) return a
          task = a.task
          startedAt = a.startedAt
          return { ...a, status, endedAt: now }
        }),
      )
      if (task !== undefined) {
        const detail = status === 'done' ? fmtDuration(now - (startedAt ?? now)) : e.reason
        await update($, events, list => pushEvent(list, { at: now, kind: status, agentId, text: task ?? '', detail }))
      }
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
            const held = live.get(a.id)?.phase === 'waiting'
            const tail = isRunning(a) ? (held ? 'waiting' : p.etaMs !== null ? fmtEta(p.etaMs) : 'running') : a.status
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
    const list = await read($, ants)
    const v = await read($, view)
    const now = await $.clock.now()
    const spend = await sessionSpend($)
    const select = (id: string | undefined) =>
      void update($, view, x => {
        const { selectedId: _, ...rest } = x
        return id === undefined ? rest : { ...rest, selectedId: id }
      })
    return drawControl({
      ui: $.ui.resolve(e),
      surface: e.surface,
      columns: e.props.bodyColumns,
      isFocused: e.props.isFocused,
      now,
      frame: Math.floor(now / TICK_MS),
      list,
      events: await read($, events),
      view: v,
      live,
      colors: modelColors(list),
      spend,
      budgetUsd,
      level: budgetLevel(spend.usd, budgetUsd),
      subagents: sumUsage(list.map(a => a.usage)),
      on: {
        select,
        move: by => {
          const { running, finished } = ordered(list)
          const ids = [...running, ...finished].map(a => a.id)
          void update($, view, x => {
            const next = moveSelection(ids, x.selectedId, by)
            const { selectedId: _, ...rest } = x
            return next === undefined ? rest : { ...rest, selectedId: next }
          })
        },
        toggleFinished: () => void update($, view, x => ({ ...x, isFinishedExpanded: !x.isFinishedExpanded })),
        toggleTimeline: () => void update($, view, x => ({ ...x, isTimelineHidden: x.isTimelineHidden !== true })),
        growTimeline: () => void update($, view, x => ({ ...x, isTimelineExpanded: true })),
      },
    })
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
