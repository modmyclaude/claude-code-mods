// The gate for the whole-session look: a worn theme tints the transcript's own
// rows (the person's prompt, each reply block, a command's output) by wrapping
// the engine's drawing, never by rewriting it. What a kit can prove: the engine's
// node sits only under Boxes with layout-neutral props, the wrapper is a pure
// function of the theme (nothing read per tick, so a redraw never restarts
// anything), and no theme means the engine's row untouched. Whether the desktop
// paints the background behind the engine's text is a renderer fact only a live
// boot shows; the live check records that.

import { describe, expect, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import { themeById } from '../hooks/themes'
import { ENGINE, start, SURFACES, wear, world } from './setup'

const dracula = themeById('dracula')!
const paper = themeById('paper')!

// Beneath wardrobe, the engine draws the row itself: what `next(e)` returns live.
const ENGINE_BENEATH = {
  name: 'engine-beneath',
  tier: 'append' as const,
  register(on: On) {
    on('ui.render', { component: 'UserMessage' }, () => ({ type: 'engine', ref: 0 }) as never)
    on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'engine', ref: 0 }) as never)
    on('ui.render', { component: 'CommandOutput' }, () => ({ type: 'engine', ref: 0 }) as never)
  },
}

const ROWS = {
  UserMessage: { text: 'add a /health endpoint', origin: { kind: 'composer' }, isExpanded: true } as RenderPropsOf['UserMessage'],
  AssistantMessage: { text: 'Adding it now.', isFirstOfReply: true } as RenderPropsOf['AssistantMessage'],
  CommandOutput: { command: 'cost', args: '', text: 'Total cost: $0.12', isErrored: false } as RenderPropsOf['CommandOutput'],
} as const
type Row = keyof typeof ROWS

// A session refuses the engine's node under a Box that sizes, hides or moves it
// (a rule the engine enforces, the kit does not) and draws its own row instead; the kit does not check this, so the test
// walks the tree and lists the offending props above every engine node.
const CONCEALING = ['display', 'overflow', 'position', 'width', 'height', 'minWidth', 'minHeight', 'top', 'left', 'right', 'bottom']
type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
function engineNodeConcealers(node: unknown, around: string[] = []): string[][] {
  if (node === null || typeof node !== 'object') return []
  const n = node as Node
  if (n.type === 'engine') return [around]
  const mine = n.type === 'Box' ? CONCEALING.filter(k => n.props?.[k] !== undefined) : []
  return (n.children ?? []).flatMap(c => engineNodeConcealers(c, [...around, ...mine]))
}
/** Every Box above an engine node that carries a backgroundColor, innermost last. */
function tintsAbove(node: unknown, above: string[] = []): string[][] {
  if (node === null || typeof node !== 'object') return []
  const n = node as Node
  if (n.type === 'engine') return [above]
  const bg = n.type === 'Box' && typeof n.props?.backgroundColor === 'string' ? [n.props.backgroundColor] : []
  return (n.children ?? []).flatMap(c => tintsAbove(c, [...above, ...bg]))
}

describe('the transcript rows in a look (the gate)', () => {
  for (const row of Object.keys(ROWS) as Row[]) {
    test(`${row}: the engine's row is wrapped in the theme's background behind a stripe, never sized or hidden, on both surfaces`, { plugins: [ENGINE_BENEATH] }, async ($, on) => {
      world(on, { surfaces: ['terminal', 'desktop'] })
      await start($)
      await wear($, 'dracula')
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: row, props: ROWS[row] })
        const drawn = await ui.drawn()
        expect(engineNodeConcealers(drawn), surface).toEqual([[]])
        expect(tintsAbove(drawn), surface).toEqual([[dracula.palette.bg]])
        const stripe = await ui.find({ key: 'stripe' })
        expect(stripe, surface).toBeDefined()
        expect((await ui.find({ key: 'tint' }))?.props.paddingX, surface).toBe(1)
        await ui.unmount()
      }
    })
  }

  test('a light look tints with its own light background', { plugins: [ENGINE_BENEATH] }, async ($, on) => {
    world(on, { surfaces: ['terminal', 'desktop'] })
    await start($)
    await wear($, 'paper')
    const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'desktop', component: 'AssistantMessage', props: ROWS.AssistantMessage })
    expect(tintsAbove(await ui.drawn())).toEqual([[paper.palette.bg]])
    await ui.unmount()
  })

  test('the row is a pure function of the look: a second later, the same tree', { plugins: [ENGINE_BENEATH] }, async ($, on) => {
    const w = world(on, { surfaces: ['terminal', 'desktop'] })
    await start($)
    await wear($, 'dracula')
    const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'desktop', component: 'UserMessage', props: ROWS.UserMessage })
    const first = JSON.stringify(await ui.drawn())
    await ui.unmount()
    await w.clock.advance(1000)
    const again = await $.ui.mount({ plugin: 'wardrobe', surface: 'desktop', component: 'UserMessage', props: ROWS.UserMessage })
    expect(JSON.stringify(await again.drawn())).toBe(first)
    await again.unmount()
  })

  test('with no theme worn, every row is the engine\'s own', { plugins: [ENGINE_BENEATH] }, async ($, on) => {
    world(on, { surfaces: ['terminal', 'desktop'] })
    await start($)
    for (const row of Object.keys(ROWS) as Row[]) {
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: row, props: ROWS[row] })
        expect(await ui.drawn(), `${row} ${surface}`).toEqual(ENGINE)
        await ui.unmount()
      }
    }
  })

  // The world beneath records what the engine was asked to draw; no stub plugin here, so it is asked.
  test('the engine\'s props reach it exactly as received: no rewrite of the row', async ($, on) => {
    const w = world(on, { surfaces: ['terminal', 'desktop'] })
    await start($)
    await wear($, 'dracula')
    const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'UserMessage', props: ROWS.UserMessage })
    await ui.drawn()
    expect(w.drawnByEngine.at(-1)).toEqual(ROWS.UserMessage)
    await ui.unmount()
  })
})
