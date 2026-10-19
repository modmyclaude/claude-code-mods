// redline through the engine's real wiring: model requests raised as
// `turn.step`, measurements as `session.measure`, the command as
// `command.run`, and the band and detail view mounted on both surfaces. The
// test's hooks answer what lies beneath the plugin: the model, the session's
// usage, the clock, the store, and the status line and toasts it draws.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { CommandSpec, On, SessionRateLimit, SessionUsage, TurnUsage } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { boltOf, rasterCells } from '../hooks/bolt-draw'
import type { BoltPick } from '../hooks/bolt-draw'

const MIN = 60_000
const T0 = Date.parse('2026-10-08T12:00:00Z')
const WINDOW = 200_000
const SURFACES = ['terminal', 'desktop'] as const

type World = {
  clock: ReturnType<typeof mock.clock>
  statuses: (string | undefined)[]
  toasts: string[]
  logs: string[]
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
    logs: [],
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
  on('ui.log', ($, e) => (w.logs.push(e.text), { value: undefined }))
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
    const { usage, tools } = replies.shift() ?? { usage: null, tools: [] }
    yield { kind: 'stop', stopReason: tools.length > 0 ? 'tool_use' : 'end_turn', usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: tools.map(name => ({ name, input: {} })), stopReason: tools.length > 0 ? 'tool_use' : 'end_turn', usage }
  })
  return w
}

/** What the model answers next: its usage, and the tools it calls (what the next request will carry). */
const replies: { usage: TurnUsage | null; tools: string[] }[] = []

/** A usage whose input side (uncached + cache read + cache write) is `ctx`. */
const usageOf = (ctx: number, model = 'claude-opus-5-5', output = 800): TurnUsage => ({
  model,
  input_tokens: 1500,
  cache_creation_input_tokens: 2500,
  cache_read_input_tokens: ctx - 4000,
  output_tokens: output,
})

/** Raises one model request through every plugin and reads it to its end. */
async function request($: Engine, ctx: number, opts: { turnId?: string; agentId?: string; model?: string; index?: number; tools?: string[] } = {}) {
  replies.push({ usage: usageOf(ctx, opts.model), tools: opts.tools ?? [] })
  const stream = $.turn.step({ turnId: opts.turnId ?? 't1', index: opts.index ?? 0, model: opts.model ?? 'claude-opus-5-5', messageCount: 3, agentId: opts.agentId })
  for await (const chunk of stream) void chunk
}

const pct = (p: number) => Math.round((WINDOW * p) / 100)
/** The status line's context figure at p%: its bar, then the readout. */
const ctxAt = (p: number) => new RegExp(`^context [█░]+ ${p}%`)

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
    // Claude Code's ledger is an estimate at list prices, not a bill: marked ≈.
    expect(w.status()).toMatch(/^context ███░░░░░░░ 30% · ≈\$1\.25 · /)
    expect(w.status()).not.toMatch(/AMBER|RED/)
    await request($, pct(60))
    expect(w.status()).toMatch(/^context ██████░░░░ 60% AMBER · /)
    await request($, pct(79))
    expect(w.status()).toContain('context ████████░░ 79% AMBER')
    await request($, pct(80))
    expect(w.status()).toContain('context ████████░░ 80% RED')
    expect(w.statuses).toHaveLength(4)
  })

  test("a subagent's request leaves the session's context alone", async ($, on) => {
    const w = world(on)
    await request($, pct(40))
    await request($, pct(95), { agentId: 'sub-1', turnId: 's1' })
    expect(w.status()).toMatch(ctxAt(40))
    expect(w.toasts).toHaveLength(0)
  })

  test("Claude Code's own percentage is shown once it counts the request", async ($, on) => {
    const w = world(on)
    // Claude Code has measured this very request and says 81 (159k computes to 80).
    w.usage = { ...w.usage, context: { window: WINDOW, tokens: 159_000, percent: 81 } }
    await request($, 159_000)
    expect(w.status()).toMatch(ctxAt(81))
    // Its figure lags the next request: the gauge computes from that request.
    await request($, pct(90))
    expect(w.status()).toMatch(ctxAt(90))
    // The turn's measurement brings Claude Code's figure back.
    await $.session.measure({ context: { window: WINDOW, tokens: 180_000, percent: 89 }, rateLimits: [], cost: { usd: 2 }, changed: ['context'] })
    expect(w.status()).toMatch(ctxAt(89))
  })

  test('the window comes from Claude Code, so a 1M model reads lower', async ($, on) => {
    const w = world(on, { context: { window: 1_000_000 } })
    await request($, 500_000)
    expect(w.status()).toMatch(ctxAt(50))
  })

  test('shows tokens per minute and the pace of the last 10 minutes', async ($, on) => {
    const w = world(on)
    await request($, 100_000)
    await w.clock.advance(4 * MIN)
    await request($, 120_000)
    // +20k context in 4 minutes: 80k left at 5k/min.
    expect(w.status()).toContain('full in ≈16m')
    // New tokens: 2 requests x (1500 + 2500 + 800), over the 4 minutes tracked.
    expect(w.status()).toContain('2.4k tokens/min')
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
    expect(w.status()).toContain('5h ████░ 80% AMBER, out in ≈30m')
    expect(w.status()).toContain('week █░░░░ 12%')
    expect(w.status()).not.toContain('12%,')
  })

  test('a late burst on a plan window warns on the line, at the recent rate', async ($, on) => {
    const w = world(on)
    const resetsAt = new Date(T0 + 30 * MIN).toISOString()
    const measure = (percentUsed: number) =>
      $.session.measure({ context: { window: WINDOW, tokens: pct(20), percent: 20 }, rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt }], cost: { usd: 2 }, changed: ['rateLimits'] })
    await measure(20)
    expect(w.status()).toContain('5h █░░░░ 20%')
    await w.clock.advance(10 * MIN)
    await measure(50)
    // 30 points in 10 minutes: dry in ≈17m, before the reset in 20m.
    expect(w.status()).toContain('5h ███░░ 50% AMBER, out in ≈17m')
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
    expect(w.status()).toContain('5h ██░░░ 41%')
    expect(w.status()).toContain(' · ≈$2.00 · ')
  })
})

describe('never in the way', () => {
  test('every chunk and the response pass through untouched, even when usage cannot be read', async ($, on) => {
    const w = world(on)
    w.isUsageDenied = true
    replies.push({ usage: usageOf(pct(50)), tools: [] })
    const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3 })
    const chunks = []
    let step = await stream.next()
    for (; !step.done; step = await stream.next()) chunks.push(step.value)
    const response = step.value
    expect(chunks).toEqual([{ kind: 'stop', stopReason: 'end_turn', usage: usageOf(pct(50)) }])
    expect(response).toEqual({ turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: usageOf(pct(50)) })
    // The request still counted; with no window known the fill reads unknown.
    expect(w.status()).toMatch(/^context -- · ≈\$0\.05 · /)
  })

  test('a request with no usage (interrupted) changes nothing', async ($, on) => {
    const w = world(on)
    replies.push({ usage: null, tools: [] })
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
    expect(w.status()).toMatch(ctxAt(20))
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
    expect(w.status()).toMatch(ctxAt(85))
  })

  test('/clear starts the gauge over and re-arms it', async ($, on) => {
    const w = world(on)
    await request($, pct(85))
    await $.session.end({ reason: 'clear', sessionId: 'abc', resume: { id: 'abc' } })
    expect(w.status()).toMatch(/^context -- /)
    await request($, pct(81), { turnId: 't2' })
    expect(w.toasts).toHaveLength(2)
  })

  test('an in-session /resume starts it over too: no pace carried across conversations', async ($, on) => {
    const w = world(on, { context: { window: 1_000_000 } })
    await request($, 50_000)
    await $.session.end({ reason: 'resume', sessionId: 'abc', resume: { id: 'abc' } })
    await w.clock.advance(2 * MIN)
    await request($, 400_000, { turnId: 't2' })
    expect(w.status()).toMatch(ctxAt(40))
    expect(w.status()).not.toContain('full in')
  })

  test("a subagent's compaction leaves the session's gauge alone", async ($, on) => {
    const w = world(on)
    on('session.compact', () => ({ messages: [SUMMARY], tokensAfter: 1_000 }))
    await request($, pct(85))
    await $.session.compact({ trigger: 'auto', agentId: 'sub-1', messages: [SUMMARY] })
    expect(w.status()).toMatch(ctxAt(85))
  })

  test('a measurement with no count after a compaction keeps the compacted size', async ($, on) => {
    const w = world(on)
    on('session.compact', () => ({ messages: [SUMMARY], tokensAfter: pct(20) }))
    await request($, pct(85))
    await $.session.compact({ trigger: 'manual', messages: [SUMMARY] })
    await $.session.measure({ context: { window: WINDOW }, rateLimits: [], cost: { usd: 2 }, changed: ['cost'] })
    expect(w.status()).toMatch(ctxAt(20))
  })
})

describe('a spent window, idle past its reset', () => {
  test('the line and the pane stop saying OUT once the reset time passes, with no reply to prompt it', async ($, on) => {
    const w = world(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(T0 + 80 * MIN).toISOString() }] })
    await request($, pct(20))
    expect(w.status()).toContain('5h OUT, resets in 1h 20m')
    await w.clock.advance(90 * MIN) // rate-limited: no reply, no measurement
    expect(w.status()).not.toContain('OUT')
    expect(w.status()).toContain('5h reset')
    for (const surface of SURFACES) {
      const pane = await $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: PANE_PROPS })
      const text = (await pane.find({ key: 'limit-five_hour' }))?.text ?? ''
      expect(text).toContain('reset 10m ago')
      expect(text).not.toContain('OUT')
      expect((await pane.find({ key: 'state' }))?.text).toBe('Within limits')
      await pane.unmount()
    }
  })
})

/** The gauge's bar Text(s): one Text on the terminal, one-cell glyph Texts on the desktop. */
const barCells = <T extends { text: string }>(texts: T[]): T[] => {
  const whole = texts.filter(t => /^[\u2580-\u259f]{2,}$/u.test(t.text))
  return whole.length > 0 ? whole : texts.filter(t => /^[\u2580-\u259f]$/u.test(t.text))
}
const barOf = (texts: { text: string }[]) => barCells(texts).map(t => t.text).join('')

describe('desktop: the bar apart from the words', () => {
  // The desktop draws a Text holding block characters in the code font, words and all, so
  // a gauge row changed font and overflowed. There the bar is one-cell glyphs of its own.
  const GLYPH = /[\u2580-\u259f]/u
  const textsOf = (node: unknown, inCell = false, out: { text: string; inCell: boolean }[] = []) => {
    if (node === null || typeof node !== 'object') return out
    const n = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
    const cell = inCell || (n.type === 'Box' && n.props?.width === 1)
    if (n.type === 'Text') out.push({ text: (n.children ?? []).filter(c => typeof c === 'string').join(''), inCell: cell })
    for (const c of n.children ?? []) textsOf(c, cell, out)
    return out
  }

  test('band and detail pane draw the bar as one-cell glyphs; the terminal keeps one Text', async ($, on) => {
    world(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: new Date(T0 + 180 * MIN).toISOString() }] })
    await runCommand($, 'band')
    await request($, pct(55))
    const band = await $.ui.mount({ plugin: 'redline', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    const pane = await $.ui.mount({ plugin: 'redline', surface: 'desktop', component: 'Pane', requestId: 'redline', props: PANE_PROPS })
    for (const ui of [band, pane]) {
      const texts = textsOf(await ui.drawn())
      expect(texts.some(t => GLYPH.test(t.text))).toBe(true)
      for (const t of texts.filter(t => GLYPH.test(t.text))) {
        expect(t.inCell, t.text).toBe(true)
        expect([...t.text].length, t.text).toBe(1)
      }
    }
    expect((await band.find({ key: 'gauge' }))?.text).toContain('55%')
    expect((await pane.find({ key: 'limit-five_hour' }))?.text).toContain('40%')
    await band.unmount()
    await pane.unmount()
    const term = await $.ui.mount({ plugin: 'redline', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(textsOf(await term.drawn()).some(t => GLYPH.test(t.text) && [...t.text].length > 1)).toBe(true)
    await term.unmount()
  })
})

describe('idle', () => {
  test('a band already drawn drops the pace too, once idle past 10 minutes', async ($, on) => {
    const w = world(on)
    await runCommand($, 'band')
    await request($, 100_000)
    await w.clock.advance(4 * MIN)
    await request($, 120_000)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect((await ui.find({ key: 'gauge' }))?.text).toContain('full in ≈16m')
      await ui.unmount()
    }
    const ui = await $.ui.mount({ plugin: 'redline', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    await w.clock.advance(30 * MIN)
    expect((await ui.find({ key: 'gauge' }))?.text).not.toContain('full in')
  })

  test('once the session sits idle past 10 minutes the line repaints once with no pace or rate', async ($, on) => {
    const w = world(on)
    await request($, 100_000)
    await w.clock.advance(4 * MIN)
    await request($, 120_000)
    expect(w.status()).toContain('full in ≈16m')
    const painted = w.statuses.length
    await w.clock.advance(5 * MIN) // still inside the window: nothing repaints
    expect(w.statuses).toHaveLength(painted)
    await w.clock.advance(6 * MIN)
    expect(w.statuses).toHaveLength(painted + 1)
    expect(w.status()).not.toContain('full in')
    expect(w.status()).not.toContain('tokens/min') // idle: no rate at all, never a 0
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
    expect(w.specs[0]).toMatchObject({ name: 'redline', argumentHint: '[spend|band]', immediate: true })
    expect(w.status()).toMatch(/^context -- /)
    const band = await $.ui.mount({ plugin: 'redline', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ key: 'gauge' })).toBeDefined()
  })

  test('opens the detail pane; where no pane is placed the view goes to the transcript, never to the model', async ($, on) => {
    const w = world(on)
    await $.turn.start({ text: 'rotate the deploy key before noon', turnId: 't1' })
    await request($, pct(50))
    expect(await runCommand($, '')).toEqual({})
    expect(w.opened).toEqual(['redline'])
    w.isPanePlaced = false
    // Still {}: command text is read by the model, and the spend view's turn rows carry prompt words.
    expect(await runCommand($, '')).toEqual({})
    expect(await runCommand($, 'spend')).toEqual({})
    const printed = w.logs.join('\n')
    expect(printed).toContain('Redline - context, plan limits and cost')
    expect(printed).toContain('Context  █████░░░░░   50%')
    expect(printed).toContain('Where the money went: /redline spend')
    expect(printed).toContain('Redline - where the money went')
    expect(printed).toContain('1. rotate the deploy key before noon')
    for (const row of w.logs) expect(row.length).toBeLessThanOrEqual(1900)
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
    expect(w.status()).toMatch(ctxAt(85))
    expect(w.status()).toContain('spend limit\ufffd ██░░░ 40%')
    expect(w.toasts[0]).not.toMatch(CONTROL)
    await runCommand($, 'band')
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect((await band.find({ key: 'gauge' }))?.text).toContain('spend limit\ufffd ██░░░ 40%')
      for (const el of await band.findAll({})) expect(el.text).not.toMatch(CONTROL)
      await band.unmount()
      const pane = await $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: PANE_PROPS })
      expect((await pane.find({ key: 'context' }))?.text).toContain('85%')
      for (const el of await pane.findAll({})) expect(el.text).not.toMatch(CONTROL)
      await pane.unmount()
      await runCommand($, 'spend')
      const spend = await $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: PANE_PROPS })
      expect((await spend.find({ key: 'busiest-1' }))?.text).toContain('look at this now')
      for (const el of await spend.findAll({})) expect(el.text).not.toMatch(CONTROL)
      await spend.unmount()
      await runCommand($, '')
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
      expect((await ui.find({ key: 'gauge' }))?.text).toMatch(/context.*85%/)
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

  // A session refuses a tree that puts the engine's own node under a Box that
  // sizes, hides or moves it ("engine node under a Box with prop ..."), and draws
  // its own band instead. The kit does not check this, so the test walks the tree.
  const ENGINE_BENEATH = {
    name: 'engine-beneath',
    tier: 'append' as const,
    register(on: On) {
      on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as never)
    },
  }
  const CONCEALING = ['display', 'overflow', 'position', 'width', 'height', 'minWidth', 'minHeight', 'top', 'left', 'right', 'bottom']
  type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
  function engineNodeConcealers(node: unknown, around: string[] = []): string[][] {
    if (node === null || typeof node !== 'object') return []
    const n = node as Node
    if (n.type === 'engine') return [around]
    const mine = n.type === 'Box' ? CONCEALING.filter(k => n.props?.[k] !== undefined) : []
    return (n.children ?? []).flatMap(c => engineNodeConcealers(c, [...around, ...mine]))
  }

  test('the engine band beneath the gauge is never under a Box that sizes or hides it', { plugins: [ENGINE_BENEATH] }, async ($, on) => {
    world(on)
    await request($, pct(85))
    await runCommand($, 'band')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect((await ui.find({ key: 'gauge' }))?.text).toMatch(/context.*85%/)
      expect(engineNodeConcealers(await ui.drawn())).toEqual([[]])
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
      expect(barOf(texts)).toBe('████░')
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
      expect(w.toasts[w.toasts.length - 1]).toContain('Band is on')
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: BAND_PROPS })
      const gauge = await ui.find({ key: 'gauge' })
      expect(gauge?.text).toMatch(/context.*85%/)
      expect(gauge?.text).toContain('RED')
      expect(gauge?.text).toContain(' · ≈$1.25 · ')
      // The bar and the level word are coloured by level (the innermost Texts).
      const texts = await ui.findAll({ type: 'Text' })
      expect(barOf(texts)).toBe('█████████░')
      expect(barCells(texts).every(t => t.props.color === 'error')).toBe(true)
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
  test('the cap keeps an old busy turn: a big early turn survives 100 later small ones', async ($, on) => {
    world(on, { context: { window: 1_000_000 } })
    await $.turn.start({ text: 'the big one', turnId: 'big' })
    await request($, 400_000, { turnId: 'big' })
    for (let i = 0; i < 100; i++) {
      await $.turn.start({ text: `small ${i}`, turnId: `small-${i}` })
      await request($, 10_000 + i, { turnId: `small-${i}` })
    }
    await runCommand($, 'spend')
    for (const surface of SURFACES) {
      const pane = await $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: PANE_PROPS })
      expect((await pane.find({ key: 'busiest-1' }))?.text).toContain('the big one')
      await pane.unmount()
    }
  })

  test('the overview shows the hero, the context, the plan window and this session; the Spending button shows the costliest turns, on both surfaces', async ($, on) => {
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
      // The 5-hour window runs dry before it resets: the hero names it, in the band's words.
      expect(await text('state')).toBe('5-hour runs out in ≈30m')
      expect(await text('context')).toMatch(/^Context.*46%$/)
      expect(await text('limit-five_hour')).toMatch(/^5-hour.*80%.*out in ≈30m,.*resets in 3h$/)
      expect(await ui.find({ key: 'limits-none' })).toBeUndefined()
      expect(await text('session')).toMatch(/^Started\s*(\w{3} )?\d{1,2}(:\d\d)?[ap]m$/)
      expect(await text('cost')).toMatch(/^Cost\s*≈\$1\.25$/)
      expect(await text('note')).toBe('Dollars are API list prices, not a bill. Times with ≈ assume your pace holds.')
      for (const key of ['tokens', 'tokens-detail', 'rate', 'pace', 'requests', 'cost-table', 'busiest-1', 'spend-prompt']) expect(await ui.find({ key }), key).toBeUndefined()
      await ui.press({ key: 'view' })
      expect(await ui.find({ key: 'state' })).toBeUndefined()
      // Redline started counting after the session began, so its hero says since when.
      expect(await text('spend-total')).toMatch(/^≈\$\d\.\d\d in 4 requests · since \d{1,2}(:\d\d)?[ap]m$/)
      expect(await text('busiest-1')).toMatch(/^1\. refactor the auth module\s*≈\$\d\.\d\d$/)
      expect(await text('busiest-2')).toContain('fix the typo')
      expect(await text('busiest-3')).toContain('subagent agent-ab')
      expect(await text('model-claude-opus-5-5')).toMatch(/^Opus 5\.5.*≈\$.*\d+%$/)
      expect(await text('model-claude-haiku-4-5')).toMatch(/^Haiku 4\.5.*≈\$.*\d+%$/)
      await ui.press({ key: 'view' })
      expect(await text('state')).toBe('5-hour runs out in ≈30m')
      await ui.unmount()
    }
    expect(w.toasts).toHaveLength(0)
  })

  test('says so when no plan limits are reported, and counts tokens when a model has no price', async ($, on) => {
    world(on, { cost: undefined })
    await request($, 30_000, { model: 'claude-nova-1' })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: PANE_PROPS })
      expect((await ui.find({ key: 'state' }))?.text).toBe('Within limits')
      expect((await ui.find({ key: 'limits-none' }))?.text).toBe('On a Claude plan, 5-hour and week limits appear after a reply.')
      expect((await ui.find({ key: 'cost' }))?.text).toMatch(/^Cost\s*31k tokens$/)
      expect(await ui.find({ key: 'cost-table' })).toBeUndefined()
      expect(await ui.find({ key: 'note' })).toBeUndefined() // no dollars, no estimate: nothing to caveat
      await ui.press({ key: 'view' })
      expect((await ui.find({ key: 'spend-total' }))?.text).toMatch(/^31k tokens in 1 request/)
      expect((await ui.find({ key: 'spend-prompt' }))?.text).toMatch(/^Prompt.*--.*--$/)
      await ui.press({ key: 'view' })
      await ui.unmount()
    }
  })

  test('its buttons switch the view, toggle the band and close the pane', async ($, on) => {
    const w = world(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: PANE_PROPS })
      expect((await ui.find({ key: 'band' }))?.text).toBe('Show band')
      await ui.press({ key: 'band' })
      expect((await ui.find({ key: 'band' }))?.text).toBe('Hide band')
      await ui.press({ key: 'band' })
      expect((await ui.find({ key: 'view' }))?.text).toBe('Spending')
      await ui.press({ key: 'view' })
      expect((await ui.find({ key: 'view' }))?.text).toBe('Back')
      expect(await ui.find({ key: 'spend-total' })).toBeDefined()
      expect(await ui.find({ key: 'state' })).toBeUndefined()
      await ui.press({ key: 'view' })
      expect((await ui.find({ key: 'view' }))?.text).toBe('Spending')
      expect(await ui.find({ key: 'state' })).toBeDefined()
      await ui.press({ key: 'close' })
      await ui.unmount()
    }
    expect(w.closed).toEqual(['redline', 'redline'])
  })
})

const FIVE_OUT = (resetMin: number) => ({ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(T0 + resetMin * MIN).toISOString() })

describe('repaint at every plan window reset', () => {
  test('a band and a pane left open repaint at the reset, with no reading', async ($, on) => {
    const w = world(on, { rateLimits: [FIVE_OUT(80)] })
    await runCommand($, 'band')
    await request($, pct(20))
    const bands = []
    const panes = []
    for (const surface of SURFACES) {
      bands.push(await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: BAND_PROPS }))
      panes.push(await $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: PANE_PROPS }))
    }
    await w.clock.advance(81 * MIN) // rate-limited: no reply, no measurement
    expect(w.status()).toContain('5h reset')
    for (const band of bands) {
      const text = (await band.find({ key: 'gauge' }))?.text ?? ''
      expect(text).toContain('5h reset')
      expect(text).not.toContain('OUT')
    }
    for (const pane of panes) {
      const text = (await pane.find({ key: 'limit-five_hour' }))?.text ?? ''
      expect(text).toContain('reset <1m ago')
      expect(text).not.toContain('OUT')
    }
  })

  test('a reset past the longest timer delay re-arms once at the cap, then flips at the real reset', async ($, on) => {
    const MAX_DELAY = 2_147_483_647 // what a timer holds, ~24.8 days
    const resetMs = T0 + 30 * 24 * 60 * MIN
    const w = world(on, { rateLimits: [{ kind: 'spend_limit', percentUsed: 100, resetsAt: new Date(resetMs).toISOString() }] })
    await request($, pct(20))
    expect(w.status()).toContain('spend OUT, resets in 30d')
    await w.clock.advance(11 * MIN) // the idle repaint fires and re-arms from +10m
    const painted = w.statuses.length
    const capFire = 10 * MIN + 1000 + MAX_DELAY
    await w.clock.advance(capFire - 11 * MIN - 5000) // just before the cap
    expect(w.statuses).toHaveLength(painted)
    await w.clock.advance(10_000) // just after it: one repaint, no loop
    expect(w.statuses).toHaveLength(painted + 1)
    expect(w.status()).toContain('OUT') // about 5 days still to go
    await w.clock.advance(resetMs - T0 - capFire + MIN) // past the real reset
    expect(w.status()).toContain('spend reset')
    expect(w.statuses).toHaveLength(painted + 2)
  })

  test('a reset due before the idle repaint is armed by the reading itself', async ($, on) => {
    const w = world(on, { rateLimits: [FIVE_OUT(5)] })
    await request($, pct(20))
    expect(w.status()).toContain('5h OUT, resets in 5m')
    await w.clock.advance(6 * MIN) // before the 10-minute idle repaint
    expect(w.status()).toContain('5h reset')
  })

  test('the weekly window resets first, then the spent 5-hour one: both repaint', async ($, on) => {
    const w = world(on, { rateLimits: [FIVE_OUT(80), { kind: 'seven_day', percentUsed: 60, resetsAt: new Date(T0 + 30 * MIN).toISOString() }] })
    await request($, pct(20))
    await w.clock.advance(31 * MIN)
    expect(w.status()).toContain('week reset')
    expect(w.status()).toContain('5h OUT, resets in 50m')
    await w.clock.advance(50 * MIN)
    expect(w.status()).not.toContain('OUT')
    expect(w.status()).toContain('5h reset')
  })

  test('locked out for the week, the 5-hour window resets first: the weekly still repaints', async ($, on) => {
    const w = world(on, {
      rateLimits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: new Date(T0 + 120 * MIN).toISOString() }, { kind: 'seven_day', percentUsed: 100, resetsAt: new Date(T0 + 3 * 24 * 60 * MIN).toISOString() }],
    })
    await request($, pct(20))
    expect(w.status()).toMatch(/week OUT, resets (Sun|Mon) \d{1,2}(:\d\d)?[ap]m/) // three days off: the clock time, not arithmetic
    await w.clock.advance(3 * 24 * 60 * MIN + MIN)
    expect(w.status()).not.toContain('OUT')
    expect(w.status()).toContain('week reset')
  })
})

describe('the recent rate everywhere', () => {
  const burst = async ($: Engine, w: World, between?: () => Promise<unknown>) => {
    const resetsAt = new Date(T0 + 30 * MIN).toISOString()
    const measure = (percentUsed: number) =>
      $.session.measure({ context: { window: WINDOW, tokens: pct(20), percent: 20 }, rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt }], cost: { usd: 2 }, changed: ['rateLimits'] })
    await measure(20)
    if (between) await between()
    await w.clock.advance(10 * MIN)
    await measure(50)
  }

  test('the pane judges the run-out on the recent rate too, and says so', async ($, on) => {
    const w = world(on)
    await burst($, w)
    expect(w.status()).toContain('5h ███░░ 50% AMBER, out in ≈17m')
    for (const surface of SURFACES) {
      const pane = await $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: PANE_PROPS })
      const row = (await pane.find({ key: 'limit-five_hour' }))?.text ?? ''
      expect(row).toContain('out in ≈17m')
      expect(row).not.toContain('recent rate')
      expect((await pane.find({ key: 'state' }))?.text).toBe('5-hour runs out in ≈17m')
      await pane.unmount()
    }
  })

  test('a /clear keeps the plan windows readings (they belong to the account)', async ($, on) => {
    const w = world(on)
    await burst($, w, () => $.session.end({ reason: 'clear', sessionId: 'abc', resume: { id: 'abc' } }))
    expect(w.status()).toContain('5h ███░░ 50% AMBER, out in ≈17m')
  })
})

describe('Bolt beside the head', () => {
  // Bolt: small, idle beside the pane's head, asleep while nothing is measured or a
  // 5-hour or weekly window is spent, and out of the way in a narrow pane. A Raster
  // on the terminal, one code-font cell per character on the desktop. The status
  // line and the band never show it.
  type Drawn = { type?: unknown; key?: unknown; props?: Record<string, unknown>; children?: unknown[] }
  const under = (node: unknown, key: string): Drawn | undefined => {
    if (node === null || typeof node !== 'object') return undefined
    const n = node as Drawn
    if (n.key === key || n.props?.key === key) return n
    for (const c of n.children ?? []) {
      const hit = under(c, key)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  /** Bolt as drawn: the Raster's cells, or each desktop row as `width:ch|fg|bg` per one-cell Box. */
  const drawnBolt = (bolt: Drawn | undefined) => {
    if (bolt === undefined) return undefined
    if (bolt.type === 'Raster') return [bolt.props?.columns, bolt.props?.rows, bolt.props?.cells]
    return ((bolt.children ?? []) as Drawn[]).map(line =>
      ((line.children ?? []) as Drawn[]).map(cell => {
        const text = (cell.children ?? [])[0] as Drawn | undefined
        const paint = text === undefined ? ' ' : `${(text.children ?? []).join('')}|${text.props?.color ?? ''}|${text.props?.backgroundColor ?? ''}`
        return `${String(cell.type)}${String(cell.props?.width)}:${paint}`
      }),
    )
  }
  /** What `pick` must draw as on `surface`: its exact cells, at its exact size. */
  const boltAs = (surface: string, pick: BoltPick) => {
    const cells = boltOf(pick)
    if (surface === 'terminal') return [cells[0]?.length, cells.length, rasterCells(cells)]
    return cells.map(line =>
      line.map(c => `Box1:${c.fg === undefined && c.bg === undefined ? ' ' : `${c.ch}|${c.fg ?? ''}|${c.bg ?? ''}`}`),
    )
  }
  const IDLE: BoltPick = { size: 'small', pose: 'idle' }
  const SLEEP: BoltPick = { size: 'small', pose: 'sleep' }
  const pane = ($: Engine, surface: (typeof SURFACES)[number], bodyColumns = 100) =>
    $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: { ...PANE_PROPS, bodyColumns } })

  test('Bolt idles beside the head on both surfaces, the figures intact; under 60 columns a head of bars leaves him out, a head of words keeps him to 40', async ($, on) => {
    world(on)
    await request($, pct(30))
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      const tree = await ui.drawn()
      expect(drawnBolt(under(under(tree, 'head'), 'bolt')), surface).toEqual(boltAs(surface, IDLE))
      expect(under(tree, 'bolt')?.type).toBe(surface === 'terminal' ? 'Raster' : 'Box')
      expect(under(under(tree, 'head-lines'), 'state')).toBeDefined()
      expect(under(under(tree, 'head-lines'), 'context')).toBeDefined()
      expect((await ui.find({ key: 'context' }))?.text).toContain('30%')
      await ui.unmount()
      const narrow = await pane($, surface, 59)
      expect(await narrow.find({ key: 'bolt' }), surface).toBeUndefined()
      expect(await narrow.find({ key: 'head' })).toBeUndefined()
      expect((await narrow.find({ key: 'context' }))?.text).toContain('30%')
      await narrow.unmount()
    }
    // Nothing measured: a head of words alone keeps Bolt, asleep, down to 40 columns.
    await $.session.end({ reason: 'clear', sessionId: 'abc', resume: { id: 'abc' } })
    for (const surface of SURFACES) {
      const words = await pane($, surface, 40)
      expect(drawnBolt(await words.find({ key: 'bolt' })), surface).toEqual(boltAs(surface, SLEEP))
      expect((await words.find({ key: 'state' }))?.text).toBe('Nothing measured yet')
      expect((await words.find({ key: 'empty' }))?.text).toContain('after Claude')
      expect(await words.find({ key: 'context' })).toBeUndefined()
      await words.unmount()
      const tight = await pane($, surface, 39)
      expect(await tight.find({ key: 'bolt' }), surface).toBeUndefined()
      await tight.unmount()
    }
  })

  test('a full context keeps Bolt up: the hero says it, red, and calms after a /compact', async ($, on) => {
    world(on)
    on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: pct(100), tokensAfter: pct(10) }))
    await request($, pct(99))
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect(drawnBolt(await ui.find({ key: 'bolt' })), surface).toEqual(boltAs(surface, IDLE))
      expect((await ui.find({ key: 'state' }))?.text).toBe('Context 99%')
      await ui.unmount()
    }
    await request($, pct(100))
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect(drawnBolt(await ui.find({ key: 'bolt' })), surface).toEqual(boltAs(surface, IDLE))
      expect((await ui.find({ key: 'state' }))?.text).toBe('Context full · run /compact')
      expect((await ui.find({ key: 'context' }))?.text).toContain('100%')
      expect((await ui.find({ key: 'context' }))?.text).not.toContain('RED')
      await ui.unmount()
    }
    await $.session.compact({ trigger: 'manual', messages: [SUMMARY] })
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect((await ui.find({ key: 'state' }))?.text).toBe('Within limits')
      expect((await ui.find({ key: 'context' }))?.text).toContain('10%')
      await ui.unmount()
    }
  })

  test('Bolt sleeps while a 5-hour or weekly window is OUT, the hero says which, and he wakes at its reset in a pane left open', async ($, on) => {
    const w = world(on, { rateLimits: [FIVE_OUT(80)] })
    await request($, pct(20))
    const panes = []
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect(drawnBolt(await ui.find({ key: 'bolt' })), surface).toEqual(boltAs(surface, SLEEP))
      expect((await ui.find({ key: 'state' }))?.text).toBe('5-hour ran out · resets in 1h 20m')
      expect((await ui.find({ key: 'limit-five_hour' }))?.text).toMatch(/^5-hour.*OUT.*resets in 1h 20m$/)
      panes.push([surface, ui] as const)
    }
    await w.clock.advance(81 * MIN) // the reset passes with no reply: the repaint wakes Bolt
    for (const [surface, ui] of panes) {
      expect(drawnBolt(await ui.find({ key: 'bolt' })), surface).toEqual(boltAs(surface, IDLE))
      expect((await ui.find({ key: 'state' }))?.text).toBe('Within limits')
      await ui.unmount()
    }
    w.usage = { ...w.usage, rateLimits: [{ kind: 'seven_day', percentUsed: 100, resetsAt: new Date(T0 + 3 * 24 * 60 * MIN).toISOString() }] }
    await request($, pct(20))
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect(drawnBolt(await ui.find({ key: 'bolt' })), surface).toEqual(boltAs(surface, SLEEP))
      expect((await ui.find({ key: 'state' }))?.text).toMatch(/^Week ran out · resets (Sat|Sun|Mon) \d{1,2}(:\d\d)?[ap]m$/)
      await ui.unmount()
    }
  })

  test('a window under 100%, or one that is not a 5-hour or weekly window, leaves Bolt idle', async ($, on) => {
    const w = world(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 99, resetsAt: new Date(T0 + 80 * MIN).toISOString() }] })
    await request($, pct(20))
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect(drawnBolt(await ui.find({ key: 'bolt' })), surface).toEqual(boltAs(surface, IDLE))
      await ui.unmount()
    }
    w.usage = { ...w.usage, rateLimits: [{ kind: 'spend_limit', percentUsed: 100, resetsAt: new Date(T0 + 30 * 24 * 60 * MIN).toISOString() }] }
    await request($, pct(20))
    expect(w.status()).toContain('spend OUT')
    const ui = await pane($, 'terminal')
    expect(drawnBolt(await ui.find({ key: 'bolt' }))).toEqual(boltAs('terminal', IDLE))
    // The hero still names it: a gateway's limit is a wall too, just not one Bolt sleeps on.
    expect((await ui.find({ key: 'state' }))?.text).toBe('Spend ran out · resets in 30d')
    expect((await ui.find({ key: 'limit-spend_limit' }))?.text).toMatch(/^Spend.*OUT.*resets in 30d$/)
  })

  test('the status line and the band never draw Bolt', async ($, on) => {
    const w = world(on)
    await runCommand($, 'band')
    await request($, pct(100))
    expect(w.status()).toMatch(/^context ██████████ 100% RED · /)
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect(await band.find({ key: 'gauge' })).toBeDefined()
      expect(await band.find({ key: 'bolt' })).toBeUndefined()
      await band.unmount()
    }
  })
})

describe('the pane follows the UI standard', () => {
  type Node = { type?: unknown; key?: unknown; props?: Record<string, unknown>; children?: unknown[] }
  const walk = (node: unknown, out: Node[] = []): Node[] => {
    if (node === null || typeof node !== 'object') return out
    const n = node as Node
    out.push(n)
    for (const c of n.children ?? []) walk(c, out)
    return out
  }
  const textOf = (n: Node) => (n.children ?? []).filter((c): c is string => typeof c === 'string').join('')
  const keyOf = (n: Node) => (n.key ?? n.props?.key) as string | undefined

  test('a coloured hero, values at the right edge, nothing cut at 40 columns, a calm limit row, one footnote, no level words, on both surfaces', async ($, on) => {
    world(on, { rateLimits: [{ kind: 'seven_day', percentUsed: 84, resetsAt: new Date(T0 + (17 * 60 + 23) * MIN).toISOString() }] })
    await request($, pct(30))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: { ...PANE_PROPS, bodyColumns: 40 } })
      const nodes = walk(await ui.drawn())
      const texts = nodes.filter(n => n.type === 'Text')
      // The engine draws the title bar: the title line is for the text view only.
      expect(texts.some(n => textOf(n).startsWith('Redline - context')), surface).toBe(false)
      // The hero: the state, bold and in its colour.
      expect(texts.find(n => textOf(n) === 'Within limits')?.props, surface).toMatchObject({ bold: true, color: 'success' })
      // Nothing is cut: no Text truncates.
      for (const n of texts) expect(n.props?.wrap, `${surface}: ${textOf(n)}`).not.toMatch(/^truncate/)
      // Rows: a subtle label that takes the room, and the value pushed to the right edge.
      for (const key of ['session', 'cost']) {
        const parts = (nodes.find(n => n.type === 'Box' && keyOf(n) === key)?.children ?? []) as Node[]
        expect(parts.map(keyOf), key).toEqual(['label', 'value'])
        expect(parts[0]?.props, key).toMatchObject({ flexGrow: 1 })
        expect(parts[1]?.props, key).toMatchObject({ justifyContent: 'flex-end', flexShrink: 0 })
        expect(walk(parts[0]).find(n => n.type === 'Text')?.props?.color, key).toBe('subtle')
      }
      // A plan window that resets before it runs dry: its figure and its reset, calm, no run-out.
      const weekly = (await ui.find({ key: 'limit-seven_day' }))?.text ?? ''
      expect(weekly).toContain('84%')
      expect(weekly).toMatch(/resets (Thu|Fri) \d{1,2}:\d\d[ap]m/) // ten hours or more away: clock time
      expect(weekly).not.toContain('out in')
      // The one footnote, in subtle: the dollars' sentence alone, since no estimate is on screen.
      const notes = texts.filter(n => textOf(n).includes('Dollars are API list prices, not a bill.'))
      expect(notes, surface).toHaveLength(1)
      expect(notes[0]?.props?.color).toBe('subtle')
      expect(textOf(notes[0] as Node)).not.toContain('assume your pace holds')
      // The level words belong to the status line, which has no colour; the pane says the state in its hero.
      for (const n of texts) expect(textOf(n), surface).not.toMatch(/\b(RED|AMBER)\b/)
      expect((await ui.find({ key: 'cost' }))?.text).toMatch(/^Cost\s*≈\$/)
      for (const key of ['pace', 'rate', 'tokens', 'context-used', 'cost-table', 'limits-title', 'spend-title', 'rate-note']) expect(await ui.find({ key }), key).toBeUndefined()
      await ui.unmount()
    }
  })

  test('nothing clips at 40 columns: the fixed cells of a bar row leave the clauses 16 cells on the overview, gaps are 1 cell, clauses wrap whole, Bolt steps out, glyphs sit in cells', async ($, on) => {
    const fiveAt = new Date(T0 + 48 * MIN).toISOString()
    const weekAt = new Date(T0 + (2 * 24 + 19) * 60 * MIN).toISOString()
    const limitsAt = (week: number): SessionRateLimit[] => [{ kind: 'five_hour', percentUsed: 14, resetsAt: fiveAt }, { kind: 'seven_day', percentUsed: week, resetsAt: weekAt }]
    const w = world(on, { context: { window: 1_000_000 }, rateLimits: limitsAt(83.0244), cost: { usd: 57.62 } })
    // A sample state: the week up a point in ten minutes (dry in ≈2h 44m), the context filling in ≈30m.
    await $.session.measure({ context: { window: 1_000_000 }, rateLimits: limitsAt(83.0244), cost: { usd: 57.62 }, changed: ['rateLimits'] })
    await w.clock.advance(6 * MIN)
    await request($, 25_333)
    await w.clock.advance(4 * MIN)
    await request($, 140_000)
    await $.session.measure({ context: { window: 1_000_000, tokens: 140_000, percent: 14 }, rateLimits: limitsAt(84), cost: { usd: 57.62 }, changed: ['rateLimits'] })
    const glyphTexts = (node: unknown, cell = false, out: { text: string; cell: boolean }[] = []): { text: string; cell: boolean }[] => {
      if (node === null || typeof node !== 'object') return out
      const n = node as Node
      const here = cell || (n.type === 'Box' && n.props?.width === 1)
      if (n.type === 'Text' && /[▀-▟]/u.test(textOf(n))) out.push({ text: textOf(n), cell: here })
      for (const c of n.children ?? []) glyphTexts(c, here, out)
      return out
    }
    for (const surface of SURFACES) {
      for (const view of ['overview', 'spend'] as const) {
        await runCommand($, view === 'spend' ? 'spend' : '')
        const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: { ...PANE_PROPS, bodyColumns: 40 } })
        const at = `${surface} ${view}`
        const nodes = walk(await ui.drawn())
        if (view === 'overview') {
          expect((await ui.find({ key: 'state' }))?.text, at).toBe('Week runs out in ≈2h 44m')
          expect((await ui.find({ key: 'context' }))?.text, at).toContain('full in ≈30m')
          expect((await ui.find({ key: 'limit-seven_day' }))?.text, at).toMatch(/out in ≈2h 44m,.*resets (Sat|Sun|Mon) \d{1,2}(:\d\d)?[ap]m$/)
        }
        expect(await ui.find({ key: 'bolt' }), at).toBeUndefined()
        const bars = nodes.filter(n => n.type === 'Box' && n.props?.flexDirection === 'row' && /^(context$|limit-|spend-|model-)/.test(String(keyOf(n) ?? '')))
        expect(bars.length, at).toBeGreaterThanOrEqual(view === 'overview' ? 3 : 1)
        for (const row of bars) {
          const key = String(keyOf(row))
          const children = ((row.children ?? []) as unknown[]).filter((c): c is Node => c !== null && typeof c === 'object')
          expect(row.props?.columnGap, key).toBe(1)
          // The bar is its own child that never shrinks, ten glyphs wide; the other fixed cells are the label and figure widths.
          const barNode = children.find(c => keyOf(c) === 'bar')
          expect(barNode?.props?.flexShrink, `${at} ${key}`).toBe(0)
          const glyphCount = [...glyphTexts(barNode).map(t => t.text).join('')].length
          expect(glyphCount, `${at} ${key}`).toBe(10)
          const fixed = children.reduce((n, c) => n + (typeof c.props?.width === 'number' ? c.props.width : 0), 0) + glyphCount
          expect(fixed + (children.length - 1), `${at} ${key}`).toBeLessThanOrEqual(view === 'overview' ? 24 : 40)
          const when = children.find(c => keyOf(c) === 'when')
          if (when) expect(when.props, `${at} ${key}`).toMatchObject({ flexShrink: 1, flexWrap: 'wrap', rowGap: 0 })
          if (view === 'overview') expect(when, `${at} ${key}`).toBeDefined()
        }
        for (const n of nodes.filter(n => n.type === 'Text')) expect(n.props?.wrap, `${at}: ${textOf(n)}`).not.toMatch(/^truncate/)
        const glyphs = glyphTexts(await ui.drawn())
        expect(glyphs.length, at).toBeGreaterThan(0)
        if (surface === 'desktop') for (const g of glyphs) expect(g.cell && [...g.text].length === 1, `${at} ${g.text}`).toBe(true)
        await ui.unmount()
      }
    }
    // Both sentences of the footnote: dollars on screen, and estimates marked ≈.
    const ui = await $.ui.mount({ plugin: 'redline', surface: 'terminal', component: 'Pane', requestId: 'redline', props: { ...PANE_PROPS, bodyColumns: 40 } })
    await ui.press({ key: 'view' })
    expect((await ui.find({ key: 'note' }))?.text).toBe('Dollars are API list prices, not a bill. Times with ≈ assume your pace holds.')
    await ui.unmount()
  })

  test('each button sits in a wrapper the desktop remounts every drawing, so a press answers after a redraw; the terminal keeps them bare', async ($, on) => {
    world(on)
    await request($, pct(30))
    const wrappers = (tree: unknown): Map<string, Node> => {
      const out = new Map<string, Node>()
      for (const n of walk(tree)) {
        const button = ((n.children ?? []) as Node[]).find(c => c?.type === 'Button')
        if (n.type === 'Box' && button) out.set(String(keyOf(button)), n)
      }
      return out
    }
    const desktop = await $.ui.mount({ plugin: 'redline', surface: 'desktop', component: 'Pane', requestId: 'redline', props: PANE_PROPS })
    const before = wrappers(await desktop.drawn())
    expect([...before.keys()].sort()).toEqual(['band', 'close', 'view'])
    for (const [k, box] of before) expect(keyOf(box), k).toMatch(new RegExp(`^press-${k}-\\d+$`))
    await request($, pct(31)) // a reading redraws the pane: every wrapper key moves with the drawing
    const after = wrappers(await desktop.drawn())
    for (const [k, box] of before) {
      const moved = after.get(k)
      expect(moved, k).toBeDefined()
      expect(keyOf(moved as Node), k).toMatch(new RegExp(`^press-${k}-\\d+$`))
      expect(keyOf(moved as Node), `${k} after a redraw`).not.toBe(keyOf(box))
    }
    await desktop.press({ key: 'view' })
    expect((await desktop.find({ key: 'view' }))?.text).toBe('Back')
    await desktop.unmount()
    await runCommand($, '')
    const terminal = await $.ui.mount({ plugin: 'redline', surface: 'terminal', component: 'Pane', requestId: 'redline', props: PANE_PROPS })
    const bare = wrappers(await terminal.drawn())
    expect([...bare.keys()].sort()).toEqual(['band', 'close', 'view'])
    for (const [k, box] of bare) expect(keyOf(box) ?? '', k).not.toMatch(/^press-/)
    await terminal.unmount()
  })
})

describe('where the money went', () => {
  test('each request is charged to the kinds its tool results carried, split evenly; the first is the prompt; a subagent is one kind; MCP by server; by model', async ($, on) => {
    const w = world(on)
    await $.turn.start({ text: 'refactor the auth module', turnId: 't1' })
    await request($, pct(10), { turnId: 't1', index: 0, tools: ['Read', 'Edit', 'Read'] })
    await request($, pct(12), { turnId: 't1', index: 1, tools: ['Bash'] })
    await request($, pct(14), { turnId: 't1', index: 2, tools: ['mcp__github__search_issues'] })
    await request($, pct(16), { turnId: 't1', index: 3, tools: [] })
    await request($, 20_000, { turnId: 'sub', agentId: 'agent-1', index: 0, tools: ['Read'], model: 'claude-haiku-4-5' })
    await request($, 22_000, { turnId: 'sub', agentId: 'agent-1', index: 1, tools: [], model: 'claude-haiku-4-5' })
    await request($, pct(18), { turnId: 't1', index: 4, tools: [] }) // nothing carried: the model answered
    for (const surface of SURFACES) {
      await runCommand($, 'spend')
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: PANE_PROPS })
      const text = async (key: string) => (await ui.find({ key }))?.text ?? `(no ${key})`
      expect(await text('spend-total')).toMatch(/^≈\$\d\.\d\d in 7 requests · since \d{1,2}(:\d\d)?[ap]m$/)
      // Seven kinds: the three costliest (one request each, at a growing context) and the rest folded; labels in sentence case, dollars and a share, no counts.
      expect(await text('spend-answering')).toMatch(/^Answering.*≈\$\d\.\d\d.*\d+%$/)
      expect(await text('spend-mcp:github')).toMatch(/^github.*≈\$\d\.\d\d.*\d+%$/)
      expect(await text('spend-shell')).toMatch(/^Shell.*≈\$\d\.\d\d.*\d+%$/)
      expect(await text('spend-rest')).toMatch(/^The rest.*≈\$\d\.\d\d.*\d+%$/)
      for (const key of ['spend-prompt', 'spend-reading', 'spend-editing', 'spend-subagents', 'spend-none']) expect(await ui.find({ key }), key).toBeUndefined()
      for (const key of ['spend-answering', 'spend-rest']) expect(await text(key), key).not.toMatch(/req|cache|MCP/)
      // The row's texts run together: the share is what follows the dollars' two decimals.
      const share = (t: string) => Number(/\.\d\d(\d+)%$/.exec(t)?.[1])
      const total = [await text('spend-answering'), await text('spend-mcp:github'), await text('spend-shell'), await text('spend-rest')].map(share).reduce((a, b) => a + b, 0)
      expect(total).toBeGreaterThanOrEqual(98)
      expect(total).toBeLessThanOrEqual(102)
      expect(await text('model-claude-opus-5-5')).toMatch(/^Opus 5\.5.*≈\$.*\d+%$/)
      expect(await text('model-claude-haiku-4-5')).toMatch(/^Haiku 4\.5.*≈\$.*\d+%$/)
      // Four kind rows and two model rows leave one turn.
      expect(await text('busiest-1')).toContain('refactor the auth module')
      expect(await ui.find({ key: 'busiest-2' })).toBeUndefined()
      expect(await text('spend-rule')).toBe('Each request counts toward what it sent Claude. Dollars are API list prices.')
      await ui.unmount()
    }
    expect(w.status()).toContain('context') // the band and the status line are as before
  })

  test('an aborted turn leaves nothing behind: a turn started again carries no tool calls from before', async ($, on) => {
    world(on)
    await $.turn.start({ text: 'first try', turnId: 't1' })
    await request($, pct(10), { turnId: 't1', index: 0, tools: ['Read', 'Edit'] }) // aborted here: no request followed
    await $.turn.start({ text: 'again', turnId: 't1' })
    await request($, pct(11), { turnId: 't1', index: 1, tools: [] })
    await runCommand($, 'spend')
    const ui = await $.ui.mount({ plugin: 'redline', surface: 'terminal', component: 'Pane', requestId: 'redline', props: PANE_PROPS })
    expect((await ui.find({ key: 'spend-answering' }))?.text).toMatch(/^Answering/)
    expect((await ui.find({ key: 'spend-total' }))?.text).toContain('in 2 requests')
    expect(await ui.find({ key: 'spend-reading' })).toBeUndefined()
    expect(await ui.find({ key: 'spend-editing' })).toBeUndefined()
    await ui.unmount()
  })

  test('nothing yet before a request; /redline spend opens the pane on the spend view and /redline on the overview; every cost reads as an estimate', async ($, on) => {
    const w = world(on, { cost: undefined })
    expect(await runCommand($, 'spend')).toEqual({})
    expect(w.opened).toEqual(['redline'])
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'Pane', requestId: 'redline', props: PANE_PROPS })
      expect((await ui.find({ key: 'spend-total' }))?.text).toBe('Nothing spent yet')
      expect((await ui.find({ key: 'spend-none' }))?.text).toBe("Each kind of work shows up here after Claude's next reply.")
      expect((await ui.find({ key: 'view' }))?.text).toBe('Back')
      expect(await ui.find({ key: 'spend-rule' })).toBeUndefined()
      await ui.unmount()
    }
    await request($, pct(20), { index: 0, tools: ['Read'] })
    await request($, pct(22), { index: 1, tools: [] })
    const ui = await $.ui.mount({ plugin: 'redline', surface: 'terminal', component: 'Pane', requestId: 'redline', props: PANE_PROPS })
    for (const key of ['spend-total', 'spend-prompt', 'spend-reading', 'busiest-1']) {
      const t = (await ui.find({ key }))?.text ?? ''
      expect(t, key).toMatch(/≈\$/)
      expect(t, key).not.toMatch(/[^≈]\$/)
    }
    expect(await ui.find({ key: 'model-claude-opus-5-5' })).toBeUndefined() // one model answered: a row at 100% says nothing
    await ui.unmount()
    expect(await runCommand($, '')).toEqual({})
    const over = await $.ui.mount({ plugin: 'redline', surface: 'terminal', component: 'Pane', requestId: 'redline', props: PANE_PROPS })
    expect((await over.find({ key: 'state' }))?.text).toBe('Within limits')
    expect((await over.find({ key: 'view' }))?.text).toBe('Spending')
    await over.unmount()
  })
})

describe('the band reads at a glance', () => {
  const LIMITS: SessionRateLimit[] = [
    // Opened 2h ago, 80% used, resets in 3h: dry in 30 minutes, before the reset.
    { kind: 'five_hour', percentUsed: 80, resetsAt: new Date(T0 + 180 * MIN).toISOString() },
    // Opened 2 days ago, 12% used: resets first.
    { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(T0 + 5 * 24 * 60 * MIN).toISOString() },
  ]

  test('each figure wears its own colour: a window set to run dry is amber, a calm one plain, the dollars dim on a plan', async ($, on) => {
    world(on, { rateLimits: LIMITS })
    await request($, pct(30))
    await runCommand($, 'band')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: BAND_PROPS })
      const texts = await ui.findAll({ type: 'Text' })
      const propsOf = (text: string) => texts.find(t => t.text === text)?.props ?? {}
      // The context is calm: its readout plain, its bar in success.
      expect(propsOf(' 30%').color, surface).toBeUndefined()
      // The 5-hour window runs dry first: the readout, the word and the clause in warning, bound with a comma.
      expect(propsOf(' 80%').color, surface).toBe('warning')
      expect(propsOf(' AMBER'), surface).toMatchObject({ color: 'warning', bold: true })
      expect(propsOf(', out in ≈30m').color, surface).toBe('warning')
      // The weekly resets first: plain, no word, no clause.
      expect(propsOf(' 12%').color, surface).toBeUndefined()
      if (surface === 'terminal') {
        // Each bar in its own level's colour (the desktop's cells are checked by the glyph tests).
        expect(propsOf('███░░░░░░░').color).toBe('success')
        expect(propsOf('████░').color).toBe('warning')
        expect(propsOf('█░░░░').color).toBe('success')
      }
      // The dollars are a footnote on a plan.
      expect(propsOf('≈$1.25').dimColor, surface).toBe(true)
      const gauge = (await ui.find({ key: 'gauge' }))?.text ?? ''
      expect(gauge, surface).toContain('AMBER, out in ≈30m')
      expect(gauge, surface).toContain('week')
      expect(gauge, surface).not.toContain('7d')
      expect(gauge, surface).not.toContain('ctx')
      await ui.unmount()
    }
  })

  test('narrower than 80 columns the windows read in words and the context bar halves', async ($, on) => {
    world(on, { rateLimits: LIMITS })
    await request($, pct(30))
    await runCommand($, 'band')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: 60 } })
      const gauge = (await ui.find({ key: 'gauge' }))?.text ?? ''
      expect(gauge, surface).toContain('80% used AMBER, out in ≈30m')
      expect(gauge, surface).toContain('week 12% used')
      expect(barOf(await ui.findAll({ type: 'Text' })), surface).toBe('██░░░')
      await ui.unmount()
    }
  })

  test('with an API key the dollars lead after the context, drawn plain; idle, the rate goes', async ($, on) => {
    const w = world(on)
    await request($, pct(30))
    await runCommand($, 'band')
    expect(w.status()).toMatch(/^context ███░░░░░░░ 30% · ≈\$1\.25 · [\d.]+k? tokens\/min$/)
    await w.clock.advance(11 * MIN)
    expect(w.status()).toBe('context ███░░░░░░░ 30% · ≈$1.25')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'redline', surface, component: 'AbovePrompt', props: BAND_PROPS })
      const texts = await ui.findAll({ type: 'Text' })
      expect(texts.find(t => t.text === '≈$1.25')?.props.dimColor, surface).toBeUndefined()
      expect((await ui.find({ key: 'gauge' }))?.text, surface).not.toContain('tokens/min')
      await ui.unmount()
    }
  })
})
