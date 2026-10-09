// The countdown in the prompt footer, drawn through the real ui.render chain
// on both surfaces the mod supports, and the plain status line that stands
// in where no footer draws.

import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { API_KEY, MIN, SLOW, start, step, usage, world } from './world'

const FOOTER = { plugin: 'thermostat', component: 'SessionMode' as const, props: { modes: [] as string[] } }
/** The label's own Text, where its colour lives (the keyed Box around it holds the place). */
const LABEL = { type: 'Text', text: /^cache / }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`on ${surface} the footer counts down: quiet, then amber, then cold`, SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    const ui = await $.ui.mount({ ...FOOTER, surface })
    // Nothing cached yet: nothing drawn.
    expect(await ui.find({ key: 'thermostat' })).toBeUndefined()

    await step($, w, usage(140_000, 9_000))
    await ui.redraw()
    expect((await ui.find({ key: 'thermostat' }))?.text).toBe('cache warm · 60m left')
    const warm = await ui.find(LABEL)
    expect(warm?.text).toBe('cache warm · 60m left')
    expect(warm?.props.color).toBeUndefined()
    expect(warm?.props.dimColor).toBe(true)

    await w.clock.advance(51 * MIN)
    await ui.redraw()
    const amber = await ui.find(LABEL)
    expect(amber?.text).toBe('cache warm · 9m left')
    expect(amber?.props.color).toBe('warning')

    await w.clock.advance(10 * MIN)
    await ui.redraw()
    const cold = await ui.find(LABEL)
    expect(cold?.text).toBe('cache cold · 150k to re-read')
    expect(cold?.props.color).toBe('suggestion')
    await ui.unmount()
  })

  test(`on ${surface} the label sits after the engine's own mode labels`, async ($, on) => {
    const w = world(on)
    await start($)
    await step($, w, usage(140_000, 9_000))
    const ui = await $.ui.mount({ ...FOOTER, surface, props: { modes: ['focus'] } })
    const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
    // The engine's own labels stay, drawn first.
    expect(texts).toContain('focus')
    expect(texts.at(-2)).toBe(' & ')
    expect(texts.at(-1)).toBe('cache warm · 60m left')
    await ui.unmount()
  })

  test(`on ${surface} an API key session shows the 5-minute window, amber from 2 minutes`, async ($, on) => {
    const w = world(on, API_KEY)
    await start($)
    await step($, w, usage(140_000, 9_000))
    const ui = await $.ui.mount({ ...FOOTER, surface })
    expect((await ui.find({ key: 'thermostat' }))?.text).toBe('cache warm · 5m left')
    await w.clock.advance(3.5 * MIN)
    await ui.redraw()
    const soon = await ui.find(LABEL)
    expect(soon?.text).toBe('cache warm · 1m left')
    expect(soon?.props.color).toBe('warning')
    await ui.unmount()
  })
}

test('with no footer drawing, the plain status line carries the countdown, and steps aside once one draws', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000))
  // The footer gets a 90-second grace period before the status line stands in.
  await w.clock.advance(60 * 1000)
  expect(w.statuses).toEqual([])
  await w.clock.advance(60 * 1000)
  expect(w.statuses.at(-1)).toBe('cache warm · 58m left')

  const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' })
  await w.clock.advance(30 * 1000)
  expect(w.statuses.at(-1)).toBeUndefined()
  await ui.unmount()
})

// A session refuses a tree that puts the engine's own node under a Box that
// sizes, hides or moves it ("engine node under a Box with prop ..."), and draws
// its own footer instead. The kit does not check this, so the test walks the tree.
const ENGINE_BENEATH = {
  name: 'engine-beneath',
  tier: 'append' as const,
  register(on: On) {
    on('ui.render', { component: 'SessionMode' }, () => ({ type: 'engine', ref: 0 }) as never)
  },
}
const CONCEALING = ['display', 'overflow', 'position', 'width', 'height', 'minWidth', 'minHeight', 'top', 'left', 'right', 'bottom']
type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
function engineNodeConcealers(node: unknown, around: string[] = []): string[][] {
  if (node === null || typeof node !== 'object') return []
  const n = node as Node
  if (n.type === 'engine') return [around]
  const mine = n.type === 'Box' ? CONCEALING.filter(k => n.props?.[k] !== undefined) : []
  return (n.children ?? []).flatMap(c => engineNodeConcealers(c, [...around, ...mine]))
}

test('the engine mode labels beside the countdown are never under a Box that sizes or hides them', { plugins: [ENGINE_BENEATH] }, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...FOOTER, surface, props: { modes: ['focus'] } })
    expect((await ui.find({ key: 'thermostat' }))?.text).toBe('cache warm · 60m left')
    expect(engineNodeConcealers(await ui.drawn())).toEqual([[]])
    await ui.unmount()
  }
})
