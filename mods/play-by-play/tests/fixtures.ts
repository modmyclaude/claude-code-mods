// Shared test setup: a fake repository answered beneath the plugin through
// `process.run`, and the file tools answered with the records core gives.

import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

export const PLUGIN = 'play-by-play'
export const PANE = 'play-by-play'

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
  /** Every git argv run, to check what ran. */
  calls: string[][]
  /** How long `ls-files` takes, in real milliseconds (a huge repository). */
  slowMs: number
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
    ...overrides,
  }
}

const ok = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

/** Answers `$.process.run` for git beneath the plugin, from `state`. */
export function fakeGit(on: On, state: Repo) {
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    state.calls.push(argv)
    if (argv[0] !== 'git') return ok('', 127)
    const args = argv[1] === '-c' ? argv.slice(3) : argv.slice(1)
    if (!state.isRepo) return ok('', 128)
    const [command] = args
    if (command === 'rev-parse') return args.includes('--show-toplevel') ? ok('/repo\n\n') : ok('abc123\n')
    if (command === 'diff' && args.includes('--no-index')) {
      const path = args[args.length - 1] ?? ''
      return ok(state.noIndex[path] ?? '', 1)
    }
    if (command === 'diff') return ok(state.diff)
    if (command === 'ls-files') {
      // The environment has no timers: hold the call by the real clock.
      const until = performance.now() + state.slowMs
      while (performance.now() < until) {
        // waiting
      }
    }
    if (command === 'ls-files') return ok(Object.keys(state.untracked).map(path => `${path}\0`).join(''))
    if (command === 'hash-object') {
      const paths = (e.init?.stdin ?? '').split('\n').filter(Boolean)
      return ok(paths.map(path => `${state.untracked[path] ?? ''}\n`).join(''))
    }
    if (command === 'show') {
      const path = (args[1] ?? '').replace(/^abc123:/, '')
      const text = state.base[path]
      return text === undefined ? ok('', 128) : ok(text)
    }
    return ok('', 1)
  })
}

/** The session around the plugin: its folder, /replay's registration, logs. */
export function session(on: On) {
  const logs: string[] = []
  const opened: string[] = []
  const closed: string[] = []
  // The engine's own answers to the events the plugin observes.
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.close', ($, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  return { logs, opened, closed }
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
