// The band and the replay pane, mounted on each surface and driven by key:
// buttons, hotkey digits, the Client's arrow keys and the scroll keys.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { fakeGit, fileTools, PANE, panes, PLUGIN, repo, runReplay, session, start, threeChanges, turn } from './fixtures'

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}
const PANE_PROPS = {
  title: 'Play-by-Play',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

/** A session with one turn of three changes: Edit, Write, then a shell edit. */
async function threeStepTurn($: Engine, on: On) {
  const git = repo()
  const ran: string[] = []
  const world = session(on)
  panes(on, true, world.opened)
  fakeGit(on, git)
  fileTools(on, git, ran)
  // What the engine draws in the band when the plugin passes.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'engine band' })
  })
  await start($)
  await turn($, 't1', () => threeChanges($))
  return world
}

async function textOf(ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) {
  return (await ui.findAll({ type: 'Text' })).map(found => found.text).join('\n')
}

/** Another mod's band, loaded beneath this one (tier append), drawing a keyed line. */
const OTHER_BAND = {
  name: 'other-band',
  tier: 'append' as const,
  register(on: On) {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box, Text } = $.ui.resolve(e)
      return Box({ key: 'other-band', children: Text({ children: 'other mod line' }) })
    })
  },
}

describe('the hint above the prompt', () => {
  test('composes with other mods: their band line is drawn first, the hint after it', { plugins: [OTHER_BAND] }, async ($, on) => {
    await threeStepTurn($, on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect(await ui.find({ type: 'Box', key: 'play-by-play' })).toBeDefined()
      expect(await ui.find({ type: 'Box', key: 'other-band' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'other mod line' })).toBeDefined()
      // Other mods first, so an overflowing band never hides their buttons.
      const keyed = (await ui.findAll({ type: 'Box' })).map(box => box.key).filter(key => key !== undefined)
      expect(keyed).toEqual(['other-band', 'play-by-play'])
      await ui.unmount()
    }
    // Hidden, the other mod's line is all that is left.
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'hide' })
    expect(await ui.find({ type: 'Box', key: 'play-by-play' })).toBeUndefined()
    expect(await ui.find({ type: 'Box', key: 'other-band' })).toBeDefined()
  })

  test('shows after a turn with changes, opens the pane, hides on both surfaces', async ($, on) => {
    const world = await threeStepTurn($, on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })
      const line = await ui.find({ type: 'Text', text: /edits/ })
      expect(line?.text).toBe('3 edits · 2 files · +5 −3 · press r or /replay')
      expect((await ui.find({ key: 'replay' }))?.props).toMatchObject({ hotkey: 'r', label: 'Replay' })
      world.opened.length = 0
      await ui.press({ key: 'replay' })
      expect(world.opened).toEqual([PANE])
      await ui.unmount()
    }
    // Hide takes it down everywhere until the next turn with changes.
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'hide' })
    expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
    expect(await ui.find({ key: 'replay' })).toBeUndefined()
  })

  test('yields to a survey and to a running turn, and a new turn clears it', async ($, on) => {
    await threeStepTurn($, on)
    for (const props of [{ ...BAND_PROPS, hasSurvey: true }, { ...BAND_PROPS, isWorking: true }]) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props })
      expect(await ui.find({ key: 'replay' })).toBeUndefined()
      await ui.unmount()
    }
    await $.turn.start({ text: 'next', turnId: 't2' })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ key: 'replay' })).toBeUndefined()
  })

  test('no hint after a turn that changed nothing', async ($, on) => {
    session(on)
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'engine band' }))
    await start($)
    await turn($, 't1', async () => undefined)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ key: 'replay' })).toBeUndefined()
  })
})

describe('the replay pane', () => {
  test('steps with Prev and Next, held at both ends, on both surfaces', async ($, on) => {
    await threeStepTurn($, on)
    for (const surface of ['terminal', 'desktop'] as const) {
      await runReplay($)
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
      const step = async () => (await ui.find({ type: 'Text', text: /^Step \d+ of 3$/ }))?.text

      expect(await step()).toBe('Step 1 of 3')
      expect(await textOf(ui)).toContain('2 files · +5 −3 · 3 edits · biggest: src/app.ts +3 −2')
      expect(await ui.find({ type: 'Text', text: 'src/app.ts' })).toBeDefined()
      const code = await ui.find({ type: 'Code' })
      expect(code?.props).toMatchObject({ format: 'diff', path: 'src/app.ts' })
      expect(code?.text).toBe('@@ -1,3 +1,4 @@\n const one = 1\n-const b = 2\n+const b = 3\n+const c = 4\n export {}')

      await ui.press({ key: 'prev' })
      expect(await step()).toBe('Step 1 of 3')
      await ui.press({ key: 'next' })
      expect(await step()).toBe('Step 2 of 3')
      expect(await ui.find({ type: 'Text', text: 'README.md' })).toBeDefined()
      await ui.press({ key: 'next' })
      expect(await step()).toBe('Step 3 of 3')
      expect(await ui.find({ type: 'Text', text: /via shell/ })).toBeDefined()
      expect((await ui.find({ type: 'Code' }))?.text).toBe(
        '@@ -1,4 +1,4 @@\n-const one = 1\n+const ONE = 1\n const b = 3\n const c = 4\n export {}',
      )
      await ui.press({ key: 'next' })
      expect(await step()).toBe('Step 3 of 3')
      await ui.unmount()
    }
  })

  test('number keys jump to a file\'s first change; Close closes', async ($, on) => {
    const world = await threeStepTurn($, on)
    for (const surface of ['terminal', 'desktop'] as const) {
      await runReplay($)
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
      expect((await ui.findAll({ type: 'Button' })).map(button => button.key)).toEqual([
        'file-1',
        'file-2',
        'prev',
        'next',
        'close',
      ])
      expect((await ui.find({ key: 'file-2' }))?.props).toMatchObject({ hotkey: '2', label: 'README.md' })
      await ui.press({ key: 'file-2' })
      expect(await ui.find({ type: 'Text', text: 'Step 2 of 3' })).toBeDefined()
      await ui.press({ key: 'next' })
      await ui.press({ key: 'file-1' })
      expect(await ui.find({ type: 'Text', text: 'Step 1 of 3' })).toBeDefined()
      world.closed.length = 0
      await ui.press({ key: 'close' })
      expect(world.closed).toEqual([PANE])
      await ui.unmount()
    }
  })

  test('arrow keys from the Client line step; modified keys are ignored', async ($, on) => {
    const world = await threeStepTurn($, on)
    for (const surface of ['terminal', 'desktop'] as const) {
      await runReplay($)
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
      const step = async () => (await ui.find({ type: 'Text', text: /^Step \d+ of 3$/ }))?.text
      expect(await ui.find({ type: 'Client', key: 'keys' })).toBeDefined()
      await ui.key({ key: 'right', in: 'keys' })
      expect(await step()).toBe('Step 2 of 3')
      await ui.key({ key: 'down', in: 'keys' })
      expect(await step()).toBe('Step 3 of 3')
      await ui.key({ key: 'left', in: 'keys' })
      expect(await step()).toBe('Step 2 of 3')
      await ui.key({ key: 'n', ctrl: true, in: 'keys' })
      expect(await step()).toBe('Step 2 of 3')
      await ui.key({ key: '1', in: 'keys' })
      expect(await step()).toBe('Step 1 of 3')
      world.closed.length = 0
      await ui.key({ key: 'q', in: 'keys' })
      expect(world.closed).toEqual([PANE])
      await ui.unmount()
    }
  })

  test('up and down while the pane holds the keys step; the wheel and page keys scroll', async ($, on) => {
    const offsets: number[] = []
    on('ui.scroll', ($, e) => {
      offsets.push(e.offset)
      return {}
    })
    await threeStepTurn($, on)
    await runReplay($)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    const step = async () => (await ui.find({ type: 'Text', text: /^Step \d+ of 3$/ }))?.text
    const scroll = (by: number, extra: object = {}) =>
      $.ui.scroll({
        component: 'Pane',
        requestId: PANE,
        offset: 5 + by,
        by,
        bodyRows: 10,
        contentRows: 40,
        origin: { kind: 'person' },
        ...extra,
      })
    await scroll(1)
    expect(await step()).toBe('Step 2 of 3')
    expect(offsets).toEqual([0]) // the new step shows from its top
    await scroll(1, { pointer: { column: 3, row: 2 } }) // a wheel tick
    await scroll(10) // page down
    expect(await step()).toBe('Step 2 of 3')
    expect(offsets).toEqual([0, 6, 15])
    await scroll(-1)
    expect(await step()).toBe('Step 1 of 3')
  })

  test('/replay 2 shows the earlier turn', async ($, on) => {
    const world = session(on)
    panes(on, true, world.opened)
    on('tool.call', { tool: 'Write' }, ($, e) => ({
      result: { type: 'create', filePath: e.file_path, content: 'x\n', structuredPatch: [], originalFile: null },
      text: 'created',
    }))
    await start($)
    await turn($, 't1', () => $.tool.call({ tool: 'Write', file_path: '/repo/first.txt', content: 'x\n' }))
    await turn($, 't2', () => $.tool.call({ tool: 'Write', file_path: '/repo/second.txt', content: 'x\n' }))
    for (const surface of ['terminal', 'desktop'] as const) {
      expect(await runReplay($, '2')).toBe('') // the pane is the answer; the model reads nothing
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
      expect(await ui.find({ type: 'Text', text: 'first.txt' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Turn 2 of 2, newest first/ })).toBeDefined()
      await runReplay($, '1')
      expect(await ui.find({ type: 'Text', text: 'second.txt' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('surfaces with no Client say so once and keep the buttons', async ($, on) => {
    await threeStepTurn($, on)
    for (const surface of ['vscode', 'mobile'] as const) {
      await runReplay($)
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
      expect(await ui.find({ type: 'Client' })).toBeUndefined()
      expect(await ui.findAll({ type: 'Text', text: /Arrow keys need the terminal/ })).toHaveLength(1)
      await ui.press({ key: 'next' })
      expect(await ui.find({ type: 'Text', text: 'Step 2 of 3' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('with nothing kept the pane says so', async ($, on) => {
    session(on)
    await start($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
      expect(await ui.find({ type: 'Text', text: /Nothing to replay yet/ })).toBeDefined()
      expect(await ui.find({ key: 'close' })).toBeDefined()
      await ui.unmount()
    }
  })
})
