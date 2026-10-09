// Headway where real sessions get rough: control characters in titles, a plan
// Claude stops updating, one long step among quick ones, surfaces that draw no
// band, a mod beneath that fills the band, surveys, teammates and a revision
// flashed as the turn ends. All through the real wiring, on both surfaces.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

import { BAND, PANE_PROPS, PLUGIN, SURFACES, bandText, beneath, list, todos, turnEnd, turnStart, world } from './world'

const S = 1000
const M = 60 * S
const SIX = ['Plan the schema', 'Write the migration', 'Wire the routes', 'Add tests', 'Update docs', 'Ship it']

// Control characters are built here, so none sits in this file.
const ch = (code: number) => String.fromCodePoint(code)
const ESC = ch(0x1b)
const CONTROLS: [string, string][] = [
  ['BEL', ch(0x07)],
  ['a lone ESC', ESC],
  ['a full CSI colour sequence', `${ESC}[1;31m`],
  ['DEL', ch(0x7f)],
  ['NUL', ch(0x00)],
  ['the one-byte CSI (U+009B)', `${ch(0x9b)}31m`],
]
const EVERY = CONTROLS.map(([, bad]) => bad).join(' ')

async function expectBand($: Engine, line: string | undefined) {
  for (const surface of SURFACES) expect(await bandText($, surface), surface).toBe(line)
}

async function headway($: Engine, args: string) {
  return $.command.run({ command: 'headway', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
}

/**
 * The band and the pane draw (a refusal rejects the mount), Headway's line
 * reads `line`, the mod beneath still shows, and the pane holds `row`.
 */
async function expectDrawn($: Engine, line: string, row: string) {
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect((await band.find({ key: 'headway' }))?.text, surface).toBe(line)
    expect(await band.find({ type: 'Text', text: "another mod's line" }), surface).toBeDefined()
    await band.unmount()
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: row }), surface).toBeDefined()
    await pane.unmount()
  }
}

/** Another mod holding the whole band, as last-look's compact hold does: rows, then its buttons. */
function fullBeneath(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box key="hold" flexDirection="column">
        {Array.from({ length: e.props.maxRows - 1 }, (_, index) => (
          <Text>{`held row ${index + 1}`}</Text>
        ))}
        <Box flexDirection="row">
          <Button key="cancel" label="Cancel" onPress={() => undefined} />
          <Button key="proceed" label="Proceed" onPress={() => undefined} />
        </Box>
      </Box>
    )
  })
}

describe('a control character in a title never blanks the band (gotcha 31)', () => {
  for (const [name, bad] of CONTROLS) {
    test(`${name} in a todo title`, async ($, on) => {
      world(on)
      beneath(on)
      await turnStart($)
      await todos($, [
        { content: `Fix ${bad} the parser`, status: 'in_progress' },
        { content: 'Ship it', status: 'pending' },
      ])
      await expectDrawn($, 'Fix the parser (0/2) ▱▱', '[>] Fix the parser')
    })
  }

  test('from TaskCreate', async ($, on) => {
    world(on)
    beneath(on)
    await turnStart($)
    await $.tool.call({ tool: 'TaskCreate', subject: `Fix ${EVERY} the parser`, description: 'x' })
    await expectDrawn($, 'Fix the parser (0/1) ▱', '[>] Fix the parser')
  })

  test('from TaskUpdate', async ($, on) => {
    world(on)
    beneath(on)
    await turnStart($)
    await $.tool.call({ tool: 'TaskCreate', subject: 'Write docs', description: 'x' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', subject: `Fix ${EVERY} the parser` })
    await expectDrawn($, 'Fix the parser (0/1) ▱', '[>] Fix the parser')
  })

  test('from TaskList', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    w.tasks.push({ id: '1', subject: `Fix ${EVERY} the parser`, status: 'in_progress', blockedBy: [] })
    await $.tool.call({ tool: 'TaskList' })
    await expectDrawn($, 'Fix the parser (0/1) ▱', '[>] Fix the parser')
  })

  test('from a plan-mode plan: stage names and steps', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    w.plan.text = [
      `## Phase 1: ${EVERY} Build`,
      `1. Add the ${EVERY} theme tokens`,
      '2. Wire the toggle',
      '## Phase 2: Verify',
      '1. Update the docs',
    ].join('\n')
    await $.tool.call({ tool: 'ExitPlanMode' })
    await expectDrawn($, 'Plan approved · 2 stages, 3 steps', '  [ ] Add the theme tokens')
    await todos($, list(['Add the theme tokens', 'Wire the toggle', 'Update the docs'], 0))
    await expectDrawn($, 'Build · Add the theme tokens (0/3) ▱▱▱', 'Build')
  })
})

describe('a plan Claude stops updating', () => {
  test('stays through one quiet turn, leaves at the end of the second: no receipt, no history, no timer', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    await todos($, list(SIX, 0))
    await w.clock.advance(M)
    await todos($, list(SIX, 1))
    await w.clock.advance(M)
    await todos($, list(SIX, 2))
    await turnEnd($)

    // A turn that moves the plan keeps it live.
    await turnStart($)
    await w.clock.advance(M)
    await todos($, list(SIX, 3))
    await turnEnd($)

    // First quiet turn: still shown.
    await turnStart($)
    await w.clock.advance(4 * M)
    await turnEnd($)
    expect(await bandText($, 'terminal')).toStartWith('Add tests (3/6)')

    // Second quiet turn: shown while it runs, gone once it ends.
    await turnStart($)
    await w.clock.advance(4 * M)
    expect(await bandText($, 'desktop')).toStartWith('Add tests (3/6)')
    await turnEnd($)
    await expectBand($, undefined)
    await w.clock.advance(5 * S)
    expect(w.toasts.filter(text => text.startsWith('Plan done'))).toEqual([])
    expect(w.stored.history).toBeUndefined()

    await turnStart($)
    const before = w.periods()
    await w.clock.advance(10 * S)
    expect(w.periods(), 'no timer for a plan that left').toBe(before)

    // The next list is a plan of its own.
    await todos($, list(['Buy milk', 'Walk the dog'], 0))
    await expectBand($, 'Buy milk (0/2) ▱▱')
  })

  test('an approved outline nobody followed stops staging lists after two quiet turns', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    w.plan.text = '## Build\n- Add the theme tokens\n- Wire the toggle\n## Verify\n- Update the docs\n'
    await $.tool.call({ tool: 'ExitPlanMode' })
    await turnEnd($)
    for (let quiet = 0; quiet < 2; quiet += 1) {
      await turnStart($)
      await turnEnd($)
    }
    await turnStart($)
    await todos($, list(['Add the theme tokens', 'Wire the toggle', 'Update the docs'], 0))
    await expectBand($, 'Add the theme tokens (0/3) ▱▱▱')
  })

  // Each source restarts the quiet count, not only TodoWrite: a plan moved by one tool alone stays.
  const FOUR = ['One', 'Two', 'Three', 'Four']

  test('turns that only call TaskUpdate keep a task plan', async ($, on) => {
    world(on)
    beneath(on)
    await turnStart($)
    for (const subject of FOUR) await $.tool.call({ tool: 'TaskCreate', subject, description: 'x' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
    await turnEnd($)
    for (let turn = 1; turn <= 3; turn += 1) {
      await turnStart($)
      await $.tool.call({ tool: 'TaskUpdate', taskId: String(turn), status: 'completed' })
      await $.tool.call({ tool: 'TaskUpdate', taskId: String(turn + 1), status: 'in_progress' })
      await turnEnd($)
      expect(await bandText($, 'terminal'), `after turn ${turn}`).toStartWith(`${FOUR[turn]} (${turn}/4)`)
    }
  })

  test('turns that only call TaskCreate keep a task plan', async ($, on) => {
    world(on)
    beneath(on)
    await turnStart($)
    await $.tool.call({ tool: 'TaskCreate', subject: 'One', description: 'x' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
    await turnEnd($)
    for (let turn = 1; turn <= 3; turn += 1) {
      await turnStart($)
      await $.tool.call({ tool: 'TaskCreate', subject: `More ${turn}`, description: 'x' })
      await turnEnd($)
      expect(await bandText($, 'terminal'), `after turn ${turn}`).toStartWith(`One (0/${turn + 1})`)
    }
  })

  test('turns that only call TaskList keep a task plan', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    for (const [index, subject] of FOUR.entries()) {
      w.tasks.push({ id: String(index + 1), subject, status: index === 0 ? 'in_progress' : 'pending', blockedBy: [] })
    }
    await $.tool.call({ tool: 'TaskList' })
    await turnEnd($)
    for (let turn = 1; turn <= 3; turn += 1) {
      await turnStart($)
      w.tasks[turn - 1]!.status = 'completed'
      w.tasks[turn]!.status = 'in_progress'
      await $.tool.call({ tool: 'TaskList' })
      await turnEnd($)
      expect(await bandText($, 'terminal'), `after turn ${turn}`).toStartWith(`${FOUR[turn]} (${turn}/4)`)
    }
  })

  test('an outline approved after a quiet turn still stages the list two turns later', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    await todos($, list(['Old one', 'Old two', 'Old three'], 1))
    await turnEnd($)
    // Quiet for the list, but the approval is Claude moving its plan.
    await turnStart($)
    w.plan.text = '## Build\n- Add the theme tokens\n- Wire the toggle\n## Verify\n- Update the docs\n'
    await $.tool.call({ tool: 'ExitPlanMode' })
    await turnEnd($)
    await turnStart($)
    await turnEnd($)
    await turnStart($)
    await todos($, list(['Add the theme tokens', 'Wire the toggle', 'Update the docs'], 0))
    await expectBand($, 'Build · Add the theme tokens (0/3) ▱▱▱')
  })

  test('a resumed conversation does not inherit this one’s plan', async ($, on) => {
    world(on)
    beneath(on)
    await turnStart($)
    await todos($, list(SIX, 1))
    await expectBand($, 'Write the migration (1/6) ▰▱▱▱▱▱')
    await $.session.end({ reason: 'resume', sessionId: 'session-1', resume: { id: 'session-1' } })
    await expectBand($, undefined)
  })
})

describe('time left after one long step (STEADY_WINDOW)', () => {
  test('a full test run early in the session stops hiding time left once it ages out', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    const four = ['Read the code', 'Edit the parser', 'Run the full suite', 'Fix the lint']
    await todos($, list(four, 0))
    let done = 0
    for (const span of [20 * S, 20 * S, 5 * M, 20 * S]) {
      await w.clock.advance(span)
      done += 1
      await todos($, list(four, done))
    }
    await w.clock.advance(4 * S)

    const twelve = Array.from({ length: 12 }, (_, index) => `Second plan item ${index + 1} q${index}`)
    await todos($, list(twelve, 0))
    for (done = 1; done <= 10; done += 1) {
      await w.clock.advance(20 * S)
      await todos($, list(twelve, done))
      // While the 5m step is among the last eight times, the spread is too wide to say.
      if (done === 2) expect(await bandText($, 'terminal')).toEndWith(' estimating...')
    }
    expect(await bandText($, 'terminal')).toEndWith(' <1m left')
  })
})

describe('the timer only where a band is drawn', () => {
  test('no timer with no band surface; it starts when the desktop app attaches and stops when it leaves', async ($, on) => {
    const w = world(on, {}, [])
    beneath(on)
    await turnStart($)
    await todos($, list(SIX, 0))
    await w.clock.advance(10 * S)
    expect(w.periods(), 'a -p run draws no band').toBe(0)

    w.surfaces.push('desktop')
    await $.session.attach({ surface: 'desktop', clientId: 'app' })
    const started = w.periods()
    expect(started, 'the timer starts on attach').toBeGreaterThan(0)
    await w.clock.advance(3 * S)
    expect(w.periods() - started, 'once a second').toBe(3)

    w.surfaces.length = 0
    await w.clock.advance(S)
    const before = w.periods()
    await w.clock.advance(30 * S)
    expect(w.periods(), 'stopped once nothing draws the band').toBe(before)
  })

  test('a late answer about the surfaces never overrules a newer one', async ($, on) => {
    const w = world(on, {}, [])
    beneath(on)
    await turnStart($)
    await todos($, list(SIX, 0))
    expect(w.periods(), 'nothing draws the band yet').toBe(0)

    // A plan update asks what draws the band while nothing does; that answer comes half a second late.
    w.late.push(S / 2)
    const update = todos($, list(SIX, 1))
    await w.clock.settle()
    // Meanwhile the desktop app attaches: the newer answer starts the timer.
    w.surfaces.push('desktop')
    await $.session.attach({ surface: 'desktop', clientId: 'app' })
    expect(w.periods(), 'the timer starts on attach').toBeGreaterThan(0)

    // The stale "nothing draws it" lands after: it must not stop the timer.
    await w.clock.advance(S / 2)
    await update
    const before = w.periods()
    await w.clock.advance(5 * S)
    expect(w.periods() - before, 'still once a second').toBe(5)
  })

  test('VS Code and mobile draw no band: no timer', async ($, on) => {
    const w = world(on, {}, ['vscode', 'mobile'])
    beneath(on)
    await turnStart($)
    await todos($, list(SIX, 0))
    await w.clock.advance(10 * S)
    expect(w.periods()).toBe(0)
  })
})

describe('sharing the band', () => {
  test('beneath a mod that fills the band, its buttons come first, so an overflow cuts Headway, never them', async ($, on) => {
    world(on)
    fullBeneath(on)
    await turnStart($)
    await todos($, list(SIX, 0))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
      const keys = (await ui.findAll({})).map(element => element.key)
      expect(keys.indexOf('proceed'), surface).toBeGreaterThan(-1)
      expect(keys.indexOf('headway'), surface).toBeGreaterThan(keys.indexOf('proceed'))
      expect(await ui.find({ type: 'Text', text: `held row ${BAND.props.maxRows - 1}` }), surface).toBeDefined()
      await ui.unmount()
    }
  })

  test('steps aside while a survey holds the band, and passes the band on', async ($, on) => {
    world(on)
    beneath(on)
    await turnStart($)
    await todos($, list(SIX, 0))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND, props: { ...BAND.props, hasSurvey: true } })
      expect(await ui.find({ key: 'headway' }), surface).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: "another mod's line" }), surface).toBeDefined()
      await ui.unmount()
    }
  })

  test('a teammate is not counted in the agents chip', async ($, on) => {
    world(on)
    beneath(on)
    await turnStart($)
    await todos($, list(SIX, 0))
    await $.agent.spawn({
      tool_use_id: 'call-lead',
      prompt: 'lead',
      description: 'lead',
      subagentType: 'teammate',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'model',
      background: true,
      fork: false,
      isTeammate: true,
    })
    await expectBand($, 'Plan the schema (0/6) ▱▱▱▱▱▱')
  })
})

describe('a revision flashed as the turn ends', () => {
  test('the timer runs out the flash, then stops', async ($, on) => {
    const w = world(on)
    beneath(on)
    await turnStart($)
    await todos($, list(SIX, 0))
    await w.clock.advance(M)
    await todos($, list(SIX, 1))
    await todos($, [...list(SIX, 1), { content: 'Announce the release', status: 'pending' }])
    await turnEnd($)
    expect(await bandText($, 'terminal')).toContain('plan revised +1')
    const before = w.periods()
    await w.clock.advance(5 * S)
    expect(w.periods() - before, 'ticks to clear the flash').toBeGreaterThan(0)
    await expectBand($, 'Write the migration (1/7) ▰▱▱▱▱▱▱')
    const after = w.periods()
    await w.clock.advance(30 * S)
    expect(w.periods(), 'idle once the flash is gone').toBe(after)
  })
})

describe('/headway answers no text for the model on every branch (gotcha 18)', () => {
  test('hide, show, an unknown word and the pane', async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    for (const args of ['hide', 'show', 'sideways', '']) expect(await headway($, args), args).toEqual({})
  })
})

// API-GOTCHAS #39 (MM-083): a live session refuses a band tree that puts the
// engine's own node under a Box that sizes, hides or moves it, and draws its
// own band instead. The kit does not check this, so the test walks the tree.
const ENGINE_BENEATH: Plugin = {
  name: 'engine-beneath',
  tier: 'append',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as never)
  },
}
const CONCEALING = ['display', 'overflow', 'position', 'width', 'height', 'minWidth', 'minHeight', 'top', 'left', 'right', 'bottom']
type DrawnNode = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
function engineNodeConcealers(node: unknown, around: string[] = []): string[][] {
  if (node === null || typeof node !== 'object') return []
  const n = node as DrawnNode
  if (n.type === 'engine') return [around]
  const mine = n.type === 'Box' ? CONCEALING.filter(k => n.props?.[k] !== undefined) : []
  return (n.children ?? []).flatMap(c => engineNodeConcealers(c, [...around, ...mine]))
}

test('#39: the engine band beneath is never under a Box that sizes or hides it', { plugins: [ENGINE_BENEATH] }, async ($, on) => {
  world(on)
  await turnStart($)
  await todos($, list(SIX, 0))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ key: 'headway' }), surface).toBeDefined()
    expect(engineNodeConcealers(await ui.drawn()), surface).toEqual([[]])
    await ui.unmount()
  }
})
