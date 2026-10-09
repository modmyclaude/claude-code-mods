// The engine beneath Second Wind, for the tests: a mocked clock, an in-memory
// store the test can read back, answers for every call the mod makes on `$`
// (status, copy, surfaces, command registration), the engine's own spinner
// and band, and raisers for the events a session makes.

import { mock } from 'claude-code/testing'
import type { On, PromptEditInput, PromptEditResult, RenderPropsOf, RenderSurface, RenderViewport } from 'claude-code'
import type { Engine, Plugin } from 'claude-code/testing'

export const PLUGIN = 'second-wind'
export const SURFACES = ['terminal', 'desktop'] as const
export type Surface = (typeof SURFACES)[number]

/** 2026-10-09 14:00 UTC: no daylight-saving change within days of it in common zones. */
export const T0 = Date.UTC(2026, 9, 9, 14, 0, 0)
export const DAY_MS = 86_400_000

export const VIEWPORT: RenderViewport = { columns: 120, rows: 40, isFullscreen: true }

export function bandProps(over: Partial<RenderPropsOf['AbovePrompt']> = {}): RenderPropsOf['AbovePrompt'] {
  return {
    hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 11 }, view: {}, ...over,
  }
}

export function spinnerProps(over: Partial<RenderPropsOf['Spinner']> = {}): RenderPropsOf['Spinner'] {
  return { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking', ...over }
}

/**
 * Counts the mod's timers: every `clock.every` period and `clock.after` the mod
 * asks for passes this plugin's hooks, which say so in a toast the test reads.
 */
export const timerSpy: Plugin = {
  name: 'timer-spy',
  register(on) {
    on('clock.every', ($, e, next) => {
      $.ui.toast(`spy:every:${e.ms}`)
      return next(e)
    })
    on('clock.after', ($, e, next) => {
      $.ui.toast(`spy:after:${e.ms}`)
      return next(e)
    })
  },
}

/** Makes every tick late: each period waits another 130 ms before it fires. */
export const lateTicks: Plugin = {
  name: 'late-ticks',
  register(on) {
    on('clock.every', async ($, e, next) => {
      await $.clock.sleep(130)
      return next(e)
    })
  },
}

/** Another mod drawing in the band, which composes with what is beneath it. */
export const neighbour: Plugin = {
  name: 'neighbour',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const { Box, Text } = $.ui.resolve(e)
      const rest = await next(e)
      return (
        <Box key="neighbour" flexDirection="column">
          <Text>neighbour mod</Text>
          {rest}
        </Box>
      )
    })
  },
}

type EditCall = (e: PromptEditInput) => Promise<PromptEditResult>

export type WorldSetup = {
  store?: Record<string, unknown>
  surfaces?: RenderSurface[]
  isCopied?: boolean
  storeFails?: boolean
}

export function world(on: On, setup: WorldSetup = {}) {
  const clock = mock.clock(on, { now: T0 })
  const store = new Map<string, unknown>(Object.entries(setup.store ?? {}))
  const rec = {
    toasts: [] as string[],
    statuses: [] as (string | undefined)[],
    copies: [] as string[],
    registered: [] as { name: string; immediate?: true }[],
    surfaces: setup.surfaces ?? (['terminal'] as RenderSurface[]),
    edits: [] as PromptEditInput[],
    storeFails: setup.storeFails ?? false,
  }

  // An in-memory store the test can read back (JSON in, JSON out, as the engine keeps it).
  on('store.get', ($, e) => {
    if (rec.storeFails) throw new Error('store unavailable')
    const v = store.get(e.key)
    return { value: v === undefined ? undefined : JSON.parse(JSON.stringify(v)) }
  })
  on('store.set', ($, e) => {
    if (rec.storeFails) throw new Error('store unavailable')
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', ($, e) => (store.delete(e.key), { value: undefined }))

  on('ui.toast', ($, e) => (rec.toasts.push(e.text), { value: undefined }))
  on('ui.status', ($, e) => (rec.statuses.push(e.text), { value: undefined }))
  on('ui.copy', ($, e) => {
    rec.copies.push(e.text)
    return { value: setup.isCopied === false ? { isCopied: false as const, reason: 'no-clipboard' as const } : { isCopied: true as const } }
  })
  on('session.surfaces', () => ({ value: rec.surfaces }))
  on('command.register', ($, e) => {
    rec.registered.push({ name: e.name, ...(e.immediate === true ? { immediate: true as const } : {}) })
    return { value: { command: e.name } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  // The editor applies the splice, as core does.
  on('prompt.edit', ($, e) => {
    rec.edits.push(e)
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))

  // The engine's own drawings, so a test can see what the mod passed down.
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    // Drawn as the engine does (a status message wins over the word), plus the
    // props as received, so a test sees exactly what the mod passed down.
    return (
      <Box key="engine-spinner-site" flexDirection="column">
        <Box key="engine-spinner">
          <Text>{`${e.props.message ?? e.props.word}${e.props.suffix}`}</Text>
        </Box>
        <Box key="engine-spinner-word">
          <Text>{e.props.word}</Text>
        </Box>
      </Box>
    )
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key="engine-band">
        <Text>engine</Text>
      </Box>
    )
  })

  let turns = 0
  return {
    clock,
    rec,
    store,
    async session($: Engine) {
      return $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    },
    /** The main conversation's turn begins. */
    async start($: Engine) {
      turns += 1
      return $.turn.start({ text: 'go', turnId: `turn-${turns}` })
    },
    /** A turn ends: the main loop's unless `agentId` names a subagent's. */
    async complete($: Engine, opts: { agentId?: string; reason?: 'answer' | 'aborted' | 'error'; answer?: string } = {}) {
      const reason = opts.reason ?? 'answer'
      return $.turn.complete({
        answer: opts.answer ?? 'Done.', durationMs: 1, isAborted: reason === 'aborted', turnId: `turn-${turns}`,
        reason, ...(opts.agentId !== undefined ? { agentId: opts.agentId } : {}),
      })
    },
    /**
     * One edit in the prompt box. The kit raises prompt.edit through `$` at run
     * time; its typed Engine (2.1.293) does not list that call, hence the cast.
     */
    async edit($: Engine, text: string, start: number, end: number, inputText: string) {
      const edit = ($ as unknown as { prompt: { edit: EditCall } }).prompt.edit
      return edit({ origin: { kind: 'composer' }, text, cursor: start, start, end, inputText })
    },
    async breathe($: Engine, args = '') {
      return $.command.run({ command: 'breathe', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
    },
    band($: Engine, surface: Surface, over: Partial<RenderPropsOf['AbovePrompt']> = {}) {
      return $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(over), viewport: VIEWPORT })
    },
    spinner($: Engine, surface: Surface, over: Partial<RenderPropsOf['Spinner']> = {}) {
      return $.ui.mount({ plugin: PLUGIN, surface, component: 'Spinner', props: spinnerProps(over), viewport: VIEWPORT })
    },
    /** How many timer periods of each kind the spy saw. */
    timers() {
      const every = rec.toasts.filter(t => t.startsWith('spy:every:')).length
      const after = rec.toasts.filter(t => t.startsWith('spy:after:')).length
      return { every, after, all: every + after }
    },
  }
}

export type World = ReturnType<typeof world>
