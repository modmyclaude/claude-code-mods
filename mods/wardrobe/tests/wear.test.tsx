// /wear through the real wiring: the command, the store, the session's root,
// the clock, and the drawings that follow the worn theme live.

import { describe, expect, test } from 'claude-code/testing'

import { themeById } from '../hooks/themes'
import { at, ENGINE, start, SURFACES, TOOL_ROW, wear, world } from './setup'

const dracula = themeById('dracula')!
const nord = themeById('nord')!
const paper = themeById('paper')!

describe('/wear', () => {
  test('with no argument lists every theme with a preview in its own colours', async ($, on) => {
    world(on)
    await start($)
    const text = await wear($, '')
    for (const id of ['default', 'noir', 'paper', 'tokyo-night', 'dracula', 'catppuccin', 'solarized', 'nord', 'high-contrast', 'colorblind', 'auto']) {
      expect(text).toContain(`- ${id}`)
    }
    expect(text).toContain("Wearing Claude Code's own look")

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: 'wardrobe',
        surface,
        component: 'CommandOutput',
        props: { command: 'wear', args: '', text, isErrored: false },
        viewport: { columns: 120, rows: 40 },
      })
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
    const ui = await $.ui.mount({
      plugin: 'wardrobe',
      surface: 'terminal',
      component: 'CommandOutput',
      props: { command: 'wear', args: '', text: 'x', isErrored: false },
    })
    await wear($, 'colorblind')
    expect((await ui.find({ key: 'theme-colorblind' }))?.text).toContain('(wearing)')
    expect((await ui.find({ key: 'theme-default' }))?.text).not.toContain('(wearing)')
  })

  test('an unknown theme is named and nothing changes', async ($, on) => {
    const w = world(on)
    await start($)
    await wear($, 'nord')
    const text = await wear($, 'vaporwave')
    expect(text).toContain('No theme called "vaporwave"')
    expect(text).toContain('high-contrast')
    expect(w.store.get('global')).toBe('nord')
  })

  test('says once where it cannot restyle, instead of seeming to fail there', async ($, on) => {
    world(on, { surfaces: ['terminal', 'vscode', 'mobile'] })
    await start($)
    expect(await wear($, 'nord')).toBe('Wearing nord everywhere without a pin. On vscode and mobile, Claude Code draws its own look.')
    expect(await wear($, 'default')).toBe("Wearing Claude Code's own look everywhere without a pin.")
  })

  test('a reply that is not the list is drawn by the engine', async ($, on) => {
    world(on)
    await start($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: 'wardrobe',
        surface,
        component: 'CommandOutput',
        props: { command: 'wear', args: 'nord', text: 'Wearing nord everywhere without a pin.', isErrored: false },
      })
      expect(await ui.drawn()).toEqual(ENGINE)
    }
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
    expect(await wear($, '')).toContain('Setting: dayStarts "7am" is not HH:MM')
  })
})
