// Headway through the real wiring: Claude's tool calls, turns and subagents
// raised as the engine raises them, the band and the pane mounted on the
// terminal and the desktop, commands run, the mocked clock moved.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  BAND,
  PANE_PROPS,
  PLUGIN,
  ROOT,
  SURFACES,
  bandText,
  beneath,
  clear,
  list,
  todos,
  turnEnd,
  turnStart,
  world,
} from './world'

const S = 1000
const M = 60 * S
const SIX = ['Plan the schema', 'Write the migration', 'Wire the routes', 'Add tests', 'Update docs', 'Ship it']

const STAGED = `# Plan: Add dark mode

## Context
- The app styles everything with CSS variables.

## Phase 1: Build
1. Add the theme tokens
2. Wire the toggle

## Phase 2: Verify
1. Add tests for the toggle
2. Update the docs
`

// Someone else's mod reacting to Headway's public "plan done" signal.
const LISTENER = {
  name: 'listener',
  register(on: On) {
    on('state.set', { plugin: 'headway', key: 'done' }, async ($, e, next) => {
      $.ui.toast(`listener heard: ${e.value?.steps ?? 0} steps done`)
      return next(e)
    })
  },
}

async function expectBand($: Engine, line: string | undefined) {
  for (const surface of SURFACES) expect(await bandText($, surface), surface).toBe(line)
}

/** The Agent tool starting a subagent, as the engine raises it. */
function spawn(description: string) {
  return {
    tool_use_id: `call-${description}`,
    prompt: `do the ${description} work`,
    description,
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'model',
    background: true,
    fork: false,
  } as const
}

async function startSession($: Engine) {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

async function headway($: Engine, args: string) {
  return $.command.run({ command: 'headway', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
}

describe('no plan', () => {
  test('draws nothing, and another mod’s band line still shows', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    await w.clock.advance(5 * S)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
      expect(await ui.find({ key: 'headway' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: "another mod's line" })).toBeDefined()
      await ui.unmount()
    }
    expect(w.periods()).toBe(0)
  })

  test('each source with nothing in it draws nothing', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    await todos($, [])
    await expectBand($, undefined)
    w.plan.text = null
    await $.tool.call({ tool: 'ExitPlanMode' })
    await expectBand($, undefined)
    w.plan.text = 'We will just refactor the thing carefully.'
    await $.tool.call({ tool: 'ExitPlanMode' })
    await expectBand($, undefined)
    await $.tool.call({ tool: 'TaskList' })
    await expectBand($, undefined)
    expect(w.periods()).toBe(0)
  })

  test('a list that was all done when it appeared is not a plan in progress', async ($, on) => {
    world(on)
    beneath(on)
    await turnStart($)
    await todos($, list(SIX, 6))
    await expectBand($, undefined)
  })
})

describe('a todo list (TodoWrite)', () => {
  test('the line: step, count, bar, then time left once two steps have finished', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    await todos($, list(SIX, 0))
    await expectBand($, 'Plan the schema (0/6) ▱▱▱▱▱▱')
    await w.clock.advance(M)
    await todos($, list(SIX, 1))
    await expectBand($, 'Write the migration (1/6) ▰▱▱▱▱▱')
    await w.clock.advance(M)
    await todos($, list(SIX, 2))
    await expectBand($, 'Wire the routes (2/6) ▰▰▱▱▱▱ ~4m left')
    await w.clock.advance(M)
    await expectBand($, 'Wire the routes (2/6) ▰▰▱▱▱▱ ~3m left')

    // Headway passes the other mod's line through and draws its own beneath it.
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
      expect(await ui.find({ type: 'Text', text: "another mod's line" })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a step past three times its estimate turns amber and says how long it has run', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    await todos($, list(SIX, 0))
    await w.clock.advance(M)
    await todos($, list(SIX, 1))
    await w.clock.advance(M)
    await todos($, list(SIX, 2))
    await w.clock.advance(3 * M)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
      expect((await ui.find({ type: 'Text', text: 'Wire the routes' }))?.props.color).toBeUndefined()
      await ui.unmount()
    }
    await w.clock.advance(S)
    await expectBand($, 'Wire the routes (2/6) ▰▰▱▱▱▱ 3m 1s on this step')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
      expect((await ui.find({ type: 'Text', text: 'Wire the routes' }))?.props.color).toBe('warning')
      expect((await ui.find({ type: 'Text', text: '3m 1s on this step' }))?.props.color).toBe('warning')
      await ui.unmount()
    }
  })

  test('a rewrite keeps finished steps finished and flashes what changed', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    await todos($, list(SIX, 0))
    await w.clock.advance(M)
    await todos($, list(SIX, 2))
    // Claude rewords two steps, drops one, adds one, and resets a status by mistake.
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'Plan the DB schema', status: 'pending', activeForm: 'x' },
        { content: 'Write the migration', status: 'completed', activeForm: 'x' },
        { content: 'Wire up the routes', status: 'in_progress', activeForm: 'x' },
        { content: 'Add tests', status: 'pending', activeForm: 'x' },
        { content: 'Ship it', status: 'pending', activeForm: 'x' },
        { content: 'Announce the release', status: 'pending', activeForm: 'x' },
      ],
    })
    // Still 2/6: the reworded first step stays done. Two steps finished in one minute: 30s each, four left.
    await expectBand($, 'Wire up the routes (2/6) ▰▰▱▱▱▱ ~2m left · plan revised +1 −1')
    await w.clock.advance(5 * S)
    await expectBand($, 'Wire up the routes (2/6) ▰▰▱▱▱▱ ~2m left')
  })
})

describe('the task tools (TaskCreate, TaskUpdate, TaskList)', () => {
  test('tasks are steps; a new or deleted task is a revision', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    for (const subject of ['Plan the schema', 'Write the migration', 'Ship it']) await $.tool.call({ tool: 'TaskCreate', subject, description: subject })
    await expectBand($, 'Plan the schema (0/3) ▱▱▱')
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
    await w.clock.advance(M)
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' })
    await expectBand($, 'Write the migration (1/3) ▰▱▱')
    await $.tool.call({ tool: 'TaskCreate', subject: 'Write docs', description: 'docs' })
    await expectBand($, 'Write the migration (1/4) ▰▱▱▱ · plan revised +1')
    w.tasks.push(
      { id: '1', subject: 'Plan the schema', status: 'completed', blockedBy: [] },
      { id: '2', subject: 'Write the migration', status: 'in_progress', blockedBy: [] },
      { id: '4', subject: 'Write docs', status: 'pending', blockedBy: [] },
    )
    await $.tool.call({ tool: 'TaskList' })
    await expectBand($, 'Write the migration (1/3) ▰▱▱ · plan revised −1')
  })
})

describe('a plan-mode plan (ExitPlanMode)', () => {
  test('headings become stages, and the todo list that follows is staged by them', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    w.plan.text = STAGED
    await $.tool.call({ tool: 'ExitPlanMode' })
    await expectBand($, 'Plan approved · 2 stages, 4 steps')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE_PROPS })
      expect((await ui.findAll({ type: 'Text' })).map(row => row.text)).toEqual([
        'Plan approved. Progress shows once Claude starts a todo or task list.',
        'Build',
        '  [ ] Add the theme tokens',
        '  [ ] Wire the toggle',
        'Verify',
        '  [ ] Add tests for the toggle',
        '  [ ] Update the docs',
      ])
      await ui.unmount()
    }
    const steps = ['Add the theme tokens', 'Wire the toggle', 'Add toggle tests', 'Update docs']
    await todos($, list(steps, 0))
    await expectBand($, 'Build · Add the theme tokens (0/4) ▱▱▱▱')
    await w.clock.advance(M)
    await todos($, list(steps, 1))
    await w.clock.advance(M)
    await todos($, list(steps, 2))
    await expectBand($, 'Verify · Add toggle tests (2/4) ▰▰▱▱ ~2m left')
    await w.clock.advance(2 * M)
    await todos($, list(steps, 4))
    await w.clock.advance(3 * S)
    expect(w.toasts).toContain('Plan done in 4m, right on estimate. Build 2m · Verify 2m')
  })

  test('an approved plan with no list to follow leaves when its turn ends', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    w.plan.text = STAGED
    await $.tool.call({ tool: 'ExitPlanMode' })
    await expectBand($, 'Plan approved · 2 stages, 4 steps')
    await turnEnd($)
    await expectBand($, undefined)
  })
})

describe('finishing', () => {
  test('the bar turns green, then the receipt, then the line leaves; other mods hear "plan done"', { plugins: [LISTENER] }, async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    await todos($, list(SIX, 0))
    await w.clock.advance(M)
    await todos($, list(SIX, 1))
    await w.clock.advance(M)
    await todos($, list(SIX, 2))
    await w.clock.advance(3 * M)
    await todos($, list(SIX, 6))

    await expectBand($, 'Plan done (6/6) ▰▰▰▰▰▰ in 5m')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
      expect((await ui.find({ type: 'Text', text: '▰▰▰▰▰▰' }))?.props.color).toBe('success')
      expect((await ui.find({ type: 'Text', text: 'Plan done' }))?.props.color).toBe('success')
      await ui.unmount()
    }
    expect(w.toasts.filter(text => text.startsWith('Plan done'))).toEqual([])

    expect(w.toasts).toContain('listener heard: 6 steps done')

    await w.clock.advance(3 * S)
    expect(w.toasts.filter(text => text.startsWith('Plan done'))).toEqual(['Plan done in 5m, 1m ahead of estimate. 6 steps.'])
    await expectBand($, undefined)
    // The pane reads the same public "done" value.
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE_PROPS })
      expect(await ui.find({ type: 'Text', text: 'Last plan: 6 steps, done in 5m.' })).toBeDefined()
      await ui.unmount()
    }
  })
})

describe('the one timer', () => {
  test('runs once per second only while a plan is active, visible and worked on', async ($, on) => {
    const w = world(on)
    beneath(on)
    await startSession($)
    await turnStart($)
    await w.clock.advance(5 * S)
    expect(w.periods()).toBe(0)

    await todos($, list(SIX, 0))
    let before = w.periods()
    await w.clock.advance(5 * S)
    // One period per second: a second timer would double it.
    expect(w.periods() - before).toBe(5)

    await turnEnd($)
    await w.clock.settle()
    before = w.periods()
    await w.clock.advance(30 * S)
    expect(w.periods(), 'idle between turns').toBe(before)

    await turnStart($)
    await w.clock.advance(2 * S)
    expect(w.periods()).toBeGreaterThan(before)

    await headway($, 'hide')
    await w.clock.settle()
    before = w.periods()
    await w.clock.advance(30 * S)
    expect(w.periods(), 'hidden').toBe(before)

    await headway($, 'show')
    await w.clock.advance(2 * S)
    expect(w.periods()).toBeGreaterThan(before)

    await todos($, list(SIX, 6))
    await w.clock.advance(4 * S)
    before = w.periods()
    await w.clock.advance(30 * S)
    expect(w.periods(), 'after the plan finished').toBe(before)
  })
})

describe('never in the way', () => {
  test('a refused or failed call passes through untouched and changes nothing', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    w.todo.deny = 'another mod said no'
    const refused = await todos($, list(SIX, 0))
    expect(refused.deny ?? refused.text).toContain('another mod said no')
    await expectBand($, undefined)

    w.todo.deny = undefined
    w.todo.fail = true
    const failed = await todos($, list(SIX, 0))
    expect(failed).toMatchObject({ isError: true, text: 'TodoWrite failed' })
    await expectBand($, undefined)
  })

  test('a call of a shape Headway does not know passes through untouched', async ($, on) => {
    world(on)
    beneath(on)
    await turnStart($)
    const ran = await $.tool.call({ tool: 'TodoWrite', todos: 'not a list' } as never)
    expect(ran).toMatchObject({ text: 'Todos updated' })
    await expectBand($, undefined)
  })

  test('a failure inside Headway never reaches the call, and the line still draws', async ($, on) => {
    const w = world(on)
    beneath(on)
    w.root.deny = 'no root here'
    await turnStart($)
    const ran = await todos($, list(SIX, 0))
    expect(ran).toMatchObject({ result: { oldTodos: [] }, text: 'Todos updated' })
    await expectBand($, 'Plan the schema (0/6) ▱▱▱▱▱▱')
  })
})

describe('subagents', () => {
  test('a small chip counts the ones running, nothing more', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    await todos($, list(SIX, 0))
    await $.agent.spawn(spawn('scout'))
    await $.agent.spawn(spawn('builder'))
    await expectBand($, 'Plan the schema (0/6) ▱▱▱▱▱▱ · 2 agents')
    await turnEnd($, 'agent-scout')
    await expectBand($, 'Plan the schema (0/6) ▱▱▱▱▱▱ · 1 agent')
    await turnEnd($, 'agent-builder')
    await expectBand($, 'Plan the schema (0/6) ▱▱▱▱▱▱')
    void w
  })
})

describe('/headway', () => {
  test('hide and show toggle the line', async ($, on) => {
    const w = world(on)
    beneath(on)
    await startSession($)
    await turnStart($)
    await todos($, list(SIX, 0))
    expect(await headway($, 'hide')).toEqual({})
    await expectBand($, undefined)
    expect(w.toasts).toContain('Headway line hidden. /headway show brings it back.')
    await headway($, 'show')
    await expectBand($, 'Plan the schema (0/6) ▱▱▱▱▱▱')
    await headway($, 'sideways')
    expect(w.toasts).toContain('headway: try /headway, /headway hide or /headway show.')
  })

  test('opens a pane with every step’s status and time; its button toggles the line', async ($, on) => {
    const w = world(on)
    beneath(on)
    await startSession($)
    await turnStart($)
    await todos($, list(SIX, 0))
    await w.clock.advance(M)
    await todos($, list(SIX, 1))
    await w.clock.advance(30 * S)
    expect(await headway($, '')).toEqual({})
    expect(w.opened).toEqual(['headway'])
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE_PROPS })
      const rows = (await ui.findAll({ type: 'Text' })).map(row => row.text)
      expect(rows).toEqual([
        '1/6 steps done · 1m 30s so far',
        '[x] Plan the schema · 1m',
        '[>] Write the migration · running 30s',
        '[ ] Wire the routes',
        '[ ] Add tests',
        '[ ] Update docs',
        '[ ] Ship it',
      ])
      await ui.press({ key: 'toggle' })
      expect(await bandText($, surface)).toBeUndefined()
      expect((await ui.find({ key: 'toggle' }))?.text).toBe('Show line')
      await ui.press({ key: 'toggle' })
      expect(await bandText($, surface)).toBe('Write the migration (1/6) ▰▱▱▱▱▱')
      await ui.unmount()
    }
  })

  test('is registered to run at once, so it works while Claude does (gotcha 33)', async ($, on) => {
    const w = world(on)
    await startSession($)
    expect(w.registered.map(spec => [spec.name, spec.immediate])).toEqual([['headway', true]])
  })

  test('the pane says so when there is no plan', async ($, on) => {
    world(on)
    await startSession($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE_PROPS })
      expect(await ui.find({ type: 'Text', text: 'No plan right now.' })).toBeDefined()
      await ui.unmount()
    }
  })
})

describe('project history', () => {
  test('keeps durations and counts only, and the next plan blends it into its estimate', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    const four = ['Plan the schema', 'Write the migration', 'Wire the routes', 'Ship it']
    await todos($, list(four, 0))
    for (let done = 1; done <= 4; done += 1) {
      await w.clock.advance(M)
      await todos($, list(four, done))
    }
    await w.clock.advance(3 * S)
    const stored = w.stored.history
    expect(JSON.stringify(stored)).toMatch(/"d":\[60000,60000,60000,60000\],"plans":1/)
    for (const title of four) expect(JSON.stringify(stored)).not.toContain(title)
    expect(JSON.stringify(stored)).not.toContain(ROOT)

    // A fresh conversation: this session's pace is gone, the project's remains.
    await clear($)
    await turnStart($)
    await todos($, list(SIX, 0))
    await w.clock.advance(30 * S)
    await todos($, list(SIX, 1))
    await w.clock.advance(30 * S)
    await todos($, list(SIX, 2))
    // Session median 30s blended with the project's 60s (weighted as 3 steps): 48s a step, 4 steps left.
    await expectBand($, 'Wire the routes (2/6) ▰▰▱▱▱▱ ~4m left')
  })
})
