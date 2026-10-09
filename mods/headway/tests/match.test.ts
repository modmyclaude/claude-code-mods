import { describe, expect, test } from 'claude-code/testing'

import { isSameStep, normalize, pairKeys, pairTitles, words } from '../hooks/match'

describe('normalize and words', () => {
  const cases: [string, string, string[]][] = [
    ['Wire the routes', 'wire the routes', ['wire', 'route']],
    ['  Add `parser` tests!  ', 'add parser tests', ['add', 'parser', 'test']],
    ['Fix: login (OAuth) bug', 'fix login oauth bug', ['fix', 'login', 'oauth', 'bug']],
    ['Update the docs', 'update the docs', ['update', 'doc']],
    ['Pass CSS class', 'pass css class', ['pass', 'css', 'class']],
  ]
  for (const [title, norm, meaningful] of cases) {
    test(`"${title}"`, () => {
      expect(normalize(title)).toBe(norm)
      expect(words(title)).toEqual(meaningful)
    })
  }
})

describe('isSameStep: renamed steps match, different steps do not', () => {
  const cases: [string, string, boolean][] = [
    ['Wire the routes', 'Wire up the routes', true],
    ['Add tests', 'Add the tests', true],
    ['Run the test suite', 'Run tests', true],
    ['Add unit tests', 'Add unit tests for the parser', true],
    ['Update README', 'update readme.', true],
    ['Add tests for the toggle', 'Add toggle tests', true],
    ['Update README', 'Update CHANGELOG', false],
    ['Fix login bug', 'Fix logout bug', false],
    ['Write tests', 'Deploy to staging', false],
    ['Implement API route', 'Implement API client', false],
    ['', '', false],
  ]
  for (const [a, b, same] of cases) {
    test(`"${a}" vs "${b}" -> ${same}`, () => {
      expect(isSameStep(a, b)).toBe(same)
      expect(isSameStep(b, a)).toBe(same)
    })
  }
})

describe('pairTitles', () => {
  test('a rename pairs with its old step; the rest is added and removed', () => {
    const pairing = pairTitles(['Plan the schema', 'Wire the routes', 'Ship it'], ['Plan the schema', 'Wire up the routes', 'Write docs', 'Ship it'])
    expect(pairing.oldOf).toEqual([0, 1, -1, 2])
    expect(pairing.isExact).toEqual([true, false, false, true])
    expect(pairing).toMatchObject({ added: 1, removed: 0, matched: 3 })
  })

  test('a dropped step counts as removed', () => {
    expect(pairTitles(['A first step', 'Second step here', 'Third'], ['A first step', 'Third'])).toMatchObject({ added: 0, removed: 1, matched: 2 })
  })

  test('exact titles win over fuzzy ones, one to one', () => {
    // "Add tests" is exactly the old second step, so it never steals the first.
    const pairing = pairTitles(['Add the tests', 'Add tests'], ['Add tests', 'Add the tests'])
    expect(pairing.oldOf).toEqual([1, 0])
    expect(pairing.isExact).toEqual([true, true])
  })

  test('an unrelated list shares nothing', () => {
    expect(pairTitles(['Plan the schema', 'Ship it'], ['Buy milk', 'Walk the dog'])).toMatchObject({ matched: 0, added: 2, removed: 2 })
  })

  test('reordering is not a change', () => {
    expect(pairTitles(['One step', 'Two steps', 'Three steps'], ['Three steps', 'One step', 'Two steps'])).toMatchObject({ added: 0, removed: 0, matched: 3 })
  })
})

describe('pairKeys', () => {
  const cases: [string[], string[], { added: number; removed: number; matched: number }][] = [
    [['task:1', 'task:2'], ['task:1', 'task:2'], { added: 0, removed: 0, matched: 2 }],
    [['task:1', 'task:2'], ['task:1', 'task:2', 'task:3'], { added: 1, removed: 0, matched: 2 }],
    [['task:1', 'task:2'], ['task:2'], { added: 0, removed: 1, matched: 1 }],
    [['task:1'], ['task:9'], { added: 1, removed: 1, matched: 0 }],
  ]
  for (const [before, after, counts] of cases) {
    test(`${before.join(',')} -> ${after.join(',')}`, () => {
      expect(pairKeys(before, after)).toMatchObject(counts)
    })
  }
})
