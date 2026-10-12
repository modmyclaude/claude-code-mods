// umpire through the real chains: when it runs, what it runs and where, the
// call it makes, the toast on a flip, the panes, and the parsers alone.

import { describe, expect, test } from 'claude-code/testing'

import { KEEP_CHARS, KEEP_RUNS, keepOutput } from '../hooks/register'
import { bandWords, changedFile, detect, heldWords, holdFile, namesWords, parseRun, statusWords, tellText } from '../hooks/tests'
import type { Project } from '../hooks/tests'
import { JEST_FAIL, JEST_PASS, ROOT, SURFACES, band, pane, start, turn, umpire, world } from './world'

const ON = { options: { enabled: true } }

describe('when it runs', () => {
  test('off by default: an edit turn runs nothing until /umpire on', async ($, on) => {
    const w = world(on)
    await start($)
    await turn($, w)
    expect(w.runs).toEqual([])
    expect(await band($)).toBeUndefined()
    await umpire($, 'on')
    await turn($, w)
    expect(w.runs).toHaveLength(1)
  })

  test('once per turn that changed a file; never on a turn that only read or ran commands', ON, async ($, on) => {
    const w = world(on)
    await start($)
    await turn($, w, ['Read', 'Bash', 'Grep'])
    expect(w.runs).toEqual([])
    await turn($, w, ['Edit', 'Write', 'Edit'])
    await w.clock.advance(9_000)
    expect(w.runs).toHaveLength(1)
  })

  test('the one command, in the project root, with a time limit and no watch mode', { options: { enabled: true, maxSeconds: 45 } }, async ($, on) => {
    const w = world(on)
    await start($)
    await turn($, w)
    expect(w.runs[0]).toEqual({ argv: ['npm', 'test'], cwd: ROOT, env: { CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' }, timeoutMs: 45_000 })
  })

  test('a turn that ends during a run queues exactly one more', ON, async ($, on) => {
    const w = world(on)
    await start($)
    await turn($, w)
    await turn($, w)
    await turn($, w)
    expect(w.runs).toHaveLength(1)
    await w.clock.advance(8_300)
    await w.clock.advance(1)
    expect(w.runs).toHaveLength(2)
    await w.clock.advance(8_400)
    expect(w.runs).toHaveLength(2)
  })

  test('a run past the time limit is stopped and called timed out', { options: { enabled: true, maxSeconds: 30 } }, async ($, on) => {
    const w = world(on)
    w.results = ['hang']
    await start($)
    await turn($, w)
    expect((await band($))?.text).toBe('umpire: running the tests...')
    await w.clock.advance(30_000)
    expect(await band($)).toEqual({ text: 'umpire: tests timed out after 30 s', color: 'error' })
  })

  test('a command that cannot start is said in the pane, not called a timeout', ON, async ($, on) => {
    const w = world(on)
    w.results = ['missing']
    await start($)
    await turn($, w)
    const ui = await pane($)
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain('Could not run: spawn jest ENOENT')
  })

  test('no test command found: said once, nothing runs', ON, async ($, on) => {
    const w = world(on)
    w.files = { 'README.md': '# hi' }
    await start($)
    await turn($, w)
    await turn($, w)
    expect(w.runs).toEqual([])
    expect(w.toasts.filter(t => t.startsWith('umpire: no test command found'))).toHaveLength(1)
  })
})

describe('the hold', () => {
  const HELD = heldWords('package.json')

  test('a Claude edit to package.json holds the runs that start on their own, across turns, until the person runs them', ON, async ($, on) => {
    const w = world(on)
    await start($)
    await turn($, w, ['Edit'], `${ROOT}/package.json`)
    expect(w.runs).toEqual([])
    for (const surface of SURFACES) expect(await band($, surface)).toEqual({ text: HELD, color: 'warning' })
    const ui = await pane($)
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual([HELD, 'No run yet. /umpire run runs the tests now.'])
    await ui.unmount()
    await turn($, w)
    expect(w.runs).toEqual([])
    await umpire($, 'run')
    await w.clock.advance(1)
    expect(w.runs).toHaveLength(1)
    await w.clock.advance(8_300)
    expect((await band($))?.color).toBe('success')
    await turn($, w)
    expect(w.runs).toHaveLength(2)
  })

  test('a hold file changed by anything else (a shell command, the person) holds them too: its text at the root is checked', ON, async ($, on) => {
    const w = world(on)
    await start($)
    w.files['package.json'] = JSON.stringify({ scripts: { test: 'jest && echo more' } })
    await turn($, w)
    expect(w.runs).toEqual([])
    expect((await band($))?.text).toBe(HELD)
  })

  test('turning it on takes the files as they are, Claude\'s edits while it was off too; a change after that holds', async ($, on) => {
    const w = world(on)
    await start($)
    await turn($, w, ['Edit'], `${ROOT}/package.json`)
    await umpire($, 'on')
    await turn($, w)
    expect(w.runs).toHaveLength(1)
    await w.clock.advance(8_300)
    w.files['pytest.ini'] = '[pytest]'
    await turn($, w)
    expect(w.runs).toHaveLength(1)
    expect((await band($))?.text).toBe(heldWords('pytest.ini'))
  })

  test('a Claude edit to a package.json deeper in the project holds them, named by its path, cleaned, in the pane too; run again there runs', ON, async ($, on) => {
    const w = world(on)
    await start($)
    await turn($, w)
    await w.clock.advance(8_300)
    await turn($, w, ['Write'], `${ROOT}/packages/api/package.json`)
    expect(w.runs).toHaveLength(1)
    expect((await band($))?.text).toBe(heldWords('packages/api/package.json'))
    await turn($, w, ['Write'], `${ROOT}/x\x1b[31m/package.json`)
    const ui = await pane($)
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain(heldWords('x/package.json'))
    await ui.press({ key: 'again' })
    await w.clock.advance(1)
    expect(w.runs).toHaveLength(2)
  })

  test('a run queued before the hold does not run past it', ON, async ($, on) => {
    const w = world(on)
    await start($)
    await turn($, w)
    await turn($, w)
    await turn($, w, ['Edit'], `${ROOT}/Cargo.toml`)
    await w.clock.advance(8_300)
    await w.clock.advance(1)
    expect(w.runs).toHaveLength(1)
    expect((await band($))?.text).toBe(heldWords('Cargo.toml'))
  })

  test('the person\'s run finds the command again: a test script Claude just added runs then', ON, async ($, on) => {
    const w = world(on)
    w.files = { 'README.md': '# hi' }
    await start($)
    await turn($, w)
    w.files['package.json'] = JSON.stringify({ scripts: { test: 'vitest run' } })
    await turn($, w, ['Write'], `${ROOT}/package.json`)
    expect(w.runs).toEqual([])
    await umpire($, 'run')
    await w.clock.advance(1)
    expect(w.runs[0]!.argv).toEqual(['npm', 'test'])
    await w.clock.advance(8_300)
    await turn($, w)
    expect(w.runs).toHaveLength(2)
  })
})

describe('the call', () => {
  for (const surface of SURFACES) {
    test(`the band says the counts, the failing names and the time, in the error colour when failing, on ${surface}`, ON, async ($, on) => {
      const w = world(on)
      w.results = [{ stdout: JEST_PASS, exitCode: 0, ms: 8300 }, { stdout: JEST_FAIL, exitCode: 1, ms: 9000 }]
      await start($)
      await turn($, w)
      await w.clock.advance(8_300)
      expect(await band($, surface)).toEqual({ text: 'umpire: 144 passed · 0 failed · 8.3 s', color: 'success' })
      await turn($, w)
      await w.clock.advance(9_000)
      expect(await band($, surface)).toEqual({ text: 'umpire: 142 passed · 2 failed · auth.test.ts, user.test.ts · 9.0 s', color: 'error' })
      expect(w.status.at(-1)).toBe('tests 142/144')
    })
  }

  test('a toast only when the result flips: pass, pass, fail, fail, pass gives two', ON, async ($, on) => {
    const w = world(on)
    const pass = { stdout: JEST_PASS, exitCode: 0 }
    const fail = { stdout: JEST_FAIL, exitCode: 1 }
    w.results = [pass, pass, fail, fail, pass]
    await start($)
    for (let i = 0; i < 5; i++) await turn($, w)
    expect(w.toasts).toEqual(['umpire: the tests started failing: auth.test.ts, user.test.ts.', 'umpire: the tests pass again.'])
  })

  test('tell Claude fills the prompt box with the failures, redacted, after any draft; never sends', ON, async ($, on) => {
    const w = world(on)
    const key = ['sk', '_live_', 'Z9y8'.repeat(6)].join('')
    w.results = [{ stdout: `${JEST_FAIL}\nError: bad key ${key}`, exitCode: 1 }]
    await start($)
    await turn($, w)
    w.box = 'look at this'
    const ui = await pane($)
    await ui.press({ key: 'tell' })
    expect(w.box.startsWith('look at this\n\nThe tests are failing: src/auth.test.ts, src/user.test.ts. The last lines of the run:')).toBe(true)
    expect(w.box).not.toContain(key)
    expect(w.box).toContain('[REDACTED]')
    expect(w.submits).toEqual([])
  })

  test('the pane: the call, a history mark per run in a cell of its own, the failing names, the output', ON, async ($, on) => {
    const w = world(on)
    w.results = [{ stdout: JEST_PASS, exitCode: 0 }, { stdout: JEST_FAIL, exitCode: 1 }]
    await start($)
    await turn($, w)
    await turn($, w)
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      expect(texts.slice(0, 4)).toEqual(['umpire: 142 passed · 2 failed · auth.test.ts, user.test.ts · 0.0 s', 'history ', '✓', '✗'])
      expect(texts).toContain('✗ src/auth.test.ts')
      expect((await ui.find({ type: 'Code' }))?.props.source).toContain('Tests:       2 failed, 142 passed, 144 total')
      await ui.unmount()
    }
  })

  test('a run whose output passed 4 MB, on either stream, says so in the band and in what tell Claude fills', ON, async ($, on) => {
    const w = world(on)
    w.results = [{ stdout: 'FAIL src/a.test.ts\nmore', exitCode: 1, cut: 'stdout' }, { stdout: 'FAIL src/a.test.ts', exitCode: 1, cut: 'stderr' }]
    await start($)
    await turn($, w)
    expect((await band($))?.text).toBe('umpire: tests failed · 0.0 s · output cut at 4 MB')
    const ui = await pane($)
    await ui.press({ key: 'tell' })
    expect(w.box).toContain('The run printed more than 4 MB; the last lines kept:')
    await ui.unmount()
    await turn($, w)
    expect(w.runs).toHaveLength(2)
    expect((await band($))?.text).toBe('umpire: tests failed · 0.0 s · output cut at 4 MB')
  })

  test('on, run, command and tell run only for the person; another plugin is told so', async ($, on) => {
    const w = world(on)
    await start($)
    for (const verb of ['on', 'run', 'command make test', 'tell']) await umpire($, verb, { kind: 'plugin', name: 'other' })
    expect(w.toasts.every(t => t.includes('runs only when you type it yourself'))).toBe(true)
    expect(w.runs).toEqual([])
    expect(w.store.size).toBe(0)
  })

  test('/umpire command sets this project\'s command, run through the shell as typed', ON, async ($, on) => {
    const w = world(on)
    await start($)
    await umpire($, 'command make test-fast')
    await turn($, w)
    expect(w.runs[0]!.argv).toEqual(['/bin/sh', '-c', 'make test-fast'])
  })
})

describe('the parsers and the words', () => {
  const project = (p: Partial<Project>): Project => ({ lockfiles: [], pytestIni: false, hasTestsDir: false, goMod: false, cargoToml: false, ...p })

  test('the test command is found from the project, and npm\'s placeholder is none', () => {
    const pkg = JSON.stringify({ scripts: { test: 'vitest run' } })
    expect(detect(project({ packageJson: pkg }))).toEqual(['npm', 'test'])
    expect(detect(project({ packageJson: pkg, lockfiles: ['pnpm-lock.yaml'] }))).toEqual(['pnpm', 'test'])
    expect(detect(project({ packageJson: pkg, lockfiles: ['yarn.lock'] }))).toEqual(['yarn', 'test'])
    expect(detect(project({ packageJson: pkg, lockfiles: ['bun.lockb'] }))).toEqual(['bun', 'run', 'test'])
    expect(detect(project({ packageJson: JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) }))).toBeNull()
    expect(detect(project({ pytestIni: true }))).toEqual(['python3', '-m', 'pytest', '-q'])
    expect(detect(project({ pyproject: '[tool.pytest.ini_options]' }))).toEqual(['python3', '-m', 'pytest', '-q'])
    expect(detect(project({ goMod: true }))).toEqual(['go', 'test', './...'])
    expect(detect(project({ cargoToml: true }))).toEqual(['cargo', 'test'])
    expect(detect(project({}))).toBeNull()
  })

  test('jest, vitest, pytest, cargo and go outputs read into counts and names; anything else by exit code', () => {
    expect(parseRun(JEST_FAIL, 1)).toEqual({ status: 'failed', passed: 142, failed: 2, total: 144, names: ['src/auth.test.ts', 'src/user.test.ts'] })
    expect(parseRun(' FAIL  src/a.test.ts > sums > adds\n Tests  1 failed | 9 passed (10)\n', 1)).toEqual({ status: 'failed', passed: 9, failed: 1, total: 10, names: ['src/a.test.ts'] })
    expect(parseRun('FAILED tests/test_auth.py::test_login - AssertionError\n===== 1 failed, 41 passed in 2.31s =====\n', 1)).toEqual({ status: 'failed', passed: 41, failed: 1, total: 42, names: ['tests/test_auth.py::test_login'] })
    expect(parseRun('---- tests::login stdout ----\ntest result: FAILED. 7 passed; 1 failed; 0 ignored\ntest result: ok. 3 passed; 0 failed; 0 ignored\n', 101)).toEqual({ status: 'failed', passed: 10, failed: 1, total: 11, names: ['tests::login'] })
    expect(parseRun('--- FAIL: TestLogin (0.00s)\nFAIL\texample.com/auth\t0.01s\nok  \texample.com/api\t0.02s\n', 1)).toEqual({ status: 'failed', failed: 1, names: ['TestLogin'] })
    expect(parseRun('all good', 0)).toEqual({ status: 'passed', names: [] })
    expect(parseRun('boom', 2)).toEqual({ status: 'failed', names: [] })
  })

  test('the band\'s words: counts, names with +N more, the time; the status line', () => {
    expect(namesWords(['a/x.ts', 'b/y.ts', 'c/z.ts', 'd/w.ts', 'e/v.ts'])).toBe('x.ts, y.ts, z.ts +2 more')
    expect(bandWords({ status: 'passed', names: [] }, 12_400, 120)).toBe('umpire: tests passed · 12 s')
    expect(bandWords({ status: 'failed', names: ['TestLogin'], failed: 1 }, 900, 120)).toBe('umpire: 1 failed · TestLogin · 0.9 s')
    expect(statusWords({ status: 'failed', names: [] })).toBe('tests fail')
    expect(statusWords({ status: 'passed', passed: 10, total: 10, names: [] })).toBe('tests 10/10')
  })

  test('the hold files by name in any case, at any depth; the first whose text changed; the held line fits 80 columns', () => {
    expect(heldWords('package.json')).toBe('umpire: held, package.json changed · /umpire run to go on')
    expect(heldWords('pyproject.toml').length).toBeLessThanOrEqual(80)
    expect(holdFile('/w/app/package.json')).toBe('package.json')
    expect(holdFile('/w/app/packages/x/PACKAGE.JSON')).toBe('package.json')
    expect(holdFile('C:\\w\\cargo.toml')).toBe('Cargo.toml')
    expect(['pyproject.toml', 'pytest.ini', 'go.mod'].map(n => holdFile(`/w/${n}`))).toEqual(['pyproject.toml', 'pytest.ini', 'go.mod'])
    expect(holdFile('/w/app/package-lock.json')).toBeNull()
    expect(holdFile('/w/app/src/package.json.ts')).toBeNull()
    expect(changedFile({ 'package.json': 'a', 'go.mod': null }, { 'package.json': 'a', 'go.mod': null })).toBeNull()
    expect(changedFile({ 'package.json': 'a', 'go.mod': null }, { 'package.json': 'a', 'go.mod': 'module x' })).toBe('go.mod')
    expect(changedFile({ 'package.json': 'a' }, { 'package.json': 'b' })).toBe('package.json')
    expect(tellText({ status: 'failed', names: [] }, 'x')).toContain('The last lines of the run:')
  })

  test('output is kept for the last ten runs and a million characters at most', () => {
    const store = new Map<number, string>()
    for (let i = 0; i < 15; i++) keepOutput(store, i, 'x')
    expect([...store.keys()]).toEqual(Array.from({ length: KEEP_RUNS }, (_, i) => i + 5))
    for (let i = 20; i < 24; i++) keepOutput(store, i, 'y'.repeat(400_000))
    expect([...store.values()].reduce((n, t) => n + t.length, 0)).toBeLessThanOrEqual(KEEP_CHARS)
    expect(store.has(23)).toBe(true)
  })
})
