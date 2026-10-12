// Matching Claude Code's own theme to a look is offered, never imposed: only
// `/wear <look> --match`, `/wear match` or the gallery's `match theme` button
// change the `theme` setting, the person's own theme is remembered, `/wear
// default` puts it back, and a refusal is reported once and never retried.

import { describe, expect, test } from 'claude-code/testing'

import { parseWear } from '../hooks/look'
import { start, wear, world } from './setup'

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
    await $.config.set({ key: 'theme', value: 'dark-daltonized', previous: 'light', provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } } as never)
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

  test('on the desktop app a match says it changes the terminal\'s theme, since the app keeps its own look', async ($, on) => {
    world(on, { surfaces: ['desktop'] })
    await start($)
    expect(await wear($, 'paper --match')).toContain("The desktop app keeps its own look; this changes the terminal's theme.")
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

describe('the gallery button', () => {
  test('each theme card has a match theme button; pressing it wears the look and matches the theme', async ($, on) => {
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
    expect(w.heard.map(h => h.text).join('\n')).toContain('set to light to match paper')
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
