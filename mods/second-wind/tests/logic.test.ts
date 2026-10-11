// Days, streaks, stored counts, the drawing helpers and every sentence the
// mod writes, as plain functions.

import { describe, expect, test } from 'claude-code/testing'

import { BAR_MAX, barCells, barWidth, fitHead, guideSvg, shownFill } from '../hooks/draw'
import { PATTERNS } from '../hooks/breath'
import {
  CARD_TEXT, SAFETY, USAGE, draftAfter, foldLine, readSettings, settingsLine, shareCard, statusText,
} from '../hooks/settings'
import {
  EMPTY_STATS, SWITCH_ON, addCounts, bumpStreak, dayKey, isOn, localOffset, parseStats, parseSwitch, streakOn, todayOn,
} from '../hooks/stats'

describe('dayKey: the local calendar day in any time zone', () => {
  const morning = Date.UTC(2026, 2, 8, 6, 30) // 2026-03-08 06:30 UTC
  const lateNye = Date.UTC(2026, 11, 31, 23, 30) // 2026-12-31 23:30 UTC
  const rows: [string, number, number, string][] = [
    ['UTC', morning, 0, '2026-03-08'],
    ['Los Angeles (UTC-8): still the evening before', morning, -480, '2026-03-07'],
    ['Denver (UTC-7): 23:30 the day before', morning, -420, '2026-03-07'],
    ['India (UTC+5:30)', morning, 330, '2026-03-08'],
    ['Kiribati (UTC+14)', morning, 840, '2026-03-08'],
    ['Hawaii (UTC-10)', morning, -600, '2026-03-07'],
    ['New Year in Paris (UTC+1)', lateNye, 60, '2027-01-01'],
    ['still 2026 in London', lateNye, 0, '2026-12-31'],
    ['still 2026 in New York', lateNye, -300, '2026-12-31'],
  ]
  for (const [name, ms, offset, day] of rows) {
    test(name, () => expect(dayKey(ms, offset)).toBe(day))
  }

  test('this machine\'s offset is a whole number of minutes', () => {
    const off = localOffset(Date.UTC(2026, 9, 9))
    expect(Number.isInteger(off)).toBe(true)
    expect(Math.abs(off) <= 14 * 60).toBe(true)
  })
})

describe('bumpStreak: consecutive breathing days', () => {
  const rows: [string, number, string | null, string, number, string][] = [
    ['the first day', 0, null, '2026-10-09', 1, '2026-10-09'],
    ['the next day adds one', 3, '2026-10-08', '2026-10-09', 4, '2026-10-09'],
    ['the same day keeps it', 3, '2026-10-09', '2026-10-09', 3, '2026-10-09'],
    ['a missed day starts over', 5, '2026-10-07', '2026-10-09', 1, '2026-10-09'],
    ['a day back in time (flight west) changes nothing', 4, '2026-10-09', '2026-10-08', 4, '2026-10-09'],
    ['across the year', 9, '2026-12-31', '2027-01-01', 10, '2027-01-01'],
    ['into a leap day', 2, '2028-02-28', '2028-02-29', 3, '2028-02-29'],
    ['out of a leap day', 3, '2028-02-29', '2028-03-01', 4, '2028-03-01'],
    ['no leap day in 2027', 2, '2027-02-28', '2027-03-01', 3, '2027-03-01'],
    ['across a month end', 6, '2026-10-31', '2026-11-01', 7, '2026-11-01'],
  ]
  for (const [name, streak, last, day, want, wantDay] of rows) {
    test(name, () => expect(bumpStreak(streak, last, day)).toEqual({ streak: want, streakDay: wantDay }))
  }

  test('a streak midnight crosses in one zone but not another', () => {
    // 23:30 UTC on Oct 9, then 01:30 UTC on Oct 10: one day apart in UTC,
    // the same evening in New York (UTC-4 in October).
    const a = Date.UTC(2026, 9, 9, 23, 30)
    const b = Date.UTC(2026, 9, 10, 1, 30)
    const utc = bumpStreak(1, dayKey(a, 0), dayKey(b, 0))
    const newYork = bumpStreak(1, dayKey(a, -240), dayKey(b, -240))
    expect(utc.streak).toBe(2)
    expect(newYork.streak).toBe(1)
  })
})

describe('stored counts', () => {
  test('a new day starts today over and keeps all-time counts', () => {
    let s = addCounts(EMPTY_STATS, '2026-10-09', { breaths: 4, eyeRests: 1 })
    s = addCounts(s, '2026-10-09', { breaths: 3, stretches: 1 })
    expect(todayOn(s, '2026-10-09')).toEqual({ breaths: 7, eyeRests: 1, stretches: 1, moves: 0 })
    s = addCounts(s, '2026-10-10', { breaths: 2 })
    expect(todayOn(s, '2026-10-10')).toEqual({ breaths: 2, eyeRests: 0, stretches: 0, moves: 0 })
    expect(s.all.breaths).toBe(9)
    expect(streakOn(s, '2026-10-10')).toBe(2)
  })

  test('the streak shows through the next day, then lapses', () => {
    const s = addCounts(EMPTY_STATS, '2026-10-09', { breaths: 1 })
    expect(streakOn(s, '2026-10-09')).toBe(1)
    expect(streakOn(s, '2026-10-10')).toBe(1)
    expect(streakOn(s, '2026-10-11')).toBe(0)
    expect(todayOn(s, '2026-10-10').breaths).toBe(0)
  })

  test('a move alone does not extend the streak', () => {
    const s = addCounts(EMPTY_STATS, '2026-10-09', { moves: 1 })
    expect(s.streak).toBe(0)
    expect(s.today.moves).toBe(1)
  })

  test('a clock moved back counts into the day already stored', () => {
    const s = addCounts(addCounts(EMPTY_STATS, '2026-10-10', { breaths: 2 }), '2026-10-09', { breaths: 3 })
    expect(s.day).toBe('2026-10-10')
    expect(s.today.breaths).toBe(5)
  })

  test('whatever the store holds reads as counts and dates', () => {
    expect(parseStats(undefined)).toEqual(EMPTY_STATS)
    expect(parseStats('nonsense')).toEqual(EMPTY_STATS)
    const s = parseStats({ day: 'yesterday', today: { breaths: -3, moves: 2.7 }, streak: 'x', streakDay: '2026-10-09', longTurns: 4, extra: 'dropped' })
    expect(s).toEqual({ ...EMPTY_STATS, today: { breaths: 0, eyeRests: 0, stretches: 0, moves: 2 }, streakDay: '2026-10-09', longTurns: 4 })
    expect(Object.keys(s).sort()).toEqual(['all', 'day', 'longTurns', 'streak', 'streakDay', 'today', 'v'])
  })

  test('on, off and snooze', () => {
    expect(isOn(SWITCH_ON, '2026-10-09')).toBe(true)
    expect(isOn({ off: true, snoozeDay: null }, '2026-10-09')).toBe(false)
    expect(isOn({ off: false, snoozeDay: '2026-10-09' }, '2026-10-09')).toBe(false)
    expect(isOn({ off: false, snoozeDay: '2026-10-09' }, '2026-10-10')).toBe(true)
    expect(parseSwitch({ off: 'yes', snoozeDay: 7 })).toEqual(SWITCH_ON)
  })
})

describe('the breath bar in text cells', () => {
  test('exactly the width asked (rounded to even), symmetric, full and empty at the ends', () => {
    for (const width of [6, 7, 20, 31, 40]) {
      for (const fill of [0, 0.01, 0.1, 0.5, 0.77, 1]) {
        const [l, body, r] = barCells(fill, width)
        expect((l + body + r).length).toBe(width - (width % 2))
        expect(l).toBe(r)
      }
      expect(barCells(1, width)[0]).toBe('')
      expect(barCells(0, width)[1]).toBe('')
    }
  })

  test('fills monotonically with half-cell steps', () => {
    let prev = -1
    for (let i = 0; i <= 100; i++) {
      const body = barCells(i / 100, 20)[1]
      expect(body.length >= prev).toBe(true)
      prev = body.length
    }
    expect(barCells(0.05, 20)[1]).toBe('▐▌')
  })

  test('the bar is capped and never wider than the band', () => {
    expect(barWidth(200)).toBe(BAR_MAX)
    expect(barWidth(24)).toBe(24)
    expect(barWidth(1)).toBe(2)
  })

  test('the caption drops before the cue is cut', () => {
    expect(fitHead('Breathe in 4', 'slow paced breathing', 80)).toEqual({ cue: 'Breathe in 4', caption: 'slow paced breathing' })
    expect(fitHead('Breathe in 4', 'slow paced breathing', 20)).toEqual({ cue: 'Breathe in 4', caption: null })
    expect(fitHead('Breathe in 4', 'slow paced breathing', 8)).toEqual({ cue: 'Breathe…', caption: null })
  })

  test('gentle motion travels less than full', () => {
    expect(shownFill(0, 'gentle')).toBe(0.35)
    expect(shownFill(1, 'gentle')).toBe(1)
    expect(shownFill(0, 'full')).toBe(0)
  })
})

describe('the desktop guide (MM-110)', () => {
  const box = PATTERNS.box

  test('one markup per span: the drawing runs the whole loop itself, eased, never swapped mid-breath', () => {
    const a = guideSvg(box, { motion: 'full', delayMs: 3000, loop: true, pose: 'calm' })
    expect(a).toBe(guideSvg(box, { motion: 'full', delayMs: 3000, loop: true, pose: 'calm' }))
    expect(a).toContain('16000ms linear -3000ms infinite')
    expect(a).toContain('cubic-bezier(.45,0,.55,1)')
    expect(a).toContain('@keyframes h{0%{r:12px')
    expect(a).not.toContain('<script')
    expect(a).not.toContain('<animate')
    // Each step's words, in order, on the same clock.
    for (const word of ['Breathe in', 'Hold', 'Breathe out']) expect(a).toContain(`>${word}</text>`)
  })

  test('reduced motion stills Bolt and the halo; the words still change', () => {
    const a = guideSvg(box, { motion: 'full', delayMs: 0, loop: true, pose: 'calm' })
    expect(a).toContain('@media (prefers-reduced-motion:reduce){.h,.b{animation:none}}')
    expect(a).toContain('@keyframes w0{')
    const still = guideSvg(box, { motion: 'still', delayMs: 0, loop: true, pose: 'calm' })
    expect(still).not.toContain('@keyframes h{')
  })

  test('gentle travels less; the closing exhale plays once', () => {
    expect(guideSvg(box, { motion: 'gentle', delayMs: 0, loop: true, pose: 'calm' })).toContain('@keyframes h{0%{r:15px')
    const finish = guideSvg([{ phase: 'out', ms: 2000, from: 0.6, to: 0 }], { motion: 'full', delayMs: 0, loop: false, pose: 'calm' })
    expect(finish).toContain('2000ms linear 0ms 1 both')
  })
})

describe('settings and copy', () => {
  test('defaults, and bad values fall back', () => {
    expect(readSettings({})).toEqual({ pattern: 'slow', motion: 'full', delayMs: 3000, eyeRest: true, stretch: true, movementCard: false })
    expect(readSettings({ pattern: 'triangle', motion: 'wild', delaySeconds: -4, eyeRest: 'no' })).toMatchObject({ pattern: 'slow', motion: 'full', delayMs: 0, eyeRest: true })
    expect(readSettings({ delaySeconds: 2.5 }).delayMs).toBe(2500)
    expect(readSettings({ delaySeconds: 99999 }).delayMs).toBe(600_000)
  })

  test('the fold line', () => {
    const s = addCounts(EMPTY_STATS, '2026-10-09', { breaths: 37 })
    expect(foldLine(4, s, '2026-10-09')).toBe('4 breaths while Claude worked · 37 today · 1-day streak')
    expect(foldLine(1, null, '2026-10-09')).toBe('1 breath while Claude worked')
  })

  test('/breathe carries the safety line, the settings and the switch', () => {
    const text = statusText(EMPTY_STATS, SWITCH_ON, '2026-10-09', readSettings({}))
    expect(text).toContain(SAFETY)
    expect(text).toContain('Second Wind is on.')
    expect(text).toContain(settingsLine(readSettings({})))
    expect(statusText(EMPTY_STATS, { off: false, snoozeDay: '2026-10-09' }, '2026-10-09', readSettings({}))).toContain('snoozed')
    expect(SAFETY).toBe('Breathe gently and never strain. If you feel lightheaded, stop and breathe normally.')
  })

  test('the share card holds counts only', () => {
    const s = addCounts(EMPTY_STATS, '2026-10-09', { breaths: 12, eyeRests: 1 })
    expect(shareCard(s, '2026-10-09')).toBe('Second Wind\n12 breaths today · 1-day streak\n12 breaths while Claude worked, all time\n1 eye rest today')
  })

  test('plain pattern names, no em dashes, no trademarked method names', () => {
    const all = [SAFETY, USAGE, settingsLine(readSettings({ pattern: 'box' })), statusText(EMPTY_STATS, SWITCH_ON, '2026-10-09', readSettings({})), ...Object.values(CARD_TEXT)].join('\n')
    expect(all).not.toContain('\u2014') // no em dashes
    expect(all.toLowerCase()).not.toContain('coherent')
    expect(settingsLine(readSettings({}))).toContain('slow paced breathing')
    expect(settingsLine(readSettings({ pattern: 'box' }))).toContain('box breathing')
  })

  test('draftAfter applies one edit', () => {
    const rows: [string, number, number, string, string][] = [
      ['', 0, 0, 'h', 'h'],
      ['hello', 5, 5, '!', 'hello!'],
      ['hello', 4, 5, '', 'hell'],
      ['hello', 0, 5, '', ''],
      ['ab', 1, 1, 'XY', 'aXYb'],
    ]
    for (const [text, start, end, inputText, want] of rows) expect(draftAfter({ text, start, end, inputText })).toBe(want)
  })
})
