// The desktop app draws Text in a proportional font, so the board's
// field is drawn one code-font cell per character there; the terminal keeps
// its plain text rows.

import { expect } from 'claude-code/testing'

import { BAND, VIEWPORT, boardOf, fieldText, halftime, world } from './fixtures'
import { test } from './limit'

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
const kids = (n: Node) => (n.children ?? []) as Node[]
/** The board's field rows as drawn: a row Box of cells, or a Text. */
function fieldRows(tree: unknown): Node[] {
  return kids(tree as Node).slice(1, 1 + 4)
}

test('on desktop every field character sits in its own one-cell Box, so columns line up', async ($, on) => {
  world(on, { store: new Map() })
  await $.turn.start({ text: 'refactor the parser', turnId: 'main-1' })
  await $.command.run(halftime('cratehop'))
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'halftime', surface, component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
    const board = (await boardOf(ui))!
    const rows = fieldRows(await ui.drawn({ in: board.key }))
    expect(rows.length, surface).toBeGreaterThan(0)
    const text = fieldText(board)
    rows.forEach((row, i) => {
      if (surface === 'terminal') return expect(row.type, surface).toBe('Text')
      expect(row.type).toBe('Box')
      expect(row.props?.flexDirection).toBe('row')
      // The cells' widths add up to the row's characters: no glyph is left to drift.
      const width = kids(row).reduce((sum, cell) => sum + Number(cell.props?.width ?? 0), 0)
      expect(width, `row ${i}`).toBe([...(text[i] ?? '')].length)
      for (const cell of kids(row)) expect(cell.type).toBe('Box')
    })
    await ui.unmount()
  }
})
