// The pure part of umpire: which test command a project uses, how a run's
// output reads into counts and failing names, and the words drawn.

/** What a project folder holds that says how its tests run. */
export type Project = {
  packageJson?: string
  lockfiles: string[]
  pytestIni: boolean
  pyproject?: string
  hasTestsDir: boolean
  goMod: boolean
  cargoToml: boolean
}

/** The test command, as argv, or null when nothing says how. */
export function detect(p: Project): string[] | null {
  if (p.packageJson !== undefined) {
    let script: unknown
    try {
      script = (JSON.parse(p.packageJson) as { scripts?: { test?: unknown } }).scripts?.test
    } catch {
      script = undefined
    }
    // npm's placeholder fails on purpose: it is no test command.
    if (typeof script === 'string' && script.trim() !== '' && !/no test specified/.test(script)) {
      if (p.lockfiles.includes('pnpm-lock.yaml')) return ['pnpm', 'test']
      if (p.lockfiles.includes('yarn.lock')) return ['yarn', 'test']
      if (p.lockfiles.includes('bun.lockb') || p.lockfiles.includes('bun.lock')) return ['bun', 'run', 'test']
      return ['npm', 'test']
    }
  }
  if (p.pytestIni || /\[tool\.pytest/.test(p.pyproject ?? '') || (p.pyproject !== undefined && p.hasTestsDir)) return ['python3', '-m', 'pytest', '-q']
  if (p.goMod) return ['go', 'test', './...']
  if (p.cargoToml) return ['cargo', 'test']
  return null
}

/** A command the person typed, run through the shell as they wrote it. */
export function shellArgv(command: string): string[] {
  return ['/bin/sh', '-c', command]
}

export type Outcome = {
  status: 'passed' | 'failed' | 'timed-out'
  passed?: number
  failed?: number
  total?: number
  /** Failing tests or files, as the runner names them, each once. */
  names: string[]
}

const unique = (names: string[]) => [...new Set(names.map(n => n.trim()).filter(Boolean))]

/** A run's output read into counts and failing names; the exit code decides when no runner's summary is found. */
export function parseRun(output: string, exitCode: number): Outcome {
  const text = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  const status = exitCode === 0 ? 'passed' : 'failed'
  // jest: "Tests:       2 failed, 142 passed, 144 total"
  const jest = /^Tests:\s+(.*\d+ total)\s*$/m.exec(text)
  if (jest) {
    const n = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(jest[1]!)?.[1] ?? 0)
    return { status, passed: n('passed'), failed: n('failed'), total: n('total'), names: unique([...text.matchAll(/^FAIL\s+(\S+)/gm)].map(m => m[1]!)) }
  }
  // vitest: " Tests  2 failed | 142 passed (144)"
  const vitest = /^\s*Tests\s+(.*)\((\d+)\)\s*$/m.exec(text)
  if (vitest) {
    const n = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(vitest[1]!)?.[1] ?? 0)
    return { status, passed: n('passed'), failed: n('failed'), total: Number(vitest[2]), names: unique([...text.matchAll(/^\s*FAIL\s+(\S+)/gm)].map(m => m[1]!)) }
  }
  // pytest: "==== 2 failed, 142 passed in 8.30s ====" (or "142 passed in 1.2s")
  const pytest = /^=+ (.*\d+ (?:passed|failed|error).*) in [\d.]+s(?: \([^)]*\))? =+$/m.exec(text)
  if (pytest) {
    const n = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(pytest[1]!)?.[1] ?? 0)
    const passed = n('passed')
    const failed = n('failed') + n('errors?')
    return { status, passed, failed, total: passed + failed, names: unique([...text.matchAll(/^(?:FAILED|ERROR) (\S+)/gm)].map(m => m[1]!)) }
  }
  // cargo: one "test result: FAILED. 142 passed; 2 failed; ..." per test binary
  const cargo = [...text.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed/gm)]
  if (cargo.length > 0) {
    const passed = cargo.reduce((s, m) => s + Number(m[1]), 0)
    const failed = cargo.reduce((s, m) => s + Number(m[2]), 0)
    return { status, passed, failed, total: passed + failed, names: unique([...text.matchAll(/^---- (\S+) stdout ----$/gm)].map(m => m[1]!)) }
  }
  // go test: failing tests by name; packages that passed say "ok". No per-test count without -v.
  const goFails = [...text.matchAll(/^\s*--- FAIL: (\S+)/gm)].map(m => m[1]!)
  if (goFails.length > 0 || /^ok\s+\S+/m.test(text)) {
    return { status, ...(goFails.length > 0 ? { failed: unique(goFails).length } : {}), names: unique(goFails) }
  }
  return { status, names: [] }
}

/** Controls and escapes out of output that is drawn or put in the prompt box; tabs as spaces. */
export function clean(text: string): string {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\r(?!\n)/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '�')
}

/** The last `n` lines of output, cleaned. */
export function tail(output: string, n: number): string {
  return clean(output).replace(/\n+$/, '').split('\n').slice(-n).join('\n')
}

function seconds(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`
}

/** The first three failing names, then "+N more"; a path keeps only its last part. */
export function namesWords(names: readonly string[]): string {
  const short = names.map(n => (n.includes('::') ? n : n.split('/').pop() ?? n))
  return short.length <= 3 ? short.join(', ') : `${short.slice(0, 3).join(', ')} +${short.length - 3} more`
}

/** The band's line for an outcome; `isCut` when the engine stopped keeping the output at 4 MB. */
export function bandWords(o: Outcome & { isCut?: boolean }, ms: number, maxSeconds: number): string {
  if (o.status === 'timed-out') return `umpire: tests timed out after ${maxSeconds} s`
  const parts = ['umpire:']
  const counts: string[] = []
  if (o.passed !== undefined) counts.push(`${o.passed} passed`)
  if (o.failed !== undefined && (o.failed > 0 || o.passed !== undefined)) counts.push(`${o.failed} failed`)
  if (counts.length === 0) counts.push(o.status === 'passed' ? 'tests passed' : 'tests failed')
  parts.push(counts.join(' · '))
  const line = [parts.join(' '), ...(o.names.length > 0 && o.status === 'failed' ? [namesWords(o.names)] : []), seconds(ms), ...(o.isCut ? ['output cut at 4 MB'] : [])]
  return line.join(' · ')
}

/** The status line's short form: "tests 142/144", or "tests pass" / "tests fail". */
export function statusWords(o: Outcome): string {
  if (o.status === 'timed-out') return 'tests timed out'
  if (o.passed !== undefined && o.total !== undefined && o.total > 0) return `tests ${o.passed}/${o.total}`
  return o.status === 'passed' ? 'tests pass' : 'tests fail'
}

/** What "tell Claude" puts in the prompt box: the failing names and the output's last lines. */
export function tellText(o: Outcome & { isCut?: boolean }, output: string): string {
  const names = o.names.length > 0 ? `The tests are failing: ${o.names.slice(0, 20).join(', ')}.` : 'The tests are failing.'
  const which = o.isCut ? 'The run printed more than 4 MB; the last lines kept:' : 'The last lines of the run:'
  return `${names} ${which}\n\n\`\`\`\n${tail(output, 30)}\n\`\`\``
}

/** Files that say what a test command runs. A change to one holds the runs that start on their own. */
export const HOLD_FILES = ['package.json', 'pyproject.toml', 'pytest.ini', 'go.mod', 'Cargo.toml'] as const

/** The hold file a path names, in its usual spelling, or null; any case, since macOS's disks ignore it. */
export function holdFile(path: string): string | null {
  const name = (path.split(/[\\/]/).pop() ?? '').toLowerCase()
  return HOLD_FILES.find(f => f.toLowerCase() === name) ?? null
}

/** The first hold file whose text is not what it was at the last run the person started; null when none. */
export function changedFile(before: Readonly<Record<string, string | null>>, now: Readonly<Record<string, string | null>>): string | null {
  return HOLD_FILES.find(f => before[f] !== now[f]) ?? null
}

/** The band's line while the runs that start on their own wait for the person. */
export function heldWords(name: string): string {
  return `umpire: held, ${name} changed · /umpire run to go on`
}

/** FNV-1a over the project root: a key for its stored command that does not spell the path. */
export function projectKey(root: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < root.length; i++) {
    h ^= root.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
