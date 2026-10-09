// Table-driven tests for Pager's pure rules.

import { describe, expect, test } from 'claude-code/testing'

import {
  assetFor,
  formatDuration,
  isQuiet,
  notificationAlert,
  parseDuration,
  parseQuietHours,
  parseTopic,
  pushFor,
  sessionName,
  turnAlert,
  untilText,
} from '../hooks/logic'

const MIN = 20_000

describe('turnAlert', () => {
  const cases = [
    { why: 'a long answer', e: { reason: 'answer', durationMs: 25_000 }, want: 'done' },
    { why: 'an answer exactly at minDuration', e: { reason: 'answer', durationMs: 20_000 }, want: 'done' },
    { why: 'a quick answer', e: { reason: 'answer', durationMs: 19_999 }, want: undefined },
    { why: 'a quick API error', e: { reason: 'error', durationMs: 1_000 }, want: 'error' },
    { why: 'a refusal', e: { reason: 'refusal', durationMs: 1_000 }, want: 'error' },
    { why: 'an interrupt, however long', e: { reason: 'aborted', durationMs: 600_000 }, want: undefined },
    { why: "a subagent's long answer", e: { reason: 'answer', durationMs: 60_000, agentId: 'a1' }, want: undefined },
    { why: "a subagent's error", e: { reason: 'error', durationMs: 60_000, agentId: 'a1' }, want: undefined },
  ] as const
  for (const { why, e, want } of cases) {
    test(why, () => {
      expect(turnAlert(e, MIN)).toBe(want)
    })
  }
})

describe('notificationAlert', () => {
  const cases = [
    ['permission_prompt', 'needs-you'],
    ['worker_permission_prompt', 'needs-you'],
    ['elicitation_dialog', 'needs-you'],
    ['elicitation_url_dialog', 'needs-you'],
    ['agent_needs_input', 'needs-you'],
    ['idle_prompt', undefined],
    ['auth_success', undefined],
    ['agent_completed', undefined],
    ['elicitation_complete', undefined],
    ['something_new', undefined],
  ] as const
  test('maps only the waiting-on-you types', () => {
    for (const [type, want] of cases) expect(notificationAlert(type), type).toBe(want)
  })
})

describe('parseDuration', () => {
  const cases: [string, number | undefined][] = [
    ['30m', 30 * 60_000],
    ['2h', 2 * 3_600_000],
    ['1h30m', 90 * 60_000],
    ['45s', 45_000],
    ['1d', 86_400_000],
    ['90', 90 * 60_000],
    [' 15M ', 15 * 60_000],
    ['7d', 7 * 86_400_000],
    ['8d', undefined],
    ['0m', undefined],
    ['', undefined],
    ['soon', undefined],
    ['30 m', undefined],
    ['-5m', undefined],
    ['1.5h', undefined],
  ]
  test('reads mute lengths and refuses the rest', () => {
    for (const [text, want] of cases) expect(parseDuration(text), JSON.stringify(text)).toBe(want)
  })
})

describe('quiet hours', () => {
  test('parses windows, off and nonsense', () => {
    expect(parseQuietHours('22:00-07:00')).toEqual({ start: 1320, end: 420 })
    expect(parseQuietHours(' 9 - 17:30 ')).toEqual({ start: 540, end: 1050 })
    expect(parseQuietHours('')).toBeNull()
    expect(parseQuietHours('   ')).toBeNull()
    for (const bad of ['10pm-7am', '24:00-07:00', '22:60-07:00', '22:00-22:00', '22:00', 'night']) {
      expect(parseQuietHours(bad), bad).toBeUndefined()
    }
  })

  test('a window that wraps midnight', () => {
    const night = parseQuietHours('22:00-07:00')
    const cases: [number, boolean][] = [
      [21 * 60 + 59, false],
      [22 * 60, true],
      [23 * 60 + 30, true],
      [0, true],
      [6 * 60 + 59, true],
      [7 * 60, false],
      [12 * 60, false],
    ]
    for (const [minute, want] of cases) expect(isQuiet(night, minute), String(minute)).toBe(want)
  })

  test('a daytime window, and off', () => {
    const day = parseQuietHours('09:00-17:00')
    expect(isQuiet(day, 8 * 60 + 59)).toBe(false)
    expect(isQuiet(day, 9 * 60)).toBe(true)
    expect(isQuiet(day, 16 * 60 + 59)).toBe(true)
    expect(isQuiet(day, 17 * 60)).toBe(false)
    expect(isQuiet(null, 23 * 60)).toBe(false)
    expect(isQuiet(undefined, 23 * 60)).toBe(false)
  })
})

describe('formatting', () => {
  test('durations keep the two largest units', () => {
    const cases: [number, string][] = [
      [0, '0s'],
      [20_000, '20s'],
      [125_000, '2m 5s'],
      [30 * 60_000, '30m'],
      [90 * 60_000, '1h 30m'],
      [3_725_000, '1h 2m'],
      [7 * 86_400_000, '7d'],
    ]
    for (const [ms, want] of cases) expect(formatDuration(ms), String(ms)).toBe(want)
  })

  test('until names the day only when it is not today', () => {
    const now = new Date(2026, 9, 9, 13, 35).getTime()
    expect(untilText(now, new Date(2026, 9, 9, 14, 5).getTime())).toBe('14:05')
    expect(untilText(now, new Date(2026, 9, 10, 7, 30).getTime())).toBe('tomorrow 07:30')
    expect(untilText(now, new Date(2026, 9, 12, 9, 0).getTime())).toBe('Oct 12 09:00')
  })

  test('the toast names the title, else the project folder', () => {
    expect(sessionName('Fix login', '/x/my-app')).toBe('Fix login')
    expect(sessionName('  ', '/Users/me/code/my-app')).toBe('my-app')
    expect(sessionName(undefined, 'C:\\code\\win-app\\')).toBe('win-app')
    expect(sessionName(undefined, undefined)).toBe('this session')
    expect(sessionName('x'.repeat(80), undefined)).toHaveLength(62)
  })

  test('clip paths stay inside the plugin', () => {
    expect(assetFor('zen', 'needs-you')).toBe('sounds/zen/needs-you.wav')
  })
})

describe('ntfy', () => {
  test('topics: unset is off, invalid is refused, a pasted URL is taken', () => {
    expect(parseTopic(undefined)).toBeNull()
    expect(parseTopic('')).toBeNull()
    expect(parseTopic('pager-alex_01')).toBe('pager-alex_01')
    expect(parseTopic(' https://ntfy.sh/abc ')).toBe('abc')
    for (const bad of ['a/b', 'a b', 'abc?x=1', '../up', 'x'.repeat(65), 'https://evil.example/abc']) {
      expect(parseTopic(bad), bad).toBeUndefined()
    }
  })

  test('pushes are fixed words plus a duration', () => {
    expect(pushFor('done', 125_000)).toEqual({ title: 'Pager: done', body: 'A turn finished after 2m 5s.' })
    expect(pushFor('done')).toEqual({ title: 'Pager: done', body: 'A turn finished.' })
    expect(pushFor('needs-you').title).toBe('Pager: needs you')
    expect(pushFor('error').title).toBe('Pager: error')
  })
})
