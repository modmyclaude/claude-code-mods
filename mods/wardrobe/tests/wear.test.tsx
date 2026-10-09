// /wear through the real wiring: the command, the store, the session's root,
// the clock, and the drawings that follow the worn theme live.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { boltOf, rasterCells } from '../hooks/bolt-draw'
import type { BoltPick } from '../hooks/bolt-draw'
import { themeById } from '../hooks/themes'
import { at, ENGINE, PANE, start, SURFACES, TOOL_ROW, wear, world } from './setup'

const dracula = themeById('dracula')!
const nord = themeById('nord')!
const paper = themeById('paper')!

describe('/wear', () => {
  test('with no argument opens a pane listing every theme with a preview in its own colours', async ($, on) => {
    const w = world(on)
    await start($)
    expect(await wear($, '')).toBe('') // nothing for the transcript: the pane shows it
    expect(w.panes).toEqual(['wardrobe'])

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'Pane', props: PANE, requestId: 'wardrobe' })
      const row = await ui.find({ key: 'theme-dracula' })
      expect(row?.text).toContain('dracula')
      expect(row?.text).toContain(dracula.blurb)
      // The preview chips are painted in the theme's own diff colours.
      const adds = await ui.findAll({ type: 'Text', text: ' + add ' })
      expect(adds).toHaveLength(9)
      expect(adds.map(chip => chip.props.backgroundColor)).toContain(dracula.diff.addBg)
      expect((await ui.find({ key: 'theme-default' }))?.text).toContain('(wearing)')
      expect((await ui.find({ key: 'theme-dracula' }))?.text).not.toContain('(wearing)')
      await ui.unmount()
    }
  })

  test('<theme> restyles what is already drawn, live, and default hands it back', async ($, on) => {
    world(on)
    await start($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolUse', props: TOOL_ROW, requestId: TOOL_ROW.tool_use_id })
      expect(await ui.drawn()).toEqual(ENGINE) // nothing worn yet: the engine's own row

      expect(await wear($, 'dracula')).toBe('Wearing dracula everywhere without a pin.')
      const icon = await ui.find({ key: 'icon' })
      expect(icon?.text).toBe(` ${dracula.icons.shell} `)
      expect(icon?.children).toEqual([expect.objectContaining({ props: { color: dracula.palette.accent, backgroundColor: dracula.palette.bg } })])

      await wear($, 'nord')
      expect((await ui.find({ key: 'icon' }))?.children).toEqual([expect.objectContaining({ props: { color: nord.palette.accent, backgroundColor: nord.palette.bg } })])

      await wear($, 'default')
      expect(await ui.drawn()).toEqual(ENGINE)
      await ui.unmount()
    }
  })

  test('the list follows what is worn', async ($, on) => {
    world(on)
    await start($)
    const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'Pane', props: PANE, requestId: 'wardrobe' })
    await wear($, 'colorblind')
    expect((await ui.find({ key: 'theme-colorblind' }))?.text).toContain('(wearing)')
    expect((await ui.find({ key: 'theme-default' }))?.text).not.toContain('(wearing)')
  })

  test('an unknown theme is named to the person, in a toast that stays a while, and nothing changes', async ($, on) => {
    const w = world(on)
    await start($)
    await wear($, 'nord')
    const text = await wear($, 'vaporwave')
    expect(text).toContain('No theme called "vaporwave"')
    expect(text).toContain('high-contrast')
    expect(w.heard.at(-1)).toMatchObject({ via: 'toast', timeoutMs: 8000 })
    expect(w.store.get('global')).toBe('nord')
  })

  test('says once where it cannot restyle, instead of seeming to fail there', async ($, on) => {
    world(on, { surfaces: ['terminal', 'vscode', 'mobile'] })
    await start($)
    expect(await wear($, 'nord')).toBe('Wearing nord everywhere without a pin. On vscode and mobile, Claude Code draws its own look.')
    expect(await wear($, 'default')).toBe("Wearing Claude Code's own look everywhere without a pin.")
  })

  test('confirmations are toasts; nothing /wear says reaches the model', async ($, on) => {
    const w = world(on)
    await start($)
    for (const args of ['nord', 'pin', 'dracula', 'unpin', 'auto', 'default']) {
      w.heard.length = 0
      await wear($, args) // fails if the run answers any text or context
      expect(w.heard).toHaveLength(1)
      expect(w.heard[0]?.via).toBe('toast')
    }
  })

  test('where nothing draws a toast or a pane (a -p run), it says so in the log', async ($, on) => {
    const w = world(on, { surfaces: [] })
    await start($)
    expect(await wear($, 'nord')).toBe('Wearing nord everywhere without a pin.')
    const list = await wear($, '')
    for (const id of ['default', 'noir', 'paper', 'tokyo-night', 'dracula', 'catppuccin', 'solarized', 'nord', 'high-contrast', 'colorblind', 'auto']) {
      expect(list).toContain(`- ${id}`)
    }
    expect(list).toContain('- nord (dark)')
    expect(w.heard.every(line => line.via === 'log')).toBe(true)
    expect(w.panes).toEqual([])
  })

  test('where a pane cannot be placed, the list goes to the log instead', async ($, on) => {
    const w = world(on, { placesPanes: false })
    await start($)
    expect(await wear($, '')).toContain("Wearing Claude Code's own look")
    expect(w.panes).toEqual(['wardrobe'])
    expect(w.heard.at(-1)?.via).toBe('log')
  })
})

describe('/wear pin', () => {
  test('keeps a theme for this project only; other projects keep the global one', async ($, on) => {
    const w = world(on, { root: '/work/alpha' })
    await start($)
    await wear($, 'dracula') // global
    expect(await wear($, 'pin')).toBe('Pinned dracula to /work/alpha. Other projects keep the global choice.')

    // In the pinned project, /wear moves the pin, not the global choice.
    expect(await wear($, 'nord')).toBe('Wearing nord in this project (pinned).')
    expect(w.store.get('global')).toBe('dracula')
    expect(w.store.get('pins')).toEqual({ '/work/alpha': 'nord' })

    // Another project, another session: the global theme.
    w.cd('/work/beta')
    await start($)
    const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 3000 } })
    expect((await ui.find({ key: 'turn' }))?.children).toEqual([expect.objectContaining({ props: { color: dracula.palette.muted, backgroundColor: dracula.palette.bg } })])

    // Back in the pinned project: its own theme again.
    w.cd('/work/alpha')
    await start($)
    expect((await ui.find({ key: 'turn' }))?.children).toEqual([expect.objectContaining({ props: { color: nord.palette.muted, backgroundColor: nord.palette.bg } })])

    // Unpinned, it follows the global theme.
    expect(await wear($, 'unpin')).toBe('Unpinned /work/alpha. Wearing dracula everywhere without a pin.')
    expect((await ui.find({ key: 'turn' }))?.children).toEqual([expect.objectContaining({ props: { color: dracula.palette.muted, backgroundColor: dracula.palette.bg } })])
    expect(await wear($, 'unpin')).toBe('/work/alpha has no pin. Wearing dracula everywhere without a pin.')
  })

  test('a choice made in another session reaches this one within a minute', async ($, on) => {
    const w = world(on)
    await start($)
    const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 3000 } })
    expect(await ui.drawn()).toEqual(ENGINE)
    w.store.set('global', 'nord') // as another session's /wear would
    await w.clock.advance(60_000)
    expect((await ui.find({ key: 'turn' }))?.text).toBe(` ${nord.mark} Baked for 3s `)
  })
})

describe('/wear auto', () => {
  const options = { dayTheme: 'paper', nightTheme: 'nord', dayStarts: '08:30', nightStarts: '20:15' }

  test('wears the day theme by day and the night theme by night, switching on the clock', { options }, async ($, on) => {
    const w = world(on, { now: at(8, 29, 30) })
    await start($)
    expect(await wear($, 'auto')).toBe('Wearing auto everywhere without a pin: paper from 08:30, nord from 20:15; nord now (night).')
    const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 3000 } })
    const colour = async () => ((await ui.find({ key: 'turn' }))?.children[0] as { props: { color: string } }).props.color
    expect(await colour()).toBe(nord.palette.muted)

    await w.clock.advance(60_000) // 08:30:30
    expect(await colour()).toBe(paper.palette.muted)

    await w.clock.set(at(20, 14, 30))
    expect(await colour()).toBe(paper.palette.muted)
    await w.clock.advance(60_000) // 20:15:30
    expect(await colour()).toBe(nord.palette.muted)
  })

  test('names settings it cannot use, and falls back for them', { options: { ...options, dayStarts: '7am' } }, async ($, on) => {
    world(on, { now: at(12, 0) })
    await start($)
    const text = await wear($, 'auto')
    expect(text).toContain('paper from 07:00')
    expect(text).toContain('Settings: dayStarts "7am" is not HH:MM; using 07:00.')
    const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'Pane', props: PANE, requestId: 'wardrobe' })
    expect(await ui.find({ type: 'Text', text: /Setting: dayStarts "7am" is not HH:MM/ })).toBeDefined()
  })
})

describe('Bolt in the /wear pane', () => {
  // Bolt (MM-091): idle beside the line that names what is worn, in its own palette
  // whatever theme is worn, and out of the way in a narrow pane. A Raster on the
  // terminal, one code-font cell per character on the desktop.
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
  const IDLE: BoltPick = { size: 'tiny', pose: 'idle' }
  const pane = ($: Engine, surface: (typeof SURFACES)[number], bodyColumns = 100) =>
    $.ui.mount({ plugin: 'wardrobe', surface, component: 'Pane', props: { ...PANE, bodyColumns }, requestId: 'wardrobe' })

  test('Bolt idles beside the line naming what is worn, the list intact; a narrow pane leaves it out', async ($, on) => {
    world(on)
    await start($)
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      const tree = await ui.drawn()
      expect(drawnBolt(under(under(tree, 'worn'), 'bolt')), surface).toEqual(boltAs(surface, IDLE))
      expect(under(tree, 'bolt')?.type).toBe(surface === 'terminal' ? 'Raster' : 'Box')
      expect(await ui.find({ type: 'Text', text: "Wearing Claude Code's own look everywhere without a pin." })).toBeDefined()
      expect((await ui.find({ key: 'theme-dracula' }))?.text).toContain(dracula.blurb)
      expect(await ui.findAll({ type: 'Text', text: ' + add ' })).toHaveLength(9)
      await ui.unmount()
      const narrow = await pane($, surface, 39)
      expect(await narrow.find({ key: 'bolt' }), surface).toBeUndefined()
      expect(await narrow.find({ key: 'worn' })).toBeUndefined()
      expect(await narrow.find({ type: 'Text', text: "Wearing Claude Code's own look everywhere without a pin." })).toBeDefined()
      await narrow.unmount()
    }
  })

  test('Bolt keeps its own palette whatever is worn: the same cells under every theme, no theme colour near it', async ($, on) => {
    world(on)
    await start($)
    for (const surface of SURFACES) {
      const seen = new Set<string>()
      for (const id of ['dracula', 'paper', 'nord', 'high-contrast']) {
        await wear($, id)
        const theme = themeById(id)!
        const ui = await pane($, surface)
        const row = under(await ui.drawn(), 'worn')
        expect(await ui.find({ type: 'Text', text: `Wearing ${id} everywhere without a pin.` })).toBeDefined()
        expect(drawnBolt(under(row, 'bolt')), `${surface} ${id}`).toEqual(boltAs(surface, IDLE))
        seen.add(JSON.stringify(drawnBolt(under(row, 'bolt'))))
        // Nothing in Bolt's row carries the worn theme's colours: no recolour, no backdrop.
        const drawn = JSON.stringify(row).toLowerCase()
        for (const colour of [...Object.values(theme.palette), ...Object.values(theme.diff)]) {
          expect(drawn.includes(`"${colour.toLowerCase()}"`), `${surface} ${id} ${colour}`).toBe(false)
        }
        await ui.unmount()
      }
      expect(seen.size, surface).toBe(1)
    }
  })

  test('Bolt is only in the /wear pane: restyled tool rows and the turn line never draw it', async ($, on) => {
    world(on)
    await start($)
    await wear($, 'dracula')
    for (const surface of SURFACES) {
      const row = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolUse', props: TOOL_ROW, requestId: TOOL_ROW.tool_use_id })
      expect(await row.find({ key: 'icon' })).toBeDefined()
      expect(await row.find({ key: 'bolt' })).toBeUndefined()
      await row.unmount()
    }
    const turn = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 3000 } })
    expect(await turn.find({ key: 'turn' })).toBeDefined()
    expect(await turn.find({ key: 'bolt' })).toBeUndefined()
  })
})
