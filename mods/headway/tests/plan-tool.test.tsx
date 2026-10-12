// The desktop app gives Claude no todo tool, so a plan never reached
// Headway there. Where no native plan tool exists Headway lends one in
// TodoWrite's shape; where Claude Code has its own, Headway lends none.

import { expect, test } from 'claude-code/testing'

import { BAND, PLUGIN, beneath, list, turnStart, world } from './world'

const STEPS = ['Plan the schema', 'Write the migration', 'Wire the routes', 'Add tests']

const SETUPS = [
  ['the desktop app, with no todo tool', ['Bash', 'Read', 'Write', 'spawn_task'], true],
  ['the terminal, with TodoWrite', ['Bash', 'Read', 'TodoWrite'], false],
  ['the terminal, with the Task tools', ['Bash', 'TaskCreate', 'TaskUpdate', 'TaskList'], false],
] as const

for (const [where, tools, lends] of SETUPS) {
  test(`in ${where}, Headway ${lends ? 'lends its plan tool, and the line follows it' : 'lends no tool'}`, async ($, on) => {
    world(on, {}, ['desktop', 'terminal'])
    beneath(on)
    const lent: { name: string; isDeferred?: unknown }[] = []
    on('tool.list', () => ({ value: tools.map(name => ({ name, description: name, mcp: false })) }))
    on('tool.register', ($, e) => (lent.push(e), { value: { tool: `mcp__headway__${e.name}` } }))
    await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
    expect(lent.map(spec => spec.name)).toEqual(lends ? ['plan'] : [])
    if (!lends) return
    // Listed up front, not behind ToolSearch: a model with no todo tool must see it.
    expect(lent[0]?.isDeferred).toBe(false)

    await turnStart($)
    const answer = await $.tool.call({ tool: 'mcp__headway__plan', todos: list(STEPS, 1) })
    expect(answer.text).toBe('Plan updated.')
    // Claude Code takes only text back from a lent tool: an object fails the call live.
    expect(answer.result).toBe('Plan updated.')
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
      const line = await ui.find({ key: 'headway' })
      expect(line?.text, surface).toContain('Write the migration')
      expect(line?.text, surface).toContain('(1/4)')
      await ui.unmount()
    }
  })
}

test('a plan call with no steps is answered, never fails the turn', async ($, on) => {
  world(on)
  on('tool.list', () => ({ value: [{ name: 'Bash', description: 'Bash', mcp: false }] }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__headway__${e.name}` } }))
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  const answer = await $.tool.call({ tool: 'mcp__headway__plan', todos: 'nope' })
  expect(answer.text).toContain('No plan read')
  expect(typeof answer.result).toBe('string')
})

test("the plan call's terminal row shows a count, not the plan's JSON; other rows pass through as they are", async ($, on) => {
  world(on)
  const seen: { surface: string; tool: string; input: unknown }[] = []
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    seen.push({ surface: e.surface, tool: e.props.tool, input: e.props.input })
    const { Text } = $.ui.resolve(e)
    return <Text key="engine-row">row</Text>
  })
  const row = (tool: string, input: unknown) => ({ tool_use_id: 't1', tool, input, isRunning: false, isErrored: false, isInterrupted: false })
  const plan = { todos: list(STEPS, 1) }
  const draws = [
    ['terminal', 'mcp__headway__plan', plan],
    ['desktop', 'mcp__headway__plan', plan],
    ['terminal', 'Bash', { command: 'ls' }],
    ['terminal', 'mcp__headway__plan', {}], // still streaming in: nothing to count yet
  ] as const
  for (const [surface, tool, input] of draws) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: row(tool, input) })
    await ui.unmount()
  }
  expect(seen).toEqual([
    { surface: 'terminal', tool: 'mcp__headway__plan', input: { steps: 4, done: 1 } },
    { surface: 'desktop', tool: 'mcp__headway__plan', input: plan },
    { surface: 'terminal', tool: 'Bash', input: { command: 'ls' } },
    { surface: 'terminal', tool: 'mcp__headway__plan', input: {} },
  ])
})
