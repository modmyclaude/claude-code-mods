// Recording through the real wiring: tool calls, turn events and /replay,
// with git answered beneath the plugin. With no pane placed, /replay lists
// the steps as text, which is what these tests read.

import { expect, test } from 'claude-code/testing'

import {
  DIFF_AFTER,
  fakeGit,
  fileTools,
  NOTHING,
  USAGE,
  panes,
  repo,
  runReplay,
  session,
  start,
  threeChanges,
  turn,
} from './fixtures'

const replay = runReplay

test('Edit, Write, then a Bash that changes a file: three steps in order, right counts', async ($, on) => {
  const git = repo()
  const ran: string[] = []
  const { logs, opened, toasts } = session(on)
  panes(on, false, opened)
  fakeGit(on, git)
  fileTools(on, git, ran)
  await start($)
  await turn($, 't1', () => threeChanges($))

  expect(ran).toEqual(['Edit', 'Write', 'Bash'])
  expect(await replay($)).toBe(
    [
      'the latest turn: 3 edits · 2 files · +5 −3',
      '1. src/app.ts (edit) +2 −1',
      '2. README.md (write) +2 −1',
      // Only the line the command changed, not the Edit already in the tree.
      '3. src/app.ts (edit) +1 −1 via shell',
    ].join('\n'),
  )
  expect(opened).toEqual(['play-by-play'])
  expect(logs).toEqual([])
})

test('a denied or failed file tool records nothing', async ($, on) => {
  const { logs, opened, toasts } = session(on)
  panes(on, false, opened)
  on('tool.call', { tool: 'Edit' }, () => ({ deny: 'not here' }))
  on('tool.call', { tool: 'Write' }, () => ({ isError: true, result: 'disk full', text: 'disk full' }))
  await start($)
  let denied: unknown
  await turn($, 't1', async () => {
    denied = await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Write', file_path: '/repo/b.ts', content: 'x\n' })
  })
  // The deny passes through untouched.
  expect(denied).toMatchObject({ deny: 'not here' })
  expect(await replay($)).toBe('') // the model reads nothing
  expect(toasts.pop()).toBe(NOTHING)
  expect(logs).toEqual([])
})

test('a denied Bash takes no second snapshot and records nothing', async ($, on) => {
  const git = repo()
  const { opened, toasts } = session(on)
  panes(on, false, opened)
  fakeGit(on, git)
  on('tool.call', { tool: 'Bash' }, () => ({ deny: 'blocked' }))
  await start($)
  await turn($, 't1', () => $.tool.call({ tool: 'Bash', command: 'rm -rf build' }))
  const diffs = git.calls.filter(argv => argv.includes('diff-index'))
  expect(diffs).toHaveLength(1)
  expect(await replay($)).toBe('') // the model reads nothing
  expect(toasts.pop()).toBe(NOTHING)
})

test('a failed Bash still records what it changed', async ($, on) => {
  const git = repo()
  const { opened, toasts } = session(on)
  panes(on, false, opened)
  fakeGit(on, git)
  on('tool.call', { tool: 'Bash' }, () => {
    git.diff = DIFF_AFTER
    return { isError: true, result: 'exit 1', text: 'Exit code 1' }
  })
  await start($)
  await turn($, 't1', () => $.tool.call({ tool: 'Bash', command: "sed -i '' s/one/ONE/ src/app.ts; false" }))
  expect(await replay($)).toContain('1. src/app.ts (edit) +1 −1 via shell')
})

test('outside a git repository the command runs and nothing is recorded', async ($, on) => {
  const git = repo({ isRepo: false })
  const { logs, opened, toasts } = session(on)
  panes(on, false, opened)
  fakeGit(on, git)
  const ran: string[] = []
  on('tool.call', { tool: 'Bash' }, () => {
    ran.push('Bash')
    return { result: { stdout: 'hi', stderr: '', interrupted: false }, text: 'hi' }
  })
  await start($)
  let result: unknown
  await turn($, 't1', async () => {
    result = await $.tool.call({ tool: 'Bash', command: 'echo hi > x' })
  })
  expect(ran).toEqual(['Bash'])
  expect(result).toMatchObject({ text: 'hi' })
  expect(git.calls).toHaveLength(1) // rev-parse alone
  expect(await replay($)).toBe('') // the model reads nothing
  expect(toasts.pop()).toBe(NOTHING)
  expect(logs).toEqual([])
})

test('when git cannot run at all the command still runs untouched', async ($, on) => {
  const { logs, debugLines, opened, toasts } = session(on)
  panes(on, false, opened)
  on('process.run', () => ({ deny: 'process is off here' }))
  const ran: string[] = []
  on('tool.call', { tool: 'Bash' }, () => {
    ran.push('Bash')
    return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }
  })
  await start($)
  let result: unknown
  await turn($, 't1', async () => {
    result = await $.tool.call({ tool: 'Bash', command: 'make' })
  })
  expect(ran).toEqual(['Bash'])
  expect(result).toMatchObject({ text: 'ok' })
  expect(debugLines.some(line => line.includes('git failed around a command'))).toBe(true)
  expect(logs).toEqual([
    'play-by-play: shell tracking paused for this session (git did not answer in time here); file tools are still tracked.',
  ])
})

test('shell: a new untracked file, a plain mv, and a git add that changes nothing', async ($, on) => {
  const git = repo({
    diff: '',
    // 1275430f... is git's hash of 'same\n'; bbbb2222 stands for old-name.txt's bytes.
    untracked: { 'staged-later.txt': '1275430f1765c63e539cb0452565563bd6aef6a6', 'old-name.txt': 'bbbb2222' },
    base: {},
  })
  const { opened, toasts } = session(on)
  panes(on, false, opened)
  fakeGit(on, git)
  on('tool.call', { tool: 'Bash' }, () => {
    // `echo hi > notes.txt && mv old-name.txt new-name.txt && git add staged-later.txt`
    git.untracked = { 'notes.txt': 'cccc3333', 'new-name.txt': 'bbbb2222' }
    git.noIndex = {
      'notes.txt': 'diff --git a/notes.txt b/notes.txt\nnew file mode 100644\n--- /dev/null\n+++ b/notes.txt\n@@ -0,0 +1 @@\n+hi\n',
      'new-name.txt':
        'diff --git a/new-name.txt b/new-name.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new-name.txt\n@@ -0,0 +1 @@\n+kept\n',
    }
    git.diff =
      'diff --git a/staged-later.txt b/staged-later.txt\nnew file mode 100644\nindex 0000000..1275430\n--- /dev/null\n+++ b/staged-later.txt\n@@ -0,0 +1 @@\n+same\n'
    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  })
  await start($)
  await turn($, 't1', () => $.tool.call({ tool: 'Bash', command: 'several things' }))
  expect(await replay($)).toBe(
    [
      'the latest turn: 2 edits \u00b7 2 files \u00b7 +1 \u22120',
      // ls-files order is sorted: new-name.txt before notes.txt.
      '1. old-name.txt -> new-name.txt (rename) +0 \u22120 via shell',
      '2. notes.txt (create) +1 \u22120 via shell',
    ].join('\n'),
  )
})

test('a shell edit to a file a tool just wrote diffs against the tool\'s text', async ($, on) => {
  const written = 'alpha\nbeta\n'
  const git = repo({ diff: '', base: {} })
  const { opened, toasts } = session(on)
  panes(on, false, opened)
  fakeGit(on, git)
  on('tool.call', { tool: 'Write' }, () => {
    // git's hash of 'alpha\nbeta\n', the bytes the tool wrote.
    git.untracked = { 'gen.txt': 'fbbee861521bd5355538b096fa3998541cd33909' }
    return {
      result: { type: 'create', filePath: '/repo/gen.txt', content: written, structuredPatch: [], originalFile: null },
      text: 'created',
    }
  })
  on('tool.call', { tool: 'Bash' }, () => {
    git.untracked = { 'gen.txt': 'dddd4444' }
    git.noIndex = {
      'gen.txt': 'diff --git a/gen.txt b/gen.txt\nnew file mode 100644\n--- /dev/null\n+++ b/gen.txt\n@@ -0,0 +1,2 @@\n+alpha\n+BETA\n',
    }
    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  })
  await start($)
  await turn($, 't1', async () => {
    await $.tool.call({ tool: 'Write', file_path: '/repo/gen.txt', content: written })
    await $.tool.call({ tool: 'Bash', command: "sed -i '' s/beta/BETA/ gen.txt" })
  })
  const text = await replay($)
  expect(text).toContain('1. gen.txt (create) +2 \u22120')
  expect(text).toContain('2. gen.txt (edit) +1 \u22121 via shell')
})

test('an untracked file changed by a command, with no trusted earlier copy, shows without lines', async ($, on) => {
  const git = repo({ diff: '', base: {}, untracked: { 'log.txt': 'eeee5555' } })
  const { opened, toasts } = session(on)
  panes(on, false, opened)
  fakeGit(on, git)
  on('tool.call', { tool: 'Bash' }, () => {
    git.untracked = { 'log.txt': 'ffff6666' }
    git.noIndex = { 'log.txt': 'diff --git a/log.txt b/log.txt\nnew file mode 100644\n--- /dev/null\n+++ b/log.txt\n@@ -0,0 +1 @@\n+x\n' }
    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  })
  await start($)
  await turn($, 't1', () => $.tool.call({ tool: 'Bash', command: 'echo x >> log.txt' }))
  expect(await replay($)).toContain('1. log.txt (change) +0 \u22120 via shell')
})

test('/replay argument errors and the turn window', async ($, on) => {
  const { opened, toasts } = session(on)
  panes(on, false, opened)
  await start($)
  expect(await replay($, 'abc')).toBe('')
  expect(toasts.pop()).toBe(USAGE)
  expect(await replay($, '11')).toBe('')
  expect(toasts.pop()).toBe(USAGE)
  expect(opened).toEqual([])
})

test('only the last 10 turns with changes are kept; turns without changes are skipped', async ($, on) => {
  const { opened, toasts } = session(on)
  panes(on, false, opened)
  on('tool.call', { tool: 'Write' }, ($, e) => ({
    result: { type: 'create', filePath: e.file_path, content: 'x\n', structuredPatch: [], originalFile: null },
    text: 'created',
  }))
  await start($)
  for (let i = 1; i <= 12; i++) {
    await turn($, `t${i}`, () => $.tool.call({ tool: 'Write', file_path: `/repo/f${i}.txt`, content: 'x\n' }))
    await turn($, `quiet${i}`, async () => undefined)
  }
  expect(await replay($, '1')).toContain('1. f12.txt (create)')
  expect(await replay($, '10')).toContain('1. f3.txt (create)')
  expect(await replay($, '10')).toContain('turn 10 back')
  expect(await replay($, '11')).toBe('')
  expect(toasts.pop()).toBe(USAGE)
})

test('a subagent finishing mid-turn neither ends nor splits the main turn', async ($, on) => {
  const { opened, toasts } = session(on)
  panes(on, false, opened)
  on('tool.call', { tool: 'Write' }, ($, e) => ({
    result: { type: 'create', filePath: e.file_path, content: 'x\n', structuredPatch: [], originalFile: null },
    text: 'created',
  }))
  await start($)
  await $.turn.start({ text: 'refactor with a helper agent', turnId: 'main' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/before.txt', content: 'x\n' })
  // A subagent's run: an engine-raised start and end carrying its agentId.
  const subStart = { text: 'sub task', turnId: 'sub', agentId: 'agent-1' }
  await $.turn.start(subStart)
  await $.tool.call({ tool: 'Write', file_path: '/repo/by-agent.txt', content: 'x\n' })
  await $.turn.complete({ answer: 'sub done', durationMs: 5, isAborted: false, turnId: 'sub', agentId: 'agent-1', reason: 'answer' })
  // The hint does not come up while the main turn still runs.
  expect(await replay($)).toBe('') // the model reads nothing
  expect(toasts.pop()).toBe(NOTHING)
  await $.tool.call({ tool: 'Write', file_path: '/repo/after.txt', content: 'x\n' })
  await $.turn.complete({ answer: 'done', durationMs: 50, isAborted: false, turnId: 'main', reason: 'answer' })
  expect(await replay($)).toBe(
    [
      'the latest turn: 3 edits · 3 files · +3 −0',
      '1. before.txt (create) +1 −0',
      '2. by-agent.txt (create) +1 −0',
      '3. after.txt (create) +1 −0',
    ].join('\n'),
  )
  expect(await replay($, '2')).toBe('')
  expect(toasts.pop()).toBe('play-by-play: only 1 turn with changes kept; try /replay 1 to 1.')
})

test('shell: a staged git mv that also edits shows as one rename with its line changes', async ($, on) => {
  const git = repo({ diff: '', base: { 'old.ts': 'keep\nold line\n' } })
  const { opened, toasts } = session(on)
  panes(on, false, opened)
  fakeGit(on, git)
  on('tool.call', { tool: 'Bash' }, () => {
    git.diff = [
      'diff --git a/old.ts b/new.ts',
      'similarity index 50%',
      'rename from old.ts',
      'rename to new.ts',
      'index 1111111..2222222 100644',
      '--- a/old.ts',
      '+++ b/new.ts',
      '@@ -1,2 +1,2 @@',
      ' keep',
      '-old line',
      '+new line',
      '',
    ].join('\n')
    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  })
  await start($)
  await turn($, 't1', () => $.tool.call({ tool: 'Bash', command: 'git mv old.ts new.ts && sed -i "" s/old/new/ new.ts' }))
  expect(await replay($)).toBe(
    ['the latest turn: 1 edit · 1 file · +1 −1', '1. old.ts -> new.ts (rename) +1 −1 via shell'].join('\n'),
  )
})
