// Table-driven tests for screenshot planning: argv, sizes and the rm -rf allow-list.

import { describe, expect, test } from 'claude-code/testing'

import { chromeArgv, fitBox, isRemovable, isRunDir, lastLine, shotSize, tempRoot, WRITTEN } from '../hooks/shot'

test('chromeArgv: headless, throwaway profile, viewport, screenshot path, URL last', () => {
  expect(
    chromeArgv('/usr/bin/chromium', {
      dir: '/tmp/porthole.abc123',
      size: { width: 390, height: 844 },
      url: 'http://localhost:5173/',
    }),
  ).toEqual([
    '/usr/bin/chromium',
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--use-mock-keychain',
    '--force-device-scale-factor=1',
    '--timeout=15000',
    '--user-data-dir=/tmp/porthole.abc123/profile',
    '--window-size=390,844',
    '--screenshot=/tmp/porthole.abc123/shot.png',
    'http://localhost:5173/',
  ])
})

describe('shotSize', () => {
  const cases: Array<[string, Parameters<typeof shotSize>, { width: number; height: number }]> = [
    ['mobile is a phone', ['mobile'], { width: 390, height: 844 }],
    ['mobile ignores the pane', ['mobile', { columns: 200, rows: 10 }], { width: 390, height: 844 }],
    ['desktop before any pane was measured', ['desktop'], { width: 1280, height: 800 }],
    ['desktop fills a square-ish dock', ['desktop', { columns: 80, rows: 40 }], { width: 1280, height: 1280 }],
    ['desktop in a wide, short pane stays at least 480 tall', ['desktop', { columns: 200, rows: 10 }], { width: 1280, height: 480 }],
    ['desktop in a tall, narrow pane is capped at 4096', ['desktop', { columns: 10, rows: 200 }], { width: 1280, height: 4096 }],
  ]
  for (const [name, args, expected] of cases) {
    test(name, () => {
      expect(shotSize(...args)).toEqual(expected)
    })
  }
})

describe('fitBox keeps the picture unstretched inside the room', () => {
  const cases: Array<[string, Parameters<typeof fitBox>, { columns: number; rows: number }]> = [
    ['1280x800 in 80x40: full width', [{ width: 1280, height: 800 }, { columns: 80, rows: 40 }], { columns: 80, rows: 25 }],
    ['1280x1280 in 80x40: exactly fills', [{ width: 1280, height: 1280 }, { columns: 80, rows: 40 }], { columns: 80, rows: 40 }],
    ['390x844 in 80x40: full height', [{ width: 390, height: 844 }, { columns: 80, rows: 40 }], { columns: 37, rows: 40 }],
    ['clamped to 255 cells', [{ width: 1000, height: 10 }, { columns: 900, rows: 900 }], { columns: 255, rows: 1 }],
    ['never below one cell', [{ width: 1280, height: 800 }, { columns: 0, rows: -3 }], { columns: 1, rows: 1 }],
  ]
  for (const [name, args, expected] of cases) {
    test(name, () => {
      expect(fitBox(...args)).toEqual(expected)
    })
  }
})

describe('the rm -rf allow-list', () => {
  const root = '/var/folders/xy/T'
  const cases: Array<[string, boolean]> = [
    [`${root}/porthole.Ab3dE9`, true],
    [`${root}/porthole.Ab3dE9/profile`, true],
    [`${root}/porthole.Ab3dE9/shot.png`, false],
    [`${root}/porthole.Ab3`, false], // too short to be mktemp's
    [`${root}/porthole.Ab3dE9/../..`, false],
    [`${root}/porthole.`, false],
    [`${root}/other.Ab3dE9`, false],
    [`${root}`, false],
    ['/', false],
    [`/tmp/porthole.Ab3dE9`, false], // another root
    [`${root}/porthole.Ab3dE9/profile/../../x`, false],
  ]
  for (const [path, expected] of cases) {
    test(`${path} -> ${expected}`, () => {
      expect(isRemovable(path, root)).toBe(expected)
    })
  }
  test('isRunDir accepts only the folder itself', () => {
    expect(isRunDir(`${root}/porthole.Ab3dE9`, root)).toBe(true)
    expect(isRunDir(`${root}/porthole.Ab3dE9/profile`, root)).toBe(false)
  })
})

test('tempRoot: TMPDIR without its slash, /tmp otherwise', () => {
  expect(tempRoot('/var/folders/xy/T/')).toBe('/var/folders/xy/T')
  expect(tempRoot(undefined)).toBe('/tmp')
  expect(tempRoot('relative/dir')).toBe('/tmp')
})

test('lastLine strips Chrome log prefixes', () => {
  expect(lastLine('[1:2:1008/1.2:ERROR:x.cc:1] Missing X server or $DISPLAY\n\n')).toBe('Missing X server or $DISPLAY')
  expect(lastLine('')).toBe('')
})

test('WRITTEN matches the line Chrome prints once the PNG is on disk', () => {
  expect(WRITTEN.test('22337 bytes written to file /tmp/porthole.x/shot.png')).toBe(true)
  expect(WRITTEN.test('Written to file shot.png.')).toBe(true)
  expect(WRITTEN.test('[ERROR] CVDisplayLinkCreateWithCGDisplay failed')).toBe(false)
})
