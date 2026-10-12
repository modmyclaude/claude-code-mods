// Glyph art (ants, progress bars) on the desktop app. Its Text is proportional, and a
// Text that holds block characters is drawn in the code font, so words beside the art
// change font and overflow, and rows of art drift against each other.
// There the art is drawn one code-font cell per character, apart from the words.
// On every surface the row never shrinks or wraps: a row too tight for it cuts it.

import type { BoxProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

type Elements = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

/** One row of glyph art: a plain Text on the terminal, a row of one-cell Boxes on the desktop. */
export function glyphRow(elements: Elements, surface: string, text: string, paint: TextProps = {}): RenderElement {
  const { Box, Text } = elements
  if (surface !== 'desktop') {
    return (
      <Box flexShrink={0}>
        <Text {...paint} wrap="truncate-end">{text}</Text>
      </Box>
    )
  }
  const cells: RenderElement[] = []
  for (const run of text.match(/ +|[^ ]/gu) ?? []) {
    cells.push(run.startsWith(' ') ? <Box width={run.length} /> : <Box width={1}><Text {...paint}>{run}</Text></Box>)
  }
  return (
    <Box flexDirection="row" flexWrap="nowrap" flexShrink={0}>
      {cells}
    </Box>
  )
}

/** A cell of glyph art with its own paint. */
export type PaintedCell = { glyph: string; paint: TextProps }

/** One row of cells painted one by one: inline Texts on the terminal, one-cell Boxes on the desktop. */
export function paintedRow(elements: Elements, surface: string, cells: readonly PaintedCell[]): RenderElement {
  const { Box, Text } = elements
  if (surface !== 'desktop') {
    return (
      <Box flexDirection="row" flexShrink={0}>
        {cells.map(cell => <Text {...cell.paint}>{cell.glyph}</Text>)}
      </Box>
    )
  }
  return (
    <Box flexDirection="row" flexWrap="nowrap" flexShrink={0}>
      {cells.map(cell => <Box width={1}><Text {...cell.paint}>{cell.glyph}</Text></Box>)}
    </Box>
  )
}

