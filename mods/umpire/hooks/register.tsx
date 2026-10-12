// umpire: runs your tests after Claude edits code and makes the call. Off until
// /umpire on (or the setting). At the end of a turn in which Claude changed
// files with its own tools, it runs the one test command, in the project root,
// with a time limit, and shows passed and failed counts with the first failing
// names above the prompt; a toast only when the result flips. One run at a
// time: a turn that ends mid-run queues exactly one more. The run starts off
// the turn's clock, never inside a hook's wait. It changes no file and sends
// nothing: "tell Claude" fills your prompt box, redacted, for you to send.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { UmpireRun } from '../types'
import { redact } from './redact'
import { bandWords, clean, detect, namesWords, parseRun, projectKey, shellArgv, statusWords, tail, tellText } from './tests'
import type { Project } from './tests'

const isOnSet = atom({ plugin: 'umpire', key: 'isOn' } as const, null as boolean | null)
const isRunningNow = atom({ plugin: 'umpire', key: 'isRunning' } as const, false)
const runs = atom({ plugin: 'umpire', key: 'runs' } as const, [] as UmpireRun[])

const PANE = 'umpire'
/** Origins that are the person: typed, the phone bridge, the desktop app's box. */
const PERSON = new Set(['composer', 'bridge', 'sdk'])
export const KEEP_RUNS = 10
export const KEEP_CHARS = 1_000_000
const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
/** Runners told they are not in a terminal: no watch mode, no colour. */
const RUN_ENV = { CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' }

type Settings = { enabled: boolean; command: string; maxSeconds: number }

export function readSettings(options: Record<string, unknown>): Settings {
  const s = typeof options.maxSeconds === 'number' && Number.isFinite(options.maxSeconds) ? Math.min(600, Math.max(5, Math.round(options.maxSeconds))) : 120
  const command = typeof options.command === 'string' ? options.command.trim().slice(0, 500) : ''
  return { enabled: options.enabled === true, command, maxSeconds: s }
}

// What lives only as long as this copy of the module: the settings, whether this turn changed a
// file, the run in flight and the one queued behind it, the detected command, the runs' output.
let settings: Settings = readSettings({})
let isTurnChanged = false
let isRunning = false
let isQueued = false
let detected: { root: string; argv: string[] | null } | null = null
const outputs = new Map<number, string>()
let isNoCommandSaid = false

function debug($: EngineInterface, text: string): void {
  $.ui.log(`umpire: ${text}`, { to: 'debug' })
}

async function isOn($: EngineInterface): Promise<boolean> {
  return (await read($, isOnSet)) ?? settings.enabled
}

/** Keeps one run's output, dropping the oldest past ten runs or a million characters. */
export function keepOutput(store: Map<number, string>, at: number, output: string): void {
  store.set(at, output)
  let chars = 0
  for (const text of store.values()) chars += text.length
  while (store.size > KEEP_RUNS || chars > KEEP_CHARS) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    chars -= store.get(oldest)?.length ?? 0
    store.delete(oldest)
  }
}

/** What the project folder says about its tests. */
async function projectAt($: EngineInterface, root: string): Promise<Project> {
  const at = (name: string) => `${root.replace(/\/+$/, '')}/${name}`
  const text = (name: string) => $.fs.read(at(name)).catch(() => undefined)
  const exists = (name: string) => $.fs.exists(at(name)).catch(() => false)
  const lockfiles: string[] = []
  for (const name of ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'package-lock.json']) if (await exists(name)) lockfiles.push(name)
  const [packageJson, pyproject] = await Promise.all([text('package.json'), text('pyproject.toml')])
  return {
    ...(packageJson === undefined ? {} : { packageJson }),
    ...(pyproject === undefined ? {} : { pyproject }),
    lockfiles,
    pytestIni: await exists('pytest.ini'),
    hasTestsDir: await exists('tests'),
    goMod: await exists('go.mod'),
    cargoToml: await exists('Cargo.toml'),
  }
}

/** The command to run: the setting, else the one set for this project, else found once from its files. */
async function commandFor($: EngineInterface, root: string): Promise<string[] | null> {
  if (settings.command !== '') return shellArgv(settings.command)
  const stored = await $.store.get(`command:${projectKey(root)}`).catch(() => undefined)
  if (typeof stored === 'string' && stored.trim() !== '') return shellArgv(stored)
  if (detected === null || detected.root !== root) detected = { root, argv: detect(await projectAt($, root)) }
  return detected.argv
}

/** One run of the tests, start to call; a run asked for while one goes is queued, once. */
async function runTests($: EngineInterface): Promise<void> {
  if (isRunning) {
    isQueued = true
    return
  }
  isRunning = true
  try {
    const root = await $.session.root()
    const argv = await commandFor($, root)
    if (argv === null) {
      if (!isNoCommandSaid) $.ui.toast('umpire: no test command found here. /umpire command <cmd> sets one for this project.')
      isNoCommandSaid = true
      return
    }
    await update($, isRunningNow, () => true)
    const started = await $.clock.now()
    let output = ''
    let run: UmpireRun
    try {
      const done = await $.process.run(argv, { cwd: root, env: RUN_ENV, timeoutMs: settings.maxSeconds * 1000 })
      output = `${done.stdout}${done.stderr ? `\n${done.stderr}` : ''}`
      const o = parseRun(output, done.exitCode)
      run = { at: await $.clock.now(), ms: (await $.clock.now()) - started, ...o }
    } catch (error) {
      const ms = (await $.clock.now()) - started
      const isTimeout = ms >= settings.maxSeconds * 1000 * 0.9
      // The engine names the call in the message (umpire: $.process.run: ...); the person needs the rest.
      output = (error instanceof Error ? error.message : String(error)).replace(/^(?:[\w-]+: )?\$\.process\.run: /, '')
      run = isTimeout
        ? { at: await $.clock.now(), ms, status: 'timed-out', names: [] }
        : { at: await $.clock.now(), ms, status: 'failed', names: [], error: clean(output).slice(0, 200) }
    }
    keepOutput(outputs, run.at, output)
    const before = (await read($, runs)).at(-1)
    await update($, runs, list => [...list, run].slice(-KEEP_RUNS))
    $.ui.status(statusWords(run))
    // A toast only when the call flips: passing to failing, or back.
    const wasPassing = before === undefined ? undefined : before.status === 'passed'
    const isPassing = run.status === 'passed'
    if (wasPassing !== undefined && wasPassing !== isPassing) {
      $.ui.toast(isPassing ? 'umpire: the tests pass again.' : `umpire: the tests started failing${run.names.length ? `: ${namesWords(run.names)}` : ''}.`)
    }
  } catch (error) {
    debug($, String(error))
  } finally {
    isRunning = false
    await update($, isRunningNow, () => false).catch(() => undefined)
    if (isQueued) {
      isQueued = false
      $.clock.after(0, () => void runTests($))
    }
  }
}

/** A command as the person reads it: what they typed, not the shell wrapped around it. */
function shown(argv: readonly string[]): string {
  return argv[0] === '/bin/sh' && argv[1] === '-c' ? (argv[2] ?? '') : argv.join(' ')
}

async function openPane($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.open({ id: PANE, title: 'umpire', focus: true, closeOnEscape: true })).isPlaced
  } catch {
    return false
  }
}

/** Fills the prompt box with the failing names and the output's end, redacted; never sends. */
async function tell($: EngineInterface): Promise<void> {
  const last = (await read($, runs)).at(-1)
  if (last === undefined || last.status === 'passed') return $.ui.toast('umpire: nothing failing to tell Claude about.')
  const text = redact(tellText(last, outputs.get(last.at) ?? ''))
  let draft = ''
  try {
    draft = (await $.prompt.read()).text
  } catch {
    draft = ''
  }
  try {
    const filled = await $.prompt.fill({ text: draft.trim() === '' ? text : `\n\n${text}`, mode: draft.trim() === '' ? 'replace' : 'append' })
    $.ui.toast(filled.isFilled ? 'umpire: the failures are in your prompt box. Send them when you want.' : 'umpire: the prompt box could not take the text.')
  } catch {
    $.ui.toast('umpire: the prompt box could not take the text.')
  }
}

async function command($: EngineInterface, args: string, origin: string): Promise<void> {
  const trimmed = args.trim()
  const verb = (trimmed.split(/\s+/)[0] ?? '').toLowerCase()
  const rest = trimmed.slice(verb.length).trim()
  if (verb === 'off') {
    await update($, isOnSet, () => false)
    $.ui.status(undefined)
    return $.ui.toast('umpire is off for this session.')
  }
  if (verb === '' || verb === 'show') {
    if (!(await openPane($))) {
      const last = (await read($, runs)).at(-1)
      $.ui.toast(last ? bandWords(last, last.ms, settings.maxSeconds) : 'umpire: no run yet.')
    }
    return
  }
  // Turning it on, running, setting the command and filling the prompt box are the person's to do.
  if (!PERSON.has(origin)) return $.ui.toast(`umpire: /umpire ${verb} runs only when you type it yourself.`)
  if (verb === 'on') {
    await update($, isOnSet, () => true)
    const argv = await commandFor($, await $.session.root())
    return $.ui.toast(argv ? `umpire is on: \`${clean(shown(argv)).slice(0, 80)}\` after each turn that changes files.` : 'umpire is on, but no test command was found. /umpire command <cmd> sets one.')
  }
  if (verb === 'run') {
    $.clock.after(0, () => void runTests($))
    return $.ui.toast('umpire: running the tests.')
  }
  if (verb === 'command') {
    const root = await $.session.root()
    if (rest === '') return $.ui.toast('umpire: /umpire command <the command, as you would type it>.')
    await $.store.set(`command:${projectKey(root)}`, rest.slice(0, 500))
    isNoCommandSaid = false
    return $.ui.toast(`umpire: this project's tests run with \`${clean(rest).slice(0, 80)}\`.`)
  }
  if (verb === 'tell') return tell($)
  $.ui.toast('umpire: /umpire on, off, run, show, command <cmd>, or tell.')
}

export const register: Register = (on, options) => {
  settings = readSettings(options)

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'umpire',
        description: 'Runs your tests after Claude edits code: on, off, run, show, command, tell',
        argumentHint: '[on | off | run | show | command <cmd> | tell]',
        immediate: true,
      })
    } catch (error) {
      debug($, String(error))
    }
    return next(e)
  })

  // Claude's own file tools, once they ran: this turn changed a file.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError && FILE_TOOLS.has(String(e.tool))) isTurnChanged = true
    return ran
  })

  on('turn.start', ($, e, next) => {
    isTurnChanged = false
    return next(e)
  })

  // A main turn that answered and changed files: one run, off the turn's clock.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.reason === 'answer' && !e.isAborted && isTurnChanged) {
      isTurnChanged = false
      if (await isOn($)) $.clock.after(0, () => void runTests($))
    }
    return done
  })

  // The call above the prompt, under other mods' lines; nothing while off or before a first run.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return below
    if (!(await isOn($))) return below
    const last = (await read($, runs)).at(-1)
    const going = await read($, isRunningNow)
    if (last === undefined && !going) return below
    const { Box, Text } = $.ui.resolve(e)
    const words = going ? 'umpire: running the tests...' : bandWords(last!, last!.ms, settings.maxSeconds)
    const color = going ? undefined : last!.status === 'passed' ? 'success' : 'error'
    return (
      <Box flexDirection="column">
        {below}
        <Text key="umpire" color={color} dimColor={going} wrap="truncate-end">
          {words}
        </Text>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // /umpire show: the last call, its failing names, the end of its output, and the history.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Code, Text } = $.ui.resolve(e)
    const list = await read($, runs)
    const last = list.at(-1)
    if (last === undefined) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text key="none" dimColor>
            No run yet. /umpire run runs the tests now.
          </Text>
        </Box>
      )
    }
    const output = outputs.get(last.at)
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text key="call" bold color={last.status === 'passed' ? 'success' : 'error'}>
          {bandWords(last, last.ms, settings.maxSeconds)}
        </Text>
        <Box key="history" flexDirection="row">
          <Text key="label" dimColor>
            {'history '}
          </Text>
          {list.map((r, i) => (
            <Box key={`h-${i}`} width={1}>
              <Text color={r.status === 'passed' ? 'success' : 'error'}>{r.status === 'passed' ? '✓' : r.status === 'timed-out' ? '?' : '✗'}</Text>
            </Box>
          ))}
        </Box>
        {last.error ? <Text key="error">{`Could not run: ${last.error}`}</Text> : null}
        {last.names.slice(0, 20).map((name, i) => (
          <Text key={`name-${i}`}>{`✗ ${clean(name)}`}</Text>
        ))}
        {output ? <Code key="output" source={tail(output, 60)} /> : <Text key="gone" dimColor>The output is no longer kept: only the last ten runs are.</Text>}
        <Box key="buttons" flexDirection="row" gap={2}>
          <Button key="again" label="run again" onPress={() => $.clock.after(0, () => void runTests($))} />
          {last.status === 'passed' ? null : <Button key="tell" label="tell Claude" onPress={() => void tell($)} />}
        </Box>
      </Box>
    )
  })

  on('command.run', { command: 'umpire' }, async ($, e) => {
    try {
      await command($, e.args, e.origin.kind)
    } catch (error) {
      debug($, String(error))
      $.ui.toast('umpire: that command failed, and nothing changed.')
    }
    return {}
  })
}
