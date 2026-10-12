// The wiring: every folder the registry names goes through the validator at
// session start, the pane says what each can reach, the band speaks only for a
// new or changed mod and never over a hold, a validator that fails claims
// nothing, and only the named files and the validator are ever touched.

import { describe, expect, test } from 'claude-code/testing'

import { GATEKEEPER, HOME, MARKET, NETTY, SURFACES, ZEN, band, pane, report, run, start, world } from './world'

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
    expect(Object.keys(w.store.get('seen') as object).sort()).toEqual(['bouncer', 'gatekeeper', 'netty', 'zen'])
    // The next session, with the same store: nothing new.
    const seen = w.store.get('seen') as Record<string, string>
    await run($, 'ok')
    expect((await band($, 'terminal')).line).toBeUndefined()
    w.reports[NETTY] = report(['./register.tsx calls: $.http.fetch, $.process.run, $.model.complete, $.ui.toast'])
    await run($, 'check')
    const changed = await band($, 'desktop')
    expect(changed.line).toBe('bouncer: 1 changed: netty (runs programs, reaches the network)')
    expect((w.store.get('seen') as Record<string, string>).netty).not.toBe(seen.netty)
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
    expect(Object.keys(w.store.get('seen') as object).sort()).toEqual(['bouncer', 'netty'])
  })

  test('a validator that cannot start at all is reported as such, never taken as clean', async ($, on) => {
    const w = world(on, { reports: { [NETTY]: 'missing', [ZEN]: 'missing', [GATEKEEPER]: 'missing' } })
    await start($, w)
    const { rows } = await pane($, 'terminal')
    expect(rows.netty, rows.netty).toContain('could not check: spawn claude ENOENT') // the call's own name is not repeated to the person
    expect(rows.netty).not.toContain('nothing declared')
    expect((await band($, 'terminal')).line ?? '').not.toContain('netty')
    expect(Object.keys(w.store.get('seen') as object)).toEqual(['bouncer'])
  })

  test('the store holds mod names and reach hashes, nothing else', async ($, on) => {
    const w = world(on)
    await start($, w)
    expect([...w.store.keys()]).toEqual(['seen'])
    for (const [name, hash] of Object.entries(w.store.get('seen') as Record<string, string>)) {
      expect(name).toMatch(/^[a-z-]+$/)
      expect(hash).toMatch(/^[0-9a-f]{8}$/)
    }
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
