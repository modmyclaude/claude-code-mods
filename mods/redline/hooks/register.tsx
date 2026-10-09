// redline: one glanceable gauge for how close the session is to its limits.
//
// Where the figures come from (all read from Claude Code, nothing guessed):
// - each model request (`turn.step`): its four token counts and model, so the
//   gauge moves on every request, not on a timer;
// - `$.session.usage()` and the `session.measure` event: the context fill
//   (`context.tokens` and `context.percent`, the status line's own figures),
//   the model's window (`context.window`, so redline keeps no window table),
//   the session cost (`cost.usd`, what /cost shows), and the plan's 5-hour
//   and weekly windows (`rateLimits`: kind, percentUsed, resetsAt);
// - `turn.start` for each turn's prompt (the busiest-turns list),
//   `session.compact` and a /clear (`session.end`) to start the gauge over.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMeasureInput, ThemeKey, Timer } from 'claude-code'

import { detailLines, detailText } from './detail'
import type { Tone } from './detail'
import { bar, clean, EMPTY_GAUGE, gaugeLine, gaugeParts, levelWord, percentOf, RED_AT, reduce, SPAN_MS, TOAST_TEXT } from './gauge'
import type { Level, Reading } from './gauge'
import type { RedlineGauge } from '../types'

const PANE = 'redline'
const BAND_STORE_KEY = 'isBandOn'
const gauge = atom({ plugin: 'redline', key: 'gauge' } as const, EMPTY_GAUGE)
const isBandOn = atom({ plugin: 'redline', key: 'isBandOn' } as const, false)

const LEVEL_COLOR: Record<Level, ThemeKey> = { unknown: 'inactive', normal: 'success', amber: 'warning', red: 'error' }

/** What `$.session.usage()` and `session.measure` share, as a reading. */
const fromUsage = (u: Pick<SessionMeasureInput, 'context' | 'rateLimits' | 'cost'>) => ({
  window: u.context.window,
  ledgerUsd: u.cost?.usd,
  limits: u.rateLimits,
})

/**
 * Folds one reading into the gauge (one write per dispatch), then repaints
 * the status line and raises the 80% toast when this write crossed it.
 */
/** One repaint after the 10-minute window passes with no reading (see apply). */
let idleRepaint: Timer | undefined
/** One repaint just after the earliest plan window resets (see apply). */
let resetRepaint: Timer | undefined

async function apply($: EngineInterface, reading: Reading): Promise<void> {
  let fire = false
  // `update` may run the change again on a version miss; the last run is the
  // one written, so `fire` ends up describing the value that was stored.
  const g = await update($, gauge, current => {
    const next = reduce(current, reading)
    fire = next.fire
    return next.gauge
  })
  $.ui.status(gaugeLine(g, reading.now))
  if (fire) $.ui.toast(TOAST_TEXT(percentOf(g) ?? RED_AT), { timeoutMs: 10_000 })
  // The status line is a fixed string and the band and pane cache their
  // drawing: two moments must repaint them with no reading at all. Once the
  // session sits idle past the 10-minute window (pace and rate read idle),
  // and just after the earliest plan window resets (a spent window means no
  // replies, so nothing else would). One shot each, re-armed by every reading:
  // nothing ticks while nothing happens.
  idleRepaint?.cancel()
  idleRepaint = $.clock.after(SPAN_MS + 1000, () => repaint($))
  armReset($, g, reading.now)
}

/** Paints every view again with no reading, then waits for the next reset. */
function repaint($: EngineInterface): void {
  void safely($, 'repaint', async () => {
    const g = await read($, gauge)
    const now = await $.clock.now()
    $.ui.status(gaugeLine(g, now))
    $.ui.invalidate('ui.render')
    // Each reset re-arms for the next one: the weekly after the 5-hour.
    armReset($, g, now)
  })
}

/** One repaint just after the earliest plan window still to reset. */
function armReset($: EngineInterface, g: RedlineGauge, now: number): void {
  resetRepaint?.cancel()
  const nextReset = Math.min(...g.limits.map(l => Date.parse(l.resetsAt ?? '')).filter(t => t > now))
  // Held to what a timer holds (2147483647 ms, ~24.8 days): a far reset (a
  // monthly spend limit) then re-arms once on the way, never in a loop.
  resetRepaint = Number.isFinite(nextReset)
    ? $.clock.after(Math.min(nextReset - now + 1000, 2_147_483_647), () => repaint($))
    : undefined
}

/** Runs gauge work so a failure is logged and never stands in a turn's way. */
async function safely($: EngineInterface, what: string, work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (err) {
    $.ui.log(`redline: ${what} failed: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
  }
}

async function setBand($: EngineInterface, value: (was: boolean) => boolean): Promise<boolean> {
  const now = await update($, isBandOn, value)
  // Remembered across sessions: the band is for people who keep it on.
  await $.store.set(BAND_STORE_KEY, now).catch(() => undefined)
  return now
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'redline',
      description: 'Context, tokens, cost, pace and plan limits in detail; "/redline band" toggles the gauge above the prompt',
      argumentHint: '[band]',
      // Checking the gauge mid-turn is the point: run at once, never queued
      // behind the turn. The hook reads only the gauge, never turn state.
      immediate: true,
    })
    await safely($, 'start', async () => {
      const stored = await $.store.get(BAND_STORE_KEY)
      await update($, isBandOn, () => stored === true)
      const usage = await $.session.usage()
      await apply($, {
        now: await $.clock.now(),
        sessionStartedAt: usage.startedAt,
        contextTokens: usage.context.tokens ?? null,
        contextPercent: usage.context.percent,
        ...fromUsage(usage),
      })
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    await safely($, 'turn start', async () => {
      await apply($, { now: await $.clock.now(), turnStart: { turnId: e.turnId, text: e.text } })
    })
    return started
  })

  // Every model request, main loop and subagents: the gauge's heartbeat.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    const usage = response.usage
    if (usage) {
      await safely($, 'request', async () => {
        const totals = await $.session.usage().catch(() => undefined)
        await apply($, {
          now: await $.clock.now(),
          ...(totals ? { sessionStartedAt: totals.startedAt, ...fromUsage(totals) } : {}),
          // Claude Code's percentage, taken only once it counts this request.
          ...(totals && e.agentId === undefined
            ? { contextTokens: totals.context.tokens, contextPercent: totals.context.percent }
            : {}),
          request: { turnId: e.turnId, agentId: e.agentId, usage },
        })
      })
    }
    return response
  })

  // After each turn, and whenever a plan window moves a whole point.
  on('session.measure', async ($, e, next) => {
    await safely($, 'measure', async () => {
      await apply($, {
        now: await $.clock.now(),
        // No count (just compacted, until the next reply): keep what we hold.
        ...(e.context.tokens === undefined ? {} : { contextTokens: e.context.tokens, contextPercent: e.context.percent }),
        ...fromUsage(e),
      })
    })
    return next(e)
  })

  // A compaction shrinks the context at once: show it (and re-arm the toast)
  // without waiting for the next reply. Observes only, so its catch replays.
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && compacted.messages) {
      await safely($, 'compact', async () => {
        await apply($, { now: await $.clock.now(), contextTokens: compacted.tokensAfter ?? null })
      })
    }
    return compacted
  }).catch(($, e, next) => next(e))

  // A /clear or an in-session /resume swaps the conversation: start the gauge
  // over with it (no session.start follows either). The window and the plan
  // windows belong to the model and account, so they stay.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await safely($, 'clear', async () => {
        const now = await $.clock.now()
        const g = await update($, gauge, was => ({
          ...EMPTY_GAUGE,
          window: was.window,
          limits: was.limits,
          limitHistory: was.limitHistory,
          sessionStartedAt: now,
          trackingSince: now,
        }))
        $.ui.status(gaugeLine(g, now))
      })
    }
    return next(e)
  })

  // A command's text is read by the model, so redline answers {} and speaks
  // through toasts and its pane; text only where nothing can draw the pane.
  on('command.run', { command: 'redline' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'band') {
      const isOn = await setBand($, was => !was)
      $.ui.toast(isOn ? 'Band is on, above the prompt. /redline band hides it.' : 'Band is off. /redline band shows it.')
      return {}
    }
    if (arg !== '') {
      $.ui.toast('/redline opens the detail view; /redline band toggles the gauge above the prompt.')
      return {}
    }
    const opened = await $.ui.open({ id: PANE, title: 'Redline', closeOnEscape: true })
    if (opened.isPlaced) return {}
    // Nothing places the pane here: print the same view as the command's text.
    return { text: detailText(await read($, gauge), await $.clock.now()) }
  }).catch($ => {
    $.ui.toast('Could not open its detail view (run with --debug for the reason).')
    return {}
  })

  // The band above the prompt: the status line's gauge, in colour, drawn with
  // whatever other mods draw there (never in their place), after theirs, so a
  // long gauge never pushes another mod's buttons out of view.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isBandOn))) return next(e)
    const g = await read($, gauge)
    const p = gaugeParts(g, await $.clock.now())
    const { Box, Text, Button } = $.ui.resolve(e)
    const cells = e.props.bodyColumns >= 80 ? 10 : 5
    const word = levelWord(p.level)
    // The plan windows' kinds are the engine's strings: cleaned before drawing.
    const rest = clean([p.cost, p.rate, p.pace, ...p.limits].filter(Boolean).join(' · '))
    // What the other mods (and the engine) draw in the band comes first.
    const below = await next(e).catch(() => null)
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" gap={1}>
          <Box key="gauge" flexShrink={1}>
            <Text wrap="truncate-end">
              <Text bold>redline</Text> {p.context}{' '}
              <Text color={LEVEL_COLOR[p.level]}>{p.percent === undefined ? '' : bar(p.percent, cells)}</Text>
              {word ? <Text color={LEVEL_COLOR[p.level]} bold>{` ${word}`}</Text> : null}
              <Text dimColor>{` · ${rest}`}</Text>
            </Text>
          </Box>
          <Button key="hide" label="Hide" dimColor onPress={() => setBand($, () => false)} />
        </Box>
      </Box>
    )
  })

  // The /redline detail view.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const g = await read($, gauge)
    const band = await read($, isBandOn)
    const now = await $.clock.now()
    const { Box, Text, Button } = $.ui.resolve(e)
    const lines = detailLines(g, now, e.props.bodyColumns >= 70 ? 20 : 10)
    const toneProps = (tone: Tone) =>
      tone === 'title' ? { bold: true } : tone === 'dim' ? { dimColor: true } : tone === 'plain' ? {} : { color: LEVEL_COLOR[tone] }
    return (
      <Box flexDirection="column">
        {lines.map(line => (
          <Box key={line.key}>
            <Text {...toneProps(line.tone)}>{line.text}</Text>
          </Box>
        ))}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Button key="band" label={band ? 'Hide band' : 'Show band'} onPress={() => setBand($, was => !was)} />
          <Button key="close" label="Close" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
