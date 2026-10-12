// The engine beneath pop-quiz in its tests: tools that change files, the turn
// events, a small model whose replies the test scripts, the store, the band.

import type { On, PromptOrigin, RenderSurface } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

export const PLUGIN = 'pop-quiz'
export const SURFACES = ['terminal', 'desktop'] as const
export const PERSON: PromptOrigin = { kind: 'composer' }
export const ROOT = '/work/app'
export const USAGE = { input_tokens: 900, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

export const reply = (questions: { q: string; a: string }[]) => `${JSON.stringify({ questions })}\nEND`
export const TWO = reply([
  { q: 'Why does the migration add an index on user_id?', a: 'Lookups by user were a full scan.' },
  { q: 'What does retry() now do on a 429?', a: 'Waits for the Retry-After header, then tries once more.' },
])

export type World = {
  clock: MockClock
  /** Every model request, in order. */
  calls: { model: string; system: string; prompt: string; maxTokens: number }[]
  /** The model's next replies, in order: a text, 'fail' (not answered) or 'deny' (refused). The last repeats. */
  replies: string[]
  store: Map<string, unknown>
  toasts: string[]
  surfaces: RenderSurface[]
}

export function world(on: On): World {
  const w: World = { clock: mock.clock(on, { now: Date.UTC(2026, 9, 12, 9) }), calls: [], replies: [TWO], store: new Map(), toasts: [], surfaces: ['terminal'] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('session.surfaces', () => ({ value: w.surfaces }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('store.get', ($, e) => ({ value: w.store.get(e.key) }))
  on('store.set', ($, e) => {
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('model.complete', ($, e) => {
    w.calls.push({ model: e.model, system: e.system ?? '', prompt: e.prompt, maxTokens: e.maxTokens ?? 0 })
    const answer = w.replies[Math.min(w.calls.length, w.replies.length) - 1] ?? TWO
    if (answer === 'deny') return { deny: 'model claude-haiku is not allowed here' }
    if (answer === 'fail') return { value: { isAnswered: false, reason: 'overloaded' } as never }
    return { value: { isAnswered: true, text: answer, usage: USAGE } as never }
  })
  on('tool.call', ($, e) => ({ result: { ok: true, tool: e.tool } }) as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="below" />
  })
  return w
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

/** One main turn: it starts, runs these tool calls, and answers. Then the clock lets the quiz run. */
export async function turn($: Engine, w: World, calls: Record<string, unknown>[] = [], id = `t${Math.random()}`): Promise<void> {
  await $.turn.start({ turnId: id, prompt: 'go', origin: { kind: 'composer' } } as never)
  for (const call of calls) await $.tool.call(call as never)
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: id, reason: 'answer' })
  await w.clock.advance(1)
}

export const edit = (path = `${ROOT}/src/db.ts`, before = 'const a = 1', after = 'const a = 2') => ({ tool: 'Edit', file_path: path, old_string: before, new_string: after })
export const write = (path = `${ROOT}/src/new.ts`, content = 'export const b = 1\n') => ({ tool: 'Write', file_path: path, content })
export const readFile = (path = `${ROOT}/src/db.ts`) => ({ tool: 'Read', file_path: path })

export function quizCmd($: Engine, args: string, origin: PromptOrigin = PERSON) {
  return $.command.run({ command: 'pop-quiz', args, origin, presentation: { isFullscreen: true, columns: 120 } })
}

export const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} }

export function band($: Engine, surface: RenderSurface = 'terminal') {
  return $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })
}

export async function bandTexts($: Engine, surface: RenderSurface = 'terminal'): Promise<string[]> {
  const ui = await band($, surface)
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()
  return texts
}
