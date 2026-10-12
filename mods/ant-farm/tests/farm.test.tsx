// The mod through its real wiring: the events a session raises (a spawn, its
// model requests, its turn's end, the main turn, /antfarm, /clear) and the
// drawings the engine asks for, on the terminal and the desktop alike.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { boltOf, rasterCells } from '../hooks/bolt-draw'

import {
  DOCKED, NARROW, PANE, PLUGIN, SURFACES, bandProps, engineBand, paneProps, usage, world,
} from './world'

/** The first colour drawn inside the keyed Box (a glyph cell on the desktop, a Text on the terminal). */
async function colorIn(ui: { find: (q: { key: string }) => Promise<{ children: unknown[] } | undefined> }, key: string) {
  const firstColor = (node: unknown): unknown => {
    if (node === null || typeof node !== 'object') return undefined
    const n = node as { props?: { color?: unknown }; children?: unknown[] }
    if (n.props?.color !== undefined) return n.props.color
    for (const c of n.children ?? []) {
      const hit = firstColor(c)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  const box = await ui.find({ key })
  for (const c of box?.children ?? []) {
    const hit = firstColor(c)
    if (hit !== undefined) return hit
  }
  return undefined
}

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text)

function mountPane($: Engine, surface: (typeof SURFACES)[number], bodyColumns = 60) {
  return $.ui.mount({
    plugin: PLUGIN, surface, component: 'Pane', requestId: PANE,
    props: paneProps({ bodyColumns }), viewport: DOCKED,
  })
}

describe('counting', () => {
  test('a subagent gets its own tokens and estimated cost, on every surface', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Map the auth flow', { model: 'claude-opus-5-5' })
    // 1M input + 100k output on opus 5.5: $4 + $2.
    await w.step($, id, usage('claude-opus-5-5', 1_000_000, 100_000), 'claude-opus-5-5')
    await w.step($, id, usage('claude-opus-5-5', 0, 0, 500_000, 0), 'claude-opus-5-5')
    for (const surface of SURFACES) {
      const pane = await mountPane($, surface)
      const all = (await texts(pane)).join('\n')
      expect(all).toContain('Map the auth flow')
      expect(all).toContain('opus-5-5 · running')
      expect(all).toContain('2 req · 1.60M tok · ≈$6.10')
      expect((await pane.find({ key: 'totals' }))?.text).toBe('Subagents ≈$6.10 (price table) · 1.60M tokens · 0s wall')
      await pane.unmount()
    }
  })

  test('main-loop and engine-fork requests count toward the session, not toward a subagent', { options: { budgetUsd: 2 } }, async ($, on) => {
    const w = world(on, { })
    const id = await w.spawn($, 'Explore', { model: 'claude-sonnet-5-5' })
    await w.step($, id, usage('claude-sonnet-5-5', 500_000, 0), 'claude-sonnet-5-5') // subagent: $1
    await w.step($, undefined, usage('claude-opus-5-5', 1_000_000, 0), 'claude-opus-5-5') // main: $4
    await w.step($, 'compaction-fork', usage('claude-opus-5-5', 250_000, 0), 'claude-opus-5-5') // other: $1
    const pane = await mountPane($, 'terminal')
    expect((await pane.find({ key: 'totals' }))?.text).toStartWith('Subagents ≈$1.00 (price table) · 500k tokens')
    expect((await pane.find({ key: 'budget' }))?.text).toBe('Session ≈$6.00 of $2.00 budget (price table) - past 2x')
    expect(w.rec.statuses.at(-1)).toBe('≈$6.00 of $2.00 budget - past 2x the budget')
    // The fork the agent list does not name is not drawn as an ant.
    expect((await pane.find({ key: 'counts' }))?.text).toBe('1 running · 0 done · 0 failed')
  })

  test('an agent the mod did not see start is taken from the engine list', async ($, on) => {
    const w = world(on)
    w.rec.listed = [{ id: 'late-1', description: 'Review the diff', type: 'general-purpose', status: 'running' }]
    await w.step($, 'late-1', usage('claude-sonnet-5-5', 100_000, 10_000), 'claude-sonnet-5-5')
    const pane = await mountPane($, 'desktop')
    const all = (await texts(pane)).join('\n')
    expect(all).toContain('Review the diff')
    expect(all).toContain('sonnet-5-5 · running')
    expect(all).toContain('1 req · 110k tok · ≈$0.30')
  })

  test('a model the price table lacks shows its tokens and a cost of ?', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Odd one', { model: 'mystery-9' })
    await w.step($, id, usage('mystery-9', 4000, 1000), 'mystery-9')
    const pane = await mountPane($, 'terminal')
    expect((await texts(pane)).join('\n')).toContain('1 req · 5k tok · ?')
    expect((await pane.find({ key: 'totals' }))?.text).toStartWith('Subagents ? (price table) · 5k tokens')
  })

  test('the model stream passes through unchanged, even when counting fails', async ($, on) => {
    const w = world(on)
    w.rec.listThrows = true
    const result = await w.step($, 'unknown-loop', usage('claude-opus-5-5', 10, 10), 'claude-opus-5-5')
    expect(result.usage?.input_tokens).toBe(10)
    expect(result.stopReason).toBe('end_turn')
    expect(w.rec.chunks).toEqual([{ kind: 'text', index: 0, text: 'reply 0' }])
  })
})

describe('status and order', () => {
  test('done and failed subagents fold below the running ones, and expand on demand', async ($, on) => {
    const w = world(on)
    const a = await w.spawn($, 'First task')
    await w.clock.advance(1000)
    const b = await w.spawn($, 'Second task')
    await w.clock.advance(1000)
    const c = await w.spawn($, 'Third task')
    await w.step($, a, usage('claude-haiku-5-5', 100, 100))
    await w.finish($, a, 'answer')
    await w.clock.advance(1000)
    await w.finish($, c, 'error')
    for (const surface of SURFACES) {
      const pane = await mountPane($, surface)
      expect((await pane.find({ key: 'counts' }))?.text).toBe('1 running · 1 done · 1 failed')
      // Wall time runs from the first start to now while one still runs.
      expect((await pane.find({ key: 'totals' }))?.text).toEndWith(' · 3s wall')
      // The running one is a full card; the finished ones are one line each, latest first.
      expect(await pane.find({ key: `ant-${b}` })).toBeDefined()
      expect(await pane.find({ key: `ant-${a}` })).toBeUndefined()
      const lines = (await pane.findAll({ type: 'Box' })).map(x => x.key).filter(k => k?.startsWith('line-'))
      expect(lines).toEqual([`line-${c}`, `line-${a}`])
      expect((await pane.find({ key: `line-${c}` }))?.text).toContain('failed · Third task')
      await pane.press({ key: 'toggle-finished' })
      expect(await pane.find({ key: `ant-${a}` })).toBeDefined()
      expect((await pane.find({ key: 'toggle-finished' }))?.props.label).toBe('Collapse')
      await pane.press({ key: 'toggle-finished' })
      expect(await pane.find({ key: `ant-${a}` })).toBeUndefined()
      await pane.unmount()
    }
  })

  test('a spawn the engine refuses adds no ant and the refusal stands', async ($, on) => {
    const w = world(on)
    w.rec.denySpawn = 'no agents today'
    const r = await $.agent.spawn({
      tool_use_id: 'tu', prompt: 'p', description: 'Refused', subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
    })
    expect(r.deny).toBe('no agents today')
    const pane = await mountPane($, 'terminal')
    expect((await pane.find({ key: 'counts' }))?.text).toBe('0 running · 0 done · 0 failed')
    expect(w.rec.opens).toEqual([])
  })

  test('if recording a spawn fails, the spawn still goes through', async ($, on) => {
    const w = world(on)
    w.rec.panesThrow = true
    engineBand(on)
    // Seen a docking surface, so the spawn tries to open the pane unasked and fails.
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: bandProps(), viewport: DOCKED })
    await band.unmount()
    const id = await w.spawn($, 'Still runs')
    expect(id).toBe('agent-1')
  })
})

describe('the ants and the clock', () => {
  test('an ant walks while its subagent works and stops when it is done', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Walker')
    for (const surface of SURFACES) {
      const pane = await mountPane($, surface)
      const rows = async () => (await pane.find({ key: `art-${id}` }))?.text ?? ''
      const before = await rows()
      await w.clock.advance(500)
      expect(await rows()).not.toBe(before)
      await pane.unmount()
    }
    await w.finish($, id)
    const pane = await mountPane($, 'terminal')
    await pane.press({ key: 'toggle-finished' })
    const rows = async () => (await pane.find({ key: `art-${id}` }))?.text ?? ''
    const still = await rows()
    await w.clock.advance(1500)
    expect(await rows()).toBe(still)
  })

  test('the clock ticks only while something runs', async ($, on) => {
    const w = world(on)
    await w.startTurn($)
    const id = await w.spawn($, 'Ticker')
    await w.clock.advance(2000)
    const whileBusy = w.rec.invalidates
    expect(whileBusy).toBeGreaterThanOrEqual(3)
    await w.finish($, id)
    await w.clock.advance(2000)
    expect(w.rec.invalidates).toBeGreaterThan(whileBusy) // the main turn still runs
    await w.finish($, undefined)
    await w.clock.advance(1000) // the tick that notices and stops
    const stopped = w.rec.invalidates
    await w.clock.advance(10_000)
    expect(w.rec.invalidates).toBe(stopped)
  })

  test('the ETA appears once a subagent has made 3 requests', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Paced')
    const pane = await mountPane($, 'terminal')
    const meta = async () => (await texts(pane)).find(t => t.includes(' · running · ')) ?? ''
    for (let i = 0; i < 2; i += 1) {
      await w.clock.advance(10_000)
      await w.step($, id, usage('claude-haiku-5-5', 100, 100))
    }
    expect(await meta()).not.toContain('left')
    await w.clock.advance(10_000)
    await w.step($, id, usage('claude-haiku-5-5', 100, 100))
    // 3 requests in 30s, no history: assumed halfway, 3 more at 10s each.
    expect(await meta()).toContain('~30s left')
  })

  test('a background subagent that ends without a word is settled from the agent list', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Vanishes')
    w.rec.listed = [{ id, description: 'Vanishes', type: 'Explore', status: 'killed' }]
    await w.clock.advance(10_000)
    const pane = await mountPane($, 'terminal')
    expect((await pane.find({ key: 'counts' }))?.text).toBe('0 running · 0 done · 1 failed')
  })
})

describe('budget alarm', () => {
  test('one toast per crossing, amber past the budget, red past twice it', { options: { budgetUsd: 2 } }, async ($, on) => {
    const w = world(on)
    engineBand(on)
    const id = await w.spawn($, 'Spender', { model: 'claude-opus-5-5' })
    const spend = (dollars: number) => w.step($, id, usage('claude-opus-5-5', Math.round(dollars * 250_000), 0), 'claude-opus-5-5')
    await spend(1.5)
    expect(w.rec.toasts).toEqual([])
    expect(w.rec.statuses.at(-1)).toBe('≈$1.50 of $2.00 budget')
    await spend(0.6)
    expect(w.rec.toasts).toEqual(['Session estimate ≈$2.10 reached your $2.00 budget.'])
    expect(w.rec.statuses.at(-1)).toBe('≈$2.10 of $2.00 budget - over budget')
    await spend(1)
    expect(w.rec.toasts).toHaveLength(1)
    for (const surface of SURFACES) {
      const modes = await $.ui.mount({ plugin: PLUGIN, surface, component: 'SessionMode', props: { modes: ['focus'] } })
      expect(await colorIn(modes, 'budget-mark')).toBe('warning')
      expect((await modes.find({ key: 'engine-modes' }))?.text).toBe('focus')
      await modes.unmount()
    }
    await spend(1)
    expect(w.rec.toasts).toEqual([
      'Session estimate ≈$2.10 reached your $2.00 budget.',
      'Session estimate ≈$4.10 is past 2x your $2.00 budget.',
    ])
    expect(w.rec.statuses.at(-1)).toBe('≈$4.10 of $2.00 budget - past 2x the budget')
    for (const surface of SURFACES) {
      const modes = await $.ui.mount({ plugin: PLUGIN, surface, component: 'SessionMode', props: { modes: [] } })
      expect(await colorIn(modes, 'budget-mark')).toBe('error')
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(), viewport: DOCKED })
      expect(await colorIn(band, 'summary')).toBe('error')
      await modes.unmount()
      await band.unmount()
    }
    await spend(5)
    expect(w.rec.toasts).toHaveLength(2)
  })

  test('the alarm trips on Claude Code own estimate even when the table estimate is lower', { options: { budgetUsd: 2 } }, async ($, on) => {
    const w = world(on)
    engineBand(on)
    const id = await w.spawn($, 'Cheap by the table', { model: 'claude-haiku-5-5' })
    w.rec.engineUsd = 1.2
    await w.step($, id, usage('claude-haiku-5-5', 1000, 100)) // the table says about $0.0002
    expect(w.rec.toasts).toEqual([])
    expect(w.rec.statuses.at(-1)).toBe('≈$1.20 of $2.00 budget (Claude Code\'s estimate)')
    w.rec.engineUsd = 2.5
    await w.step($, id, usage('claude-haiku-5-5', 1000, 100))
    expect(w.rec.toasts).toEqual(['Claude Code\'s estimate ≈$2.50 reached your $2.00 budget.'])
    expect(w.rec.statuses.at(-1)).toBe('≈$2.50 of $2.00 budget (Claude Code\'s estimate) - over budget')
    for (const surface of SURFACES) {
      const pane = await mountPane($, surface)
      expect((await pane.find({ key: 'budget' }))?.text).toBe('Session ≈$2.50 of $2.00 budget (Claude Code) - over')
      expect(await colorIn(pane, 'budget')).toBe('warning')
      // The subagent's own figure stays the table's estimate.
      expect((await texts(pane)).join('\n')).toContain('2 req · 2.2k tok · ≈$0.0003')
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(), viewport: DOCKED })
      expect((await band.find({ key: 'summary' }))?.text).toContain('· Claude Code\'s estimate ≈$2.50')
      await pane.unmount()
      await band.unmount()
    }
    // A turn ending reads the total again: here it moved past twice the budget.
    w.rec.engineUsd = 4.4
    await w.finish($, id)
    expect(w.rec.toasts.at(-1)).toBe('Claude Code\'s estimate ≈$4.40 is past 2x your $2.00 budget.')
    const modes = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
    expect((await modes.find({ key: 'budget-mark' }))?.text).toBe('Claude Code\'s estimate ≈$4.40 past 2x budget')
  })

  for (const broken of ['throws', 'has no ledger'] as const) {
    test(`when the engine's usage ${broken}, the table estimate drives the alarm`, { options: { budgetUsd: 2 } }, async ($, on) => {
      const w = world(on)
      if (broken === 'throws') w.rec.usageThrows = true
      const id = await w.spawn($, 'Estimated', { model: 'claude-opus-5-5' })
      await w.step($, id, usage('claude-opus-5-5', 550_000, 0), 'claude-opus-5-5') // ≈$2.20
      expect(w.rec.toasts).toEqual(['Session estimate ≈$2.20 reached your $2.00 budget.'])
      expect(w.rec.statuses.at(-1)).toBe('≈$2.20 of $2.00 budget - over budget')
      const pane = await mountPane($, 'terminal')
      expect((await pane.find({ key: 'budget' }))?.text).toBe('Session ≈$2.20 of $2.00 budget (price table) - over')
    })
  }

  // Off out of the box (Alex, 2026-10-11): no alarm until a budget is set, so a first
  // heavy session never reads as "over budget". The spend still shows, with a hint.
  test('out of the box there is no budget: no toast, no amber, a hint to set one', async ($, on) => {
    const w = world(on)
    engineBand(on)
    const id = await w.spawn($, 'Heavy')
    await w.step($, id, usage('claude-opus-5-5', 2_000_000, 0), 'claude-opus-5-5')
    await w.finish($, id)
    expect(w.rec.toasts).toEqual([])
    expect(w.rec.statuses.at(-1)).toMatch(/^≈\$[\d.]+ this session$/)
    for (const surface of SURFACES) {
      const pane = await mountPane($, surface)
      expect((await pane.find({ key: 'budget' }))?.text).toMatch(/^Session ≈\$[\d.]+ \(price table\)$/)
      expect((await pane.find({ key: 'no-budget' }))?.text).toBe('No budget set - add one in /config')
      expect(await colorIn(pane, 'budget')).toBeUndefined()
      await pane.unmount()
    }
  })

  test('the budget is a setting', { options: { budgetUsd: 0.5 } }, async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Cheap', { model: 'claude-opus-5-5' })
    await w.step($, id, usage('claude-opus-5-5', 150_000, 0), 'claude-opus-5-5') // $0.60
    expect(w.rec.toasts).toEqual(['Session estimate ≈$0.60 reached your $0.50 budget.'])
  })

  test('a budget of 0 turns the alarm off and leaves the footer to the engine', { options: { budgetUsd: 0 } }, async ($, on) => {
    const w = world(on)
    engineBand(on)
    const id = await w.spawn($, 'Free', { model: 'claude-opus-5-5' })
    await w.step($, id, usage('claude-opus-5-5', 5_000_000, 0), 'claude-opus-5-5')
    expect(w.rec.toasts).toEqual([])
    expect(w.rec.statuses.at(-1)).toBe('≈$20.00 this session')
    const modes = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } })
    expect(await modes.find({ key: 'budget-mark' })).toBeUndefined()
  })
})

describe('band', () => {
  test('while a turn runs it shows elapsed time, running vs done and the spend', async ($, on) => {
    const w = world(on)
    engineBand(on)
    await w.startTurn($)
    const a = await w.spawn($, 'One', { model: 'claude-opus-5-5' })
    await w.spawn($, 'Two')
    await w.step($, a, usage('claude-opus-5-5', 100_000, 0), 'claude-opus-5-5') // $0.40
    await w.finish($, a)
    await w.clock.advance(65_000)
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(), viewport: DOCKED })
      expect((await band.find({ key: 'summary' }))?.text).toContain('1m 05s · 1 running / 1 done · ≈$0.40 session')
      // Sized to the band's own body, not the whole terminal (180 columns here):
      // our rows carry the width, never the Box around what is beneath.
      expect(await band.find({ key: 'ant-farm' })).toMatchObject({ type: 'Box', props: { width: 100 } })
      expect((await band.drawn() as { props?: Record<string, unknown> }).props?.width).toBeUndefined()
      expect(await band.find({ key: 'hide-list' })).toBeUndefined()
      await band.unmount()
    }
  })

  test('a subagent finishing does not end the main turn, and its requests are not counted twice', async ($, on) => {
    const w = world(on)
    engineBand(on)
    await w.startTurn($)
    const id = await w.spawn($, 'Helper', { model: 'claude-opus-5-5' })
    await w.step($, id, usage('claude-opus-5-5', 100_000, 0), 'claude-opus-5-5') // $0.40
    await w.step($, undefined, usage('claude-opus-5-5', 50_000, 0), 'claude-opus-5-5') // main: $0.20
    await w.finish($, id)
    await w.clock.advance(5000)
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(), viewport: DOCKED })
      expect((await band.find({ key: 'summary' }))?.text).toContain('5s · 0 running / 1 done · ≈$0.60 session')
      await band.unmount()
    }
    const pane = await mountPane($, 'terminal')
    expect((await pane.find({ key: 'totals' }))?.text).toStartWith('Subagents ≈$0.40 (price table) · 100k tokens')
  })

  test('idle with nothing running, the band is the engine own', async ($, on) => {
    world(on)
    engineBand(on)
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps({ isWorking: false }) })
      expect(await band.find({ key: 'engine-band' })).toBeDefined()
      expect(await band.find({ key: 'summary' })).toBeUndefined()
      await band.unmount()
    }
  })

  test('a survey keeps the band', async ($, on) => {
    const w = world(on)
    engineBand(on)
    await w.spawn($, 'Busy')
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: bandProps({ hasSurvey: true }) })
    expect(await band.find({ key: 'engine-band' })).toBeDefined()
  })
})

describe('pane and the narrow fallback', () => {
  // Bolt: asleep in the empty farm, the small keeper beside the totals once
  // ants arrive, and out of the way in a narrow pane. A Raster on the terminal, one
  // code-font cell per character on the desktop.
  type Drawn = { type?: unknown; key?: unknown; props?: Record<string, unknown>; children?: unknown[] }
  const under = (node: unknown, key: string): Drawn | undefined => {
    if (node === null || typeof node !== 'object') return undefined
    const n = node as Drawn
    if (n.key === key || n.props?.key === key) return n
    for (const c of n.children ?? []) {
      const hit = under(c, key)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  /** Bolt's size as cells: a Raster's columns x rows, or the desktop's rows of one-cell Boxes. */
  const boltSize = (bolt: Drawn | undefined) => {
    if (bolt === undefined) return undefined
    if (bolt.type === 'Raster') return [bolt.props?.columns, bolt.props?.rows]
    const rows = (bolt.children ?? []) as Drawn[]
    return [(rows[0]?.children ?? []).length, rows.length]
  }

  test('Bolt sleeps in the empty farm and keeps it once ants arrive; a narrow pane leaves it out', async ($, on) => {
    const w = world(on)
    for (const surface of SURFACES) {
      const pane = await mountPane($, surface)
      const tree = await pane.drawn()
      expect(boltSize(under(under(tree, 'empty'), 'bolt'))).toEqual([10, 5])
      if (surface === 'terminal') expect(under(tree, 'bolt')?.props?.cells).toBe(rasterCells(boltOf({ size: 'small', pose: 'sleep' })))
      expect(under(tree, 'bolt')?.type).toBe(surface === 'terminal' ? 'Raster' : 'Box')
      expect(under(tree, 'head')).toBeDefined()
      expect(under(under(tree, 'head'), 'bolt')).toBeUndefined()
      await pane.unmount()
      const narrow = await mountPane($, surface, 30)
      expect(await narrow.find({ key: 'bolt' })).toBeUndefined()
      expect((await narrow.find({ key: 'empty' }))?.text).toContain('No subagents yet')
      await narrow.unmount()
    }
    await w.spawn($, 'Busy')
    for (const surface of SURFACES) {
      const pane = await mountPane($, surface)
      const tree = await pane.drawn()
      expect(boltSize(under(under(tree, 'head'), 'bolt'))).toEqual([3, 2])
      if (surface === 'terminal') expect(under(under(tree, 'head'), 'bolt')?.props?.cells).toBe(rasterCells(boltOf({ size: 'tiny', pose: 'idle' })))
      expect(under(tree, 'empty')).toBeUndefined()
      expect((await pane.find({ key: 'totals' }))?.text).toContain('Subagents')
      await pane.unmount()
    }
  })

  // On the desktop a Text holding block characters is drawn in the code font, so
  // words beside a bar or an ant changed font and overflowed. Glyph art sits in one-cell
  // Boxes of its own there, and no Text mixes glyphs with words.
  const GLYPH = /[\u2580-\u259f]/u
  const textsOf = (node: unknown, inCell = false, out: { text: string; inCell: boolean; props: Record<string, unknown> }[] = []) => {
    if (node === null || typeof node !== 'object') return out
    const n = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
    const cell = inCell || (n.type === 'Box' && n.props?.width === 1)
    if (n.type === 'Text') {
      const text = (n.children ?? []).filter(c => typeof c === 'string').join('')
      out.push({ text, inCell: cell, props: n.props ?? {} })
    }
    for (const c of n.children ?? []) textsOf(c, cell, out)
    return out
  }

  test('desktop: ants and bars are one-cell glyphs apart from the words; a finished ant rests dim', async ($, on) => {
    const w = world(on)
    engineBand(on)
    const a = await w.spawn($, 'Running one')
    await w.step($, a, usage('claude-opus-5-5', 100_000, 0), 'claude-opus-5-5')
    const b = await w.spawn($, 'Done one')
    await w.step($, b, usage('claude-opus-5-5', 50_000, 0), 'claude-opus-5-5')
    await w.finish($, b)
    for (const expanded of [false, true]) {
      if (expanded) {
        const pane = await mountPane($, 'desktop')
        await pane.press({ key: 'toggle-finished' })
        await pane.unmount()
      }
      const pane = await mountPane($, 'desktop')
      const texts = textsOf(await pane.drawn())
      expect(texts.some(t => GLYPH.test(t.text))).toBe(true)
      for (const t of texts.filter(t => GLYPH.test(t.text))) {
        expect(t.inCell, t.text).toBe(true)
        expect([...t.text].length, t.text).toBe(1)
      }
      // The dim rest is the finished ant's paint, not its model colour.
      expect(texts.some(t => GLYPH.test(t.text) && t.props.dimColor === true && t.props.color === 'subtle')).toBe(true)
      await pane.unmount()
    }
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: bandProps(), viewport: DOCKED })
    for (const t of textsOf(await band.drawn()).filter(t => GLYPH.test(t.text))) expect(t.inCell, t.text).toBe(true)
    await band.unmount()
    // The terminal keeps one Text per row of art.
    const term = await mountPane($, 'terminal')
    expect(textsOf(await term.drawn()).some(t => GLYPH.test(t.text) && [...t.text].length > 1)).toBe(true)
    await term.unmount()
  })

  test('/antfarm opens the pane', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    const r = await $.command.run({ command: 'antfarm', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    expect(r.text).toBeUndefined() // nothing for the model to read
    expect(w.rec.toasts).toEqual([])
    expect(w.rec.opens).toEqual([PANE])
    const pane = await mountPane($, 'desktop')
    expect((await pane.find({ key: 'empty' }))?.text).toContain('No subagents yet')
  })

  test('where the pane cannot be placed, the band lists the subagents until hidden', async ($, on) => {
    const w = world(on, { placed: false, reason: 'no attached surface places panes' })
    engineBand(on)
    const id = await w.spawn($, 'Listed task')
    await w.step($, id, usage('claude-haiku-5-5', 1000, 0))
    await w.finish($, id)
    const r = await $.command.run({ command: 'antfarm', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 90 } })
    expect(r.text).toBeUndefined()
    expect(w.rec.toasts.at(-1)).toContain('cannot be placed here (no attached surface places panes)')
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps({ isWorking: false }) })
      expect((await band.find({ key: `row-${id}` }))?.text).toContain('Listed task · haiku-5-5')
      await band.unmount()
    }
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: bandProps({ isWorking: false }) })
    await band.press({ key: 'hide-list' })
    expect(await band.find({ key: `row-${id}` })).toBeUndefined()
    expect(await band.find({ key: 'engine-band' })).toBeDefined()
  })

  test('on a docking surface under 144 columns the unasked pane waits and the band lists the ants', async ($, on) => {
    const w = world(on, { placed: false })
    engineBand(on)
    const first = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: bandProps({ isWorking: false }), viewport: NARROW })
    await first.unmount()
    const id = await w.spawn($, 'Narrow task')
    expect(w.rec.opens).toEqual([PANE])
    await w.spawn($, 'Second narrow task')
    expect(w.rec.opens).toEqual([PANE]) // already open, waiting: not opened again
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: bandProps({ maxRows: 3 }), viewport: NARROW })
    expect(await band.find({ key: `row-${id}` })).toBeDefined()
    expect((await band.findAll({ type: 'Text', text: /more - \/antfarm shows them all/ })).length).toBe(1)
  })

  test('the pane opens unasked only where it would be a sidebar', async ($, on) => {
    const w = world(on)
    engineBand(on)
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: bandProps({ isWorking: false }), viewport: { columns: 200, rows: 50, isFullscreen: false } })
    await band.unmount()
    await w.spawn($, 'Main screen')
    expect(w.rec.opens).toEqual([])
  })

  test('the pane opens unasked at most once a session, even after another plugin closed it', {
    plugins: [{
      name: 'closer',
      register(on) {
        on('session.start', async ($, e, next) => {
          await $.command.register({ name: 'close-farm', description: 'Closes the ant farm pane.' })
          return next(e)
        })
        on('command.run', { command: 'close-farm' }, async $ => {
          await $.ui.close({ id: 'ant-farm' })
          return { text: 'closed' }
        })
      },
    }],
  }, async ($, on) => {
    const w = world(on)
    engineBand(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: bandProps({ isWorking: false }), viewport: DOCKED })
    await band.unmount()
    await w.spawn($, 'One')
    expect(w.rec.opens).toEqual([PANE])
    await $.command.run({ command: 'close-farm', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    expect(w.rec.panes).toEqual([])
    await w.spawn($, 'Two')
    expect(w.rec.opens).toEqual([PANE])
    // Asked for, it opens at once.
    await $.command.run({ command: 'antfarm', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    expect(w.rec.opens).toEqual([PANE, PANE])
  })
})

describe('sharing the band', () => {
  const STUB = {
    name: 'stub-band',
    tier: 'append' as const, // beneath ant-farm, as another installed band mod may be
    register(on: On) {
      on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
        const { Box, Text } = $.ui.resolve(e)
        return (
          <Box key="stub-band">
            <Text>another mod</Text>
          </Box>
        )
      })
    },
  }

  test('another mod band still draws, ahead of ours, busy or idle', { plugins: [STUB] }, async ($, on) => {
    const w = world(on, { placed: false })
    const id = await w.spawn($, 'Busy')
    // The compact list too, so an overflowing band is what follows the other mod.
    await $.command.run({ command: 'antfarm', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 90 } })
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(), viewport: DOCKED })
      expect(await band.find({ key: 'summary' })).toBeDefined()
      expect((await band.find({ key: 'stub-band' }))?.text).toBe('another mod')
      const order = (await band.findAll({ type: 'Box' })).map(b => b.key).filter(k => k === 'stub-band' || k === 'band' || k === `row-${id}`)
      expect(order).toEqual(['stub-band', 'band', `row-${id}`])
      // Painted in that order too: a reversed column would draw the other mod last.
      expect(await band.drawn()).toMatchObject({ type: 'Box', props: { flexDirection: 'column' } })
      await band.unmount()
    }
    await w.finish($, 'agent-1')
    const listed = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: bandProps({ isWorking: false }) })
    await listed.press({ key: 'hide-list' })
    await listed.unmount()
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps({ isWorking: false }) })
      expect(await band.find({ key: 'summary' })).toBeUndefined()
      expect(await band.find({ key: 'stub-band' })).toBeDefined()
      await band.unmount()
    }
  })

  // A session refuses a tree that puts the engine's own node under a Box that
  // sizes, hides or moves it ("engine node under a Box with prop ..."), and draws
  // its own band instead. The kit does not check this, so the test walks the tree.
  const ENGINE_BENEATH = {
    name: 'engine-beneath',
    tier: 'append' as const,
    register(on: On) {
      on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as never)
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

  test('the engine band beneath ours is never under a Box that sizes or hides it', { plugins: [ENGINE_BENEATH] }, async ($, on) => {
    const w = world(on, { placed: false })
    await w.spawn($, 'Busy')
    await $.command.run({ command: 'antfarm', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 90 } })
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(), viewport: DOCKED })
      expect(await band.find({ key: 'summary' })).toBeDefined()
      expect(engineNodeConcealers(await band.drawn())).toEqual([[]])
      await band.unmount()
    }
  })

  test('the engine mode labels beside the budget mark are never under a Box that sizes or hides them', { plugins: [ENGINE_BENEATH], options: { budgetUsd: 2 } }, async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Spender', { model: 'claude-opus-5-5' })
    await w.step($, id, usage('claude-opus-5-5', 550_000, 0), 'claude-opus-5-5') // ≈$2.20: over budget, so the mark draws
    for (const surface of SURFACES) {
      const modes = await $.ui.mount({ plugin: PLUGIN, surface, component: 'SessionMode', props: { modes: ['focus'] } })
      expect(await modes.find({ key: 'budget-mark' })).toBeDefined()
      expect(engineNodeConcealers(await modes.drawn())).toEqual([[]])
      await modes.unmount()
    }
  })
})

describe('alarm repeats', () => {
  test('one failed read of the total neither drops the figure nor re-arms the alarm', { options: { budgetUsd: 2 } }, async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Steady')
    w.rec.engineUsd = 2.5
    await w.step($, id, usage('claude-haiku-5-5', 1000, 100))
    expect(w.rec.toasts).toEqual(['Claude Code\'s estimate ≈$2.50 reached your $2.00 budget.'])
    w.rec.usageThrows = true
    await w.step($, id, usage('claude-haiku-5-5', 1000, 100))
    expect(w.rec.statuses.at(-1)).toBe('≈$2.50 of $2.00 budget (Claude Code\'s estimate) - over budget')
    w.rec.usageThrows = false
    w.rec.engineUsd = 2.6
    await w.step($, id, usage('claude-haiku-5-5', 1000, 100))
    expect(w.rec.toasts).toHaveLength(1)
  })

  test('a lower reading in between does not announce a level twice', { options: { budgetUsd: 2 } }, async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Jittery')
    w.rec.engineUsd = 4.4
    await w.step($, id, usage('claude-haiku-5-5', 10, 10))
    w.rec.engineUsd = 1 // a stale reading, as a slower parallel request might report
    await w.step($, id, usage('claude-haiku-5-5', 10, 10))
    w.rec.engineUsd = 4.5
    await w.step($, id, usage('claude-haiku-5-5', 10, 10))
    expect(w.rec.toasts).toEqual(['Claude Code\'s estimate ≈$4.40 is past 2x your $2.00 budget.'])
  })
})

describe('counting off the response path', () => {
  test('the response goes back before the request is counted', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Quick')
    const pane = await mountPane($, 'terminal')
    const response = await w.request($, id, usage('claude-haiku-5-5', 1000, 0))
    expect(response.usage?.input_tokens).toBe(1000)
    expect((await texts(pane)).join(' | ')).toContain('0 req · 0 tok')
    await w.clock.settle()
    expect((await texts(pane)).join(' | ')).toContain('1 req · 1k tok')
  })

  test('a count that lands after its run ended leaves the ant finished', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Last word')
    await w.request($, id, usage('claude-haiku-5-5', 1000, 0))
    await w.finish($, id)
    await w.clock.settle()
    const pane = await mountPane($, 'terminal')
    expect((await pane.find({ key: 'counts' }))?.text).toBe('0 running · 1 done · 0 failed')
    expect((await pane.find({ key: `line-${id}` }))?.text).toContain('1k tok')
  })

  test("a teammate's next turn wakes its finished ant", async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Teammate')
    await w.finish($, id)
    await w.clock.advance(1000)
    await w.step($, id, usage('claude-haiku-5-5', 1000, 0))
    const pane = await mountPane($, 'terminal')
    expect((await pane.find({ key: 'counts' }))?.text).toBe('1 running · 0 done · 0 failed')
  })

  test('two subagents crossing the budget at the same moment toast once', { options: { budgetUsd: 2 } }, async ($, on) => {
    const w = world(on)
    const a = await w.spawn($, 'One')
    const b = await w.spawn($, 'Two')
    w.rec.engineUsd = 2.5
    // Two turn ends at once each read the total and announce, interleaved.
    await Promise.all([w.finish($, a), w.finish($, b)])
    expect(w.rec.toasts).toHaveLength(1)
  })
})

describe('review cases', () => {
  test('a main turn with no subagents ticks the clock', async ($, on) => {
    const w = world(on)
    await w.startTurn($)
    const before = w.rec.invalidates
    await w.clock.advance(1500)
    expect(w.rec.invalidates).toBeGreaterThan(before)
  })

  test('the band list ends once the waiting pane is placed', async ($, on) => {
    const w = world(on, { placed: false })
    engineBand(on)
    const first = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: bandProps({ isWorking: false }), viewport: { columns: 120, rows: 40, isFullscreen: true } })
    await first.unmount()
    const id = await w.spawn($, 'Widened')
    w.rec.panes = w.rec.panes.map(p => ({ ...p, isPlaced: true, isShown: true }))
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: bandProps({ isWorking: false }), viewport: DOCKED })
    expect(await band.find({ key: `row-${id}` })).toBeUndefined()
  })

  test('a running workflow agent is not settled from the agent list', async ($, on) => {
    const w = world(on)
    await $.agent.spawn({
      tool_use_id: 'tu-wf', prompt: 'p', description: 'Workflow step', subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
      workflow: { runId: 'wf_1', agentIndex: 1 },
    })
    w.rec.listed = [] // the engine lists no workflow agent
    await w.clock.advance(12_000)
    const pane = await mountPane($, 'terminal')
    expect((await pane.find({ key: 'counts' }))?.text).toBe('1 running · 0 done · 0 failed')
  })

  test('a request is priced by the model that answered', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Fell back', { model: 'claude-opus-5-5' })
    await w.step($, id, usage('claude-sonnet-5-5', 1_000_000, 0), 'claude-opus-5-5')
    const pane = await mountPane($, 'terminal')
    expect((await pane.find({ key: 'totals' }))?.text).toStartWith('Subagents ≈$2.00 (price table) ·')
  })

  test('a request that got no response is not counted', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Interrupted')
    for (let i = 0; i < 3; i += 1) await w.step($, id, 'no-response')
    const pane = await mountPane($, 'terminal')
    expect((await texts(pane)).join('\n')).toContain('0 req · 0 tok')
  })

  test('an ant silent for 10 minutes stops the clock until it speaks again', { timeoutMs: 30_000 }, async ($, on) => {
    const w = world(on)
    await $.agent.spawn({
      tool_use_id: 'tu-wf', prompt: 'p', description: 'Remote step', subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
      workflow: { runId: 'wf_2', agentIndex: 1 },
    })
    await w.clock.advance(10 * 60_000 + 1000)
    const stopped = w.rec.invalidates
    await w.clock.advance(5000)
    expect(w.rec.invalidates).toBe(stopped)
    await w.step($, 'agent-1', usage('claude-haiku-5-5', 10, 10))
    await w.clock.advance(1000)
    expect(w.rec.invalidates).toBeGreaterThan(stopped)
  })

  test('past 50 finished subagents the pane says how many more', async ($, on) => {
    const w = world(on)
    for (let i = 0; i < 52; i += 1) await w.finish($, await w.spawn($, `Task ${i}`))
    const pane = await mountPane($, 'terminal')
    expect((await pane.find({ key: 'more-finished' }))?.text).toBe('+2 more finished')
  })
})

describe('untrusted text', () => {
  const NASTY = 'Bad\x1b[31m red\x07 bell\x00 nul\x7f del\u0085 nel\u009b2J csi\x1b]0;title\x07 end'
  const SHOWN = 'Bad red\uFFFD bell\uFFFD nul\uFFFD del\uFFFD nel csi end'

  test('control characters in a task, type or model never stop the band or the pane drawing', async ($, on) => {
    const w = world(on, { placed: false })
    engineBand(on)
    const id = await w.spawn($, NASTY, { model: 'claude-haiku-5-5\x1b[0m', type: 'Explore\x07' })
    const done = await w.spawn($, `${NASTY} 2`, { model: 'odd\x00model' })
    await w.finish($, done)
    await $.command.run({ command: 'antfarm', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 90 } })
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(), viewport: DOCKED })
      expect((await band.find({ key: `row-${id}` }))?.text).toContain(`${SHOWN} · haiku-5-5 ·`)
      expect(await band.find({ key: 'engine-band' })).toBeDefined()
      await band.unmount()
      const pane = await mountPane($, surface)
      const each = await texts(pane)
      const all = each.join(' | ')
      expect(all).toContain(SHOWN)
      expect(all).toContain(`done · ${SHOWN} 2 · odd\uFFFDmodel`)
      expect(each.some(t => /[\x00-\x1f\x7f-\x9f]/.test(t))).toBe(false)
      await pane.unmount()
    }
    expect(w.rec.toasts.every(t => !/[\x00-\x1f\x7f-\x9f]/.test(t))).toBe(true)
  })
})

describe('session', () => {
  test('session start registers /antfarm to run mid-turn', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    expect(w.rec.registered).toEqual([{ name: 'antfarm', immediate: true }])
  })

  for (const reason of ['clear', 'resume'] as const) {
    test(`a session end by ${reason} starts the farm over`, { options: { budgetUsd: 2 } }, async ($, on) => {
      const w = world(on)
      const id = await w.spawn($, 'Before', { model: 'claude-opus-5-5' })
      await w.step($, id, usage('claude-opus-5-5', 1_000_000, 0), 'claude-opus-5-5')
      await $.session.end({ reason, sessionId: 's', resume: { id: 's' } })
      expect(w.rec.statuses.at(-1)).toBeUndefined()
      const pane = await mountPane($, 'terminal')
      expect((await pane.find({ key: 'budget' }))?.text).toBe('Session ≈$0.00 of $2.00 budget (price table)')
      expect(await pane.find({ key: 'empty' })).toBeDefined()
    })
  }

  test('a session end on exit keeps the farm as it is', async ($, on) => {
    const w = world(on)
    await w.spawn($, 'Kept')
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's', resume: { id: 's' } })
    const pane = await mountPane($, 'terminal')
    expect((await pane.find({ key: 'counts' }))?.text).toBe('1 running · 0 done · 0 failed')
  })
})
