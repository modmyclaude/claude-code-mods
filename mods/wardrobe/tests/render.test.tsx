// Each component wardrobe restyles, drawn through the plugin on the terminal
// and the desktop, and each way it hands the drawing back to the engine.

import { describe, expect, test } from 'claude-code/testing'
import type { RenderPropsOf } from 'claude-code'

import { themeById } from '../hooks/themes'
import { EDIT, ENGINE, start, SURFACES, TOOL_ROW, wear, world } from './setup'

const dracula = themeById('dracula')!
const colorblind = themeById('colorblind')!
const hc = themeById('high-contrast')!

const chipOf = (found: { children: unknown[] } | undefined) => (found?.children[0] as { props: Record<string, unknown> } | undefined)?.props

describe('tool rows', () => {
  test('carry the theme icon and the time the call took, measured at tool.call', async ($, on) => {
    const w = world(on)
    let id = ''
    let seen: unknown
    on('tool.call', async ($, e) => {
      id = e.tool_use_id
      seen = e.tool === 'Bash' ? e.command : undefined
      await w.clock.sleep(1500)
      return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }
    })
    await start($)
    await wear($, 'dracula')

    const call = $.tool.call({ tool: 'Bash', command: 'make' })
    await w.clock.settle()
    const running = { ...TOOL_ROW, tool_use_id: id, isRunning: true }
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolUse', props: running, requestId: id })
      expect((await ui.find({ key: 'status' }))?.text).toBe(` ${dracula.status.running} `)
      await ui.unmount()
    }
    await w.clock.advance(1500)
    const ran = await call
    expect(ran.text).toBe('ok') // the timing hook passes the result through untouched
    expect(seen).toBe('make') // and the call's input too

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolUse', props: { ...running, isRunning: false }, requestId: id })
      const drawn = (await ui.drawn()) as { children: unknown[] }
      expect(drawn.children).toContainEqual(expect.objectContaining({ children: [ENGINE] })) // the engine's own row inside
      expect((await ui.find({ key: 'icon' }))?.text).toBe(` ${dracula.icons.shell} `)
      const status = await ui.find({ key: 'status' })
      expect(status?.text).toBe(` ${dracula.status.done} 1.5s `)
      expect(chipOf(status)).toEqual({ color: dracula.palette.ok, backgroundColor: dracula.palette.bg })
      await ui.unmount()
    }
  })

  test('mark an error by shape as well as colour, and drop the chip when narrow', async ($, on) => {
    world(on)
    await start($)
    await wear($, 'colorblind')
    for (const surface of SURFACES) {
      const errored = { ...TOOL_ROW, tool: 'Edit', isErrored: true }
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolUse', props: errored, viewport: { columns: 100, rows: 30 } })
      expect((await ui.find({ key: 'icon' }))?.text).toBe(` ${colorblind.icons.edit} `)
      expect((await ui.find({ key: 'status' }))?.text).toBe(` ${colorblind.status.error} `)
      await ui.redraw({ ...TOOL_ROW, isInterrupted: true })
      expect((await ui.find({ key: 'status' }))?.text).toBe(` ${colorblind.status.interrupted} `)
      await ui.unmount()

      const narrow = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolUse', props: TOOL_ROW, viewport: { columns: 40, rows: 30 } })
      expect(await narrow.find({ key: 'icon' })).toBeDefined()
      expect(await narrow.find({ key: 'status' })).toBeUndefined()
      await narrow.unmount()
    }
  })

  test('a timing hook that fails never stops the tool call', async ($, on) => {
    // No clock beneath: the hook's $.clock.now() rejects before it calls next.
    let ran = 0
    on('tool.call', () => {
      ran++
      return { result: { stdout: 'fine', stderr: '', interrupted: false }, text: 'fine' }
    })
    const result = await $.tool.call({ tool: 'Bash', command: 'true' })
    expect(ran).toBe(1)
    expect(result.text).toBe('fine')
  })
})

describe('folded tool groups', () => {
  const calls = (n: number, errored = -1): RenderPropsOf['ToolGroup']['calls'] =>
    Array.from({ length: n }, (_, i) => ({
      tool_use_id: `t${i}`,
      tool: i % 2 === 0 ? 'Read' : 'Grep',
      input: {},
      isRunning: false,
      isErrored: i === errored,
      isInterrupted: false,
    }))

  test('show one icon per call before the engine count line', async ($, on) => {
    world(on)
    await start($)
    await wear($, 'dracula')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolGroup', props: { calls: calls(3, 1), isActive: false, isExpanded: false } })
      const icons = await ui.find({ key: 'icons' })
      expect(icons?.text).toBe(` ${dracula.icons.read}${dracula.icons.search}${dracula.icons.read} `)
      const colours = (await ui.findAll({ type: 'Text', text: dracula.icons.search })).map(found => found.props.color)
      expect(colours).toContain(dracula.palette.error) // the failed call
      await ui.unmount()

      const many = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolGroup', props: { calls: calls(15), isActive: true, isExpanded: false } })
      expect((await many.find({ key: 'icons' }))?.text).toContain('+3')
      await many.unmount()

      // Unfolded, each call is its own ToolUse row: the group itself is the engine's.
      const open = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolGroup', props: { calls: calls(3), isActive: false, isExpanded: true } })
      expect(await open.drawn()).toEqual(ENGINE)
      await open.unmount()
    }
  })
})

describe('diff cards', () => {
  const result = (output: unknown, isErrored = false): RenderPropsOf['ToolResult'] => ({ tool_use_id: 't1', tool: 'Edit', output, isErrored })

  test('draw added and removed lines in the theme diff colours, numbered', async ($, on) => {
    world(on, { root: '/work/alpha' })
    await start($)
    await wear($, 'colorblind')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolResult', props: result(EDIT) })
      const summary = await ui.find({ key: 'summary' })
      expect(summary?.text).toBe(' Updated src/app.ts  +1  -1 ')
      const added = await ui.find({ type: 'Text', text: '12 + const b = 3' })
      const removed = await ui.find({ type: 'Text', text: '12 - const b = 2' })
      expect(added?.props).toEqual({ color: colorblind.diff.addFg, backgroundColor: colorblind.diff.addBg })
      expect(removed?.props).toEqual({ color: colorblind.diff.removeFg, backgroundColor: colorblind.diff.removeBg })
      expect((await ui.find({ type: 'Text', text: '11   const a = 1' }))?.props.color).toBe(colorblind.palette.muted)
      await ui.unmount()
    }
  })

  test('a high-contrast card is the AAA pair the tests measured', async ($, on) => {
    world(on)
    await start($)
    await wear($, 'high-contrast')
    const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'ToolResult', props: result(EDIT) })
    expect((await ui.find({ type: 'Text', text: '12 + const b = 3' }))?.props).toEqual({ color: hc.diff.addFg, backgroundColor: hc.diff.addBg })
  })

  test('errors, long diffs and edits held for review are the engine own', async ($, on) => {
    world(on)
    await start($)
    await wear($, 'dracula')
    const long = { ...EDIT, structuredPatch: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 200, lines: Array.from({ length: 200 }, (_, i) => `+${i}`) }] }
    for (const surface of SURFACES) {
      for (const props of [result(EDIT, true), result(long), result({ ...EDIT, staged: true }), result('a text result')]) {
        const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolResult', props })
        expect(await ui.drawn()).toEqual(ENGINE)
        await ui.unmount()
      }
    }
  })
})

describe('shell results', () => {
  const bash = (output: unknown): RenderPropsOf['ToolResult'] => ({ tool_use_id: 't1', tool: 'Bash', output, isErrored: false })

  test('small plain output is a themed card, stderr marked by a sign as well as colour', async ($, on) => {
    world(on)
    await start($)
    await wear($, 'dracula')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolResult', props: bash({ stdout: 'built\n', stderr: 'warning: slow\n', interrupted: false }) })
      expect((await ui.find({ type: 'Text', text: ' built ' }))?.props).toEqual({ color: dracula.palette.text, backgroundColor: dracula.palette.bg })
      expect((await ui.find({ type: 'Text', text: ' ! warning: slow ' }))?.props).toEqual({ color: dracula.palette.warn, backgroundColor: dracula.palette.bg })
      await ui.unmount()

      const quiet = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolResult', props: bash({ stdout: '', stderr: '', interrupted: false }) })
      expect(await quiet.find({ type: 'Text', text: ' (no output) ' })).toBeDefined()
      await quiet.unmount()

      // Colour codes are dropped and the theme colours the text; a progress bar's CR is the engine's.
      const coloured = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolResult', props: bash({ stdout: '\u001b[32mok\u001b[0m', stderr: '', interrupted: false }) })
      expect((await coloured.find({ type: 'Text', text: ' ok ' }))?.props).toEqual({ color: dracula.palette.text, backgroundColor: dracula.palette.bg })
      await coloured.unmount()
      const progress = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolResult', props: bash({ stdout: '10%\r20%', stderr: '', interrupted: false }) })
      expect(await progress.drawn()).toEqual(ENGINE)
      await progress.unmount()

      const read = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolResult', props: { tool_use_id: 't2', tool: 'Read', output: { type: 'text' }, isErrored: false } })
      expect(await read.drawn()).toEqual(ENGINE)
      await read.unmount()
    }
  })
})

describe('the spinner', () => {
  const spinner: RenderPropsOf['Spinner'] = { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' }

  test('takes the theme suffix; the terminal adds a chip saying what the turn does', async ($, on) => {
    const w = world(on)
    await start($)
    await wear($, 'tokyo-night')
    const tokyo = themeById('tokyo-night')!
    for (const surface of SURFACES) {
      w.drawnByEngine.length = 0
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'Spinner', props: spinner })
      // The engine still draws the line (elapsed time, tokens), with the theme's suffix.
      expect(w.drawnByEngine.at(-1)).toEqual({ ...spinner, suffix: tokyo.spinnerSuffix })
      const mode = await ui.find({ key: 'mode' })
      if (surface === 'terminal') {
        expect(mode?.text).toBe(` ${tokyo.mark} thinking `)
        expect(chipOf(mode)).toEqual({ color: tokyo.palette.accent, backgroundColor: tokyo.palette.bg })
      } else {
        expect(await ui.drawn()).toEqual(ENGINE)
      }
      await ui.unmount()
    }
  })

  test("leaves the engine's own status message exactly as written, drawing only beside it", async ($, on) => {
    const w = world(on)
    await start($)
    await wear($, 'tokyo-night')
    const status: RenderPropsOf['Spinner'] = { word: 'Sauteing', message: 'Running tests…', suffix: '…', mode: 'tool-use' }
    for (const surface of SURFACES) {
      w.drawnByEngine.length = 0
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'Spinner', props: status })
      expect(w.drawnByEngine.at(-1)).toEqual(status)
      if (surface === 'terminal') expect((await ui.find({ key: 'mode' }))?.text).toContain('using tools')
      await ui.unmount()
    }
  })
})

describe('the turn duration', () => {
  test('is a themed line on the terminal; other surfaces draw their own', async ($, on) => {
    world(on)
    await start($)
    await wear($, 'dracula')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'TurnDuration', props: { word: 'Baked', durationMs: 64_000 } })
      if (surface === 'terminal') expect((await ui.find({ key: 'turn' }))?.text).toBe(` ${dracula.mark} Baked for 1m 4s `)
      else expect(await ui.drawn()).toEqual(ENGINE)
      await ui.unmount()
    }
  })
})

describe('falling back to the engine', () => {
  const groupOf = (tool: unknown) => ({
    calls: [{ tool_use_id: 't', tool, input: {}, isRunning: false, isErrored: false, isInterrupted: false }],
    isActive: false,
    isExpanded: false,
  })

  test('with nothing worn, every component is the engine own', async ($, on) => {
    world(on)
    await start($)
    for (const surface of SURFACES) {
      const mounts = [
        $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolUse', props: TOOL_ROW }),
        $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolGroup', props: groupOf('Read') as RenderPropsOf['ToolGroup'] }),
        $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolResult', props: { tool_use_id: 't', tool: 'Edit', output: EDIT, isErrored: false } }),
        $.ui.mount({ plugin: 'wardrobe', surface, component: 'Spinner', props: { word: 'W', message: null, suffix: '', mode: 'thinking' } }),
        $.ui.mount({ plugin: 'wardrobe', surface, component: 'TurnDuration', props: { word: 'Baked', durationMs: 1000 } }),
      ]
      for (const ui of await Promise.all(mounts)) expect(await ui.drawn()).toEqual(ENGINE)
    }
  })

  test('a surface wardrobe does not style keeps the engine drawing', async ($, on) => {
    world(on)
    await start($)
    await wear($, 'dracula')
    for (const surface of ['vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolUse', props: TOOL_ROW })
      expect(await ui.drawn()).toEqual(ENGINE)
    }
  })

  test('a drawing that throws hands the row back to the engine instead of breaking it', async ($, on) => {
    world(on)
    await start($)
    await wear($, 'dracula')
    for (const surface of SURFACES) {
      // A tool name that is not a string makes the theme's icon lookup throw.
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolGroup', props: groupOf(42) as RenderPropsOf['ToolGroup'] })
      expect(await ui.drawn()).toEqual(ENGINE)
      await ui.unmount()
    }
  })
})
