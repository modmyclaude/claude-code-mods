// Glyph art (the window's bar) on the desktop app. Its Text is proportional, and a
// Text that holds block characters is drawn in the code font, words and all, so a
// row with a bar would change font and overflow. There the bar is drawn one
// code-font cell per character, apart from the words. The same as redline's
// hooks/cells.tsx glyphRow, copied so this mod installs on its own; keep the two in step.

import type { BoxProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

type Elements = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

/** One row of glyph art: a plain Text on the terminal, a row of one-cell Boxes on the desktop. */
export function glyphRow(elements: Elements, surface: string, text: string, paint: TextProps = {}): RenderElement {
  const { Box, Text } = elements
  if (surface !== 'desktop') return <Text {...paint}>{text}</Text>
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
