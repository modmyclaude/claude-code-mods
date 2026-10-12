// Rain Check through the real chains: a refusal at the usage limit, a prompt
// that waits, the countdown, the send at the reset, and every way out.

import { describe, expect, test } from 'claude-code/testing'

import { CONTINUE_TEXT } from '../hooks/logic'
import { HOUR, MIN, PERSON, RESET, SLOW, SURFACES, answered, band, measure, press, refuse, start, submit, window, world } from './world'

const PLUGIN_ORIGIN = { kind: 'plugin', name: 'rain-check' }

describe('it holds only after a real refusal', () => {
  test('a reading at 100% alone holds nothing: extra usage can still let requests through', async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(100)])
    const result = await submit($, 'run the tests')
    expect(result.drop).toBeUndefined()
    expect(w.sent.map(s => s.text)).toEqual(['run the tests'])
    for (const surface of SURFACES) {
      const { ui, waiting, limit, other } = await band($, surface)
      expect(waiting ?? limit, surface).toBeUndefined()
      expect(other, surface).toBe("another mod's line")
      await ui.unmount()
    }
  })

  test('near a cap but not at it, one refusal holds nothing; a second within 10 minutes does', async ($, on) => {
    const w = world(on)
    await start($)
    const weekly = RESET + 72 * HOUR
    await measure($, [window(40), window(97, weekly, 'seven_day')])
    await refuse($) // perhaps a passing 429: holding on it would hold for three days
    expect((await submit($, 'first')).drop).toBeUndefined()
    await w.clock.advance(11 * MIN)
    await refuse($) // too long after the first: still one
    expect((await submit($, 'second')).drop).toBeUndefined()
    await w.clock.advance(4 * MIN)
    await refuse($) // a second refusal soon after: the weekly window is out
    expect((await submit($, 'third')).drop).toContain('Usage limit reached')
    expect(w.sent.map(s => s.text)).toEqual(['first', 'second'])
  })

  test('the refusal reads usage afresh: a trailing reading under 100% does not delay a real limit', async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(97)])
    w.usage = [window(100)]
    await refuse($)
    expect((await submit($, 'run the tests')).drop).toContain('Usage limit reached')
  })

  test('a refusal with no window near full holds nothing: a passing 429, which Claude Code retries', async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(60)])
    await refuse($)
    expect((await submit($, 'again')).drop).toBeUndefined()
    expect(w.toasts).toEqual([])
  })

  test('an API key reports no windows: a refusal there holds nothing', async ($, on) => {
    const w = world(on)
    await start($)
    await refuse($)
    expect((await submit($, 'again')).drop).toBeUndefined()
    expect(w.sent).toHaveLength(1)
  })
})

describe('after the limit refuses a turn', () => {
  test('the band says when it resets and offers to continue then, on both surfaces', async ($, on) => {
    world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    for (const surface of SURFACES) {
      const { ui, limit, other } = await band($, surface)
      expect(limit, surface).toContain('Usage limit reached · resets 2pm · in 5h')
      expect(await ui.find({ key: 'rain-continue' }), surface).toBeDefined()
      expect(await ui.find({ key: 'rain-dismiss' }), surface).toBeDefined()
      expect(other, surface).toBe("another mod's line")
      await ui.unmount()
    }
  })

  test('the reset time comes from a fresh reading when none arrived yet (after a reload)', async ($, on) => {
    const w = world(on)
    await start($)
    w.usage = [window(100)]
    await refuse($)
    const { ui, limit } = await band($, 'terminal')
    expect(limit).toContain('resets 2pm')
    await ui.unmount()
  })

  test('a prompt sent now waits, and goes out once by itself just after the reset', SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    const held = await submit($, 'run the tests')
    expect(held.drop).toBe('Usage limit reached. This prompt waits and sends 2:01pm (in 5h 1m). Cancel above the prompt.')
    expect(w.sent).toEqual([])
    for (const surface of SURFACES) {
      const { ui, waiting, preview, limit } = await band($, surface)
      expect(waiting, surface).toContain('Sends 2:01pm · in 5h 1m')
      expect(preview, surface).toBe('"run the tests"')
      expect(limit, surface).toBeUndefined()
      await ui.unmount()
    }
    // The countdown moves by the minute.
    await w.clock.advance(2 * HOUR)
    const later = await band($, 'terminal')
    expect(later.waiting).toContain('in 3h 1m')
    await later.ui.unmount()
    // Not at the reset itself: a minute after, so it lands in the new window.
    await w.clock.advance(3 * HOUR)
    expect(w.sent).toEqual([])
    await w.clock.advance(MIN)
    expect(w.sent).toEqual([{ text: 'run the tests', origin: PLUGIN_ORIGIN }])
    expect(w.toasts).toContain('Usage limit reset. Your waiting prompt is sent.')
    // Sent once, and the band and its tick are gone.
    await w.clock.advance(10 * MIN)
    expect(w.sent).toHaveLength(1)
    const after = await band($, 'desktop')
    expect(after.waiting ?? after.limit).toBeUndefined()
    await after.ui.unmount()
  })

  test('a second prompt joins the first and they go out together', SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    await submit($, 'run the tests')
    const second = await submit($, 'then update the docs')
    expect(second.drop).toContain('Added to the waiting prompt: sends 2:01pm')
    await w.clock.advance(5 * HOUR + MIN)
    expect(w.sent.map(s => s.text)).toEqual(['run the tests\n\nthen update the docs'])
  })

  test('"Continue then" picks the cut-off turn up at the reset, and only when pressed', SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    await press($, 'desktop', 'rain-continue')
    const { ui, waiting } = await band($, 'terminal')
    expect(waiting).toContain('Continues 2:01pm')
    await ui.unmount()
    await w.clock.advance(5 * HOUR + MIN)
    expect(w.sent).toEqual([{ text: CONTINUE_TEXT, origin: PLUGIN_ORIGIN }])
    expect(w.toasts).toContain('Usage limit reset. Picking up where Claude stopped.')
  })

  test('left alone, the band clears at the reset and nothing is sent', SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    await w.clock.advance(5 * HOUR + MIN)
    expect(w.sent).toEqual([])
    expect(w.toasts).toEqual(['Usage limit reset.'])
    const { ui, limit } = await band($, 'terminal')
    expect(limit).toBeUndefined()
    await ui.unmount()
  })

  test('what Rain Check sent and the limit refused again waits for the next reset', SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    await submit($, 'run the tests')
    await w.clock.advance(5 * HOUR + MIN)
    expect(w.sent).toHaveLength(1)
    // The weekly window ran out too: the send is refused, and waits for that one.
    const weekly = RESET + 30 * HOUR
    await measure($, [window(100, weekly, 'seven_day')])
    await refuse($)
    expect(w.toasts).toContain('Still at the usage limit. It waits for Tue 8:01pm.')
    const { ui, waiting, preview } = await band($, 'terminal')
    expect(waiting).toContain('Sends Tue 8:01pm')
    expect(preview).toBe('"run the tests"')
    await ui.unmount()
  })
})

describe('never losing the person\'s words', () => {
  test('Cancel puts the words back in the prompt box, after any draft there', async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    await submit($, 'run the tests')
    w.box = 'a new draft'
    await press($, 'terminal', 'rain-cancel')
    expect(w.box).toBe('a new draft\n\nrun the tests')
    expect(w.toasts.pop()).toBe('Cancelled. Your words are back in the prompt box.')
  })

  test('where no box takes them, the toast carries the words; the pick-up line is never put back', async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    await press($, 'desktop', 'rain-continue')
    await submit($, 'and run the tests')
    w.canFill = false
    await press($, 'desktop', 'rain-cancel')
    expect(w.toasts.pop()).toBe('Cancelled. "and run the tests"')
    expect(w.logs).toEqual(['rain-check: your words, in full: and run the tests'])
  })

  test('a send another hook drops comes back to the person, and is not sent later behind their back', SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    await submit($, 'run the tests')
    w.dropsPlugins = true
    await w.clock.advance(5 * HOUR + MIN)
    expect(w.sent).toEqual([])
    expect(w.box).toBe('run the tests')
    expect(w.toasts.pop()).toBe('Not sent: a policy hook blocked it. Your words are back in the prompt box.')
    await w.clock.advance(HOUR)
    expect(w.sent).toEqual([])
  })

  test('Send now pressed twice, with the tick due too, sends once', SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    await submit($, 'run the tests')
    await w.clock.advance(5 * HOUR + MIN - 1000)
    const ui = await $.ui.mount({ plugin: 'rain-check', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} } })
    await Promise.all([ui.press({ key: 'rain-now' }), ui.press({ key: 'rain-now' }), w.clock.advance(2000)])
    await ui.unmount()
    expect(w.sent).toHaveLength(1)
  })
})

describe('every way out', () => {
  test('Cancel drops the waiting prompt; Dismiss stops holding', async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    await submit($, 'run the tests')
    await press($, 'terminal', 'rain-cancel')
    const cancelled = await band($, 'terminal')
    expect(cancelled.waiting).toBeUndefined()
    expect(cancelled.limit).toContain('Usage limit reached')
    await cancelled.ui.unmount()
    await press($, 'desktop', 'rain-dismiss')
    expect((await submit($, 'try anyway')).drop).toBeUndefined()
    expect(w.sent.map(s => s.text)).toEqual(['try anyway'])
  })

  test('Send now sends at once, and a refusal puts it back to wait', async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    await submit($, 'run the tests')
    await press($, 'desktop', 'rain-now')
    expect(w.sent).toEqual([{ text: 'run the tests', origin: PLUGIN_ORIGIN }])
    await refuse($)
    const { ui, waiting } = await band($, 'terminal')
    expect(waiting).toContain('Sends 2:01pm')
    await ui.unmount()
  })

  test('a turn that answers ends the limit, and what waits goes out then', async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    await submit($, 'run the tests')
    await answered($) // another prompt got through: the limit lifted early
    await w.clock.settle() // sent one clock turn later, past the turn that just ended
    expect(w.sent.map(s => s.text)).toEqual(['run the tests'])
    expect((await submit($, 'next')).drop).toBeUndefined()
  })

  test('/rain-check, /rain-check now and /rain-check cancel answer in toasts, never to the model', async ($, on) => {
    const w = world(on)
    await start($)
    const run = (args: string) => $.command.run({ command: 'rain-check', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
    expect(await run('')).toEqual({})
    expect(w.toasts.pop()).toBe('Nothing is waiting. At a usage limit, what you send waits here.')
    await measure($, [window(100)])
    await refuse($)
    await run('')
    expect(w.toasts.pop()).toBe('Usage limit reached · resets 2pm · in 5h. What you send now waits for it.')
    await submit($, 'run the tests')
    await run('')
    expect(w.toasts.pop()).toContain('Sends 2:01pm · in 5h 1m. /rain-check now sends it')
    expect(await run('cancel')).toEqual({})
    expect(w.toasts.pop()).toBe('Cancelled. Your words are back in the prompt box.')
    w.box = ''
    await submit($, 'again')
    await run('now')
    await w.clock.settle() // sent one clock turn later, past the command's own turn
    expect(w.sent.map(s => s.text)).toEqual(['again'])
    await run('later')
    expect(w.toasts.pop()).toBe('Try /rain-check, /rain-check now or /rain-check cancel.')
  })

  test('/clear drops the pick-up of the old conversation but keeps a prompt the person wrote', async ($, on) => {
    world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    await press($, 'terminal', 'rain-continue')
    await $.session.end({ sessionId: 's', reason: 'clear', resume: { id: 's' } })
    const cleared = await band($, 'terminal')
    expect(cleared.waiting).toBeUndefined()
    expect(cleared.limit).toContain('Usage limit reached')
    await cleared.ui.unmount()
    await submit($, 'run the tests')
    await $.session.end({ sessionId: 's', reason: 'clear', resume: { id: 's' } })
    const kept = await band($, 'terminal')
    expect(kept.preview).toBe('"run the tests"')
    await kept.ui.unmount()
  })
})

describe('what it never holds', () => {
  test('slash commands, shell lines, mid-turn prompts and other plugins pass straight through', async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    for (const text of ['/rain-check cancel', '  /model', '!ls']) expect((await submit($, text)).drop, text).toBeUndefined()
    expect((await submit($, 'queued mid-turn', PERSON, 'turn-1')).drop).toBeUndefined()
    expect((await submit($, 'from a mod', { kind: 'plugin', name: 'other' })).drop).toBeUndefined()
    expect(w.sent).toHaveLength(5)
  })

  test('the desktop app sends as the SDK: held there, passed through where no desktop is attached', async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    expect((await submit($, 'from a script', { kind: 'sdk' })).drop).toBeUndefined()
    w.surfaces = ['desktop']
    expect((await submit($, 'typed in the app', { kind: 'sdk' })).drop).toContain('Usage limit reached')
  })

  test('if its own state breaks mid-hold, the prompt goes through: a bug never eats a prompt', async ($, on) => {
    const w = world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    w.isStateBroken = true
    expect((await submit($, 'run the tests')).drop).toBeUndefined()
    expect(w.sent.map(s => s.text)).toEqual(['run the tests'])
  })

  test('control characters in a waiting prompt never break the band', async ($, on) => {
    world(on)
    await start($)
    await measure($, [window(100)])
    await refuse($)
    await submit($, 'fix\u0007 the\u001b[31m bug\r\nnow')
    for (const surface of SURFACES) {
      const { ui, preview } = await band($, surface)
      expect(preview, surface).toBe('"fix the [31m bug now"')
      await ui.unmount()
    }
  })
})
