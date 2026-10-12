// No row of the pane may be wider than the pane: a row that cannot shrink
// below the pane's width spills past the terminal's edge, and the terminal
// wraps it onto the next line, shifting every row beneath (the engine's own
// permission box among them). This estimates each node's narrowest width
// from the drawn tree the way the layout engine would: a Text that wraps or
// truncates can shrink to nothing, a glyph row cannot, an explicit width is
// fixed, and a Box that may not shrink is as wide as its content.

import { describe, expect, test } from 'claude-code/testing'

import { DOCKED, PANE, PLUGIN, SURFACES, paneProps, usage, world } from './world'

type Drawn = { type?: unknown; key?: unknown; props?: Record<string, unknown>; children?: unknown[] }

const cells = (s: string) => [...s].length

/** The narrowest width a node can take, and the widest it asks for when nothing shrinks it. */
function widths(node: unknown): { min: number; max: number; label: string } {
  if (typeof node === 'string') return { min: 0, max: cells(node), label: node.slice(0, 20) }
  if (node === null || typeof node !== 'object') return { min: 0, max: 0, label: '' }
  const n = node as Drawn
  const p = n.props ?? {}
  if (n.type === 'Text') {
    const text = (n.children ?? []).map(c => (typeof c === 'string' ? c : '')).join('')
    const w = cells(text)
    // A Text with no wrap set wraps at the box edge; a truncating one cuts: both shrink to nothing.
    return { min: 0, max: w, label: `Text ${text.slice(0, 24)}` }
  }
  if (n.type === 'Button') return { min: cells(`${typeof p.hotkey === 'string' ? `${p.hotkey}: ` : ''}${String(p.label ?? '')}`) + (p.plain === true ? 0 : 4), max: 0, label: `Button ${String(p.key)}` }
  if (n.type === 'Raster') return { min: Number(p.columns ?? 0), max: Number(p.columns ?? 0), label: 'Raster' }
  if (n.type !== 'Box') return { min: 0, max: 0, label: String(n.type) }
  const kids = (n.children ?? []).map(widths)
  const row = p.flexDirection === undefined || p.flexDirection === 'row' || p.flexDirection === 'row-reverse'
  const gap = Number(p.gap ?? p.columnGap ?? 0)
  let min = row ? kids.reduce((s, k) => s + k.min, 0) + Math.max(0, kids.length - 1) * gap : Math.max(0, ...kids.map(k => k.min))
  let max = row ? kids.reduce((s, k) => s + k.max, 0) + Math.max(0, kids.length - 1) * gap : Math.max(0, ...kids.map(k => k.max))
  const extra = Number(p.marginLeft ?? 0) + Number(p.marginRight ?? 0) + 2 * Number(p.marginX ?? 0) + Number(p.paddingLeft ?? 0) + Number(p.paddingRight ?? 0) + 2 * Number(p.paddingX ?? 0) + (p.borderStyle !== undefined ? 2 : 0)
  const margins = Number(p.marginLeft ?? 0) + Number(p.marginRight ?? 0) + 2 * Number(p.marginX ?? 0)
  // A width is the border box: padding and border sit inside it; margins never do.
  if (typeof p.width === 'number') return { min: p.width + margins, max: p.width + margins, label: `Box ${String(n.key ?? p.key ?? '')}` }
  if (p.flexShrink === 0) min = Math.max(min, max)
  return { min: min + extra, max: max + extra, label: `Box ${String(n.key ?? p.key ?? '')}` }
}

/** Every row Box whose narrowest width is past `limit`, outermost first. */
function tooWide(node: unknown, limit: number, out: string[] = []): string[] {
  if (node === null || typeof node !== 'object') return out
  const n = node as Drawn
  const w = widths(n)
  if (n.type === 'Box' && w.min > limit) out.push(`${w.label}: needs ${w.min} of ${limit}`)
  for (const c of n.children ?? []) tooWide(c, limit, out)
  return out
}

describe('no row wider than the pane', () => {
  for (const columns of [30, 40, 60, 77, 84, 100, 116, 140]) {
    test(`at ${columns} columns, with long names, the inspector open and the timeline full`, async ($, on) => {
      const w = world(on)
      const ids: string[] = []
      for (let i = 0; i < 7; i += 1) {
        const id = await w.spawn($, `Task ${i} with a very long description that goes on and on past any card or line width ${'x'.repeat(60)}`, { model: i % 2 === 0 ? 'claude-sonnet-4-6' : 'claude-haiku-5-5' })
        ids.push(id)
        for (let s = 0; s < 5; s += 1) await w.step($, id, usage('claude-sonnet-4-6', 400_000 + s * 100_000, 9000), 'claude-sonnet-4-6')
        await w.callTool($, id, 'Bash', { command: `echo ${'y'.repeat(120)}` })
        await w.callTool($, id, 'Edit', { file_path: `/a/very/long/path/${'z'.repeat(80)}.ts` })
        if (i === 1) await w.finish($, id)
        if (i === 2) await w.finish($, id, 'error')
      }
      w.rec.checkDecision = 'ask'
      await w.check($, ids[3] ?? '', 'Bash', { command: 'rm -rf x' })
      await w.clock.advance(70 * 60_000) // long elapsed times
      for (const surface of SURFACES) {
        const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: paneProps({ bodyColumns: columns, isFocused: true }), viewport: DOCKED })
        if ((await pane.find({ key: `inspect-${ids[0]}` })) !== undefined) await pane.press({ key: `inspect-${ids[0]}` }) // compact rows carry no button
        await pane.press({ key: 'toggle-finished' })
        const tree = await pane.drawn()
        expect(tooWide(tree, columns), `${surface} ${columns}`).toEqual([])
        expect(widths(tree).min, `${surface} ${columns} root`).toBeLessThanOrEqual(columns)
        await pane.unmount()
      }
    })
  }
})
