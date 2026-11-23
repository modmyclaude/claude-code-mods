// Matching Claude Code's own theme to a look. On the person's word (`/wear
// <look> --match`, `/wear match`, the gallery's `match theme` button) it is
// answered in full. With the Match setting on, as installed, every look put on
// matches quietly: the first change is said with how to undo it, later ones
// are not, and a look that changes by itself (the clock, the calendar, another
// session) carries a match already made and never starts one. Always: the
// person's own theme is remembered, `/wear default` puts it back, a theme they
// chose since stands, and a refusal is reported once and never retried.

import { describe, expect, test } from 'claude-code/testing'

import { parseWear } from '../hooks/look'
import { at, MATCH_OFF, SETTINGS, start, wear, world } from './setup'

describe('the words', () => {
  test('--match rides with a theme, alone it means the look worn now', () => {
    expect(parseWear('paper --match')).toEqual({ kind: 'wear', choice: 'paper', match: true })
    expect(parseWear('--match paper')).toEqual({ kind: 'wear', choice: 'paper', match: true })
    expect(parseWear('paper')).toEqual({ kind: 'wear', choice: 'paper' })
    expect(parseWear('match')).toEqual({ kind: 'match' })
    expect(parseWear('--match')).toEqual({ kind: 'match' })
  })
})

describe('matching the theme', () => {
  test('a light look on a dark theme sets light, names the change and how to undo it, and remembers the old theme', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await start($)
    const said = await wear($, 'paper --match')
    expect(said).toContain("Claude Code's theme set to light to match paper (was dark). /wear default puts it back.")
    expect(w.config.theme).toBe('light')
    expect(w.config.sets).toEqual([{ key: 'theme', value: 'light' }])
    expect(w.store.get('ownTheme')).toBe('dark')
  })

  test('the variant the person chose is kept: dark-daltonized becomes light-daltonized', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], theme: 'dark-daltonized' })
    await start($)
    await wear($, 'paper --match')
    expect(w.config.theme).toBe('light-daltonized')
    expect(w.store.get('ownTheme')).toBe('dark-daltonized')
  })

  test('a look of the same tone changes nothing and says so', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await start($)
    const said = await wear($, 'halloween --match')
    expect(said).toContain("Claude Code's theme is already dark.")
    expect(w.config.sets).toEqual([])
    expect(w.store.get('ownTheme')).toBeUndefined()
  })

  test('/wear match works on the look worn now, and says so when none is', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await start($)
    expect(await wear($, 'match')).toContain('No look is worn, so there is no theme to match.')
    await wear($, 'paper')
    await wear($, 'match')
    expect(w.config.theme).toBe('light')
  })

  test('/wear default puts the person\'s theme back and forgets it; without a match it touches nothing', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await start($)
    await wear($, 'paper --match')
    const back = await wear($, 'default')
    expect(back).toContain("Claude Code's theme is back to dark.")
    expect(w.config.theme).toBe('dark')
    expect(w.store.get('ownTheme')).toBeUndefined()
    w.config.sets.length = 0
    await wear($, 'default')
    expect(w.config.sets).toEqual([])
  })

  test('a theme the person picks after a match stands: /wear default leaves it and forgets the match', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await start($)
    await wear($, 'paper --match')
    expect(w.store.get('ownTheme')).toBe('dark')
    // The person, in /config, after the match.
    await $.config.set({ key: 'theme', value: 'dark-daltonized', previous: 'light', provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
    expect(w.store.get('ownTheme')).toBeUndefined()
    expect(w.store.get('matchedTheme')).toBeUndefined()
    const sets = w.config.sets.length
    const back = await wear($, 'default')
    expect(back).not.toContain("Claude Code's theme")
    expect(w.config.theme).toBe('dark-daltonized')
    expect(w.config.sets).toHaveLength(sets)
  })

  test('a theme changed outside this session since the match (another session, a hand edit) stands too, and says so', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await start($)
    await wear($, 'paper --match')
    expect(w.store.get('matchedTheme')).toBe('light')
    w.config.theme = 'dark-ansi' // written elsewhere: no config.set reaches this session
    const sets = w.config.sets.length
    const back = await wear($, 'default')
    expect(back).toContain("Claude Code's theme was changed since the match, so it stays dark-ansi.")
    expect(w.config.theme).toBe('dark-ansi')
    expect(w.config.sets).toHaveLength(sets)
    expect(w.store.get('ownTheme')).toBeUndefined()
    expect(w.store.get('matchedTheme')).toBeUndefined()
  })

  test('on the desktop app a match says the setting is the terminal\'s theme, since the app wears the look through its palette', async ($, on) => {
    world(on, { surfaces: ['desktop'] })
    await start($)
    expect(await wear($, 'paper --match')).toContain("The desktop app wears the look's own palette; this setting is the terminal's theme.")
  })

  test('a second match keeps the first remembered theme, so default returns to what the person had', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await start($)
    await wear($, 'paper --match')
    await wear($, 'dracula --match')
    expect(w.config.theme).toBe('dark')
    expect(w.store.get('ownTheme')).toBe('dark')
    await wear($, 'default')
    expect(w.config.theme).toBe('dark')
    expect(w.store.get('ownTheme')).toBeUndefined()
  })

  test('a refusal is reported once, nothing is remembered, and no retry is made', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await start($)
    w.config.deny = 'the theme stays'
    const said = await wear($, 'paper --match')
    expect(said).toContain("Claude Code's theme stays dark: the theme stays")
    expect(w.config.sets).toHaveLength(1)
    expect(w.config.theme).toBe('dark')
    expect(w.store.get('ownTheme')).toBeUndefined()
  })

  test('a locked theme row is left alone and named', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], themeLocked: true })
    await start($)
    expect(await wear($, 'paper --match')).toContain("Claude Code's theme stays dark: the setting is locked.")
    expect(w.config.sets).toEqual([])
  })

  test('a refused restore keeps the memory so /wear default can be run again', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await start($)
    await wear($, 'paper --match')
    w.config.deny = 'not now'
    expect(await wear($, 'default')).toContain("Claude Code's theme stays as it is: not now Run /wear default again to retry.")
    expect(w.store.get('ownTheme')).toBe('dark')
    w.config.deny = null
    await wear($, 'default')
    expect(w.config.theme).toBe('dark')
    expect(w.store.get('ownTheme')).toBeUndefined()
  })
})

describe('matching by default', () => {
  test('a light look put on over a dark theme sets light and says so once, with how to undo it; later looks move the match unsaid; default puts the theme back', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await start($)
    expect(await wear($, 'paper')).toBe("Wearing paper everywhere without a pin. Claude Code's theme set to light to match paper (was dark). /wear default puts it back.")
    expect(w.heard.at(-1)).toMatchObject({ via: 'toast', timeoutMs: 7000 }) // two sentences: time to read them
    expect(w.config.theme).toBe('light')
    expect(w.store.get('ownTheme')).toBe('dark')
    expect(await wear($, 'dracula')).toBe('Wearing dracula everywhere without a pin.')
    expect(w.config.theme).toBe('dark')
    expect(await wear($, 'paper')).toBe('Wearing paper everywhere without a pin.')
    expect(w.config.theme).toBe('light')
    expect(w.store.get('ownTheme')).toBe('dark') // the theme before the first match, through every later one
    expect(await wear($, 'default')).toBe("Wearing Claude Code's own look everywhere without a pin. Claude Code's theme is back to dark.")
    expect(w.config.theme).toBe('dark')
    expect(w.store.get('ownTheme')).toBeUndefined()
    expect(w.store.get('matchedTheme')).toBeUndefined()
  })

  test('a look of the theme\'s own tone changes nothing, remembers nothing and says nothing of it', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await start($)
    expect(await wear($, 'dracula')).toBe('Wearing dracula everywhere without a pin.')
    expect(w.config.sets).toEqual([])
    expect(w.store.get('ownTheme')).toBeUndefined()
  })

  test('where Claude Code lists the look\'s own theme file, the look put on takes it', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], pluginThemes: true })
    await start($)
    expect(await wear($, 'dracula')).toBe("Wearing dracula everywhere without a pin. Claude Code's theme set to custom:wardrobe:dracula to match dracula (was dark). /wear default puts it back.")
    expect(await wear($, 'nord')).toBe('Wearing nord everywhere without a pin.')
    expect(w.config.theme).toBe('custom:wardrobe:nord')
    await wear($, 'default')
    expect(w.config.theme).toBe('dark')
  })

  test('a locked theme row is left alone, unsaid; a light look then says only what it is made for', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], themeLocked: true })
    await start($)
    expect(await wear($, 'paper')).toBe('Wearing paper everywhere without a pin. paper is made for a light theme.')
    expect(await wear($, 'dracula')).toBe('Wearing dracula everywhere without a pin.')
    expect(w.config.sets).toEqual([])
    expect(w.store.get('ownTheme')).toBeUndefined()
  })

  test('a refusal is said, nothing is remembered and no retry is made', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await start($)
    w.config.deny = 'the theme stays'
    expect(await wear($, 'paper')).toBe("Wearing paper everywhere without a pin. Claude Code's theme stays dark: the theme stays")
    expect(w.config.sets).toHaveLength(1)
    expect(w.config.theme).toBe('dark')
    expect(w.store.get('ownTheme')).toBeUndefined()
  })

  test('a theme changed elsewhere since the last match is the person\'s own: the next look remembers that one', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await start($)
    await wear($, 'paper')
    await wear($, 'dracula')
    expect(w.store.get('ownTheme')).toBe('dark')
    w.config.theme = 'dark-ansi' // written elsewhere: no config.set reaches this session
    expect(await wear($, 'paper')).toBe("Wearing paper everywhere without a pin. Claude Code's theme set to light-ansi to match paper (was dark-ansi). /wear default puts it back.")
    expect(w.store.get('ownTheme')).toBe('dark-ansi')
    await wear($, 'default')
    expect(w.config.theme).toBe('dark-ansi')
  })

  test('with the setting off a look changes nothing of Claude Code\'s, and a light look names --match', { options: MATCH_OFF }, async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await start($)
    expect(await wear($, 'paper')).toBe("Wearing paper everywhere without a pin. paper is made for a light theme; /wear paper --match sets Claude Code's theme to match.")
    expect(w.config.sets).toEqual([])
    expect(await wear($, 'paper --match')).toContain("Claude Code's theme set to light to match paper (was dark).")
    expect(w.config.theme).toBe('light')
  })
})

describe('a match follows the look', () => {
  test('auto: once a match is made the theme turns with the clock, and nothing more is said', { options: SETTINGS }, async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], now: at(9, 0) })
    await start($)
    await wear($, 'auto') // paper by day
    expect(w.config.theme).toBe('light')
    await w.clock.advance(10 * 60 * 60_000) // 19:00: tokyo-night
    await w.clock.settle()
    expect(w.config.theme).toBe('dark')
    expect(w.store.get('matchedTheme')).toBe('dark')
    expect(w.store.get('ownTheme')).toBe('dark')
    expect(w.heard.filter(heard => heard.text.includes("Claude Code's theme"))).toHaveLength(1) // by /wear, once
  })

  test('it never starts a match: a look that changes by itself leaves a theme wardrobe never set', { options: SETTINGS }, async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], now: at(6, 59), theme: 'dark', store: { global: 'auto' } })
    await start($)
    await w.clock.advance(2 * 60_000) // 07:01: paper, a light look, on a dark theme
    await w.clock.settle()
    expect(w.config.sets).toEqual([])
    expect(w.store.get('ownTheme')).toBeUndefined()
  })

  test('a theme the person chose since the match is left alone', { options: SETTINGS }, async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], now: at(9, 0) })
    await start($)
    await wear($, 'auto')
    w.config.theme = 'light-ansi' // written elsewhere
    const sets = w.config.sets.length
    await w.clock.advance(10 * 60 * 60_000)
    await w.clock.settle()
    expect(w.config.sets).toHaveLength(sets)
    expect(w.config.theme).toBe('light-ansi')
  })

  test('a new session carries a standing match to the look it starts in, unsaid', { options: SETTINGS }, async ($, on) => {
    // Matched to paper by day in an earlier session; this one starts at night, in tokyo-night.
    const w = world(on, { surfaces: ['terminal'], now: at(21, 0), theme: 'light', store: { global: 'auto', ownTheme: 'dark', matchedTheme: 'light' } })
    await start($)
    expect(w.config.theme).toBe('dark')
    expect(w.store.get('matchedTheme')).toBe('dark')
    expect(w.store.get('ownTheme')).toBe('dark')
    expect(w.heard).toEqual([])
  })

  test('a pinned project never carries: one theme setting serves every project, and its own look must not turn theirs over', { options: SETTINGS }, async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], theme: 'light', root: '/work/alpha', store: { global: 'paper', pins: { '/work/alpha': 'dracula' }, ownTheme: 'dark', matchedTheme: 'light' } })
    await start($)
    await w.clock.advance(2 * 60_000)
    expect(w.config.sets).toEqual([])
    // Nor does a plain /wear there: the pin's look is this project's own.
    expect(await wear($, 'nord')).toBe('Wearing nord in this project (pinned).')
    expect(w.config.sets).toEqual([])
  })

  test('auto by day wearing Claude Code\'s own look: the theme goes back to the person\'s own, and the match is kept for the night', { options: { ...SETTINGS, dayTheme: 'default' } }, async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], now: at(21, 0), theme: 'light' })
    await start($)
    await wear($, 'auto') // tokyo-night by night, on a light theme
    expect(w.config.theme).toBe('dark')
    expect(w.store.get('ownTheme')).toBe('light')
    await w.clock.advance(10 * 60 * 60_000) // 07:00: Claude Code's own look
    await w.clock.settle()
    expect(w.config.theme).toBe('light')
    expect(w.store.get('ownTheme')).toBe('light') // kept: the night will want it
    await w.clock.advance(12 * 60 * 60_000) // 19:00: tokyo-night again
    await w.clock.settle()
    expect(w.config.theme).toBe('dark')
    expect(await wear($, 'default')).toContain("Claude Code's theme is back to light.")
    expect(w.store.get('ownTheme')).toBeUndefined()
  })

  test('with the setting off nothing is carried', { options: MATCH_OFF }, async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], now: at(21, 0), theme: 'light', store: { global: 'auto', ownTheme: 'dark', matchedTheme: 'light' } })
    await start($)
    await w.clock.advance(2 * 60_000)
    expect(w.config.sets).toEqual([])
  })
})

describe('a match belongs to where it was made', () => {
  const pinned = { root: '/work/alpha', store: { global: 'paper', pins: { '/work/alpha': 'dracula' } } }

  test('a pinned project leaves the one theme setting alone on /wear, and a light look there names --match', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], root: '/work/alpha', store: { pins: { '/work/alpha': 'dracula' } } })
    await start($)
    expect(await wear($, 'paper')).toBe("Wearing paper in this project (pinned). paper is made for a light theme; /wear paper --match sets Claude Code's theme to match.")
    expect(w.config.sets).toEqual([])
    expect(w.store.get('ownTheme')).toBeUndefined()
  })

  test('/wear default in a pinned project leaves a match the shared look made, which other projects still wear', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], root: '/work/beta', store: { pins: { '/work/alpha': 'dracula' } } })
    await start($)
    await wear($, 'paper') // the shared look, matched: light
    expect(w.config.theme).toBe('light')
    w.cd('/work/alpha')
    await start($)
    expect(await wear($, 'default')).toBe("Wearing Claude Code's own look in this project (pinned).")
    expect(w.config.theme).toBe('light')
    expect(w.store.get('ownTheme')).toBe('dark')
    // Where the match was made, /wear default gives the theme back.
    w.cd('/work/beta')
    await start($)
    expect(await wear($, 'default')).toContain("Claude Code's theme is back to dark.")
  })

  test('--match in a pinned project is that project\'s: the shared look never carries it off, and /wear default there gives the theme back', { options: SETTINGS }, async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], ...pinned })
    await start($)
    expect(await wear($, 'dracula --match')).toContain("Claude Code's theme is already dark.")
    expect(await wear($, 'paper --match')).toContain("Claude Code's theme set to light to match paper (was dark).")
    expect(w.store.get('matchRoot')).toBe('/work/alpha')
    await wear($, 'dracula --match')
    expect(w.config.theme).toBe('dark')
    // A session in a project with no pin starts, wearing paper: it leaves this project's match be.
    const sets = w.config.sets.length
    w.cd('/work/beta')
    await start($)
    await w.clock.advance(2 * 60_000)
    expect(w.config.sets).toHaveLength(sets)
    // /wear default over there is not where the match was made either.
    expect(await wear($, 'default')).toBe("Wearing Claude Code's own look everywhere without a pin.")
    expect(w.config.sets).toHaveLength(sets)
    w.cd('/work/alpha')
    await start($)
    await wear($, 'paper --match')
    expect(await wear($, 'default')).toBe("Wearing Claude Code's own look in this project (pinned). Claude Code's theme is back to dark.")
    expect(w.store.get('matchRoot')).toBeUndefined()
    expect(w.store.get('ownTheme')).toBeUndefined()
  })

  test('/wear unpin hands a match made on the pin to the shared look, or gives the theme back where that look is Claude Code\'s own', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], root: '/work/alpha', store: { pins: { '/work/alpha': 'paper' } } })
    await start($)
    await wear($, 'paper --match')
    expect(w.config.theme).toBe('light')
    expect(await wear($, 'unpin')).toBe("Unpinned /work/alpha. Wearing Claude Code's own look everywhere without a pin. Claude Code's theme is back to dark.")
    expect(w.config.theme).toBe('dark')
    expect(w.store.get('matchRoot')).toBeUndefined()
    expect(w.store.get('ownTheme')).toBeUndefined()
  })

  test('/wear everywhere takes a pinned project\'s match with it: the shared look owns it from then on', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], root: '/work/alpha', store: { global: 'dracula', pins: { '/work/alpha': 'paper' } } })
    await start($)
    await wear($, 'paper --match')
    expect(w.store.get('matchRoot')).toBe('/work/alpha')
    await wear($, 'everywhere')
    expect(w.store.get('matchRoot')).toBeUndefined()
    expect(w.config.theme).toBe('light')
    expect(await wear($, 'default')).toContain("Claude Code's theme is back to dark.")
  })
})

describe('a theme setting that cannot be written or read', () => {
  test('a write that fails outright leaves nothing remembered, so nothing is carried later', { options: SETTINGS }, async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], now: at(9, 0) })
    await start($)
    w.config.fails = true
    expect(await wear($, 'auto')).toContain('paper is made for a light theme.') // paper by day: the quiet match failed, the look is on
    expect(w.store.get('ownTheme')).toBeUndefined()
    expect(w.store.get('matchedTheme')).toBeUndefined()
    w.config.fails = false
    const sets = w.config.sets.length
    await w.clock.advance(10 * 60 * 60_000) // 19:00: tokyo-night; no match stands, so none is carried
    await w.clock.settle()
    expect(w.config.sets).toHaveLength(sets)
  })

  test('/wear default never writes over a theme it could not read; the memory stays for a retry', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await start($)
    await wear($, 'paper')
    const sets = w.config.sets.length
    w.config.blind = true
    expect(await wear($, 'default')).toBe("Wearing Claude Code's own look everywhere without a pin. Claude Code's theme could not be read, so it stays as it is. Run /wear default again to retry.")
    expect(w.config.sets).toHaveLength(sets)
    expect(w.store.get('ownTheme')).toBe('dark')
    w.config.blind = false
    expect(await wear($, 'default')).toContain("Claude Code's theme is back to dark.")
  })
})

describe('the gallery button', () => {
  test('with matching on, a card has no match button: its wear button wears the look and matches the theme', async ($, on) => {
    const w = world(on, { surfaces: ['terminal', 'desktop'], placesPanes: true })
    await start($)
    await wear($, '')
    const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'desktop', component: 'Pane', requestId: 'wardrobe', props: { title: 'Wardrobe', bodyColumns: 100, bodyRows: 60 } as never })
    expect((await ui.findAll({ type: 'Button' })).some(button => String(button.key).startsWith('match-'))).toBe(false)
    await ui.press({ key: 'wear-paper' })
    await w.clock.settle()
    expect(w.config.theme).toBe('light')
    expect(w.store.get('ownTheme')).toBe('dark')
    expect(w.heard.map(heard => heard.text).join('\n')).toContain('set to light to match paper')
    // The default row puts the person's theme back, as /wear default does.
    await ui.press({ key: 'wear-default' })
    await w.clock.settle()
    expect(w.config.theme).toBe('dark')
    expect(w.store.get('ownTheme')).toBeUndefined()
    await ui.unmount()
  })

  test('with matching left to the person, each theme card has a match theme button; pressing it wears the look and matches the theme', { options: MATCH_OFF }, async ($, on) => {
    const w = world(on, { surfaces: ['terminal', 'desktop'], placesPanes: true })
    await start($)
    await wear($, '')
    const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'desktop', component: 'Pane', requestId: 'wardrobe', props: { title: 'Wardrobe', bodyColumns: 100, bodyRows: 60 } as never })
    const button = await ui.find({ key: 'match-paper' })
    expect(button?.props.label).toBe('match theme')
    await ui.press({ key: 'match-paper' })
    await w.clock.settle()
    expect(w.config.theme).toBe('light')
    expect(w.store.get('ownTheme')).toBe('dark')
    expect(w.heard.map(heard => heard.text).join('\n')).toContain('set to light to match paper')
    await ui.unmount()
  })
})

describe('the looks as Claude Code themes', () => {
  test('when Claude Code lists the look\'s own theme file, --match prefers it to the nearest built-in, and default still restores', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'], pluginThemes: true })
    await start($)
    const said = await wear($, 'paper --match')
    expect(said).toContain("Claude Code's theme set to custom:wardrobe:paper to match paper (was dark). /wear default puts it back.")
    expect(w.config.theme).toBe('custom:wardrobe:paper')
    await wear($, 'default')
    expect(w.config.theme).toBe('dark')
  })

  test('a matched plugin theme counts as its own tone: paper then paints on the terminal', async ($, on) => {
    world(on, { surfaces: ['terminal'], pluginThemes: true })
    await start($)
    expect(await wear($, 'paper --match')).not.toContain('made for a light theme')
  })
})
