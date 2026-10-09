// /warm through the real command and clock: pings go out just before
// expiry as real forks of the conversation, stop when they cost more than
// they save, and stop when asked.

import { expect, test } from 'claude-code/testing'

import { API_KEY, MIN, SLOW, command, forkAnswer, start, step, usage, world } from './world'

test('/warm keeps a subscription cache warm with a ping just before each expiry, then finishes', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000)) // 150k tokens at T0
  w.fork = forkAnswer(149_000)

  const started = await command($, 'warm', '3h')
  // Expiry at 60m, then a ping every 58m (2m lead) until 3h is covered: 3 pings.
  expect(started).toContain('Keeping the cache warm for 3h: about 3 pings at ~$0.03 each')
  expect(started).toContain('~$1.17')

  await w.clock.advance(57 * MIN)
  expect(w.forks).toEqual([])
  await w.clock.advance(1 * MIN)
  expect(w.forks).toHaveLength(1)
  expect(w.forks[0]).toContain('Keep-alive ping')

  // Past the original expiry, the ping has kept it warm.
  await w.clock.advance(4 * MIN)
  expect(await command($, 'thermostat')).toContain('Cache: warm, 56m left')

  await w.clock.advance(120 * MIN)
  expect(w.forks).toHaveLength(3)
  expect(w.logs.at(-1)).toContain('keep-warm finished after 3h. 3 pings sent')

  // Coming back after 3h, the send reads the cache the pings kept.
  await step($, w, usage(149_000, 2_000))
  const receipt = await command($, 'thermostat')
  expect(receipt).toContain('Keep-warm pings: 3 (~$0.09)')
  expect(receipt).toContain('Sends that found the cache warm thanks to them: 1 (~$1.16 not spent)')
  expect(receipt).toContain('Estimated saved: ~$1.07')
  expect(receipt).toContain('Cold sends paid: 0')
})

test('smart keep-warm refuses a window whose pings would cost more than one cold re-read', SLOW, async ($, on) => {
  const w = world(on, API_KEY)
  await start($)
  await step($, w, usage(90_000, 9_000)) // 100k tokens, 5-minute window

  const refused = await command($, 'warm', '3h')
  expect(refused).toContain('Not started')
  expect(refused).toContain('about 44 pings (~$1.06), more than the one cold re-read it would save (~$0.48)')
  await w.clock.advance(10 * MIN)
  expect(w.forks).toEqual([])
})

test('smart keep-warm stops mid-window once measured pings cost more than the re-read they save', SLOW, async ($, on) => {
  const w = world(on, API_KEY)
  await start($)
  await step($, w, usage(90_000, 9_000))
  expect(await command($, 'warm', '30m')).toContain('Keeping the cache warm for 30m: about 7 pings')

  // The first ping turns out dear (the model thought at length): ~$0.12.
  w.fork = forkAnswer(99_000, { output_tokens: 5_000 })
  await w.clock.advance(4 * MIN)
  expect(w.forks).toHaveLength(1)
  await w.clock.advance(1 * MIN)
  expect(w.logs.at(-1)).toContain(
    'keep-warm stopped, 6 more pings (~$0.72) would cost more than the one cold re-read they save (~$0.48)',
  )
  await w.clock.advance(20 * MIN)
  expect(w.forks).toHaveLength(1)
})

test('/warm off stops the pings', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000))
  w.fork = forkAnswer(149_000)
  await command($, 'warm', '2h')
  expect(await command($, 'warm')).toContain('Keeping the cache warm for 2h more')
  expect(await command($, 'warm', 'off')).toBe('Keep-warm off. 0 pings sent, ~$0.00.')
  await w.clock.advance(70 * MIN)
  expect(w.forks).toEqual([])
  expect(await command($, 'warm', 'off')).toBe('Keep-warm is not on.')
})

test('keep-warm gives up after three failed pings in a row', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000))
  w.fork = {
    isAnswered: false,
    reason: 'api-error',
    status: 529,
    error: 'overloaded',
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }
  await command($, 'warm', '2h')
  await w.clock.advance(59 * MIN)
  expect(w.forks).toHaveLength(3)
  expect(w.logs.at(-1)).toContain('keep-warm stopped, 3 pings in a row failed (api-error)')
  await w.clock.advance(MIN)
  expect(w.forks).toHaveLength(3)
})

test('/warm explains itself when there is nothing to keep warm or the input is not a duration', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  expect(await command($, 'warm', '90m')).toContain('Nothing is cached yet')
  await step($, w, usage(140_000, 9_000))
  expect(await command($, 'warm', 'soon')).toContain('Could not read "soon" as a duration')
  expect(await command($, 'warm', '30m')).toContain('No pings needed: the cache stays warm 60m on its own')
  await w.clock.advance(61 * MIN)
  expect(await command($, 'warm', '90m')).toContain('already cold')
  expect(w.forks).toEqual([])
})

test('a model switch stops keep-warm and starts the new cache empty, with the engine window', SLOW, async ($, on) => {
  const w = world(on, API_KEY)
  await start($)
  await step($, w, usage(140_000, 9_000))
  await command($, 'warm', '20m')
  await $.classic.PostModelSwitch({
    from_model: 'claude-opus-5-5',
    to_model: 'claude-sonnet-5-5',
    requested_model: 'sonnet',
    source: 'command',
    context_tokens: 150_000,
    prompt_cache_warm: true,
    cache_ttl: '1h',
    estimated_cache_write_usd: 0.6,
    pricing: 'catalog',
  })
  expect(w.logs.at(-1)).toContain('keep-warm stopped, the model changed')
  // An API key login, but Claude Code reported a 1-hour window.
  expect(await command($, 'thermostat')).toContain('Cache: nothing cached yet (60m window, as Claude Code reported it)')
  await w.clock.advance(30 * MIN)
  expect(w.forks).toEqual([])
})

test('a ping that did not read the conversation back from the cache stops keep-warm instead of pretending', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000))
  // The fork read almost nothing and wrote the rest: it was not this conversation's cache entry.
  w.fork = forkAnswer(2_000, { cache_creation_input_tokens: 148_000 })
  await command($, 'warm', '3h')
  await w.clock.advance(58 * MIN)
  expect(w.forks).toHaveLength(1)
  expect(w.logs.at(-1)).toContain('the ping read only 2k of 150k tokens from the cache, so it was not keeping this conversation warm')
  // Its clock did not move: the cache still goes cold at the first expiry.
  await w.clock.advance(3 * MIN)
  expect(await command($, 'thermostat')).toContain('Cache: cold for 1m')
  expect(w.forks).toHaveLength(1)
})

test('subagent turns leave the clock alone, and a main turn stuck in a long tool call still gets its ping', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000))
  w.fork = forkAnswer(149_000)
  await command($, 'warm', '2h')
  await $.turn.start({ text: 'run the full build', turnId: 'main' })

  // A subagent works and finishes inside the main turn: its own prefix, its own cache.
  await w.clock.advance(30 * MIN)
  await step($, w, usage(0, 30_000), 'agent-1')
  await $.turn.complete({ turnId: 'sub', agentId: 'agent-1', reason: 'answer', answer: 'done', durationMs: 1000, isAborted: false })

  await w.clock.advance(27 * MIN)
  expect(w.forks).toEqual([])
  // Due 58m after the main thread's last request, though the main turn still runs.
  await w.clock.advance(1 * MIN)
  expect(w.forks).toHaveLength(1)
})

test('a send the cache would have served anyway is not credited to the pings', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000))
  w.fork = forkAnswer(149_000)
  await command($, 'warm', '3h')
  await w.clock.advance(58 * MIN + 30 * 1000)
  expect(w.forks).toHaveLength(1)
  // 59 minutes after the last real request: inside the 60-minute window without any ping.
  await w.clock.advance(30 * 1000)
  await step($, w, usage(149_000, 2_000))
  expect(await command($, 'thermostat')).toContain('Sends that found the cache warm thanks to them: 0')
})

test('smart keep-warm weighs pings against what going cold adds, not the whole cold price', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000)) // cold $1.20, warm $0.03: going cold adds $1.17
  // One dear ping (~$0.59) leaves 2 more (~$1.18): more than $1.17, less than $1.20.
  w.fork = forkAnswer(149_000, { output_tokens: 28_000 })
  await command($, 'warm', '3h')
  await w.clock.advance(59 * MIN)
  expect(w.forks).toHaveLength(1)
  expect(w.logs.at(-1)).toContain('keep-warm stopped, 2 more pings (~$1.18) would cost more than the one cold re-read they save (~$1.17)')
})

test('another plugin cannot start paid pings', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000))
  const ran = await $.command.run({
    command: 'warm',
    args: '24h',
    origin: { kind: 'plugin', name: 'other' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(ran.text).toBe('Keep-warm changes only with a /warm you type.')
  expect(await command($, 'warm')).toContain('Keep-warm is off.')
})

test('another plugin cannot stop keep-warm either; the person can', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000))
  await command($, 'warm', '2h')
  const ran = await $.command.run({
    command: 'warm',
    args: 'off',
    origin: { kind: 'plugin', name: 'other' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(ran.text).toBe('Keep-warm changes only with a /warm you type.')
  expect(await command($, 'warm')).toContain('Keeping the cache warm for 2h more')
  expect(await command($, 'warm', 'off')).toContain('Keep-warm off.')
})

test('the ticker stays modest: a few redraws a minute at most', SLOW, async ($, on) => {
  const w = world(on)
  await start($)
  await step($, w, usage(140_000, 9_000))
  const before = w.invalidates
  await w.clock.advance(10 * MIN)
  expect(w.invalidates - before).toBeGreaterThan(0)
  expect(w.invalidates - before).toBeLessThanOrEqual(20)
})
