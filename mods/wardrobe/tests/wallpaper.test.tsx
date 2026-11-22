// The look the app itself wears, through the real wiring: the theme a look
// sets at session start and on every switch (its palette, its light or dark
// mode, its scene behind the chat), /wear wallpaper off and on, the Backdrop
// drawing on the desktop, and another plugin's scene over ours.
//
// An engine older than 2.1.325 has no theme noun, and its test kit refuses a
// world that answers theme.set. The first test finds out which engine this is,
// through a probe plugin, and the theme tests after it stand down on an older
// one; the last test, that a theme nothing answers never costs the look, runs
// on every engine.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { appColors } from '../hooks/app-colors'
import { glassFor, sceneOf } from '../hooks/scenes'
import { wornTheme } from '../hooks/tailor'
import { themeById } from '../hooks/themes'
import { at, ENGINE, SETTINGS, start, themeWorld, TOOL_ROW, wear, world } from './setup'

const dracula = themeById('dracula')!
const paper = themeById('paper')!

/** Finds out whether this engine's plugins have the theme noun, and says so in the store. */
const PROBE = {
  name: 'theme-probe',
  tier: 'append' as const,
  register(on: On) {
    on('session.start', async ($, e, next) => {
      let has = 'yes'
      try {
        await $.theme.set({ backdrop: { scene: 'probe' } })
      } catch (err) {
        // No noun at all is a TypeError; a noun nothing beneath answers is the kit's own error.
        has = err instanceof TypeError ? 'no' : 'yes'
      }
      await $.store.set('theme-noun', has)
      return next(e)
    })
  },
}

// Set by the first test, read by the rest: tests in a file run in order, in one module.
let engineHasTheme = false

/** What a worn look sets with wallpapers off: its palette and its mode, as JSON round-trips them. */
const paletteOf = (id: string): Record<string, unknown> => JSON.parse(JSON.stringify({ colors: appColors(themeById(id)!).colors, overrideColorScheme: themeById(id)!.tone }))
/** The whole theme of a worn look: the palette, the mode, and the scene under its glass. */
const setOf = (id: string) => ({ ...paletteOf(id), backdrop: { scene: id, glass: glassFor(themeById(id)!) } })

const backdropProps = (scene: string, plugin = 'wardrobe') => ({ scene, plugin, glass: { blur: 14, opacity: 0.56 } })
const mountBackdrop = ($: Engine, scene: string, plugin = 'wardrobe', surface: 'desktop' | 'mobile' = 'desktop') =>
  $.ui.mount({ plugin: 'wardrobe', surface, component: 'Backdrop', props: backdropProps(scene, plugin) })

describe('wallpapers', () => {
  test('finds out whether this engine has the theme noun (Claude Code 2.1.325+)', { plugins: [PROBE] }, async ($, on) => {
    const w = world(on)
    await start($)
    const has = w.store.get('theme-noun')
    expect(has === 'yes' || has === 'no').toBe(true)
    engineHasTheme = has === 'yes'
  })

  test('a worn look dresses the app at session start: its palette, its mode and its scene under its glass; nothing is said', async ($, on) => {
    if (!engineHasTheme) return
    const w = world(on, { store: { global: 'dracula' }, surfaces: ['desktop'] })
    const t = themeWorld(on, true)
    await start($)
    expect(t.sets).toEqual([setOf('dracula')])
    expect(t.clears).toBe(0)
    expect(w.heard).toEqual([])
    // The palette is a whole one, in the look's one mode, under wardrobe's own name.
    const colors = (t.sets[0] as { colors: { v: number; id: string; label: string; inputs: Record<string, Record<string, string>> } }).colors
    expect(colors).toMatchObject({ v: 1, id: 'wardrobe-dracula', label: 'Dracula (wardrobe)' })
    expect(Object.keys(colors.inputs)).toEqual(['dark'])
    expect(Object.keys(colors.inputs.dark!).length).toBeGreaterThan(90)
  })

  test("with wallpapers off the palette alone is set, no scene; with no look worn nothing is, and nothing of another plugin's is cleared at session start", async ($, on) => {
    if (!engineHasTheme) return
    const w = world(on, { store: { global: 'dracula', wallpaper: 'off' } })
    const t = themeWorld(on, true)
    await start($)
    expect(t.sets).toEqual([paletteOf('dracula')])
    expect(t.sets[0]).not.toHaveProperty('backdrop')
    expect(t.clears).toBe(0)
    // Another session took the look off: a new session here sets nothing and clears nothing.
    w.store.set('global', 'default')
    w.store.delete('wallpaper')
    t.sets.length = 0
    w.cd('/work/beta')
    await start($)
    expect(t.sets).toEqual([])
    expect(t.clears).toBe(0) // an unload took wardrobe's own down already; a clear here could only take another plugin's
  })

  const TEAM = { teamPrimary: '#14306b', teamSecondary: '#f2b824' }

  test('the settings reach the app: the glass asked for, the motion asked for, and the team colours of a sports look', { options: { ...SETTINGS, glass: 'heavy', motion: 'calm', ...TEAM } }, async ($, on) => {
    if (!engineHasTheme) return
    world(on, { surfaces: ['desktop'] })
    const t = themeWorld(on, true)
    await start($)
    await wear($, 'dracula')
    expect(t.sets.at(-1)).toEqual({ ...paletteOf('dracula'), backdrop: { scene: 'dracula', glass: glassFor(dracula, 'heavy') } })
    expect(glassFor(dracula, 'heavy')).not.toEqual(glassFor(dracula))
    const calm = sceneOf(dracula, { motion: 'calm' })!
    expect(calm.source).not.toBe(sceneOf(dracula)!.source)
    const ui = await mountBackdrop($, 'dracula')
    expect(await ui.drawn()).toMatchObject({ type: 'Svg', props: { source: calm.source, alt: calm.alt, isInteractive: true } })
    await ui.unmount()
    // A sports look goes on as the team wears it: the palette set and the scene drawn are both the team's.
    await wear($, 'rink')
    const worn = wornTheme('rink', TEAM)!
    expect(t.sets.at(-1)).toEqual(JSON.parse(JSON.stringify({ colors: appColors(worn).colors, overrideColorScheme: 'dark', backdrop: { scene: 'rink', glass: glassFor(worn, 'heavy') } })))
    expect((t.sets.at(-1) as { colors: unknown }).colors).not.toEqual(paletteOf('rink').colors)
    const rink = await mountBackdrop($, 'rink')
    expect(await rink.drawn()).toMatchObject({ type: 'Svg', props: { source: sceneOf(worn, { motion: 'calm' })!.source } })
    expect(sceneOf(worn, { motion: 'calm' })!.source).not.toBe(sceneOf(themeById('rink')!, { motion: 'calm' })!.source)
    await rink.unmount()
  })

  test('motion still draws the scene whole and at rest; as installed it moves', { options: { ...SETTINGS, motion: 'still' } }, async ($, on) => {
    if (!engineHasTheme) return
    world(on, { surfaces: ['desktop'] })
    themeWorld(on, true)
    await start($)
    await wear($, 'nord')
    const ui = await mountBackdrop($, 'nord')
    const drawn = (await ui.drawn()) as { props: { source: string } }
    expect(drawn.props.source).toBe(sceneOf(themeById('nord')!, { motion: 'still' })!.source)
    expect(drawn.props.source).not.toContain('animation')
    expect(sceneOf(themeById('nord')!)!.source).toContain('animation')
    await ui.unmount()
  })

  test("/wear <look> swaps the scene, a light look brings a light mode, and /wear default takes wardrobe's own scene down, once", async ($, on) => {
    if (!engineHasTheme) return
    world(on)
    const t = themeWorld(on, true)
    await start($)
    expect(t.sets).toEqual([])
    expect(await wear($, 'dracula')).toBe('Wearing dracula everywhere without a pin.')
    expect(t.sets).toEqual([setOf('dracula')])
    await wear($, 'paper')
    expect(t.sets.at(-1)).toEqual(setOf('paper'))
    expect((t.sets.at(-1) as { overrideColorScheme: string }).overrideColorScheme).toBe('light')
    expect(paper.tone).toBe('light')
    await wear($, 'default')
    expect(t.clears).toBe(1)
    await wear($, 'default')
    expect(t.clears).toBe(1) // nothing of ours stands: nothing to clear
    expect(t.sets).toHaveLength(2)
  })

  test('auto follows the clock and season the calendar, scene and all, with one set per change', async ($, on) => {
    if (!engineHasTheme) return
    const w = world(on, { now: at(9, 0) })
    const t = themeWorld(on, true)
    await start($)
    await wear($, 'auto') // paper by day
    expect(t.sets.at(-1)).toEqual(setOf('paper'))
    const before = t.sets.length
    await w.clock.advance(9 * 60 * 60_000) // 18:00, still day: the ticker re-resolves every minute and sets nothing anew
    expect(t.sets).toHaveLength(before)
    await w.clock.advance(60 * 60_000) // 19:00: night
    expect(t.sets.at(-1)).toEqual(setOf('tokyo-night'))
    expect(t.sets).toHaveLength(before + 1)
    await wear($, 'season') // Oct 8: autumn
    expect(t.sets.at(-1)).toEqual(setOf('autumn'))
  })

  test('/wear wallpaper off keeps the look and takes the scene down; on puts it back; the words say where it draws', async ($, on) => {
    if (!engineHasTheme) return
    const w = world(on, { surfaces: ['desktop'] })
    const t = themeWorld(on, true)
    await start($)
    await wear($, 'dracula')
    expect(await wear($, 'wallpaper off')).toBe("Wallpapers off. The look stays; nothing of wardrobe's draws behind the chat.")
    // Off is a set of the palette with no scene in it: nothing is cleared, so the app keeps the look's colours.
    expect(t.clears).toBe(0)
    expect(t.sets.at(-1)).toEqual(paletteOf('dracula'))
    expect(w.store.get('wallpaper')).toBe('off')
    const row = await $.ui.mount({ plugin: 'wardrobe', surface: 'desktop', component: 'ToolUse', props: TOOL_ROW, requestId: TOOL_ROW.tool_use_id })
    expect((await row.find({ key: 'icon' }))?.text).toBe(` ${dracula.icons.shell} `) // the look stays on
    await row.unmount()
    await wear($, 'nord')
    expect(t.sets.at(-1)).toEqual(paletteOf('nord')) // off: a switch sets the palette, no scene
    expect(await wear($, 'wallpaper on')).toBe('Wallpapers on. The nord scene draws behind the chat in the desktop app.')
    expect(t.sets.at(-1)).toEqual(setOf('nord'))
    expect(await wear($, 'wallpaper')).toBe('Wallpapers are on. The nord scene draws behind the chat in the desktop app.')
    await wear($, 'default')
    expect(await wear($, 'wallpaper')).toBe('Wallpapers are on. Wear a look and its scene draws behind the chat in the desktop app.')
  })

  test('where no window draws themes, /wear wallpaper says so and a plain /wear says nothing of it', async ($, on) => {
    if (!engineHasTheme) return
    world(on)
    const t = themeWorld(on, false)
    await start($)
    expect(await wear($, 'dracula')).toBe('Wearing dracula everywhere without a pin.')
    expect(t.sets).toEqual([setOf('dracula')])
    expect(await wear($, 'wallpaper')).toBe(
      'Wallpapers are on. The dracula scene draws behind the chat in the desktop app. Nothing here draws it yet: wallpapers need the desktop app on Claude Code 2.1.325 or newer.',
    )
  })

  test('the desktop draws the worn scene as one interactive picture; an unknown scene and the mobile app pass', async ($, on) => {
    if (!engineHasTheme) return
    world(on, { surfaces: ['desktop'] })
    themeWorld(on, true)
    await start($)
    await wear($, 'dracula')
    const ui = await mountBackdrop($, 'dracula')
    const scene = sceneOf(dracula)!
    expect(await ui.drawn()).toMatchObject({ type: 'Svg', props: { source: scene.source, alt: scene.alt, isInteractive: true } })
    await ui.unmount()
    for (const other of [mountBackdrop($, 'nope'), mountBackdrop($, 'dracula', 'wardrobe', 'mobile')]) {
      const mount = await other
      expect(await mount.drawn()).toEqual(ENGINE)
      await mount.unmount()
    }
  })

  test("another plugin's scene over ours passes, is said once, kindly, and /wear <look> brings ours back", async ($, on) => {
    if (!engineHasTheme) return
    const w = world(on, { surfaces: ['desktop'] })
    const t = themeWorld(on, true)
    await start($)
    await wear($, 'dracula')
    w.heard.length = 0
    const ui = await mountBackdrop($, 'lagoon', 'theme-examples')
    expect(await ui.drawn()).toEqual(ENGINE)
    expect(w.heard).toEqual([{ via: 'toast', text: 'theme-examples draws the backdrop now, so the dracula wallpaper waits. /wear dracula brings it back.', timeoutMs: 8000 }])
    await ui.redraw()
    expect(w.heard).toHaveLength(1)
    await ui.unmount()
    expect(await wear($, 'wallpaper')).toBe('Wallpapers are on. The dracula scene draws behind the chat in the desktop app. theme-examples draws the backdrop now; /wear dracula brings ours back.')
    const sets = t.sets.length
    await wear($, 'dracula')
    expect(t.sets).toHaveLength(sets + 1) // set again, so the latest set is ours
    expect(await wear($, 'wallpaper')).toBe('Wallpapers are on. The dracula scene draws behind the chat in the desktop app.')
  })

  test("with another plugin's scene standing where ours was, /wear default takes the look off and leaves their theme alone", async ($, on) => {
    if (!engineHasTheme) return
    world(on, { surfaces: ['desktop'] })
    const t = themeWorld(on, true)
    await start($)
    await wear($, 'dracula')
    const ui = await mountBackdrop($, 'lagoon', 'theme-examples')
    await ui.unmount()
    await wear($, 'default')
    expect(t.clears).toBe(0)
    // With nothing of another plugin's seen, wardrobe's own theme is cleared as before.
    await wear($, 'nord')
    await wear($, 'default')
    expect(t.clears).toBe(1)
  })

  test('with no look worn, /wear wallpaper off says nothing of a look', async ($, on) => {
    world(on)
    await start($)
    expect(await wear($, 'wallpaper off')).toBe("Wallpapers off. Nothing of wardrobe's draws behind the chat.")
  })

  test('a theme value an older version kept, with no look in it, is read as no palette yet: the next tick sets the whole theme, once', async ($, on) => {
    if (!engineHasTheme) return
    let old = false
    // The value as wardrobe 0.2.0 wrote it.
    const kept = { value: { scene: 'dracula', isDrawn: true } } as never
    on('state.get', ($, e, next) => (old && e.plugin === 'wardrobe' && e.key === 'backdrop' ? kept : next(e)))
    const w = world(on, { store: { global: 'dracula' } })
    const t = themeWorld(on, true)
    await start($)
    expect(t.sets).toEqual([setOf('dracula')])
    await w.clock.advance(60_000)
    expect(t.sets).toHaveLength(1) // the same look, the same scene: nothing to set
    old = true
    await w.clock.advance(60_000)
    expect(t.sets).toEqual([setOf('dracula'), setOf('dracula')])
    old = false
    await w.clock.advance(60_000)
    expect(t.sets).toHaveLength(2)
  })

  test("an older version's value with nothing set, and no look worn: nothing is wardrobe's to take down, so another plugin's theme is never cleared", async ($, on) => {
    if (!engineHasTheme) return
    const kept = { value: { scene: null, isDrawn: false } } as never
    on('state.get', ($, e, next) => (e.plugin === 'wardrobe' && e.key === 'backdrop' ? kept : next(e)))
    const w = world(on)
    const t = themeWorld(on, true)
    await start($)
    await w.clock.advance(2 * 60_000)
    await wear($, 'default')
    expect(t.clears).toBe(0)
    expect(t.sets).toEqual([])
  })

  test('a theme nothing answers never costs the look, on any engine', async ($, on) => {
    world(on) // no theme world: on an older engine there is no noun, on a newer one nothing beneath answers it
    await start($)
    expect(await wear($, 'dracula')).toBe('Wearing dracula everywhere without a pin.')
    const row = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'ToolUse', props: TOOL_ROW, requestId: TOOL_ROW.tool_use_id })
    expect((await row.find({ key: 'icon' }))?.text).toBe(` ${dracula.icons.shell} `)
    await row.unmount()
    expect(await wear($, 'wallpaper')).toMatch(/^Wallpapers are on\. The dracula scene draws behind the chat in the desktop app\./)
  })
})
