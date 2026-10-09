// What the receipt counts, from the usage the model requests report, and how
// a resume, a compaction and a session without caching change the picture.

import { expect, test } from 'claude-code/testing'

import { API_KEY, MIN, SLOW, command, start, step, submit, usage, world } from './world'

test('a send that re-reads the conversation cold is booked with what it cost over warm', { ...SLOW, options: { guard: 'off' } }, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000))
  await w.clock.advance(70 * MIN)
  await submit($, 'back again')
  // Read nothing back, wrote 150k: the cache had lapsed.
  await step($, w, usage(0, 150_000))
  // The next request in the same turn reads it again: warm, not counted.
  await step($, w, usage(150_000, 3_000))

  const receipt = await command($, 'thermostat')
  // 150k x ($8 write - $0.20 read) per MTok at Opus 5.5's 1-hour rates.
  expect(receipt).toContain('Cold sends paid: 1 (150k tokens re-read, ~$1.17 more than warm)')
  expect(receipt).toContain('Cache: warm, 60m left (60m window, subscription login)')
  expect(receipt).toContain('On a subscription these measure plan usage, not a bill.')
  expect(receipt).toContain('Session total so far: ~$4.20, as /cost counts it.')
})

test('subagent requests do not move the main cache or count as cold sends', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000))
  await w.clock.advance(65 * MIN)
  await step($, w, usage(0, 40_000), 'agent-1')
  const receipt = await command($, 'thermostat')
  expect(receipt).toContain('Cache: cold for 5m')
  expect(receipt).toContain('Cold sends paid: 0')
})

test('a resume picks up how long ago the last reply was, and pins the window from the engine', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  // 30 minutes ago, and Claude Code says the cache has expired: so the window is 5 minutes.
  await $.classic.SessionStart({
    source: 'resume',
    model: 'claude-sonnet-5-5',
    seconds_since_last_response: 30 * 60,
    context_tokens: 120_000,
    prompt_cache_likely_expired: true,
  })
  const receipt = await command($, 'thermostat')
  expect(receipt).toContain('Cache: cold for 25m (5m window, as Claude Code reported it)')
  // Sonnet 5.5: 120k x $2.50 (5-minute write) cold, x $0.20 warm.
  expect(receipt).toContain('120k tokens at Sonnet 5 and 5.5 prices: the next send costs ~$0.30 instead of ~$0.02')
  const held = await submit($, 'where were we')
  expect(held.drop).toContain('re-reads 120k tokens')
  expect(w.toasts).toEqual([])
})

test('compaction starts the cache over, so the next send is neither held nor booked as cold', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000))
  await w.clock.advance(70 * MIN)
  await $.classic.SessionStart({ source: 'compact' })
  expect((await submit($, 'continue')).drop).toBeUndefined()
  await step($, w, usage(15_000, 20_000))
  expect(await command($, 'thermostat')).toContain('Cold sends paid: 0')
})

test('a session without prompt caching shows "cache off" and is never held', SLOW, async ($, on) => {
  const w = world(on, API_KEY)
  await start($)
  await step($, w, usage(0, 0, { input_tokens: 60_000 }))
  expect(await command($, 'thermostat')).toContain('caching looks switched off')
  await w.clock.advance(30 * MIN)
  expect((await submit($, 'hello')).drop).toBeUndefined()
  await step($, w, usage(0, 0, { input_tokens: 62_000 }))
  expect(await command($, 'thermostat')).toContain('Cold sends paid: 0')
})
