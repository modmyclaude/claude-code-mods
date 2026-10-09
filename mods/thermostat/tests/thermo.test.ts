// The time rules, table-driven: settings, the cache window, temperature,
// formatting, duration parsing and the smart keep-warm plan.

import { describe, expect, test } from 'claude-code/testing'

import type { ThermostatAuth, ThermostatCache } from '../types'
import {
  HOUR,
  MINUTE,
  amberMs,
  clean,
  formatDuration,
  formatTokens,
  formatUsd,
  parseDuration,
  pingLeadMs,
  planKeepWarm,
  readSettings,
  resolveTtl,
  statusColor,
  statusText,
  temperature,
  ttlFromResume,
} from '../hooks/thermo'
import type { KeepWarmInput, KeepWarmStep, TtlSource } from '../hooks/thermo'

describe('readSettings falls back to the defaults on anything odd', () => {
  const cases: [options: Record<string, string | number>, guard: string, minutes: number][] = [
    [{}, 'hold', 0],
    [{ guard: 'warn' }, 'warn', 0],
    [{ guard: 'off', cacheMinutes: 30 }, 'off', 30],
    [{ guard: 'loud', cacheMinutes: -5 }, 'hold', 0],
    [{ cacheMinutes: 'soon' }, 'hold', 0],
    [{ cacheMinutes: 5000 }, 'hold', 1440],
  ]
  for (const [options, guard, minutes] of cases) {
    test(JSON.stringify(options), () => {
      expect(readSettings(options)).toEqual({ guard, cacheMinutes: minutes })
    })
  }
})

describe('resolveTtl: the engine, then the setting, then the login', () => {
  const cases: [setting: number, engine: number | null, auth: ThermostatAuth | null, minutes: number, source: TtlSource][] = [
    [0, null, 'bearer', 60, 'subscription'],
    [0, null, 'api-key', 5, 'api-key'],
    [0, null, 'none', 5, 'default'],
    [0, null, null, 5, 'default'],
    [0, 60, 'api-key', 60, 'engine'],
    [0, 5, 'bearer', 5, 'engine'],
    [30, 60, 'bearer', 60, 'engine'],
    [30, null, 'bearer', 30, 'setting'],
    [90, null, 'api-key', 90, 'setting'],
  ]
  for (const [setting, engine, auth, minutes, source] of cases) {
    test(`setting ${setting}, engine ${engine}, login ${auth} -> ${minutes}m (${source})`, () => {
      expect(resolveTtl(setting, engine, auth)).toEqual({ minutes, source })
    })
  }
})

describe('ttlFromResume reads the window from what Claude Code says about a resumed cache', () => {
  const cases: [secondsAgo: number, isExpired: boolean, minutes: number | null][] = [
    [30 * 60, true, 5], // expired after 30m: only the 5-minute window does that
    [30 * 60, false, 60], // still warm after 30m: the 1-hour window
    [2 * 60, false, null], // warm after 2m: either window
    [2 * 60 * 60, true, null], // expired after 2h: either window
  ]
  for (const [secondsAgo, isExpired, minutes] of cases) {
    test(`${secondsAgo}s ago, expired ${isExpired} -> ${minutes}`, () => {
      expect(ttlFromResume(secondsAgo, isExpired)).toBe(minutes)
    })
  }
})

describe('temperature', () => {
  const T = 1_000_000_000
  const cache = (over: Partial<ThermostatCache> = {}): ThermostatCache => ({
    lastAt: T,
    lastRealAt: T,
    tokens: 100_000,
    model: 'claude-opus-5-5',
    isOff: false,
    ...over,
  })
  const hour = 60 * MINUTE
  const cases: [label: string, now: number, c: ThermostatCache, kind: string, extra: Record<string, unknown>][] = [
    ['nothing cached', T, cache({ lastAt: null }), 'empty', {}],
    ['no tokens', T, cache({ tokens: 0 }), 'empty', {}],
    ['caching off', T + MINUTE, cache({ isOff: true }), 'off', {}],
    ['fresh', T, cache(), 'warm', { msLeft: hour, isAmber: false }],
    ['10m left is not yet amber', T + 50 * MINUTE, cache(), 'warm', { msLeft: 10 * MINUTE, isAmber: false }],
    ['just under 10m is amber', T + 50 * MINUTE + 1, cache(), 'warm', { isAmber: true }],
    ['expiry instant is cold', T + hour, cache(), 'cold', { msAgo: 0 }],
    ['long gone', T + 3 * hour, cache(), 'cold', { msAgo: 2 * hour }],
  ]
  for (const [label, now, c, kind, extra] of cases) {
    test(label, () => {
      expect(temperature(now, c, hour)).toMatchObject({ kind, ...extra })
    })
  }

  test('amber starts at 10 minutes, or 40% of a short window', () => {
    expect(amberMs(60 * MINUTE)).toBe(10 * MINUTE)
    expect(amberMs(5 * MINUTE)).toBe(2 * MINUTE)
    expect(amberMs(20 * MINUTE)).toBe(8 * MINUTE)
  })
})

describe('formatting', () => {
  const durations: [ms: number, text: string][] = [
    [0, '<1m'],
    [59_999, '<1m'],
    [60_000, '1m'],
    [41.9 * MINUTE, '41m'],
    [60 * MINUTE, '60m'],
    [72 * MINUTE, '1h12m'],
    [3 * HOUR, '3h'],
    [-5, '<1m'],
  ]
  for (const [ms, text] of durations) test(`duration ${ms} -> ${text}`, () => expect(formatDuration(ms)).toBe(text))

  const tokens: [n: number, text: string][] = [
    [950, '950'],
    [48_400, '48k'],
    [182_000, '182k'],
    [999_499, '999k'],
    [999_500, '1.0M'],
    [1_240_000, '1.2M'],
  ]
  for (const [n, text] of tokens) test(`tokens ${n} -> ${text}`, () => expect(formatTokens(n)).toBe(text))

  const dollars: [usd: number, text: string][] = [
    [0, '$0.00'],
    [0.004, '<$0.01'],
    [0.034, '$0.03'],
    [1.2, '$1.20'],
  ]
  for (const [usd, text] of dollars) test(`usd ${usd} -> ${text}`, () => expect(formatUsd(usd)).toBe(text))
})

describe('the status line reads like a thermostat', () => {
  const cases: [label: string, args: Parameters<typeof statusText>, text: string, color: string | undefined][] = [
    ['empty draws nothing', [{ kind: 'empty' }, 0, null], '', undefined],
    ['warm', [{ kind: 'warm', msLeft: 41 * MINUTE, isAmber: false }, 182_000, null], 'cache warm · 41m left', undefined],
    ['amber', [{ kind: 'warm', msLeft: 8 * MINUTE, isAmber: true }, 182_000, null], 'cache warm · 8m left', 'warning'],
    [
      'kept warm',
      [{ kind: 'warm', msLeft: 41 * MINUTE, isAmber: false }, 182_000, 72 * MINUTE],
      'cache warm · 41m left · warming 1h12m',
      undefined,
    ],
    ['cold', [{ kind: 'cold', msAgo: MINUTE }, 182_000, null], 'cache cold · 182k to re-read', 'suggestion'],
    ['off', [{ kind: 'off' }, 182_000, null], 'cache off', undefined],
  ]
  for (const [label, args, text, color] of cases) {
    test(label, () => {
      expect(statusText(...args)).toBe(text)
      expect(statusColor(args[0])).toBe(color)
    })
  }
})

describe('parseDuration reads /warm arguments', () => {
  const cases: [text: string, ms: number | null][] = [
    ['90m', 90 * MINUTE],
    ['2h', 2 * HOUR],
    ['1h30m', 90 * MINUTE],
    ['1.5h', 90 * MINUTE],
    ['90 min', 90 * MINUTE],
    ['2 hours', 2 * HOUR],
    ['45', 45 * MINUTE],
    [' 3H ', 3 * HOUR],
    ['', null],
    ['h', null],
    ['soon', null],
    ['1h30', null],
    ['-5m', null],
  ]
  for (const [text, ms] of cases) test(`"${text}" -> ${ms}`, () => expect(parseDuration(text)).toBe(ms))
})

describe('planKeepWarm weighs the pings still needed against one cold re-read', () => {
  const T = 1_000_000_000
  const base: KeepWarmInput = {
    now: T,
    lastAt: T,
    until: T + 3 * HOUR,
    ttlMs: HOUR,
    leadMs: 2 * MINUTE,
    pingUsd: 0.03,
    extraUsd: 1.17,
  }
  const cases: [label: string, over: Partial<KeepWarmInput>, step: KeepWarmStep][] = [
    ['waits until 2m before expiry', {}, { kind: 'wait', pingAt: T + 58 * MINUTE, pingsLeft: 3, costUsd: 0.09 }],
    ['pings at the lead', { now: T + 58 * MINUTE }, { kind: 'ping', pingsLeft: 3, costUsd: 0.09 }],
    ['the window is over', { now: T + 3 * HOUR }, { kind: 'finished' }],
    ['the cache already lapsed', { now: T + 61 * MINUTE }, { kind: 'cold' }],
    ['the cache outlives the window', { until: T + 50 * MINUTE }, { kind: 'covered' }],
    ['dearer than the re-read', { pingUsd: 0.5 }, { kind: 'stop', pingsLeft: 3, costUsd: 1.5 }],
    ['exactly even is still worth it', { pingUsd: 0.39 }, { kind: 'wait', pingAt: T + 58 * MINUTE, pingsLeft: 3, costUsd: 1.17 }],
  ]
  for (const [label, over, step] of cases) {
    test(label, () => {
      const got = planKeepWarm({ ...base, ...over })
      if ('costUsd' in got && 'costUsd' in step) {
        expect(Math.abs(got.costUsd - step.costUsd)).toBeLessThan(1e-9)
        expect({ ...got, costUsd: 0 }).toEqual({ ...step, costUsd: 0 })
      } else {
        expect(got).toEqual(step)
      }
    })
  }

  test('a 5-minute window pings every 4 minutes, a minute ahead', () => {
    expect(pingLeadMs(5 * MINUTE)).toBe(MINUTE)
    expect(pingLeadMs(HOUR)).toBe(2 * MINUTE)
    const got = planKeepWarm({ ...base, ttlMs: 5 * MINUTE, leadMs: MINUTE, until: T + 30 * MINUTE, extraUsd: 10 })
    // Expiry at 5m, then 25 more minutes at 4 minutes a ping.
    expect(got).toMatchObject({ kind: 'wait', pingAt: T + 4 * MINUTE, pingsLeft: 7 })
  })
})

describe('clean makes outside text safe to draw', () => {
  const cases: [label: string, text: string, want: string][] = [
    ['plain text is untouched', '90 minutes', '90 minutes'],
    ['a colour sequence is stripped', '\x1b[31mred\x1b[0m', 'red'],
    ['an OSC title is stripped', '\x1b]0;title\x07after', 'after'],
    ['an 8-bit CSI is stripped', '\x9b2Jgone', 'gone'],
    ['a bell becomes U+FFFD', 'ding\x07', 'ding\uFFFD'],
    ['NUL, DEL and C1 become U+FFFD', 'a\x00b\x7fc\x85d', 'a\uFFFDb\uFFFDc\uFFFDd'],
    ['a newline becomes U+FFFD', 'one\ntwo', 'one\uFFFDtwo'],
    ['a lone ESC becomes U+FFFD', 'x\x1b', 'x\uFFFD'],
  ]
  for (const [label, text, want] of cases) test(label, () => expect(clean(text)).toBe(want))
})
