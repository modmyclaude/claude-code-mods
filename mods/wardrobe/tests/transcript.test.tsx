// The gate for the whole-session look: a worn theme tints the transcript's own
// rows (the person's prompt, each reply block, a command's output) by wrapping
// the engine's drawing, never by rewriting it. What a kit can prove: the engine's
// node sits only under Boxes with layout-neutral props, the wrapper is a pure
// function of the look and the app's theme tone (nothing read per tick, so a
// redraw never restarts anything), and no theme means the engine's row untouched.
// Whether the desktop paints the background behind the engine's text is a
// renderer fact only a live boot shows; the live check records that.
//
// Fit, from the live desktop run: the desktop draws the person's message as its
// own bubble with margins, so there the row gets the stripe alone; and a light
// look may paint only on a terminal whose Claude Code theme is light, because
// light panels under the app's light text are unreadable.

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
// and draws its own row instead; the kit does not check this, so the test walks
// the tree and lists the offending props above every engine node.
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

describe('the transcript rows in a dark look', () => {
  for (const row of ['AssistantMessage', 'CommandOutput'] as Row[]) {
    test(`${row}: the engine's row is wrapped in the theme's background behind a stripe, never sized or hidden, on both surfaces`, { plugins: [ENGINE_BENEATH] }, async ($, on) => {
      world(on, { surfaces: ['terminal', 'desktop'] })
      await start($)
      await wear($, 'dracula')
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: row, props: ROWS[row] })
        const drawn = await ui.drawn()
        expect(engineNodeConcealers(drawn), surface).toEqual([[]])
        expect(tintsAbove(drawn), surface).toEqual([[dracula.palette.bg]])
        expect(await ui.find({ key: 'stripe' }), surface).toBeDefined()
        expect((await ui.find({ key: 'tint' }))?.props.paddingX, surface).toBe(1)
        await ui.unmount()
      }
    })
  }

  test("the person's message: the stripe alone beside the engine's own band, on both surfaces; the stripe runs the row's full height", { plugins: [ENGINE_BENEATH] }, async ($, on) => {
    world(on, { surfaces: ['terminal', 'desktop'] })
    await start($)
    await wear($, 'dracula')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'UserMessage', props: ROWS.UserMessage })
      const drawn = await ui.drawn()
      expect(engineNodeConcealers(drawn), surface).toEqual([[]])
      expect(tintsAbove(drawn), surface).toEqual([[]])
      const stripe = await ui.find({ key: 'stripe' })
      expect(stripe?.props, surface).toMatchObject({ width: 1, backgroundColor: dracula.palette.accent })
      expect(await ui.find({ key: 'tint' }), surface).toBeUndefined()
      await ui.unmount()
    }
  })

  test('the row is a pure function of the look: a second later, the same tree', { plugins: [ENGINE_BENEATH] }, async ($, on) => {
    const w = world(on, { surfaces: ['terminal', 'desktop'] })
    await start($)
    await wear($, 'dracula')
    const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'desktop', component: 'AssistantMessage', props: ROWS.AssistantMessage })
    const first = JSON.stringify(await ui.drawn())
    await ui.unmount()
    await w.clock.advance(1000)
    const again = await $.ui.mount({ plugin: 'wardrobe', surface: 'desktop', component: 'AssistantMessage', props: ROWS.AssistantMessage })
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

describe('a light look paints only where the app is light', () => {
  test('on a light Claude Code theme the terminal rows carry the light background', { plugins: [ENGINE_BENEATH] }, async ($, on) => {
    world(on, { surfaces: ['terminal', 'desktop'], theme: 'light' })
    await start($)
    await wear($, 'paper')
    const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'AssistantMessage', props: ROWS.AssistantMessage })
    expect(tintsAbove(await ui.drawn())).toEqual([[paper.palette.bg]])
    await ui.unmount()
    // The desktop app keeps its own (dark) look whatever the setting says: stripe only there.
    const desktop = await $.ui.mount({ plugin: 'wardrobe', surface: 'desktop', component: 'AssistantMessage', props: ROWS.AssistantMessage })
    const drawn = await desktop.drawn()
    expect(tintsAbove(drawn)).toEqual([[]])
    expect(await desktop.find({ key: 'stripe' })).toBeDefined()
    await desktop.unmount()
  })

  test('on a dark Claude Code theme, and on the desktop whatever the theme, the stripe stands and nothing is filled', { plugins: [ENGINE_BENEATH] }, async ($, on) => {
    world(on, { surfaces: ['terminal', 'desktop'], theme: 'dark' })
    await start($)
    const said = await wear($, 'paper')
    expect(said).toContain("paper is made for a light theme; /wear paper --match sets Claude Code's theme to match.")
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'AssistantMessage', props: ROWS.AssistantMessage })
      const drawn = await ui.drawn()
      expect(tintsAbove(drawn), surface).toEqual([[]])
      expect(engineNodeConcealers(drawn), surface).toEqual([[]])
      expect(await ui.find({ key: 'stripe' }), surface).toBeDefined()
      await ui.unmount()
    }
    const band = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 100, hasSurvey: false, maxRows: 6 } as never })
    const texts = await band.findAll({ type: 'Text' })
    expect(texts.length).toBeGreaterThan(0)
    expect(texts.every(t => t.props.backgroundColor === undefined)).toBe(true)
    await band.unmount()
  })

  test('a dark look says nothing extra, and a light look on a light app says nothing extra either', async ($, on) => {
    world(on, { surfaces: ['terminal'], theme: 'light' })
    await start($)
    expect(await wear($, 'dracula')).not.toContain('made for a light theme')
    expect(await wear($, 'paper')).not.toContain('made for a light theme')
  })

  test("Claude Code's theme is read at start and followed when it changes in /config; after a match it is known at once", { plugins: [ENGINE_BENEATH] }, async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], theme: 'dark' })
    await start($)
    await wear($, 'paper')
    const dark = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'AssistantMessage', props: ROWS.AssistantMessage })
    expect(tintsAbove(await dark.drawn())).toEqual([[]])
    await dark.unmount()
    await $.config.set({ key: 'theme', value: 'light', previous: 'dark', provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } } as never) // the person, in /config
    const light = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'AssistantMessage', props: ROWS.AssistantMessage })
    expect(tintsAbove(await light.drawn())).toEqual([[paper.palette.bg]])
    await light.unmount()
    w.config.theme = 'dark'
    await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } } as never)
    await wear($, 'paper --match')
    const matched = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'AssistantMessage', props: ROWS.AssistantMessage })
    expect(tintsAbove(await matched.drawn())).toEqual([[paper.palette.bg]])
    await matched.unmount()
  })

  test('the gallery marks light looks as best on a light theme', async ($, on) => {
    world(on, { surfaces: ['terminal'], placesPanes: false })
    await start($)
    const list = await wear($, '')
    expect(list).toContain('- paper (light)')
    expect(list).toContain('(best on a light theme)')
    expect(list).not.toContain('dracula (dark) ▸●◆■▲: Purple, pink and cyan on a deep slate (best on a light theme)')
  })
})
