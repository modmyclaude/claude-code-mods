// Shared test setup: a fake repository answered beneath the plugin through
// `process.run`, and the file tools answered with the records core gives.

import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

export const PLUGIN = 'play-by-play'
export const PANE = 'play-by-play'
/** HEAD of the fake repository. */
export const HEAD_SHA = '1234567890abcdef1234567890abcdef12345678'

// src/app.ts at HEAD, after an Edit, and after a shell command on top.
export const BASE = 'const one = 1\nconst b = 2\nexport {}\n'
export const EDITED = 'const one = 1\nconst b = 3\nconst c = 4\nexport {}\n'

// `git diff HEAD` before the command: the Edit's change, and README's Write.
export const DIFF_BEFORE = `diff --git a/README.md b/README.md
index 3333333..4444444 100644
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
-old readme
+new readme
+more
diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const one = 1
-const b = 2
+const b = 3
+const c = 4
 export {}
`

// After `sed -i '' s/one/ONE/ src/app.ts`: one more line changed in that file;
// README's section is the same, so it is no shell change.
export const DIFF_AFTER = `diff --git a/README.md b/README.md
index 3333333..4444444 100644
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
-old readme
+new readme
+more
diff --git a/src/app.ts b/src/app.ts
index 1111111..5555555 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
-const one = 1
-const b = 2
+const ONE = 1
+const b = 3
+const c = 4
 export {}
`

/** A repository as git answers it; the test moves `diff` and `untracked` on. */
export type Repo = {
  isRepo: boolean
  diff: string
  /** Untracked paths and their hash-object answer. */
  untracked: Record<string, string>
  /** `git diff --no-index /dev/null <path>` answers, by path. */
  noIndex: Record<string, string>
  base: Record<string, string>
  /** Blob ids of base files, by path (cat-file --batch-check). */
  blobs: Record<string, string>
  /** Every git argv run, to check what ran. */
  calls: string[][]
  /** How long each diff-index takes on the mocked clock (a huge repository). */
  slowMs: number
  /** git fails to answer (a timeout): every call after the first rejects. */
  timesOut: boolean
  /** The session folder's place in the repository (`src/`), '' at its root. */
  prefix: string
}

export function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    isRepo: true,
    diff: DIFF_BEFORE,
    untracked: {},
    noIndex: {},
    base: { 'src/app.ts': BASE, 'README.md': 'old readme\n' },
    calls: [],
    slowMs: 0,
    timesOut: false,
    prefix: '',
    blobs: {},
    ...overrides,
  }
}

const ok = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

/** git's subcommand, past its global options (`--no-optional-locks`, `-c k=v`). */
export function gitArgs(argv: readonly string[]): string[] {
  const args = argv.slice(1)
  while (args[0] === '--no-optional-locks' || args[0] === '-c') args.splice(0, args[0] === '-c' ? 2 : 1)
  return args
}

/** Answers `$.process.run` for git beneath the plugin, from `state`. */
export function fakeGit(on: On, state: Repo, clock?: MockClock) {
  on('process.run', async ($, e) => {
    const argv = [...e.argv]
    state.calls.push(argv)
    if (argv[0] !== 'git') return ok('', 127)
    if (state.timesOut && state.calls.length > 1) return { deny: 'git timed out' }
    const args = gitArgs(argv)
    const [command] = args
    if (command === 'rev-parse') return state.isRepo ? ok(`/repo\n${state.prefix}\n${HEAD_SHA}\n`) : ok('', 128)
    if (!state.isRepo) return ok('', 128)
    if (command === 'diff' && args.includes('--no-index')) {
      const path = args[args.length - 1] ?? ''
      return ok(state.noIndex[path] ?? '', 1)
    }
    if (command === 'diff-index') {
      if (state.slowMs > 0 && clock !== undefined) await clock.sleep(state.slowMs)
      return ok(state.diff)
    }
    if (command === 'ls-files') return ok(Object.keys(state.untracked).map(path => `${path}\0`).join(''))
    if (command === 'hash-object') {
      const paths = (e.init?.stdin ?? '').split('\n').filter(Boolean)
      return ok(paths.map(path => `${state.untracked[path] ?? ''}\n`).join(''))
    }
    const spec = (args[args.length - 1] ?? '').replace(`${HEAD_SHA}:`, '')
    if (command === 'show') {
      const text = state.base[spec]
      return text === undefined ? ok('', 128) : ok(text)
    }
    if (command === 'cat-file') {
      const path = (e.init?.stdin ?? '').trim().replace(`${HEAD_SHA}:`, '')
      const text = state.base[path]
      if (text === undefined) return ok(`${path} missing\n`)
      return ok(`${state.blobs[path] ?? 'f'.repeat(40)} blob ${new TextEncoder().encode(text).length}\n`)
    }
    return ok('', 1)
  })
}

/** The session around the plugin: its folder, /replay's registration, logs. */
export function session(on: On) {
  const logs: string[] = []
  const opened: string[] = []
  const closed: string[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  // The engine's own answers to the events the plugin observes.
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  const debugLines: string[] = []
  on('ui.log', ($, e) => {
    ;(e.to === 'debug' ? debugLines : logs).push(e.text)
    return { value: undefined }
  })
  on('ui.close', ($, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  return { logs, debugLines, opened, closed, clock }
}

/** Panes open placed, or wait (a headless run lists the steps instead). */
export function panes(on: On, isPlaced: boolean, opened: string[]) {
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return isPlaced ? { value: { isPlaced: true } } : { value: { isPlaced: false, reason: 'no surface places panes' } }
  })
}

/** The three file tools answered with core's records for the scenario above. */
export function fileTools(on: On, repoState: Repo, ran: string[]) {
  on('tool.call', { tool: 'Edit' }, () => {
    ran.push('Edit')
    return {
      result: {
        filePath: '/repo/src/app.ts',
        oldString: 'const b = 2',
        newString: 'const b = 3\nconst c = 4',
        originalFile: BASE,
        structuredPatch: [],
        userModified: false,
        replaceAll: false,
      },
      text: 'The file /repo/src/app.ts has been updated.',
    }
  })
  on('tool.call', { tool: 'Write' }, () => {
    ran.push('Write')
    return {
      result: {
        type: 'update',
        filePath: '/repo/README.md',
        content: 'new readme\nmore\n',
        structuredPatch: [],
        originalFile: 'old readme\n',
      },
      text: 'The file /repo/README.md has been updated.',
    }
  })
  on('tool.call', { tool: 'Bash' }, () => {
    ran.push('Bash')
    repoState.diff = DIFF_AFTER // the command changes the tree
    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  })
}

export async function start($: Engine) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

export async function turn($: Engine, turnId: string, body: () => Promise<unknown>) {
  await $.turn.start({ text: `prompt for ${turnId}`, turnId })
  await body()
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId, reason: 'answer' })
}

/** Edit, then Write, then a Bash command that changes a file. */
export async function threeChanges($: Engine) {
  await $.tool.call({
    tool: 'Edit',
    file_path: '/repo/src/app.ts',
    old_string: 'const b = 2',
    new_string: 'const b = 3\nconst c = 4',
  })
  await $.tool.call({ tool: 'Write', file_path: '/repo/README.md', content: 'new readme\nmore\n' })
  await $.tool.call({ tool: 'Bash', command: "sed -i '' s/one/ONE/ src/app.ts" })
}

/** `/replay <args>` typed at the prompt; resolves the command's output line. */
export async function runReplay($: Engine, args = ''): Promise<string> {
  const ran = await $.command.run({
    command: 'replay',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  return ran.text ?? ''
}
