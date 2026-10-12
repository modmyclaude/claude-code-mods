// The wiring: every folder the registry names goes through the validator at
// session start, the pane says what each can reach, the band speaks only for a
// new or changed mod and never over a hold, a validator that fails claims
// nothing, and only the named files and the validator are ever touched.

import { describe, expect, test } from 'claude-code/testing'

import { GATEKEEPER, HOME, MARKET, NETTY, NETTY_REPORT, SURFACES, ZEN, band, pane, report, run, start, world } from './world'
import type { World } from './world'

/** The mod names in the seen record, sorted. */
const names = (w: World) => Object.values(w.store.get('seen') as Record<string, { name: string }>).map(s => s.name).sort()
/** The hash the seen record holds for one plugin folder. */
const hashAt = (w: World, root: string) => (w.store.get('seen') as Record<string, { hash: string }>)[root]?.hash

describe('the check', () => {
  test('every folder the registry names is checked; the pane draws a row each with its reach, on both surfaces', async ($, on) => {
    const w = world(on)
    await start($, w)
    expect(w.runs.map(r => r[4]).sort()).toEqual(expect.arrayContaining([NETTY, ZEN, GATEKEEPER]))
    for (const r of w.runs) expect(r.slice(0, 4)).toEqual(['claude', 'plugin', 'validate', '--json'])
    for (const surface of SURFACES) {
      const { rows, texts } = await pane($, surface)
      expect(rows.netty).toContain('1.0.0')
      expect(rows.netty).toContain('runs programs, reaches the network')
      expect(rows.gatekeeper).toContain('can change tool calls')
      expect(rows.zen).toContain('nothing declared')
      expect(rows.bouncer).toContain('loaded')
      const words = texts.filter(t => /^(, )?(reaches the network|runs programs|can change tool calls|nothing declared)$/.test(t.text))
      expect(words.map(t => t.text)).toEqual(expect.arrayContaining(['runs programs', ', reaches the network', 'can change tool calls', 'nothing declared']))
      expect(words.filter(t => t.text !== 'nothing declared').every(t => t.color === 'warning')).toBe(true)
      expect(words.find(t => t.text === 'nothing declared')?.color).toBeUndefined()
      expect(texts.some(t => t.text.startsWith('Checked 4 mods at'))).toBe(true)
    }
  })

  test('the band names a new mod and its notable reach; a session that has seen the same reports is quiet; a changed report is named again', async ($, on) => {
    const w = world(on)
    await start($, w)
    const first = await band($, 'terminal')
    expect(first.line).toContain('new mods')
    expect(first.line).toContain('netty (runs programs, reaches the network)')
    expect(first.line).toContain('gatekeeper (can change tool calls)')
    expect(first.other).toBe("another mod's line")
    expect(names(w)).toEqual(['bouncer', 'gatekeeper', 'netty', 'zen'])
    expect(Object.keys(w.store.get('seen') as object)).toEqual(expect.arrayContaining([NETTY, ZEN, GATEKEEPER]))
    // The next session, with the same store: nothing new.
    const was = hashAt(w, NETTY)
    await run($, 'ok')
    expect((await band($, 'terminal')).line).toBeUndefined()
    w.reports[NETTY] = report(['./register.tsx calls: $.http.fetch, $.process.run, $.model.complete, $.ui.toast'])
    await run($, 'check')
    const changed = await band($, 'desktop')
    expect(changed.line).toBe('bouncer: 1 changed: netty (runs programs, reaches the network)')
    expect(hashAt(w, NETTY)).not.toBe(was)
    // Looking at the pane clears the line for this session.
    await run($, '')
    expect((await band($, 'terminal')).line).toBeUndefined()
  })

  test('a validator that fails, or prints something else, claims nothing: could not check, not new, not stored', async ($, on) => {
    const w = world(on, { reports: { [GATEKEEPER]: 'fail', [ZEN]: 'junk' } })
    await start($, w)
    const { rows } = await pane($, 'terminal')
    expect(rows.gatekeeper).toContain('could not check: the validator exited with 1')
    expect(rows.zen).toContain('could not check: the report could not be read')
    expect(rows.gatekeeper).not.toContain('tool calls')
    expect((await band($, 'terminal')).line).not.toContain('gatekeeper')
    expect(names(w)).toEqual(['bouncer', 'netty'])
  })

  test('a validator that cannot start at all is reported as such, never taken as clean', async ($, on) => {
    const w = world(on, { reports: { [NETTY]: 'missing', [ZEN]: 'missing', [GATEKEEPER]: 'missing' } })
    await start($, w)
    const { rows } = await pane($, 'terminal')
    expect(rows.netty, rows.netty).toContain('could not check: spawn claude ENOENT') // the call's own name is not repeated to the person
    expect(rows.netty).not.toContain('nothing declared')
    expect((await band($, 'terminal')).line ?? '').not.toContain('netty')
    expect(names(w)).toEqual(['bouncer'])
  })

  test('the store holds, per plugin folder, the mod name and its reach hash, nothing else', async ($, on) => {
    const w = world(on)
    await start($, w)
    expect([...w.store.keys()]).toEqual(['seen'])
    const seen = Object.entries(w.store.get('seen') as Record<string, { name: string; hash: string }>)
    expect(seen).toHaveLength(4)
    for (const [root, value] of seen) {
      expect(root).toContain('/')
      expect(Object.keys(value).sort()).toEqual(['hash', 'name'])
      expect(value.name).toMatch(/^[a-z-]+$/)
      expect(value.hash).toMatch(/^[0-9a-f]{8}$/)
    }
  })

  test('a copy under development beside the installed one: two rows, each with its folder and its own hash, and neither flaps', async ($, on) => {
    const w = world(on)
    const DEV = `${MARKET}/mods/netty-dev`
    w.files[`${MARKET}/.claude-plugin/marketplace.json`] = JSON.stringify({ name: 'local', plugins: [{ name: 'zen', source: './mods/zen' }, { name: 'gatekeeper', source: './mods/gatekeeper' }, { name: 'netty', source: './mods/netty-dev' }] })
    w.files[`${DEV}/.claude-plugin/plugin.json`] = JSON.stringify({ name: 'netty', version: '1.0.0' })
    w.reports[DEV] = NETTY_REPORT
    await start($, w)
    expect(Object.keys(w.store.get('seen') as object)).toEqual(expect.arrayContaining([NETTY, DEV]))
    const { rows } = await pane($, 'terminal')
    const twins = `${rows['netty-1']} | ${rows['netty-2']}`
    expect(twins).toContain('netty-dev')
    expect(twins).toContain('netty/1.0.0')
    expect(rows.zen).not.toContain(ZEN) // a name on its own shows no folder
    await run($, 'ok')
    // The development copy gains reach: it alone is named, and the installed copy's hash stands.
    const installed = hashAt(w, NETTY)
    w.reports[DEV] = report(['./register.tsx calls: $.fs.write, $.http.fetch, $.process.run, $.ui.toast'])
    await run($, 'check')
    expect((await band($, 'terminal')).line).toBe('bouncer: 1 changed: netty (runs programs, reaches the network)')
    expect(hashAt(w, NETTY)).toBe(installed)
    await run($, 'ok')
    await run($, 'check')
    expect((await band($, 'terminal')).line).toBeUndefined() // the same two reports again: quiet
  })

  test('an update that installs into a new folder is compared with the old one: quiet for the same reach, changed when it grew, never new', async ($, on) => {
    const w = world(on)
    await start($, w)
    await run($, 'ok')
    const installed = (root: string, version: string) => {
      w.files[`${HOME}/.claude/plugins/installed_plugins.json`] = JSON.stringify({ version: 2, plugins: { 'netty@shop': [{ scope: 'user', installPath: root, version }] } })
      w.files[`${root}/.claude-plugin/plugin.json`] = JSON.stringify({ name: 'netty', version })
    }
    const NEXT = `${HOME}/.claude/plugins/cache/shop/netty/1.1.0`
    installed(NEXT, '1.1.0')
    w.reports[NEXT] = NETTY_REPORT
    await run($, 'check')
    expect((await band($, 'terminal')).line).toBeUndefined()
    expect(Object.keys(w.store.get('seen') as object)).toContain(NEXT)
    expect(Object.keys(w.store.get('seen') as object)).not.toContain(NETTY)
    const moved = (await pane($, 'terminal')).rows.netty
    expect(moved).toContain('1.1.0')
    expect(moved).not.toContain('new')
    const LATER = `${HOME}/.claude/plugins/cache/shop/netty/1.2.0`
    installed(LATER, '1.2.0')
    w.reports[LATER] = report(['./register.tsx calls: $.http.fetch, $.process.run, $.model.complete, $.ui.toast'])
    await run($, 'check')
    expect((await band($, 'terminal')).line).toBe('bouncer: 1 changed: netty (runs programs, reaches the network)')
    expect((await pane($, 'terminal')).rows.netty).toContain('changed')
  })

  test('details unfolds one mod\'s validator lines, and only that one', async ($, on) => {
    const w = world(on)
    await start($, w)
    const opened = await pane($, 'terminal', 'details-netty')
    expect(opened.whole).toContain('$.http.fetch (via push)')
    expect(opened.whole).not.toContain('command.run{command=gate}')
    const closed = await pane($, 'terminal', 'details-netty')
    expect(closed.whole).not.toContain('$.http.fetch (via push)')
  })

  test('it reads only the registry files and each folder\'s manifest, runs only the validator, and nothing else', async ($, on) => {
    const w = world(on)
    await start($, w)
    const allowed = [
      `${HOME}/.claude/plugins/installed_plugins.json`,
      `${HOME}/.claude/plugins/known_marketplaces.json`,
      `${MARKET}/.claude-plugin/marketplace.json`,
      `${NETTY}/.claude-plugin/plugin.json`,
      `${ZEN}/.claude-plugin/plugin.json`,
      `${GATEKEEPER}/.claude-plugin/plugin.json`,
    ]
    for (const path of w.reads) expect(allowed, path).toContain(path)
    expect(w.reads).toContain(`${MARKET}/.claude-plugin/marketplace.json`)
    for (const argv of w.runs) {
      expect(argv).toHaveLength(5)
      expect(argv.slice(0, 4)).toEqual(['claude', 'plugin', 'validate', '--json'])
    }
    expect(w.runs.map(r => r[4])).not.toContain(`${MARKET}/../outside`)
  })

  test('the claudeBin setting names the binary the validator runs through', { options: { claudeBin: '/opt/claude/bin/claude' } }, async ($, on) => {
    const w = world(on)
    await start($, w)
    expect(w.runs[0]?.[0]).toBe('/opt/claude/bin/claude')
  })
})

describe('the band and the commands', () => {
  test('while a safety hold waits beneath, the band is left to it alone', async ($, on) => {
    const w = world(on, { holdBeneath: true })
    await start($, w)
    for (const surface of SURFACES) {
      const drawn = await band($, surface)
      expect(drawn.hold).toContain('held: rm -rf build')
      expect(drawn.line).toBeUndefined()
    }
  })

  test('/bouncer answers {} and opens the pane; where none can be placed the lines go to the transcript', async ($, on) => {
    const w = world(on, { isPanePlaced: false })
    await start($, w)
    expect(await run($, '')).toEqual({})
    expect(w.panes).toEqual(['bouncer'])
    expect(w.logs[0]).toContain('Bouncer: 4 mods checked. Facts from the validator, not a verdict.')
    expect(w.logs[0]).toContain('netty 1.0.0: runs programs, reaches the network (new)')
    expect(await run($, 'bogus')).toEqual({})
    expect(w.toasts.at(-1)).toContain('/bouncer check')
  })

  test('on the desktop the Bolt accent is one glyph per cell, never block characters beside words', async ($, on) => {
    const w = world(on)
    await start($, w)
    const glyph = /[▀-▟]/u
    const { texts } = await pane($, 'desktop')
    const cells = texts.filter(t => glyph.test(t.text))
    expect(cells.length).toBeGreaterThan(0)
    for (const t of cells) expect([...t.text].length, t.text).toBe(1)
    expect((await pane($, 'desktop', undefined, 30)).texts.some(t => glyph.test(t.text))).toBe(false)
  })
})
