import { describe, expect, test } from 'claude-code/testing'

import { MAX_DURATIONS, MAX_PROJECTS, priorFor, projectKey, readPace, recordPlan } from '../hooks/history'

describe('projectKey', () => {
  test('is stable, 16 hex digits, and does not spell the path', () => {
    const key = projectKey('/Users/sam/code/shop')
    expect(key).toBe(projectKey('/Users/sam/code/shop'))
    expect(key).toMatch(/^[0-9a-f]{16}$/)
    expect(key).not.toContain('shop')
  })

  test('differs per project', () => {
    expect(projectKey('/work/a')).not.toBe(projectKey('/work/b'))
  })
})

describe('readPace', () => {
  const junk: [string, unknown][] = [
    ['nothing', undefined],
    ['a string', 'oops'],
    ['no projects', { v: 1 }],
    ['a bad key', { projects: { '../etc': { d: [1000], plans: 1, at: 1 } } }],
    ['durations not a list', { projects: { '0123456789abcdef': { d: 'x' } } }],
  ]
  for (const [name, raw] of junk) test(`${name} reads as empty`, () => expect(readPace(raw)).toEqual({ v: 1, projects: {} }))

  test('keeps good durations only', () => {
    const file = readPace({ projects: { '0123456789abcdef': { d: [1000, -5, 'x', Number.NaN, 2000, 1e12], plans: 2, at: 7 } } })
    expect(file.projects['0123456789abcdef']).toEqual({ d: [1000, 2000], plans: 2, at: 7 })
  })
})

describe('recordPlan and priorFor', () => {
  const key = projectKey('/work/app')

  test('adds durations and counts plans; nothing else is stored', () => {
    const file = recordPlan(readPace(undefined), key, [60_000, 90_000], 5)
    expect(file).toEqual({ v: 1, projects: { [key]: { d: [60_000, 90_000], plans: 1, at: 5 } } })
  })

  test(`keeps the last ${MAX_DURATIONS} durations of a project`, () => {
    let file = readPace(undefined)
    for (let plan = 0; plan < 10; plan += 1) file = recordPlan(file, key, [1000, 2000, 3000, 4000, 5000 + plan], plan)
    expect(file.projects[key]?.d).toHaveLength(MAX_DURATIONS)
    expect(file.projects[key]?.d.at(-1)).toBe(5009)
    expect(file.projects[key]?.plans).toBe(10)
  })

  test(`keeps the ${MAX_PROJECTS} most recent projects`, () => {
    let file = readPace(undefined)
    for (let n = 0; n < MAX_PROJECTS + 5; n += 1) file = recordPlan(file, projectKey(`/work/${n}`), [1000], n)
    expect(Object.keys(file.projects)).toHaveLength(MAX_PROJECTS)
    expect(file.projects[projectKey('/work/0')]).toBeUndefined()
    expect(file.projects[projectKey(`/work/${MAX_PROJECTS + 4}`)]).toBeDefined()
  })

  test('history speaks only once it has three step times', () => {
    expect(priorFor(recordPlan(readPace(undefined), key, [1000, 2000], 1), key)).toBeUndefined()
    expect(priorFor(recordPlan(readPace(undefined), key, [1000, 2000, 9000], 1), key)).toEqual({ medianMs: 2000, count: 3 })
    expect(priorFor(readPace(undefined), key)).toBeUndefined()
  })
})
