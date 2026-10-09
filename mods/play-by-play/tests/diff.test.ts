// Pure logic, table-driven: the line diff, hunks, the git diff reader and
// patch application, step building, the scoreboard and navigation.

import { describe, expect, test } from 'claude-code/testing'

import type { PlayByPlayStep, PlayByPlayTurn } from '../types'
import {
  applyHunks,
  clean,
  countHunks,
  diffLines,
  hunksText,
  parseGitDiff,
  splitLines,
  toHunks,
  unquote,
} from '../hooks/diff'
import { blobHash } from '../hooks/shell'
import {
  addSteps,
  applyEdit,
  editStep,
  jumpList,
  keyAction,
  MAX_STEP_LINES,
  MAX_TURN_STEPS,
  navigate,
  parseBack,
  relPath,
  score,
  stepFromTexts,
  summaryLine,
  writeStep,
} from '../hooks/steps'

const lines = (text: string) => splitLines(text)

describe('diffLines counts', () => {
  const cases: { name: string; a: string; b: string; added: number; removed: number }[] = [
    { name: 'identical', a: 'a\nb\n', b: 'a\nb\n', added: 0, removed: 0 },
    { name: 'empty to text', a: '', b: 'a\nb\nc\n', added: 3, removed: 0 },
    { name: 'text to empty', a: 'a\nb\n', b: '', added: 0, removed: 2 },
    { name: 'one line changed', a: 'a\nb\nc\n', b: 'a\nB\nc\n', added: 1, removed: 1 },
    { name: 'insert in middle', a: 'a\nc\n', b: 'a\nb\nc\n', added: 1, removed: 0 },
    { name: 'delete in middle', a: 'a\nb\nc\n', b: 'a\nc\n', added: 0, removed: 1 },
    { name: 'append and change', a: 'a\nb\nc\n', b: 'a\nB\nc\nd\n', added: 2, removed: 1 },
    { name: 'reorder', a: 'a\nb\nc\n', b: 'c\na\nb\n', added: 1, removed: 1 },
    { name: 'final newline alone', a: 'a\nb', b: 'a\nb\n', added: 0, removed: 0 },
  ]
  for (const one of cases) {
    test(one.name, () => {
      const ops = diffLines(lines(one.a), lines(one.b))
      expect(ops.filter(op => op.type === '+')).toHaveLength(one.added)
      expect(ops.filter(op => op.type === '-')).toHaveLength(one.removed)
      // The script rebuilds both sides.
      expect(ops.filter(op => op.type !== '+').map(op => op.text)).toEqual(lines(one.a))
      expect(ops.filter(op => op.type !== '-').map(op => op.text)).toEqual(lines(one.b))
    })
  }

  test('a middle too large to compare is one exact block', () => {
    const a = Array.from({ length: 50 }, (_, i) => `old ${i}`)
    const b = Array.from({ length: 40 }, (_, i) => `new ${i}`)
    const ops = diffLines(['head', ...a, 'tail'], ['head', ...b, 'tail'], 100)
    expect(ops.filter(op => op.type === '-')).toHaveLength(50)
    expect(ops.filter(op => op.type === '+')).toHaveLength(40)
    expect(ops[0]).toEqual({ type: ' ', text: 'head' })
    expect(ops[ops.length - 1]).toEqual({ type: ' ', text: 'tail' })
  })
})

describe('toHunks', () => {
  test('numbers and context of a single change', () => {
    const before = Array.from({ length: 10 }, (_, i) => `l${i + 1}`)
    const after = [...before]
    after[4] = 'L5'
    const hunks = toHunks(diffLines(before, after))
    expect(hunks).toHaveLength(1)
    expect(hunks[0]).toEqual({
      oldStart: 2,
      oldLines: 7,
      newStart: 2,
      newLines: 7,
      lines: [' l2', ' l3', ' l4', '-l5', '+L5', ' l6', ' l7', ' l8'],
    })
  })

  test('far apart changes make two hunks; near ones merge', () => {
    const before = Array.from({ length: 30 }, (_, i) => `l${i}`)
    const far = [...before]
    far[2] = 'x'
    far[25] = 'y'
    expect(toHunks(diffLines(before, far))).toHaveLength(2)
    const near = [...before]
    near[2] = 'x'
    near[8] = 'y'
    expect(toHunks(diffLines(before, near))).toHaveLength(1)
  })

  test('a new file numbers its empty old side 0', () => {
    const [hunk] = toHunks(diffLines([], ['a', 'b']))
    expect(hunk).toMatchObject({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2 })
    expect(hunksText(toHunks(diffLines([], ['a', 'b']))).text).toBe('@@ -0,0 +1,2 @@\n+a\n+b')
  })

  test('hunks round-trip through text and the parser', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\n'
    const after = 'a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nK\nl\nm\n'
    const text = hunksText(toHunks(diffLines(lines(before), lines(after)))).text
    const [file] = parseGitDiff(`diff --git a/x b/x\n--- a/x\n+++ b/x\n${text}\n`)
    expect(applyHunks(before, file?.hunks ?? [])).toBe(after)
  })
})

describe('hunksText caps', () => {
  test('cuts at a hunk and recounts a first hunk too long alone', () => {
    const hunks = toHunks(diffLines([], Array.from({ length: 10 }, (_, i) => `n${i}`)))
    const cut = hunksText(hunks, 4)
    expect(cut.shown).toBe(4)
    expect(cut.total).toBe(10)
    expect(cut.text.split('\n')[0]).toBe('@@ -0,0 +1,4 @@')
    expect(countHunks(hunks)).toEqual({ added: 10, removed: 0 })
  })

  test('control characters are made safe to draw', () => {
    expect(clean('a\u001b[31mb\r')).toBe('a�[31mb')
    expect(clean('tab\tkept')).toBe('tab\tkept')
  })
})

describe('parseGitDiff', () => {
  // Real `git diff` output (git 2.x), spaces and tabs kept.
  const sample = [
    'diff --git a/b.bin b/b.bin',
    'index 88768ef..3e3315e 100644',
    'Binary files a/b.bin and b/b.bin differ',
    'diff --git a/del.txt b/del.txt',
    'deleted file mode 100644',
    'index 286c5f5..0000000',
    '--- a/del.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-gone',
    'diff --git a/mv.txt b/moved.txt',
    'similarity index 100%',
    'rename from mv.txt',
    'rename to moved.txt',
    'diff --git a/one.txt b/one.txt',
    'index de98044..a7bc997 100644',
    '--- a/one.txt',
    '+++ b/one.txt',
    '@@ -1,3 +1,4 @@ function context',
    ' a',
    '-b',
    '+B',
    ' c',
    '+d',
    'diff --git a/sp ace.txt b/sp ace.txt',
    'index b77b4eb..66455a1 100644',
    '--- a/sp ace.txt\t',
    '+++ b/sp ace.txt\t',
    '@@ -1,2 +1,3 @@',
    ' x',
    ' y',
    '+z',
    '\\ No newline at end of file',
    'diff --git a/empty.txt b/empty.txt',
    'new file mode 100644',
    'index 0000000..e69de29',
    'diff --git "a/we\\tird.txt" "b/we\\tird.txt"',
    'new file mode 100644',
    'index 0000000..1b2c3d4',
    '--- /dev/null',
    '+++ "b/we\\tird.txt"',
    '@@ -0,0 +1 @@',
    '+diff --git a/not b/a-header',
  ].join('\n')
  const files = parseGitDiff(sample)

  const table: { at: number; oldPath: string | null; newPath: string | null; binary: boolean; hunks: number }[] = [
    { at: 0, oldPath: 'b.bin', newPath: 'b.bin', binary: true, hunks: 0 },
    { at: 1, oldPath: 'del.txt', newPath: null, binary: false, hunks: 1 },
    { at: 2, oldPath: 'mv.txt', newPath: 'moved.txt', binary: false, hunks: 0 },
    { at: 3, oldPath: 'one.txt', newPath: 'one.txt', binary: false, hunks: 1 },
    { at: 4, oldPath: 'sp ace.txt', newPath: 'sp ace.txt', binary: false, hunks: 1 },
    { at: 5, oldPath: null, newPath: 'empty.txt', binary: false, hunks: 0 },
    { at: 6, oldPath: null, newPath: 'we\tird.txt', binary: false, hunks: 1 },
  ]
  test('reads every section', () => {
    expect(files).toHaveLength(table.length)
  })
  for (const row of table) {
    test(`section ${row.at}: ${row.newPath ?? row.oldPath}`, () => {
      const file = files[row.at]
      expect(file?.oldPath).toBe(row.oldPath)
      expect(file?.newPath).toBe(row.newPath)
      expect(file?.binary).toBe(row.binary)
      expect(file?.hunks).toHaveLength(row.hunks)
    })
  }

  test('a content line that looks like a header stays content', () => {
    expect(files[6]?.hunks[0]?.lines).toEqual(['+diff --git a/not b/a-header'])
  })

  test('applies hunks and the no-newline marker', () => {
    expect(applyHunks('a\nb\nc\n', files[3]?.hunks ?? [])).toBe('a\nB\nc\nd\n')
    expect(applyHunks('x\ny\n', files[4]?.hunks ?? [])).toBe('x\ny\nz')
    expect(applyHunks('gone\n', files[1]?.hunks ?? [])).toBe('')
  })

  test('unquotes octal and escapes', () => {
    expect(unquote('"a\\303\\251b"')).toBe('aéb')
    expect(unquote('"q\\"t"')).toBe('q"t')
    expect(unquote('plain')).toBe('plain')
  })
})

test('blobHash matches git hash-object', async () => {
  // `printf 'new\n' | git hash-object --stdin`
  expect(await blobHash('new\n')).toBe('3e757656cf36eca53338e520d134963a44f793f8')
  expect(await blobHash('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
})

describe('steps from tool records', () => {
  test('Edit uses the record: whole-file numbers, counts', () => {
    const original = 'one\ntwo\nthree\n'
    const { step, after } = editStep(
      'a.ts',
      { old_string: 'two', new_string: 'TWO\n2' },
      { filePath: '/r/a.ts', oldString: 'two', newString: 'TWO\n2', originalFile: original, replaceAll: false },
    )
    expect(after).toBe('one\nTWO\n2\nthree\n')
    expect(step).toMatchObject({ file: 'a.ts', kind: 'edit', via: 'tool', added: 2, removed: 1 })
    expect(step?.hunks.split('\n')[0]).toBe('@@ -1,3 +1,4 @@')
  })

  test('Edit with no record falls back to its input', () => {
    const { step } = editStep('a.ts', { old_string: 'x\ny', new_string: 'x\nz' }, undefined)
    expect(step).toMatchObject({ added: 1, removed: 1, note: 'line numbers are relative to the edit' })
  })

  test('an Edit held for review changed nothing', () => {
    expect(editStep('a.ts', { old_string: 'a', new_string: 'b' }, { staged: true, originalFile: 'a' }).step).toBeNull()
  })

  test('replace_all and first-only', () => {
    expect(applyEdit('a a a', 'a', 'b', true)).toBe('b b b')
    expect(applyEdit('a a a', 'a', 'b', false)).toBe('b a a')
  })

  test('Write create, overwrite, and an earlier copy too large', () => {
    expect(writeStep('n.ts', { content: 'a\nb\n' }, { type: 'create', content: 'a\nb\n', originalFile: null }).step).toMatchObject({
      kind: 'create',
      added: 2,
      removed: 0,
    })
    expect(
      writeStep('o.ts', { content: 'a\nc\n' }, { type: 'update', content: 'a\nc\n', originalFile: 'a\nb\n' }).step,
    ).toMatchObject({ kind: 'write', added: 1, removed: 1 })
    expect(writeStep('o.ts', { content: 'a\n' }, { type: 'update', content: 'a\n', originalFile: null }).step).toMatchObject({
      kind: 'write',
      hunks: '',
    })
  })

  test('a no-op write is no step', () => {
    expect(stepFromTexts('a', 'x\n', 'x\n', { via: 'tool' })).toBeNull()
  })

  test('a huge change keeps exact counts and a capped drawing', () => {
    const after = Array.from({ length: MAX_STEP_LINES * 2 }, (_, i) => `line ${i}`).join('\n')
    const step = stepFromTexts('big', null, after, { via: 'tool' })
    expect(step?.added).toBe(MAX_STEP_LINES * 2)
    expect(step?.note).toContain(`showing ${MAX_STEP_LINES} of`)
  })
})

describe('turns', () => {
  const step = (file: string, added: number, removed: number): PlayByPlayStep => ({
    file,
    kind: 'edit',
    via: 'tool',
    added,
    removed,
    hunks: '@@ -1 +1 @@\n-a\n+b',
  })
  const turn: PlayByPlayTurn = {
    id: 't',
    prompt: '',
    dropped: 0,
    steps: [step('a.ts', 1, 1), step('b.ts', 30, 2), step('a.ts', 4, 0), step('c.md', 3, 9)],
  }

  test('scoreboard', () => {
    expect(score(turn)).toEqual({
      edits: 4,
      files: 3,
      added: 38,
      removed: 12,
      biggest: { file: 'b.ts', added: 30, removed: 2 },
    })
    expect(summaryLine(turn)).toBe('4 edits · 3 files · +38 −12')
  })

  test('jump list in order of first change', () => {
    expect(jumpList(turn)).toEqual([
      { file: 'a.ts', step: 0 },
      { file: 'b.ts', step: 1 },
      { file: 'c.md', step: 3 },
    ])
  })

  const moves: { name: string; from: number; key: string; to: number }[] = [
    { name: 'next', from: 0, key: 'n', to: 1 },
    { name: 'right arrow', from: 1, key: 'right', to: 2 },
    { name: 'next stops at the end', from: 3, key: 'down', to: 3 },
    { name: 'prev', from: 2, key: 'p', to: 1 },
    { name: 'prev stops at the start', from: 0, key: 'left', to: 0 },
    { name: 'up arrow', from: 3, key: 'up', to: 2 },
    { name: 'jump to file 3', from: 0, key: '3', to: 3 },
    { name: 'jump past the list stays', from: 1, key: '9', to: 1 },
    { name: 'end', from: 0, key: 'end', to: 3 },
    { name: 'home', from: 3, key: 'home', to: 0 },
  ]
  for (const move of moves) {
    test(`navigate: ${move.name}`, () => {
      const nav = keyAction(move.key)
      expect(nav).not.toBeNull()
      if (nav === null) return
      expect(navigate({ back: 1, step: move.from }, nav, turn).step).toBe(move.to)
    })
  }

  test('keys it ignores', () => {
    expect(keyAction('x')).toBeNull()
    expect(keyAction('0')).toBeNull()
    expect(keyAction('return')).toBeNull()
  })

  test('/replay arguments', () => {
    expect(parseBack('')).toBe(1)
    expect(parseBack(' 2 ')).toBe(2)
    expect(parseBack('10')).toBe(10)
    expect(parseBack('11')).toBeNull()
    expect(parseBack('0')).toBeNull()
    expect(parseBack('two')).toBeNull()
  })

  test('the per-turn step cap counts what it drops', () => {
    const many = Array.from({ length: MAX_TURN_STEPS + 3 }, (_, i) => step(`f${i}`, 1, 0))
    const kept = addSteps({ id: 't', prompt: '', steps: [], dropped: 0 }, many)
    expect(kept.steps).toHaveLength(MAX_TURN_STEPS)
    expect(kept.dropped).toBe(3)
    expect(score(kept).edits).toBe(MAX_TURN_STEPS + 3)
  })

  test('paths show relative to the session folder', () => {
    expect(relPath('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
    expect(relPath('/repo/src/a.ts', '/repo/')).toBe('src/a.ts')
    expect(relPath('/elsewhere/a.ts', '/repo')).toBe('/elsewhere/a.ts')
    expect(relPath('/repository/a.ts', '/repo')).toBe('/repository/a.ts')
  })
})
