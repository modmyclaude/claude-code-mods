// The fold on its own: what stays, how repeats fold, the footer, the estimates.

import { describe, expect, test } from 'claude-code/testing'

import {
  DEFAULTS, HEAD, MAX_LINE, MAX_MIDDLE, TAIL, aboutTokens, clean, clip, foldRuns, likeness, readSettings, rowLine, shortTokens, statusLine,
  trimOutput,
} from '../hooks/logic'

const lines = (n: number, word = 'line') => Array.from({ length: n }, (_, i) => `${word} ${i + 1}`)
const out = (rows: string[]) => `${rows.join('\n')}\n`

describe('what stays', () => {
  test('2,000 lines: the first 15, the last 40 and every error-like line from the middle, a footer, under a fifth of the size', () => {
    const rows = lines(2_000)
    rows[700] = 'src/a.ts(12,5): error TS2345: Argument of type string'
    rows[900] = 'Traceback (most recent call last):'
    rows[1200] = 'WARNING: deprecated option --legacy'
    const stdout = out(rows)
    const t = trimOutput(stdout, DEFAULTS)!
    const kept = t.text.split('\n')
    expect(kept.slice(0, HEAD)).toEqual(rows.slice(0, HEAD))
    for (const line of [...rows.slice(-TAIL), rows[700]!, rows[900]!, rows[1200]!]) expect(kept).toContain(line)
    expect(kept).not.toContain('line 500')
    expect(t.text.length).toBeLessThan(stdout.length / 5)
    expect(t.text.endsWith('\n')).toBe(true)
    expect(kept.at(-2)).toMatch(/^\[trim: 1,942 of 2,000 lines folded, about [\d,]+ tokens saved\. The folded lines were not sent\. /)
    // A re-run is offered only for a command that is safe to repeat; else the person, who sees it all.
    expect(kept.at(-2)).toContain('If the command only reads (a test run, a build, a listing), run it again through grep, sed -n or tail to read a part')
    expect(kept.at(-2)).toContain('never repeat one that changes anything (an install, a migration, a deploy): ask the person, who can see the whole output.]')
    expect(t).toMatchObject({ linesIn: 2_000, folded: 1_942 })
    expect(t.saved).toBe(stdout.length - t.text.length)
  })

  test('test runners\' failure marks are kept from the middle, whatever the exit code', () => {
    const marks = [
      '  ✕ adds two numbers (3 ms)', // Jest
      '  ● math › adds two numbers', // Jest's failure header
      ' × src/sum.test.ts > adds two numbers', // Vitest
      'not ok 3 - adds ✗', // others
      '✘ renders the header',
    ]
    const rows = lines(1_000)
    marks.forEach((mark, i) => (rows[400 + i * 50] = mark))
    const kept = trimOutput(out(rows), DEFAULTS)!.text.split('\n')
    for (const mark of marks) expect(kept).toContain(mark)
  })

  test('output under both limits is left alone', () => {
    expect(trimOutput(out(lines(100)), DEFAULTS)).toBeNull()
    expect(trimOutput(out(lines(DEFAULTS.lines)), DEFAULTS)).toBeNull()
  })

  test('past either limit it folds: many short lines, or a few very long ones', () => {
    expect(trimOutput(out(lines(DEFAULTS.lines + 100)), DEFAULTS)).not.toBeNull()
    const wide = [`${'a'.repeat(9_000)}`, 'b', `${'c'.repeat(9_000)}`]
    const t = trimOutput(out(wide), DEFAULTS)!
    expect(t.text).toContain(`[... ${(9_000 - 1_900).toLocaleString('en-US')} characters folded ...]`)
    expect(t.text.split('\n')[1]).toBe('b')
  })

  test('folding that would save little leaves the output as it is', () => {
    // 200 lines, all error-like and all different: nearly everything stays.
    expect(trimOutput(out(lines(200, 'error at step')), DEFAULTS)).toBeNull()
    // Some saving, but under 1,000 characters: not worth a footer.
    const ok = Array.from({ length: 60 }, (_, i) => `ok step ${String(i).padStart(10, '0')}`)
    const rows = [...lines(HEAD, 'top'), ...lines(100, 'error number'), ...ok, ...lines(TAIL, 'end')]
    expect(trimOutput(out(rows), DEFAULTS)).toBeNull()
  })

  test('two errors at different line numbers are two errors; a repeat word for word is kept once with a count', () => {
    const rows = lines(1_000)
    rows[300] = 'src/a.ts(12,5): error TS2345: bad'
    rows[301] = 'src/a.ts(40,5): error TS2345: bad'
    rows[500] = 'warning: slow test'
    rows[600] = 'warning: slow test'
    rows[700] = 'warning: slow test'
    // Alike by a counter, yet two different errors: both stay.
    rows[800] = 'error: 3/10 shards failed'
    rows[850] = 'error: 7/10 shards failed'
    rows[860] = 'error: 3/10 shards failed'
    const kept = trimOutput(out(rows), DEFAULTS)!.text.split('\n')
    expect(kept).toContain('error: 3/10 shards failed [2 times]')
    expect(kept).toContain('error: 7/10 shards failed')
    expect(kept).toContain('src/a.ts(12,5): error TS2345: bad')
    expect(kept).toContain('src/a.ts(40,5): error TS2345: bad')
    expect(kept).toContain('warning: slow test [3 times]')
    expect(kept.filter(l => l.startsWith('warning: slow test'))).toHaveLength(1)
  })

  test(`past ${MAX_MIDDLE} different error-like lines in the middle, the rest fold`, () => {
    const rows = [...lines(HEAD), ...lines(400, 'error number'), ...lines(TAIL, 'end')]
    const kept = trimOutput(out(rows), DEFAULTS)!.text.split('\n')
    expect(kept.filter(l => l.startsWith('error number'))).toHaveLength(MAX_MIDDLE)
    expect(kept).toContain('[... 250 lines folded ...]')
  })

  test('the person\'s own pattern keeps its lines', () => {
    const rows = lines(1_000)
    rows[444] = 'deploy id: d-123'
    const settings = readSettings({ keep: 'deploy id' })
    expect(trimOutput(out(rows), settings)!.text.split('\n')).toContain('deploy id: d-123')
    expect(trimOutput(out(rows), DEFAULTS)!.text.split('\n')).not.toContain('deploy id: d-123')
  })
})

describe('repeats', () => {
  test('a progress bar of like lines folds to its first line with a count; errors never fold this way', () => {
    expect(foldRuns(['progress 1%', 'progress 2%', 'progress 3%', 'progress 42%', 'done'])).toEqual(['progress 1% [and 3 more like it]', 'done'])
    expect(foldRuns(['a 1', 'a 2', 'a 3'])).toEqual(['a 1', 'a 2', 'a 3'])
    // Alike by their counters, but errors: each stays.
    const errors = ['FAILED shard 1/4', 'FAILED shard 2/4', 'FAILED shard 3/4', 'FAILED shard 4/4']
    expect(foldRuns(errors)).toEqual(errors)
  })

  test('200 progress lines fold inside the kept head and tail', () => {
    const rows = Array.from({ length: 200 }, (_, i) => `Downloading ${i % 100}% (${i}/200)`)
    const text = trimOutput(out(rows), DEFAULTS)!.text
    expect(text).toContain('Downloading 0% (0/200) [and 14 more like it]')
    expect(text).toContain('Downloading 60% (160/200) [and 39 more like it]')
  })

  test('likeness makes percentages and counters alike, and no other number', () => {
    expect(likeness('  12/300 files  42.5%')).toBe('#/# files #%')
    expect(likeness('line 1')).not.toBe(likeness('line 2'))
    expect(likeness('error a')).not.toBe(likeness('error b'))
  })

  test('numbered output is never folded into a count: seq keeps its head and tail line for line', () => {
    const text = trimOutput(out(lines(2_000, 'n')), DEFAULTS)!.text.split('\n')
    expect(text.slice(0, HEAD)).toEqual(lines(HEAD, 'n'))
  })
})

describe('words and settings', () => {
  test('every token figure says about or ~, rounded so it never reads as exact', () => {
    expect([aboutTokens(44_123), aboutTokens(1_234), aboutTokens(8)]).toEqual(['about 11,000', 'about 310', 'about 10'])
    expect([shortTokens(44_123), shortTokens(8_000), shortTokens(1_234)]).toEqual(['~11k', '~2k', '~310'])
    expect(rowLine({ folded: 1_840, saved: 44_000 })).toBe('trim: 1,840 lines folded · ~11k tokens saved')
    expect(statusLine(136_000)).toBe('trim ~34k saved')
  })

  test('settings are clamped, and a pattern that does not compile is left out', () => {
    expect(readSettings({})).toEqual(DEFAULTS)
    expect(readSettings({ lines: 5, chars: 1e12 })).toMatchObject({ lines: 40, chars: 10_000_000 })
    expect(readSettings({ keep: '(' }).keep).toBeUndefined()
    expect(readSettings({ keep: 'x'.repeat(501) }).keep).toBeUndefined()
    expect(readSettings({ keep: 'Deploy' }).keep?.test('deploy id')).toBe(true)
  })

  test('a kept line too long to read is cut in its middle', () => {
    expect(clip('x'.repeat(MAX_LINE))).toBe('x'.repeat(MAX_LINE))
    expect(clip('x'.repeat(5_000))).toMatch(/^x{1400} \[\.\.\. 3,100 characters folded \.\.\.\] x{500}$/)
  })

  test('drawn text loses escapes and control characters', () => {
    expect(clean('\x1b[31mred\x1b[0m\x07 \x1b]0;title\x07ok\tz')).toBe('red� ok  z')
  })
})
