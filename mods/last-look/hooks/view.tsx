// Draws one held command: what it is, what it would destroy, Cancel and
// Proceed. One tree for the pane and, compact, for the band above the prompt.

import type { BoxProps, ButtonProps, ElementConstructor, RenderElement, RenderSurface, TextProps } from 'claude-code'

import type { LastLookHold, LastLookItem, LastLookRow, LastLookTone } from '../types'

export type Kit = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

export type Room = {
  /** Rows the tree may take before it scrolls. */
  rows: number
  /** Cells across the body (the site's own width, never the terminal's). */
  columns: number
  compact: boolean
  surface: RenderSurface
  /** How many more holds wait behind this one. */
  queued: number
  onCancel: () => void
  onProceed: () => void
}

export const FOOTER = 'A safety net, not a permission system.'

function tone(t: LastLookTone | undefined): TextProps {
  if (t === 'error') return { color: 'error' }
  if (t === 'warning') return { color: 'warning' }
  if (t === 'subtle') return { dimColor: true }
  return {}
}

export function drawHold(kit: Kit, hold: LastLookHold, room: Room): RenderElement {
  const { Box, Text, Button } = kit
  const { report } = hold
  const width = Math.max(20, room.columns)
  // Cancel first, so it is the one focused (`autoFocus`, first drawn wins)
  // and Enter cancels. Proceed has NO hotkey: no keystroke typed at the site
  // may ever approve. It takes a click, or Tab onto it and then Enter.
  const buttons = (
    <Box flexDirection="row" gap={2}>
      <Button key="cancel" label="Cancel" hotkey="c" variant="primary" autoFocus onPress={room.onCancel} />
      <Button key="proceed" label="Proceed" onPress={room.onProceed} />
    </Box>
  )
  const hint = room.surface === 'terminal' ? 'Click, or ctrl+x tab: Enter or c cancels; Tab to Proceed, then Enter' : undefined

  if (room.compact) {
    // The band: one line per part, so the buttons stay in its rows.
    const free = Math.max(0, room.rows - 5 - (room.queued > 0 ? 1 : 0))
    const shown = report.items.slice(0, free)
    return (
      <Box flexDirection="column" width={width}>
        <Box key="command" flexDirection="row">
          <Text bold color="warning">Last Look held: </Text>
          <Text wrap="truncate-end">{report.command}</Text>
        </Box>
        <Box key="headline">
          <Text bold {...tone(report.headlineTone)} wrap="truncate-end">{report.headline}</Text>
        </Box>
        {shown.map((item, k) => (
          <Box key={`item-${k}`}>
            <Text {...tone(item.summaryTone)} wrap="truncate-end">{`${item.title}: ${item.summary}`}</Text>
          </Box>
        ))}
        {report.items.length > shown.length && <Text dimColor>{`and ${report.items.length - shown.length} more parts`}</Text>}
        {room.queued > 0 && <Text dimColor>{`${room.queued} more held after this one`}</Text>}
        {buttons}
        <Box key="footer">
          <Text dimColor wrap="truncate-end">{hint ? `${FOOTER} ${hint}` : FOOTER}</Text>
        </Box>
      </Box>
    )
  }

  // The pane: spend the rows it has on detail, keep the buttons in view.
  const commandRows = Math.min(3, Math.ceil((report.command.length + 2) / width))
  const fixed = 1 + commandRows + (hold.isSubagent ? 1 : 0) + 2 + 3 + (hint ? 1 : 0) + (room.queued > 0 ? 1 : 0)
  const budget = Math.max(report.items.length, room.rows - fixed - report.items.length * 3)
  const shares = share(report.items, budget)
  return (
    <Box flexDirection="column" width={width}>
      <Text bold color="warning">Held: this command can destroy work</Text>
      <Box key="command">
        <Text wrap="wrap">{`$ ${clip(report.command, width * 3 - 2)}`}</Text>
      </Box>
      {hold.isSubagent && <Text dimColor>Asked by a subagent.</Text>}
      <Box key="headline" marginTop={1}>
        <Text bold {...tone(report.headlineTone)} wrap="wrap">{report.headline}</Text>
      </Box>
      {report.items.map((item, k) => drawItem(kit, item, k, shares[k] ?? 0))}
      {room.queued > 0 && <Text dimColor>{`${room.queued} more held after this one`}</Text>}
      <Box marginTop={1}>{buttons}</Box>
      <Box key="footer" flexDirection="column">
        <Text dimColor>{FOOTER}</Text>
        {hint && <Text dimColor>{hint}</Text>}
      </Box>
    </Box>
  )
}

function drawItem(kit: Kit, item: LastLookItem, index: number, room: number): RenderElement {
  const { Box, Text } = kit
  const rows = item.rows.slice(0, room)
  const hidden = item.rows.length - rows.length + item.moreRows
  return (
    <Box key={`item-${index}`} flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Text bold wrap="truncate-end">{item.title}</Text>
        {item.where !== undefined && <Text dimColor>{`  in ${item.where}`}</Text>}
      </Box>
      <Text {...tone(item.summaryTone)} wrap="wrap">{item.summary}</Text>
      {rows.map((row: LastLookRow) => (
        <Text {...tone(row.tone)} wrap="truncate-middle">{`  ${row.text}`}</Text>
      ))}
      {hidden > 0 && <Text dimColor>{`  and ${grouped(hidden)} more`}</Text>}
    </Box>
  )
}

/** Splits `budget` rows across items, each getting what it needs up to a fair part. */
export function share(items: readonly LastLookItem[], budget: number): number[] {
  const out: number[] = items.map(() => 0)
  let left = Math.max(0, budget)
  let open = items.map((_, k) => k).filter(k => (items[k]?.rows.length ?? 0) > 0)
  while (left > 0 && open.length > 0) {
    const each = Math.max(1, Math.floor(left / open.length))
    for (const k of open) {
      const want = (items[k]?.rows.length ?? 0) - (out[k] ?? 0)
      const give = Math.min(each, want, left)
      out[k] = (out[k] ?? 0) + give
      left -= give
    }
    open = open.filter(k => (out[k] ?? 0) < (items[k]?.rows.length ?? 0))
  }
  return out
}

function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`
}
