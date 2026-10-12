// The switch band above the prompt, the stripe on every row, /wear
// season, and the /wear gallery, on both surfaces, through the real wiring.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import type { BoltCell } from '../hooks/bolt'
import { rasterCells } from '../hooks/bolt-draw'
import { COSTUMES, wearBolt } from '../hooks/costume'
import { THEMES, themeById } from '../hooks/themes'
import { at, bandProps, ENGINE, PANE, start, SURFACES, TOOL_ROW, wear, world } from './setup'

const halloween = themeById('halloween')!
const dracula = themeById('dracula')!

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
const cellsAs = (surface: string, cells: BoltCell[][]) => {
  if (surface === 'terminal') return [cells[0]?.length, cells.length, rasterCells(cells)]
  return cells.map(line => line.map(c => `Box1:${c.fg === undefined && c.bg === undefined ? ' ' : `${c.ch}|${c.fg ?? ''}|${c.bg ?? ''}`}`))
}

// A session refuses a tree that puts the engine's own node under a Box that
// sizes, hides or moves it; the test walks the tree.
const CONCEALING = ['display', 'overflow', 'position', 'width', 'height', 'minWidth', 'minHeight', 'top', 'left', 'right', 'bottom']
function engineNodeConcealers(node: unknown, around: string[] = []): string[][] {
  if (node === null || typeof node !== 'object') return []
  const n = node as Drawn
  if (n.type === 'engine') return [around]
  const mine = n.type === 'Box' ? CONCEALING.filter(k => n.props?.[k] !== undefined) : []
  return (n.children ?? []).flatMap(c => engineNodeConcealers(c, [...around, ...mine]))
}

// The desktop draws a Text holding block characters in the code font, so glyph
// art there sits in one-cell Boxes of its own and no Text mixes glyphs with
// words (the walker is ant-farm's).
const GLYPH = /[▀-▟]/u
const textsOf = (node: unknown, inCell = false, out: { text: string; inCell: boolean; props: Record<string, unknown> }[] = []) => {
  if (node === null || typeof node !== 'object') return out
  const n = node as Drawn
  const cell = inCell || (n.type === 'Box' && n.props?.width === 1)
  if (n.type === 'Text') {
    const text = (n.children ?? []).filter(c => typeof c === 'string').join('')
    out.push({ text, inCell: cell, props: n.props ?? {} })
  }
  for (const c of n.children ?? []) textsOf(c, cell, out)
  return out
}

const band = ($: Engine, surface: (typeof SURFACES)[number], over: Partial<RenderPropsOf['AbovePrompt']> = {}) =>
  $.ui.mount({ plugin: 'wardrobe', surface, component: 'AbovePrompt', props: bandProps(over) })
const pane = ($: Engine, surface: (typeof SURFACES)[number], bodyColumns = 100) =>
  $.ui.mount({ plugin: 'wardrobe', surface, component: 'Pane', props: { ...PANE, bodyColumns }, requestId: 'wardrobe' })

describe('the switch band', () => {
  test('shows for six seconds after /wear <theme>, under what is beneath, then goes; nothing before', async ($, on) => {
    const w = world(on)
    await start($)
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await ui.drawn(), surface).toEqual(ENGINE) // no switch yet: nothing of ours
      await w.clock.advance(60_000) // the ticker alone raises no band
      expect(await ui.drawn(), surface).toEqual(ENGINE)

      await wear($, 'halloween')
      const tree = (await ui.drawn()) as Drawn
      expect(tree).toMatchObject({ type: 'Box', props: { flexDirection: 'column' } })
      expect(tree.children?.[0]).toEqual(ENGINE) // what is beneath draws first
      const row = await ui.find({ key: 'wardrobe-band' })
      expect(row?.text).toContain(` ${halloween.mark} wearing halloween`)
      for (const kind of ['shell', 'read', 'edit', 'write', 'search'] as const) expect(row?.text).toContain(halloween.icons[kind])
      // One row filled with the theme's background: the outer Text carries it, every run inside names it too.
      const filled = (row?.children ?? [])[0] as Drawn
      expect(filled.type).toBe('Text')
      expect(filled.props?.backgroundColor).toBe(halloween.palette.bg)
      for (const run of textsOf(filled)) expect(run.props.backgroundColor).toBe(halloween.palette.bg)
      expect([...textsOf(filled).map(t => t.text).join('')].length).toBe(100 - 4) // the row less Bolt and a gap
      // Bolt in the witch hat at the right, as a cell grid of his own.
      expect(drawnBolt(under(tree, 'wardrobe-bolt')), surface).toEqual(cellsAs(surface, wearBolt(halloween, 'tiny', 'idle')))
      expect(engineNodeConcealers(tree)).toEqual([[]])

      await w.clock.advance(5_999)
      expect(await ui.find({ key: 'wardrobe-band' }), surface).toBeDefined()
      await w.clock.advance(1)
      expect(await ui.drawn(), surface).toEqual(ENGINE)
      await w.clock.advance(60_000)
      expect(await ui.drawn(), surface).toEqual(ENGINE)
      await ui.unmount()
    }
  })

  test('a second /wear restarts it; auto and season raise it with the theme they resolve to; default raises none', async ($, on) => {
    const w = world(on, { now: new Date(2026, 9, 31, 12).getTime() })
    await start($)
    const ui = await band($, 'terminal')
    await wear($, 'dracula')
    await w.clock.advance(4_000)
    await wear($, 'nord')
    await w.clock.advance(4_000) // 8 s after the first, 4 s after the second
    expect((await ui.find({ key: 'wardrobe-band' }))?.text).toContain('wearing nord')
    await w.clock.advance(2_000)
    expect(await ui.drawn()).toEqual(ENGINE)

    await wear($, 'season')
    expect((await ui.find({ key: 'wardrobe-band' }))?.text).toContain('wearing halloween')
    await wear($, 'auto') // paper by day (noon)
    expect((await ui.find({ key: 'wardrobe-band' }))?.text).toContain('wearing paper')
    await w.clock.advance(6_000)
    await wear($, 'default')
    expect(await ui.drawn()).toEqual(ENGINE)
  })

  test('yields to a survey, to a narrow band (no Bolt), and to surfaces wardrobe does not style', async ($, on) => {
    world(on)
    await start($)
    await wear($, 'dracula')
    for (const surface of SURFACES) {
      const survey = await band($, surface, { hasSurvey: true })
      expect(await survey.drawn(), surface).toEqual(ENGINE)
      await survey.unmount()
      const narrow = await band($, surface, { bodyColumns: 59 })
      expect(await narrow.find({ key: 'wardrobe-band' }), surface).toBeDefined()
      expect(await narrow.find({ key: 'wardrobe-bolt' }), surface).toBeUndefined()
      expect([...textsOf((await narrow.drawn()) as Drawn).filter(t => t.props.backgroundColor === dracula.palette.bg).map(t => t.text).join('')].length).toBe(59)
      await narrow.unmount()
    }
    for (const surface of ['vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'AbovePrompt', props: bandProps() })
      expect(await ui.drawn()).toEqual(ENGINE)
      await ui.unmount()
    }
  })

  const STUB = {
    name: 'stub-band',
    tier: 'append' as const, // beneath wardrobe, as another installed band mod may be
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

  test('another mod band still draws, ahead of ours', { plugins: [STUB] }, async ($, on) => {
    world(on)
    await start($)
    await wear($, 'dracula')
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect((await ui.find({ key: 'stub-band' }))?.text).toBe('another mod')
      expect(await ui.find({ key: 'wardrobe-band' })).toBeDefined()
      const order = (await ui.findAll({ type: 'Box' })).map(b => b.key).filter(k => k === 'stub-band' || k === 'wardrobe-band')
      expect(order).toEqual(['stub-band', 'wardrobe-band'])
      await ui.unmount()
    }
  })
})

describe('the stripe', () => {
  test('opens every tool row and group row in the theme accent, before the icon', async ($, on) => {
    world(on)
    await start($)
    const group: RenderPropsOf['ToolGroup'] = {
      calls: [{ tool_use_id: 't', tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false }],
      isActive: false,
      isExpanded: false,
    }
    for (const theme of [dracula, halloween]) {
      await wear($, theme.id)
      for (const surface of SURFACES) {
        const row = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolUse', props: TOOL_ROW })
        const folded = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolGroup', props: group })
        for (const ui of [row, folded]) {
          const stripe = await ui.find({ key: 'stripe' })
          expect(stripe?.text).toBe(' ')
          expect((stripe?.children[0] as Drawn).props).toEqual({ color: theme.palette.bg, backgroundColor: theme.palette.accent })
          const first = ((await ui.drawn()) as Drawn).children?.[0] as Drawn
          expect(first.props?.key).toBe('stripe')
          await ui.unmount()
        }
      }
    }
  })
})

describe('/wear season', () => {
  const window = (month: number, day: number) => new Date(2026, month - 1, day, 12).getTime()
  const cases: [number, number, string, string][] = [
    [10, 31, 'halloween', 'Oct 15 to Nov 1'],
    [12, 25, 'christmas', 'Dec 1 to Jan 6'],
    [1, 3, 'christmas', 'Dec 1 to Jan 6'],
    [2, 14, 'nord', 'Jan 7 to the end of Feb'],
    [4, 1, 'spring', 'Mar 1 to May 31'],
    [7, 4, 'summer', 'Jun 1 to Aug 31'],
    [9, 20, 'autumn', 'Sep 1 to Nov 30, Halloween aside'],
  ]
  for (const [month, day, theme, when] of cases) {
    test(`on ${month}/${day} wears ${theme}, stored as season`, async ($, on) => {
      const w = world(on, { now: window(month, day) })
      await start($)
      expect(await wear($, 'season')).toBe(`Wearing season everywhere without a pin: ${theme} now (${when}).`)
      expect(w.store.get('global')).toBe('season')
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 3000 } })
      expect((await ui.find({ key: 'turn' }))?.text).toBe(` ${themeById(theme)!.mark} Baked for 3s `)
      const list = await pane($, 'terminal')
      expect((await list.find({ key: 'theme-season' }))?.text).toContain(`by the calendar: ${theme} now (${when})`)
      expect((await list.find({ key: 'theme-season' }))?.text).toContain('(wearing)')
    })
  }

  test('is re-resolved by the ticker as the date turns, like auto', async ($, on) => {
    const w = world(on, { now: new Date(2026, 10, 1, 23, 59, 30).getTime() })
    await start($)
    await wear($, 'season')
    const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 3000 } })
    expect((await ui.find({ key: 'turn' }))?.text).toBe(` ${halloween.mark} Baked for 3s `)
    await w.clock.advance(60_000) // Nov 2, 00:00:30
    expect((await ui.find({ key: 'turn' }))?.text).toBe(` ${themeById('autumn')!.mark} Baked for 3s `)
    expect(w.store.get('global')).toBe('season')
  })

  test('a pin may hold season, and the short forms reach the packs', async ($, on) => {
    const w = world(on, { now: window(12, 24), root: '/work/alpha' })
    await start($)
    await wear($, 'season')
    expect(await wear($, 'pin')).toBe('Pinned season to /work/alpha. Other projects keep the global choice.')
    expect(w.store.get('pins')).toEqual({ '/work/alpha': 'season' })
    expect(await wear($, 'xmas')).toBe('Wearing christmas in this project (pinned).')
    expect(await wear($, 'fall')).toBe('Wearing autumn in this project (pinned).')
  })
})

describe('the /wear gallery', () => {
  test('every theme is a card: name, blurb, the sample row as toolRow draws it, the diff chips, Bolt in costume, a wear button', async ($, on) => {
    world(on)
    await start($)
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      const tree = await ui.drawn()
      for (const theme of THEMES) {
        const card = under(tree, `theme-${theme.id}`)
        expect(card, `${surface} ${theme.id}`).toBeDefined()
        const found = await ui.find({ key: `theme-${theme.id}` })
        expect(found?.text).toContain(theme.id)
        expect(found?.text).toContain(theme.blurb)
        expect(found?.text).toContain('Read src/app.ts')
        // The sample row is toolRow's: the stripe, the read icon chip, the text, a done chip with the time.
        const stripe = under(card, 'stripe') as Drawn
        expect((stripe.children?.[0] as Drawn).props).toEqual({ color: theme.palette.bg, backgroundColor: theme.palette.accent })
        const icon = under(card, 'icon') as Drawn
        expect((icon.children?.[0] as Drawn).children).toEqual([` ${theme.icons.read} `])
        expect((icon.children?.[0] as Drawn).props).toEqual({ color: theme.palette.info, backgroundColor: theme.palette.bg }) // KIND_ROLE.read
        const status = under(card, 'status') as Drawn
        expect((status.children?.[0] as Drawn).children).toEqual([` ${theme.status.done} 300ms `])
        expect((status.children?.[0] as Drawn).props).toEqual({ color: theme.palette.ok, backgroundColor: theme.palette.bg })
        expect(JSON.stringify(card)).toContain(JSON.stringify({ color: theme.diff.addFg, backgroundColor: theme.diff.addBg }))
        expect(JSON.stringify(card)).toContain(JSON.stringify({ color: theme.diff.removeFg, backgroundColor: theme.diff.removeBg }))
        // Bolt, small, in this theme's costume (plain where the theme has none).
        expect(drawnBolt(under(card, `bolt-${theme.id}`)), `${surface} ${theme.id}`).toEqual(cellsAs(surface, wearBolt(theme, 'small', 'idle')))
        const button = (await ui.findAll({ type: 'Button' })).find(b => b.key === `wear-${theme.id}`)
        expect(button?.props.label).toBe('wear')
        expect(button?.props.hotkey).toBeUndefined() // the pane can hold the focus (gotcha 24)
      }
      for (const choice of ['default', 'auto', 'season']) {
        expect(await ui.find({ key: `theme-${choice}` })).toBeDefined()
        expect((await ui.findAll({ type: 'Button' })).some(b => b.key === `wear-${choice}`)).toBe(true)
      }
      expect((await ui.find({ key: 'theme-default' }))?.text).toContain('(wearing)')
      expect(await ui.findAll({ type: 'Button' })).toHaveLength(THEMES.length + 3)
      await ui.unmount()
    }
  })

  test('Bolt is small from 60 columns, tiny from 40, and out under 40', async ($, on) => {
    world(on)
    await start($)
    for (const surface of SURFACES) {
      const wide = await pane($, surface, 60)
      expect(drawnBolt(under(await wide.drawn(), 'bolt-dracula'))).toEqual(cellsAs(surface, wearBolt(dracula, 'small', 'idle')))
      await wide.unmount()
      const mid = await pane($, surface, 59)
      expect(drawnBolt(under(await mid.drawn(), 'bolt-dracula'))).toEqual(cellsAs(surface, wearBolt(dracula, 'tiny', 'idle')))
      expect(await mid.find({ key: 'theme-dracula' })).toBeDefined()
      await mid.unmount()
      const narrow = await pane($, surface, 39)
      expect(under(await narrow.drawn(), 'bolt-dracula')).toBeUndefined()
      expect((await narrow.find({ key: 'theme-dracula' }))?.text).toContain(dracula.blurb)
      await narrow.unmount()
    }
  })

  test('a card wear button wears that theme, the pane marks it, a toast says so, and the band rises', async ($, on) => {
    const w = world(on)
    await start($)
    for (const [surface, id] of [['terminal', 'halloween'], ['desktop', 'summer']] as const) {
      const ui = await pane($, surface)
      w.heard.length = 0
      await ui.press({ key: `wear-${id}` })
      await w.clock.settle()
      expect(w.store.get('global')).toBe(id)
      expect(w.heard).toEqual([{ via: 'toast', text: `Wearing ${id} everywhere without a pin.`, timeoutMs: 4000 }])
      expect((await ui.find({ key: `theme-${id}` }))?.text).toContain('(wearing)')
      expect((await ui.find({ key: 'theme-default' }))?.text).not.toContain('(wearing)')
      expect(await ui.find({ type: 'Text', text: `Wearing ${id} everywhere without a pin.` })).toBeDefined()
      const above = await band($, surface)
      expect((await above.find({ key: 'wardrobe-band' }))?.text).toContain(`wearing ${id}`)
      await above.unmount()
      await ui.unmount()
    }
    const ui = await pane($, 'terminal')
    await ui.press({ key: 'wear-default' })
    await w.clock.settle()
    expect(w.store.get('global')).toBe('default')
    expect((await ui.find({ key: 'theme-default' }))?.text).toContain('(wearing)')
    await ui.press({ key: 'wear-season' })
    await w.clock.settle()
    expect(w.store.get('global')).toBe('season')
    expect((await ui.find({ key: 'theme-season' }))?.text).toContain('(wearing)')
  })

  test('desktop: no Text mixes block glyphs with words; the terminal keeps the art in Rasters', async ($, on) => {
    world(on)
    await start($)
    await wear($, 'christmas')
    const desk = await pane($, 'desktop')
    const texts = textsOf(await desk.drawn())
    expect(texts.some(t => GLYPH.test(t.text))).toBe(true)
    for (const t of texts.filter(t => GLYPH.test(t.text))) {
      expect(t.inCell, t.text).toBe(true)
      expect([...t.text].length, t.text).toBe(1)
    }
    await desk.unmount()
    const deskBand = await band($, 'desktop')
    const bandTexts = textsOf(await deskBand.drawn())
    expect(bandTexts.some(t => GLYPH.test(t.text))).toBe(true)
    for (const t of bandTexts.filter(t => GLYPH.test(t.text))) expect(t.inCell, t.text).toBe(true)
    for (const t of bandTexts.filter(t => /wearing/.test(t.text))) expect(GLYPH.test(t.text)).toBe(false)
    await deskBand.unmount()
    for (const mount of [pane($, 'terminal'), band($, 'terminal')]) {
      const ui = await mount
      expect(textsOf(await ui.drawn()).some(t => GLYPH.test(t.text))).toBe(false)
      expect((await ui.findAll({ type: 'Raster' })).length).toBeGreaterThan(0)
      await ui.unmount()
    }
  })

  test('the plain-text list carries the same cards without the art, in a -p run', async ($, on) => {
    world(on, { surfaces: [], now: new Date(2026, 9, 31, 12).getTime() })
    await start($)
    await wear($, 'halloween')
    const list = await wear($, '')
    for (const theme of THEMES) {
      expect(list).toContain(`- ${theme.id} (${theme.tone}) `)
      expect(list).toContain(`${theme.icons.read} Read src/app.ts ${theme.status.done} 300ms  +add -del  Bolt: ${COSTUMES[theme.id]!.name}`)
    }
    expect(list).toContain('- halloween (dark) ▸●◆■◉: Pumpkin orange, violet and bone white on near-black (wearing)')
    expect(list).toContain('- season: by the calendar: halloween now (Oct 15 to Nov 1)')
    expect(list).toContain('- auto: paper from 07:00, tokyo-night from 19:00')
    expect(list).not.toMatch(/[▀-▟]/u)
  })
})

describe('the band and the clock', () => {
  test('the band is the one timer wear sets: no interval of its own beyond the minute ticker', async ($, on) => {
    // The kit's clock hooks these events already, so a second hook needs a matcher (gotcha 19).
    let afters = 0
    let everies = 0
    on('clock.after', { ms: 6_000 }, ($, e, next) => ((afters += 1), next(e)))
    on('clock.every', { ms: 60_000 }, ($, e, next) => ((everies += 1), next(e)))
    const w = world(on)
    await start($)
    expect(everies).toBe(1)
    expect(afters).toBe(0)
    await wear($, 'dracula')
    expect(afters).toBe(1)
    await w.clock.advance(7_000)
    expect(afters).toBe(1)
    expect(everies).toBe(1)
    await wear($, 'default')
    expect(afters).toBe(1) // nothing to show, nothing to take down
  })

  test('at() in the kit is a local date today-ish: the gallery season row follows the kit clock', async ($, on) => {
    world(on, { now: at(9, 0) }) // Oct 8 2026: autumn
    await start($)
    const ui = await pane($, 'terminal')
    expect((await ui.find({ key: 'theme-season' }))?.text).toContain('by the calendar: autumn now (Sep 1 to Nov 30, Halloween aside)')
  })
})
