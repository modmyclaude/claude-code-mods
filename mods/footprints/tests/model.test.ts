// Table-driven tests of the pure rules: paths, git output, shell attribution,
// mark transitions, counts, the tree's rows and the shimmer's frames.
import { describe, expect, test } from 'claude-code/testing'

import type { FootprintsMark as Mark } from '../types'
import {
  applyShell,
  buildRows,
  clean,
  countMarks,
  endEdit,
  headerText,
  looksLikeCommit,
  markRead,
  normalize,
  orNothing,
  parseNulList,
  parsePorcelain,
  relativeTo,
  settleEdits,
  shellChanges,
  shimmerParts,
  startEdit,
  statOrder,
  statusText,
  toAbs,
  type Row,
  type Stat,
} from '../hooks/model'

describe('paths', () => {
  test('normalize folds . and .., doubled and trailing slashes, and resolves against cwd', () => {
    const cases: [string, string, string][] = [
      ['/a/b/c.ts', '/x', '/a/b/c.ts'],
      ['/a/./b//c.ts/', '/x', '/a/b/c.ts'],
      ['/a/b/../c.ts', '/x', '/a/c.ts'],
      ['src/a.ts', '/work/proj', '/work/proj/src/a.ts'],
      ['../other/a.ts', '/work/proj', '/work/other/a.ts'],
      ['/', '/x', '/'],
    ]
    for (const [path, cwd, want] of cases) expect(normalize(path, cwd), path).toBe(want)
  })

  test('relativeTo answers the path under the first root it lies in', () => {
    const cases: [string, string[], string | undefined][] = [
      ['/work/proj/src/a.ts', ['/work/proj'], 'src/a.ts'],
      ['/work/proj', ['/work/proj'], ''],
      ['/work/project/a.ts', ['/work/proj'], undefined], // a sibling with a longer name is not inside
      ['/private/work/proj/a.ts', ['/work/proj', '/private/work/proj'], 'a.ts'],
      ['/elsewhere/a.ts', ['/work/proj'], undefined],
      ['/a.ts', ['/'], 'a.ts'],
    ]
    for (const [abs, roots, want] of cases) expect(relativeTo(abs, roots), abs).toBe(want)
  })

  test('toAbs puts paths under the root in its spelling, others under git top', () => {
    const repo = { root: '/work/proj/app', top: '/private/work/proj', prefix: 'app/' }
    expect(toAbs(repo, 'app/src/a.ts')).toBe('/work/proj/app/src/a.ts')
    expect(toAbs(repo, 'lib/b.ts')).toBe('/private/work/proj/lib/b.ts')
    expect(toAbs({ root: '/r', top: '/r', prefix: '' }, 'x/y')).toBe('/r/x/y')
  })
})

describe('git output', () => {
  test('parsePorcelain reads HEAD and every kind of dirty entry, spaces in paths kept', () => {
    const sha = 'f'.repeat(40)
    const out = [
      `# branch.oid ${sha}`,
      '# branch.head main',
      `1 .M N... 100644 100644 100644 ${'1'.repeat(40)} ${'1'.repeat(40)} src/a.ts`,
      `1 D. N... 100644 000000 000000 ${'1'.repeat(40)} ${'0'.repeat(40)} old file.txt`,
      `2 R. N... 100644 100644 100644 ${'1'.repeat(40)} ${'1'.repeat(40)} R100 new name.ts`,
      'orig name.ts',
      `u UU N... 100644 100644 100644 100644 ${'1'.repeat(40)} ${'2'.repeat(40)} ${'3'.repeat(40)} both.ts`,
      '? notes/todo.md',
      '',
    ].join('\0')
    expect(parsePorcelain(out)).toEqual({
      head: sha,
      dirty: { 'src/a.ts': '.M', 'old file.txt': 'D.', 'new name.ts': 'R.', 'both.ts': 'UU', 'notes/todo.md': '??' },
    })
  })

  test('parsePorcelain says null for HEAD before the first commit', () => {
    expect(parsePorcelain('# branch.oid (initial)\0# branch.head main\0? a\0')).toEqual({ head: null, dirty: { a: '??' } })
  })

  test('parseNulList drops empties and repeats', () => {
    expect(parseNulList('a.ts\0b c.ts\0a.ts\0\0')).toEqual(['a.ts', 'b c.ts'])
    expect(parseNulList('')).toEqual([])
  })

  test('looksLikeCommit finds git ... commit in any simple command of the line', () => {
    const cases: [string, boolean][] = [
      ['git commit -m "fix"', true],
      ['git add -A && git commit -m "fix"', true],
      ['git -C repo commit --amend --no-edit', true],
      ['cd app; /usr/bin/git commit -q', true],
      ['git status', false],
      ['echo commit', false],
      ['gitcommit', false],
      ['git log --oneline | head', false],
      ['npm test && echo done', false],
    ]
    for (const [command, want] of cases) expect(looksLikeCommit(command), command).toBe(want)
  })
})

describe('shell attribution', () => {
  const T = 1_000_000
  const fresh: Stat = { exists: true, mtimeMs: T + 5 }
  const stale: Stat = { exists: true, mtimeMs: T - 60_000 }
  const gone: Stat = { exists: false }
  type Case = [string, Record<string, string>, Record<string, string>, Record<string, Stat>, Record<string, string>]
  const cases: Case[] = [
    ['a clean file the command modified', {}, { a: '.M' }, { a: fresh }, { a: 'edited' }],
    ['a file it created', {}, { n: '??' }, { n: fresh }, { n: 'new' }],
    ['a tracked file it deleted', {}, { d: '.D' }, { d: gone }, { d: 'deleted' }],
    ['an untracked file it deleted', { u: '??' }, {}, { u: gone }, { u: 'deleted' }],
    ['a file already deleted before', { d: '.D' }, { d: '.D' }, { d: gone }, {}],
    ['a dirty file it modified again', { a: '.M' }, { a: '.M' }, { a: fresh }, { a: 'edited' }],
    ['a dirty file it left alone', { a: '.M' }, { a: '.M' }, { a: stale }, {}],
    ['a file it only staged', { a: '.M' }, { a: 'M.' }, { a: stale }, {}],
    ['a file it committed', { a: 'M.' }, {}, { a: stale }, {}],
    ['a file it moved in (git mv keeps the mtime)', {}, { b: 'A.' }, { b: stale }, { b: 'new' }],
    ['a file it reverted (clean after, rewritten)', { a: '.M' }, {}, { a: fresh }, { a: 'edited' }],
    ['a path it could not stat', {}, { a: '.M' }, {}, {}],
    ['a change stamped inside the 1 s slack', {}, { a: '.M' }, { a: { exists: true, mtimeMs: T - 900 } }, { a: 'edited' }],
  ]
  for (const [name, before, after, stats, want] of cases) {
    test(name, () => expect(shellChanges(before, after, stats, T)).toEqual(want))
  }
})

describe('marks', () => {
  test('an edit that failed leaves no trace; one that wrote is edited; a create is new', () => {
    const editing = startEdit(undefined, 't1')
    expect(editing).toEqual({ editing: ['t1'] })
    expect(orNothing(endEdit(editing, 't1', 'failed'))).toBeUndefined()
    expect(endEdit(editing, 't1', 'edited')).toEqual({ edited: true })
    expect(endEdit(editing, 't1', 'created')).toEqual({ edited: true, isNew: true })
  })

  test('two edits in flight on one file shimmer until both end', () => {
    const both = startEdit(startEdit(undefined, 't1'), 't2')
    expect(endEdit(both, 't1', 'edited')).toEqual({ editing: ['t2'], edited: true })
  })

  test('a tool edit clears committed, deleted and shell-only', () => {
    const mark: Mark = { read: true, edited: true, committed: true, deleted: true, viaShell: true }
    expect(endEdit(startEdit(mark, 't'), 't', 'edited')).toEqual({ read: true, edited: true })
  })

  test('a shell change is shell-only unless an edit tool already changed the file', () => {
    expect(applyShell(undefined, 'edited')).toEqual({ edited: true, viaShell: true })
    expect(applyShell({ edited: true }, 'edited')).toEqual({ edited: true })
    expect(applyShell({ read: true }, 'new')).toEqual({ read: true, edited: true, isNew: true, viaShell: true })
    expect(applyShell({ edited: true, committed: true }, 'deleted')).toEqual({ edited: true, deleted: true })
    expect(applyShell({ edited: true, deleted: true, viaShell: true }, 'new')).toEqual({ edited: true, isNew: true, viaShell: true })
    // created this session, then removed again: no trace but the read
    expect(applyShell({ edited: true, isNew: true }, 'deleted')).toEqual({})
    expect(applyShell({ read: true, edited: true, isNew: true, viaShell: true }, 'deleted')).toEqual({ read: true })
  })

  test('a search marks a folder; a read marks a file', () => {
    expect(markRead(undefined, true)).toEqual({ read: true, isDir: true })
    expect(markRead({ edited: true }, false)).toEqual({ edited: true, read: true })
  })

  test('settleEdits drops in-flight edits and the marks they leave empty', () => {
    expect(settleEdits({ a: { editing: ['t'] }, b: { editing: ['t'], read: true }, c: { edited: true } })).toEqual({
      b: { read: true },
      c: { edited: true },
    })
  })
})

describe('counts', () => {
  test('header and status read the counts; deleted and committed show only when there are some', () => {
    const marks: Record<string, Mark> = {
      a: { read: true },
      b: { read: true, edited: true },
      c: { edited: true, isNew: true },
      d: { edited: true, deleted: true },
      e: { edited: true, committed: true },
      f: { read: true, isDir: true }, // a searched folder is not a file read
      g: { editing: ['t'] }, // still running: not yet edited
    }
    expect(countMarks(marks)).toEqual({ read: 2, edited: 4, isNew: 1, deleted: 1, committed: 1 })
    expect(headerText(countMarks(marks))).toBe('read 2 · edited 4 · new 1 · deleted 1 · committed 1')
    expect(headerText(countMarks({}))).toBe('read 0 · edited 0 · new 0')
    expect(statusText(countMarks(marks))).toBe('edited 4')
    expect(statusText(countMarks({ a: { read: true } }))).toBeUndefined()
  })
})

describe('tree rows', () => {
  const show = (rows: Row[]): string[] =>
    rows.map(row => {
      if (row.kind === 'cut') return `cut ${row.count}`
      const pad = '  '.repeat(row.depth)
      if (row.kind === 'hidden') return `${pad}+${row.count}`
      if (row.kind === 'dir') return `${pad}${row.isOpen ? 'v' : '>'} ${row.name}/ ${row.files}`
      return `${pad}${row.name}`
    })
  const big = Array.from({ length: 45 }, (_, i) => `vendor/lib${String(i).padStart(2, '0')}.js`)
  const files = ['src/b.ts', 'src/a.ts', 'README.md', 'docs/guide.md', ...big]
  const full = { touchedOnly: false, maxRows: 400, bigFolder: 40 }

  test('folders first then files, by name; a big untouched folder starts collapsed', () => {
    expect(show(buildRows(files, {}, full))).toEqual(['v docs/ 1', '  guide.md', 'v src/ 2', '  a.ts', '  b.ts', '> vendor/ 45', 'README.md'])
  })

  test('a touched file opens its folders, however big', () => {
    const rows = buildRows(files, { 'vendor/lib07.js': { read: true } }, full)
    expect(show(rows).slice(5, 8)).toEqual(['v vendor/ 45', '  lib00.js', '  lib01.js'])
    const vendor = rows.find(row => row.kind === 'dir' && row.name === 'vendor')
    expect(vendor).toMatchObject({ isTouched: true, isOpen: true })
  })

  test('touched-only collapses untouched folders and folds untouched files into one row', () => {
    const marks: Record<string, Mark> = { 'src/a.ts': { edited: true } }
    expect(show(buildRows(files, marks, { ...full, touchedOnly: true }))).toEqual([
      '> docs/ 1',
      'v src/ 2',
      '  a.ts',
      '  +1',
      '> vendor/ 45',
      '+1',
    ])
  })

  test('touched files the scan did not list still show, and a searched folder opens', () => {
    const marks: Record<string, Mark> = { 'dist/out.js': { deleted: true, edited: true }, lib: { read: true, isDir: true } }
    expect(show(buildRows(['README.md'], marks, full))).toEqual(['v dist/ 1', '  out.js', 'v lib/ 0', 'README.md'])
  })

  test('rows past the cap become one count', () => {
    const many = Array.from({ length: 12 }, (_, i) => `f${String(i).padStart(2, '0')}.txt`)
    const rows = buildRows(many, {}, { ...full, maxRows: 5 })
    expect(rows).toHaveLength(6)
    expect(rows[5]).toEqual({ kind: 'cut', count: 7 })
  })
})

describe('shimmer', () => {
  test('a bright band slides across the name and wraps around', () => {
    const frames = [0, 1, 2, 3, 4, 7, 8].map(phase => shimmerParts('index', phase))
    expect(frames).toEqual([
      ['', '', 'index'],
      ['', 'i', 'ndex'],
      ['', 'in', 'dex'],
      ['', 'ind', 'ex'],
      ['i', 'nde', 'x'],
      ['inde', 'x', ''],
      ['', '', 'index'], // span is length 5 + band 3: frame 8 starts over
    ])
    for (const [head, band, tail] of frames) expect(head + band + tail).toBe('index')
  })
})

describe('clean', () => {
  test('drops ANSI sequences and shows every other control character as U+FFFD', () => {
    const cases: [string, string][] = [
      ['plain name.ts', 'plain name.ts'],
      ['\x1b[31mred\x1b[0m.txt', 'red.txt'],
      ['\x1b]0;title\x07after', 'after'],
      ['\x1b]8;;https://x\x1b\\link', 'link'],
      ['bell\x07.txt', 'bell\uFFFD.txt'],
      ['nul\x00tab\tnl\n', 'nul\uFFFDtab\uFFFDnl\uFFFD'],
      ['del\x7f c1\u0085 csi8\u009b', 'del\uFFFD c1\uFFFD csi8\uFFFD'],
      ['lone esc \x1bc', 'lone esc \uFFFDc'],
      ['ok \u00a0 é ▾', 'ok \u00a0 é ▾'], // printable non-ASCII stays
    ]
    for (const [raw, want] of cases) expect(clean(raw), JSON.stringify(raw)).toBe(want)
  })
})

describe('statOrder', () => {
  test('paths whose status moved come first, then the dirty ones that stayed', () => {
    const before = { old1: '??', old2: '??', a: '.M', gone: '.M' }
    const after = { old1: '??', old2: '??', a: 'M.', b: '.M' }
    expect(statOrder(before, after)).toEqual(['a', 'gone', 'b', 'old1', 'old2'])
    expect(statOrder({}, {})).toEqual([])
  })
})
