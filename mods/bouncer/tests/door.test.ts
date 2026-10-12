// The pure parts: reading a validator report, the hash, the registry files, the words.

import { describe, expect, test } from 'claude-code/testing'

import { bandWords, clean, directoryMarketplaces, doorText, hashOf, installedRoots, manifestOf, marketplaceRoots, movedFrom, parseReport, reachWords, seenOf, splitTop } from '../hooks/door'
import type { BouncerRow } from '../types'
import { CLEAN, GATEKEEPER_REPORT, HEADWAY_REPORT, NETTY_REPORT, SWITCHBOARD_REPORT, WARDROBE_REPORT, ZEN_REPORT, report } from './world'

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
    expect(seenOf({ '/r/a': { name: 'a', hash: '0123abcd' }, '/r/b': { name: 'b', hash: 'x' }, '/r/c': '0123abcd', '/r/d': { hash: '0123abcd' } })).toEqual({ '/r/a': { name: 'a', hash: '0123abcd' } })
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

  test('every call that acts outside the mod has a word; each is pinned by one call', () => {
    const cases: [string, string, boolean][] = [
      ['$.tool.call', 'runs tools (commands, file writes)', true],
      ['$.mcp.call', 'calls MCP tools', true],
      ['$.mcp.connect', 'calls MCP tools', true],
      ['$.session.authorize', 'calls the API as you', true],
      ['$.agent.spawn', 'starts subagents', true],
      ['$.tool.register', 'adds a tool for Claude', false],
      ['$.agent.register', 'adds a tool for Claude', false],
      ['$.session.append', 'adds to the conversation', false],
      ['$.session.messages', 'reads the conversation', false],
      ['$.session.turns', 'reads the conversation', false],
      ['$.session.send', 'messages other sessions', true],
      ['$.turn.abort', 'can stop a turn', false],
      ['$.env.set', 'sets environment variables', false],
      ['$.config.list', 'reads settings', false],
      ['$.settings.read', 'reads settings', false],
      ['$.config.set', 'changes your settings', true],
      ['$.ui.copy', 'writes your clipboard', false],
    ]
    for (const [call, word, warn] of cases) {
      expect(reachWords(parseReport(report([`./a.ts calls: ${call} (via x), $.ui.toast, $.clock.now`]))!.reach), call).toEqual([{ word, warn }])
    }
    // Calls that stay inside the session's own drawing and state have no word.
    expect(reachWords(parseReport(report(['./a.ts calls: $.tool.list, $.tool.check, $.agent.list, $.session.root, $.session.cwd, $.session.surfaces, $.state.set, $.store.set, $.ui.open, $.ui.status, $.clock.every']))!.reach)).toEqual([{ word: 'nothing declared', warn: false }])
  })

  test('real reports: wardrobe changes your settings, headway adds a tool for Claude, switchboard runs programs and reads the conversation', () => {
    expect(reachWords(parseReport(WARDROBE_REPORT)!.reach).map(w => w.word)).toEqual(['reads settings', 'changes your settings'])
    expect(reachWords(parseReport(HEADWAY_REPORT)!.reach).map(w => w.word)).toEqual(['adds a tool for Claude'])
    expect(reachWords(parseReport(SWITCHBOARD_REPORT)!.reach).map(w => w.word)).toEqual(['reads and writes files', 'runs programs', 'reads the conversation', 'reads environment variables'])
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

describe('the seen record', () => {
  test('a new folder whose mod was last seen in a folder now gone was moved by an update; a second folder beside one still present is new', () => {
    const seen = { '/cache/netty/1.0.0': { name: 'netty', hash: 'aaaaaaaa' }, '/dev/netty': { name: 'netty', hash: 'bbbbbbbb' } }
    expect(movedFrom(seen, 'netty', '/cache/netty/1.1.0', new Set(['/cache/netty/1.1.0', '/dev/netty']))).toBe('/cache/netty/1.0.0')
    expect(movedFrom(seen, 'netty', '/dev/netty', new Set(['/dev/netty']))).toBeUndefined()
    expect(movedFrom(seen, 'netty', '/third/netty', new Set(['/third/netty', '/cache/netty/1.0.0', '/dev/netty']))).toBeUndefined()
    expect(movedFrom(seen, 'other', '/x', new Set(['/x']))).toBeUndefined()
  })
})
