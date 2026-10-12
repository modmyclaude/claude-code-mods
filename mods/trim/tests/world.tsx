// The engine beneath trim in its tests: a Bash tool whose output the test sets,
// the engine's own drawing of a result row, panes, toasts and the status line.

import type { On, PromptOrigin, RenderPropsOf, RenderSurface, ToolCallResult } from 'claude-code'
import type { Engine } from 'claude-code/testing'

export const PLUGIN = 'trim'
export const SURFACES = ['terminal', 'desktop'] as const
export const PERSON: PromptOrigin = { kind: 'composer' }

export type World = {
  /** What the next Bash call prints, by command; a missing command prints nothing. */
  stdout: Record<string, string>
  stderr: Record<string, string>
  /** Fields added to every Bash record (an image, a background job, a saved output). */
  extra: Record<string, unknown>
  /** Commands that fail (core reports an error with this text). */
  failing: Record<string, string>
  /** The id each call ran under, in order. */
  ids: string[]
  toasts: string[]
  /** The status line, as last set. */
  status: string | undefined
  /** Panes opened, by id, in order. */
  opened: string[]
  isPanePlaced: boolean
  surfaces: RenderSurface[]
}

export function world(on: On): World {
  const w: World = { stdout: {}, stderr: {}, extra: {}, failing: {}, ids: [], toasts: [], status: undefined, opened: [], isPanePlaced: true, surfaces: ['terminal'] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: w.surfaces }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    w.status = e.text
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: w.isPanePlaced ? { isPlaced: true } : { isPlaced: false, reason: 'no room' } }
  })
  on('tool.call', ($, e): ToolCallResult => {
    const id = e.tool_use_id ?? `u${w.ids.length + 1}`
    w.ids.push(id)
    if (e.tool !== 'Bash') return { result: { file: { content: 'x'.repeat(20_000) } }, text: 'x'.repeat(20_000) }
    const failure = w.failing[e.command]
    if (failure !== undefined) return { isError: true, result: failure, text: failure }
    const stdout = w.stdout[e.command] ?? ''
    const stderr = w.stderr[e.command] ?? ''
    return { result: { stdout, stderr, interrupted: false, ...w.extra }, text: stdout + (stderr ? `\n${stderr}` : '') }
  })
  // The engine's own row: how many lines of stdout it was handed to draw, so a test sees what reached it.
  on('ui.render', { component: 'ToolResult' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    const out = e.props.output as { stdout?: unknown } | undefined
    const lines = typeof out?.stdout === 'string' ? out.stdout.split('\n').length : 0
    return <Text key="engine-row">{`engine row: ${lines} lines`}</Text>
  })
  return w
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
}

/** One Bash call through every plugin, as the model's call runs. */
export function bash($: Engine, command: string): Promise<ToolCallResult> {
  return $.tool.call({ tool: 'Bash', command })
}

/** The stdout the model reads from what trim answered. */
export function stdoutOf(ran: ToolCallResult): string {
  return String((ran.result as { stdout?: unknown } | undefined)?.stdout ?? '')
}

/** `/trim <args>`, from the person unless another origin is given. */
export function trim($: Engine, args = '', origin: PromptOrigin = PERSON) {
  return $.command.run({ command: 'trim', args, origin, presentation: { isFullscreen: true, columns: 120 } })
}

/** `n` lines, `line i` each, from 1. */
export function numbered(n: number, word = 'line'): string {
  return Array.from({ length: n }, (_, i) => `${word} ${i + 1}`).join('\n') + '\n'
}

export const PANE_PROPS = {
  title: 'trim',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

/** A pane's text lines on a surface. */
export async function paneTexts($: Engine, requestId: string, surface: RenderSurface = 'terminal'): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId, props: PANE_PROPS })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()
  return texts
}

/** The row props the engine draws a Bash call's result with. */
export function row(id: string, stdout: string): RenderPropsOf['ToolResult'] {
  return { tool_use_id: id, tool: 'Bash', output: { stdout, stderr: '', interrupted: false }, isErrored: false }
}
