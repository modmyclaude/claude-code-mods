import { describe, expect, test } from 'claude-code/testing'

import { clean, DIFF_CHAR_CAP, DIFF_LINE_CAP, diffCard, shellCard, shortPath } from '../hooks/content'
import {
  formatDuration,
  formatMs,
  isDay,
  parseClock,
  parseWear,
  pinsOf,
  resolveLook,
  SEASONS,
  seasonOf,
  seasonWindow,
  settingsFrom,
  type Settings,
} from '../hooks/look'
import { THEMES } from '../hooks/themes'
import { at, EDIT } from './setup'

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
    ['season', { kind: 'wear', choice: 'season' }],
    ['xmas', { kind: 'wear', choice: 'christmas' }],
    ['fall', { kind: 'wear', choice: 'autumn' }],
    ['spooky', { kind: 'wear', choice: 'halloween' }],
    ['hallo', { kind: 'wear', choice: 'halloween' }],
    ['sp', { kind: 'wear', choice: 'spring' }],
    ['su', { kind: 'wear', choice: 'summer' }],
    ['autu', { kind: 'wear', choice: 'autumn' }],
    ['default', { kind: 'wear', choice: 'default' }],
    ['off', { kind: 'wear', choice: 'default' }],
    ['pin', { kind: 'pin' }],
    ['unpin', { kind: 'unpin' }],
    ['c', { kind: 'unknown', word: 'c' }],
    ['s', { kind: 'unknown', word: 's' }],
    ['a', { kind: 'unknown', word: 'a' }], // auto or autumn
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
  // resolveLook takes the clock reading itself (season needs the date), not a minute of the day.
  const noon = at(12, 0)
  const midnight = at(0, 0)

  test('nothing chosen is Claude Code own look', () => {
    expect(resolveLook({ root: '/a', global: undefined, pins: undefined, now: noon, settings })).toEqual({
      theme: 'default',
      choice: 'default',
      scope: 'global',
      phase: null,
      root: '/a',
    })
  })

  test('the global choice applies where there is no pin', () => {
    const look = resolveLook({ root: '/a', global: 'dracula', pins: { '/b': 'nord' }, now: noon, settings })
    expect(look).toMatchObject({ theme: 'dracula', scope: 'global' })
  })

  test("a project's pin wins over the global choice", () => {
    const look = resolveLook({ root: '/b', global: 'dracula', pins: { '/b': 'nord' }, now: noon, settings })
    expect(look).toMatchObject({ theme: 'nord', choice: 'nord', scope: 'project' })
  })

  test('auto wears the day theme by day and the night theme by night', () => {
    expect(resolveLook({ root: '/a', global: 'auto', pins: {}, now: noon, settings })).toMatchObject({ theme: 'paper', phase: 'day' })
    expect(resolveLook({ root: '/a', global: 'auto', pins: {}, now: midnight, settings })).toMatchObject({ theme: 'nord', phase: 'night' })
  })

  test('season wears what the date calls for, and is stored as the choice', () => {
    const halloween = new Date(2026, 9, 31, 12).getTime()
    expect(resolveLook({ root: '/a', global: 'season', pins: {}, now: halloween, settings })).toEqual({
      theme: 'halloween',
      choice: 'season',
      scope: 'global',
      phase: null,
      root: '/a',
    })
    const july = new Date(2026, 6, 4, 12).getTime()
    expect(resolveLook({ root: '/a', global: 'nord', pins: { '/a': 'season' }, now: july, settings })).toMatchObject({ theme: 'summer', choice: 'season', scope: 'project' })
  })

  test('stored values this version does not know are ignored', () => {
    expect(resolveLook({ root: '/a', global: 'vaporwave', pins: { '/a': 42 }, now: noon, settings }).theme).toBe('default')
    expect(pinsOf(['/a'])).toEqual({})
    expect(pinsOf({ '/a': 'noir', '/b': 'gone' })).toEqual({ '/a': 'noir' })
  })
})

describe('seasonOf()', () => {
  // The table the README documents, at each window's edges. Local dates; the year never matters.
  const cases: [string, number, number, string][] = [
    ['New Year is still Christmas', 1, 1, 'christmas'],
    ['the last day of Christmas', 1, 6, 'christmas'],
    ['the day after is winter, which wears nord', 1, 7, 'nord'],
    ['mid February', 2, 14, 'nord'],
    ['the last of February', 2, 28, 'nord'],
    ['a leap day', 2, 29, 'nord'],
    ['the first of March is spring', 3, 1, 'spring'],
    ['the last of May', 5, 31, 'spring'],
    ['the first of June is summer', 6, 1, 'summer'],
    ['the last of August', 8, 31, 'summer'],
    ['the first of September is autumn', 9, 1, 'autumn'],
    ['the day before Halloween season', 10, 14, 'autumn'],
    ['Halloween season opens', 10, 15, 'halloween'],
    ['Halloween', 10, 31, 'halloween'],
    ['All Saints', 11, 1, 'halloween'],
    ['the day after is autumn again', 11, 2, 'autumn'],
    ['the last of November', 11, 30, 'autumn'],
    ['the first of December is Christmas', 12, 1, 'christmas'],
    ['Christmas Eve', 12, 24, 'christmas'],
    ['New Year Eve', 12, 31, 'christmas'],
  ]
  for (const [name, month, day, theme] of cases) {
    test(`${name} (${month}/${day}) is ${theme}`, () => {
      expect(seasonOf(new Date(2028, month - 1, day, 9, 30).getTime())).toBe(theme) // 2028 has a leap day
      expect(seasonOf(new Date(2027, month - 1, Math.min(day, 28), 23, 59).getTime())).toBe(theme)
    })
  }

  test('every season is a theme with a window in words; every day of a year has one', () => {
    for (const season of SEASONS) {
      expect(THEMES.map(theme => theme.id)).toContain(season.theme)
      expect(seasonWindow(season.theme)).toBe(season.when)
    }
    expect(seasonWindow('dracula')).toBeUndefined()
    const seen = new Set<string>()
    for (let day = 0; day < 366; day++) seen.add(seasonOf(new Date(2028, 0, 1 + day, 12).getTime()))
    expect([...seen].sort()).toEqual(['autumn', 'christmas', 'halloween', 'nord', 'spring', 'summer'])
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

  test('lines and the path are cleaned before they can reach a Text', () => {
    const card = diffCard('Edit', { filePath: 'src/\u0007x\u009b1m.ts', structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['+\tif (a)\u001b[0m\r\u0085'] }] })
    expect(card?.lines[0]?.text).toBe('  if (a)�')
    expect(card?.path).toBe('src/�x.ts')
  })

  const refused: [string, unknown][] = [
    ['no result', undefined],
    ['a text result', 'File written'],
    ['no patch', { filePath: 'x', structuredPatch: [] }],
    ['an edit held for review', { ...EDIT, staged: true }],
    ['a line that is not a diff line', { filePath: 'x', structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['?what'] }] }],
    ['a hunk without numbers', { filePath: 'x', structuredPatch: [{ lines: ['+a'] }] }],
    ['binary content (NUL)', { filePath: 'x', structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['+PNG\u0000\u0001'] }] }],
    ['a diff too wide to draw whole', { filePath: 'x', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [`+${'x'.repeat(DIFF_CHAR_CAP + 1)}`] }] }],
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
    expect(shellCard({ ...plain, stdout: '\u001b[32mok\u001b[0m\n\u009b1mbold\n' })).toEqual({ stdout: ['ok', 'bold'], stderr: ['warn'] })
    expect(shellCard({ stdout: '', stderr: '', interrupted: false, noOutputExpected: true })).toEqual({ stdout: [], stderr: [] })
  })

  const refused: [string, unknown][] = [
    ['a progress bar (CR)', { ...plain, stdout: '10%\r20%' }],
    ['binary output (NUL)', { ...plain, stdout: 'PK\u0000\u0003' }],
    ['a bell (BEL)', { ...plain, stderr: 'done\u0007' }],
    ['a delete (DEL)', { ...plain, stdout: 'a\u007fb' }],
    ['a C1 control (NEL)', { ...plain, stdout: 'a\u0085b' }],
    ['a lone escape', { ...plain, stdout: 'a\u001b' }],
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

describe('clean()', () => {
  const cases: [string, string, string][] = [
    ['ANSI colour', 'a\u001b[31mred\u001b[0m', 'ared'],
    ['8-bit CSI', 'a\u009b1mb', 'ab'],
    ['OSC hyperlink', '\u001b]8;;https://x\u0007link\u001b]8;;\u0007', 'link'],
    ['two-character escape', 'a\u001bcb', 'ab'],
    ['lone escape at the end', 'a\u001b', 'a�'],
    ['BEL', 'a\u0007b', 'a�b'],
    ['NUL', 'a\u0000b', 'a�b'],
    ['DEL', 'a\u007fb', 'a�b'],
    ['C1 NEL', 'a\u0085b', 'a�b'],
    ['C1 top', 'a\u009fb', 'a�b'],
    ['newline in one line', 'a\nb', 'a�b'],
    ['tab', '\tx', '  x'],
    ['carriage return', 'x\r', 'x'],
    ['plain text and accents', 'café ✓', 'café ✓'],
  ]
  for (const [name, input, output] of cases) {
    test(name, () => {
      expect(clean(input)).toBe(output)
    })
  }
})
