import { describe, expect, test } from 'claude-code/testing'

import { parseOutline, stageList, stageName, stepTitle } from '../hooks/outline'

const STAGED = `# Plan: Add dark mode

## Context
- The app styles everything with CSS variables.
- Users asked for it.

## Phase 1: Build
1. Add the theme tokens
2. **Wire the toggle**: a switch in the header
   - read the saved choice first
   - fall back to the system setting

## Phase 2: Verify
- [ ] Add tests for the toggle
- Update the docs

## Risks
- Contrast in charts
`

describe('parseOutline', () => {
  test('headings become stages and top-level items become steps; context and risks are left out', () => {
    expect(parseOutline(STAGED)).toEqual({
      stages: ['Build', 'Verify'],
      steps: [
        { title: 'Add the theme tokens', stage: 0 },
        { title: 'Wire the toggle', stage: 0 },
        { title: 'Add tests for the toggle', stage: 1 },
        { title: 'Update the docs', stage: 1 },
      ],
    })
  })

  const cases: [string, string, ReturnType<typeof parseOutline>][] = [
    ['a flat list is one stage', '1. First\n2. Second\n3) Third', { stages: [''], steps: [{ title: 'First', stage: 0 }, { title: 'Second', stage: 0 }, { title: 'Third', stage: 0 }] }],
    ['a plan with one working section is flat', '# Plan\n\n## Context\n- why\n\n## Steps\n- Do one\n- Do two', { stages: [''], steps: [{ title: 'Do one', stage: 0 }, { title: 'Do two', stage: 0 }] }],
    ['prose with no list has no steps', '# Plan\n\nJust refactor the thing carefully.', null],
    ['an empty plan', '', null],
    [
      'items inside a code fence are not steps',
      '## Build\n- Real step\n```\n- not a step\n```\n## Ship\n- Another step',
      { stages: ['Build', 'Ship'], steps: [{ title: 'Real step', stage: 0 }, { title: 'Another step', stage: 1 }] },
    ],
    [
      'the shallowest heading level used twice is the stage level',
      '# Plan\n## Implementation\n### Backend\n- Add the endpoint\n### Frontend\n- Call the endpoint\n### Notes\n- not a step',
      { stages: ['Backend', 'Frontend'], steps: [{ title: 'Add the endpoint', stage: 0 }, { title: 'Call the endpoint', stage: 1 }] },
    ],
    [
      'a non-work sub-heading inside a stage hides its items',
      '## Build\n- Add the parser\n### Files to change\n- src/parser.ts\n## Ship\n- Release it',
      { stages: ['Build', 'Ship'], steps: [{ title: 'Add the parser', stage: 0 }, { title: 'Release it', stage: 1 }] },
    ],
    [
      'stages with no steps drop out',
      '## Build\n- One\n## Wait\nNothing here.\n## Ship\n- Two',
      { stages: ['Build', 'Ship'], steps: [{ title: 'One', stage: 0 }, { title: 'Two', stage: 1 }] },
    ],
  ]
  for (const [name, markdown, outline] of cases) {
    test(name, () => {
      expect(parseOutline(markdown)).toEqual(outline)
    })
  }
})

describe('stageName and stepTitle', () => {
  const names: [string, string][] = [
    ['Phase 1: Build the API', 'Build the API'],
    ['Stage 2 - Verify', 'Verify'],
    ['Step 3. Ship', 'Ship'],
    ['1. Setup', 'Setup'],
    ['**Testing**:', 'Testing'],
    ['Phase 2', 'Phase 2'],
  ]
  for (const [heading, name] of names) test(`heading "${heading}"`, () => expect(stageName(heading)).toBe(name))

  const titles: [string, string][] = [
    ['**Wire the toggle**: a switch in the header', 'Wire the toggle'],
    ['Update [the docs](https://example.com/docs).', 'Update the docs'],
    ['Edit `src/app.ts` to export it', 'Edit src/app.ts to export it'],
  ]
  for (const [item, title] of titles) test(`item "${item}"`, () => expect(stepTitle(item)).toBe(title))
})

describe('stageList: a todo list takes the approved plan’s stages', () => {
  const outline = parseOutline(STAGED)

  test('matched titles take their stage; unmatched ones follow the step before them', () => {
    expect(stageList(['Add the theme tokens', 'Wire the toggle', 'Fix lint', 'Add toggle tests', 'Update docs'], outline)).toEqual({
      stages: ['Build', 'Verify'],
      stageOf: [0, 0, 0, 1, 1],
    })
  })

  test('a stage name inside a title places it', () => {
    expect(stageList(['Verify everything works'], outline).stageOf).toEqual([1])
  })

  test('a list that matches nothing stays flat', () => {
    expect(stageList(['Buy milk', 'Walk the dog'], outline)).toEqual({ stages: [''], stageOf: [0, 0] })
  })

  test('no outline is flat', () => {
    expect(stageList(['Anything'], null)).toEqual({ stages: [''], stageOf: [0] })
  })
})
