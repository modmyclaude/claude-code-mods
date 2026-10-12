// The pure parts: which window ran out, the words for times, and what a hold says.

import { describe, expect, test } from 'claude-code/testing'

import { CONTINUE_TEXT, clockWords, cutOffWindow, holdText, joined, oneLine, outWindow, preview, untilWords } from '../hooks/logic'
import { HOUR, MIN, RESET, T0, window } from './world'

describe('which window ran out', () => {
  test('a window at 100% that resets later is out; the latest reset wins when two are', () => {
    const weekly = RESET + 48 * HOUR
    expect(outWindow([window(100), window(100, weekly, 'seven_day')], T0)).toEqual({ kind: 'seven_day', resetsAt: weekly })
    expect(outWindow([window(99.9)], T0)).toBeNull()
    expect(outWindow([window(100, T0 - MIN)], T0)).toBeNull() // already reset
    expect(outWindow([{ kind: 'five_hour', percentUsed: 100 }], T0)).toBeNull() // no reset time to wait for
  })

  test('after a refusal, a window that trails at 95% or more is taken; a fuller one wins', () => {
    expect(cutOffWindow([window(40), window(97, RESET + HOUR, 'seven_day')], T0)).toEqual({ kind: 'seven_day', resetsAt: RESET + HOUR, isSure: false })
    expect(cutOffWindow([window(100)], T0)?.isSure).toBe(true)
    expect(cutOffWindow([window(96), window(98, RESET + HOUR, 'seven_day')], T0)?.kind).toBe('seven_day')
  })

  test('a refusal with no window near full is a passing one, and an API key reports none', () => {
    expect(cutOffWindow([window(60)], T0)).toBeNull()
    expect(cutOffWindow([], T0)).toBeNull()
  })
})

describe('times in words', () => {
  test('the reset as Claude Code names it: 2pm, 2:01pm, and the day when it is not today', () => {
    expect(clockWords(RESET, T0)).toBe('2pm')
    expect(clockWords(RESET + MIN, T0)).toBe('2:01pm')
    expect(clockWords(new Date(2026, 9, 12, 0, 5).getTime(), T0)).toBe('12:05am')
    expect(clockWords(new Date(2026, 9, 12, 12, 0).getTime(), T0)).toBe('12pm')
    expect(clockWords(new Date(2026, 9, 13, 8, 0).getTime(), T0)).toBe('Tue 8am')
  })

  test('time left is rounded up and never "0m"', () => {
    expect(untilWords(0)).toBe('now')
    expect(untilWords(45_000)).toBe('45s')
    expect(untilWords(59_001)).toBe('60s')
    expect(untilWords(60_001)).toBe('2m')
    expect(untilWords(5 * HOUR)).toBe('5h')
    expect(untilWords(2 * HOUR + 13 * MIN + 30_000)).toBe('2h 14m')
    expect(untilWords(76 * HOUR)).toBe('3d 4h')
    expect(untilWords(48 * HOUR)).toBe('2d')
  })
})

describe('what the person reads', () => {
  const held = { text: 'run the tests', sendAt: RESET + MIN, source: 'held' as const }

  test('a hold leads with what happened and stays within 20 words', () => {
    for (const [isAdded, hasFiles] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      const text = holdText(held, T0, isAdded, hasFiles)
      expect(text.split(/\s+/).length, text).toBeLessThanOrEqual(20)
      expect(text).toContain('2:01pm (in 5h 1m)')
    }
    expect(holdText(held, T0, false, false)).toBe('Usage limit reached. This prompt waits and sends 2:01pm (in 5h 1m). Cancel above the prompt.')
    expect(holdText(held, T0, false, true)).toContain('attach files again')
  })

  test('the preview is one safe line: control characters out, cut with an ellipsis', () => {
    expect(oneLine('fix\tthe\u001b[31m bug\nnow', 80)).toBe('fix the [31m bug now')
    expect(oneLine('a'.repeat(30), 10)).toBe(`${'a'.repeat(9)}…`)
    expect(preview({ ...held, text: 'x'.repeat(200) }, 40)).toBe(`"${'x'.repeat(35)}…"`)
  })

  test('a second prompt joins the first, and joins the pick-up too', () => {
    expect(joined(null, 'b', 5)).toEqual({ text: 'b', sendAt: 5, source: 'held' })
    expect(joined(held, 'b', 5)).toEqual({ text: 'run the tests\n\nb', sendAt: 5, source: 'held' })
    expect(joined({ text: CONTINUE_TEXT, sendAt: 1, source: 'continue' }, 'b', 5).text).toBe(`${CONTINUE_TEXT}\n\nb`)
  })
})
