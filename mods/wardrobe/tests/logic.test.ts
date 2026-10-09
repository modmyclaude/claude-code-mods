import { describe, expect, test } from 'claude-code/testing'

import { DIFF_LINE_CAP, diffCard, shellCard, shortPath } from '../hooks/content'
import {
  formatDuration,
  formatMs,
  isDay,
  parseClock,
  parseWear,
  pinsOf,
  resolveLook,
  settingsFrom,
  type Settings,
} from '../hooks/look'
import { EDIT } from './setup'

describe('parseClock()', () => {
  const cases: [string, number | undefined][] = [
    ['07:00', 420],
    ['7:05', 425],
    [' 19:00 ', 1140],
    ['00:00', 0],
    ['23:59', 1439],
    ['24:00', undefined],
    ['07:60', undefined],
    ['7', undefined],
    ['7:5', undefined],
    ['7am', undefined],
    ['', undefined],
  ]
  for (const [text, minute] of cases) {
    test(`"${text}" is ${String(minute)}`, () => {
      expect(parseClock(text)).toBe(minute)
    })
  }
})

describe('isDay()', () => {
  const m = (text: string) => parseClock(text) ?? -1
  const cases: [string, string, string, boolean][] = [
    // now, day starts, night starts, is day
    ['06:59', '07:00', '19:00', false],
    ['07:00', '07:00', '19:00', true],
    ['18:59', '07:00', '19:00', true],
    ['19:00', '07:00', '19:00', false],
    ['00:00', '07:00', '19:00', false],
    // A day that runs across midnight (a night-shift schedule).
    ['21:00', '20:00', '06:00', true],
    ['05:59', '20:00', '06:00', true],
    ['06:00', '20:00', '06:00', false],
    ['12:00', '20:00', '06:00', false],
    // The same time twice: no night at all.
    ['03:00', '08:00', '08:00', true],
  ]
  for (const [now, day, night, expected] of cases) {
    test(`${now} with day ${day} and night ${night} is ${expected ? 'day' : 'night'}`, () => {
      expect(isDay(m(now), m(day), m(night))).toBe(expected)
    })
  }
})

describe('parseWear()', () => {
  const cases: [string, unknown][] = [
    ['', { kind: 'list' }],
    ['  ', { kind: 'list' }],
    ['list', { kind: 'list' }],
    ['dracula', { kind: 'wear', choice: 'dracula' }],
    ['  Dracula ', { kind: 'wear', choice: 'dracula' }],
    ['drac', { kind: 'wear', choice: 'dracula' }],
    ['tokyo night', { kind: 'wear', choice: 'tokyo-night' }],
    ['tokyo_night', { kind: 'wear', choice: 'tokyo-night' }],
    ['hc', { kind: 'wear', choice: 'high-contrast' }],
    ['colourblind', { kind: 'wear', choice: 'colorblind' }],
    ['auto', { kind: 'wear', choice: 'auto' }],
    ['default', { kind: 'wear', choice: 'default' }],
    ['off', { kind: 'wear', choice: 'default' }],
    ['pin', { kind: 'pin' }],
    ['unpin', { kind: 'unpin' }],
    ['c', { kind: 'unknown', word: 'c' }],
    ['Neon', { kind: 'unknown', word: 'Neon' }],
  ]
  for (const [args, expected] of cases) {
    test(`"${args}"`, () => {
      expect(parseWear(args)).toEqual(expected)
    })
  }
})

describe('resolveLook()', () => {
  const settings: Settings = { dayTheme: 'paper', nightTheme: 'nord', dayStarts: 420, nightStarts: 1140 }
  const noon = 720
  const midnight = 0

  test('nothing chosen is Claude Code own look', () => {
    expect(resolveLook({ root: '/a', global: undefined, pins: undefined, minute: noon, settings })).toEqual({
      theme: 'default',
      choice: 'default',
      scope: 'global',
      phase: null,
      root: '/a',
    })
  })

  test('the global choice applies where there is no pin', () => {
    const look = resolveLook({ root: '/a', global: 'dracula', pins: { '/b': 'nord' }, minute: noon, settings })
    expect(look).toMatchObject({ theme: 'dracula', scope: 'global' })
  })

  test("a project's pin wins over the global choice", () => {
    const look = resolveLook({ root: '/b', global: 'dracula', pins: { '/b': 'nord' }, minute: noon, settings })
    expect(look).toMatchObject({ theme: 'nord', choice: 'nord', scope: 'project' })
  })

  test('auto wears the day theme by day and the night theme by night', () => {
    expect(resolveLook({ root: '/a', global: 'auto', pins: {}, minute: noon, settings })).toMatchObject({ theme: 'paper', phase: 'day' })
    expect(resolveLook({ root: '/a', global: 'auto', pins: {}, minute: midnight, settings })).toMatchObject({ theme: 'nord', phase: 'night' })
  })

  test('stored values this version does not know are ignored', () => {
    expect(resolveLook({ root: '/a', global: 'vaporwave', pins: { '/a': 42 }, minute: noon, settings }).theme).toBe('default')
    expect(pinsOf(['/a'])).toEqual({})
    expect(pinsOf({ '/a': 'noir', '/b': 'gone' })).toEqual({ '/a': 'noir' })
  })
})

describe('settingsFrom()', () => {
  test('good values are used as given', () => {
    const { settings, problems } = settingsFrom({ dayTheme: 'noir', nightTheme: 'dracula', dayStarts: '06:30', nightStarts: '21:15' })
    expect(settings).toEqual({ dayTheme: 'noir', nightTheme: 'dracula', dayStarts: 390, nightStarts: 1275 })
    expect(problems).toEqual([])
  })

  test('unusable values fall back and are named', () => {
    const { settings, problems } = settingsFrom({ dayTheme: 'sunrise', nightTheme: 'nord', dayStarts: '7am', nightStarts: '19:00' })
    expect(settings).toMatchObject({ dayTheme: 'paper', dayStarts: 420 })
    expect(problems).toEqual(['dayTheme "sunrise" is not a theme; using paper', 'dayStarts "7am" is not HH:MM; using 07:00'])
  })
})

describe('formatMs() and formatDuration()', () => {
  const ms: [number, string][] = [
    [0, '0ms'],
    [840, '840ms'],
    [999.6, '1.0s'],
    [1234, '1.2s'],
    [9949, '9.9s'],
    [14_000, '14s'],
    [64_000, '1m 4s'],
    [-1, ''],
    [Number.NaN, ''],
  ]
  for (const [value, text] of ms) {
    test(`formatMs(${value}) is "${text}"`, () => {
      expect(formatMs(value)).toBe(text)
    })
  }
  const durations: [number, string][] = [
    [3000, '3s'],
    [59_400, '59s'],
    [60_000, '1m'],
    [64_000, '1m 4s'],
    [3_600_000, '1h'],
    [3_900_000, '1h 5m'],
  ]
  for (const [value, text] of durations) {
    test(`formatDuration(${value}) is "${text}"`, () => {
      expect(formatDuration(value)).toBe(text)
    })
  }
})

describe('diffCard()', () => {
  test('numbers each line from its hunk and counts the change', () => {
    expect(diffCard('Edit', EDIT)).toEqual({
      path: '/work/alpha/src/app.ts',
      verb: 'Updated',
      added: 1,
      removed: 1,
      userModified: false,
      lines: [
        { kind: 'context', text: 'const a = 1', no: 11 },
        { kind: 'remove', text: 'const b = 2', no: 12 },
        { kind: 'add', text: 'const b = 3', no: 12 },
        { kind: 'context', text: 'const c = 4', no: 13 },
      ],
    })
  })

  test('puts a gap between hunks and reads past "no newline" markers', () => {
    const card = diffCard('Write', {
      filePath: 'x.txt',
      structuredPatch: [
        { oldStart: 1, newStart: 1, lines: ['-a', '+b'] },
        { oldStart: 40, newStart: 40, lines: ['+z', '\\ No newline at end of file'] },
      ],
    })
    expect(card?.verb).toBe('Wrote')
    expect(card?.lines.map(line => line.kind)).toEqual(['remove', 'add', 'gap', 'add'])
    expect(card?.lines[3]).toEqual({ kind: 'add', text: 'z', no: 40 })
  })

  test('tabs become spaces and control characters cannot reach a Text', () => {
    const card = diffCard('Edit', { filePath: 'x', structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['+\tif (a)\u001b[0m\r'] }] })
    expect(card?.lines[0]?.text).toBe('  if (a)�[0m')
  })

  const refused: [string, unknown][] = [
    ['no result', undefined],
    ['a text result', 'File written'],
    ['no patch', { filePath: 'x', structuredPatch: [] }],
    ['an edit held for review', { ...EDIT, staged: true }],
    ['a line that is not a diff line', { filePath: 'x', structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['?what'] }] }],
    ['a hunk without numbers', { filePath: 'x', structuredPatch: [{ lines: ['+a'] }] }],
    [
      'a diff too long to draw whole',
      { filePath: 'x', structuredPatch: [{ oldStart: 1, newStart: 1, lines: Array.from({ length: DIFF_LINE_CAP + 1 }, (_, i) => `+${i}`) }] },
    ],
  ]
  for (const [name, output] of refused) {
    test(`leaves ${name} to the engine`, () => {
      expect(diffCard('Edit', output)).toBeNull()
    })
  }
})

describe('shellCard()', () => {
  const plain = { stdout: 'a\nb\n', stderr: 'warn\n', interrupted: false, isImage: false }

  test('reads a small plain run as lines', () => {
    expect(shellCard(plain)).toEqual({ stdout: ['a', 'b'], stderr: ['warn'] })
    expect(shellCard({ stdout: '', stderr: '', interrupted: false, noOutputExpected: true })).toEqual({ stdout: [], stderr: [] })
  })

  const refused: [string, unknown][] = [
    ['colour codes', { ...plain, stdout: '\u001b[31mred\u001b[0m' }],
    ['a progress bar', { ...plain, stdout: '10%\r20%' }],
    ['a background task', { ...plain, backgroundTaskId: 'b1' }],
    ['an interrupted run', { ...plain, interrupted: true }],
    ['an image', { ...plain, isImage: true }],
    ['a saved large output', { ...plain, persistedOutputPath: '/tmp/x' }],
    ['many lines', { ...plain, stdout: 'x\n'.repeat(20) }],
    ['a long line', { ...plain, stdout: 'x'.repeat(2000) }],
    ['something else', { content: 'x' }],
  ]
  for (const [name, output] of refused) {
    test(`leaves ${name} to the engine`, () => {
      expect(shellCard(output)).toBeNull()
    })
  }
})

describe('shortPath()', () => {
  const cases: [string, string, string][] = [
    ['/work/alpha/src/app.ts', '/work/alpha', 'src/app.ts'],
    ['/work/alpha/src/app.ts', '/work/alpha/', 'src/app.ts'],
    ['/work/alphabet/x.ts', '/work/alpha', '/work/alphabet/x.ts'],
    ['/etc/hosts', '', '/etc/hosts'],
  ]
  for (const [path, root, shown] of cases) {
    test(`${path} under ${root || '(none)'} is ${shown}`, () => {
      expect(shortPath(path, root)).toBe(shown)
    })
  }
})
