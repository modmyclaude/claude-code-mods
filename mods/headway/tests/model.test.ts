import { describe, expect, test } from 'claude-code/testing'

import type { HeadwayRun } from '../types'
import {
  COALESCE_MS,
  EMPTY_RUN,
  FLASH_MS,
  QUIET_TURNS,
  REVISE_MS,
  bandView,
  barCells,
  fit,
  layoutBand,
  planNow,
  reduce,
  wantsTimer,
  width,
  type BandView,
  type Effect,
  type HeadwayEvent,
  type Item,
} from '../hooks/model'
import { eventFromTool } from '../hooks/sources'

const M = 60_000
const T0 = 1_000_000

/** Runs events in order, each at its wall time; returns the run and every effect. */
function play(steps: readonly [number, HeadwayEvent][], from: HeadwayRun = EMPTY_RUN): { run: HeadwayRun; effects: Effect[] } {
  let run = from
  const effects: Effect[] = []
  for (const [wall, event] of steps) {
    const out = reduce(run, event, wall)
    run = out.run
    effects.push(...out.effects)
  }
  return { run, effects }
}

function todo(titles: readonly string[], done: number): HeadwayEvent {
  const items: Item[] = titles.map((title, index) => ({ title, status: index < done ? 'done' : index === done ? 'active' : 'pending' }))
  return { kind: 'todos', items }
}

const SIX = ['Plan the schema', 'Write the migration', 'Wire the routes', 'Add tests', 'Update docs', 'Ship it']

describe('the plan clock counts working time only', () => {
  test('it pauses between turns and resumes with the next', () => {
    const { run } = play([
      [T0, { kind: 'turn', isRunning: true }],
      [T0 + 2 * M, { kind: 'turn', isRunning: false }],
      [T0 + 60 * M, { kind: 'turn', isRunning: true }],
    ])
    expect(planNow(run.clock, T0 + 61 * M)).toBe(3 * M)
  })

  test('a running subagent keeps it going after the main turn ends', () => {
    const { run } = play([
      [T0, { kind: 'turn', isRunning: true }],
      [T0, { kind: 'agent-start', id: 'a1' }],
      [T0 + M, { kind: 'turn', isRunning: false }],
      [T0 + 3 * M, { kind: 'agent-end', id: 'a1' }],
    ])
    expect(planNow(run.clock, T0 + 10 * M)).toBe(3 * M)
  })

  test('idle time never makes a step look slow', () => {
    const { run } = play([
      [T0, { kind: 'turn', isRunning: true }],
      [T0, todo(SIX, 0)],
      [T0 + M, { kind: 'turn', isRunning: false }],
      [T0 + 90 * M, { kind: 'turn', isRunning: true }],
      [T0 + 91 * M, todo(SIX, 1)],
    ])
    expect(run.plan?.steps[0]?.ms).toBe(2 * M)
  })
})

describe('steps and their times', () => {
  test('a step’s time is the span since the previous completion', () => {
    const { run } = play([
      [T0, todo(SIX, 0)],
      [T0 + M, todo(SIX, 1)],
      [T0 + 3 * M, todo(SIX, 2)],
    ])
    expect(run.plan?.steps.map(step => step.ms)).toEqual([M, 2 * M, undefined, undefined, undefined, undefined])
    expect(run.durations).toEqual([M, 2 * M])
  })

  test('steps finished together share the span', () => {
    const { run } = play([
      [T0, todo(SIX, 0)],
      [T0 + 4 * M, todo(SIX, 2)],
    ])
    expect(run.plan?.steps.slice(0, 2).map(step => step.ms)).toEqual([2 * M, 2 * M])
  })

  test(`completions under ${COALESCE_MS}ms apart (parallel calls) share the span too`, () => {
    const tasks = (done: number[]): HeadwayEvent => ({
      kind: 'task-list',
      items: [1, 2, 3].map(n => ({ key: `task:${n}`, title: `Task ${n}`, status: done.includes(n) ? 'done' : 'pending' })),
    })
    const { run } = play([
      [T0, tasks([])],
      [T0 + 4 * M, tasks([1])],
      [T0 + 4 * M + 500, tasks([1, 2])],
    ])
    expect(run.plan?.steps.map(step => step.ms)).toEqual([2 * M + 250, 2 * M + 250, undefined])
    expect(run.durations).toEqual([2 * M + 250, 2 * M + 250])
  })

  test('steps already done when the list first appears have no time', () => {
    const { run } = play([[T0, todo(SIX, 3)]])
    expect(run.plan?.steps.every(step => step.ms === undefined)).toBe(true)
    expect(run.durations).toEqual([])
  })

  test('a list that is all done at first sight is not drawn and never finishes', () => {
    const { run, effects } = play([[T0, todo(SIX, 6)]])
    expect(bandView(run, T0)).toBeNull()
    expect(effects.some(effect => effect.kind === 'finished')).toBe(false)
  })
})

describe('plans that change', () => {
  test('a renamed done step stays done; the change is flashed as +added and −removed', () => {
    const renamed = ['Plan the schema', 'Write the DB migration', 'Wire the routes', 'Add tests', 'Ship it', 'Announce it']
    const { run } = play([
      [T0, todo(SIX, 0)],
      [T0 + M, todo(SIX, 2)],
      // The rewrite marks the renamed step pending by mistake; it stays done.
      [T0 + 2 * M, { kind: 'todos', items: renamed.map((title, index) => ({ title, status: index === 0 ? 'done' : index === 2 ? 'active' : 'pending' })) }],
    ])
    expect(run.plan?.steps.map(step => step.status)).toEqual(['done', 'done', 'active', 'pending', 'pending', 'pending'])
    expect(run.plan?.steps[1]?.ms).toBe(M / 2)
    expect(run.plan?.revised).toEqual({ added: 1, removed: 1, until: T0 + 2 * M + REVISE_MS })
    const view = bandView(run, T0 + 2 * M)
    expect(view?.kind === 'progress' && view.note).toBe('plan revised +1 −1')
    expect(bandView(run, T0 + 2 * M + REVISE_MS)).not.toHaveProperty('note')
  })

  test('an exact title trusts the new status: a deliberate reopen', () => {
    const { run } = play([
      [T0, todo(SIX, 0)],
      [T0 + M, todo(SIX, 2)],
      [T0 + 2 * M, todo(SIX, 1)],
    ])
    expect(run.plan?.steps[1]).toMatchObject({ status: 'active' })
    expect(run.plan?.steps[1]?.ms).toBeUndefined()
  })

  // Siblings read alike letter by letter (0.88 and 0.81) but share too few words (0.5).
  const siblings: [string, string][] = [
    ['Write tests for the API', 'Write tests for the UI'],
    ['Migrate users table', 'Migrate orders table'],
  ]
  for (const [finished, sibling] of siblings) {
    test(`a sibling ("${sibling}") does not inherit the done of "${finished}"`, () => {
      const { run } = play([
        [T0, todo([finished, 'Ship it'], 0)],
        [T0 + M, todo([finished, 'Ship it'], 1)],
        [T0 + 2 * M, { kind: 'todos', items: [{ title: sibling, status: 'active' }, { title: 'Ship it', status: 'pending' }] }],
      ])
      expect(run.plan?.steps.map(step => [step.title, step.status])).toEqual([
        [sibling, 'active'],
        ['Ship it', 'pending'],
      ])
    })
  }

  test('changes before any work begins are not a revision', () => {
    const { run } = play([
      [T0, { kind: 'todos', items: SIX.map(title => ({ title, status: 'pending' })) }],
      [T0 + 1000, { kind: 'todos', items: [...SIX, 'Celebrate'].map(title => ({ title, status: 'pending' })) }],
    ])
    expect(run.plan?.revised).toBeUndefined()
    expect(run.plan?.steps).toHaveLength(7)
  })

  test('a list with nothing in common starts a new plan', () => {
    const { run } = play([
      [T0, todo(SIX, 2)],
      [T0 + M, todo(['Buy milk', 'Walk the dog'], 0)],
    ])
    expect(run.plan?.id).toBe(2)
    expect(run.plan?.steps.map(step => step.title)).toEqual(['Buy milk', 'Walk the dog'])
    expect(run.plan?.revised).toBeUndefined()
  })

  test('an emptied list ends the plan quietly', () => {
    const { run, effects } = play([
      [T0, todo(SIX, 2)],
      [T0 + M, { kind: 'todos', items: [] }],
    ])
    expect(run.plan).toBeNull()
    expect(effects.filter(effect => effect.kind === 'receipt')).toEqual([])
  })
})

describe('a plan Claude stops updating', () => {
  const turn = (wall: number): [number, HeadwayEvent][] => [
    [wall, { kind: 'turn', isRunning: true }],
    [wall + M, { kind: 'turn', isRunning: false }],
  ]
  const started = play([[T0, { kind: 'turn', isRunning: true }], [T0, todo(SIX, 2)], [T0 + M, { kind: 'turn', isRunning: false }]])

  test(`leaves quietly after ${QUIET_TURNS} turns with no plan update`, () => {
    const once = play(turn(T0 + 2 * M), started.run)
    expect(once.run.plan?.steps).toHaveLength(6)
    const twice = play(turn(T0 + 4 * M), once.run)
    expect(twice.run.plan).toBeNull()
    expect(twice.run.quiet).toBe(0)
    expect(twice.effects).toEqual([])
  })

  test('any plan update in between starts the count again', () => {
    const { run } = play([...turn(T0 + 2 * M).slice(0, 1), [T0 + 2.5 * M, todo(SIX, 3)], ...turn(T0 + 2 * M).slice(1), ...turn(T0 + 4 * M)], started.run)
    expect(run.plan?.steps.filter(step => step.status === 'done')).toHaveLength(3)
    expect(run.quiet).toBe(1)
  })

  test('nothing to leave behind, nothing counted (no state write per turn)', () => {
    const idle = reduce(EMPTY_RUN, { kind: 'turn', isRunning: true }, T0).run
    expect(idle.quiet).toBe(0)
    const busy = reduce(idle, { kind: 'turn', isRunning: false }, T0 + M).run
    expect(reduce(busy, { kind: 'turn', isRunning: true }, T0 + 2 * M).run.quiet).toBe(0)
  })
})

describe('finishing', () => {
  const finished = play([
    [T0, { kind: 'turn', isRunning: true }],
    [T0, todo(SIX, 0)],
    [T0 + M, todo(SIX, 1)],
    [T0 + 2 * M, todo(SIX, 2)],
    [T0 + 5 * M, todo(SIX, 6)],
  ])

  test('the plan turns done, the outline is spent and the "finished" effect carries counts only', () => {
    expect(finished.run.plan).toMatchObject({ finishedAt: T0 + 5 * M, totalMs: 5 * M, firstEstimateMs: 6 * M })
    const effect = finished.effects.find(one => one.kind === 'finished')
    expect(effect).toEqual({
      kind: 'finished',
      done: { seq: 1, at: T0 + 5 * M, totalMs: 5 * M, steps: 6, stageMs: [5 * M], estimateMs: 6 * M },
      durations: [M, M, 45_000, 45_000, 45_000, 45_000],
    })
    expect(JSON.stringify(effect)).not.toContain('schema')
  })

  test('the green flash holds the plan, then it leaves and the receipt is toasted once', () => {
    const during = reduce(finished.run, { kind: 'tick' }, T0 + 5 * M + FLASH_MS - 1)
    expect(during.run.plan?.finishedAt).toBeDefined()
    expect(during.effects).toEqual([])
    const after = reduce(during.run, { kind: 'tick' }, T0 + 5 * M + FLASH_MS)
    expect(after.run.plan).toBeNull()
    expect(after.effects).toEqual([{ kind: 'receipt', text: 'Plan done in 5m, 1m ahead of estimate. 6 steps.' }])
    expect(reduce(after.run, { kind: 'tick' }, T0 + 6 * M).effects).toEqual([])
  })

  test('a new plan during the flash still gets the old receipt', () => {
    const next = reduce(finished.run, todo(['Buy milk'], 0), T0 + 5 * M + 1000)
    expect(next.effects.filter(effect => effect.kind === 'receipt')).toHaveLength(1)
    expect(next.run.plan?.steps[0]?.title).toBe('Buy milk')
  })

  test('hidden: no flash, the receipt comes at once', () => {
    const hidden = play([
      [T0, { kind: 'hidden', hidden: true }],
      [T0, todo(SIX, 0)],
      [T0 + M, todo(SIX, 6)],
    ])
    expect(hidden.run.plan).toBeNull()
    expect(hidden.effects.filter(effect => effect.kind === 'receipt')).toHaveLength(1)
  })
})

describe('the one timer', () => {
  const working = play([
    [T0, { kind: 'turn', isRunning: true }],
    [T0, todo(SIX, 1)],
  ]).run
  const cases: [string, HeadwayRun, boolean][] = [
    ['no plan', EMPTY_RUN, false],
    ['a plan while Claude works', working, true],
    ['a plan while idle', reduce(working, { kind: 'turn', isRunning: false }, T0 + M).run, false],
    ['a plan while hidden', reduce(working, { kind: 'hidden', hidden: true }, T0 + M).run, false],
    ['the done flash, even when idle', play([[T0, todo(SIX, 0)], [T0 + M, todo(SIX, 6)], [T0 + M, { kind: 'turn', isRunning: false }]]).run, true],
    ['an approved plan with nothing to count', reduce(EMPTY_RUN, { kind: 'outline', outline: { stages: [''], steps: [{ title: 'A', stage: 0 }] } }, T0).run, false],
  ]
  for (const [name, run, wants] of cases) test(`${name} -> ${wants}`, () => expect(wantsTimer(run, T0 + M)).toBe(wants))
})

describe('the band line', () => {
  function at(minutes: number[], wall: number): BandView | null {
    const steps: [number, HeadwayEvent][] = [
      [T0, { kind: 'turn', isRunning: true }],
      [T0, todo(SIX, 0)],
    ]
    minutes.forEach((minute, index) => steps.push([T0 + minute * M, todo(SIX, index + 1)]))
    return bandView(play(steps).run, wall)
  }

  test('no time left before two steps finish', () => {
    expect(at([1], T0 + M)).not.toHaveProperty('right')
  })

  test('time left from the median once two have finished', () => {
    expect(at([1, 2], T0 + 2 * M)).toMatchObject({ title: 'Wire the routes', done: 2, total: 6, right: '~4m left', tone: 'normal' })
    expect(at([1, 2], T0 + 2.5 * M)).toMatchObject({ right: '~4m left' })
    expect(at([1, 2, 3, 4, 5], T0 + 5.5 * M)).toMatchObject({ right: '<1m left' })
  })

  test('"estimating..." when the step times vary too much', () => {
    expect(at([0.1, 2], T0 + 2 * M)).toMatchObject({ right: 'estimating...' })
  })

  test('amber past three times the estimate, saying how long it has run', () => {
    expect(at([1, 2], T0 + 5 * M)).toMatchObject({ right: '~3m left', tone: 'normal' })
    expect(at([1, 2], T0 + 5 * M + 1000)).toMatchObject({ right: '3m 1s on this step', tone: 'long' })
  })

  test('the spec’s line, laid out', () => {
    const view: BandView = { kind: 'progress', stage: 'Build', title: 'Wire the routes', done: 2, total: 6, tone: 'normal', right: '~3m left', agents: 0 }
    expect(layoutBand(view, 100).map(part => part.text).join('')).toBe('Build · Wire the routes (2/6) ▰▰▱▱▱▱ ~3m left')
  })

  const widths: [number, string][] = [
    [100, 'Build · Wire the routes (2/6) ▰▰▱▱▱▱ ~3m left · plan revised +1 · 3 agents'],
    [70, 'Wire the routes (2/6) ▰▰▱▱▱▱ ~3m left · plan revised +1 · 3 agents'],
    [60, 'Wire the routes (2/6) ▰▰▱▱▱▱ ~3m left'],
    [30, 'Wire the routes (2/6) ~3m left'],
    [25, 'Wire the … (2/6) ~3m left'],
  ]
  for (const [columns, line] of widths) {
    test(`stays one line in ${columns} columns`, () => {
      const view: BandView = { kind: 'progress', stage: 'Build', title: 'Wire the routes', done: 2, total: 6, tone: 'normal', right: '~3m left', note: 'plan revised +1', agents: 3 }
      const text = layoutBand(view, columns).map(part => part.text).join('')
      expect(text).toBe(line)
      expect([...text].length).toBeLessThanOrEqual(columns)
    })
  }

  // A very narrow band gives up the time left, then the count, before the title shrinks to nothing.
  const narrow: [number, string][] = [
    [20, 'Wire the rout… (2/6)'],
    [12, 'Wire … (2/6)'],
    [8, 'Wire th…'],
  ]
  for (const [columns, line] of narrow) {
    test(`a ${columns}-column band still fits`, () => {
      const view: BandView = { kind: 'progress', title: 'Wire the routes', done: 2, total: 6, tone: 'normal', right: '~3m left', agents: 0 }
      const text = layoutBand(view, columns).map(part => part.text).join('')
      expect(text).toBe(line)
      expect([...text].length).toBeLessThanOrEqual(columns)
    })
  }

  const bars: [number, number, { on: number; off: number }][] = [
    [0, 6, { on: 0, off: 6 }],
    [2, 6, { on: 2, off: 4 }],
    [6, 6, { on: 6, off: 0 }],
    [5, 20, { on: 3, off: 7 }],
    [0, 0, { on: 0, off: 1 }],
  ]
  for (const [done, total, cells] of bars) test(`bar ${done}/${total}`, () => expect(barCells(done, total)).toEqual(cells))
})

describe('terminal cells, not code points', () => {
  const ch = (code: number) => String.fromCodePoint(code)
  // Counted here on their own: kana and CJK ideographs take two cells, everything else in these titles one.
  const cellsOf = (text: string) => [...text].reduce((sum, char) => sum + (/[\u3040-\u30ff\u4e00-\u9fff]/u.test(char) ? 2 : 1), 0)

  const widths: [string, string, number][] = [
    ['ASCII', 'Wire the routes', 15],
    ['kana', '\u30eb\u30fc\u30c8', 6],
    ['Hangul', '\ud55c\uad6d', 4],
    ['fullwidth', '\uff21\uff22', 4],
    ['an emoji', `${ch(0x1f680)} ship`, 7],
    ['a combining accent', `e${ch(0x301)}`, 1],
    ['the line marks', '\u25b0\u25b1\u00b7\u2026\u2212', 5],
  ]
  for (const [name, text, cells] of widths) test(`${name} takes ${cells} cells`, () => expect(width(text)).toBe(cells))

  test('fit cuts wide text by cells, never past the room', () => {
    expect(fit('\u30eb\u30fc\u30c6\u30a3\u30f3\u30b0', 7)).toBe('\u30eb\u30fc\u30c6\u2026')
    expect(fit('\u30eb\u30fc\u30c6\u30a3\u30f3\u30b0', 6)).toBe('\u30eb\u30fc\u2026')
    expect(fit('\u30eb\u30fc', 4)).toBe('\u30eb\u30fc')
  })

  for (const columns of [60, 40, 24, 12]) {
    test(`a CJK title stays one line in ${columns} columns`, () => {
      const title = '\u30eb\u30fc\u30c6\u30a3\u30f3\u30b0\u3092\u914d\u7dda\u3057\u3066\u30c6\u30b9\u30c8\u3092\u8ffd\u52a0\u3057\u3001\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8\u3092\u66f4\u65b0\u3059\u308b'
      const view: BandView = { kind: 'progress', stage: '\u30d3\u30eb\u30c9', title, done: 2, total: 6, tone: 'normal', right: '~3m left', agents: 2 }
      const text = layoutBand(view, columns).map(part => part.text).join('')
      expect(cellsOf(text)).toBeLessThanOrEqual(columns)
      expect(text).toContain('\u30eb\u30fc')
    })
  }
})

describe('subagents and tasks', () => {
  test('the chip counts running subagents only', () => {
    const { run } = play([
      [T0, { kind: 'agent-start', id: 'a' }],
      [T0, { kind: 'agent-start', id: 'b' }],
      [T0, { kind: 'agent-start', id: 'b' }],
      [T0, { kind: 'agent-end', id: 'a' }],
      // An end seen before its start never counts.
      [T0, { kind: 'agent-end', id: 'c' }],
      [T0, { kind: 'agent-start', id: 'c' }],
    ])
    expect(run.agents).toEqual(['b'])
  })

  test('task updates apply by id; a deleted task is a revision', () => {
    const { run } = play([
      [T0, { kind: 'task-create', id: '1', title: 'Plan the schema' }],
      [T0, { kind: 'task-create', id: '2', title: 'Write the migration' }],
      [T0, { kind: 'task-create', id: '3', title: 'Ship it' }],
      [T0 + M, { kind: 'task-update', id: '1', isMain: true, status: 'done' }],
      [T0 + M, { kind: 'task-update', id: '2', isMain: true, title: 'Write the DB migration', status: 'active' }],
      [T0 + M, { kind: 'task-update', id: '99', isMain: true, status: 'done' }],
      [T0 + 2 * M, { kind: 'task-update', id: '3', isMain: false, status: 'deleted' }],
    ])
    expect(run.plan?.steps.map(step => [step.title, step.status])).toEqual([
      ['Plan the schema', 'done'],
      ['Write the DB migration', 'active'],
    ])
    expect(run.plan?.revised).toMatchObject({ added: 0, removed: 1 })
  })
})

describe('eventFromTool reads each source on its own', () => {
  test('TodoWrite', () => {
    expect(eventFromTool('TodoWrite', { todos: [{ content: 'Wire `routes`', status: 'in_progress', activeForm: 'Wiring' }] }, {}, true)).toEqual({
      kind: 'todos',
      items: [{ title: 'Wire routes', status: 'active' }],
    })
  })

  test('TaskCreate, TaskUpdate and TaskList', () => {
    expect(eventFromTool('TaskCreate', { subject: 'Ship it', description: 'x' }, { task: { id: '7', subject: 'Ship it' } }, true)).toEqual({ kind: 'task-create', id: '7', title: 'Ship it' })
    expect(eventFromTool('TaskUpdate', { taskId: '7', status: 'completed' }, { success: true }, false)).toEqual({ kind: 'task-update', id: '7', isMain: false, status: 'done' })
    expect(eventFromTool('TaskUpdate', { taskId: '7', status: 'deleted' }, { success: true }, true)).toMatchObject({ status: 'deleted' })
    expect(eventFromTool('TaskList', {}, { tasks: [{ id: '7', subject: 'Ship it', status: 'pending', blockedBy: [] }, { id: '7', subject: 'dupe' }] }, true)).toEqual({
      kind: 'task-list',
      items: [{ key: 'task:7', title: 'Ship it', status: 'pending' }],
    })
  })

  test('ExitPlanMode', () => {
    expect(eventFromTool('ExitPlanMode', {}, { plan: '## A\n- one\n## B\n- two', isAgent: false }, true)).toMatchObject({ kind: 'outline', outline: { stages: ['A', 'B'] } })
  })

  // The subagent cases live here and not in the flow tests: the test kit drops `agentId` from
  // `$.tool.call`, so it cannot raise a subagent's tool call, and register.tsx's
  // `e.agentId === undefined` wiring is checked only through this table (a kit limit, not a choice).
  const ignored: [string, string, unknown, unknown, boolean][] = [
    ['a subagent’s todo list', 'TodoWrite', { todos: [] }, {}, false],
    ['a subagent’s plan', 'ExitPlanMode', {}, { plan: '- one' }, false],
    ['a plan awaiting a team lead', 'ExitPlanMode', {}, { plan: '- one', awaitingLeaderApproval: true }, true],
    ['an approved plan with no text', 'ExitPlanMode', {}, { plan: null }, true],
    ['a failed task update', 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: false }, true],
    ['a task update that changes nothing Headway shows', 'TaskUpdate', { taskId: '1', owner: 'x' }, { success: true }, true],
    ['a task created with no id', 'TaskCreate', { subject: 'x' }, {}, true],
    ['a todo list of the wrong shape', 'TodoWrite', { todos: 'nope' }, {}, true],
    ['another tool', 'Bash', { command: 'ls' }, {}, true],
  ]
  for (const [name, tool, input, result, isMain] of ignored) test(`ignores ${name}`, () => expect(eventFromTool(tool, input, result, isMain)).toBeNull())
})
