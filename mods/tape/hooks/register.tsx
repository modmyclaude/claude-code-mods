// tape: a ticker band above the prompt. Prices come from Hyperliquid's public
// info API with no key (perpetual-contract mids for stocks, indices, gold, FX
// and crypto), or, for stocks, from Alpaca's market data under the person's
// own keys. The last good prices live in $.state, so a failed fetch never
// blanks the band; a marquee or rotating pages show them.
//
// What leaves this machine: to api.hyperliquid.xyz, the request type and the
// dex name, nothing else; to data.alpaca.markets, only when both keys are
// set, the symbol list and the keys. Never a prompt, a file, a project name
// or anything of the session. The keys are never drawn, logged or stored
// anywhere but the engine's secret settings.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { TapeMeta, TapeQuotes, TapeView } from '../types'
import {
  ageOf, backoff, cellsOf, DEFAULT_SYMBOLS, FRAME_MS, isMotion, isQuiet, leadOf, pagesOf, parseAssetCtxs, parseMids, parseSnapshots,
  parseSymbols, ring, runsOfPage, windowOf,
} from './tape'
import type { Motion, Run } from './tape'

const HL_URL = 'https://api.hyperliquid.xyz/info'
const ALPACA_URL = 'https://data.alpaca.markets/v2/stocks/snapshots'
/** The previous day's prices are refreshed every this many successful fetches (about a minute at the default refresh). */
const CONTEXT_EVERY = 6
const MIN_REFRESH_S = 5
const MAX_REFRESH_S = 300

const quotes = atom({ plugin: 'tape', key: 'quotes' } as const, {} as TapeQuotes)
const meta = atom({ plugin: 'tape', key: 'meta' } as const, { lastOk: null, lastErr: null, intervalMs: 10_000 } as TapeMeta)
const view = atom({ plugin: 'tape', key: 'view' } as const, { on: true } as TapeView)

// The settings, as the manifest's fields hold them; config.set keeps them current.
let enabled = true
let symbolsSetting = DEFAULT_SYMBOLS
let refreshS = 10
let motionSetting: Motion = 'scroll'
let rotateS = 8
let alpacaKey = ''
let alpacaSecret = ''
/** The nonessential-traffic switch, read at session start: no request leaves while it is set. */
let quiet = false

// The loops. Module values, so a code reload drops them: session.start starts them again.
let fetchTimer: Timer | undefined
let frameTimer: Timer | undefined
let pageTimer: Timer | undefined
let okTicks = 0

function cancelLoops() {
  fetchTimer?.cancel()
  frameTimer?.cancel()
  pageTimer?.cancel()
  fetchTimer = frameTimer = pageTimer = undefined
}

function clampRefresh(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 10
  return Math.min(MAX_REFRESH_S, Math.max(MIN_REFRESH_S, Math.round(n)))
}

function clampRotate(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 8
  return Math.min(60, Math.max(2, Math.round(n)))
}

/** Starts the fetch loop and the motion for the current settings; nothing while off, hidden or quiet. */
async function startLoops($: EngineInterface) {
  cancelLoops()
  const v = await read($, view)
  if (!enabled || !v.on || quiet) return
  scheduleFetch($, 0)
  const motion = v.motion ?? motionSetting
  if (motion === 'scroll') {
    frameTimer = $.clock.every(FRAME_MS, () => void update($, view, x => ({ ...x, offset: (x.offset ?? 0) + 1 })))
  } else {
    pageTimer = $.clock.every(rotateS * 1000, () => void update($, view, x => ({ ...x, page: (x.page ?? 0) + 1 })))
  }
}

/** One fetch timer at a time: a new schedule replaces the old. */
function scheduleFetch($: EngineInterface, ms: number) {
  fetchTimer?.cancel()
  fetchTimer = $.clock.after(ms, () => {
    fetchTimer = undefined
    void tick($)
  })
}

/** One Hyperliquid info request: the type and the dex, nothing else. */
async function hyperliquid($: EngineInterface, body: { type: string; dex?: string }): Promise<string> {
  const r = await $.http.fetch(HL_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`hyperliquid answered ${r.status}`)
  return r.text
}

async function currentSymbols($: EngineInterface): Promise<string[]> {
  const v = await read($, view)
  return parseSymbols(v.symbols ?? symbolsSetting)
}

/** One round of fetches, then the next is scheduled: sooner after a success, later after each failure. */
async function tick($: EngineInterface) {
  if (!enabled || quiet) return
  const v = await read($, view)
  if (!v.on) return
  const list = parseSymbols(v.symbols ?? symbolsSetting)
  const now = await $.clock.now()
  const m = await read($, meta)
  try {
    const [xyzText, mainText] = await Promise.all([hyperliquid($, { type: 'allMids', dex: 'xyz' }), hyperliquid($, { type: 'allMids' })])
    const xyzMids = parseMids(xyzText)
    const mainMids = parseMids(mainText)
    const previous = await read($, quotes)
    // The previous day's prices, once a minute or so, for the change; a crypto symbol needs the main dex's too.
    let prevDays: Record<string, number> = {}
    if (okTicks % CONTEXT_EVERY === 0) {
      prevDays = parseAssetCtxs(await hyperliquid($, { type: 'metaAndAssetCtxs', dex: 'xyz' }))
      if (list.some(s => mainMids[s] !== undefined)) Object.assign(prevDays, parseAssetCtxs(await hyperliquid($, { type: 'metaAndAssetCtxs' })))
    }
    // Stocks from Alpaca when the person's keys are set and were not refused: one request for all of them.
    let alpaca: Record<string, { price: number; prevDay?: number }> = {}
    if (alpacaKey !== '' && alpacaSecret !== '' && m.alpacaRefused !== true) {
      const stocks = list.filter(s => mainMids[s] === undefined)
      if (stocks.length > 0) {
        const r = await $.http.fetch(`${ALPACA_URL}?symbols=${stocks.join(',')}&feed=iex`, {
          headers: { 'APCA-API-KEY-ID': alpacaKey, 'APCA-API-SECRET-KEY': alpacaSecret },
        })
        if (r.status === 401 || r.status === 403) {
          await update($, meta, x => ({ ...x, alpacaRefused: true }))
          $.ui.log('tape: alpaca refused the key; stocks stay on hyperliquid until the keys change')
        } else if (r.ok) {
          alpaca = parseSnapshots(r.text)
        }
      }
    }
    const next: TapeQuotes = {}
    const unknown: string[] = []
    for (const s of list) {
      const a = alpaca[s]
      const x = xyzMids[`xyz:${s}`]
      const c = mainMids[s]
      const kept = previous[s]?.prevDay
      if (a !== undefined) {
        next[s] = { price: a.price, ...(a.prevDay !== undefined ? { prevDay: a.prevDay } : {}), source: 'alpaca', at: now }
      } else if (x !== undefined) {
        const prevDay = prevDays[`xyz:${s}`] ?? (previous[s]?.source === 'hyperliquid' ? kept : undefined)
        next[s] = { price: x, ...(prevDay !== undefined ? { prevDay } : {}), source: 'hyperliquid', at: now }
      } else if (c !== undefined) {
        const prevDay = prevDays[s] ?? (previous[s]?.source === 'hyperliquid' ? kept : undefined)
        next[s] = { price: c, ...(prevDay !== undefined ? { prevDay } : {}), source: 'hyperliquid', at: now }
      } else {
        unknown.push(s)
      }
    }
    const logged = m.unknown ?? []
    for (const s of unknown) if (!logged.includes(s)) $.ui.log(`tape: ${s} is not on hyperliquid`)
    await update($, quotes, () => next)
    await update($, meta, x => ({ ...x, lastOk: now, intervalMs: refreshS * 1000, unknown: [...new Set([...logged, ...unknown])] }))
    okTicks += 1
    scheduleFetch($, refreshS * 1000)
  } catch {
    const wait = backoff(m.intervalMs)
    await update($, meta, x => ({ ...x, lastErr: now, intervalMs: wait }))
    scheduleFetch($, wait)
  }
}

function paintOf(tone: Run['tone']): { color?: 'success' | 'error'; dimColor?: boolean } {
  if (tone === 'up') return { color: 'success' }
  if (tone === 'down') return { color: 'error' }
  if (tone === 'name') return {}
  return { dimColor: true }
}

export const register: Register = (on, options) => {
  enabled = options.enabled !== false
  symbolsSetting = typeof options.symbols === 'string' && options.symbols.trim() !== '' ? options.symbols : DEFAULT_SYMBOLS
  refreshS = clampRefresh(options.refresh)
  motionSetting = isMotion(options.motion) ? options.motion : 'scroll'
  rotateS = clampRotate(options.rotateSeconds)
  alpacaKey = typeof options.alpacaKey === 'string' ? options.alpacaKey.trim() : ''
  alpacaSecret = typeof options.alpacaSecret === 'string' ? options.alpacaSecret.trim() : ''

  on('session.start', async ($, e, next) => {
    quiet = isQuiet(await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'))
    okTicks = 0
    await $.command.register({ name: 'tape', description: 'The ticker tape: /tape, /tape add SYM, /tape remove SYM, /tape on, /tape off, /tape scroll, /tape rotate' })
    await startLoops($)
    return next(e)
  })

  // The settings as they change in /config.
  on('config.set', { key: 'tape.enabled' }, async ($, e, next) => {
    const r = await next(e)
    enabled = e.value === true
    await startLoops($)
    $.ui.invalidate('ui.render')
    return r
  })
  on('config.set', { key: 'tape.symbols' }, async ($, e, next) => {
    const r = await next(e)
    symbolsSetting = typeof e.value === 'string' && e.value.trim() !== '' ? e.value : DEFAULT_SYMBOLS
    await update($, view, x => {
      const { symbols: _, ...rest } = x
      return rest
    })
    if (enabled && !quiet) scheduleFetch($, 0)
    $.ui.invalidate('ui.render')
    return r
  })
  on('config.set', { key: 'tape.refresh' }, async ($, e, next) => {
    const r = await next(e)
    refreshS = clampRefresh(e.value)
    return r
  })
  on('config.set', { key: 'tape.motion' }, async ($, e, next) => {
    const r = await next(e)
    motionSetting = isMotion(e.value) ? e.value : 'scroll'
    await update($, view, x => {
      const { motion: _, ...rest } = x
      return rest
    })
    await startLoops($)
    $.ui.invalidate('ui.render')
    return r
  })
  on('config.set', { key: 'tape.rotateSeconds' }, async ($, e, next) => {
    const r = await next(e)
    rotateS = clampRotate(e.value)
    await startLoops($)
    return r
  })
  for (const key of ['tape.alpacaKey', 'tape.alpacaSecret'] as const) {
    on('config.set', { key }, async ($, e, next) => {
      const r = await next(e)
      const value = typeof e.value === 'string' ? e.value.trim() : ''
      if (key === 'tape.alpacaKey') alpacaKey = value
      else alpacaSecret = value
      await update($, meta, x => ({ ...x, alpacaRefused: false }))
      if (enabled && !quiet) scheduleFetch($, 0)
      return r
    })
  }

  on('command.run', { command: 'tape' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().split(/\s+/)
    const v = await read($, view)
    const list = parseSymbols(v.symbols ?? symbolsSetting)
    const usage = 'tape: /tape, /tape add SYM, /tape remove SYM, /tape on, /tape off, /tape scroll, /tape rotate; the lasting list is in /config'
    switch (verb.toLowerCase()) {
      case '': {
        const q = await read($, quotes)
        const source = Object.values(q).some(x => x.source === 'alpaca') ? 'alpaca iex for stocks, hyperliquid perps for crypto' : 'hyperliquid perps'
        $.ui.log(`tape: ${list.length > 0 ? list.join(' ') : 'no symbols'} · ${source} · ${!enabled ? 'off in /config' : v.on ? (v.motion ?? motionSetting) : 'off this session'}`)
        break
      }
      case 'add': {
        const s = parseSymbols(arg)[0]
        if (s === undefined) {
          $.ui.log(usage)
          break
        }
        await update($, view, x => ({ ...x, symbols: parseSymbols([...list, s].join(',')).join(',') }))
        if (enabled && !quiet && v.on) scheduleFetch($, 0)
        break
      }
      case 'remove': {
        const s = parseSymbols(arg)[0]
        if (s === undefined) {
          $.ui.log(usage)
          break
        }
        await update($, view, x => ({ ...x, symbols: list.filter(k => k !== s).join(',') }))
        break
      }
      case 'on':
        await update($, view, x => ({ ...x, on: true }))
        await startLoops($)
        break
      case 'off':
        await update($, view, x => ({ ...x, on: false }))
        cancelLoops()
        break
      case 'scroll':
      case 'rotate':
        await update($, view, x => ({ ...x, motion: verb.toLowerCase() as Motion }))
        await startLoops($)
        break
      default:
        $.ui.log(usage)
    }
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const v = await read($, view)
    if (!enabled || !v.on) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const below = await next(e)
    const width = Math.max(1, e.props.bodyColumns)
    if (quiet) {
      return (
        <Box flexDirection="column">
          {below}
          <Box key="tape" minWidth={0}>
            <Text dimColor wrap="truncate-end">tape off: nonessential traffic disabled</Text>
          </Box>
        </Box>
      )
    }
    const q = await read($, quotes)
    const m = await read($, meta)
    const now = await $.clock.now()
    const cells = cellsOf(parseSymbols(v.symbols ?? symbolsSetting), q)
    const source = Object.values(q).some(x => x.source === 'alpaca') ? 'alpaca' : 'hyperliquid'
    const stale = m.lastErr !== null && (m.lastOk === null || m.lastErr > m.lastOk)
    const lead = leadOf(source, stale ? ageOf(now, m.lastOk) : undefined)
    const room = Math.max(0, width - [...lead].length - 2)
    const motion = v.motion ?? motionSetting
    let runs: Run[]
    if (motion === 'scroll') {
      runs = windowOf(ring(cells), v.offset ?? 0, room)
    } else {
      const pages = pagesOf(cells, room)
      runs = pages.length === 0 ? [{ text: 'no symbols', tone: 'dim' }] : runsOfPage(pages[((v.page ?? 0) % pages.length + pages.length) % pages.length]!)
    }
    return (
      <Box flexDirection="column">
        {below}
        <Box key="tape" flexDirection="row" width={width} minWidth={0}>
          <Box flexShrink={0}>
            <Text dimColor>{lead}  </Text>
          </Box>
          <Box flexDirection="row" flexShrink={1} minWidth={0}>
            {runs.map(run => (
              <Text {...paintOf(run.tone)} wrap="truncate-end">{run.text}</Text>
            ))}
          </Box>
        </Box>
      </Box>
    )
  })
}
