// The world beneath Headway in tests: a mocked clock and store, the session's
// root, toasts and pane opens recorded, and stub answers for Claude's plan
// tools, turns and subagents. Each tool stub answers `{ result, text }` as core does.

import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { CommandSpec, On, RenderSurface } from 'claude-code'

export const PLUGIN = 'headway'
export const ROOT = '/work/app'
export const START = 1_000_000
export const SURFACES = ['terminal', 'desktop'] as const

export type World = {
  clock: MockClock
  toasts: string[]
  opened: string[]
  /** How many timer periods have been asked so far (one `clock.every` dispatch each). */
  periods: () => number
  /** What ExitPlanMode answers as the approved plan. */
  plan: { text: string | null }
  /** What TaskList answers. */
  tasks: { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed'; blockedBy: string[] }[]
  /** Makes TodoWrite answer a refusal (`deny`) or an error (`fail`) as another hook or the tool would. */
  todo: { deny?: string; fail?: boolean }
  /** What Headway last wrote to its store, by key. */
  stored: Record<string, unknown>
  /** Makes `$.session.root()` reject, to show a failure inside Headway never reaches the tool call. */
  root: { deny?: string }
  /** What `$.session.surfaces()` answers; tests attach and detach by editing it. */
  surfaces: RenderSurface[]
  /** Delays (clock ms), one per call, for the next `$.session.surfaces()` answers; each answers what was attached when asked. */
  late: number[]
  /** What Headway handed `$.command.register`. */
  registered: CommandSpec[]
}

export function world(on: On, store: Record<string, unknown> = {}, surfaces: RenderSurface[] = ['terminal']): World {
  const toasts: string[] = []
  const opened: string[] = []
  const plan = { text: null as string | null }
  const tasks: World['tasks'] = []
  const todo: World['todo'] = {}
  const root: World['root'] = {}
  const late: number[] = []
  const registered: CommandSpec[] = []
  let periods = 0
  let taskId = 0

  on('clock.every', { ms: 1000 }, ($, e, next) => {
    periods += 1
    return next(e)
  })
  const stored: Record<string, unknown> = {}
  on('store.set', { key: 'history' }, ($, e, next) => {
    stored[e.key] = e.value
    return next(e)
  })
  const clock = mock.clock(on, { now: START })
  mock.store(on, store)

  on('session.root', () => (root.deny === undefined ? { value: ROOT } : { deny: root.deny }))
  on('session.surfaces', async () => {
    const answer = [...surfaces]
    const delay = late.shift()
    if (delay !== undefined) await clock.sleep(delay)
    return { value: answer }
  })
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    registered.push(e)
    return { value: { command: e.name } }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', ($, e) => ({ model: 'stub', agentId: `agent-${e.description}` }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))

  on('tool.call', { tool: 'TodoWrite' }, ($, e) => {
    if (todo.deny !== undefined) return { deny: todo.deny }
    if (todo.fail === true) return { isError: true, result: undefined, text: 'TodoWrite failed' }
    // As core may: a list that is all done comes back cleared in the result, so Headway must read the input.
    const isAllDone = Array.isArray(e.todos) && e.todos.every(item => item.status === 'completed')
    return { result: { oldTodos: [], newTodos: isAllDone ? [] : e.todos }, text: 'Todos updated' }
  })
  on('tool.call', { tool: 'TaskList' }, () => ({ result: { tasks: [...tasks] }, text: `${tasks.length} tasks` }))
  on('tool.call', { tool: 'TaskCreate' }, ($, e) => {
    taskId += 1
    return { result: { task: { id: String(taskId), subject: e.subject } }, text: `Task #${taskId} created` }
  })
  on('tool.call', { tool: 'TaskUpdate' }, ($, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: ['status'] },
    text: 'Updated',
  }))
  on('tool.call', { tool: 'ExitPlanMode' }, () => ({
    result: { plan: plan.text, isAgent: false },
    text: 'User has approved your plan.',
  }))

  return { clock, toasts, opened, periods: () => periods, plan, tasks, todo, root, stored, surfaces, late, registered }
}

export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed' }

export async function todos($: Engine, list: readonly Todo[]) {
  return $.tool.call({ tool: 'TodoWrite', todos: list.map(todo => ({ ...todo, activeForm: todo.content })) })
}

export async function clear($: Engine) {
  await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
}

export async function turnStart($: Engine) {
  await $.turn.start({ text: 'go', turnId: 'turn-1' })
}

export async function turnEnd($: Engine, agentId?: string) {
  await $.turn.complete({
    answer: '',
    durationMs: 0,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
    ...(agentId === undefined ? {} : { agentId }),
  })
}

/** A todo list of `total` steps with the first `done` completed and the next in progress. */
export function list(titles: readonly string[], done: number): Todo[] {
  return titles.map((content, index) => ({
    content,
    status: index < done ? 'completed' : index === done ? 'in_progress' : 'pending',
  }))
}

export const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

export const PANE_PROPS = {
  component: 'Pane',
  requestId: 'headway',
  props: { title: 'Headway', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

/** Stands for another mod drawing in the band beneath Headway. */
export function beneath(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="other-mod">another mod's line</Text>
  })
}

/** A band line as the desktop draws it: the bar in the collection's cells, █ done and ░ left. */
export function deskLine(line: string | undefined): string | undefined {
  return line?.replace(/▰/g, '█').replace(/▱/g, '░')
}

/** The band's text as one string (Headway's part only), or undefined when Headway drew nothing. */
export async function bandText($: Engine, surface: (typeof SURFACES)[number]): Promise<string | undefined> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
  const line = await ui.find({ key: 'headway' })
  await ui.unmount()
  return line?.text
}
