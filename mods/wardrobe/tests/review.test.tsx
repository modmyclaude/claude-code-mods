// The cross-review's follow-up tests (T1-T6), plus the fixes it led to: other
// mods' drawings stand, a narrow spinner keeps its room, odd props fall back.

import { describe, expect, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import type { RenderPropsOf } from 'claude-code'

import { contrast } from '../hooks/contrast'
import { THEMES } from '../hooks/themes'
import { EDIT, ENGINE, start, SURFACES, TOOL_ROW, wear, world } from './setup'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
/** Every Text that names a colour, with the background it is painted on. */
function painted(node: unknown, out: { color: string; bg: unknown }[] = []): { color: string; bg: unknown }[] {
  const n = node as Node
  if (n && typeof n === 'object') {
    if (n.type === 'Text' && typeof n.props?.color === 'string') out.push({ color: n.props.color, bg: n.props.backgroundColor })
    for (const child of n.children ?? []) painted(child, out)
  }
  return out
}

describe('review', () => {
  // T1
  test('an unchanged look writes nothing on the tick (gotcha 12)', async ($, on) => {
    let writes = 0
    on('state.set', ($, e, next) => {
      if (e.plugin === 'wardrobe' && e.key === 'look') writes++
      return next(e)
    })
    const w = world(on)
    await start($)
    await wear($, 'nord')
    writes = 0
    await w.clock.advance(5 * 60_000)
    expect(writes).toBe(0)
  })

  // T2
  test('nothing is re-read more often than once a minute', async ($, on) => {
    let reads = 0
    on('state.get', ($, e, next) => {
      if (e.plugin === 'wardrobe' && e.key === 'look') reads++
      return next(e)
    })
    const w = world(on)
    await start($)
    reads = 0
    await w.clock.advance(59_000)
    expect(reads).toBe(0)
    await w.clock.advance(1_000)
    expect(reads).toBe(1)
  })

  // T3
  test('pins of two projects never touch each other', async ($, on) => {
    const w = world(on, { root: '/work/alpha' })
    await start($)
    await wear($, 'dracula')
    await wear($, 'pin')
    w.cd('/work/beta')
    await wear($, 'nord')
    await wear($, 'pin')
    expect(w.store.get('pins')).toEqual({ '/work/alpha': 'dracula', '/work/beta': 'nord' })
    w.cd('/work/alpha')
    await wear($, 'paper')
    expect(w.store.get('pins')).toEqual({ '/work/alpha': 'paper', '/work/beta': 'nord' })
    await wear($, 'unpin')
    expect(w.store.get('pins')).toEqual({ '/work/beta': 'nord' })
    expect(w.store.get('global')).toBe('nord')
  })

  // T4
  test('every span drawn names its own background and meets the theme bar', async ($, on) => {
    world(on)
    await start($)
    const group: RenderPropsOf['ToolGroup'] = {
      calls: Array.from({ length: 14 }, (_, i) => ({ tool_use_id: `g${i}`, tool: i % 2 ? 'Grep' : 'Read', input: {}, isRunning: false, isErrored: i === 3, isInterrupted: false })),
      isActive: false,
      isExpanded: false,
    }
    for (const theme of THEMES) {
      await wear($, theme.id)
      const bar = theme.id === 'high-contrast' ? 7 : 4.5
      for (const surface of SURFACES) {
        const mounts = [
          $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolUse', props: TOOL_ROW }),
          $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolGroup', props: group }),
          $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolResult', props: { tool_use_id: 't', tool: 'Edit', output: { ...EDIT, userModified: true }, isErrored: false } }),
          $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolResult', props: { tool_use_id: 't', tool: 'Bash', output: { stdout: 'a\n', stderr: 'b\n', interrupted: false }, isErrored: false } }),
          $.ui.mount({ plugin: 'wardrobe', surface, component: 'Spinner', props: { word: 'W', message: null, suffix: '', mode: 'thinking' } }),
          $.ui.mount({ plugin: 'wardrobe', surface, component: 'TurnDuration', props: { word: 'Baked', durationMs: 1000 } }),
        ]
        for (const ui of await Promise.all(mounts)) {
          for (const { color, bg } of painted(await ui.drawn())) {
            expect(typeof bg).toBe('string')
            expect(contrast(color, bg as string)).toBeGreaterThanOrEqual(bar)
          }
          await ui.unmount()
        }
      }
    }
  })

  // T5
  test('the diff summary chips are the theme add and remove pairs', async ($, on) => {
    world(on)
    await start($)
    for (const theme of THEMES) {
      await wear($, theme.id)
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'ToolResult', props: { tool_use_id: 't', tool: 'Edit', output: EDIT, isErrored: false } })
      expect((await ui.find({ type: 'Text', text: ' +1 ' }))?.props).toEqual({ color: theme.diff.addFg, backgroundColor: theme.diff.addBg })
      expect((await ui.find({ type: 'Text', text: ' -1 ' }))?.props).toEqual({ color: theme.diff.removeFg, backgroundColor: theme.diff.removeBg })
      await ui.unmount()
    }
  })

  // T6
  test('an errored /wear row is the engine own', async ($, on) => {
    world(on)
    await start($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'CommandOutput', props: { command: 'wear', args: '', text: 'boom', isErrored: true } })
      expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })
      await ui.unmount()
    }
  })
})

describe('living with other mods', () => {
  // A mod beneath wardrobe (the append tier sits under a person's own installs)
  // that draws its own result, turn line and tool row.
  const other: Plugin = {
    name: 'other-mod',
    tier: 'append',
    register(on) {
      on('ui.render', { component: 'ToolResult' }, ($, e) => {
        const { Text } = $.ui.resolve(e)
        return <Text>other result</Text>
      })
      on('ui.render', { component: 'TurnDuration' }, ($, e) => {
        const { Text } = $.ui.resolve(e)
        return <Text>other turn</Text>
      })
      on('ui.render', { component: 'ToolUse' }, ($, e) => {
        const { Text } = $.ui.resolve(e)
        return <Text>other row</Text>
      })
    },
  }

  test('where another mod drew its own tree, it stands; tool rows still wrap it', { plugins: [other] }, async ($, on) => {
    world(on)
    await start($)
    await wear($, 'dracula')
    for (const surface of SURFACES) {
      const result = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolResult', props: { tool_use_id: 't', tool: 'Edit', output: EDIT, isErrored: false } })
      expect((await result.drawn()) as unknown).toMatchObject({ type: 'Text', children: ['other result'] })
      const row = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolUse', props: TOOL_ROW })
      expect(await row.find({ key: 'icon' })).toBeDefined()
      expect(await row.find({ type: 'Text', text: 'other row' })).toBeDefined()
    }
    const turn = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 3000 } })
    expect((await turn.drawn()) as unknown).toMatchObject({ type: 'Text', children: ['other turn'] })
  })
})

describe('fallbacks the review asked for', () => {
  test('a narrow spinner keeps its room: no chip under 60 columns', async ($, on) => {
    world(on)
    await start($)
    await wear($, 'dracula')
    const ui = await $.ui.mount({
      plugin: 'wardrobe',
      surface: 'terminal',
      component: 'Spinner',
      props: { word: 'W', message: null, suffix: '', mode: 'thinking' },
      viewport: { columns: 40, rows: 20 },
    })
    expect(await ui.drawn()).toEqual(ENGINE)
  })

  test('a turn line with odd props is the engine own', async ($, on) => {
    world(on)
    await start($)
    await wear($, 'dracula')
    for (const props of [{ word: 'Baked', durationMs: Number.NaN }, { word: 'Baked', durationMs: -5 }, { durationMs: 3000 }]) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'TurnDuration', props: props as RenderPropsOf['TurnDuration'] })
      expect(await ui.drawn()).toEqual(ENGINE)
      await ui.unmount()
    }
  })

  test('a refused or failed call shows its status but no time (that span is mostly the approval wait)', async ($, on) => {
    const w = world(on)
    let id = ''
    on('tool.call', async ($, e) => {
      id = e.tool_use_id
      await w.clock.sleep(800)
      return { result: { stdout: '', stderr: 'no', interrupted: false }, text: 'no' }
    })
    await start($)
    await wear($, 'dracula')
    const call = $.tool.call({ tool: 'Bash', command: 'false' })
    await w.clock.advance(800)
    await call
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolUse', props: { ...TOOL_ROW, tool_use_id: id, isErrored: true } })
      expect((await ui.find({ key: 'status' }))?.text).toBe(` ${THEMES.find(t => t.id === 'dracula')!.status.error} `)
      await ui.unmount()
    }
  })
})
