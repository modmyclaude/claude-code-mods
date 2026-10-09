// Headway: a one-line progress bar for the plan Claude is working through,
// with an honest estimate of when it lands. It only watches: Claude's own
// todo, task and plan-mode tools, its turns and its subagents. It never
// refuses a call, never adds to the prompt and never calls a model.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { HeadwayRun } from '../types'
import { HISTORY_KEY, priorFor, projectKey, readPace, recordPlan } from './history'
import { EMPTY_RUN, TICK_MS, bandView, layoutBand, paneRows, reduce, wantsTimer, type Effect, type HeadwayEvent, type Tone } from './model'
import { eventFromTool } from './sources'

const PANE = 'headway'
/** How long the receipt toast stays. */
const RECEIPT_MS = 10_000

const run = atom({ plugin: 'headway', key: 'run' } as const, EMPTY_RUN)
const done = atom({ plugin: 'headway', key: 'done' } as const, null)

// The one timer. Module state on purpose: a reload drops the timer with the
// old environment, and the next event starts a fresh one.
let timer: Timer | null = null

function styleOf(tone: Tone): { dimColor?: boolean; color?: string } {
  if (tone === 'dim') return { dimColor: true }
  if (tone === 'long') return { color: 'warning' }
  if (tone === 'done') return { color: 'success' }
  if (tone === 'note') return { color: 'suggestion' }
  return {}
}

async function safely($: EngineInterface, work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch (error) {
    $.ui.log(`headway: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  }
}

/** Runs one event through the reducer, carries out its effects and keeps the timer right. */
async function dispatch($: EngineInterface, event: HeadwayEvent): Promise<HeadwayRun> {
  const wall = await $.clock.now()
  const current = await read($, run)
  if (reduce(current, event, wall).run === current) {
    syncTimer($, current, wall)
    return current
  }
  let effects: Effect[] = []
  const next = await update($, run, value => {
    const out = reduce(value, event, wall)
    effects = out.effects
    return out.run
  })
  // One effect failing (say the store) must not skip the others or leave the timer wrong.
  for (const effect of effects) await safely($, () => carryOut($, effect, wall))
  syncTimer($, next, wall)
  return next
}

async function carryOut($: EngineInterface, effect: Effect, wall: number): Promise<void> {
  if (effect.kind === 'receipt') {
    $.ui.toast(effect.text, { timeoutMs: RECEIPT_MS })
  } else if (effect.kind === 'finished') {
    // The public "plan done" moment, then this project's pace history.
    await update($, done, () => effect.done)
    if (effect.durations.length > 0) {
      const key = effect.projectKey ?? projectKey(await $.session.root())
      const file = readPace(await $.store.get(HISTORY_KEY))
      await $.store.set(HISTORY_KEY, recordPlan(file, key, effect.durations, wall))
    }
  } else {
    const key = projectKey(await $.session.root())
    const prior = priorFor(readPace(await $.store.get(HISTORY_KEY)), key)
    await dispatch($, { kind: 'attach', planId: effect.planId, projectKey: key, ...(prior ? { prior } : {}) })
  }
}

function syncTimer($: EngineInterface, value: HeadwayRun, wall: number): void {
  const wants = wantsTimer(value, wall)
  if (wants && timer === null) {
    timer = $.clock.every(TICK_MS, () => void tick($))
  } else if (!wants && timer !== null) {
    timer.cancel()
    timer = null
  }
}

async function tick($: EngineInterface): Promise<void> {
  await safely($, async () => {
    await dispatch($, { kind: 'tick' })
    // Time left and "running" counts move with the clock, not with state.
    $.ui.invalidate('ui.render')
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'headway',
      description: "Show Claude's plan with each step's status and time; /headway hide or show toggles the line",
      argumentHint: '[hide|show]',
      immediate: true,
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await safely($, () => dispatch($, { kind: 'clear' }))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await safely($, () => dispatch($, { kind: 'turn', isRunning: true }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    const event: HeadwayEvent = agentId === undefined ? { kind: 'turn', isRunning: false } : { kind: 'agent-end', id: agentId }
    await safely($, () => dispatch($, event))
    return next(e)
  })

  // Counts running subagents for the chip; never refuses a spawn.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    const agentId = started.agentId
    if (agentId !== undefined && e.isTeammate !== true) await safely($, () => dispatch($, { kind: 'agent-start', id: agentId }))
    return started
  }).catch(($, e, next) => next(e))

  // Watches Claude's own plan tools after they ran; the result is handed back untouched.
  on('tool.call', { tool: ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'ExitPlanMode'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      const event = eventFromTool(String(e.tool), e, ran.result, e.agentId === undefined)
      if (event !== null) await safely($, () => dispatch($, event))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'headway' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'hide' || word === 'show') {
      await dispatch($, { kind: 'hidden', hidden: word === 'hide' })
      $.ui.toast(word === 'hide' ? 'Headway line hidden. /headway show brings it back.' : 'Headway line shown.')
      return {}
    }
    if (word !== '') {
      $.ui.toast('headway: try /headway, /headway hide or /headway show.')
      return {}
    }
    const opened = await $.ui.open({ id: PANE, title: 'Headway', focus: true, closeOnEscape: true })
    if (!opened.isPlaced) $.ui.toast(`headway: the plan pane is waiting (${opened.reason}).`)
    return {}
  }).catch($ => {
    $.ui.toast('headway: that command failed.')
    return {}
  })

  // The band: one line above the prompt, drawn on top of whatever other mods draw there.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const value = await read($, run)
    const view = value.hidden ? null : bandView(value, await $.clock.now())
    if (view === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const parts = layoutBand(view, e.props.bodyColumns)
    const below = await next(e)
    return (
      <Box flexDirection="column">
        <Box key="headway" flexDirection="row">
          {parts.map(part => (
            <Text {...styleOf(part.tone)}>{part.text}</Text>
          ))}
        </Box>
        {below}
      </Box>
    )
  })

  // The /headway pane: every step with its status and time.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const value = await read($, run)
    const last = await read($, done)
    const rows = paneRows(value, last, await $.clock.now())
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {rows.map(row => (
          <Text wrap="truncate-end" {...styleOf(row.tone)}>
            {row.text}
          </Text>
        ))}
        <Box marginTop={1}>
          <Button
            key="toggle"
            label={value.hidden ? 'Show line' : 'Hide line'}
            onPress={() => void safely($, () => dispatch($, { kind: 'hidden', hidden: 'toggle' }))}
          />
        </Box>
      </Box>
    )
  })
}
