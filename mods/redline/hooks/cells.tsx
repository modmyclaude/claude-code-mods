// Glyph art (the gauge's bar) on the desktop app. Its Text is proportional, and a Text
// that holds block characters is drawn in the code font, words and all, so a row with
// a bar changed font and overflowed (API-GOTCHAS #40). There the bar is drawn one
// code-font cell per character, apart from the words.

import type { BoxProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

type Elements = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

const GLYPHS = /[▀-▟]+/gu

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

/** A line of words with bars in it: one Text where the surface keeps a cell grid, else words and glyph cells side by side. */
export function mixedRow(elements: Elements, surface: string, text: string, paint: TextProps = {}): RenderElement {
  const { Box, Text } = elements
  if (surface !== 'desktop' || !text.match(GLYPHS)) return <Text {...paint}>{text}</Text>
  const parts: RenderElement[] = []
  let at = 0
  for (const m of text.matchAll(GLYPHS)) {
    if (m.index > at) parts.push(<Text {...paint}>{text.slice(at, m.index)}</Text>)
    parts.push(glyphRow(elements, surface, m[0], paint))
    at = m.index + m[0].length
  }
  if (at < text.length) parts.push(<Text wrap="truncate-end" {...paint}>{text.slice(at)}</Text>)
  return (
    <Box flexDirection="row" flexWrap="nowrap">
      {parts}
    </Box>
  )
}
