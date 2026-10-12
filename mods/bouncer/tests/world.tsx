// The world beneath bouncer in a test: a home folder whose plugin registry
// names three plugin folders, a validator that answers each folder with the
// report the test chose, a store, and the band of another mod (or a safety
// hold) beneath bouncer's own. Every file read and every command run is kept.

import type { On, RenderSurface } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

export const PLUGIN = 'bouncer'
export const SURFACES = ['terminal', 'desktop'] as const
export const HOME = '/home/me'
export const MARKET = '/work/mods-market'
export const NETTY = `${HOME}/.claude/plugins/cache/shop/netty/1.0.0`
export const ZEN = `${MARKET}/mods/zen`
export const GATEKEEPER = `${MARKET}/mods/gatekeeper`

const ENGINE = { type: 'engine', ref: 0 } as const

/** A validator report as the binary prints it, from the notes and gating hooks a test gives. */
export function report(notes: string[], gates: string[] = [], success = true): string {
  return JSON.stringify({
    success,
    strict: false,
    target: 'x',
    manifest: { file: 'x', type: 'plugin', errors: [], warnings: [], notes: [], gatingHooks: [] },
    contents: [{ file: 'hooks.json', type: 'hooks', errors: [], warnings: [], notes, gatingHooks: gates.map(hook => ({ module: './register.tsx', pattern: hook, hook, hasCatch: true })) }],
  })
}

export const CLEAN = report(['./register.tsx hooks: session.start', './register.tsx calls: $.command.register, $.ui.toast'])
export const NETTY_REPORT = report([
  './register.tsx hooks: session.start, turn.complete',
  './register.tsx calls: $.clock.now (via tick), $.http.fetch (via push), $.process.run (via probe), $.ui.toast',
])
export const GATEKEEPER_REPORT = report(
  ['./register.tsx hooks: tool.call{tool=Bash}, command.run{command=gate}', './register.tsx calls: $.ui.open, $.ui.toast'],
  ['tool.call{tool=Bash}'],
)
export const ZEN_REPORT = report(['./register.tsx hooks: ui.render{component=Spinner}'])

export type World = {
  clock: MockClock
  files: Record<string, string>
  /** What the validator answers per folder: a report, or 'fail' for a non-zero exit, or 'junk' for text that is no report. */
  reports: Record<string, string>
  reads: string[]
  runs: string[][]
  toasts: string[]
  logs: string[]
  panes: string[]
  store: Map<string, unknown>
  isPanePlaced: boolean
  holdBeneath: boolean
  /** How many checks have finished (each ends by writing the seen record). */
  checks: number
}

export function world(on: On, options: { store?: Record<string, unknown>; isPanePlaced?: boolean; holdBeneath?: boolean; reports?: Record<string, string> } = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: Date.UTC(2026, 9, 12, 9, 12, 0) }),
    files: {
      [`${HOME}/.claude/plugins/installed_plugins.json`]: JSON.stringify({ version: 2, plugins: { 'netty@shop': [{ scope: 'user', installPath: NETTY, version: '1.0.0' }] } }),
      [`${HOME}/.claude/plugins/known_marketplaces.json`]: JSON.stringify({
        shop: { source: { source: 'github', repo: 'shop/mods' }, installLocation: `${HOME}/.claude/plugins/marketplaces/shop` },
        local: { source: { source: 'directory', path: MARKET }, installLocation: MARKET },
      }),
      [`${MARKET}/.claude-plugin/marketplace.json`]: JSON.stringify({ name: 'local', plugins: [{ name: 'zen', source: './mods/zen' }, { name: 'gatekeeper', source: './mods/gatekeeper' }, { name: 'bad', source: '../outside' }] }),
      [`${NETTY}/.claude-plugin/plugin.json`]: JSON.stringify({ name: 'netty', version: '1.0.0' }),
      [`${ZEN}/.claude-plugin/plugin.json`]: JSON.stringify({ name: 'zen', version: '0.3.0' }),
      [`${GATEKEEPER}/.claude-plugin/plugin.json`]: JSON.stringify({ name: 'gatekeeper', version: '2.0.0' }),
    },
    reports: { [NETTY]: NETTY_REPORT, [ZEN]: ZEN_REPORT, [GATEKEEPER]: GATEKEEPER_REPORT, ...(options.reports ?? {}) },
    reads: [],
    runs: [],
    toasts: [],
    logs: [],
    panes: [],
    store: new Map(Object.entries(options.store ?? {})),
    isPanePlaced: options.isPanePlaced ?? true,
    holdBeneath: options.holdBeneath ?? false,
    checks: 0,
  }
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.read', ($, e) => {
    w.reads.push(e.path)
    const text = w.files[e.path]
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('process.run', ($, e) => {
    w.runs.push([...e.argv])
    const root = e.argv[4] ?? ''
    const answer = w.reports[root] ?? CLEAN
    if (answer === 'fail') return { value: { exitCode: 1, stdout: '', stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false } }
    if (answer === 'junk') return { value: { exitCode: 0, stdout: 'not a report', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: answer, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('store.get', ($, e) => ({ value: w.store.get(e.key) }))
  on('store.set', ($, e) => {
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    if (e.key === 'seen') w.checks++
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    w.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('ui.toast', ($, e) => (w.toasts.push(e.text), { value: undefined }))
  on('ui.log', ($, e) => (w.logs.push(e.text), { value: undefined }))
  on('ui.open', ($, e) => {
    w.panes.push(e.id)
    return { value: w.isPanePlaced ? { isPlaced: true } : { isPlaced: false, reason: 'no room' } }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('plugin.register', () => ({ allow: true as const }))
  on('ui.render', ($, e) => {
    if (e.component !== 'AbovePrompt') return ENGINE
    const { Box, Text, Button } = $.ui.resolve(e)
    if (w.holdBeneath) {
      return (
        <Box key="hold" flexDirection="row" gap={1}>
          <Text key="hold-text" color="error">
            held: rm -rf build
          </Text>
          <Button key="hold-cancel" label="Cancel" onPress={() => undefined} />
          <Button key="hold-proceed" label="Proceed" onPress={() => undefined} />
        </Box>
      )
    }
    return <Text key="other-mod">another mod's line</Text>
  })
  return w
}

/** Lets the check running beneath finish: every stub answers at once, so microtask turns are all it needs. */
export async function settled(w: World, checks: number): Promise<void> {
  for (let i = 0; i < 200 && w.checks < checks; i++) {
    await w.clock.settle()
    for (let j = 0; j < 50; j++) await Promise.resolve()
  }
  if (w.checks < checks) throw new Error(`the check did not finish: ${w.checks} of ${checks}; logs: ${w.logs.join(' | ')}; reads ${w.reads.length}; runs ${w.runs.length}`)
}

export async function start($: Engine, w: World): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await settled(w, 1)
}

export async function run($: Engine, args: string) {
  return $.command.run({ command: 'bouncer', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
}

export const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }

export const PANE_PROPS = {
  title: 'Bouncer',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

/** The band as drawn: bouncer's own line, the other mod's line and a hold, each or undefined. */
export async function band($: Engine, surface: RenderSurface) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })
  const out = {
    line: (await ui.find({ key: 'bouncer-line' }))?.text,
    other: (await ui.find({ type: 'Text', text: "another mod's line" }))?.text,
    hold: (await ui.find({ key: 'hold' }))?.text,
  }
  await ui.unmount()
  return out
}

/** The pane as drawn: each row's text by mod name, every Text, and the whole; `press` presses one button first. */
export async function pane($: Engine, surface: RenderSurface, press?: string, columns = 100) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PLUGIN, props: { ...PANE_PROPS, bodyColumns: columns } })
  if (press !== undefined) await ui.press({ key: press })
  const rows: Record<string, string> = {}
  for (const box of await ui.findAll({ type: 'Box' })) if (typeof box.key === 'string' && box.key.startsWith('row-')) rows[box.key.slice(4)] = box.text
  const texts = (await ui.findAll({ type: 'Text' })).map(t => ({ text: t.text, color: t.props.color as string | undefined }))
  const whole = (await ui.find({ key: 'bouncer-pane' }))?.text ?? ''
  await ui.unmount()
  return { rows, texts, whole }
}
