// The mission control pane: the overview header, the command grid of cards,
// the inspector of the selected subagent, the finished list and the activity
// timeline. Every value drawn comes from the farm's state and what the loop
// events said; nothing is guessed. Words are drawn in Text, glyph art in
// glyph rows (one code-font cell per character on the desktop). Every row is
// sized in cells so nothing wraps: a part too long for its room is cut at
// its end, never folded onto a line of its own.

import type { BoxProps, ButtonProps, ElementConstructor, RasterProps, RenderElement, TextProps } from 'claude-code'

import type { AntFarmAnt, AntFarmEvent, AntFarmUsage, AntFarmView } from '../types'
import { boltSprite } from './bolt-draw'
import type { BoltSmallPose } from './bolt'
import { glyphRow, paintedRow } from './cells'
import {
  activityText, COMPACT_BELOW, eventLook, FRESH_MS, gridOf, heatGlyph, heatGrid, hotkeyOf, met, ordered, pulse, rowsOf, SETTLE_MS,
  sparkline, spinner, statusLook, TIMELINE_ROWS, TIMELINE_ROWS_EXPANDED,
} from './mission'
import type { LivePhase } from './mission'
import {
  ANT_WIDTH, antRows, bar, clean, fmtCost, fmtDuration, fmtEta, fmtTokens, fmtUsd, miniAnt, MINI_WIDTH, phaseOf, progressOf, shortModel,
} from './show'
import type { Spend } from './show'

export type Elements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Raster?: ElementConstructor<RasterProps>
}

/** Everything the pane is drawn from, read by the hook and handed here. */
export type ControlInput = {
  ui: Elements
  surface: string
  /** The body's cells across, inside the frame. */
  columns: number
  /** The pane holds the keyboard: hotkeys work and a key hint shows. */
  isFocused: boolean
  now: number
  /** The animation frame: one every TICK_MS. */
  frame: number
  list: readonly AntFarmAnt[]
  events: readonly AntFarmEvent[]
  view: AntFarmView
  live: ReadonlyMap<string, LivePhase>
  /** One colour per model. */
  colors: ReadonlyMap<string, string>
  spend: Spend
  budgetUsd: number
  level: 0 | 1 | 2
  /** The subagents' own tally (price table). */
  subagents: AntFarmUsage
  on: {
    select: (id: string | undefined) => void
    move: (by: 1 | -1) => void
    toggleFinished: () => void
    toggleTimeline: () => void
    growTimeline: () => void
  }
}

/** Narrower than this, Bolt steps out; from BOLT_SMALL_COLUMNS the small sprite keeps the header. */
export const BOLT_MIN_COLUMNS = 40
export const BOLT_SMALL_COLUMNS = 56
/** The finished subagents the pane lists one by one; the rest are counted. */
export const MAX_FINISHED_SHOWN = 50
/** A card this wide inside its border gives the ant three cells of walk and the sparkline twelve. */
export const WIDE_CARD = 44
/** A card this wide inside its border also counts its tools, edits and errors on the bottom row. */
export const COUNTS_CARD = 50
const SPARK_CELLS = 12
const SPARK_MIN = 6
const BAR_CELLS = 12
const BUDGET_BAR_CELLS = 20
/** Cells the `open` button and its gap take at the end of a row (`9: open`). */
const OPEN_CELLS = 8
/** A finished line names its model from this pane width; narrower, the ant's colour says it. */
export /** From this many columns the header holds the heat strip beside the hero column. */
const HEAT_MIN_COLUMNS = 84
const LINE_MODEL_COLUMNS = 100

const isRunning = (a: AntFarmAnt) => a.status === 'running'
const taskOf = (a: AntFarmAnt) => clean(a.task)
const modelOf = (a: AntFarmAnt) => clean(shortModel(a.model) || a.type)
const numberOf = (a: AntFarmAnt | undefined) => (a?.n !== undefined ? `#${a.n}` : '·')

/** The state the header speaks for: its words, colour and Bolt's pose. */
export function headline(list: readonly AntFarmAnt[], live: ReadonlyMap<string, LivePhase>): { text: string; color: string; pose: BoltSmallPose } {
  const { running, finished } = ordered(list)
  const waiting = running.filter(a => live.get(a.id)?.phase === 'waiting').length
  const failed = finished.filter(a => a.status === 'failed').length
  if (list.length === 0) return { text: 'Standing by', color: 'subtle', pose: 'sleep' }
  if (waiting > 0) return { text: `Waiting · ${waiting} held`, color: 'warning', pose: 'think' }
  if (running.length > 0) return { text: `Working · ${running.length} running`, color: 'success', pose: 'think' }
  if (failed > 0) return { text: `${failed} failed · ${finished.length - failed} done`, color: 'error', pose: 'sweat' }
  return { text: `All done · ${finished.length} ${finished.length === 1 ? 'agent' : 'agents'}`, color: 'success', pose: 'cheer' }
}

/**
 * The status line of a card or the inspector: the mark, the word and what
 * follows it (`◐ WORKING · Bash npm test · 4s`, `◇ WAITING · permission for
 * Bash`, `✓ DONE · 1m 20s`). The mark turns while the subagent works.
 */
export function stateLine(a: AntFarmAnt, live: LivePhase | undefined, now: number, frame: number): { text: string; color: string } {
  const look = statusLook(a.status, live?.phase)
  if (!isRunning(a)) return { text: `${look.glyph} ${look.word} · ${fmtDuration((a.endedAt ?? now) - a.startedAt)}`, color: look.color }
  const glyph = look.word === 'WAITING' ? look.glyph : spinner(frame)
  const rest = clean(activityText(live, now))
  return { text: `${glyph} ${look.word}${rest !== '' ? ` · ${rest}` : ''}`, color: look.color }
}

export function drawControl(c: ControlInput): RenderElement {
  const { Box, Text, Button } = c.ui
  const { running, finished } = ordered(c.list)
  const failed = finished.filter(a => a.status === 'failed').length
  const waiting = running.filter(a => c.live.get(a.id)?.phase === 'waiting').length
  const compact = c.columns < COMPACT_BELOW
  // The desktop draws words in a proportional font and clips a row at the pane's
  // edge instead of cutting it with an ellipsis, so a narrow desktop pane wraps
  // its lines; the terminal, where cells are exact, cuts them at the end.
  const cut: TextProps['wrap'] = c.surface === 'desktop' && compact ? 'wrap' : 'truncate-end'
  // Every Button is plain: the terminal draws `1: open` with the key hint in the accent
  // colour, and a desktop draws its native button either way.
  const plain = { plain: true as const }
  // The desktop app keeps the press handle a Button was mounted with, and the engine hands
  // out new handles on every drawing: a Button that never remounts there is dead after the
  // first redraw. A wrapper keyed by the frame remounts it on every drawing.
  const remount = (name: string) => (c.surface === 'desktop' ? { key: `press-${name}-${c.frame}` } : {})
  const firstStart = c.list.length > 0 ? Math.min(...c.list.map(a => a.startedAt)) : c.now
  const lastEnd = running.length > 0 ? c.now : Math.max(firstStart, ...finished.map(a => a.endedAt ?? a.startedAt))
  const selected = c.view.selectedId !== undefined ? c.list.find(a => a.id === c.view.selectedId) : undefined
  const { cols, cardWidth } = gridOf(c.columns)
  const byId = new Map(c.list.map(a => [a.id, a] as const))

  const antPaint = (a: AntFarmAnt): TextProps => {
    if (a.status === 'failed') return { color: 'error' }
    if (isRunning(a)) return { color: c.colors.get(a.model) ?? 'subtle' }
    if (a.endedAt !== undefined && c.now - a.endedAt < SETTLE_MS) return { color: 'success' }
    return { color: 'subtle', dimColor: true }
  }

  // The button that opens a subagent in the inspector, keyed by its mission number.
  const openButton = (a: AntFarmAnt, isSelected: boolean) => {
    const hotkey = hotkeyOf(a.n)
    return (
      <Button
        key={`inspect-${a.id}`}
        {...plain}
        {...(hotkey !== undefined ? { hotkey } : {})}
        dimColor={!isRunning(a) && !isSelected}
        label={isSelected ? 'close' : 'open'}
        onPress={() => c.on.select(isSelected ? undefined : a.id)}
      />
    )
  }

  // ---------------------------------------------------------------- a card

  const card = (a: AntFarmAnt): RenderElement => {
    const live = c.live.get(a.id)
    const isSelected = selected?.id === a.id
    const justFinished = !isRunning(a) && a.endedAt !== undefined && c.now - a.endedAt < SETTLE_MS
    const border = isSelected ? 'suggestion' : a.status === 'failed' ? 'error' : justFinished ? 'success' : isRunning(a) ? c.colors.get(a.model) ?? 'subtle' : 'subtle'
    const rested = !isRunning(a) && !justFinished && !isSelected
    const tone: TextProps = a.status === 'failed' ? { color: 'error' } : { dimColor: !isRunning(a) }
    const p = progressOf(a, c.list, c.now)
    // Held on the person, a subagent makes no progress: no time left to show.
    const etaMs = live?.phase === 'waiting' ? null : p.etaMs
    // The card's rows in cells: the art lane, one gap, the words beside it.
    const inner = cardWidth - 4
    const lane = ANT_WIDTH + (inner >= WIDE_CARD ? 3 : 2)
    const meta = Math.max(1, inner - lane - 1)
    const spark = Math.min(SPARK_CELLS, Math.max(SPARK_MIN, meta - 16))
    const rows = antRows(a.status, c.frame + phaseOf(a.id), lane)
    const state = stateLine(a, live, c.now, c.frame)
    // The hover card: the full task and the subagent's last rows, drawn over the card's own art
    // rows while the pointer rests on the card. Hidden until then, placed out of the flow so
    // nothing moves, unkeyed so the card's own hover reveals it; the surface shows and hides it
    // without a hook or a redraw. It paints last, over the rows it covers.
    const hoverHeight = Math.max(rows.length, 3) + 1
    const hoverWidth = Math.max(1, cardWidth - 4)
    const title = `${numberOf(a)} ${taskOf(a)}`
    const titleLines = Math.max(1, Math.ceil([...title].length / hoverWidth))
    const recent = c.events.filter(ev => ev.agentId === a.id).slice(-Math.max(0, hoverHeight - titleLines)).reverse()
    const hoverRow = (ev: AntFarmEvent, i: number): RenderElement => {
      const look = eventLook(ev.kind)
      return (
        <Box flexDirection="row" key={`hover-${i}`}>
          <Box width={8} flexShrink={0}><Text color="inverseText">{met(ev.at - firstStart)}</Text></Box>
          <Box width={2} flexShrink={0}><Text color={look.color ?? 'inverseText'}>{look.glyph}</Text></Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text color="inverseText" wrap="truncate-end">{clean(ev.text)}{ev.detail !== undefined ? ` · ${clean(ev.detail)}` : ''}</Text>
          </Box>
        </Box>
      )
    }
    const hoverCard = (
      <Box
        position="absolute"
        top={1}
        left={0}
        right={0}
        height={hoverHeight}
        overflow="hidden"
        display="none"
        hover={{ display: 'flex' }}
        flexDirection="column"
        paddingX={1}
        backgroundColor="text"
      >
        <Text bold color="inverseText" wrap="wrap">{title}</Text>
        {recent.length > 0 ? recent.map(hoverRow) : titleLines < hoverHeight ? <Text color="inverseText" wrap="truncate-end">No activity recorded yet</Text> : null}
      </Box>
    )
    const money = [
      fmtCost(a.usage),
      ...(etaMs !== null ? [fmtEta(etaMs)] : []),
      ...(inner >= COUNTS_CARD && (a.tools ?? 0) > 0 ? [`${a.tools} ${a.tools === 1 ? 'tool' : 'tools'}`] : []),
      ...(inner >= COUNTS_CARD && (a.edits ?? 0) > 0 ? [`${a.edits} ${a.edits === 1 ? 'edit' : 'edits'}`] : []),
      ...(inner >= COUNTS_CARD && (a.errors ?? 0) > 0 ? [`${a.errors} ${a.errors === 1 ? 'error' : 'errors'}`] : []),
    ].join(' · ')
    return (
      <Box
        key={`ant-${a.id}`}
        flexDirection="column"
        width={cardWidth}
        flexShrink={0}
        minWidth={0}
        borderStyle="round"
        borderColor={border}
        borderDimColor={rested}
        paddingX={1}
        hover={{ borderColor: 'suggestion' }}
      >
        <Box flexDirection="row">
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text bold={isRunning(a) || isSelected} dimColor={rested} wrap="truncate-end">{numberOf(a)} {taskOf(a)}</Text>
          </Box>
          <Box flexShrink={0} marginLeft={1}>{openButton(a, isSelected)}</Box>
        </Box>
        <Box flexDirection="row">
          <Box key={`art-${a.id}`} flexDirection="column" width={lane} flexShrink={0}>
            {rows.map(row => glyphRow(c.ui, c.surface, row, antPaint(a)))}
          </Box>
          <Box flexDirection="column" width={meta} flexShrink={0} minWidth={0} marginLeft={1}>
            <Text dimColor wrap="truncate-end">{modelOf(a)} · {fmtDuration((a.endedAt ?? c.now) - a.startedAt)}</Text>
            <Text bold wrap="truncate-end" color={state.color} dimColor={rested}>{state.text}</Text>
            <Box flexDirection="row">
              {glyphRow(c.ui, c.surface, sparkline(a.history ?? [], spark), antPaint(a))}
              <Box marginLeft={1} flexShrink={1} minWidth={0}>
                <Text dimColor wrap="truncate-end">{a.usage.requests} req · {fmtTokens(a.usage.tokens)} tok</Text>
              </Box>
            </Box>
          </Box>
        </Box>
        <Box flexDirection="row">
          {glyphRow(c.ui, c.surface, bar(p.fraction, BAR_CELLS), tone)}
          <Box marginLeft={1} flexGrow={1} flexShrink={1} minWidth={0}>
            <Text wrap="truncate-end" {...tone}>{money}</Text>
          </Box>
        </Box>
        {hoverCard}
      </Box>
    )
  }

  // ---------------------------------------------------------------- a line

  const line = (a: AntFarmAnt): RenderElement => {
    const look = statusLook(a.status, c.live.get(a.id)?.phase)
    const isSelected = selected?.id === a.id
    const paint = antPaint(a)
    // The model name goes first on a narrow pane (the ant carries its colour); the rest stays whole
    // wherever the pane has room for the mini ant, a few cells of task, the numbers, the mark and the button.
    const numbers = `${c.columns >= LINE_MODEL_COLUMNS ? `${modelOf(a)} · ` : ''}${fmtDuration((a.endedAt ?? c.now) - a.startedAt)} · ${fmtTokens(a.usage.tokens)} tok · ${fmtCost(a.usage)}`
    const numbersFit = c.columns >= MINI_WIDTH + 1 + 8 + 3 + [...numbers].length + 3 + OPEN_CELLS
    if (compact) {
      return (
        <Box flexDirection="row" key={`line-${a.id}`}>
          {glyphRow(c.ui, c.surface, miniAnt(a.status, isRunning(a) ? c.frame + phaseOf(a.id) : 0), paint)}
          <Box marginLeft={1} flexGrow={1} flexShrink={1} minWidth={0}>
            <Text dimColor={!isRunning(a)} wrap={cut}>{numberOf(a)} {a.status} · {taskOf(a)} · {numbers}</Text>
          </Box>
        </Box>
      )
    }
    // The task gives way first (it is the longer part); the numbers give way only when
    // the pane is too narrow for them, so no row is ever wider than the pane.
    return (
      <Box flexDirection="row" key={`line-${a.id}`}>
        {glyphRow(c.ui, c.surface, miniAnt(a.status, isRunning(a) ? c.frame + phaseOf(a.id) : 0), paint)}
        <Box marginLeft={1} flexGrow={1} flexShrink={1} minWidth={0}>
          <Text dimColor={!isRunning(a)} wrap="truncate-end">{numberOf(a)} {a.status} · {taskOf(a)}</Text>
        </Box>
        <Box flexShrink={numbersFit ? 0 : 1} minWidth={0}>
          <Text dimColor={!isRunning(a)} wrap="truncate-end"> · {numbers}</Text>
        </Box>
        <Box flexShrink={0} marginLeft={1}><Text color={look.color}>{look.glyph}</Text></Box>
        <Box flexShrink={0} marginLeft={1}>{openButton(a, isSelected)}</Box>
      </Box>
    )
  }

  // ---------------------------------------------------------------- the header

  const head = headline(c.list, c.live)
  const clock = running.length > 0 ? met(c.now - firstStart) : c.list.length > 0 ? `${fmtDuration(lastEnd - firstStart)} wall` : ''
  const source = c.spend.isEngine ? ' (Claude Code)' : ' (price table)'
  const budgetLine =
    c.budgetUsd > 0
      ? `Session ${c.spend.text} of ${fmtUsd(c.budgetUsd)} budget${source}${c.level === 2 ? ' - past 2x' : c.level === 1 ? ' - over' : ''}`
      : `Session ${c.spend.text}${source}`
  const budgetTone: TextProps = c.level === 2 ? { color: 'error' } : c.level === 1 ? { color: 'warning' } : { dimColor: true }
  const budgetFraction = c.budgetUsd > 0 ? Math.min(1, c.spend.usd / c.budgetUsd) : null
  const boltSize = compact || c.columns < BOLT_MIN_COLUMNS ? undefined : c.columns >= BOLT_SMALL_COLUMNS ? 'small' : 'tiny'

  const headColumn = (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
      <Box key="hero" flexDirection="row">
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text bold color={head.color} wrap={cut}>{head.text}</Text>
        </Box>
        {clock !== '' ? <Box flexShrink={0} marginLeft={1}><Text dimColor>{clock}</Text></Box> : null}
      </Box>
      <Box key="counts" flexDirection="row" {...(compact ? { flexWrap: 'wrap' as const } : {})}>
        <Text bold>{running.length - waiting}</Text><Text dimColor> running · </Text>
        <Text bold>{finished.length - failed}</Text><Text dimColor> done · </Text>
        <Text bold {...(failed > 0 ? { color: 'error' } : {})}>{failed}</Text><Text dimColor> failed</Text>
        {waiting > 0 ? <Text color="warning"> · {waiting} waiting</Text> : null}
      </Box>
      <Box key="budget" minWidth={0}>
        <Text wrap={cut} {...budgetTone}>{budgetLine}</Text>
      </Box>
      <Box key="totals" minWidth={0}>
        <Text dimColor wrap={cut}>
          Subagents {fmtCost(c.subagents)} (price table) · {fmtTokens(c.subagents.tokens)} tokens · {fmtDuration(lastEnd - firstStart)} wall
        </Text>
      </Box>
      {budgetFraction !== null ? (
        <Box key="budget-bar" flexDirection="row">
          {glyphRow(c.ui, c.surface, bar(budgetFraction, BUDGET_BAR_CELLS), budgetTone)}
          <Box marginLeft={1} minWidth={0}><Text wrap={cut} {...budgetTone}>{Math.round(budgetFraction * 100)}%</Text></Box>
        </Box>
      ) : (
        <Box key="no-budget" minWidth={0}>
          <Text dimColor wrap={cut}>No budget set - add one in /config</Text>
        </Box>
      )}
    </Box>
  )
  // The heat strip: one column per subagent in mission order, one row per ten seconds of the
  // last minute (oldest on top), each cell shaded by how many rows the subagent put on the
  // timeline in that window, in its own colour; the mission numbers underneath. On a pane wide
  // enough to hold it beside the hero column.
  const heat = !compact && c.columns >= HEAT_MIN_COLUMNS && c.list.length > 0 ? heatGrid(c.list, c.events, c.now) : undefined
  const heatBlock =
    heat !== undefined && heat.ids.length > 0 ? (
      <Box key="heat" flexDirection="column" flexShrink={0} marginLeft={1}>
        <Text dimColor>last 60 s</Text>
        {heat.grid.map(row =>
          paintedRow(c.ui, c.surface, row.map((count, i) => ({ glyph: heatGlyph(count), paint: count === 0 ? { dimColor: true } : antPaint(byId.get(heat.ids[i]!)!) }))),
        )}
        {paintedRow(c.ui, c.surface, heat.ids.map(id => ({ glyph: hotkeyOf(byId.get(id)?.n) ?? '·', paint: { dimColor: true } })))}
      </Box>
    ) : null
  const header =
    boltSize !== undefined && c.list.length > 0 ? (
      <Box key="head" flexDirection="row" gap={1} marginBottom={1}>
        {boltSize === 'small' ? boltSprite(c.ui, c.surface, { size: 'small', pose: head.pose }) : boltSprite(c.ui, c.surface, { size: 'tiny', pose: 'idle' })}
        {headColumn}
        {heatBlock}
      </Box>
    ) : (
      <Box key="head" flexDirection="row" marginBottom={1}>{headColumn}{heatBlock}</Box>
    )

  // ---------------------------------------------------------------- the inspector

  const eventRow = (ev: AntFarmEvent, i: number, withTime: boolean): RenderElement => {
    const look = eventLook(ev.kind)
    const fresh = c.now - ev.at < FRESH_MS && i === 0
    const who = numberOf(ev.agentId !== undefined ? byId.get(ev.agentId) : undefined)
    const words = `${clean(ev.text)}${ev.detail !== undefined ? ` · ${clean(ev.detail)}` : ''}`
    return (
      <Box flexDirection="row" key={`event-${i}`}>
        {withTime ? <Box width={9} flexShrink={0}><Text dimColor>{met(ev.at - firstStart)}</Text></Box> : null}
        <Box width={4} flexShrink={0}><Text dimColor>{who}</Text></Box>
        <Box width={2} flexShrink={0}><Text {...(look.color !== undefined ? { color: look.color } : {})}>{look.glyph}</Text></Box>
        <Box width={8} flexShrink={0}><Text {...(look.color !== undefined ? { color: look.color } : { dimColor: true })}>{look.word}</Text></Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap={cut} bold={fresh} dimColor={ev.kind === 'tool' && !fresh}>{words}</Text>
        </Box>
      </Box>
    )
  }

  const inspector = (a: AntFarmAnt): RenderElement => {
    const live = c.live.get(a.id)
    const look = statusLook(a.status, live?.phase)
    const p = progressOf(a, c.list, c.now)
    const etaMs = live?.phase === 'waiting' ? null : p.etaMs
    const elapsed = fmtDuration((a.endedAt ?? c.now) - a.startedAt)
    const parent = a.parentId !== undefined ? byId.get(a.parentId) : undefined
    const from = a.parentId === undefined ? 'from the main loop' : `from ${parent !== undefined ? `${numberOf(parent)} ${taskOf(parent)}` : 'another agent'}`
    const state = stateLine(a, live, c.now, c.frame)
    const own = c.events.filter(ev => ev.agentId === a.id).slice(-6).reverse()
    const tally = [
      `${a.usage.requests} ${a.usage.requests === 1 ? 'request' : 'requests'}`,
      `${fmtTokens(a.usage.tokens)} tokens`,
      fmtCost(a.usage),
      `${a.tools ?? 0} tools`,
      `${a.edits ?? 0} edits`,
      `${a.errors ?? 0} errors`,
      ...(etaMs !== null ? [fmtEta(etaMs)] : []),
    ].join(' · ')
    return (
      <Box key="inspector" flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1} marginBottom={1} minWidth={0}>
        <Box flexDirection="row">
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text bold wrap={cut}>{numberOf(a)} {taskOf(a)}</Text>
          </Box>
          <Box flexShrink={0} marginLeft={1}>
            <Text bold color={look.color}>{look.glyph} {look.word}</Text>
          </Box>
        </Box>
        <Text dimColor wrap={cut}>{clean(a.type)} · {modelOf(a)} · started {met(a.startedAt - firstStart)} · {elapsed} · {from}</Text>
        <Text bold wrap={cut} color={state.color}>{state.text}</Text>
        <Text dimColor wrap={cut}>{tally}</Text>
        <Box flexDirection="row">
          {glyphRow(c.ui, c.surface, sparkline(a.history ?? [], Math.min(24, Math.max(SPARK_CELLS, c.columns - 24))), antPaint(a))}
          <Box marginLeft={1} minWidth={0}><Text dimColor wrap={cut}>tokens per request</Text></Box>
        </Box>
        {own.length > 0 ? own.map((ev, i) => eventRow(ev, i + 1, !compact)) : <Text dimColor>No activity recorded yet</Text>}
        <Box flexDirection="row" gap={2} marginTop={1}>
          <Box {...remount('prev')}><Button key="inspector-prev" {...plain} hotkey="p" label="previous" onPress={() => c.on.move(-1)} /></Box>
          <Box {...remount('next')}><Button key="inspector-next" {...plain} hotkey="n" label="next" onPress={() => c.on.move(1)} /></Box>
          <Box {...remount('close')}><Button key="inspector-close" {...plain} hotkey="x" label="close" onPress={() => c.on.select(undefined)} /></Box>
          <Box flexGrow={1} />
          <Box flexShrink={1} minWidth={0}><Text dimColor wrap={cut}>id {clean(a.id)}</Text></Box>
        </Box>
      </Box>
    )
  }

  // ---------------------------------------------------------------- the timeline

  const timeline = (): RenderElement | null => {
    if (c.list.length === 0 && c.events.length === 0) return null
    const hidden = c.view.isTimelineHidden === true
    const room = c.view.isTimelineExpanded === true ? TIMELINE_ROWS_EXPANDED : compact ? 6 : TIMELINE_ROWS
    const newest = [...c.events].reverse()
    const shown = hidden ? [] : newest.slice(0, room)
    const left = newest.length - shown.length
    return (
      <Box key="timeline" flexDirection="column" marginTop={1}>
        <Box key="timeline-head" flexDirection="row">
          <Text bold>Activity</Text>
          <Text {...pulse(c.frame)} color={running.length > 0 ? 'success' : 'subtle'}> ●</Text>
          <Text dimColor> {c.events.length} {c.events.length === 1 ? 'row' : 'rows'}</Text>
          <Box flexGrow={1} />
          {!hidden && left > 0 && c.view.isTimelineExpanded !== true ? (
            <Box marginRight={2} {...remount('more')}><Button key="more-events" {...plain} label={`+${left} more`} onPress={() => c.on.growTimeline()} /></Box>
          ) : null}
          <Box {...remount('timeline')}><Button key="toggle-timeline" {...plain} hotkey="t" label={hidden ? 'show' : 'hide'} onPress={() => c.on.toggleTimeline()} /></Box>
        </Box>
        {shown.map((ev, i) => eventRow(ev, i, !compact))}
        {!hidden && shown.length === 0 ? <Text dimColor>Nothing yet. Tool calls, edits, handoffs and endings land here.</Text> : null}
      </Box>
    )
  }

  // ---------------------------------------------------------------- assembly

  const runningBlock = compact ? running.map(line) : rowsOf(running, cols).map(row => (
    <Box flexDirection="row" gap={1}>{row.map(card)}</Box>
  ))
  const finishedShown = finished.slice(0, MAX_FINISHED_SHOWN)
  const finishedBlock =
    c.view.isFinishedExpanded && !compact ? rowsOf(finishedShown, cols).map(row => <Box flexDirection="row" gap={1}>{row.map(card)}</Box>) : finishedShown.map(line)

  return (
    <Box flexDirection="column" width={c.columns}>
      {header}
      {c.list.length === 0 ? (
        <Box key="empty" flexDirection="row" gap={2} alignItems="center">
          {boltSize !== undefined ? boltSprite(c.ui, c.surface, { size: 'small', pose: 'sleep' }) : null}
          <Text dimColor>No subagents yet this session. Each one gets an ant here when it starts.</Text>
        </Box>
      ) : null}
      {selected !== undefined ? inspector(selected) : null}
      {runningBlock}
      {finished.length > 0 ? (
        <Box flexDirection="row" key="finished-head" marginTop={running.length > 0 ? 1 : 0}>
          <Text dimColor>Finished · {finished.length} </Text>
          <Box {...remount('finished')}>
            <Button
              key="toggle-finished"
              {...plain}
              hotkey="f"
              label={c.view.isFinishedExpanded ? 'collapse' : 'expand'}
              onPress={() => c.on.toggleFinished()}
            />
          </Box>
        </Box>
      ) : null}
      {finishedBlock}
      {finished.length > MAX_FINISHED_SHOWN ? (
        <Box key="more-finished">
          <Text dimColor>+{finished.length - MAX_FINISHED_SHOWN} more finished</Text>
        </Box>
      ) : null}
      {timeline()}
      {c.isFocused ? (
        <Box key="keys" marginTop={1} minWidth={0}>
          <Text dimColor wrap={cut}>Keys · 1-9 open · n next · p previous · x close · f finished · t activity</Text>
        </Box>
      ) : null}
    </Box>
  )
}
