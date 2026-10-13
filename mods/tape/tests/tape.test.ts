import { describe, expect, test } from 'claude-code/testing'
import {
  ageOf, backoff, cellsOf, clampSpeed, DIVIDER, fmtChange, fmtPrice, frameMsOf, isQuiet, leadOf, MAX_INTERVAL_MS, pagesOf, roomOf, parseAssetCtxs, parseMids, parseSnapshots,
  parseSymbols, ring, ringLength, runsOfPage, SYMBOLS_MAX, windowOf,
} from '../hooks/tape'

describe('parseSymbols', () => {
  test('upper-cases, splits on commas and spaces, drops what is not a symbol, deduplicates, caps', () => {
    expect(parseSymbols('aapl, nvda btc;eth,,')).toEqual(['AAPL', 'NVDA', 'BTC', 'ETH'])
    expect(parseSymbols('AAPL AAPL <script> $X "y" ok-1 a.b')).toEqual(['AAPL', 'OK-1', 'A.B'])
    expect(parseSymbols(Array.from({ length: 60 }, (_, i) => `S${i}`).join(',')).length).toBe(SYMBOLS_MAX)
    expect(parseSymbols('')).toEqual([])
  })
})

describe('the sources', () => {
  test('allMids: keys cleaned, values must be positive numbers, bad JSON is empty', () => {
    expect(parseMids('{"BTC":"83508.0","xyz:AAPL":"346.16","bad":"x","neg":"-1","<b>":"1"}')).toEqual({ BTC: 83508, 'xyz:AAPL': 346.16 })
    expect(parseMids('not json')).toEqual({})
    expect(parseMids('[1,2]')).toEqual({})
  })
  test('metaAndAssetCtxs: the previous day by name, aligned by index; missing or bad entries skipped', () => {
    const text = JSON.stringify([{ universe: [{ name: 'xyz:AAPL' }, { name: 'xyz:GOLD' }, { name: 'x' }] }, [{ prevDayPx: '345.1' }, { midPx: '1' }, null]])
    expect(parseAssetCtxs(text)).toEqual({ 'xyz:AAPL': 345.1 })
    expect(parseAssetCtxs('{}')).toEqual({})
  })
  test('snapshots: the last trade and the previous close by symbol; the daily close stands in for a missing trade', () => {
    const text = JSON.stringify({ AAPL: { latestTrade: { p: 347.5 }, prevDailyBar: { c: 340 } }, NVDA: { dailyBar: { c: 226 } }, 'bad sym': { latestTrade: { p: 1 } }, ZZ: {} })
    expect(parseSnapshots(text)).toEqual({ AAPL: { price: 347.5, prevDay: 340 }, NVDA: { price: 226 } })
    expect(parseSnapshots('[]')).toEqual({})
  })
})

describe('the words', () => {
  test('prices: commas from a thousand, two decimals below, three figures under one', () => {
    expect(fmtPrice(83508)).toBe('83,508')
    expect(fmtPrice(7798.4)).toBe('7,798')
    expect(fmtPrice(346.16)).toBe('346.16')
    expect(fmtPrice(1.08)).toBe('1.08')
    expect(fmtPrice(0.1234)).toBe('0.123')
    expect(fmtPrice(Number.NaN)).toBe('?')
  })
  test('changes: a sign and one decimal in a tone; -- dim where the earlier price is unknown; never NaN', () => {
    expect(fmtChange(346.16, 345.1)).toEqual({ text: '+0.3%', tone: 'up' })
    expect(fmtChange(225.55, 228.3)).toEqual({ text: '-1.2%', tone: 'down' })
    expect(fmtChange(231.4, 231.4)).toEqual({ text: '0.0%', tone: 'flat' })
    expect(fmtChange(100, undefined)).toEqual({ text: '--', tone: 'dim' })
    expect(fmtChange(100, 0)).toEqual({ text: '--', tone: 'dim' })
    expect(fmtChange(Number.NaN, 5).text).not.toContain('NaN')
  })
  test('cells: the symbols in the asked order, an unknown one as a question mark', () => {
    const cells = cellsOf(['BTC', 'ZZZZ', 'AAPL'], { BTC: { price: 83508, prevDay: 81800, source: 'hyperliquid', at: 0 }, AAPL: { price: 346.16, source: 'hyperliquid', at: 0 } })
    expect(cells.map(c => `${c.symbol} ${c.price} ${c.change}`.trim())).toEqual(['BTC 83,508 +2.1%', 'ZZZZ ?', 'AAPL 346.16 --'])
    expect(cells[1]!.known).toBe(false)
  })
  test('the lead cell and the age', () => {
    expect(leadOf('hyperliquid', undefined)).toBe('tape · hyperliquid perps')
    expect(leadOf('alpaca', '2m old')).toBe('tape · alpaca iex · 2m old')
    expect(ageOf(70_000, 10_000)).toBe('1m old')
    expect(ageOf(30_000, 10_000)).toBe('20s old')
    expect(ageOf(10, null)).toBe('no prices yet')
  })
})

describe('the motion', () => {
  const cells = cellsOf(['AAPL', 'BTC'], { AAPL: { price: 346.16, prevDay: 345.1, source: 'hyperliquid', at: 0 }, BTC: { price: 83508, prevDay: 81800, source: 'hyperliquid', at: 0 } })
  test('the ring is every cell with a gap after it, and a window of it is exactly as wide as asked, wrapping', () => {
    const r = ring(cells)
    const text = r.map(x => x.text).join('')
    expect(text).toBe('AAPL 346.16 +0.3%   BTC 83,508 +2.1%   ')
    const total = ringLength(r)
    expect(total).toBe([...text].length)
    for (const offset of [0, 1, 5, total - 1, total, total + 3, -2]) {
      const w = windowOf(r, offset, 12)
      expect(w.map(x => x.text).join('').length, `offset ${offset}`).toBe(12)
    }
    expect(windowOf(r, 1, 11).map(x => x.text).join('')).toBe('APL 346.16 ')
    expect(windowOf(r, total - 2, 6).map(x => x.text).join('')).toBe('  AAPL')
    expect(windowOf(r, 0, 100).map(x => x.text).join('').length).toBe(100) // shorter than the window: it repeats
    expect(windowOf(r, 0, 0)).toEqual([])
    expect(windowOf(ring([]), 0, 8).map(x => x.text).join('')).toBe('no symbo')
  })
  test('a window keeps each run in its own tone, cut at the edges', () => {
    const w = windowOf(ring(cells), 12, 10)
    expect(w.map(x => x.tone)).toEqual(['up', 'dim', 'name'])
    expect(w.map(x => x.text).join('')).toBe('+0.3%   BT')
  })
  test('pages hold whole cells that fit, a gap between them; a cell wider than the page goes alone', () => {
    const pages = pagesOf(cells, 20)
    expect(pages.map(p => p.map(c => c.symbol))).toEqual([['AAPL'], ['BTC']])
    expect(pagesOf(cells, 40).map(p => p.map(c => c.symbol))).toEqual([['AAPL', 'BTC']])
    expect(pagesOf(cells, 5).map(p => p.map(c => c.symbol))).toEqual([['AAPL'], ['BTC']])
    expect(runsOfPage(pages[0]!).map(x => x.text).join('')).toBe('AAPL 346.16 +0.3%')
    expect(pagesOf([], 40)).toEqual([])
  })
})

describe('the loop', () => {
  test('a failure doubles the wait up to five minutes', () => {
    expect(backoff(10_000)).toBe(20_000)
    expect(backoff(200_000)).toBe(MAX_INTERVAL_MS)
    expect(backoff(0)).toBe(2000)
  })
  test('the quiet switch counts as set unless empty, 0 or false', () => {
    expect(isQuiet(undefined)).toBe(false)
    expect(isQuiet('')).toBe(false)
    expect(isQuiet('0')).toBe(false)
    expect(isQuiet('false')).toBe(false)
    expect(isQuiet('1')).toBe(true)
    expect(isQuiet('true')).toBe(true)
  })
})

describe('the pace', () => {
  test('the speed clamps to one to ten whole cells a second, anything else is four, and the frame follows', () => {
    expect(clampSpeed(undefined)).toBe(4)
    expect(clampSpeed('fast')).toBe(4)
    expect(clampSpeed(Number.NaN)).toBe(4)
    expect(clampSpeed(0)).toBe(1)
    expect(clampSpeed(2.6)).toBe(3)
    expect(clampSpeed(99)).toBe(10)
    expect(frameMsOf(4)).toBe(250)
    expect(frameMsOf(3)).toBe(333)
    expect(frameMsOf(10)).toBe(100)
    expect(frameMsOf(0)).toBe(1000)
  })
  test('the room beside the lead is the width less the lead and the divider, a quarter more on the desktop, never negative', () => {
    expect(roomOf(100, 'tape · hyperliquid perps', 'terminal')).toBe(73)
    expect(roomOf(100, 'tape · hyperliquid perps', 'desktop')).toBe(98)
    expect(roomOf(90, 'tape · hyperliquid perps', 'vscode')).toBe(63)
    expect(roomOf(10, 'tape · hyperliquid perps', 'desktop')).toBe(0)
  })
  test('the divider is one glyph with a space each side', () => {
    expect([...DIVIDER].length).toBe(3)
    expect(DIVIDER.trim()).toBe('│')
  })
})
