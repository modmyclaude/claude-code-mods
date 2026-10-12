// The mission control pane: the overview header, the command grid of cards,
// the inspector of the selected subagent, the finished list and the activity
// timeline. Every value drawn comes from the farm's state and what the loop
// events said; nothing is guessed. Words are drawn in Text, glyph art in
// glyph rows (one code-font cell per character on the desktop).

import type { BoxProps, ButtonProps, ElementConstructor, RasterProps, RenderElement, TextProps } from 'claude-code'

import type { AntFarmAnt, AntFarmEvent, AntFarmUsage, AntFarmView } from '../types'
import { boltSprite } from './bolt-draw'
import type { BoltSmallPose } from './bolt'
import { glyphRow } from './cells'
import {
  activityText, COMPACT_BELOW, eventLook, FRESH_MS, fmtShort, gridOf, hotkeyOf, met, ordered, pulse, rowsOf, SETTLE_MS,
  sparkline, spinner, statusLook, TIMELINE_ROWS, TIMELINE_ROWS_EXPANDED,
} from './mission'
import type { LivePhase } from './mission'
import {
  ANT_WIDTH, antRows, bar, clean, fmtCost, fmtDuration, fmtEta, fmtTokens, fmtUsd, miniAnt, phaseOf, progressOf, shortModel,
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
const SPARK_CELLS = 12
const BAR_CELLS = 12
const BUDGET_BAR_CELLS = 20

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
  if (running.length > 0) return { text: `Working · ${running.length} running`, color: 'claude', pose: 'think' }
  if (failed > 0) return { text: `${failed} failed · ${finished.length - failed} done`, color: 'error', pose: 'sweat' }
  return { text: `All done · ${finished.length} ${finished.length === 1 ? 'agent' : 'agents'}`, color: 'success', pose: 'cheer' }
}

export function drawControl(c: ControlInput): RenderElement {
  const { Box, Text, Button } = c.ui
  const { running, finished } = ordered(c.list)
  const failed = finished.filter(a => a.status === 'failed').length
  const compact = c.columns < COMPACT_BELOW
  const firstStart = c.list.length > 0 ? Math.min(...c.list.map(a => a.startedAt)) : c.now
  const lastEnd = running.length > 0 ? c.now : Math.max(firstStart, ...finished.map(a => a.endedAt ?? a.startedAt))
  const selected = c.view.selectedId !== undefined ? c.list.find(a => a.id === c.view.selectedId) : undefined
  const { cols, cardWidth } = gridOf(c.columns)
  const byId = new Map(c.list.map(a => [a.id, a] as const))

  // Positions in display order give the first nine cards their digit hotkeys.
  let position = 0
  const nextHotkey = () => hotkeyOf(position++)

  const antPaint = (a: AntFarmAnt): TextProps => {
    if (a.status === 'failed') return { color: 'error' }
    if (isRunning(a)) return { color: c.colors.get(a.model) ?? 'subtle' }
    if (a.endedAt !== undefined && c.now - a.endedAt < SETTLE_MS) return { color: 'success' }
    return { color: 'subtle', dimColor: true }
  }

  const inspectButton = (a: AntFarmAnt, isSelected: boolean, hotkey: string | undefined) => (
    <Button
      key={`inspect-${a.id}`}
      plain
      {...(hotkey !== undefined ? { hotkey } : {})}
      dimColor={isSelected}
      label={isSelected ? 'selected' : 'inspect'}
      onPress={() => c.on.select(isSelected ? undefined : a.id)}
    />
  )

  // ---------------------------------------------------------------- a card

  const card = (a: AntFarmAnt): RenderElement => {
    const live = c.live.get(a.id)
    const look = statusLook(a.status, live?.phase)
    const isSelected = selected?.id === a.id
    const justFinished = !isRunning(a) && a.endedAt !== undefined && c.now - a.endedAt < SETTLE_MS
    const border = isSelected ? 'claude' : a.status === 'failed' ? 'error' : justFinished ? 'success' : isRunning(a) ? c.colors.get(a.model) ?? 'subtle' : 'subtle'
    const rested = !isRunning(a) && !justFinished && !isSelected
    const tone: TextProps = a.status === 'failed' ? { color: 'error' } : { dimColor: !isRunning(a) }
    const p = progressOf(a, c.list, c.now)
    const lane = ANT_WIDTH + 3
    const rows = antRows(a.status, c.frame + phaseOf(a.id), lane)
    const elapsed = fmtDuration((a.endedAt ?? c.now) - a.startedAt)
    const activity = isRunning(a) ? `${spinner(c.frame)} ${clean(activityText(live, c.now))}` : a.status === 'done' ? `${look.glyph} Completed in ${elapsed}` : `${look.glyph} Failed after ${elapsed}`
    const counts = [
      fmtCost(a.usage),
      ...((a.tools ?? 0) > 0 ? [`${a.tools} ${a.tools === 1 ? 'tool' : 'tools'}`] : []),
      ...((a.edits ?? 0) > 0 ? [`${a.edits} ${a.edits === 1 ? 'edit' : 'edits'}`] : []),
      ...((a.errors ?? 0) > 0 ? [`${a.errors} ${a.errors === 1 ? 'error' : 'errors'}`] : []),
    ].join(' · ')
    return (
      <Box
        key={`ant-${a.id}`}
        flexDirection="column"
        width={cardWidth}
        flexShrink={0}
        borderStyle="round"
        borderColor={border}
        borderDimColor={rested}
        paddingX={1}
        hover={{ borderColor: 'claude' }}
      >
        <Box flexDirection="row">
          <Box flexGrow={1} flexShrink={1}>
            <Text bold={isRunning(a) || isSelected} dimColor={rested} wrap="truncate-end">{numberOf(a)} {taskOf(a)}</Text>
          </Box>
          <Box flexShrink={0} marginLeft={1}>
            <Text bold color={look.color}>{look.glyph} {look.word}</Text>
          </Box>
        </Box>
        <Box flexDirection="row">
          <Box key={`art-${a.id}`} flexDirection="column" width={lane} flexShrink={0}>
            {rows.map(row => glyphRow(c.ui, c.surface, row, antPaint(a)))}
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} marginLeft={1}>
            <Text dimColor wrap="truncate-end">{modelOf(a)} · {elapsed}{p.etaMs !== null ? ` · ${fmtEta(p.etaMs)}` : ''}</Text>
            <Text wrap="truncate-end" {...(isRunning(a) ? { color: look.color } : tone)}>{activity}</Text>
            <Box flexDirection="row">
              {glyphRow(c.ui, c.surface, sparkline(a.history ?? [], SPARK_CELLS), antPaint(a))}
              <Box marginLeft={1} flexShrink={1}>
                <Text dimColor wrap="truncate-end">{a.usage.requests} req · {fmtTokens(a.usage.tokens)} tok</Text>
              </Box>
            </Box>
          </Box>
        </Box>
        <Box flexDirection="row">
          {glyphRow(c.ui, c.surface, bar(p.fraction, BAR_CELLS), tone)}
          <Box marginLeft={1} flexShrink={1}>
            <Text wrap="truncate-end" {...tone}>{counts}</Text>
          </Box>
          <Box flexGrow={1} />
          {inspectButton(a, isSelected, nextHotkey())}
        </Box>
      </Box>
    )
  }

  // ---------------------------------------------------------------- a line

  const line = (a: AntFarmAnt): RenderElement => {
    const look = statusLook(a.status, c.live.get(a.id)?.phase)
    const isSelected = selected?.id === a.id
    return (
      <Box flexDirection="row" key={`line-${a.id}`}>
        {glyphRow(c.ui, c.surface, miniAnt(a.status, isRunning(a) ? c.frame + phaseOf(a.id) : 0), antPaint(a))}
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor={!isRunning(a)} wrap="truncate-end">
            {' '}{numberOf(a)} {a.status} · {taskOf(a)} · {modelOf(a)} · {fmtDuration((a.endedAt ?? c.now) - a.startedAt)} · {fmtTokens(a.usage.tokens)} tok · {fmtCost(a.usage)}
          </Text>
        </Box>
        {!compact ? <Box flexShrink={0} marginLeft={1}><Text color={look.color}>{look.glyph}</Text></Box> : null}
        {!compact ? <Box flexShrink={0} marginLeft={1}>{inspectButton(a, isSelected, nextHotkey())}</Box> : null}
      </Box>
    )
  }

  // ---------------------------------------------------------------- the header

  const head = headline(c.list, c.live)
  const clock = running.length > 0 ? met(c.now - firstStart) : c.list.length > 0 ? `${fmtDuration(lastEnd - firstStart)} wall` : ''
  const waiting = running.filter(a => c.live.get(a.id)?.phase === 'waiting').length
  const source = c.spend.isEngine ? ' (Claude Code)' : ' (price table)'
  const budgetLine =
    c.budgetUsd > 0
      ? `Session ${c.spend.text} of ${fmtUsd(c.budgetUsd)} budget${source}${c.level === 2 ? ' - past 2x' : c.level === 1 ? ' - over' : ''}`
      : `Session ${c.spend.text}${source}`
  const budgetTone: TextProps = c.level === 2 ? { color: 'error' } : c.level === 1 ? { color: 'warning' } : { dimColor: true }
  const budgetFraction = c.budgetUsd > 0 ? Math.min(1, c.spend.usd / c.budgetUsd) : null
  const boltSize = compact || c.columns < BOLT_MIN_COLUMNS ? undefined : c.columns >= BOLT_SMALL_COLUMNS ? 'small' : 'tiny'

  const headColumn = (
    <Box flexDirection="column" flexGrow={1} flexShrink={1}>
      <Box key="hero" flexDirection="row">
        <Box flexGrow={1} flexShrink={1}>
          <Text bold color={head.color} wrap="truncate-end">{head.text}</Text>
        </Box>
        {clock !== '' ? <Box flexShrink={0} marginLeft={1}><Text dimColor>{clock}</Text></Box> : null}
      </Box>
      <Box key="counts" flexDirection="row">
        <Text bold>{running.length}</Text><Text dimColor> running · </Text>
        <Text bold>{finished.length - failed}</Text><Text dimColor> done · </Text>
        <Text bold {...(failed > 0 ? { color: 'error' } : {})}>{failed}</Text><Text dimColor> failed</Text>
        {waiting > 0 ? <Text color="warning"> · {waiting} waiting</Text> : null}
      </Box>
      <Box key="totals">
        <Text dimColor wrap="truncate-end">
          Subagents {fmtCost(c.subagents)} (price table) · {fmtTokens(c.subagents.tokens)} tokens · {fmtDuration(lastEnd - firstStart)} wall
        </Text>
      </Box>
      <Box key="budget">
        <Text wrap="truncate-end" {...budgetTone}>{budgetLine}</Text>
      </Box>
      {budgetFraction !== null ? (
        <Box key="budget-bar" flexDirection="row">
          {glyphRow(c.ui, c.surface, bar(budgetFraction, BUDGET_BAR_CELLS), budgetTone)}
          <Box marginLeft={1}><Text wrap="truncate-end" {...budgetTone}>{Math.round(budgetFraction * 100)}%</Text></Box>
        </Box>
      ) : (
        <Box key="no-budget">
          <Text dimColor wrap="truncate-end">No budget set - add one in /config</Text>
        </Box>
      )}
    </Box>
  )
  const header =
    boltSize !== undefined && c.list.length > 0 ? (
      <Box key="head" flexDirection="row" gap={1} marginBottom={1}>
        {boltSize === 'small' ? boltSprite(c.ui, c.surface, { size: 'small', pose: head.pose }) : boltSprite(c.ui, c.surface, { size: 'tiny', pose: 'idle' })}
        {headColumn}
      </Box>
    ) : (
      <Box key="head" flexDirection="row" marginBottom={1}>{headColumn}</Box>
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
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end" bold={fresh} dimColor={ev.kind === 'tool' && !fresh}>{words}</Text>
        </Box>
      </Box>
    )
  }

  const inspector = (a: AntFarmAnt): RenderElement => {
    const live = c.live.get(a.id)
    const look = statusLook(a.status, live?.phase)
    const p = progressOf(a, c.list, c.now)
    const elapsed = fmtDuration((a.endedAt ?? c.now) - a.startedAt)
    const parent = a.parentId !== undefined ? byId.get(a.parentId) : undefined
    const from = a.parentId === undefined ? 'from the main loop' : `from ${parent !== undefined ? `${numberOf(parent)} ${taskOf(parent)}` : 'another agent'}`
    const state = isRunning(a) ? `${spinner(c.frame)} ${clean(activityText(live, c.now))}` : a.status === 'done' ? `${look.glyph} Completed in ${elapsed}` : `${look.glyph} Failed after ${elapsed}`
    const own = c.events.filter(ev => ev.agentId === a.id).slice(-6).reverse()
    const tally = [
      `${a.usage.requests} ${a.usage.requests === 1 ? 'request' : 'requests'}`,
      `${fmtTokens(a.usage.tokens)} tokens`,
      fmtCost(a.usage),
      `${a.tools ?? 0} tools`,
      `${a.edits ?? 0} edits`,
      `${a.errors ?? 0} errors`,
      ...(p.etaMs !== null ? [fmtEta(p.etaMs)] : []),
    ].join(' · ')
    return (
      <Box key="inspector" flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} marginBottom={1}>
        <Box flexDirection="row">
          <Box flexGrow={1} flexShrink={1}>
            <Text bold wrap="truncate-end">{numberOf(a)} {taskOf(a)}</Text>
          </Box>
          <Box flexShrink={0} marginLeft={1}>
            <Text bold color={look.color}>{look.glyph} {look.word}</Text>
          </Box>
        </Box>
        <Text dimColor wrap="truncate-end">{clean(a.type)} · {modelOf(a)} · started {met(a.startedAt - firstStart)} · {elapsed} · {from}</Text>
        <Text wrap="truncate-end" {...(isRunning(a) ? { color: look.color } : a.status === 'failed' ? { color: 'error' } : { dimColor: true })}>{state}</Text>
        <Text dimColor wrap="truncate-end">{tally}</Text>
        <Box flexDirection="row">
          {glyphRow(c.ui, c.surface, sparkline(a.history ?? [], Math.min(24, Math.max(SPARK_CELLS, c.columns - 24))), antPaint(a))}
          <Box marginLeft={1}><Text dimColor wrap="truncate-end">tokens per request</Text></Box>
        </Box>
        {own.length > 0 ? own.map((ev, i) => eventRow(ev, i + 1, !compact)) : <Text dimColor>No activity recorded yet</Text>}
        <Box flexDirection="row" gap={2} marginTop={1}>
          <Button key="inspector-prev" plain hotkey="p" label="previous" onPress={() => c.on.move(-1)} />
          <Button key="inspector-next" plain hotkey="n" label="next" onPress={() => c.on.move(1)} />
          <Button key="inspector-close" plain hotkey="x" label="close" onPress={() => c.on.select(undefined)} />
          <Box flexGrow={1} />
          <Text dimColor wrap="truncate-end">id {clean(a.id)}</Text>
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
          <Text {...pulse(c.frame)} color={running.length > 0 ? 'claude' : 'subtle'}> ●</Text>
          <Text dimColor> {c.events.length} {c.events.length === 1 ? 'row' : 'rows'}</Text>
          <Box flexGrow={1} />
          {!hidden && left > 0 && c.view.isTimelineExpanded !== true ? (
            <Box marginRight={2}><Button key="more-events" plain label={`+${left} more`} onPress={c.on.growTimeline} /></Box>
          ) : null}
          <Button key="toggle-timeline" plain hotkey="t" label={hidden ? 'show' : 'hide'} onPress={c.on.toggleTimeline} />
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
          <Button
            key="toggle-finished"
            plain
            hotkey="f"
            label={c.view.isFinishedExpanded ? 'collapse' : 'expand'}
            onPress={c.on.toggleFinished}
          />
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
        <Box key="keys" marginTop={1}>
          <Text dimColor wrap="truncate-end">Keys · 1-9 inspect · n next · p previous · x close · f finished · t activity</Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** The short form of a duration for a row's detail. */
export { fmtShort }
