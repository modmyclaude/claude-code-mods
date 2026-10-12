// The engine beneath chapters in its tests: a fake git that answers diffs and
// records every command, a small model whose replies the test scripts, the
// prompt box (which records fills and any submit), panes, toasts and the band.

import type { On, PromptOrigin, RenderSurface } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

export const PLUGIN = 'chapters'
export const SURFACES = ['terminal', 'desktop'] as const
export const PERSON: PromptOrigin = { kind: 'composer' }
export const ROOT = '/work/app'
export const MB = 'c'.repeat(40)

export const reply = (chapters: object[]) => `${JSON.stringify({ chapters })}\nEND`
export const TWO = reply([
  { title: 'Retry on 429', files: [{ path: 'src/api.ts', lines: [10, 14] }], what: 'retry() now waits and tries once more.', why: 'Rate limits no longer fail the sync.', risk: 'high', riskWhy: 'it can double a write', question: 'Is the write idempotent?' },
  { title: 'Docs', files: [{ path: 'README.md' }], what: 'The README explains retries.', why: '', risk: 'none', riskWhy: '', question: 'Is the limit right?' },
])

export const DIFF = [
  'diff --git a/src/api.ts b/src/api.ts',
  'index 1111111..2222222 100644',
  '--- a/src/api.ts',
  '+++ b/src/api.ts',
  '@@ -10,2 +10,4 @@ export async function sync() {',
  '   const r = await call()',
  '-  if (!r.ok) throw r',
  '+  if (r.status === 429) return retry()',
  '+  if (!r.ok) throw r',
  '+  return r',
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1,1 +1,2 @@',
  ' # App',
  '+Retries once on 429.',
].join('\n')

export type World = {
  clock: MockClock
  isGit: boolean
  hasHead: boolean
  /** What `git diff-index` and `git diff-tree` answer. */
  diff: string
  untracked: Record<string, string>
  /** Files the mod read, relative to the project. */
  reads: string[]
  /** Every git command, its arguments joined, and whether optional locks were off. */
  gits: string[]
  lockingGit: string[]
  /** Every model request's prompt; the replies in order ('fail', 'deny' or text), the last repeating. */
  prompts: string[]
  models: string[]
  replies: string[]
  box: string
  fills: string[]
  submits: string[]
  toasts: string[]
  opened: string[]
  isPaneShown: boolean
  surfaces: RenderSurface[]
}

export function world(on: On): World {
  const w: World = {
    clock: mock.clock(on, { now: Date.UTC(2026, 9, 12, 9) }),
    isGit: true, hasHead: true, diff: DIFF, untracked: {}, reads: [], gits: [], lockingGit: [], prompts: [], models: [], replies: [TWO],
    box: '', fills: [], submits: [], toasts: [], opened: [], isPaneShown: false, surfaces: ['terminal'],
  }
  mock.env(on, {})
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('session.surfaces', () => ({ value: w.surfaces }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: w.isPaneShown ? [{ id: 'chapters', title: 'chapters', isShown: true, isFocused: true, isPlaced: true }] : [] }))
  on('fs.read', ($, e) => {
    const name = e.path.slice(ROOT.length + 1)
    w.reads.push(name)
    return name in w.untracked ? { value: w.untracked[name]! } : { deny: `ENOENT ${e.path}` }
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
  on('model.complete', ($, e) => {
    w.prompts.push(e.prompt)
    w.models.push(e.model)
    const answer = w.replies[Math.min(w.prompts.length, w.replies.length) - 1] ?? TWO
    if (answer === 'deny') return { deny: 'not allowed here' }
    if (answer === 'fail') return { value: { isAnswered: false, reason: 'overloaded' } as never }
    return { value: { isAnswered: true, text: answer, usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never }
  })
  const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  const fail = () => ({ value: { exitCode: 128, stdout: '', stderr: 'fatal', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', ($, e) => {
    const [cmd, ...args] = e.argv
    if (cmd !== 'git') return fail()
    w.gits.push(args.join(' '))
    if (e.init?.env?.GIT_OPTIONAL_LOCKS !== '0') w.lockingGit.push(args.join(' '))
    if (!w.isGit) return fail()
    const sub = args.join(' ')
    if (sub === 'rev-parse --is-inside-work-tree') return ok('true\n')
    if (sub === 'rev-parse --verify HEAD') return w.hasHead ? ok(`${'d'.repeat(40)}\n`) : fail()
    if (args[0] === 'merge-base') return ok(`${MB}\n`)
    if (args[0] === 'diff-index' || args[0] === 'diff-tree') return ok(w.diff)
    if (args[0] === 'ls-files') return ok(Object.keys(w.untracked).map(n => `${n}\0`).join(''))
    return fail()
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

/** `/chapters <args>`, then the clock lets the review be written. */
export async function chapters($: Engine, w: World, args = '', origin: PromptOrigin = PERSON) {
  const ran = await $.command.run({ command: 'chapters', args, origin, presentation: { isFullscreen: true, columns: 120 } })
  await w.clock.advance(1)
  return ran
}

export const PANE_PROPS = { title: 'chapters', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }
export const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} }

export function pane($: Engine, surface: RenderSurface = 'terminal') {
  return $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'chapters', props: PANE_PROPS })
}

export async function paneTexts($: Engine, surface: RenderSurface = 'terminal'): Promise<string[]> {
  const ui = await pane($, surface)
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()
  return texts
}

export async function bandTexts($: Engine, surface: RenderSurface = 'terminal'): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()
  return texts
}
