// What the receipt counts, from the usage the model requests report, and how
// a resume, a compaction and a session without caching change the picture.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { boltOf, rasterCells } from '../hooks/bolt-draw'
import { warmBar } from '../hooks/receipt'
import type { BoltPick } from '../hooks/bolt-draw'
import { API_KEY, MIN, PANE_PROPS, SLOW, command, paneText, start, step, submit, usage, world } from './world'

test('a send that re-reads the conversation cold is booked with what it cost over warm', { ...SLOW, options: { guard: 'off' } }, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000))
  await w.clock.advance(70 * MIN)
  await submit($, 'back again')
  // Read nothing back, wrote 150k: the cache had lapsed.
  await step($, w, usage(0, 150_000))
  // The next request in the same turn reads it again: warm, not counted.
  await step($, w, usage(150_000, 3_000))

  const receipt = await command($, w, 'thermostat')
  // 150k x ($8 write - $0.20 read) per MTok at Opus 5.5's 1-hour rates.
  expect(receipt).toContain('Cold sends paid: 1')
  expect(receipt).toContain('150k tokens re-read, ≈$1.17 more than warm')
  expect(receipt).toContain('Warm · 60m left')
  expect(receipt).toContain('60m window, subscription login')
  expect(receipt).toContain('On a subscription these measure plan usage, not a bill.')
  expect(receipt).toContain('Session total: ≈$4.20')
  expect(receipt).toContain("Claude Code's estimate, as /cost shows it")
})

test('subagent requests do not move the main cache or count as cold sends', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000))
  await w.clock.advance(65 * MIN)
  await step($, w, usage(0, 40_000), 'agent-1')
  const receipt = await command($, w, 'thermostat')
  expect(receipt).toContain('cold for 5m')
  expect(receipt).not.toContain('Cold sends paid')
})

test('a resume picks up how long ago the last reply was, and pins the window from the engine', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  // 30 minutes ago, and Claude Code says the cache has expired: so the window is 5 minutes.
  await $.classic.SessionStart({
    source: 'resume',
    model: 'claude-sonnet-5-5',
    seconds_since_last_response: 30 * 60,
    context_tokens: 120_000,
    prompt_cache_likely_expired: true,
  })
  const receipt = await command($, w, 'thermostat')
  expect(receipt).toContain('Cold · 120k to re-read')
  expect(receipt).toContain('cold for 25m; 5m window, as Claude Code reported it')
  // Sonnet 5.5: 120k x $2.50 (5-minute write) cold, x $0.20 warm.
  expect(receipt).toContain('Next send ≈$0.30 cold, ≈$0.02 warm (120k tokens, Sonnet 5 and 5.5 prices)')
  const held = await submit($, 'where were we')
  expect(held.drop).toContain('re-reads 120k tokens')
  expect(w.toasts).toEqual([])
})

test('compaction starts the cache over, so the next send is neither held nor booked as cold', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000))
  await w.clock.advance(70 * MIN)
  await $.classic.SessionStart({ source: 'compact' })
  expect((await submit($, 'continue')).drop).toBeUndefined()
  await step($, w, usage(15_000, 20_000))
  expect(await command($, w, 'thermostat')).not.toContain('Cold sends paid')
})

test('a session without prompt caching shows "cache off" and is never held', SLOW, async ($, on) => {
  const w = world(on, API_KEY)
  await start($)
  await step($, w, usage(0, 0, { input_tokens: 60_000 }))
  expect(await command($, w, 'thermostat')).toContain('Caching looks off')
  await w.clock.advance(30 * MIN)
  expect((await submit($, 'hello')).drop).toBeUndefined()
  await step($, w, usage(0, 0, { input_tokens: 62_000 }))
  expect(await command($, w, 'thermostat')).not.toContain('Cold sends paid')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`on ${surface} /thermostat opens a live receipt pane and tells the model nothing`, SLOW, async ($, on) => {
    const w = world(on)
    w.surfaces = [surface]
    await start($)
    await step($, w, usage(140_000, 9_000))
    await command($, w, 'thermostat')
    expect(w.panes).toEqual(['thermostat-receipt'])
    expect(w.logs).toEqual([])
    const first = await paneText($, surface)
    expect(first).not.toContain('Thermostat receipt for this session') // the engine's title bar names the mod
    expect(first).toContain('Warm · 60m left')
    await w.clock.advance(10 * MIN)
    expect(await paneText($, surface)).toContain('Warm · 50m left')
  })
}

test('with no surface to draw a pane, the receipt is a transcript note', SLOW, async ($, on) => {
  const w = world(on)
  w.surfaces = []
  await start($)
  await step($, w, usage(140_000, 9_000))
  expect(await command($, w, 'thermostat')).toContain('Thermostat receipt for this session')
  expect(w.panes).toEqual([])
})

test('a receipt pane that is not placed falls back to a transcript note', SLOW, async ($, on) => {
  const w = world(on)
  w.isPanePlaced = false
  await start($)
  await step($, w, usage(140_000, 9_000))
  await command($, w, 'thermostat')
  expect(w.logs.at(-1)).toContain('Warm · 60m left')
})

test('both commands run at once, even while a turn is in flight', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toContainEqual(expect.objectContaining({ name: 'warm', immediate: true }))
  expect(w.registered).toContainEqual(expect.objectContaining({ name: 'thermostat', immediate: true }))
})

describe('Bolt beside the receipt', () => {
  // Bolt: asleep beside the receipt's first line while the cache is cold or
  // empty, up while it is warm, and out of the way in a narrow pane. A Raster on the
  // terminal, one code-font cell per character on the desktop. The hold notice and
  // the footer countdown never show it.
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
  /** Bolt as drawn: the Raster's cells, or each desktop row as `width:ch|fg|bg` per one-cell Box. */
  const drawnBolt = (bolt: Drawn | undefined) => {
    if (bolt === undefined) return undefined
    if (bolt.type === 'Raster') return [bolt.props?.columns, bolt.props?.rows, bolt.props?.cells]
    return ((bolt.children ?? []) as Drawn[]).map(line =>
      ((line.children ?? []) as Drawn[]).map(cell => {
        const text = (cell.children ?? [])[0] as Drawn | undefined
        const paint = text === undefined ? ' ' : `${(text.children ?? []).join('')}|${text.props?.color ?? ''}|${text.props?.backgroundColor ?? ''}`
        return `${String(cell.type)}${String(cell.props?.width)}:${paint}`
      }),
    )
  }
  /** What `pick` must draw as on `surface`: its exact cells, at its exact size. */
  const boltAs = (surface: string, pick: BoltPick) => {
    const cells = boltOf(pick)
    if (surface === 'terminal') return [cells[0]?.length, cells.length, rasterCells(cells)]
    return cells.map(line =>
      line.map(c => `Box1:${c.fg === undefined && c.bg === undefined ? ' ' : `${c.ch}|${c.fg ?? ''}|${c.bg ?? ''}`}`),
    )
  }
  const SLEEP: BoltPick = { size: 'small', pose: 'sleep' }
  const IDLE: BoltPick = { size: 'small', pose: 'idle' }
  const SURFACES = ['terminal', 'desktop'] as const
  const pane = ($: Engine, surface: (typeof SURFACES)[number], bodyColumns = 100) =>
    $.ui.mount({ plugin: 'thermostat', surface, component: 'Pane', requestId: 'thermostat-receipt', props: { ...PANE_PROPS, bodyColumns } })

  test('Bolt sleeps beside the first line while nothing is cached, and stands once the cache is warm', SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      const tree = await ui.drawn()
      expect(drawnBolt(under(under(tree, 'head'), 'bolt')), surface).toEqual(boltAs(surface, SLEEP))
      expect(under(tree, 'bolt')?.type).toBe(surface === 'terminal' ? 'Raster' : 'Box')
      expect((await ui.find({ key: 'head' }))?.text).toContain('Nothing cached yet')
      expect((await ui.findAll({ type: 'Text' })).map(one => one.text)).toContain('60m window, subscription login')
      await ui.unmount()
    }
    await step($, w, usage(140_000, 9_000))
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect(drawnBolt(under(await ui.find({ key: 'head' }), 'bolt')), surface).toEqual(boltAs(surface, IDLE))
      expect((await ui.find({ key: 'head' }))?.text).toContain('Warm · 60m left')
      expect((await ui.findAll({ type: 'Text' })).map(one => one.text).join('\n')).toContain('Warm · 60m left')
      await ui.unmount()
    }
  })

  test('a receipt left open puts Bolt to sleep when the cache goes cold, on the redraw it already gets', SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    await step($, w, usage(140_000, 9_000))
    const panes = []
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect(drawnBolt(await ui.find({ key: 'bolt' })), surface).toEqual(boltAs(surface, IDLE))
      panes.push([surface, ui] as const)
    }
    const redraws = w.invalidates
    await w.clock.advance(61 * MIN)
    // Only the countdown's own 30-second redraw: Bolt adds no timer of its own.
    expect(w.invalidates - redraws).toBe(122)
    for (const [surface, ui] of panes) {
      expect(drawnBolt(await ui.find({ key: 'bolt' })), surface).toEqual(boltAs(surface, SLEEP))
      const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
      expect(texts).toContain('Cold · 150k to re-read')
      expect(texts).toContain('cold for 1m; 60m window, subscription login')
      expect(texts).toContain('Next send ≈$1.20 cold, ≈$0.03 warm (150k tokens, Opus 5.5 prices)')
      await ui.unmount()
    }
  })

  test('a narrow receipt leaves Bolt out and keeps every line', SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    await step($, w, usage(140_000, 9_000))
    for (const surface of SURFACES) {
      const ui = await pane($, surface, 39)
      expect(await ui.find({ key: 'bolt' }), surface).toBeUndefined()
      expect(await ui.find({ key: 'head' })).toBeUndefined()
      const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
      expect(texts[0]).toBe('Warm · 60m left')
      expect(texts.join('\n')).toContain('60m window, subscription login')
      await ui.unmount()
    }
  })

  test('the hold notice and the footer countdown stay as they were, with no Bolt', SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    await step($, w, usage(140_000, 9_000))
    await w.clock.advance(70 * MIN)
    const held = await submit($, 'back again')
    expect(held.drop).toMatch(/^Cache went cold 10m ago: this send re-reads 150k tokens \(~\$[\d.]+ vs ~\$[\d.]+ warm, [^)]+\)\.\nSend again to go ahead, or \/clear to start fresh\.$/)
    expect(held.drop).not.toContain('Thermostat held')
    for (const surface of SURFACES) {
      const footer = await $.ui.mount({ plugin: 'thermostat', surface, component: 'SessionMode', props: { modes: [] } })
      expect((await footer.find({ key: 'thermostat' }))?.text).toBe('cache cold · 150k to re-read')
      expect(await footer.find({ key: 'bolt' })).toBeUndefined()
      await footer.unmount()
    }
  })
})

describe('the receipt follows the UI standard', () => {
  type Node = { type?: unknown; key?: unknown; props?: Record<string, unknown>; children?: unknown[] }
  const walk = (node: unknown, out: Node[] = []): Node[] => {
    if (node === null || typeof node !== 'object') return out
    const n = node as Node
    out.push(n)
    for (const c of n.children ?? []) walk(c, out)
    return out
  }
  const textOf = (n: Node) => (n.children ?? []).filter((c): c is string => typeof c === 'string').join('')
  const keyOf = (n: Node) => (n.key ?? n.props?.key) as string | undefined
  const SURFACES = ['terminal', 'desktop'] as const
  const mount = ($: Engine, surface: (typeof SURFACES)[number]) =>
    $.ui.mount({ plugin: 'thermostat', surface, component: 'Pane', requestId: 'thermostat-receipt', props: { ...PANE_PROPS, bodyColumns: 40 } })

  test('a hero in colour, zero figures folded into one line, one footnote, no title and nothing cut at 40 columns', SLOW, async ($, on) => {
    world(on)
    await start($)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      const nodes = walk(await ui.drawn())
      const texts = nodes.filter(n => n.type === 'Text')
      expect(texts.some(n => textOf(n).startsWith('Thermostat receipt')), surface).toBe(false)
      expect(texts.find(n => textOf(n) === 'Nothing cached yet')?.props, surface).toMatchObject({ bold: true, color: 'subtle' })
      expect(texts.map(textOf)).toContain('Nothing paid cold, held or pinged yet')
      expect(texts.map(textOf).filter(t => t.startsWith('Dollars are API list prices')), surface).toHaveLength(1)
      for (const n of texts) expect(n.props?.wrap, `${surface}: ${textOf(n)}`).not.toBe('truncate-end')
      // Only the session total (Claude Code keeps a ledger here) and the guard: every zero figure is folded.
      expect(nodes.filter(n => n.type === 'Box' && keyOf(n)?.startsWith('row-')).map(keyOf), surface).toEqual(['row-total', 'row-guard'])
      await ui.unmount()
    }
  })

  test('while warm: the hero bold in success, a ten-cell bar in one-cell glyphs on the desktop; after a hold: a row with the figure at the right edge', SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    await step($, w, usage(140_000, 9_000))
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      const nodes = walk(await ui.drawn())
      const texts = nodes.filter(n => n.type === 'Text')
      expect(texts.find(n => textOf(n) === 'Warm · 60m left')?.props, surface).toMatchObject({ bold: true, color: 'success' })
      // The bar's own glyphs (Bolt's cells are block characters too, apart from these).
      const glyphs = walk(nodes.find(n => n.type === 'Box' && keyOf(n) === 'window')).filter(n => n.type === 'Text').map(textOf).filter(t => /^[█░]+$/u.test(t))
      expect(glyphs.join(''), surface).toBe('██████████')
      if (surface === 'desktop') for (const g of glyphs) expect([...g]).toHaveLength(1)
      else expect(glyphs).toHaveLength(1)
      expect(texts.map(textOf)).toContain('Next send ≈$0.03 warm, ≈$1.20 cold (150k tokens, Opus 5.5 prices)')
      await ui.unmount()
    }
    await w.clock.advance(70 * MIN)
    expect((await submit($, 'back again')).drop).toBeDefined()
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      const nodes = walk(await ui.drawn())
      const texts = nodes.filter(n => n.type === 'Text')
      expect(texts.find(n => textOf(n) === 'Cold · 150k to re-read')?.props, surface).toMatchObject({ bold: true, color: 'subtle' })
      const row = nodes.find(n => n.type === 'Box' && keyOf(n) === 'row-held')
      const parts = (row?.children ?? []) as Node[]
      expect(parts.map(keyOf), surface).toEqual(['label', 'value'])
      expect(parts[0]?.props).toMatchObject({ flexGrow: 1 })
      expect(parts[1]?.props).toMatchObject({ justifyContent: 'flex-end', flexShrink: 0 })
      expect(walk(parts[1]).filter(n => n.type === 'Text').map(textOf)).toEqual(['1'])
      expect(walk(parts[0]).find(n => n.type === 'Text')?.props?.color).toBe('subtle')
      expect(texts.map(textOf)).not.toContain('Nothing paid cold, held or pinged yet')
      await ui.unmount()
    }
  })
})

test('the window bar fills by what is left, rounded, and is empty with no window', () => {
  expect(warmBar(60 * MIN, 60 * MIN)).toBe('██████████')
  expect(warmBar(50 * MIN, 60 * MIN)).toBe('████████░░')
  expect(warmBar(2 * MIN, 60 * MIN)).toBe('░░░░░░░░░░')
  expect(warmBar(0, 60 * MIN)).toBe('░░░░░░░░░░')
  expect(warmBar(10 * MIN, 0)).toBe('░░░░░░░░░░')
  expect(warmBar(90 * MIN, 60 * MIN)).toBe('██████████')
})
