// Draws Bolt, the modmyclaude mascot (brand/bolt-sprites), on the surface a hook draws for.
// Same file in every mod that shows Bolt: mods install on their own, so they cannot share code.
// Terminal: one Raster, a cell grid. Desktop: one code-font cell per character, since its Text is
// proportional and a row of half-blocks would drift. Elsewhere: coloured Text runs.
// Bolt is static here: no timer, no redraw of its own. Never draw it over a safety hold or in a toast.

import type { BoxProps, ElementConstructor, RasterProps, RenderElement, TextProps } from 'claude-code'

import { boltCells, boltRuns } from './bolt'
import type { BoltCell, BoltSmallPose, BoltTinyPose } from './bolt'

type Elements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Raster?: ElementConstructor<RasterProps>
}

export type BoltPick = { size: 'small'; pose: BoltSmallPose } | { size: 'tiny'; pose: BoltTinyPose }

/** Columns a pose takes: small is 10, tiny is 3. */
export const BOLT_COLUMNS = { small: 10, tiny: 3 } as const

/** The cells of a pose: half-blocks, two pixel rows per cell. */
export function boltOf(pick: BoltPick): BoltCell[][] {
  return pick.size === 'small' ? boltCells('small', pick.pose) : boltCells('tiny', pick.pose)
}

/** Bolt as one element under `key`, drawn the way `surface` lays out cells. */
export function boltSprite(elements: Elements, surface: string, pick: BoltPick, key = 'bolt'): RenderElement {
  const { Box, Text, Raster } = elements
  const cells = boltOf(pick)
  const columns = cells[0]?.length ?? 0
  if (surface === 'terminal' && Raster !== undefined) {
    return <Raster key={key} columns={columns} rows={cells.length} cells={rasterCells(cells)} />
  }
  const paint = (cell: BoltCell): TextProps => ({
    ...(cell.fg !== undefined ? { color: cell.fg } : {}),
    ...(cell.bg !== undefined ? { backgroundColor: cell.bg } : {}),
  })
  if (surface === 'desktop') {
    return (
      <Box key={key} flexDirection="column" flexShrink={0}>
        {cells.map(line => (
          <Box flexDirection="row" flexWrap="nowrap">
            {line.map(cell =>
              cell.fg === undefined && cell.bg === undefined ? <Box width={1} /> : <Box width={1}><Text {...paint(cell)}>{cell.ch}</Text></Box>,
            )}
          </Box>
        ))}
      </Box>
    )
  }
  return (
    <Box key={key} flexDirection="column" flexShrink={0}>
      {cells.map(line => (
        <Text>
          {boltRuns(line).map(run => {
            const text = run.ch.replace(/ /g, ' ')
            return run.fg === undefined && run.bg === undefined ? text : <Text {...paint(run)}>{text}</Text>
          })}
        </Text>
      ))}
    </Box>
  )
}

/** RasterProps.cells: standard base64 of little-endian u32 [codePoint, fg, bg] per cell, row-major. */
export function rasterCells(cells: readonly (readonly BoltCell[])[]): string {
  const DEFAULT = 0x01000000
  const count = cells.reduce((sum, line) => sum + line.length, 0)
  const view = new DataView(new ArrayBuffer(count * 12))
  let at = 0
  for (const line of cells) {
    for (const cell of line) {
      view.setUint32(at, cell.ch.codePointAt(0) ?? 32, true)
      view.setUint32(at + 4, cell.fg === undefined ? DEFAULT : parseInt(cell.fg.slice(1), 16), true)
      view.setUint32(at + 8, cell.bg === undefined ? DEFAULT : parseInt(cell.bg.slice(1), 16), true)
      at += 12
    }
  }
  let binary = ''
  const bytes = new Uint8Array(view.buffer)
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] ?? 0)
  return btoa(binary)
}
