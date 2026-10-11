// MM-111: the desktop app gives Claude no todo tool, so a plan never reached
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
  test(`MM-111: in ${where}, Headway ${lends ? 'lends its plan tool, and the line follows it' : 'lends no tool'}`, async ($, on) => {
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
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
      const line = await ui.find({ key: 'headway' })
      expect(line?.text, surface).toContain('Write the migration')
      expect(line?.text, surface).toContain('(1/4)')
      await ui.unmount()
    }
  })
}

test('MM-111: a plan call with no steps is answered, never fails the turn', async ($, on) => {
  world(on)
  on('tool.list', () => ({ value: [{ name: 'Bash', description: 'Bash', mcp: false }] }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__headway__${e.name}` } }))
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  const answer = await $.tool.call({ tool: 'mcp__headway__plan', todos: 'nope' })
  expect(answer.text).toContain('No plan read')
})
