// Control characters inside diff text (MM-062, from bot-2's verify killers):
// a step whose lines hold ESC, BEL, DEL, U+009B or U+0085 still draws the pane
// with its buttons on both surfaces, its diff cleaned; a NUL makes it binary.

import { expect, test } from 'claude-code/testing'

import { diffLines, hunksText, toHunks } from '../hooks/diff'
import { fakeGit, gitArgs, PANE, panes, PLUGIN, repo, runReplay, session, start, turn } from './fixtures'

const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/
const PANE_PROPS = {
  title: 'Play-by-Play',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}
const BAD = 'red \u001b[31mx\u001b[0m bel\u0007 del\u007f csi\u009b2J nel\u0085\n'

test('a diff whose lines hold control characters draws, cleaned, on both surfaces', async ($, on) => {
  const world = session(on)
  panes(on, true, world.opened)
  on('tool.call', { tool: 'Write' }, () => ({
    result: { type: 'update', filePath: '/repo/build.log', content: `ok\n${BAD}`, structuredPatch: [], originalFile: 'ok\n' },
    text: 'updated',
  }))
  await start($)
  await turn($, 't1', () => $.tool.call({ tool: 'Write', file_path: '/repo/build.log', content: `ok\n${BAD}` }))
  await runReplay($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
    const code = await ui.find({ type: 'Code' })
    expect(code).toBeDefined()
    const source = String((code?.props as { source?: string }).source)
    expect(CTRL.test(source)).toBe(false)
    expect(source).toContain('+red x bel� del� csi nel�')
    for (const key of ['prev', 'next', 'close']) expect(await ui.find({ key })).toBeDefined()
    await ui.unmount()
  }
})

test('a diff line holding a NUL is a binary step, and the pane still draws with its buttons', async ($, on) => {
  const world = session(on)
  panes(on, true, world.opened)
  on('tool.call', { tool: 'Write' }, () => ({
    result: { type: 'update', filePath: '/repo/data.log', content: `ok\nnul\u0000 ${BAD}`, structuredPatch: [], originalFile: 'ok\n' },
    text: 'updated',
  }))
  await start($)
  await turn($, 't1', () => $.tool.call({ tool: 'Write', file_path: '/repo/data.log', content: `ok\nnul\u0000 ${BAD}` }))
  await runReplay($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^binary file changed \(\d+ bytes\)$/ })).toBeDefined()
    for (const key of ['prev', 'next', 'close']) expect(await ui.find({ key })).toBeDefined()
    await ui.unmount()
  }
})

test('hunksText output holds no control characters', () => {
  const { text } = hunksText(toHunks(diffLines(['ok'], ['ok', BAD.trimEnd()])))
  expect(text).toContain('red')
  expect(CTRL.test(text)).toBe(false)
})

test('the key line promises arrows only after a click', async ($, on) => {
  const world = session(on)
  panes(on, true, world.opened)
  on('tool.call', { tool: 'Write' }, () => ({
    result: { type: 'create', filePath: '/repo/a.txt', content: 'x\n', structuredPatch: [], originalFile: null },
    text: 'ok',
  }))
  await start($)
  await turn($, 't1', () => $.tool.call({ tool: 'Write', file_path: '/repo/a.txt', content: 'x\n' }))
  await runReplay($)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  const keys = await ui.find({ type: 'Client', key: 'keys' })
  const hint = String(((keys?.props as { props?: { hint?: string } }).props ?? {}).hint)
  expect(hint).toContain('click this line for the arrow keys')
  expect(hint).not.toMatch(/up\/down/)
})

test('git show reads its spec as a revision only (a [slug] path is no glob)', async ($, on) => {
  const git = repo({ diff: '' })
  const world = session(on)
  panes(on, false, world.opened)
  fakeGit(on, git)
  on('tool.call', { tool: 'Bash' }, () => {
    git.diff = DIFF
    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  })
  git.base = { 'app/[slug]/page.tsx': 'a\n' }
  await start($)
  await turn($, 't1', () => $.tool.call({ tool: 'Bash', command: "sed -i '' s/a/b/ 'app/[slug]/page.tsx'" }))
  const shows = git.calls.map(gitArgs).filter(args => args[0] === 'show')
  expect(shows.length).toBeGreaterThan(0)
  for (const args of shows) expect(args[args.length - 1]).toBe('--')
  expect(await runReplay($)).toContain('1. app/[slug]/page.tsx (edit) +1 −1 via shell')
})

const DIFF = `diff --git a/app/[slug]/page.tsx b/app/[slug]/page.tsx
index 1111111..2222222 100644
--- a/app/[slug]/page.tsx
+++ b/app/[slug]/page.tsx
@@ -1 +1 @@
-a
+b
`
