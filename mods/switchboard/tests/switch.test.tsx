// The switch: `enabled` off, as /config or the modmyclaude hub sets it, leaves Switchboard
// inert: no record written, no other session read, no timer, no band, footer or pane, and
// its events passed untouched. Switched off live, its own record says closed once, so other
// sessions stop showing it working or waiting. On, it is back. The engine reloads the mod
// with the new value (the first test, by its options); the config.set hook flips it at
// once (the others, through a stand-in for the engine's own config row).

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { POLL_MS } from '../hooks/board'
import { BAND, DIR, HOME, MINE, PANE_PROPS, PLUGIN, SURFACES, T0, band, footer, mine, other, start, world } from './world'

const OFF = 'Switchboard is off. /mods or /config turns it on.'
const OTHER = `${DIR}/c1.json`
/** This session's id after a /clear. */
const NEXT = 'bbbb2222-0000-0000-0000-000000000002'

const turnStart = ($: Engine) => $.turn.start({ turnId: 't1', prompt: 'go', origin: { kind: 'composer' } } as never)
const turnEnd = ($: Engine) => $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
const bash = ($: Engine) => $.tool.call({ tool: 'Bash', tool_use_id: 'u1', command: 'ls' } as never)
const permission = ($: Engine) => $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })

function switchboard($: Engine) {
  return $.command.run({ command: 'switchboard', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
}

function flip($: Engine, value: boolean) {
  return $.config.set({ key: 'switchboard.enabled', value, previous: !value, provider: { plugin: 'engine', tier: 'core' } } as never)
}

/** Counts the poll timer's periods (one `clock.every` dispatch each); hooked above the mocked clock. */
function polls(on: On): () => number {
  let periods = 0
  on('clock.every', { ms: POLL_MS }, ($, e, next) => {
    periods += 1
    return next(e)
  })
  return () => periods
}

/** Only what sits beneath: no band line or footer count of Switchboard's, on either surface. */
async function expectNothingDrawn($: Engine): Promise<void> {
  for (const surface of SURFACES) {
    // Alone at the root, the kit drops the other line's key: found by text.
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text), surface).toEqual(["another mod's line"])
    await ui.unmount()
    expect(await footer($, surface), surface).toBeUndefined()
  }
}

async function paneText($: Engine): Promise<string[]> {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'switchboard', props: PANE_PROPS })
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text)
  await pane.unmount()
  return texts
}

test('switched off: no record, no reads, no timer, nothing drawn, and its events pass untouched', { options: { enabled: false } }, async ($, on) => {
  const periods = polls(on)
  const w = world(on)
  other(w, 'c1', 'Fix the login', 'needs-you', T0, { where: 'desktop', waitingOn: 'a permission for Bash' })
  await start($)
  await turnStart($)
  expect(await bash($)).toEqual({ result: 'ok' })
  await permission($)
  await turnEnd($)
  await $.session.attach({ surface: 'desktop' } as never)
  await w.clock.advance(30_000)
  await expectNothingDrawn($)

  // The command stays, so the person can learn it is off; it opens no pane.
  expect(await switchboard($)).toEqual({})
  expect(w.toasts).toEqual([OFF])
  expect(w.panes).toEqual([])
  expect(await paneText($)).toEqual([OFF])

  await $.session.end({ sessionId: w.id, reason: 'prompt_input_exit', resume: { id: w.id } } as never)
  expect(periods()).toBe(0)
  expect(w.touched, 'no file read, listed or written').toEqual([])
  expect(w.runs).toEqual([])
  expect(mine(w)).toBeUndefined()
})

test('flipped live: off signs its own record off as closed and stops at once; on brings it back', async ($, on) => {
  const periods = polls(on)
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  other(w, 'c1', 'Fix the login', 'needs-you', T0, { where: 'desktop', waitingOn: 'a permission for Bash' })
  const theirs = w.files[OTHER]?.text
  await start($)
  await $.classic.UserPromptSubmit({ prompt: 'x', transcript_path: '/elsewhere/old.jsonl' } as never)
  await turnStart($)
  await bash($)
  await permission($)
  expect(mine(w)).toMatchObject({ state: 'needs-you', waitingOn: 'a permission for Bash' })
  expect((await band($, 'terminal')).line).toContain('Fix the login needs you')
  expect(await footer($, 'terminal')).toBe('1 needs you')

  await w.clock.advance(10_000)
  await flip($, false)
  // Its own record says closed at once, so other sessions stop showing it waiting on you.
  expect(mine(w)).toMatchObject({ state: 'gone', since: T0 + 10_000, updatedAt: T0 + 10_000 })
  const signedOff = w.files[`${DIR}/${MINE}.json`]?.text
  await expectNothingDrawn($)
  expect(await paneText($)).toEqual([OFF])

  // Off, none of its events reads, writes or draws; each one would change the record if it did.
  await w.clock.settle()
  const touched = w.touched.length
  const before = periods()
  expect(await bash($)).toEqual({ result: 'ok' })
  await turnEnd($)
  await turnStart($)
  await $.classic.Notification({ message: 'Claude has a question', notification_type: 'elicitation_dialog' })
  await $.session.attach({ surface: 'desktop' } as never)
  await $.classic.UserPromptSubmit({ prompt: 'x', session_title: 'Renamed' } as never)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], cost: { usd: 1.24 }, changed: ['cost'] } as never)
  // A /clear while off: the old conversation is not written again, the new one not reported.
  await $.session.end({ sessionId: MINE, reason: 'clear', resume: { id: MINE } } as never)
  w.id = NEXT
  await $.classic.SessionStart({ source: 'clear', session_id: NEXT, transcript_path: '/elsewhere/new.jsonl' } as never)
  await w.clock.advance(30_000)
  expect(w.touched.length, 'nothing touched while off').toBe(touched)
  expect(periods(), 'no polls while off').toBe(before)
  expect(w.files[`${DIR}/${MINE}.json`]?.text).toBe(signedOff)
  expect(mine(w, NEXT)).toBeUndefined()
  expect(w.files[OTHER]?.text, "another session's record is never touched").toBe(theirs)
  await expectNothingDrawn($)

  // On again, a fresh look: a new record under the id it has now, its title looked up there,
  // the band and footer back (a dialog that opened meanwhile raises no toast), the poll ticking.
  other(w, 'c1', 'Fix the login', 'needs-you', T0 + 35_000, { where: 'desktop', waitingOn: 'a question' })
  await flip($, true)
  expect(mine(w, NEXT)).toMatchObject({ state: 'idle', since: T0 + 40_000 })
  expect(w.runs.at(-1)).toEqual(['tail', '-c', '262144', `${HOME}/.claude/projects/-work-api-server/${NEXT}.jsonl`])
  expect((await band($, 'desktop')).line).toContain('Fix the login needs you')
  expect(await footer($, 'desktop')).toBe('1 needs you')
  expect(w.toasts).toEqual([])
  await w.clock.advance(POLL_MS)
  expect(periods()).toBeGreaterThan(before)
  await turnStart($)
  expect(mine(w, NEXT)?.state).toBe('working')
  // Set on while on, it changes nothing: the record does not start over.
  await flip($, true)
  expect(mine(w, NEXT)?.state).toBe('working')
})

test('switched off while a read is under way: no toast, and nothing drawn after', async ($, on) => {
  // Holds the next read of the folder, so the switch lands mid-read (hooked above the world's folder).
  let isArmed = false
  let reached = () => {}
  let open = () => {}
  const isAtGate = new Promise<void>(resolve => (reached = resolve))
  const gate = new Promise<void>(resolve => (open = resolve))
  on('fs.list', { path: DIR }, async ($, e, next) => {
    if (isArmed) {
      isArmed = false
      reached()
      await gate
    }
    return next(e)
  })
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  other(w, 'c1', 'Fix the login', 'working', T0)
  await start($)
  other(w, 'c1', 'Fix the login', 'needs-you', T0 + 2_000, { where: 'desktop', waitingOn: 'a permission for Bash' })
  isArmed = true
  const polling = w.clock.advance(POLL_MS)
  await isAtGate
  await flip($, false)
  open()
  await polling
  await w.clock.settle()
  expect(w.toasts).toEqual([])
  await expectNothingDrawn($)
})

test('switched off while its record is being written: the closed record stands', async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  let open = () => {}
  w.surfacesGate = new Promise<void>(resolve => (open = resolve))
  const starting = turnStart($)
  await w.clock.settle()
  await flip($, false)
  expect(mine(w)?.state).toBe('gone')
  open()
  await starting
  await w.clock.settle()
  expect(mine(w)?.state).toBe('gone')
})

test('a read that lands after the switch went off is dropped: on again is a fresh look, with no toast', async ($, on) => {
  let isArmed = false
  let reached = () => {}
  let open = () => {}
  const isAtGate = new Promise<void>(resolve => (reached = resolve))
  const gate = new Promise<void>(resolve => (open = resolve))
  on('fs.list', { path: DIR }, async ($, e, next) => {
    if (isArmed) {
      isArmed = false
      reached()
      await gate
    }
    return next(e)
  })
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  other(w, 'c1', 'Fix the login', 'working', T0)
  await start($)
  isArmed = true
  const polling = w.clock.advance(POLL_MS)
  await isAtGate
  await flip($, false)
  open()
  await polling
  await w.clock.settle()
  other(w, 'c1', 'Fix the login', 'needs-you', T0 + POLL_MS + 1_000, { where: 'desktop', waitingOn: 'a permission for Bash' })
  await flip($, true)
  await w.clock.settle()
  expect(w.toasts).toEqual([])
})

test('the same switch twice does nothing more: on while on keeps the record, off while off writes nothing', async ($, on) => {
  const w = world(on)
  on('config.set', ($, e) => ({ value: e.value }))
  await start($)
  await turnStart($)
  await w.clock.settle()
  expect(mine(w)?.state).toBe('working')
  await flip($, true)
  expect(mine(w)?.state).toBe('working')
  await flip($, false)
  expect(mine(w)?.state).toBe('gone')
  const writes = w.touched.filter(t => t.startsWith('write ')).length
  await flip($, false)
  expect(w.touched.filter(t => t.startsWith('write ')).length).toBe(writes)
})
