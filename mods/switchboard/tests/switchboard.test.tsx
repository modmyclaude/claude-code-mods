// Switchboard through the real chains: this session reporting itself, the pane
// and band drawn from other sessions' records, a toast per new "needs you", and
// the files it touches.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DIR, HOME, MIN, MINE, SLOW, SURFACES, T0, band, mine, other, paneLines, start, world } from './world'

const turnStart = ($: Engine) => $.turn.start({ turnId: 't1', prompt: 'go', origin: { kind: 'composer' } } as never)
const turnEnd = ($: Engine, reason: 'answer' | 'error' | 'aborted') =>
  $.turn.complete({ answer: '', durationMs: 1000, isAborted: reason === 'aborted', turnId: 't1', reason })

describe('this session reports itself', () => {
  test('on start it writes one small record: a name, a state, two times; never message text', async ($, on) => {
    const w = world(on)
    await start($)
    const record = mine(w)
    expect(record).toEqual({ v: 1, id: MINE, name: 'api-server', state: 'idle', since: T0, updatedAt: T0 })
    expect(Object.keys(record ?? {}).sort()).toEqual(['id', 'name', 'since', 'state', 'updatedAt', 'v'])
  })

  test('its state follows its own turns and Claude Code’s "waiting on you" notice', async ($, on) => {
    const w = world(on)
    await start($)
    await turnStart($)
    expect(mine(w)?.state).toBe('working')
    await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' })
    expect(mine(w)?.state).toBe('needs-you')
    await $.classic.Notification({ message: 'idle', notification_type: 'idle_prompt' }) // not a dialog: no change
    expect(mine(w)?.state).toBe('needs-you')
    await $.tool.call({ tool: 'Bash', tool_use_id: 'u1', command: 'ls' } as never) // the dialog was answered and the tool ran
    expect(mine(w)?.state).toBe('working')
    await turnEnd($, 'error')
    expect(mine(w)?.state).toBe('error')
    await turnStart($)
    await turnEnd($, 'answer')
    expect(mine(w)?.state).toBe('idle')
  })

  test('its name is the session title once Claude Code has one, else the folder', async ($, on) => {
    const w = world(on)
    await start($)
    await $.classic.UserPromptSubmit({ prompt: 'x', session_title: 'Fix the login bug' } as never)
    expect(mine(w)?.name).toBe('Fix the login bug')
  })

  test('the cost rides along from Claude Code’s own measure', SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], cost: { usd: 1.24 }, changed: ['cost'] } as never)
    await w.clock.advance(MIN) // the heartbeat carries it
    expect(mine(w)?.costUsd).toBe(1.24)
  })

  test('a heartbeat rewrites it every minute, with or without anyone looking', SLOW, async ($, on) => {
    const w = world(on)
    w.surfaces = []
    await start($)
    await w.clock.advance(3 * MIN)
    expect(mine(w)?.updatedAt).toBe(T0 + 3 * MIN)
    // Nobody looking: it never reads the others.
    expect(w.touched.filter(t => t.startsWith('list'))).toEqual([`list ${DIR}`])
  })

  test('a /clear marks the old conversation gone and carries on under the new id', async ($, on) => {
    const w = world(on)
    await start($)
    await $.session.end({ sessionId: MINE, reason: 'clear', resume: { id: MINE } } as never)
    await $.classic.SessionStart({ source: 'clear', session_id: 'bbbb2222' } as never)
    expect(mine(w, MINE)?.state).toBe('gone')
    expect(mine(w, 'bbbb2222')).toMatchObject({ id: 'bbbb2222', state: 'idle', name: 'api-server' })
  })

  test('between a /clear and its new id, no heartbeat brings the old conversation back', SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    await $.session.end({ sessionId: MINE, reason: 'clear', resume: { id: MINE } } as never)
    await w.clock.advance(2 * MIN) // heartbeats due, and no classic.SessionStart yet
    expect(mine(w, MINE)?.state).toBe('gone')
    w.id = 'cccc3333' // Claude Code now answers the new id
    await w.clock.advance(MIN)
    expect(mine(w, MINE)?.state).toBe('gone')
    expect(mine(w, 'cccc3333')).toMatchObject({ state: 'idle', name: 'api-server' })
  })

  test('closing the session marks it gone and stops its timer', SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    await $.session.end({ sessionId: MINE, reason: 'prompt_input_exit', resume: { id: MINE } } as never)
    expect(mine(w)?.state).toBe('gone')
    const writes = w.touched.length
    await w.clock.advance(5 * MIN)
    expect(w.touched.length).toBe(writes)
  })
})

describe('the pane', () => {
  test('lists every session, who needs you first, this one marked, on both surfaces', async ($, on) => {
    const w = world(on)
    other(w, 'b1', 'docs', 'working', T0 - 2 * MIN, T0, 0.49)
    other(w, 'c1', 'site', 'needs-you', T0 - 30_000, T0)
    other(w, 'd1', 'web', 'idle', T0 - 12 * MIN, T0, 4.1)
    other(w, 'e1', 'tests', 'error', T0 - 5 * MIN, T0)
    other(w, 'f1', 'old', 'idle', T0 - 20 * MIN, T0 - 10 * MIN) // stopped writing: gone
    other(w, 'g1', 'ancient', 'idle', T0 - 3 * 3_600_000, T0 - 3 * 3_600_000) // gone over an hour ago: not listed
    await start($)
    for (const surface of SURFACES) {
      const lines = await paneLines($, surface)
      expect(lines, surface).toEqual([
        '2 of 5 need you',
        'siteneeds younow',
        'testserror5m',
        'docsworking2m≈$0.49',
        'api-server (this one)idlenow',
        'webidle12m≈$4.10',
        'oldgone10m',
      ])
    }
  })

  test('alone, it says so, with Bolt beside the line where there is room', async ($, on) => {
    world(on)
    await start($)
    const lines = await paneLines($, 'desktop')
    expect(lines[0]).toBe('Only this session')
    expect(lines.some(l => l.includes('No other sessions yet. Each one running Switchboard shows up here.'))).toBe(true)
  })

  test('a record that is half written or of another version is skipped, not drawn', async ($, on) => {
    const w = world(on)
    w.files[`${DIR}/broken.json`] = { text: '{"v":1,"id":"x","na', mtimeMs: T0 }
    w.files[`${DIR}/future.json`] = { text: JSON.stringify({ v: 2, id: 'y' }), mtimeMs: T0 }
    other(w, 'z1', 'evil\u001b[2J\u0007name', 'idle', T0)
    await start($)
    const lines = await paneLines($, 'terminal')
    expect(lines).toHaveLength(3) // the hero, this session and the one whole record
    expect(lines.some(l => l.startsWith('evil [2J name'))).toBe(true)
    expect(lines.join(' ')).not.toContain('\u001b')
  })

  test('/switchboard opens the pane; where no surface can place it, the summary comes as a toast', async ($, on) => {
    const w = world(on)
    other(w, 'c1', 'site', 'needs-you', T0)
    await start($)
    const run = () => $.command.run({ command: 'switchboard', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
    expect(await run()).toEqual({})
    expect(w.panes).toEqual(['switchboard'])
    w.isPanePlaced = false
    await run()
    expect(w.toasts.pop()).toBe('site needs you')
  })
})

describe('the band and the toasts', () => {
  test('one line while another session needs you, beneath other mods; none otherwise', SLOW, async ($, on) => {
    const w = world(on)
    other(w, 'b1', 'docs', 'working', T0)
    await start($)
    for (const surface of SURFACES) {
      const { line, beneath } = await band($, surface)
      expect(line, surface).toBeUndefined()
      expect(beneath, surface).toBe("another mod's line")
    }
    other(w, 'b1', 'docs', 'needs-you', T0 + 10_000, T0 + 10_000)
    await w.clock.advance(10_000)
    for (const surface of SURFACES) {
      const { line, beneath } = await band($, surface)
      expect(line, surface).toBe('docs needs youShow')
      expect(beneath, surface).toBe("another mod's line")
    }
  })

  test('this session’s own dialog raises no band and no toast: it is in front of you', async ($, on) => {
    const w = world(on)
    await start($)
    await $.classic.Notification({ message: 'x', notification_type: 'permission_prompt' })
    expect((await band($, 'terminal')).line).toBeUndefined()
    expect(w.toasts).toEqual([])
  })

  test('a session that starts needing you raises exactly one toast, and none on later reads', SLOW, async ($, on) => {
    const w = world(on)
    other(w, 'b1', 'docs', 'needs-you', T0) // already waiting at start: the band shows it, no toast
    other(w, 'c1', 'site', 'working', T0)
    await start($)
    await w.clock.advance(10_000)
    expect(w.toasts).toEqual([])
    other(w, 'c1', 'site', 'needs-you', T0 + 12_000, T0 + 12_000)
    await w.clock.advance(MIN)
    expect(w.toasts).toEqual(['site needs you.'])
  })

  test('reads that change nothing on screen write nothing, so nothing redraws', SLOW, async ($, on) => {
    const w = world(on)
    let rowWrites = 0
    on('state.set', ($, e, next) => {
      if (e.key === 'rows') rowWrites++
      return next(e)
    })
    other(w, 'b1', 'docs', 'working', T0)
    await start($)
    const after = rowWrites
    await w.clock.advance(50_000) // ten reads inside one minute: the same rows
    expect(rowWrites).toBe(after)
  })
})

describe('the files it touches', () => {
  test('a record is read again only when its file changed', SLOW, async ($, on) => {
    const w = world(on)
    other(w, 'b1', 'docs', 'working', T0)
    other(w, 'c1', 'site', 'idle', T0)
    await start($)
    const reads = () => w.touched.filter(t => t.startsWith('read ')).map(t => t.slice(DIR.length + 6))
    expect(reads().sort()).toEqual(['b1.json', 'c1.json'])
    await w.clock.advance(50_000) // ten reads of the folder, nothing changed
    expect(reads()).toHaveLength(2)
    other(w, 'c1', 'site', 'needs-you', T0 + 55_000, T0 + 55_000)
    await w.clock.advance(5_000)
    expect(reads().filter(r => r === 'c1.json')).toHaveLength(2)
    expect(reads().filter(r => r === 'b1.json')).toHaveLength(1)
  })


  test('only its own folder under ~/.claude, or under CLAUDE_CONFIG_DIR when that is set', SLOW, async ($, on) => {
    const w = world(on)
    w.env.CLAUDE_CONFIG_DIR = '/cfg/claude/'
    other(w, 'b1', 'docs', 'idle', T0)
    await start($)
    await w.clock.advance(2 * MIN)
    expect(w.touched.length).toBeGreaterThan(0)
    for (const t of w.touched) expect(t, t).toMatch(/^(write|read|list) \/cfg\/claude\/switchboard(\/|$)/)
    expect(w.touched.some(t => t.includes(HOME))).toBe(false)
  })
})
