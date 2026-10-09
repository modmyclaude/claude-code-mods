// The engine beneath the plugin, for the tests: a mocked clock, and answers
// for every call the mod makes on `$` (panes, toasts, status, the agent
// list), recorded so a test can read what the mod did. Raisers for the
// events a session makes (a spawn, a model request, a turn's end) and the
// props each drawn component is mounted with.

import { mock } from 'claude-code/testing'
import type { AgentInfo, On, RenderPropsOf, RenderViewport, TurnUsage, UiOpenResult } from 'claude-code'
import type { Engine } from 'claude-code/testing'

export const PLUGIN = 'ant-farm'
export const PANE = 'ant-farm'
export const SURFACES = ['terminal', 'desktop'] as const
export const T0 = 1_700_000_000_000

export type World = ReturnType<typeof world>

export function world(on: On, setup: { placed?: boolean; reason?: string } = {}) {
  const clock = mock.clock(on, { now: T0 })
  const rec = {
    toasts: [] as string[],
    statuses: [] as (string | undefined)[],
    opens: [] as string[],
    invalidates: 0,
    listed: [] as AgentInfo[],
    panes: [] as { id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }[],
    nextModel: 'claude-haiku-5-5',
    nextId: 0,
    registered: [] as { name: string; immediate?: true }[],
    // Switches a test flips to make the engine refuse or fail beneath the mod.
    denySpawn: undefined as string | undefined,
    listThrows: false,
    panesThrow: false,
    /** Claude Code's own cost estimate, as `$.session.usage()` reports it; undefined: no ledger. */
    engineUsd: undefined as number | undefined,
    usageThrows: false,
    /** The chunks of the last model request, as they reached the test. */
    chunks: [] as unknown[],
  }
  // What each model request answers: usage, a response with none, or no response at all.
  const stepUsage: (TurnUsage | null | 'no-response')[] = []
  const placed = setup.placed ?? true
  const reason = setup.reason ?? 'waits for 144 columns, the terminal has 120'

  on('ui.toast', ($, e) => (rec.toasts.push(e.text), { value: undefined }))
  on('ui.status', ($, e) => (rec.statuses.push(e.text), { value: undefined }))
  on('ui.invalidate', ($, e, next) => ((rec.invalidates += 1), next(e)))
  on('ui.open', ($, e) => {
    rec.opens.push(e.id)
    rec.panes = [...rec.panes.filter(p => p.id !== e.id), { id: e.id, title: e.title ?? e.id, isShown: placed, isFocused: false, isPlaced: placed }]
    const value: UiOpenResult = placed ? { isPlaced: true } : { isPlaced: false, reason }
    return { value }
  })
  on('ui.close', ($, e) => {
    rec.panes = rec.panes.filter(p => p.id !== e.id)
    return { value: undefined }
  })
  on('ui.panes', () => {
    if (rec.panesThrow) throw new Error('panes unavailable')
    return { value: rec.panes }
  })
  on('agent.list', () => {
    if (rec.listThrows) throw new Error('agent list unavailable')
    return { value: rec.listed }
  })
  on('command.register', ($, e) => {
    rec.registered.push({ name: e.name, ...(e.immediate === true ? { immediate: true as const } : {}) })
    return { value: { command: e.name } }
  })
  // The engine lists a started agent as running until it ends, as a session does.
  on('agent.spawn', ($, e) => {
    if (rec.denySpawn !== undefined) return { deny: rec.denySpawn }
    const agentId = `agent-${(rec.nextId += 1)}`
    rec.listed = [...rec.listed, { id: agentId, description: e.description, type: e.subagentType, status: 'running' }]
    return { model: rec.nextModel, agentId }
  })
  on('session.usage', () => {
    if (rec.usageThrows) throw new Error('usage unavailable')
    return {
      value: {
        startedAt: T0, context: { window: 1_000_000 }, rateLimits: [],
        ...(rec.engineUsd !== undefined ? { cost: { usd: rec.engineUsd } } : {}),
      },
    }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => {
    const status = e.reason === 'answer' ? 'completed' : 'failed'
    rec.listed = rec.listed.map(a => (a.id === e.agentId ? { ...a, status } : a))
    return { text: e.answer }
  })
  // Each model request answers with the usage the test queued for it.
  on('turn.step', async function* ($, e) {
    const queued = stepUsage.shift() ?? null
    if (queued === 'no-response') {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
    }
    yield { kind: 'text', index: 0, text: `reply ${e.index}` }
    return {
      turnId: e.turnId, index: e.index, answer: '', toolUses: [],
      stopReason: 'end_turn', usage: queued,
    }
  })

  return {
    clock,
    rec,
    /** Starts a subagent the way the Agent tool does. */
    async spawn($: Engine, task: string, opts: { type?: string; model?: string } = {}) {
      if (opts.model !== undefined) rec.nextModel = opts.model
      const r = await $.agent.spawn({
        tool_use_id: `tu-${task}`, prompt: `Do: ${task}`, description: task,
        subagentType: opts.type ?? 'Explore', provider: { plugin: 'engine', tier: 'core' },
        parentModel: 'claude-opus-5-5', background: true, fork: false,
      })
      return r.agentId ?? ''
    },
    /** One model request in a loop (`agentId` absent: the main loop), with its usage. */
    async step($: Engine, agentId: string | undefined, usage: TurnUsage | null | 'no-response', model = 'claude-haiku-5-5') {
      stepUsage.push(usage)
      const stream = $.turn.step({
        turnId: `turn-${agentId ?? 'main'}`, index: 0, model, messageCount: 1,
        ...(agentId !== undefined ? { agentId } : {}),
      })
      // Read to the end by hand: the generator's return value is the response.
      rec.chunks = []
      let item = await stream.next()
      while (item.done !== true) {
        rec.chunks.push(item.value)
        item = await stream.next()
      }
      return item.value
    },
    async finish($: Engine, agentId: string | undefined, reason: 'answer' | 'error' | 'aborted' = 'answer') {
      return $.turn.complete({
        answer: 'ok', durationMs: 1, isAborted: reason === 'aborted', turnId: `turn-${agentId ?? 'main'}`,
        reason, ...(agentId !== undefined ? { agentId } : {}),
      })
    },
    async startTurn($: Engine) {
      return $.turn.start({ text: 'go', turnId: 'turn-main' })
    },
  }
}

/** Usage of one request: `input` uncached input tokens and `output` generated ones. */
export function usage(model: string, input: number, output: number, cacheRead = 0, cacheWrite = 0): TurnUsage {
  return {
    model, input_tokens: input, output_tokens: output,
    cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite,
  }
}

export const DOCKED: RenderViewport = { columns: 180, rows: 50, isFullscreen: true }
export const NARROW: RenderViewport = { columns: 100, rows: 40, isFullscreen: true }

export function bandProps(over: Partial<RenderPropsOf['AbovePrompt']> = {}): RenderPropsOf['AbovePrompt'] {
  return {
    hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 11 }, view: {}, ...over,
  }
}

export function paneProps(over: Partial<RenderPropsOf['Pane']> = {}): RenderPropsOf['Pane'] {
  return {
    title: 'Ant farm', isFocused: false, bodyColumns: 60, placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 }, view: {}, ...over,
  }
}

/** What the engine draws in the band when no plugin draws: one marker Text. */
export function engineBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key="engine-band">
        <Text>engine</Text>
      </Box>
    )
  })
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key="engine-modes">
        <Text>{e.props.modes.join(' & ')}</Text>
      </Box>
    )
  })
}
