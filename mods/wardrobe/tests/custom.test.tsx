// What a person makes their own, through the real wiring: a team's two colours
// on the sports looks, a game day, and the holiday looks in season mode. The
// derivation is held first as pure functions, then at the rows, the gallery
// and the words `/wear` answers with.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { appColors, isRefusal } from '../hooks/app-colors'
import { contrast } from '../hooks/contrast'
import { COSTUMES, dressedPixels } from '../hooks/costume'
import { ADDED } from '../hooks/look'
import { isTailored, lookKey, teamNote, wornTheme } from '../hooks/tailor'
import { ROLES, SPORTS, THEMES, themeById } from '../hooks/themes'
import { at, PANE, SETTINGS, start, TOOL_ROW, wear, world } from './setup'

/** A navy too dark to read on any sports look, and a gold that reads on all of them. */
const NAVY = '#14306b'
const GOLD = '#f2b824'
const TEAM = { teamPrimary: NAVY, teamSecondary: GOLD }
const NONE = { teamPrimary: '', teamSecondary: '' }

type Drawn = { type?: string; key?: string; props?: Record<string, unknown>; children?: unknown[] }
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
const pane = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') => $.ui.mount({ plugin: 'wardrobe', surface, component: 'Pane', props: { ...PANE, bodyColumns: 100 }, requestId: 'wardrobe' })
const stripeOf = async ($: Engine) => {
  const row = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'ToolUse', props: TOOL_ROW, requestId: TOOL_ROW.tool_use_id })
  const stripe = under(await row.drawn(), 'stripe')
  await row.unmount()
  return (stripe?.children?.[0] as Drawn | undefined)?.props?.backgroundColor
}

describe('a sports look in a team colours', () => {
  test('only the sports looks wear them, and only where the settings give one', () => {
    expect(SPORTS).toEqual(['hardwood', 'gridiron', 'rink'])
    for (const theme of THEMES) {
      expect(isTailored(theme.id, TEAM), theme.id).toBe(SPORTS.includes(theme.id))
      expect(isTailored(theme.id, NONE), theme.id).toBe(false)
      // With none given, and for every other look, the theme is the one object the data holds.
      expect(wornTheme(theme.id, NONE)).toBe(theme)
      if (!SPORTS.includes(theme.id)) expect(wornTheme(theme.id, TEAM)).toBe(theme)
    }
    expect(wornTheme('default', TEAM)).toBeUndefined()
    expect(wornTheme('nope', TEAM)).toBeUndefined()
  })

  for (const id of SPORTS) {
    const stock = themeById(id)!

    test(`${id}: the two colours take the accent and the special, every other colour stays, and the colours as given are kept for the scene`, () => {
      const worn = wornTheme(id, TEAM)!
      expect(worn).not.toBe(stock)
      expect(worn.id).toBe(id)
      expect(worn.team).toEqual({ primary: NAVY, secondary: GOLD })
      // The gold reads as it is; the navy does not, and is moved toward white only as far as reading takes.
      expect(worn.palette.special).toBe(GOLD)
      expect(worn.palette.accent).not.toBe(NAVY)
      expect(contrast(NAVY, stock.palette.bg)).toBeLessThan(4.5)
      expect(contrast(worn.palette.accent, stock.palette.bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(worn.palette.accent, stock.palette.bg)).toBeLessThan(5.6)
      for (const role of ROLES) if (role !== 'accent' && role !== 'special') expect(worn.palette[role], role).toBe(stock.palette[role])
      expect(worn.palette.bg).toBe(stock.palette.bg)
      expect(worn.diff).toEqual(stock.diff)
      expect(worn.icons).toBe(stock.icons)
      expect(stock.team).toBeUndefined()
      // Made once per pair of colours, kept; another pair is another look.
      expect(wornTheme(id, TEAM)).toBe(worn)
      expect(wornTheme(id, { teamPrimary: GOLD, teamSecondary: NAVY })).not.toBe(worn)
      expect(lookKey(worn)).not.toBe(lookKey(stock))
      expect(lookKey(stock)).toBe(`${id} ${stock.palette.accent} ${stock.palette.special}`)
      // The scene paints with the colours as given, so the key carries them too: the navy was moved for words, and is still named.
      expect(lookKey(worn)).toBe(`${id} ${worn.palette.accent} ${GOLD} ${NAVY} ${GOLD}`)
    })

    test(`${id}: one colour alone changes one role; the other stays the look's own`, () => {
      const first = wornTheme(id, { teamPrimary: GOLD, teamSecondary: '' })!
      expect(first.palette.accent).toBe(GOLD)
      expect(first.palette.special).toBe(stock.palette.special)
      expect(first.team).toEqual({ primary: GOLD, secondary: stock.palette.special })
      const second = wornTheme(id, { teamPrimary: '', teamSecondary: GOLD })!
      expect(second.palette.accent).toBe(stock.palette.accent)
      expect(second.palette.special).toBe(GOLD)
      // Either one alone is still a look of its own to whatever keeps a drawing by its key.
      for (const one of [first, second]) {
        expect(lookKey(one)).not.toBe(lookKey(stock))
        expect(appColors(one)).not.toBe(appColors(stock))
      }
      expect(lookKey(first)).not.toBe(lookKey(second))
    })

    test(`${id}: any colour at all is read on the look, the app will paint its palette, and Bolt wears it`, () => {
      // A sweep of the colour cube, its corners included: black, white, and every primary between.
      const steps = ['00', '55', 'aa', 'ff']
      const sweep = steps.flatMap(r => steps.flatMap(g => steps.map(b => `#${r}${g}${b}`)))
      expect(sweep).toHaveLength(64)
      for (const [i, colour] of sweep.entries()) {
        const other = sweep[(i * 7 + 13) % sweep.length]!
        const worn = wornTheme(id, { teamPrimary: colour, teamSecondary: other })!
        expect(contrast(worn.palette.accent, worn.palette.bg), `${colour} as accent`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(worn.palette.special, worn.palette.bg), `${other} as special`).toBeGreaterThanOrEqual(4.5)
        // The desktop app ignores a whole palette with one unreadable pair, and says nothing: none may come of a team colour.
        expect(appColors(worn).problems.filter(isRefusal), `${colour} and ${other}`).toEqual([])
      }
      // The costume is painted in the look's accent and special, so it is the team's.
      const worn = wornTheme(id, TEAM)!
      const roles = Object.values(COSTUMES[id]!.paint)
      expect(roles).toContain('accent')
      const pixels = dressedPixels(worn, 'small', 'idle').grid.flat()
      expect(pixels).toContain(worn.palette.accent)
      expect(pixels).not.toContain(stock.palette.accent)
      // And the palette the app wears is the team's too, not the look's own.
      expect(appColors(worn)).not.toBe(appColors(stock))
      expect(JSON.stringify(appColors(worn).colors)).not.toBe(JSON.stringify(appColors(stock).colors))
      expect(appColors(worn).colors.id).toBe(`wardrobe-${id}`)
    })
  }

  test('what is said when one goes on: that the team colours are worn, and which colour had to be moved to be read', () => {
    expect(teamNote('hardwood', NONE)).toBe('')
    expect(teamNote('dracula', TEAM)).toBe('')
    expect(teamNote('default', TEAM)).toBe('')
    expect(teamNote('hardwood', { teamPrimary: GOLD, teamSecondary: '' })).toBe(' In your team colours.')
    expect(teamNote('hardwood', TEAM)).toBe(` In your team colours; ${NAVY} was lightened to be read on hardwood.`)
    expect(teamNote('rink', { teamPrimary: NAVY, teamSecondary: '#000000' })).toBe(` In your team colours; ${NAVY} and #000000 were lightened to be read on rink.`)
  })

  test('/wear hardwood wears them on every row, says so once, and leaves every other look as it was', { options: { ...SETTINGS, ...TEAM } }, async ($, on) => {
    world(on)
    await start($)
    const worn = wornTheme('hardwood', TEAM)!
    expect(await wear($, 'hardwood')).toBe(`Wearing hardwood everywhere without a pin. In your team colours; ${NAVY} was lightened to be read on hardwood.`)
    expect(await stripeOf($)).toBe(worn.palette.accent)
    expect(await stripeOf($)).not.toBe(themeById('hardwood')!.palette.accent)
    expect(await wear($, 'dracula')).toBe('Wearing dracula everywhere without a pin.')
    expect(await stripeOf($)).toBe(themeById('dracula')!.palette.accent)
  })

  test('with no colours set a sports look is its own, and nothing is said of a team', { options: SETTINGS }, async ($, on) => {
    world(on)
    await start($)
    expect(await wear($, 'rink')).toBe('Wearing rink everywhere without a pin.')
    expect(await stripeOf($)).toBe(themeById('rink')!.palette.accent)
  })

  test('the gallery shows the sports looks as they will be worn, and says whose colours they are', { options: { ...SETTINGS, ...TEAM } }, async ($, on) => {
    const w = world(on)
    await start($)
    const ui = await pane($)
    await ui.press({ key: 'family-sports' })
    await w.clock.settle()
    expect((await ui.find({ key: 'family' }))?.text).toBe(`sports: a sport each, in your team colours. Shown in your team colours (${NAVY} and ${GOLD}).`)
    for (const id of SPORTS) {
      const card = under(await ui.drawn(), `theme-${id}`)
      const stripe = under(card, 'stripe') as Drawn
      expect((stripe.children?.[0] as Drawn).props, id).toEqual({ color: themeById(id)!.palette.bg, backgroundColor: wornTheme(id, TEAM)!.palette.accent })
    }
    await ui.unmount()
  })

  test('with none set the sports family says where the colours go', { options: SETTINGS }, async ($, on) => {
    const w = world(on)
    await start($)
    const ui = await pane($)
    await ui.press({ key: 'family-sports' })
    await w.clock.settle()
    expect((await ui.find({ key: 'family' }))?.text).toBe('sports: a sport each, in your team colours. Set teamPrimary and teamSecondary in the settings to wear your team colours.')
    await ui.unmount()
  })
})

describe('game day', () => {
  // The kit's clock starts on October 8, 2026: a Thursday.
  const GAME = { ...SETTINGS, gameDay: 'thursday', gameLook: 'gridiron' }

  test('the kit date is the Thursday these tests name', () => {
    expect(new Date(at(12, 0)).getDay()).toBe(4)
  })

  test('auto and season wear the game look on the day, say why, and go back with the date; a look worn by name stays', { options: GAME }, async ($, on) => {
    const w = world(on, { now: at(21, 0) })
    await start($)
    expect(await wear($, 'auto')).toBe('Wearing auto everywhere without a pin: paper from 07:00, tokyo-night from 19:00; gridiron now (game day).')
    expect(await stripeOf($)).toBe(themeById('gridiron')!.palette.accent)
    expect(await wear($, 'season')).toBe('Wearing season everywhere without a pin: gridiron now (game day).')
    const ui = await pane($)
    // On the day the line says so, since the auto and season rows above it still name the clock and the calendar.
    const today = 'Game day: gridiron on Thursday, while auto or season is worn. Today is one: auto and season wear gridiron until midnight.'
    expect((await ui.find({ key: 'game-day' }))?.text).toBe(today)
    await ui.unmount()
    // Friday, a little after midnight: the ticker re-resolves, and the calendar has the look again.
    await w.clock.advance(4 * 60 * 60_000)
    expect(await stripeOf($)).toBe(themeById('autumn')!.palette.accent)
    const after = await pane($)
    expect((await after.find({ key: 'game-day' }))?.text).toBe('Game day: gridiron on Thursday, while auto or season is worn.')
    await after.unmount()
    expect(await wear($, 'dracula')).toBe('Wearing dracula everywhere without a pin.')
  })

  test('the gallery as text says the same of a game day: the day, and that today is one', { options: GAME }, async ($, on) => {
    const w = world(on, { now: at(21, 0), surfaces: [] })
    await start($)
    const lines = (await wear($, '')).split('\n')
    expect(lines).toContain('Game day: gridiron on Thursday, while auto or season is worn. Today is one: auto and season wear gridiron until midnight.')
    // The day after it is the plain line again.
    await w.clock.advance(24 * 60 * 60_000)
    expect((await wear($, '')).split('\n')).toContain('Game day: gridiron on Thursday, while auto or season is worn.')
  })

  test('a look worn by name is never the game look, game day or not', { options: GAME }, async ($, on) => {
    world(on, { now: at(12, 0) })
    await start($)
    expect(await wear($, 'nord')).toBe('Wearing nord everywhere without a pin.')
    expect(await stripeOf($)).toBe(themeById('nord')!.palette.accent)
  })

  test('with no game day set the gallery has no such line, and auto is the clock alone', { options: SETTINGS }, async ($, on) => {
    world(on, { now: at(21, 0) })
    await start($)
    expect(await wear($, 'auto')).toBe('Wearing auto everywhere without a pin: paper from 07:00, tokyo-night from 19:00; tokyo-night now (night).')
    const ui = await pane($)
    expect(await ui.find({ key: 'game-day' })).toBeUndefined()
    await ui.unmount()
    expect(ADDED.gameDays).toEqual([])
  })

  test('a game day in the team colours: the game look goes on as the team wears it', { options: { ...GAME, ...TEAM } }, async ($, on) => {
    world(on, { now: at(12, 0) })
    await start($)
    expect(await wear($, 'auto')).toBe(`Wearing auto everywhere without a pin: paper from 07:00, tokyo-night from 19:00; gridiron now (game day). In your team colours; ${NAVY} was lightened to be read on gridiron.`)
    expect(await stripeOf($)).toBe(wornTheme('gridiron', TEAM)!.palette.accent)
  })
})

describe('the holiday looks', () => {
  const easterSunday = new Date(2026, 3, 5, 10).getTime()
  const eidDay = new Date(2026, 2, 20, 10).getTime()

  test('worn by name on any day, like every look', { options: SETTINGS }, async ($, on) => {
    world(on, { now: at(12, 0) })
    await start($)
    expect(await wear($, 'easter')).toBe('Wearing easter everywhere without a pin.')
    expect(await stripeOf($)).toBe(themeById('easter')!.palette.accent)
    expect(await wear($, 'eid al fitr')).toBe('Wearing eid everywhere without a pin.')
    expect(await stripeOf($)).toBe(themeById('eid')!.palette.accent)
  })

  test('season leaves them out as installed: Easter Sunday is spring', { options: SETTINGS }, async ($, on) => {
    world(on, { now: easterSunday })
    await start($)
    // Spring is a light look, so the answer goes on to the theme it matched; the look is what is held here.
    expect(await wear($, 'season')).toContain('Wearing season everywhere without a pin: spring now (Mar 1 to May 31).')
    const ui = await pane($)
    // Worn, spring opens its own family: the seasons.
    expect((await ui.find({ key: 'families' }))?.text).toContain('[seasons 7]')
    expect((await ui.find({ key: 'family' }))?.text).toBe('seasons: the calendar and two holidays. easter and eid are worn by name; a setting each lets /wear season wear them on their days.')
    await ui.unmount()
  })

  test('with its setting on, season wears easter from Good Friday to Easter Monday, then spring again', { options: { ...SETTINGS, seasonEaster: true } }, async ($, on) => {
    const w = world(on, { now: easterSunday })
    await start($)
    expect(await wear($, 'season')).toBe('Wearing season everywhere without a pin: easter now (Good Friday to Easter Monday).')
    const ui = await pane($)
    expect((await ui.find({ key: 'theme-season' }))?.text).toContain('by the calendar: easter now (Good Friday to Easter Monday)')
    expect((await ui.find({ key: 'family' }))?.text).toBe('seasons: the calendar and two holidays. /wear season wears easter on its days.')
    await ui.unmount()
    await w.clock.advance(2 * 24 * 60 * 60_000) // Tuesday
    expect(await stripeOf($)).toBe(themeById('spring')!.palette.accent)
  })

  test('with its setting on, season wears eid on Eid al-Fitr and the two days after', { options: { ...SETTINGS, seasonEid: true, seasonEaster: true } }, async ($, on) => {
    const w = world(on, { now: eidDay })
    await start($)
    expect(await wear($, 'season')).toBe('Wearing season everywhere without a pin: eid now (Eid al-Fitr and the two days after).')
    expect(await stripeOf($)).toBe(themeById('eid')!.palette.accent)
    const ui = await pane($)
    expect((await ui.find({ key: 'family' }))?.text).toBe('seasons: the calendar and two holidays. /wear season wears easter and eid on their days.')
    await ui.unmount()
    await w.clock.advance(3 * 24 * 60 * 60_000) // March 23
    expect(await stripeOf($)).toBe(themeById('spring')!.palette.accent)
  })
})
