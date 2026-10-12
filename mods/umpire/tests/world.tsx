// The engine beneath umpire in its tests: a project's files, a test runner
// whose output and timing the test sets, the turn events, the store, the
// prompt box (recording fills and any submit), panes, toasts and the status.

import type { On, PromptOrigin, RenderSurface } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

export const PLUGIN = 'umpire'
export const SURFACES = ['terminal', 'desktop'] as const
export const PERSON: PromptOrigin = { kind: 'composer' }
export const ROOT = '/work/app'

export const JEST_PASS = 'PASS src/auth.test.ts\nTests:       144 passed, 144 total\nTime:        8.3 s\n'
export const JEST_FAIL = [
  'FAIL src/auth.test.ts',
  '  ● login › rejects a bad password',
  'FAIL src/user.test.ts',
  'PASS src/api.test.ts',
  'Tests:       2 failed, 142 passed, 144 total',
].join('\n')

export type World = {
  clock: MockClock
  /** The project's files: name to text ('' for a folder or an empty file). */
  files: Record<string, string>
  /** What the next runs answer, in order; the last repeats. `hang` sleeps past any limit; `cut` names the stream past 4 MB. */
  results: ({ stdout: string; exitCode: number; ms?: number; cut?: 'stdout' | 'stderr' } | 'hang' | 'missing')[]
  runs: { argv: string[]; cwd: string | undefined; env: Record<string, string> | undefined; timeoutMs: number | undefined }[]
  store: Map<string, unknown>
  box: string
  fills: string[]
  submits: string[]
  toasts: string[]
  status: (string | undefined)[]
  opened: string[]
  surfaces: RenderSurface[]
}

export function world(on: On): World {
  const w: World = {
    clock: mock.clock(on, { now: Date.UTC(2026, 9, 12, 9) }),
    files: { 'package.json': JSON.stringify({ scripts: { test: 'jest' } }), 'package-lock.json': '' },
    results: [{ stdout: JEST_PASS, exitCode: 0, ms: 8300 }],
    runs: [], store: new Map(), box: '', fills: [], submits: [], toasts: [], status: [], opened: [], surfaces: ['terminal'],
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('session.surfaces', () => ({ value: w.surfaces }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    w.status.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('store.get', ($, e) => ({ value: w.store.get(e.key) }))
  on('store.set', ($, e) => {
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  const name = (path: string) => path.slice(ROOT.length + 1)
  on('fs.exists', ($, e) => ({ value: name(e.path) in w.files }))
  on('fs.read', ($, e) => (name(e.path) in w.files ? { value: w.files[name(e.path)]! } : { deny: `ENOENT ${e.path}` }))
  on('process.run', async ($, e) => {
    w.runs.push({ argv: [...e.argv], cwd: e.init?.cwd, env: e.init?.env, timeoutMs: e.init?.timeoutMs })
    const r = w.results[Math.min(w.runs.length, w.results.length) - 1]!
    if (r === 'hang') {
      await w.clock.sleep(e.init?.timeoutMs ?? 30_000)
      return { deny: 'timed out' }
    }
    if (r === 'missing') return { deny: 'spawn jest ENOENT' }
    if (r.ms) await w.clock.sleep(r.ms)
    return { value: { exitCode: r.exitCode, stdout: r.stdout, stderr: '', isStdoutTruncated: r.cut === 'stdout', isStderrTruncated: r.cut === 'stderr' } }
  })
  on('prompt.read', () => ({ value: { text: w.box, cursor: w.box.length } }))
  on('prompt.fill', ($, e) => {
    w.fills.push(e.text)
    w.box = e.mode === 'append' ? w.box + e.text : e.text
    return { isFilled: true }
  })
  on('prompt.submit', ($, e) => {
    w.submits.push(e.text)
    return { text: e.text }
  })
  on('tool.call', ($, e) => ({ result: { ok: true, tool: e.tool } }) as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="below" />
  })
  return w
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

/** One main turn with these tool calls on this file, then the clock lets a run start (not finish). */
export async function turn($: Engine, w: World, tools: string[] = ['Edit'], path = `${ROOT}/src/a.ts`): Promise<void> {
  const id = `t${Math.random()}`
  await $.turn.start({ turnId: id, prompt: 'go', origin: { kind: 'composer' } } as never)
  for (const tool of tools) await $.tool.call({ tool, file_path: path, old_string: 'a', new_string: 'b', content: 'x', command: 'ls' } as never)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' })
  await w.clock.advance(1)
}

export function umpire($: Engine, args: string, origin: PromptOrigin = PERSON) {
  return $.command.run({ command: 'umpire', args, origin, presentation: { isFullscreen: true, columns: 120 } })
}

export const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} }
export const PANE_PROPS = { title: 'umpire', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }

export async function band($: Engine, surface: RenderSurface = 'terminal') {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })
  const found = await ui.find({ type: 'Text' })
  await ui.unmount()
  return found ? { text: found.text, color: found.props.color } : undefined
}

export function pane($: Engine, surface: RenderSurface = 'terminal') {
  return $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'umpire', props: PANE_PROPS })
}
