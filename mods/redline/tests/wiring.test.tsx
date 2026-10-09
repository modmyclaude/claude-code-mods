// redline through the engine's real wiring: model requests raised as
// `turn.step`, measurements as `session.measure`, the command as
// `command.run`, and the band and detail view mounted on both surfaces. The
// test's hooks answer what lies beneath the plugin: the model, the session's
// usage, the clock, the store, and the status line and toasts it draws.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { CommandSpec, On, SessionRateLimit, SessionUsage, TurnUsage } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const MIN = 60_000
const T0 = Date.parse('2026-10-08T12:00:00Z')
const WINDOW = 200_000
const SURFACES = ['terminal', 'desktop'] as const

type World = {
  clock: ReturnType<typeof mock.clock>
  statuses: (string | undefined)[]
  toasts: string[]
  opened: string[]
  closed: string[]
  registered: string[]
  specs: CommandSpec[]
  usage: SessionUsage
  /** Whether a surface places the pane `/redline` opens. */
  isPanePlaced: boolean
  /** Whether `$.session.usage()` is refused beneath the plugin. */
  isUsageDenied: boolean
  status: () => string
}

/** Answers every noun redline reaches beneath it, from memory. */
function world(on: On, usage: Partial<SessionUsage> = {}, store: Record<string, unknown> = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: T0 }),
    statuses: [],
    toasts: [],
    opened: [],
    closed: [],
    registered: [],
    specs: [],
    isPanePlaced: true,
    isUsageDenied: false,
    usage: { startedAt: T0 - 30 * MIN, context: { window: WINDOW }, rateLimits: [], cost: { usd: 1.25 }, ...usage },
    status: () => w.statuses[w.statuses.length - 1] ?? '',
  }
  mock.store(on, store)
  on('session.usage', () => (w.isUsageDenied ? { deny: 'usage is not available here' } : { value: w.usage }))
  on('ui.status', ($, e) => (w.statuses.push(e.text), { value: undefined }))
  on('ui.toast', ($, e) => (w.toasts.push(e.text), { value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('command.register', ($, e) => (w.registered.push(e.name), w.specs.push({ ...e }), { value: { command: e.name } }))
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: w.isPanePlaced ? { isPlaced: true } : { isPlaced: false, reason: 'no surface places panes' } }
  })
  on('ui.close', ($, e) => (w.closed.push(e.id), { value: undefined }))
  // The engine's own ends of the events redline observes.
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  // The model: each request answers with the usage the test queued for it.
  on('turn.step', async function* ($, e) {
    const usage = replies.shift() ?? null
    yield { kind: 'stop', stopReason: 'end_turn', usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  })
  return w
}

const replies: (TurnUsage | null)[] = []

/** A usage whose input side (uncached + cache read + cache write) is `ctx`. */
const usageOf = (ctx: number, model = 'claude-opus-5-5', output = 800): TurnUsage => ({
  model,
  input_tokens: 1500,
  cache_creation_input_tokens: 2500,
  cache_read_input_tokens: ctx - 4000,
  output_tokens: output,
})

/** Raises one model request through every plugin and reads it to its end. */
async function request($: Engine, ctx: number, opts: { turnId?: string; agentId?: string; model?: string } = {}) {
  replies.push(usageOf(ctx, opts.model))
  const stream = $.turn.step({ turnId: opts.turnId ?? 't1', index: 0, model: opts.model ?? 'claude-opus-5-5', messageCount: 3, agentId: opts.agentId })
  for await (const chunk of stream) void chunk
}

const pct = (p: number) => Math.round((WINDOW * p) / 100)

/** A compaction leaves at least one message: its summary. */
const SUMMARY = { role: 'user' as const, text: 'Summary of the conversation so far', toolUses: [] }

const PRESENTATION = { isFullscreen: true, columns: 160 }
const runCommand = ($: Engine, args: string) =>
  $.command.run({ command: 'redline', args, origin: { kind: 'composer' }, presentation: PRESENTATION })

const PANE_PROPS = {
  title: 'Redline',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 5 }, view: {} }

describe('status line', () => {
  test('moves on each model request and spells out the level', async ($, on) => {
    const w = world(on)
    await request($, pct(30))
    // The ledger's total is Claude Code's own figure: shown plain, no ≈.
    expect(w.status()).toMatch(/^ctx 30% ███░░░░░░░ · \$1\.25 · /)
    expect(w.status()).not.toMatch(/AMBER|RED/)
    await request($, pct(60))
    expect(w.status()).toMatch(/^ctx 60% ██████░░░░ AMBER · /)
    await request($, pct(79))
    expect(w.status()).toContain('ctx 79% ████████░░ AMBER')
    await request($, pct(80))
    expect(w.status()).toContain('ctx 80% ████████░░ RED')
    expect(w.statuses).toHaveLength(4)
  })

  test("a subagent's request leaves the session's context alone", async ($, on) => {
    const w = world(on)
    await request($, pct(40))
    await request($, pct(95), { agentId: 'sub-1', turnId: 's1' })
    expect(w.status()).toContain('ctx 40%')
    expect(w.toasts).toHaveLength(0)
  })

  test("Claude Code's own percentage is shown once it counts the request", async ($, on) => {
    const w = world(on)
    // Claude Code has measured this very request and says 81 (159k computes to 80).
    w.usage = { ...w.usage, context: { window: WINDOW, tokens: 159_000, percent: 81 } }
    await request($, 159_000)
    expect(w.status()).toContain('ctx 81%')
    // Its figure lags the next request: the gauge computes from that request.
    await request($, pct(90))
    expect(w.status()).toContain('ctx 90%')
    // The turn's measurement brings Claude Code's figure back.
    await $.session.measure({ context: { window: WINDOW, tokens: 180_000, percent: 89 }, rateLimits: [], cost: { usd: 2 }, changed: ['context'] })
    expect(w.status()).toContain('ctx 89%')
  })

  test('the window comes from Claude Code, so a 1M model reads lower', async ($, on) => {
    const w = world(on, { context: { window: 1_000_000 } })
    await request($, 500_000)
    expect(w.status()).toContain('ctx 50%')
  })

  test('shows tokens per minute and the pace of the last 10 minutes', async ($, on) => {
    const w = world(on)
    await request($, 100_000)
    await w.clock.advance(4 * MIN)
    await request($, 120_000)
    // +20k context in 4 minutes: 80k left at 5k/min.
    expect(w.status()).toContain('full in ~16m')
    // New tokens: 2 requests x (1500 + 2500 + 800), over the 4 minutes tracked.
    expect(w.status()).toContain('2.4k tok/min')
  })

  test('no growth and shrinking context give no pace', async ($, on) => {
    const w = world(on)
    await request($, 120_000)
    await w.clock.advance(3 * MIN)
    await request($, 120_000)
    expect(w.status()).not.toContain('full in')
    await w.clock.advance(3 * MIN)
    await request($, 90_000)
    expect(w.status()).not.toContain('full in')
  })

  test('an unknown model with no ledger shows tokens, never a guessed price', async ($, on) => {
    const w = world(on, { cost: undefined })
    await request($, 50_000, { model: 'claude-nova-1' })
    expect(w.status()).toContain('51k tok') // 50k input side + 800 output
    expect(w.status()).not.toContain('$')
  })

  test('with no ledger a known model is priced by the table, marked ≈', async ($, on) => {
    const w = world(on, { cost: undefined })
    await request($, 100_000)
    // Opus 5.5: 1500 in $0.006 + 2500 write $0.0125 + 96000 read $0.0192 + 800 out $0.016.
    expect(w.status()).toContain('≈$0.05')
  })

  test('plan windows show with a run-out when one runs dry before it resets', async ($, on) => {
    const limits: SessionRateLimit[] = [
      // Opened 2h ago, 80% used: 30 minutes left at that pace, resets in 3h.
      { kind: 'five_hour', percentUsed: 80, resetsAt: new Date(T0 + 180 * MIN).toISOString() },
      { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(T0 + 5 * 24 * 60 * MIN).toISOString() },
    ]
    const w = world(on, { rateLimits: limits })
    await request($, pct(20))
    expect(w.status()).toContain('5h 80% out in ~30m')
    expect(w.status()).toContain('7d 12%')
    expect(w.status()).not.toContain('7d 12% out')
  })

  test('session.measure updates the gauge between requests (a plan window moved)', async ($, on) => {
    const w = world(on)
    await request($, pct(20))
    await $.session.measure({
      context: { window: WINDOW, tokens: pct(20), percent: 20 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 41, resetsAt: new Date(T0 + 60 * MIN).toISOString() }],
      cost: { usd: 2 },
      changed: ['rateLimits', 'cost'],
    })
    expect(w.status()).toContain('5h 41%')
    expect(w.status()).toContain(' · $2.00 · ')
  })
})

describe('never in the way', () => {
  test('every chunk and the response pass through untouched, even when usage cannot be read', async ($, on) => {
    const w = world(on)
    w.isUsageDenied = true
    replies.push(usageOf(pct(50)))
    const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3 })
    const chunks = []
    let step = await stream.next()
    for (; !step.done; step = await stream.next()) chunks.push(step.value)
    const response = step.value
    expect(chunks).toEqual([{ kind: 'stop', stopReason: 'end_turn', usage: usageOf(pct(50)) }])
    expect(response).toEqual({ turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: usageOf(pct(50)) })
    // The request still counted; with no window known the fill reads unknown.
    expect(w.status()).toMatch(/^ctx -- · ≈\$0\.05 · /)
  })

  test('a request with no usage (interrupted) changes nothing', async ($, on) => {
    const w = world(on)
    replies.push(null)
    const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3 })
    for await (const chunk of stream) void chunk
    expect(w.statuses).toHaveLength(0)
  })
})

describe('the 80% toast', () => {
  test('fires once per upward crossing, re-arming only under 75%', async ($, on) => {
    const w = world(on)
    await request($, pct(70))
    expect(w.toasts).toHaveLength(0)
    await request($, pct(82))
    expect(w.toasts).toHaveLength(1)
    expect(w.toasts[0]).toContain('82%')
    expect(w.toasts[0]).toContain('/compact')
    await request($, pct(90))
    await request($, pct(77)) // dipped, but not under 75%: stays quiet
    await request($, pct(85))
    expect(w.toasts).toHaveLength(1)
    await request($, pct(60)) // under 75%: armed again
    await request($, pct(81))
    expect(w.toasts).toHaveLength(2)
  })

  test('a /compact re-arms it and shows the smaller context at once', async ($, on) => {
    const w = world(on)
    on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: pct(85), tokensAfter: pct(20) }))
    await request($, pct(85))
    expect(w.toasts).toHaveLength(1)
    await $.session.compact({ trigger: 'manual', messages: [SUMMARY] })
    expect(w.status()).toContain('ctx 20%')
    await request($, pct(83))
    expect(w.toasts).toHaveLength(2)
  })

  test('a precompute or a skipped compaction changes nothing', async ($, on) => {
    const w = world(on)
    on('session.compact', ($, e) => (e.trigger === 'precompute' ? { messages: [SUMMARY], tokensAfter: 10 } : { skip: 'held by a hook' }))
    await request($, pct(85))
    const before = w.statuses.length
    await $.session.compact({ trigger: 'precompute', messages: [SUMMARY] })
    await $.session.compact({ trigger: 'manual', messages: [SUMMARY] })
    expect(w.statuses).toHaveLength(before)
    expect(w.status()).toContain('ctx 85%')
  })

  test('/clear starts the gauge over and re-arms it', async ($, on) => {
    const w = world(on)
    await request($, pct(85))
    await $.session.end({ reason: 'clear', sessionId: 'abc', resume: { id: 'abc' } })
    expect(w.status()).toMatch(/^ctx -- /)
    await request($, pct(81), { turnId: 't2' })
    expect(w.toasts).toHaveLength(2)
  })

  test('an in-session /resume starts it over too: no pace carried across conversations', async ($, on) => {
    const w = world(on, { context: { window: 1_000_000 } })
    await request($, 50_000)
    await $.session.end({ reason: 'resume', sessionId: 'abc', resume: { id: 'abc' } })
    await w.clock.advance(2 * MIN)
    await request($, 400_000, { turnId: 't2' })
    expect(w.status()).toContain('ctx 40%')
    expect(w.status()).not.toContain('full in')
  })

  test("a subagent's compaction leaves the session's gauge alone", async ($, on) => {
    const w = world(on)
    on('session.compact', () => ({ messages: [SUMMARY], tokensAfter: 1_000 }))
    await request($, pct(85))
    await $.session.compact({ trigger: 'auto', agentId: 'sub-1', messages: [SUMMARY] })
    expect(w.status()).toContain('ctx 85%')
  })

  test('a measurement with no count after a compaction keeps the compacted size', async ($, on) => {
    const w = world(on)
    on('session.compact', () => ({ messages: [SUMMARY], tokensAfter: pct(20) }))
    await request($, pct(85))
    await $.session.compact({ trigger: 'manual', messages: [SUMMARY] })
    await $.session.measure({ context: { window: WINDOW }, rateLimits: [], cost: { usd: 2 }, changed: ['cost'] })
    expect(w.status()).toContain('ctx 20%')
  })
})

describe('idle', () => {
  test('once the session sits idle past 10 minutes the line repaints once with no pace or rate', async ($, on) => {
    const w = world(on)
    await request($, 100_000)
    await w.clock.advance(4 * MIN)
    await request($, 120_000)
    expect(w.status()).toContain('full in ~16m')
    const painted = w.statuses.length
    await w.clock.advance(5 * MIN) // still inside the window: nothing repaints
    expect(w.statuses).toHaveLength(painted)
    await w.clock.advance(6 * MIN)
    expect(w.statuses).toHaveLength(painted + 1)
    expect(w.status()).not.toContain('full in')
    expect(w.status()).toContain('0 tok/min')
    await w.clock.advance(60 * MIN) // one shot: nothing ticks while idle
    expect(w.statuses).toHaveLength(painted + 1)
  })
})

describe('/redline', () => {
  test('registers the command at session start and remembers the band', async ($, on) => {
    const w = world(on, {}, { isBandOn: true })
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    expect(w.registered).toEqual(['redline'])
    // Runs at once mid-turn: checking the gauge while Claude works is the point.
    expect(w.specs[0]).toMatchObject({ name: 'redline', argumentHint: '[band]', immediate: true })
    expect(w.status()).toMatch(/^ctx -- /)
    const band = await $.ui.mount({ plugin: 'redline', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ key: 'gauge' })).toBeDefined()
  })

  test('opens the detail pane, and prints the view where no pane is placed', async ($, on) => {
    const w = world(on)
    await request($, pct(50))
    expect(await runCommand($, '')).toEqual({})
    expect(w.opened).toEqual(['redline'])
    w.isPanePlaced = false
    const printed = await runCommand($, '')
    expect(printed.text).toContain('Redline - context, cost and pace')
    expect(printed.text).toContain('50%')
  })

  test('answers unknown arguments with its usage', async ($, on) => {
    const w = world(on)
    // Nothing for the model to read: the usage goes to a toast.
    expect(await runCommand($, 'bogus')).toEqual({})
    expect(w.toasts[0]).toContain('/redline band')
  })
})

/** Another mod's band, beneath redline (the append tier sits under user mods). */
const OTHER_BAND = {
  name: 'other-band',
  tier: 'append' as const,
  register(on: On) {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box key="other-band">
          <Text>another mod's band</Text>
        </Box>
      )
    })
  },
}

/** Any C0 or C1 control character: the engine refuses a tree that holds one. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

describe('outside text is cleaned before it is drawn', () => {
  test('a model id, a plan window kind and a prompt carrying control characters still draw, clean, on both surfaces', async ($, on) => {
    const w = world(on, { rateLimits: [{ kind: 'spend\u001b[31m_limit\u0007', percentUsed: 40 }] })
    await $.turn.start({ text: 'look at \u001b[1mthis\u009b0m now', turnId: 't1' })
    await request($, pct(85), { model: 'claude-opus-5-5\u001b[2J\u009b31m' })
    await request($, 10_000, { model: 'claude-nova\u0007-1', turnId: 's1', agentId: 'sub\u001b-1' })
    expect(w.status()).not.toMatch(CONTROL)
    expect(w.status()).toContain('ctx 85%')
    expect(w.status()).toContain('spend limit\ufffd 40%')
    expect(w.toasts[0]).not.toMatch(CONTROL)
    await runCommand($, 'band')
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect((await band.find({ key: 'gauge' }))?.text).toContain('spend limit\ufffd 40%')
      for (const el of await band.findAll({})) expect(el.text).not.toMatch(CONTROL)
      await band.unmount()
      const pane = await $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: PANE_PROPS })
      expect((await pane.find({ key: 'context-used' }))?.text).toContain('claude-opus-5-5')
      expect((await pane.find({ key: 'busiest-1' }))?.text).toContain('look at this now')
      for (const el of await pane.findAll({})) expect(el.text).not.toMatch(CONTROL)
      await pane.unmount()
    }
    w.isPanePlaced = false
    expect((await runCommand($, '')).text?.replace(/\n/g, ' ')).not.toMatch(CONTROL)
  })
})

describe('band shares the slot', () => {
  test("draws its gauge on top of another mod's band, never in its place, on both surfaces", { plugins: [OTHER_BAND] }, async ($, on) => {
    world(on)
    await request($, pct(85))
    await runCommand($, 'band')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect((await ui.find({ key: 'gauge' }))?.text).toContain('ctx 85%')
      expect((await ui.find({ key: 'other-band' }))?.text).toBe("another mod's band")
      // The other band comes first, so a long gauge never pushes its buttons out of view.
      const keys = (await ui.findAll({})).map(el => el.key).filter(k => k === 'other-band' || k === 'gauge')
      expect(keys).toEqual(['other-band', 'gauge'])
      expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { flexDirection: 'column' } })
      await ui.unmount()
    }
  })

  test('band off: the other band shows alone', { plugins: [OTHER_BAND] }, async ($, on) => {
    world(on)
    await request($, pct(85))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect(await ui.find({ key: 'gauge' })).toBeUndefined()
      expect(await ui.find({ key: 'other-band' })).toBeDefined()
      await ui.unmount()
    }
  })
})

describe('band above the prompt', () => {
  test('the toggle persists: off by default, on after /redline band, still on at the next session start', async ($, on) => {
    world(on)
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>the engine's band</Text>
    })
    const START = { cwd: '/tmp', surface: 'terminal' as const, isInteractive: true }
    await $.session.start(START)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect(await ui.find({ key: 'gauge' })).toBeUndefined()
      await ui.unmount()
    }
    await runCommand($, 'band')
    await $.session.start(START)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect(await ui.find({ key: 'gauge' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('sizes its bar to the band body, not the terminal', async ($, on) => {
    world(on)
    await request($, pct(85))
    await runCommand($, 'band')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: 60 } })
      const texts = await ui.findAll({ type: 'Text' })
      expect(texts.some(t => t.text === '████░')).toBe(true)
      await ui.unmount()
    }
  })

  test('/redline band toggles it, drawn the same on both surfaces, Hide turns it off', async ($, on) => {
    const w = world(on)
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text key="engine">the engine's band</Text>
    })
    await request($, pct(85))
    for (const surface of SURFACES) {
      const off = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect(await off.find({ key: 'gauge' })).toBeUndefined()
      expect(await off.find({ text: "the engine's band" })).toBeDefined()
      await off.unmount()

      // Nothing for the model to read: {} and a toast.
      expect(await runCommand($, 'band')).toEqual({})
      expect(w.toasts[w.toasts.length - 1]).toContain('band is on')
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: BAND_PROPS })
      const gauge = await ui.find({ key: 'gauge' })
      expect(gauge?.text).toContain('ctx 85%')
      expect(gauge?.text).toContain('RED')
      expect(gauge?.text).toContain(' · $1.25 · ')
      // The bar and the level word are coloured by level (the innermost Texts).
      const texts = await ui.findAll({ type: 'Text' })
      expect(texts.find(t => t.text === '█████████░')?.props.color).toBe('error')
      expect(texts.find(t => t.text.trim() === 'RED')?.props.color).toBe('error')

      await ui.press({ key: 'hide' })
      expect(await ui.find({ key: 'gauge' })).toBeUndefined()
      await ui.unmount()
    }
    expect(w.toasts.filter(t => t.startsWith('Context is'))).toHaveLength(1)
  })

  test('yields to a survey', async ($, on) => {
    world(on)
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text key="survey">a survey</Text>
    })
    await runCommand($, 'band')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, hasSurvey: true } })
      expect(await ui.find({ text: 'a survey' })).toBeDefined()
      expect(await ui.find({ key: 'gauge' })).toBeUndefined()
      await ui.unmount()
    }
  })
})

describe('detail view', () => {
  test('shows context, tokens, cost, session time, plan limits and the busiest turns on both surfaces', async ($, on) => {
    const w = world(on, {
      rateLimits: [{ kind: 'five_hour', percentUsed: 80, resetsAt: new Date(T0 + 180 * MIN).toISOString() }],
    })
    await $.turn.start({ text: 'refactor the auth module\nand add tests', turnId: 'big' })
    await request($, pct(40), { turnId: 'big' })
    await request($, pct(45), { turnId: 'big' })
    await $.turn.start({ text: 'fix the typo', turnId: 'small' })
    await request($, pct(46), { turnId: 'small' })
    await request($, 20_000, { turnId: 'sub', agentId: 'agent-abcdef123', model: 'claude-haiku-4-5' })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: PANE_PROPS })
      const text = async (key: string) => (await ui.find({ key }))?.text ?? `(no ${key})`
      expect(await text('context')).toContain('46%')
      expect(await text('context-used')).toContain('92k of 200k tokens')
      expect(await text('tokens')).toMatch(/input 6\.0k · output 3\.2k · cache read 2\d\dk · cache write 10k/)
      expect(await text('cost')).toContain("$1.25 this session, Claude Code's own figure")
      expect(await text('cost')).not.toContain('≈')
      expect(await text('cost-table')).toMatch(/≈\$\d+\.\d\d for the requests counted, by redline's price table \(Opus 5\.5\)/)
      expect(await text('session')).toContain('30m')
      expect(await text('limit-five_hour')).toContain('80%')
      expect(await text('limit-five_hour')).toContain('out in ~30m')
      expect(await ui.find({ key: 'limits-none' })).toBeUndefined()
      expect(await text('busiest-1')).toContain('refactor the auth module')
      expect(await text('busiest-1')).toContain('2 req')
      expect(await text('busiest-2')).toContain('fix the typo')
      expect(await text('busiest-3')).toContain('subagent agent-ab')
      await ui.unmount()
    }
    expect(w.toasts).toHaveLength(0)
  })

  test('says so when no plan limits are reported, and when a model has no price', async ($, on) => {
    world(on, { cost: undefined })
    await request($, 30_000, { model: 'claude-nova-1' })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: PANE_PROPS })
      expect((await ui.find({ key: 'limits-none' }))?.text).toContain('none reported')
      expect((await ui.find({ key: 'cost-table' }))?.text).toContain('no price for claude-nova-1 - tokens only')
      expect(await ui.find({ key: 'cost' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('its buttons toggle the band and close the pane', async ($, on) => {
    const w = world(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: PANE_PROPS })
      expect((await ui.find({ key: 'band' }))?.text).toBe('Show band')
      await ui.press({ key: 'band' })
      expect((await ui.find({ key: 'band' }))?.text).toBe('Hide band')
      await ui.press({ key: 'band' })
      await ui.press({ key: 'close' })
      await ui.unmount()
    }
    expect(w.closed).toEqual(['redline', 'redline'])
  })
})
