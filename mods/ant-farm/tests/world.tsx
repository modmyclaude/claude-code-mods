// The engine beneath the plugin, for the tests: a mocked clock, and answers
// for every call the mod makes on `$` (panes, toasts, status, the agent
// list), recorded so a test can read what the mod did. Raisers for the
// events a session makes (a spawn, a model request, a turn's end) and the
// props each drawn component is mounted with.

import { mock } from 'claude-code/testing'
import type { AgentInfo, On, RenderPropsOf, RenderViewport, TurnUsage, UiOpenResult } from 'claude-code'
import type { Engine } from 'claude-code/testing'

export const PLUGIN = 'ant-farm'
/** What the engine beneath answers a tool call with. */
export type ToolAnswer = 'ok' | `deny:${string}` | string
/** A chunk a model request streams before its response. */
export type ChunkKind = 'thinking' | 'text' | 'tool'
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
    /** The body columns each open asked the dock for. */
    openColumns: [] as (number | undefined)[],
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
    /** Every tool call that reached the engine beneath the mod. */
    toolCalls: [] as { tool: string; agentId?: string }[],
    /** What the engine's permission check answers for a subagent's tool. */
    checkDecision: 'allow' as 'allow' | 'ask' | 'deny',
    /** A promise the next tool call waits on before answering, so a test can look while it runs. */
    holdTool: undefined as Promise<void> | undefined,
    /** Why the next model response stopped. */
    nextStop: 'end_turn' as 'end_turn' | 'max_tokens' | 'model_context_window_exceeded' | 'refusal',
  }
  /** What each tool call answers: the engine's own result, an error, or a refusal. */
  const toolAnswers: ToolAnswer[] = []
  // What each model request answers: usage, a response with none, or no response at all,
  // and which chunks stream before it (a text chunk when unsaid).
  const stepUsage: (TurnUsage | null | 'no-response')[] = []
  const stepChunks: (readonly ChunkKind[] | undefined)[] = []
  const placed = setup.placed ?? true
  const reason = setup.reason ?? 'waits for 144 columns, the terminal has 120'

  on('ui.toast', ($, e) => (rec.toasts.push(e.text), { value: undefined }))
  on('ui.status', ($, e) => (rec.statuses.push(e.text), { value: undefined }))
  on('ui.invalidate', ($, e, next) => ((rec.invalidates += 1), next(e)))
  on('ui.open', ($, e) => {
    rec.opens.push(e.id)
    rec.openColumns.push(e.columns)
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
  on('tool.call', async ($, e) => {
    rec.toolCalls.push({ tool: e.tool, ...(e.agentId !== undefined ? { agentId: e.agentId } : {}) })
    if (rec.holdTool !== undefined) await rec.holdTool
    const answer = toolAnswers.shift() ?? 'ok'
    if (answer === 'ok') return { result: { ok: true }, text: 'ok' }
    if (answer.startsWith('deny:')) return { deny: answer.slice(5) }
    return { isError: true as const, result: answer, text: answer }
  })
  on('tool.check', () => ({ decision: rec.checkDecision, reason: 'the test says so' }))
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
    const kinds = stepChunks.shift() ?? ['text']
    if (queued === 'no-response') {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
    }
    for (const kind of kinds) {
      if (kind === 'thinking') yield { kind: 'thinking', index: 0, text: 'hm' }
      else if (kind === 'tool') yield { kind: 'tool', index: 1, id: `tu-${e.index}`, name: 'Bash' }
      else yield { kind: 'text', index: 0, text: `reply ${e.index}` }
    }
    return {
      turnId: e.turnId, index: e.index, answer: '', toolUses: [],
      stopReason: rec.nextStop, usage: queued,
    }
  })

  return {
    clock,
    rec,
    /** Starts a subagent the way the Agent tool does; `parent` is the subagent whose loop starts it. */
    async spawn($: Engine, task: string, opts: { type?: string; model?: string; parent?: string } = {}) {
      if (opts.model !== undefined) rec.nextModel = opts.model
      const r = await $.agent.spawn({
        tool_use_id: `tu-${task}`, prompt: `Do: ${task}`, description: task,
        subagentType: opts.type ?? 'Explore', provider: { plugin: 'engine', tier: 'core' },
        parentModel: 'claude-opus-5-5', background: true, fork: false,
        ...(opts.parent !== undefined ? { parentAgentId: opts.parent } : {}),
      })
      return r.agentId ?? ''
    },
    /**
     * A tool call in a subagent's loop, answered by the engine beneath the mod with
     * `answer`: 'ok' (the default), 'deny:<reason>' or any other text as an error. The
     * mod's record of it (made just after) is let run.
     */
    async callTool($: Engine, agentId: string | undefined, tool: string, args: Record<string, unknown> = {}, answer: ToolAnswer = 'ok') {
      toolAnswers.push(answer)
      const r = await $.tool.call({ tool, ...args, tool_use_id: `tu-${rec.toolCalls.length}`, ...(agentId !== undefined ? { agentId } : {}) } as never)
      await clock.settle()
      return r
    },
    /** The engine's permission check on a subagent's tool, as the mod sees it. */
    async check($: Engine, agentId: string, tool: string, args: Record<string, unknown> = {}) {
      return $.tool.check({ tool, input: args, agentId } as never)
    },
    /** One model request in a loop (`agentId` absent: the main loop), with its usage. */
    /** A model request, read to its end, then the mod's count of it (made just after) let run. */
    async step($: Engine, agentId: string | undefined, usage: TurnUsage | null | 'no-response', model = 'claude-haiku-5-5', kinds?: readonly ChunkKind[]) {
      const response = await this.request($, agentId, usage, model, kinds)
      await clock.settle()
      return response
    },
    /** A model request read to its end, its count not yet run; `kinds` the chunks it streams first. */
    async request($: Engine, agentId: string | undefined, usage: TurnUsage | null | 'no-response', model = 'claude-haiku-5-5', kinds?: readonly ChunkKind[]) {
      stepUsage.push(usage)
      stepChunks.push(kinds)
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
