// The pure parts: reading a validator report, the hash, the registry files, the words.

import { describe, expect, test } from 'claude-code/testing'

import { bandWords, clean, directoryMarketplaces, doorText, hashOf, installedRoots, manifestOf, marketplaceRoots, parseReport, reachWords, seenOf, splitTop } from '../hooks/door'
import type { BouncerRow } from '../types'
import { CLEAN, GATEKEEPER_REPORT, NETTY_REPORT, ZEN_REPORT, report } from './world'

describe('reading a report', () => {
  test('calls and hooks come off the notes; the reach follows them', () => {
    const netty = parseReport(NETTY_REPORT)
    expect(netty?.success).toBe(true)
    expect(netty?.reach.calls).toEqual(['$.clock.now', '$.http.fetch', '$.process.run', '$.ui.toast'])
    expect(netty?.reach.hooks).toEqual(['session.start', 'turn.complete'])
    expect(netty?.reach).toMatchObject({ files: 'none', processes: true, network: true, model: false, changesToolCalls: false })
    const gate = parseReport(GATEKEEPER_REPORT)
    expect(gate?.reach).toMatchObject({ changesToolCalls: true, network: false, processes: false })
    expect(gate?.reach.hooks).toEqual(['command.run{command=gate}', 'tool.call{tool=Bash}'])
    expect(parseReport(ZEN_REPORT)?.reach.calls).toEqual([])
    const files = parseReport(report(['./a.ts calls: $.fs.read, $.fs.write, $.prompt.submit, $.model.complete, $.audio.play, $.env.get, $.settings.read', './a.ts hooks: prompt.submit, prompt.compose']))
    expect(files?.reach).toMatchObject({ files: 'read-write', typesForYou: true, model: true, sound: true, env: true, settings: true, holdsPrompts: true, changesPrompt: true })
  })

  test('text that is no report, or a report of another shape, reads as null', () => {
    expect(parseReport('not json')).toBeNull()
    expect(parseReport('{"success":"yes"}')).toBeNull()
    expect(parseReport('{"success":true}')).toBeNull()
    expect(parseReport('[]')).toBeNull()
  })

  test('a matcher with commas inside braces is one hook', () => {
    expect(splitTop('tool.call{tool=Bash, agentId=x}, session.start')).toEqual(['tool.call{tool=Bash, agentId=x}', 'session.start'])
    expect(parseReport(report(['./a.ts hooks: tool.call{tool=Bash, agentId=x}, session.start']))?.reach.hooks).toEqual(['session.start', 'tool.call{tool=Bash, agentId=x}'])
  })

  test('the hash is stable for one reach and changes with a call or a hook', () => {
    const a = parseReport(NETTY_REPORT)?.reach
    const b = parseReport(NETTY_REPORT)?.reach
    expect(a && b && hashOf(a) === hashOf(b)).toBe(true)
    expect(hashOf({ calls: ['$.http.fetch'], hooks: [] })).not.toBe(hashOf({ calls: ['$.http.fetch', '$.fs.read'], hooks: [] }))
    expect(hashOf({ calls: [], hooks: ['tool.call'] })).not.toBe(hashOf({ calls: [], hooks: [] }))
    expect(hashOf({ calls: [], hooks: [] })).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('the registry files', () => {
  test('install paths, directory marketplaces, and the plugin folders a marketplace names under itself', () => {
    expect(installedRoots({ version: 2, plugins: { 'a@m': [{ installPath: '/p/a' }, { installPath: 'relative' }], 'b@m': 'junk' } })).toEqual(['/p/a'])
    expect(installedRoots(null)).toEqual([])
    expect(directoryMarketplaces({ x: { source: { source: 'directory' }, installLocation: '/m/' }, y: { source: { source: 'github' }, installLocation: '/g' } })).toEqual(['/m'])
    expect(marketplaceRoots({ plugins: [{ source: './mods/a' }, { source: '../up' }, { source: '/abs' }, { source: { source: 'github' } }] }, '/m')).toEqual(['/m/mods/a'])
    expect(manifestOf(JSON.stringify({ name: 'a\u001b[31m', version: '1.0' }))).toEqual({ name: 'a', version: '1.0' }) // an escape sequence is dropped
    expect(manifestOf(JSON.stringify({ name: 'a\u0007b' }))).toEqual({ name: 'a\ufffdb' }) // a control character is marked
    expect(manifestOf('nope')).toEqual({})
    expect(seenOf({ a: '0123abcd', b: 'x', c: 1 })).toEqual({ a: '0123abcd' })
  })
})

describe('the words', () => {
  const ok = (name: string, text: string, flags: Partial<Extract<BouncerRow, { ok: true }>> = {}): BouncerRow => {
    const reach = parseReport(text)!.reach
    return { ok: true, name, root: `/r/${name}`, isLoaded: false, reach, hash: hashOf(reach), isNew: false, isChanged: false, ...flags }
  }

  test('reach in words, the warning ones marked; nothing declared when nothing is', () => {
    expect(reachWords(parseReport(NETTY_REPORT)!.reach)).toEqual([
      { word: 'runs programs', warn: true },
      { word: 'reaches the network', warn: true },
    ])
    expect(reachWords(parseReport(ZEN_REPORT)!.reach)).toEqual([{ word: 'nothing declared', warn: false }])
    expect(reachWords(parseReport(GATEKEEPER_REPORT)!.reach)).toEqual([{ word: 'can change tool calls', warn: true }])
  })

  test('the band names new and changed mods with their notable reach, and nothing otherwise', () => {
    expect(bandWords([ok('zen', ZEN_REPORT)])).toBeNull()
    expect(bandWords([ok('netty', NETTY_REPORT, { isNew: true }), ok('zen', ZEN_REPORT, { isNew: true })])).toBe('bouncer: 2 new mods: netty (runs programs, reaches the network); zen (nothing notable)')
    expect(bandWords([ok('gate', GATEKEEPER_REPORT, { isChanged: true })])).toBe('bouncer: 1 changed: gate (can change tool calls)')
    expect(bandWords([{ ok: false, name: 'x', root: '/x', isLoaded: false, reason: 'boom' }])).toBeNull()
  })

  test('plain lines for a surface with no pane, and cleaning', () => {
    const lines = doorText([ok('netty', NETTY_REPORT, { version: '1.0.0', isNew: true }), { ok: false, name: 'x', root: '/x', isLoaded: false, reason: 'boom' }]).split('\n')
    expect(lines[0]).toBe('Bouncer: 2 mods checked. Facts from the validator, not a verdict.')
    expect(lines[1]).toBe('  netty 1.0.0: runs programs, reaches the network (new)')
    expect(lines[2]).toBe('  x: could not check (boom)')
    expect(clean('a\u001b[2Jb\u0007 c')).toBe('ab� c')
    expect(parseReport(CLEAN)?.reach.calls).toEqual(['$.command.register', '$.ui.toast'])
  })
})
