// The world beneath swear-jar in a test: a store in memory, the toasts, logs,
// status lines and panes it asked for, the model's replies as a test queues
// them, the base system prompt, and another mod's band line (or a safety hold)
// beneath its own.

import type { On, RenderSurface } from 'claude-code'
import type { Engine } from 'claude-code/testing'

export const PLUGIN = 'swear-jar'
export const SURFACES = ['terminal', 'desktop'] as const

/** What the engine's own drawing looks like in a test: an `engine` element. */
const ENGINE = { type: 'engine', ref: 0 } as const

export type World = {
  toasts: string[]
  logs: string[]
  statuses: (string | undefined)[]
  panes: string[]
  store: Map<string, unknown>
  isPanePlaced: boolean
  /** Another mod's safety hold is drawn beneath the band. */
  holdBeneath: boolean
  /** Another mod waits beneath with Send now and Cancel: not a hold. */
  waitBeneath: boolean
  /** Registering the command fails, as a refusing host would. */
  refuseCommand: boolean
}

const replies: string[] = []

export function world(on: On, options: { store?: Record<string, unknown>; isPanePlaced?: boolean; holdBeneath?: boolean; waitBeneath?: boolean; refuseCommand?: boolean } = {}): World {
  const w: World = {
    toasts: [],
    logs: [],
    statuses: [],
    panes: [],
    store: new Map(Object.entries(options.store ?? {})),
    isPanePlaced: options.isPanePlaced ?? true,
    holdBeneath: options.holdBeneath ?? false,
    waitBeneath: options.waitBeneath ?? false,
    refuseCommand: options.refuseCommand ?? false,
  }
  replies.length = 0
  on('store.get', ($, e) => ({ value: w.store.get(e.key) }))
  on('store.set', ($, e) => {
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    w.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('ui.toast', ($, e) => (w.toasts.push(e.text), { value: undefined }))
  on('ui.log', ($, e) => (w.logs.push(e.text), { value: undefined }))
  on('ui.status', ($, e) => (w.statuses.push(e.text), { value: undefined }))
  on('ui.open', ($, e) => {
    w.panes.push(e.id)
    return { value: w.isPanePlaced ? { isPlaced: true } : { isPlaced: false, reason: 'no room' } }
  })
  on('command.register', ($, e) => (w.refuseCommand ? { deny: 'no commands here' } : { value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('prompt.compose', () => ({ sections: [{ id: 'system', text: 'the base prompt', scope: 'shared' as const }] }))
  // The model: each request answers with the text the test queued for it.
  on('turn.step', async function* ($, e) {
    const answer = replies.shift() ?? ''
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
    return { turnId: e.turnId, index: e.index, answer, toolUses: [], stopReason: 'end_turn', usage: null }
  })
  // What sits beneath: in the band, another mod's line or a safety hold waiting for an answer;
  // for every other component, the engine's own drawing.
  on('ui.render', ($, e) => {
    if (e.component !== 'AbovePrompt') return ENGINE
    const { Box, Text, Button } = $.ui.resolve(e)
    if (w.holdBeneath) {
      return (
        <Box key="hold" flexDirection="row" gap={1}>
          <Text key="hold-text" color="error">
            held: rm -rf build
          </Text>
          <Button key="hold-cancel" label="Cancel" onPress={() => undefined} />
          <Button key="hold-proceed" label="Proceed" onPress={() => undefined} />
        </Box>
      )
    }
    if (w.waitBeneath) {
      return (
        <Box key="wait" flexDirection="row" gap={1}>
          <Text key="wait-text">held until the limit resets</Text>
          <Button key="wait-send" label="Send now" onPress={() => undefined} />
          <Button key="wait-cancel" label="Cancel" onPress={() => undefined} />
        </Box>
      )
    }
    return <Text key="other-mod">another mod's line</Text>
  })
  return w
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
}

/** One model response, as the engine reports it; `agentId` makes it a subagent's. */
export async function reply($: Engine, text: string, opts: { turnId?: string; agentId?: string } = {}): Promise<void> {
  replies.push(text)
  const stream = $.turn.step({ turnId: opts.turnId ?? 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3, agentId: opts.agentId })
  for await (const chunk of stream) void chunk
}

export async function run($: Engine, args: string) {
  return $.command.run({ command: 'swear-jar', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
}

export const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as const

export const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }

export const PANE_PROPS = {
  title: 'Swear jar',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

/** The band as drawn on a surface: swear-jar's own line, the other mod's line, and a hold, each or undefined. */
export async function band($: Engine, surface: RenderSurface) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })
  const out = {
    line: (await ui.find({ key: 'swear-jar' }))?.text,
    other: (await ui.find({ type: 'Text', text: "another mod's line" }))?.text,
    hold: (await ui.find({ key: 'hold' }))?.text,
    texts: (await ui.findAll({ type: 'Text' })).map(t => t.text),
  }
  await ui.unmount()
  return out
}

/** The pane's texts on a surface, top to bottom. */
export async function pane($: Engine, surface: RenderSurface, columns = 100) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PLUGIN, props: { ...PANE_PROPS, bodyColumns: columns } })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => ({ text: t.text, bold: t.props.bold === true }))
  const whole = (await ui.find({ key: 'swear-jar-pane' }))?.text ?? ''
  await ui.unmount()
  return { texts, whole }
}
