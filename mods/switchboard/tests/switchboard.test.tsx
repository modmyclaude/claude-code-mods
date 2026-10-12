// Switchboard through the real chains: this session reporting itself, the pane,
// band and footer drawn from other sessions' records, a toast per new "needs
// you", and the files and commands it touches.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DIR, HOME, MIN, MINE, SLOW, SURFACES, T0, band, footer, mine, other, paneLines, start, transcriptTail, world } from './world'

const turnStart = ($: Engine) => $.turn.start({ turnId: 't1', prompt: 'go', origin: { kind: 'composer' } } as never)
const turnEnd = ($: Engine, reason: 'answer' | 'error' | 'aborted') =>
  $.turn.complete({ answer: '', durationMs: 1000, isAborted: reason === 'aborted', turnId: 't1', reason })
const bash = ($: Engine) => $.tool.call({ tool: 'Bash', tool_use_id: 'u1', command: 'ls' } as never)
const permission = ($: Engine) => $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })

describe('this session reports itself', () => {
  test('on start it writes one small record: a name, a state, where it runs, two times; never message text', async ($, on) => {
    const w = world(on)
    await start($)
    const record = mine(w)
    expect(record).toEqual({ v: 1, id: MINE, name: 'api-server', state: 'idle', since: T0, updatedAt: T0, where: 'terminal' })
  })

  test('its state follows its own turns, and a dialog says what it waits on', async ($, on) => {
    const w = world(on)
    await start($)
    await turnStart($)
    expect(mine(w)).toMatchObject({ state: 'working', lastActiveAt: T0 })
    await bash($) // the turn calls Bash, which asks for permission
    await permission($)
    expect(mine(w)).toMatchObject({ state: 'needs-you', waitingOn: 'a permission for Bash' })
    await $.classic.Notification({ message: 'idle', notification_type: 'idle_prompt' }) // not a dialog: no change
    expect(mine(w)?.state).toBe('needs-you')
    await bash($) // answered: the tool ran
    expect(mine(w)?.state).toBe('working')
    expect(mine(w)?.waitingOn).toBeUndefined()
    await turnEnd($, 'error')
    expect(mine(w)?.state).toBe('error')
    await turnStart($)
    await turnEnd($, 'answer')
    expect(mine(w)?.state).toBe('idle')
  })

  test('where it runs: the desktop app, a terminal, or nothing attached', async ($, on) => {
    const w = world(on)
    w.surfaces = ['desktop']
    await start($)
    expect(mine(w)?.where).toBe('desktop')
    w.surfaces = []
    await $.session.attach({ surface: 'desktop' } as never)
    expect(mine(w)?.where).toBe('background')
  })

  test('its name is the sidebar title from the end of its own transcript, read with tail', async ($, on) => {
    const w = world(on)
    w.tail = transcriptTail({ custom: 'Switchboard', ai: 'NPM test run' })
    await start($)
    expect(mine(w)?.name).toBe('Switchboard')
    expect(w.runs).toEqual([['tail', '-c', '262144', `${HOME}/.claude/projects/-work-api-server/${MINE}.jsonl`]])
  })

  test('the title Claude Code writes after the first prompt is picked up at a turn end, at most every two minutes', SLOW, async ($, on) => {
    const w = world(on)
    await start($) // no title yet: the folder's name
    expect(mine(w)?.name).toBe('api-server')
    w.tail = transcriptTail({ ai: 'NPM test run' })
    await turnStart($)
    await turnEnd($, 'answer')
    expect(mine(w)?.name).toBe('api-server') // looked at start, so not again yet
    await w.clock.advance(2 * MIN)
    await turnStart($)
    await turnEnd($, 'answer')
    expect(mine(w)?.name).toBe('NPM test run')
    expect(w.runs).toHaveLength(2)
  })

  test('a title on the prompt event is taken at once', async ($, on) => {
    const w = world(on)
    await start($)
    await $.classic.UserPromptSubmit({ prompt: 'x', session_title: 'Fix the login bug' } as never)
    expect(mine(w)?.name).toBe('Fix the login bug')
  })

  test('the cost rides along from Claude Code’s own measure', SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], cost: { usd: 1.24 }, changed: ['cost'] } as never)
    await w.clock.advance(MIN)
    expect(mine(w)?.costUsd).toBe(1.24)
  })

  test('a heartbeat every 30 seconds, with or without anyone looking', SLOW, async ($, on) => {
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
    await w.clock.advance(2 * MIN)
    expect(mine(w, MINE)?.state).toBe('gone')
    w.id = 'cccc3333'
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
  test('who needs you first, saying on what and where; then working, idle, and closed at the bottom; this one pinned', async ($, on) => {
    const w = world(on)
    other(w, 'b1', 'docs', 'working', T0 - 2 * MIN, { updatedAt: T0, costUsd: 0.49 })
    other(w, 'c1', 'Fix the login', 'needs-you', T0 - 2 * MIN, { updatedAt: T0, where: 'desktop', waitingOn: 'a permission for Bash' })
    other(w, 'd1', 'web', 'idle', T0 - 12 * MIN, { updatedAt: T0, costUsd: 0.004 })
    other(w, 'e1', 'tests', 'error', T0 - 5 * MIN, { updatedAt: T0 })
    other(w, 'f1', 'old', 'idle', T0 - 4 * MIN, { updatedAt: T0 - 2 * MIN }) // stopped writing: closed
    other(w, 'g1', 'ancient', 'idle', T0 - 3 * 3_600_000) // closed over an hour ago: not listed
    await start($)
    for (const surface of SURFACES) {
      expect(await paneLines($, surface), surface).toEqual([
        '2 need you',
        'You are here: api-server (terminal)',
        '!Fix the loginwaiting on a permission for Bash · 2mdesktop',
        '✕testsstopped on an error 5m agoterminal',
        '●docsworking for 2mterminal≈$0.49',
        '○webidle for 12mterminal',
        '–oldclosed 2m agoterminal',
      ])
    }
  })

  test('idle sessions with no turn in the last hour fold into one line, unfolded with Show', async ($, on) => {
    const w = world(on)
    for (const id of ['q1', 'q2', 'q3']) other(w, id, `chat ${id}`, 'idle', T0 - 5 * MIN, { lastActiveAt: undefined, updatedAt: T0 })
    other(w, 'r1', 'recent', 'idle', T0 - 5 * MIN, { updatedAt: T0 })
    await start($)
    const folded = await paneLines($, 'desktop')
    expect(folded.slice(2)).toEqual(['○recentidle for 5mterminal', '○3 quiet sessions: idle, no turn in the last hourShow'])
    const open = await paneLines($, 'desktop', 'quiet-toggle')
    expect(open.slice(2)).toEqual([
      '○recentidle for 5mterminal',
      '○3 quiet sessions: idle, no turn in the last hourHide',
      '○chat q1idle for 5mterminal',
      '○chat q2idle for 5mterminal',
      '○chat q3idle for 5mterminal',
    ])
  })

  test('alone, it says how to see the rest', async ($, on) => {
    world(on)
    await start($)
    const lines = await paneLines($, 'desktop')
    expect(lines).toEqual(['Only this session', 'You are here: api-server (terminal)', 'Only this session runs Switchboard. Install it for all sessions to see the rest.'])
  })

  test('a record that is half written or of another version is skipped, not drawn; names are cleaned', async ($, on) => {
    const w = world(on)
    w.files[`${DIR}/broken.json`] = { text: '{"v":1,"id":"x","na', mtimeMs: T0 }
    w.files[`${DIR}/future.json`] = { text: JSON.stringify({ v: 2, id: 'y' }), mtimeMs: T0 }
    other(w, 'z1', 'evil\u001b[2J\u0007name', 'idle', T0)
    await start($)
    const lines = await paneLines($, 'terminal')
    expect(lines).toEqual(['Nothing needs you · 1 other session', 'You are here: api-server (terminal)', '○evil [2J nameidle for under a minuteterminal'])
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
    expect(w.toasts.pop()).toBe('site needs you (terminal)')
  })
})

describe('the band, the footer and the toasts', () => {
  test('one line and a footer count while another session needs you, beneath other mods; none otherwise', SLOW, async ($, on) => {
    const w = world(on)
    other(w, 'b1', 'docs', 'working', T0)
    await start($)
    for (const surface of SURFACES) {
      const { line, beneath } = await band($, surface)
      expect(line, surface).toBeUndefined()
      expect(beneath, surface).toBe("another mod's line")
      expect(await footer($, surface), surface).toBeUndefined()
    }
    other(w, 'b1', 'docs', 'needs-you', T0 + 10_000, { where: 'desktop' })
    await w.clock.advance(10_000)
    for (const surface of SURFACES) {
      const { line, beneath } = await band($, surface)
      expect(line, surface).toBe('! docs needs you (desktop)Show')
      expect(beneath, surface).toBe("another mod's line")
      expect(await footer($, surface), surface).toBe('1 needs you')
    }
  })

  test('this session’s own dialog raises no band, no footer count and no toast: it is in front of you', async ($, on) => {
    const w = world(on)
    await start($)
    await permission($)
    expect((await band($, 'terminal')).line).toBeUndefined()
    expect(await footer($, 'terminal')).toBeUndefined()
    expect(w.toasts).toEqual([])
  })

  test('a session that starts needing you raises exactly one toast, saying where; none on later reads', SLOW, async ($, on) => {
    const w = world(on)
    other(w, 'b1', 'docs', 'needs-you', T0)
    other(w, 'c1', 'site', 'working', T0)
    await start($)
    await w.clock.advance(10_000)
    expect(w.toasts).toEqual([])
    other(w, 'c1', 'site', 'needs-you', T0 + 12_000, { where: 'desktop' })
    await w.clock.advance(MIN)
    expect(w.toasts).toEqual(['site needs you (desktop).'])
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

describe('the files and commands it touches', () => {
  test('a record is read again only when its file changed', SLOW, async ($, on) => {
    const w = world(on)
    other(w, 'b1', 'docs', 'working', T0)
    other(w, 'c1', 'site', 'idle', T0)
    await start($)
    const reads = () => w.touched.filter(t => t.startsWith('read ')).map(t => t.slice(DIR.length + 6))
    expect(reads().sort()).toEqual(['b1.json', 'c1.json'])
    await w.clock.advance(50_000)
    expect(reads()).toHaveLength(2)
    other(w, 'c1', 'site', 'needs-you', T0 + 55_000)
    await w.clock.advance(5_000)
    expect(reads().filter(r => r === 'c1.json')).toHaveLength(2)
    expect(reads().filter(r => r === 'b1.json')).toHaveLength(1)
  })

  test('only its own folder under ~/.claude (or CLAUDE_CONFIG_DIR), and tail of its own transcript there', SLOW, async ($, on) => {
    const w = world(on)
    w.env.CLAUDE_CONFIG_DIR = '/cfg/claude/'
    await start($)
    await w.clock.advance(2 * MIN)
    expect(w.touched.length).toBeGreaterThan(0)
    for (const t of w.touched) expect(t, t).toMatch(/^(write|read|list) \/cfg\/claude\/switchboard(\/|$)/)
    expect(w.runs).toEqual([['tail', '-c', '262144', `/cfg/claude/projects/-work-api-server/${MINE}.jsonl`]])
    expect(w.touched.some(t => t.includes(HOME))).toBe(false)
  })
})
