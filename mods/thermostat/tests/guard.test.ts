// The guard, through the real prompt.submit chain: what it holds, what it
// lets through, and that it fails open.

import { describe, expect, test } from 'claude-code/testing'
import type { PromptOrigin, RenderSurface } from 'claude-code'

import { API_KEY, MIN, PERSON, SLOW, command, start, step, submit, usage, world } from './world'

// A 150k-token conversation on Opus 5.5 (read 140k + wrote 9k + 1k in and out).
const CONVERSATION = usage(140_000, 9_000)

test('a prompt on a cold cache is held once with the estimate, and sending it again goes through', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, CONVERSATION)
  await w.clock.advance(61 * MIN)

  const first = await submit($, 'refactor the parser')
  // 150k tokens at Opus 5.5: written cold at $8/MTok (1-hour TTL), read warm at $0.20.
  expect(first.drop).toContain('Send again to go ahead')
  expect(first.drop).toContain('re-reads 150k tokens')
  expect(first.drop).toContain('~$1.20 vs ~$0.03 warm, Opus 5.5 API list prices')
  expect(first.drop).toContain('/clear')

  const again = await submit($, 'refactor the parser')
  expect(again.drop).toBeUndefined()
  expect(again.text).toBe('refactor the parser')
})

test('a warm cache, and the last minute of a subscription window, pass untouched', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, CONVERSATION)
  await w.clock.advance(59 * MIN)

  const sent = await submit($, 'next step')
  expect(sent.drop).toBeUndefined()
  expect(sent.text).toBe('next step')
  expect(w.toasts).toEqual([])
})

test('on an API key the window is 5 minutes, so 6 minutes idle is already cold', SLOW, async ($, on) => {
  const w = world(on, API_KEY)
  await start($)
  await step($, w, CONVERSATION)
  await w.clock.advance(4 * MIN)
  expect((await submit($, 'still warm')).drop).toBeUndefined()

  await step($, w, CONVERSATION)
  await w.clock.advance(6 * MIN)
  const held = await submit($, 'gone cold')
  // The 5-minute TTL writes at 1.25x input: 150k x $5/MTok.
  expect(held.drop).toContain('~$0.75 vs ~$0.03 warm')
})

test('a small conversation is not worth holding', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(9_000, 1_000)) // 11k tokens
  await w.clock.advance(2 * 60 * MIN)
  expect((await submit($, 'hello again')).drop).toBeUndefined()
})

test('guard=warn shows the estimate and sends', { ...SLOW, options: { guard: 'warn' } }, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, CONVERSATION)
  await w.clock.advance(61 * MIN)
  const sent = await submit($, 'go')
  expect(sent.drop).toBeUndefined()
  expect(w.toasts).toEqual([expect.stringContaining('~$1.20 vs ~$0.03 warm')])
})

test('guard=off does nothing', { ...SLOW, options: { guard: 'off' } }, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, CONVERSATION)
  await w.clock.advance(61 * MIN)
  expect((await submit($, 'go')).drop).toBeUndefined()
  expect(w.toasts).toEqual([])
})

test('when its own logic breaks, the guard lets the prompt through', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, CONVERSATION)
  await w.clock.advance(61 * MIN)
  // The same cold cache that the first test holds, but the estimate cannot run.
  w.isStateBroken = true
  const sent = await submit($, 'urgent fix')
  w.isStateBroken = false
  expect(sent.drop).toBeUndefined()
  expect(sent.text).toBe('urgent fix')
})

test('a held prompt goes back into an empty prompt box, never over a new draft', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, CONVERSATION)
  await w.clock.advance(61 * MIN)

  await submit($, 'first words')
  await w.clock.settle()
  expect(w.fills).toEqual(['first words'])

  // A later cold spell, while the person is typing something else.
  await step($, w, CONVERSATION)
  await w.clock.advance(61 * MIN)
  w.box = 'a new draft'
  await submit($, 'second words')
  await w.clock.settle()
  expect(w.fills).toEqual(['first words'])
})

test('a hold only counts as seen for 10 minutes', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, CONVERSATION)
  await w.clock.advance(61 * MIN)
  expect((await submit($, 'one')).drop).toBeDefined()
  await w.clock.advance(11 * MIN)
  expect((await submit($, 'two')).drop).toBeDefined()
})

test('a hold answered with /clear is counted as money not spent', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, CONVERSATION)
  await w.clock.advance(61 * MIN)
  await submit($, 'big question')
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

  const receipt = await command($, w, 'thermostat')
  expect(receipt).toContain('Prompts held: 1, followed by /clear instead: 1 (~$1.20 not spent)')
  expect(receipt).toContain('Cache: nothing cached yet')
})

test('a prompt typed while a turn runs joins that turn and is never held', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, CONVERSATION)
  await w.clock.advance(61 * MIN)
  const typed = await $.prompt.submit({ text: 'also run the tests', wait: false, origin: PERSON, turnId: 'main' })
  expect(typed.drop).toBeUndefined()
  expect(typed.text).toBe('also run the tests')
})

test('cacheMinutes sets the window until Claude Code reports its own', { ...SLOW, options: { cacheMinutes: 30 } }, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, CONVERSATION)
  // A subscription would say 60 minutes; the setting says 30.
  await w.clock.advance(31 * MIN)
  expect((await submit($, 'one')).drop).toContain('went cold 1m ago')

  // Claude Code reports a 1-hour window on a model switch: the engine wins from then on.
  await $.classic.PostModelSwitch({
    from_model: 'claude-opus-5-5',
    to_model: 'claude-opus-5-5',
    requested_model: null,
    source: 'command',
    context_tokens: 150_000,
    prompt_cache_warm: true,
    cache_ttl: '1h',
    estimated_cache_write_usd: 1.2,
    pricing: 'catalog',
  })
  await step($, w, CONVERSATION)
  await w.clock.advance(45 * MIN)
  expect((await submit($, 'two')).drop).toBeUndefined()
})

test("the estimate uses Claude Code's own cache-write rate once it has priced one", SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  // A resume where Claude Code priced re-caching 150k tokens at $0.90: a managed rate of $6/MTok, not the $8 list.
  await $.classic.SessionStart({
    source: 'resume',
    model: 'claude-opus-5-5',
    seconds_since_last_response: 2 * 60 * 60,
    context_tokens: 150_000,
    prompt_cache_likely_expired: true,
    estimated_cache_write_usd: 0.9,
  })
  const held = await submit($, 'where were we')
  expect(held.drop).toContain('~$0.90 vs ~$0.03 warm, Opus 5.5 prices, cache rate from Claude Code')
})

describe('who is held: each prompt origin on each kind of session', () => {
  const cases: [origin: PromptOrigin, surfaces: RenderSurface[], isHeld: boolean, why: string][] = [
    [{ kind: 'composer' }, ['terminal'], true, 'typed at the terminal'],
    [{ kind: 'bridge' }, ['terminal', 'mobile'], true, 'sent through Remote Control'],
    [{ kind: 'sdk' }, ['desktop'], true, 'typed in the desktop app'],
    [{ kind: 'sdk' }, ['terminal', 'desktop'], true, 'the desktop app beside a terminal'],
    [{ kind: 'sdk' }, [], false, 'a plain claude -p run: nobody would see the hold'],
    [{ kind: 'sdk' }, ['terminal'], false, 'an SDK turn with no desktop attached'],
    [{ kind: 'sdk' }, ['vscode'], false, 'an SDK turn in VS Code'],
    [{ kind: 'scheduled-trigger' }, ['desktop'], false, 'a scheduled prompt'],
    [{ kind: 'unclassified' }, ['desktop'], false, 'a turn of unknown origin'],
    [{ kind: 'plugin', name: 'other' }, ['terminal'], false, "another plugin's prompt"],
  ]
  for (const [origin, surfaces, isHeld, why] of cases) {
    test(`${origin.kind} on [${surfaces.join(', ')}]: ${isHeld ? 'held' : 'passes'} (${why})`, SLOW, async ($, on) => {
      const w = world(on)
      w.surfaces = surfaces
      await start($)
      await step($, w, CONVERSATION)
      await w.clock.advance(61 * MIN)
      const sent = await submit($, 'cold send', origin)
      if (isHeld) expect(sent.drop).toContain('Send again to go ahead')
      else expect(sent.drop).toBeUndefined()
    })
  }
})

test('a new cold spell is held again, even within 10 minutes of the last hold', SLOW, async ($, on) => {
  const w = world(on, API_KEY)
  await start($)
  await step($, w, CONVERSATION)
  await w.clock.advance(6 * MIN)
  expect((await submit($, 'one')).drop).toBeDefined()
  expect((await submit($, 'one')).drop).toBeUndefined()
  await step($, w, CONVERSATION)
  // Cold again 6 minutes later: a different spell, so the old confirmation does not carry over.
  await w.clock.advance(6 * MIN)
  expect((await submit($, 'two')).drop).toBeDefined()
})

test('a held prompt with attachments says the files must be attached again', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, CONVERSATION)
  await w.clock.advance(61 * MIN)
  const held = await $.prompt.submit({
    text: 'what is wrong in this screenshot',
    attachments: [{ type: 'image', mediaType: 'image/png' }],
    wait: false,
    origin: PERSON,
  })
  expect(held.drop).toContain('Attach your files again: only the text comes back.')
  expect((await submit($, 'no files')).drop).toBeUndefined()
})

test('a resume that restores its own model keeps the resumed cache', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await $.classic.SessionStart({
    source: 'resume',
    model: 'claude-opus-5-5',
    seconds_since_last_response: 2 * 60 * 60,
    context_tokens: 150_000,
    prompt_cache_likely_expired: true,
  })
  await $.classic.PostModelSwitch({
    from_model: 'claude-sonnet-5-5',
    to_model: 'claude-opus-5-5',
    requested_model: null,
    source: 'resume',
    context_tokens: 150_000,
    prompt_cache_warm: false,
    cache_ttl: '1h',
    estimated_cache_write_usd: 1.2,
    pricing: 'catalog',
  })
  expect((await submit($, 'where were we')).drop).toContain('re-reads 150k tokens')
})

/** C0, DEL and C1 control characters: the engine refuses a drawn text holding one. */
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/

for (const surface of ['terminal', 'desktop'] as const) {
  test(`on ${surface}, control characters in a prompt or a model id never reach what is drawn`, SLOW, async ($, on) => {
    const w = world(on)
    await start($)
    await step($, w, usage(140_000, 9_000, { model: 'claude-\x1b[31mopus\x07-5-5\x9b' }))
    await w.clock.advance(61 * MIN)
    const held = await submit($, 'fix \x1b[2J this\x07 now\x9b')
    expect(held.drop).toContain('Send again to go ahead')
    // The hold's one deliberate newline splits its two lines (the engine allows it); nothing else.
    expect((held.drop ?? '').split('\n')).toHaveLength(2)
    expect(CONTROL_CHARS.test((held.drop ?? '').replace('\n', ' '))).toBe(false)
    const ui = await $.ui.mount({ plugin: 'thermostat', surface, component: 'SessionMode', props: { modes: [] } })
    const label = await ui.find({ key: 'thermostat' })
    expect(label?.text).toBe('cache cold · 150k to re-read')
    expect(CONTROL_CHARS.test(JSON.stringify(await ui.drawn()))).toBe(false)
    await ui.unmount()
  })
}

test('a /warm argument with control characters is echoed back clean', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, CONVERSATION)
  const answer = await command($, w, 'warm', 'soon\x1b[31m\x07\x9b')
  expect(answer).toContain('Could not read "soon\uFFFD\uFFFD" as a duration')
  expect(CONTROL_CHARS.test(answer)).toBe(false)
})
