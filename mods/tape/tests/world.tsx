// The world beneath tape in a test: a clock, the environment, a network that
// answers from fixtures or fails on cue, and recorders for every request, log
// line and command the mod makes.

import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf, RenderViewport } from 'claude-code'

export const PLUGIN = 'tape'
export const T0 = 1_700_000_000_000
export const VIEWPORT: RenderViewport = { columns: 120, rows: 40, isFullscreen: true }

export const XYZ_MIDS = JSON.stringify({ 'xyz:AAPL': '346.16', 'xyz:NVDA': '225.55', 'xyz:TSLA': '374.08', 'xyz:AMZN': '231.4', 'xyz:SP500': '7798.0', 'xyz:GOLD': '4180.5', 'xyz:EUR': '1.08' })
export const MAIN_MIDS = JSON.stringify({ BTC: '83508.0', ETH: '2514.0', SOL: '180.5' })
export const XYZ_CTX = JSON.stringify([
  { universe: [{ name: 'xyz:AAPL' }, { name: 'xyz:NVDA' }, { name: 'xyz:TSLA' }, { name: 'xyz:AMZN' }, { name: 'xyz:SP500' }, { name: 'xyz:GOLD' }] },
  [
    { midPx: '346.16', prevDayPx: '345.1' },
    { midPx: '225.55', prevDayPx: '228.3' },
    { midPx: '374.08', prevDayPx: '371.1' },
    { midPx: '231.4', prevDayPx: '231.4' },
    { midPx: '7798.0', prevDayPx: '7806.0' },
    { midPx: '4180.5' },
  ],
])
export const MAIN_CTX = JSON.stringify([{ universe: [{ name: 'BTC' }, { name: 'ETH' }] }, [{ midPx: '83508.0', prevDayPx: '81800.0' }, { midPx: '2514.0', prevDayPx: '2479.0' }]])
export const SNAPSHOTS = JSON.stringify({
  AAPL: { latestTrade: { p: 347.5 }, prevDailyBar: { c: 340.0 } },
  NVDA: { latestTrade: { p: 226.0 }, prevDailyBar: { c: 230.0 } },
})

export type Request = { url: string; method: string; headers: Record<string, string>; body: string | undefined }

export type Mode = 'ok' | 'fail' | '429' | 'alpaca-401'

export function world(on: On, setup: { env?: Record<string, string>; mode?: Mode } = {}) {
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, setup.env ?? {})
  const rec = {
    requests: [] as Request[],
    logs: [] as string[],
    commands: [] as string[],
    mode: setup.mode ?? ('ok' as Mode),
  }
  on('http.fetch', (_$, e) => {
    const method = e.init?.method ?? 'GET'
    rec.requests.push({ url: e.url, method, headers: e.init?.headers ?? {}, body: e.init?.body })
    if (rec.mode === 'fail') return { deny: 'offline' }
    if (rec.mode === '429') return { value: { status: 429, ok: false, headers: {}, text: '' } }
    if (e.url.startsWith('https://data.alpaca.markets/')) {
      if (rec.mode === 'alpaca-401') return { value: { status: 401, ok: false, headers: {}, text: '{"message":"unauthorized"}' } }
      return { value: { status: 200, ok: true, headers: {}, text: SNAPSHOTS } }
    }
    const body = JSON.parse(e.init?.body ?? '{}') as { type?: string; dex?: string }
    const text =
      body.type === 'allMids' ? (body.dex === 'xyz' ? XYZ_MIDS : MAIN_MIDS)
      : body.type === 'metaAndAssetCtxs' ? (body.dex === 'xyz' ? XYZ_CTX : MAIN_CTX)
      : '{}'
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
  on('ui.log', (_$, e) => {
    rec.logs.push(e.text)
    return { value: undefined }
  })
  on('command.register', (_$, e) => {
    rec.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('config.set', (_$, e) => ({ value: e.value }))
  // What the engine draws in the band when no plugin draws: one marker Text.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  return {
    clock,
    rec,
    /** Lets the fetch round that a timer started finish. */
    async settle() {
      for (let i = 0; i < 40; i += 1) await Promise.resolve()
    },
    /** Starts the session and lets the first fetch, scheduled on a zero-delay timer, fire and settle. */
    async start($: Engine) {
      await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
      await clock.advance(1)
      await this.settle()
    },
  }
}

/** A /config row changing, as the menu would send it. */
export function setConfig($: Engine, key: string, value: unknown, previous: unknown) {
  return $.config.set({ key, value, previous, provider: { plugin: 'engine', tier: 'core' } } as never)
}

export function bandProps(over: Partial<RenderPropsOf['AbovePrompt']> = {}): RenderPropsOf['AbovePrompt'] {
  return { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {}, ...over }
}

export function mountBand($: Engine, surface: 'terminal' | 'desktop', over: Partial<RenderPropsOf['AbovePrompt']> = {}) {
  return $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(over), viewport: VIEWPORT })
}

export type Drawn = { type?: unknown; key?: unknown; props?: Record<string, unknown>; children?: unknown[] }

export function walk(node: unknown, pred: (n: Drawn) => boolean, out: Drawn[] = []): Drawn[] {
  if (node === null || typeof node !== 'object') return out
  const n = node as Drawn
  if (pred(n)) out.push(n)
  for (const c of n.children ?? []) walk(c, pred, out)
  return out
}

export function textOf(n: Drawn | undefined): string {
  if (n === undefined) return ''
  let s = ''
  for (const c of n.children ?? []) s += typeof c === 'string' ? c : textOf(c as Drawn)
  return s
}

export const keyOf = (n: Drawn) => (typeof n.key === 'string' ? n.key : typeof n.props?.key === 'string' ? n.props.key : undefined)

/** The tape row's words, the lead cell and the moving part together. */
export async function rowOf(band: { drawn: () => Promise<unknown> }): Promise<string> {
  const tape = walk(await band.drawn(), n => keyOf(n) === 'tape')[0]
  return textOf(tape)
}

/** The moving part of the row alone, after the lead cell and its two spaces. */
export async function movingOf(band: { drawn: () => Promise<unknown> }): Promise<string> {
  const tape = walk(await band.drawn(), n => keyOf(n) === 'tape')[0]
  if (tape === undefined) return ''
  const parts = (tape.children ?? []) as Drawn[]
  return textOf(parts[1])
}
