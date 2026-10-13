// The band through the mod's real wiring: the fetch loop against a fixture
// network, the marquee and the pages, the quiet switch, the Alpaca path, the
// desktop tree and a reload. The letters are the brief's test names.

import { describe, expect, test } from 'claude-code/testing'

import { keyOf, mountBand, movingOf, rowOf, setConfig, SNAPSHOTS, textOf, walk, world } from './world'
import type { Drawn } from './world'

const KEY = 'PKTESTKEYID1234'
const SECRET = 'SECRETTESTVALUE9876'

describe('A and B: the row', () => {
  test('after one fetch the band holds every symbol in order with its price and its change, up green, down red, unchanged dim; a missing earlier price draws --', async ($, on) => {
    const w = world(on)
    await w.start($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await mountBand($, surface, { bodyColumns: 200 })
      const row = await rowOf(band)
      expect(row.startsWith('tape · hyperliquid perps │ '), surface).toBe(true)
      expect(row).toContain('AAPL 346.16 +0.3%')
      expect(row).toContain('NVDA 225.55 -1.2%')
      expect(row).toContain('AMZN 231.40 0.0%')
      expect(row).toContain('SP500 7,798 -0.1%')
      expect(row).toContain('GOLD 4,181 --') // no earlier price from the source; 4180.5 rounds up
      expect(row).toContain('BTC 83,508 +2.1%')
      expect(row).toContain('ETH 2,514 +1.4%')
      expect(row).not.toContain('NaN')
      expect(row.indexOf('AAPL')).toBeLessThan(row.indexOf('NVDA'))
      expect(row.indexOf('GOLD')).toBeLessThan(row.indexOf('BTC'))
      const texts = walk(await band.drawn(), n => n.type === 'Text') as Drawn[]
      const toneOf = (s: string) => texts.find(t => textOf(t).trim() === s)?.props
      expect(toneOf('+0.3%')?.color).toBe('success')
      expect(toneOf('-1.2%')?.color).toBe('error')
      expect(toneOf('0.0%')?.dimColor).toBe(true)
      expect(toneOf('--')?.dimColor).toBe(true)
      expect(textOf(await band.drawn())).toContain('beneath') // other bands keep drawing
      await band.unmount()
    }
  })
})

describe('C: an unknown symbol', () => {
  test('draws as a question mark, logs once, and leaves the others alone', async ($, on) => {
    const w = world(on)
    await w.start($)
    await $.command.run({ command: 'tape', args: 'add zzzz', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    await w.clock.advance(1) // the fetch the command asked for
    await w.settle()
    const band = await mountBand($, 'terminal', { bodyColumns: 200 })
    const row = await rowOf(band)
    expect(row).toContain('ZZZZ ?')
    expect(row).toContain('AAPL 346.16')
    expect(w.rec.logs.filter(l => l.includes('ZZZZ'))).toEqual(['tape: ZZZZ is not on hyperliquid'])
    await w.clock.advance(10_000)
    await w.settle()
    expect(w.rec.logs.filter(l => l.includes('ZZZZ')).length).toBe(1)
    await band.unmount()
  })
})

describe('D and E: failures', () => {
  test('a failed fetch keeps the last prices and shows their age in the lead cell; the next success clears it', async ($, on) => {
    const w = world(on)
    await w.start($)
    const band = await mountBand($, 'terminal', { bodyColumns: 200 })
    expect(await rowOf(band)).toContain('AAPL 346.16')
    w.rec.mode = 'fail'
    await w.clock.advance(10_000)
    await w.settle()
    const row = await rowOf(band)
    expect(row).toContain('AAPL 346.16') // nothing blank
    expect(row).toContain('tape · hyperliquid perps · 10s old')
    w.rec.mode = 'ok'
    await w.clock.advance(20_000) // the wait doubled after the failure
    await w.settle()
    expect(await rowOf(band)).toContain('tape · hyperliquid perps │ ') // the age is gone
    expect(await rowOf(band)).not.toContain('old')
    await band.unmount()
  })
  test('a 429 doubles the wait each time up to five minutes, resets on success, and only one fetch timer ever runs', async ($, on) => {
    const w = world(on)
    await w.start($)
    const rounds = () => w.rec.requests.filter(r => r.body?.includes('allMids') && r.body.includes('xyz')).length
    expect(rounds()).toBe(1)
    w.rec.mode = '429'
    await w.clock.advance(10_000)
    await w.settle()
    expect(rounds()).toBe(2) // the fetch at 10 s failed
    await w.clock.advance(10_000)
    await w.settle()
    expect(rounds()).toBe(2) // not yet: the wait is 20 s now
    await w.clock.advance(10_000)
    await w.settle()
    expect(rounds()).toBe(3)
    await w.clock.advance(40_000)
    await w.settle()
    expect(rounds()).toBe(4) // 40 s
    for (let i = 0; i < 6; i += 1) {
      await w.clock.advance(300_000)
      await w.settle()
    }
    const before = rounds()
    await w.clock.advance(300_000)
    await w.settle()
    expect(rounds()).toBe(before + 1) // capped at five minutes: one fetch per five minutes, never a stacked second timer
    w.rec.mode = 'ok'
    await w.clock.advance(300_000)
    await w.settle()
    const after = rounds()
    await w.clock.advance(10_000)
    await w.settle()
    expect(rounds()).toBe(after + 1) // back to the refresh
  })
})

describe('F and G: motion', () => {
  test('the marquee shifts one cell per frame, four frames a second by default, wraps, and fills exactly the room beside the lead cell at any width', async ($, on) => {
    const w = world(on)
    await w.start($)
    await $.command.run({ command: 'tape', args: 'scroll', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    for (const columns of [60, 100, 157]) {
      const band = await mountBand($, 'terminal', { bodyColumns: columns })
      const lead = 'tape · hyperliquid perps │ '
      expect((await rowOf(band)).startsWith(lead), `${columns}`).toBe(true)
      const a = await movingOf(band)
      expect([...a].length, `${columns}`).toBe(columns - [...lead].length)
      await w.clock.advance(249)
      expect(await movingOf(band)).toBe(a) // not yet: a frame is 250 ms at four cells a second
      await w.clock.advance(1)
      const b = await movingOf(band)
      expect(b).toBe((await movingOf(band)))
      expect(b.slice(0, -1)).toBe(a.slice(1)) // one cell to the left
      await w.clock.advance(250)
      expect((await movingOf(band)).slice(0, -2)).toBe(a.slice(2))
      expect((await rowOf(band)).startsWith(lead)).toBe(true) // the lead and its divider stand still
      await band.unmount()
    }
    const band = await mountBand($, 'terminal', { bodyColumns: 100 })
    const length = [...(await movingOf(band))].length
    const start = await movingOf(band)
    await w.clock.advance(250 * 200) // past one lap of a short tape: it wraps
    const later = await movingOf(band)
    expect([...later].length).toBe(length)
    expect(later).not.toBe(start)
    await band.unmount()
  })
  test('the speed setting sets the pace from one to ten cells a second, live, and fetches nothing', async ($, on) => {
    const w = world(on)
    await w.start($)
    const run = (args: string) => $.command.run({ command: 'tape', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    await run('scroll')
    const band = await mountBand($, 'terminal', { bodyColumns: 100 })
    const rounds = () => w.rec.requests.filter(r => r.body?.includes('allMids') && r.body.includes('xyz')).length
    const before = rounds()
    const a = await movingOf(band)
    await setConfig($, 'tape.speed', 10, 4)
    await w.clock.advance(100)
    expect((await movingOf(band)).slice(0, -1)).toBe(a.slice(1)) // one cell per 100 ms now
    await setConfig($, 'tape.speed', 1, 10)
    const b = await movingOf(band)
    await w.clock.advance(999)
    expect(await movingOf(band)).toBe(b) // one cell a second
    await w.clock.advance(1)
    expect((await movingOf(band)).slice(0, -1)).toBe(b.slice(1))
    expect(rounds()).toBe(before) // a speed change asks the network for nothing
    await run('rotate')
    const page = await movingOf(band)
    await w.clock.advance(1000)
    expect(await movingOf(band)).toBe(page) // the frame timer went with the motion
    expect(rounds()).toBe(before) // and the motion switch fetched nothing either
    await band.unmount()
  })
  test('rotate, the default, shows pages of whole symbols that fit, flips every rotateSeconds, and runs no frame timer', async ($, on) => {
    const w = world(on)
    await w.start($)
    const band = await mountBand($, 'terminal', { bodyColumns: 70 })
    const first = await movingOf(band)
    expect(first.startsWith('AAPL 346.16 +0.3%   NVDA')).toBe(true)
    expect(first.endsWith(' ')).toBe(false) // whole cells, no gap at the end
    expect([...first].length).toBeLessThanOrEqual(70 - 27)
    await w.clock.advance(100)
    expect(await movingOf(band)).toBe(first) // no marquee
    await w.clock.advance(8_000)
    const second = await movingOf(band)
    expect(second).not.toBe(first)
    expect(second.startsWith('AAPL')).toBe(false)
    await w.clock.advance(8_000 * 3) // four pages at this width: three more flips come back round
    expect(await movingOf(band)).toBe(first)
    await band.unmount()
  })
})

describe('H and I: yielding and the switches', () => {
  test('with a survey up the band draws only what is beneath', async ($, on) => {
    const w = world(on)
    await w.start($)
    const band = await mountBand($, 'terminal', { hasSurvey: true })
    expect(textOf(await band.drawn())).toBe('beneath')
    expect(walk(await band.drawn(), n => keyOf(n) === 'tape').length).toBe(0)
    await band.unmount()
  })
  test('the nonessential-traffic switch: no request at all, and the band says so', async ($, on) => {
    const w = world(on, { env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } })
    await w.start($)
    await w.clock.advance(60_000)
    await w.settle()
    expect(w.rec.requests).toEqual([])
    const band = await mountBand($, 'desktop')
    expect(await rowOf(band)).toBe('tape off: nonessential traffic disabled')
    await band.unmount()
  })
  test('enabled off: no band, no timers, no requests; on again brings it all back', async ($, on) => {
    const w = world(on)
    await w.start($)
    const band = await mountBand($, 'terminal')
    expect(await rowOf(band)).toContain('AAPL')
    const before = w.rec.requests.length
    await setConfig($, 'tape.enabled', false, true)
    await w.settle()
    expect(textOf(await band.drawn())).toBe('beneath')
    await w.clock.advance(60_000)
    await w.settle()
    expect(w.rec.requests.length).toBe(before)
    await setConfig($, 'tape.enabled', true, false)
    await w.clock.advance(1)
    await w.settle()
    expect(w.rec.requests.length).toBeGreaterThan(before)
    expect(await rowOf(band)).toContain('AAPL')
    await band.unmount()
  })
  test('/tape off hides it for the session and /tape on brings it back; /tape prints the list', async ($, on) => {
    const w = world(on)
    await w.start($)
    const run = (args: string) => $.command.run({ command: 'tape', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    const band = await mountBand($, 'terminal')
    await run('off')
    expect(textOf(await band.drawn())).toBe('beneath')
    const before = w.rec.requests.length
    await w.clock.advance(60_000)
    await w.settle()
    expect(w.rec.requests.length).toBe(before)
    await run('on')
    await w.settle()
    expect(await rowOf(band)).toContain('AAPL')
    await run('')
    expect(w.rec.logs.at(-1)).toBe('tape: AAPL NVDA TSLA AMZN SP500 GOLD BTC ETH · hyperliquid perps · rotate')
    await run('remove btc')
    await run('')
    expect(w.rec.logs.at(-1)).toContain('GOLD ETH ·')
    await run('wat')
    expect(w.rec.logs.at(-1)).toContain('/tape add SYM')
    await band.unmount()
  })
})

describe('J and K: what leaves the machine', () => {
  test('Hyperliquid requests carry the type and the dex only, never the symbol list', async ($, on) => {
    const w = world(on)
    await w.start($)
    const hl = w.rec.requests.filter(r => r.url === 'https://api.hyperliquid.xyz/info')
    expect(hl.length).toBe(4) // mids for xyz and main, then both contexts
    for (const r of hl) {
      expect(r.method).toBe('POST')
      const body = JSON.parse(r.body ?? '{}') as Record<string, unknown>
      expect(Object.keys(body).sort()).toEqual(body.dex === undefined ? ['type'] : ['dex', 'type'])
      expect(r.body).not.toContain('AAPL')
    }
    expect(w.rec.requests.some(r => r.url.includes('alpaca'))).toBe(false)
  })
  test('with keys set, stocks come from one Alpaca call with the exact headers, crypto stays on Hyperliquid, and the key is in no tree or log; a 401 falls back once', async ($, on) => {
    const w = world(on)
    await w.start($)
    await setConfig($, 'tape.alpacaKey', KEY, '')
    await setConfig($, 'tape.alpacaSecret', SECRET, '')
    await w.clock.advance(1) // the fetch the keys asked for
    await w.settle()
    const calls = () => w.rec.requests.filter(r => r.url.startsWith('https://data.alpaca.markets/v2/stocks/snapshots'))
    expect(calls().length).toBe(1)
    const call = calls()[0]!
    expect(call.method).toBe('GET')
    expect(call.headers).toEqual({ 'APCA-API-KEY-ID': KEY, 'APCA-API-SECRET-KEY': SECRET })
    expect(call.url).toBe('https://data.alpaca.markets/v2/stocks/snapshots?symbols=AAPL,NVDA,TSLA,AMZN,SP500,GOLD&feed=iex')
    const band = await mountBand($, 'desktop', { bodyColumns: 200 })
    const row = await rowOf(band)
    expect(row.startsWith('tape · alpaca iex │ ')).toBe(true)
    expect(row).toContain('AAPL 347.50 +2.2%') // from the snapshot
    expect(row).toContain('BTC 83,508 +2.1%') // still from Hyperliquid
    const everything = JSON.stringify(await band.drawn()) + w.rec.logs.join('\n')
    expect(everything).not.toContain(KEY)
    expect(everything).not.toContain(SECRET)
    expect(SNAPSHOTS).not.toContain(KEY)
    await w.clock.advance(10_000)
    await w.settle()
    expect(calls().length).toBe(2) // one per refresh
    w.rec.mode = 'alpaca-401'
    await w.clock.advance(10_000)
    await w.settle()
    expect(w.rec.logs.filter(l => l.includes('alpaca refused'))).toEqual(['tape: alpaca refused the key; stocks stay on hyperliquid until the keys change'])
    expect((await rowOf(band)).startsWith('tape · hyperliquid perps │ ')).toBe(true)
    await w.clock.advance(10_000)
    await w.settle()
    expect(calls().length).toBe(3) // no further Alpaca call until the keys change
    expect(w.rec.logs.filter(l => l.includes('alpaca refused')).length).toBe(1)
    await band.unmount()
  })
})

describe('L: the desktop tree', () => {
  test('the desktop packs about a quarter more than the count, its font being narrower than the cells counted', async ($, on) => {
    const w = world(on)
    await w.start($)
    const terminal = await mountBand($, 'terminal', { bodyColumns: 90 })
    const desktop = await mountBand($, 'desktop', { bodyColumns: 90 })
    const t = await movingOf(terminal)
    const d = await movingOf(desktop)
    expect(t.startsWith('AAPL')).toBe(true)
    expect(t).toContain('TSLA')
    expect(t).not.toContain('AMZN') // three whole cells fit 63 counted cells
    expect(d.startsWith(t)).toBe(true) // the same page, continued
    expect(d).toContain('AMZN') // a fourth on the desktop
    expect(d).not.toContain('SP500')
    await terminal.unmount()
    await desktop.unmount()
  })
  test('plain characters only, words boxes may shrink, no buttons, a shallow tree', async ($, on) => {
    const w = world(on)
    await w.start($)
    const band = await mountBand($, 'desktop', { bodyColumns: 90 })
    const tree = await band.drawn()
    const row = await rowOf(band)
    for (const ch of row) expect(/^[\x20-\x7e·│]$/.test(ch), JSON.stringify(ch)).toBe(true)
    expect(walk(tree, n => n.type === 'Button').length).toBe(0)
    const shrinking = walk(tree, n => n.type === 'Box' && (n.props?.flexShrink === undefined || Number(n.props.flexShrink) > 0) && n.props?.width === undefined
      && (n.children ?? []).some(c => (c as Drawn).type === 'Text' && (c as Drawn).props?.wrap === 'truncate-end'))
    for (const box of shrinking) expect(box.props?.minWidth).toBe(0)
    const depth = (n: unknown, d = 0): number => (n === null || typeof n !== 'object' ? d : Math.max(d, ...((n as Drawn).children ?? []).map(c => depth(c, d + 1))))
    expect(depth(tree)).toBeLessThan(6)
    await band.unmount()
  })
})

describe('M: a reload', () => {
  test('a second session start restarts the loops from the kept state without stacking a timer, and an old-shape view loads', async ($, on) => {
    const w = world(on)
    on('state.set', ($$, e, next) => {
      if (e.plugin === 'tape' && e.key === 'view' && e.value !== null && typeof e.value === 'object' && 'offset' in (e.value as object)) {
        const { offset: _o, page: _p, ...old } = e.value as Record<string, unknown>
        return next({ ...e, value: old as unknown as typeof e.value })
      }
      return next(e)
    })
    await w.start($)
    const band = await mountBand($, 'terminal', { bodyColumns: 200 }) // one page: every symbol, whatever page the flips reach
    expect(await rowOf(band)).toContain('AAPL')
    const rounds = () => w.rec.requests.filter(r => r.body?.includes('allMids') && r.body.includes('xyz')).length
    await w.start($) // the code reloaded: register ran again, session.start again
    const atReload = rounds()
    await w.clock.advance(10_000)
    await w.settle()
    expect(rounds()).toBe(atReload + 1) // one loop, not two
    await w.clock.advance(300)
    expect(await rowOf(band)).toContain('AAPL') // the old-shape view (no offset, no page) still draws
    await band.unmount()
  })
})
