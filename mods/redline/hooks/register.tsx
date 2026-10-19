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
// - `turn.start` for each turn's prompt (the costliest-turns list),
//   `session.compact` and a /clear (`session.end`) to start the gauge over.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMeasureInput, ThemeKey, Timer } from 'claude-code'

import type { BoxProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

import { boltSprite } from './bolt-draw'
import { glyphRow } from './cells'
import { boltPose, detailChunks, detailLines, FIGURE_CELLS, labelCells } from './detail'
import type { DetailLine, Tone } from './detail'
import { EMPTY_GAUGE, FULL_CELLS, gaugeLine, gaugeParts, levelWord, NARROW_CELLS, percentOf, RED_AT, reduce, SPAN_MS, TOAST_TEXT } from './gauge'
import { kindsCarried } from './spend'
import type { Figure, Level, Reading } from './gauge'
import type { RedlineGauge, RedlineView } from '../types'

const PANE = 'redline'
/** From this width the pane's bar rows and buttons get 2-cell gaps, and Bolt stands beside a head that holds bars. */
const WIDE_COLUMNS = 60
/** From this width Bolt stands beside a head of words alone (the empty states). */
const BOLT_WORDS_COLUMNS = 40
const BAND_STORE_KEY = 'isBandOn'
const gauge = atom({ plugin: 'redline', key: 'gauge' } as const, EMPTY_GAUGE)
const isBandOn = atom({ plugin: 'redline', key: 'isBandOn' } as const, false)
/** Which view the pane shows; this session's only. `/redline` opens the overview, `/redline spend` and the Spending button the other. */
const paneView = atom({ plugin: 'redline', key: 'view' } as const, 'overview' as RedlineView)
/** The tools the main loop's last response called, per turn: what its next request carries. Cleared at each turn's start. */
const carried = new Map<string, string[]>()
/** One more per pane drawing: the desktop remounts a Button whose wrapper's key changed, so its press stays live after a redraw. */
let drawing = 0

const LEVEL_COLOR: Record<Level, ThemeKey> = { unknown: 'inactive', normal: 'success', amber: 'warning', red: 'error' }

type Elements = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

/**
 * One figure of the band as coloured spans: its bar in the level's colour, the
 * readout and the level word coloured once the level is amber or red (plain
 * or dim otherwise), its clause bound with a comma. The bar is drawn apart on
 * the desktop (glyphs change a Text's font there), inline on the terminal.
 */
function figureSpans({ Box, Text }: Elements, surface: string, f: Figure): RenderElement[] {
  const isHot = f.level === 'amber' || f.level === 'red'
  const color = LEVEL_COLOR[f.level]
  const word = f.value === 'OUT' ? '' : levelWord(f.level)
  const words: TextProps = isHot ? { color } : f.isDim ? { dimColor: true } : {}
  // The readout carries the space after a bar, so the bar's Text holds glyphs alone.
  const readout = (
    <Text {...words} {...(f.value === 'OUT' ? { bold: true } : {})}>
      {`${f.bar === undefined ? '' : ' '}${f.value}`}
    </Text>
  )
  const tail = [
    word ? <Text color={color} bold>{` ${word}`}</Text> : null,
    f.clause ? <Text {...(isHot ? { color } : { dimColor: true })}>{`, ${f.clause}`}</Text> : null,
  ]
  const label = f.label ? <Text {...words}>{`${f.label} `}</Text> : null
  const bar = f.bar === undefined ? null : surface === 'desktop' ? glyphRow({ Box, Text }, surface, f.bar, { color }) : <Text color={color}>{f.bar}</Text>
  return [label, bar, readout, ...tail].filter((s): s is RenderElement => s !== null)
}

/**
 * The pane's colour for a tone: amber and red by level, dim parts in subtle, a
 * calm part in `calm` (the hero and the bars in success, a clause in subtle, a
 * figure in the default text), and a spend row's parts in the default text.
 */
type Paint = Pick<TextProps, 'color'>
function paintOf(tone: Tone, calm: ThemeKey | undefined): Paint {
  if (tone === 'amber') return { color: 'warning' }
  if (tone === 'red') return { color: 'error' }
  if (tone === 'dim' || tone === 'unknown') return { color: 'subtle' }
  return tone === 'normal' && calm !== undefined ? { color: calm } : {}
}
const heroPaint = (tone: Tone): Paint => paintOf(tone, 'success')
const barPaint = (tone: Tone): Paint => paintOf(tone, 'success')
const figurePaint = (tone: Tone): Paint => paintOf(tone, undefined)
const clausePaint = (tone: Tone): Paint => paintOf(tone, 'subtle')

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
      description: 'Context, plan limits and cost in detail; "/redline spend" for where the money went, "/redline band" for the gauge above the prompt',
      argumentHint: '[spend|band]',
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
    carried.clear() // an aborted turn leaves nothing behind
    await safely($, 'turn start', async () => {
      await apply($, { now: await $.clock.now(), turnStart: { turnId: e.turnId, text: e.text } })
    })
    return started
  })

  // Every model request, main loop and subagents: the gauge's heartbeat.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    const usage = response.usage
    // What this request carried: the results of the previous response's tool calls in this loop.
    const loop = `${e.agentId ?? 'main'}:${e.turnId}`
    const kinds = kindsCarried(e.index, e.agentId, carried.get(loop) ?? [])
    // Kept for the main loop only: a subagent's requests are one kind whatever they carry.
    const tools = e.agentId === undefined ? (response.toolUses ?? []).map(use => use.name) : []
    if (tools.length > 0) carried.set(loop, tools)
    else carried.delete(loop)
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
          request: { turnId: e.turnId, agentId: e.agentId, usage, kinds },
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
  // through toasts and its pane; where nothing can draw the pane, the view goes
  // to the transcript as dim rows of its own, which the model never reads.
  on('command.run', { command: 'redline' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'band') {
      const isOn = await setBand($, was => !was)
      $.ui.toast(isOn ? 'Band is on, above the prompt. /redline band hides it.' : 'Band is off. /redline band shows it.')
      return {}
    }
    if (arg !== '' && arg !== 'spend') {
      $.ui.toast('Use /redline, /redline spend or /redline band.')
      return {}
    }
    const view: RedlineView = arg === 'spend' ? 'spend' : 'overview'
    await update($, paneView, () => view)
    // Tall enough inline for either view at 40 columns without scrolling; the dock ignores it.
    const opened = await $.ui.open({ id: PANE, title: 'Redline', closeOnEscape: true, rows: 18 })
    if (opened.isPlaced) return {}
    // Nothing places the pane here: the same view as transcript rows, never as command text.
    for (const chunk of detailChunks(await read($, gauge), await $.clock.now(), view)) $.ui.log(chunk)
    return {}
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
    // Narrower than 80 columns the context bar halves and the plan windows read in words.
    const p = gaugeParts(g, await $.clock.now(), e.props.bodyColumns >= 80 ? FULL_CELLS : NARROW_CELLS)
    const { Box, Text, Button } = $.ui.resolve(e)
    // Each figure in its own colour, ` · ` between them; the figures are already cleaned.
    const spans: RenderElement[] = []
    p.figures.forEach((f, i) => {
      if (i > 0) spans.push(<Text dimColor>{' · '}</Text>)
      spans.push(...figureSpans({ Box, Text }, e.surface, f))
    })
    // What the other mods (and the engine) draw in the band comes first.
    const below = await next(e).catch(() => null)
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" gap={1}>
          {e.surface === 'desktop' ? (
            // The desktop draws a Text with block characters in the code font, words and all:
            // each bar sits in its own one-cell glyphs between the words, and the line's tail truncates.
            <Box key="gauge" flexDirection="row" flexShrink={1}>
              <Text>
                <Text bold>redline</Text>{' '}
              </Text>
              {spans.slice(0, -1)}
              <Text wrap="truncate-end">{spans[spans.length - 1]}</Text>
            </Box>
          ) : (
            <Box key="gauge" flexShrink={1}>
              <Text wrap="truncate-end">
                <Text bold>redline</Text>{' '}
                {spans}
              </Text>
            </Box>
          )}
          <Button key="hide" label="Hide" dimColor onPress={() => setBand($, () => false)} />
        </Box>
      </Box>
    )
  })

  // The /redline pane: one of its two views, laid out after brand/UI-STANDARD.md.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const g = await read($, gauge)
    const band = await read($, isBandOn)
    const view = await read($, paneView)
    const now = await $.clock.now()
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const lines = detailLines(g, now, view)
    const labelWidth = labelCells(lines)
    const wide = e.props.bodyColumns >= WIDE_COLUMNS
    const gap = wide ? 2 : 1
    const head = lines.filter(l => l.head)
    const body = lines.filter(l => !l.head && !l.textOnly)
    // Bolt stands beside the head from 60 columns when it holds bars (their clauses need the room), from 40 when it holds words alone.
    const boltMin = head.some(l => l.kind === 'bar') ? WIDE_COLUMNS : BOLT_WORDS_COLUMNS
    drawing += 1
    const press = (name: string): { key?: string } => (e.surface === 'desktop' ? { key: `press-${name}-${drawing}` } : {})
    const top = (l: DetailLine): { marginTop?: number } => (l.gap ? { marginTop: 1 } : {})
    // Each line by its kind: the hero bold in its colour; a bar row as a label column, the glyphs apart
    // from the words, right-aligned figure columns and clauses that wrap whole; a label and value row
    // with the value pushed to the right edge; lines and the footnote in subtle. The engine draws the
    // pane's title bar, so the title line is left to the text view, as are the links (buttons here).
    const draw = (line: DetailLine): RenderElement | null => {
      if (line.textOnly) return null
      switch (line.kind) {
        case 'title':
          return (
            <Box key={line.key} {...top(line)}>
              <Text bold>{line.value ?? ''}</Text>
            </Box>
          )
        case 'hero':
          return (
            <Box key={line.key}>
              <Text bold wrap="wrap" {...heroPaint(line.tone)}>
                {line.value ?? ''}
              </Text>
            </Box>
          )
        case 'bar': {
          const clauses = line.clauses ?? []
          return (
            <Box key={line.key} flexDirection="row" columnGap={gap} {...top(line)}>
              <Box key="label" width={labelWidth} flexShrink={0}>
                <Text color="subtle" wrap="wrap">
                  {line.label ?? ''}
                </Text>
              </Box>
              {/* The bar never shrinks: on the terminal a bare Text would be squeezed before the clauses wrap. */}
              <Box key="bar" flexShrink={0}>
                {glyphRow(elements, e.surface, line.bar ?? '', barPaint(line.tone))}
              </Box>
              {(line.figures ?? []).map((f, i) => (
                <Box key={`figure-${i}`} width={FIGURE_CELLS[view][i] ?? 4} flexShrink={0} justifyContent="flex-end">
                  <Text {...figurePaint(line.tone)} {...(f === 'OUT' ? { bold: true } : {})}>
                    {f}
                  </Text>
                </Box>
              ))}
              {clauses.length > 0 ? (
                <Box key="when" flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={0} flexShrink={1}>
                  {clauses.map((c, i) => (
                    <Text key={`clause-${i}`} {...clausePaint(line.tone)}>
                      {i < clauses.length - 1 ? `${c},` : c}
                    </Text>
                  ))}
                </Box>
              ) : null}
            </Box>
          )
        }
        case 'row':
          return (
            <Box key={line.key} flexDirection="row" gap={1} {...top(line)}>
              <Box key="label" flexGrow={1} flexShrink={1}>
                <Text color="subtle" wrap="wrap">
                  {line.label ?? ''}
                </Text>
              </Box>
              <Box key="value" flexShrink={0} justifyContent="flex-end">
                <Text {...figurePaint(line.tone)}>{line.value ?? ''}</Text>
              </Box>
            </Box>
          )
        default:
          return (
            <Box key={line.key} {...top(line)}>
              <Text wrap="wrap" color="subtle">
                {line.value ?? ''}
              </Text>
            </Box>
          )
      }
    }
    return (
      <Box flexDirection="column">
        {e.props.bodyColumns >= boltMin ? (
          <Box key="head" flexDirection="row" columnGap={2}>
            <Box key="bolt-cell" flexShrink={0}>
              {boltSprite(elements, e.surface, { size: 'small', pose: boltPose(g, now, view) })}
            </Box>
            <Box key="head-lines" flexDirection="column" flexShrink={1}>
              {head.map(draw)}
            </Box>
          </Box>
        ) : (
          head.map(draw)
        )}
        {body.map(draw)}
        <Box key="actions" flexDirection="row" flexWrap="wrap" columnGap={gap} rowGap={0} marginTop={1}>
          <Box {...press('view')}>
            <Button key="view" label={view === 'overview' ? 'Spending' : 'Back'} onPress={() => update($, paneView, v => (v === 'overview' ? 'spend' : 'overview'))} />
          </Box>
          <Box {...press('band')}>
            <Button key="band" label={band ? 'Hide band' : 'Show band'} onPress={() => setBand($, was => !was)} />
          </Box>
          <Box {...press('close')}>
            <Button key="close" label="Close" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
          </Box>
        </Box>
      </Box>
    )
  })
}
