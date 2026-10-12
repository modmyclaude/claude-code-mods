// Review fixes (git stays read-only, a slow repository pauses
// shell tracking on the session's clock, binary files never reach a diff, and
// names with control characters still draw a pane with its buttons.

import { describe, expect, test } from 'claude-code/testing'
import type { On, ToolCallResult } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import {
  BASE,
  DIFF_AFTER,
  fakeGit,
  fileTools,
  gitArgs,
  PANE,
  panes,
  PLUGIN,
  repo,
  runReplay,
  session,
  start,
  threeChanges,
  turn,
  type Repo,
} from './fixtures'

const PANE_PROPS = {
  title: 'Play-by-Play',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}
const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}
const QUIET: ToolCallResult = { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
const SURFACES = ['terminal', 'desktop'] as const

/** The git subcommands the mod may run, and nothing else (no `diff <commit>`). */
const READ_ONLY = new Set(['rev-parse', 'diff-index', 'ls-files', 'hash-object', 'show', 'cat-file'])

function bash(on: On, git: Repo, change: () => void, answer: ToolCallResult = QUIET) {
  on('tool.call', { tool: 'Bash' }, () => {
    change()
    return answer
  })
  return git
}

describe('git stays read-only', () => {
  test('every git call is read-only plumbing without optional locks', async ($, on) => {
    const git = repo({ untracked: { 'notes.txt': 'cccc3333' } })
    const { opened } = session(on)
    panes(on, false, opened)
    fakeGit(on, git)
    fileTools(on, git, [])
    git.noIndex = { 'notes.txt': 'diff --git a/notes.txt b/notes.txt\nnew file mode 100644\n--- /dev/null\n+++ b/notes.txt\n@@ -0,0 +1 @@\n+hi\n' }
    await start($)
    git.untracked = {}
    await turn($, 't1', async () => {
      await threeChanges($)
    })
    expect(git.calls.length).toBeGreaterThan(0)
    for (const argv of git.calls) {
      expect(argv[0]).toBe('git')
      expect(argv[1], argv.join(' ')).toBe('--no-optional-locks')
      const [command] = gitArgs(argv)
      const allowed = READ_ONLY.has(command ?? '') || (command === 'diff' && argv.includes('--no-index'))
      expect(allowed, argv.join(' ')).toBe(true)
      expect(argv.includes('-w'), argv.join(' ')).toBe(false)
    }
  })

  test('a command core held read-only takes no second snapshot: four git calls at most', async ($, on) => {
    const git = repo({ untracked: { 'a.txt': 'aaaa1111' } })
    const { opened } = session(on)
    panes(on, false, opened)
    fakeGit(on, git)
    bash(on, git, () => undefined, { ...QUIET, isReadOnly: true })
    await start($)
    await turn($, 't1', () => $.tool.call({ tool: 'Bash', command: 'ls' }))
    // rev-parse, diff-index, ls-files, hash-object; none after the command.
    expect(git.calls.map(argv => gitArgs(argv)[0])).toEqual(['rev-parse', 'diff-index', 'ls-files', 'hash-object'])
  })
})

describe('slow git pauses shell tracking for the session', () => {
  test('a snapshot over 2 s on the clock pauses it once, says so once; file tools still count', async ($, on) => {
    const git = repo({ slowMs: 2_500 })
    const world = session(on)
    panes(on, false, world.opened)
    fakeGit(on, git, world.clock)
    let runs = 0
    bash(on, git, () => {
      runs++
      git.diff = DIFF_AFTER
    })
    fileTools(on, git, [])
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const first = $.tool.call({ tool: 'Bash', command: 'make' })
    await world.clock.settle()
    await world.clock.advance(2_500)
    await first
    expect(world.logs).toEqual([
      'play-by-play: shell tracking paused for this session (git took 2.5 s here); file tools are still tracked.',
    ])
    git.slowMs = 0
    const calls = git.calls.length
    await $.tool.call({ tool: 'Bash', command: 'make again' })
    expect(runs).toBe(2) // both commands ran
    expect(git.calls.length).toBe(calls) // the second one unwatched
    await $.tool.call({
      tool: 'Edit',
      file_path: '/repo/src/app.ts',
      old_string: 'const b = 2',
      new_string: 'const b = 3\nconst c = 4',
    })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(world.logs).toHaveLength(1)
    expect(await runReplay($)).toContain('1. src/app.ts (edit) +2 −1')
  })

  test('git that does not answer in time pauses it too, and the command still runs', async ($, on) => {
    const git = repo({ timesOut: true })
    const world = session(on)
    panes(on, false, world.opened)
    fakeGit(on, git, world.clock)
    let runs = 0
    bash(on, git, () => runs++)
    await start($)
    let ran: { deny?: string } = {}
    await turn($, 't1', async () => {
      ran = await $.tool.call({ tool: 'Bash', command: 'make' })
    })
    expect(runs).toBe(1)
    expect(ran.deny).toBeUndefined()
    expect(world.logs).toEqual([
      'play-by-play: shell tracking paused for this session (git did not answer in time here); file tools are still tracked.',
    ])
  })

  test('a pending diff too large to read pauses it with its reason', async ($, on) => {
    const world = session(on)
    panes(on, false, world.opened)
    on('process.run', ($, e) => ({
      value: {
        exitCode: 0,
        stdout: e.argv.includes('rev-parse') ? `/repo\n\n${'1'.repeat(40)}\n` : 'diff --git a/x b/x\n',
        stderr: '',
        isStdoutTruncated: e.argv.includes('diff-index'),
        isStderrTruncated: false,
      },
    }))
    on('tool.call', { tool: 'Bash' }, () => QUIET)
    await start($)
    await turn($, 't1', () => $.tool.call({ tool: 'Bash', command: 'make' }))
    expect(world.logs).toEqual([
      'play-by-play: shell tracking paused for this session (the uncommitted changes are over 4 MiB); file tools are still tracked.',
    ])
  })

  test('a snapshot under 2 s keeps tracking on', async ($, on) => {
    const git = repo({ slowMs: 1_500 })
    const world = session(on)
    panes(on, false, world.opened)
    fakeGit(on, git, world.clock)
    bash(on, git, () => (git.diff = DIFF_AFTER))
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const call = $.tool.call({ tool: 'Bash', command: "sed -i '' s/one/ONE/ src/app.ts" })
    await world.clock.settle()
    await world.clock.advance(1_500)
    await world.clock.settle()
    await world.clock.advance(1_500)
    await call
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(world.logs).toEqual([])
    expect(await runReplay($)).toContain('src/app.ts (edit) +1 −1 via shell')
  })
})

/** Mounts the pane and band on both surfaces; checks they draw with their buttons. */
async function drawsWithButtons($: Engine, expectText: RegExp) {
  for (const surface of SURFACES) {
    await runReplay($)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect((await ui.findAll({ type: 'Button' })).map(button => button.key)).toContain('next')
    expect(await ui.find({ key: 'close' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: expectText })).toBeDefined()
    await ui.unmount()
  }
}

describe('binary files', () => {
  test('a committed binary that a command deletes draws a step, not a diff of its bytes', async ($, on) => {
    // Bytes that decode to C1 controls (U+0085, U+009B) and a NUL: what an image holds.
    const image = `\u0089PNG\r\n\u001a\n\u0000\u0000\u0085\u009b[31m${'x'.repeat(50)}\n`
    const git = repo({ diff: '', base: { 'logo.png': image } })
    const world = session(on)
    panes(on, true, world.opened)
    fakeGit(on, git)
    bash(on, git, () => {
      git.diff = 'diff --git a/logo.png b/logo.png\ndeleted file mode 100644\nindex 1111111..0000000\nBinary files a/logo.png and /dev/null differ\n'
    })
    await start($)
    await turn($, 't1', () => $.tool.call({ tool: 'Bash', command: 'rm logo.png' }))
    const bytes = new TextEncoder().encode(image).length
    await drawsWithButtons($, new RegExp(`binary file changed \\(${bytes} bytes\\)`))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
      expect(await ui.find({ type: 'Code' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('a staged git mv of a binary is one rename', async ($, on) => {
    const git = repo({ diff: '', base: { 'a.png': '\u0000bin' } })
    const world = session(on)
    panes(on, false, world.opened)
    fakeGit(on, git)
    bash(on, git, () => {
      git.diff = 'diff --git a/a.png b/img/a.png\nsimilarity index 100%\nrename from a.png\nrename to img/a.png\n'
    })
    await start($)
    await turn($, 't1', () => $.tool.call({ tool: 'Bash', command: 'git mv a.png img/a.png' }))
    expect(await runReplay($)).toContain('1. a.png -> img/a.png (rename) +0 −0 via shell')
  })

  test('a binary written by a file tool is no line diff', async ($, on) => {
    const world = session(on)
    panes(on, true, world.opened)
    on('tool.call', { tool: 'Write' }, () => ({
      result: { type: 'create', filePath: '/repo/blob.bin', content: '\u0000\u0085\u009b', structuredPatch: [], originalFile: null },
      text: 'created',
    }))
    await start($)
    await turn($, 't1', () => $.tool.call({ tool: 'Write', file_path: '/repo/blob.bin', content: '\u0000\u0085\u009b' }))
    await drawsWithButtons($, /binary file changed \(5 bytes\)/)
  })
})

describe('names with control characters', () => {
  const NAME = '/repo/src/we\u001b[31mird\u0085name.ts'
  test('a file named with ESC and U+0085 still draws the hint and the pane with buttons', async ($, on) => {
    const world = session(on)
    panes(on, true, world.opened)
    on('tool.call', { tool: 'Edit' }, () => ({
      result: { filePath: NAME, oldString: 'const b = 2', newString: 'const b = 9', originalFile: BASE, replaceAll: false },
      text: 'updated',
    }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'engine band' }))
    await start($)
    await turn($, 't1', () => $.tool.call({ tool: 'Edit', file_path: NAME, old_string: 'const b = 2', new_string: 'const b = 9' }))
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect(await band.find({ key: 'replay' })).toBeDefined()
      await band.unmount()
    }
    // The ANSI sequence is dropped and U+0085 shows as a replacement mark.
    await drawsWithButtons($, /^src\/weird�name\.ts$/)
    // The headless list is cleaned too.
    const headless = await $.command.run({
      command: 'replay',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
    expect(headless.text ?? '').not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/)
  })
})

test('a session opened in a subfolder shows shell paths relative to it', async ($, on) => {
  const git = repo({ prefix: 'src/', diff: '' })
  const { opened } = session(on)
  panes(on, false, opened)
  fakeGit(on, git)
  bash(on, git, () => {
    git.diff = DIFF_AFTER.slice(DIFF_AFTER.indexOf('diff --git a/src/app.ts'))
    git.base = { 'src/app.ts': 'const one = 1\nconst b = 3\nconst c = 4\nexport {}\n' }
  })
  await start($)
  git.base = { 'src/app.ts': 'const one = 1\nconst b = 3\nconst c = 4\nexport {}\n' }
  await turn($, 't1', () => $.tool.call({ tool: 'Bash', command: "sed -i '' s/one/ONE/ app.ts" }))
  // HEAD holds the edited text here; the command changes one line of it.
  expect(await runReplay($)).toContain('1. app.ts (edit)')
})

test('a plain mv of a committed binary is one rename, matched by git blob id', async ($, on) => {
  const id = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd'
  const git = repo({ diff: '', base: { 'photo.jpg': '\u0000jpeg bytes' }, blobs: { 'photo.jpg': id } })
  const world = session(on)
  panes(on, false, world.opened)
  fakeGit(on, git)
  bash(on, git, () => {
    git.diff = 'diff --git a/photo.jpg b/photo.jpg\ndeleted file mode 100644\nindex abcdefa..0000000\nBinary files a/photo.jpg and /dev/null differ\n'
    git.untracked = { 'assets/photo.jpg': id }
    git.noIndex = { 'assets/photo.jpg': 'diff --git a/assets/photo.jpg b/assets/photo.jpg\nnew file mode 100644\nindex 0000000..abcdefa\nBinary files /dev/null and b/assets/photo.jpg differ\n' }
  })
  await start($)
  await turn($, 't1', () => $.tool.call({ tool: 'Bash', command: 'mkdir assets && mv photo.jpg assets/' }))
  expect(await runReplay($)).toBe(
    ['the latest turn: 1 edit · 1 file · +0 −0', '1. photo.jpg -> assets/photo.jpg (rename) +0 −0 via shell'].join('\n'),
  )
})
