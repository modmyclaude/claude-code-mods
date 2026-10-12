// The trees wardrobe draws. Each builder takes the surface's element table
// (Box and Text, which every surface has) and a theme, and returns plain data.
// Every coloured span is painted on the theme's own background (a chip), so
// its contrast does not depend on the terminal's.

import type { BoxProps, ButtonProps, ElementConstructor, RasterProps, RenderElement, RenderPropsOf, TextProps, ToolGroupCall } from 'claude-code'

import type { WardrobeLook, WardrobeTiming } from '../types'
import { BOLT_COLUMNS, boltSprite, cellsSprite } from './bolt-draw'
import type { BoltSize } from './bolt'
import type { DiffCard, DiffLine } from './content'
import { clean, shortPath } from './content'
import { costumeOf, wearBolt } from './costume'
import { AUTO, clockText, DEFAULT, formatDuration, formatMs, SEASON, seasonOf, seasonWindow, type Settings } from './look'
import { KIND_ROLE, kindOf, STATUS_ROLE, THEMES, themeById, type Role, type Status, type Theme } from './themes'

export type Table = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

/** The pane's table: Box and Text, a Button for its `wear` controls, and the terminal's Raster for Bolt. */
export type PaneTable = Table & { Button: ElementConstructor<ButtonProps>; Raster?: ElementConstructor<RasterProps> }

/** Under this many columns a tool row drops its status and timing chip. */
const NARROW = 60
/** Under this many columns the /wear gallery leaves Bolt out; from NARROW on, Bolt is drawn small. */
const BOLT_MIN_COLUMNS = 40

/** The engine's own result gutter, drawn in the terminal's default colours. */
const GUTTER = '  ⎿ '

/** The five kinds a theme is shown by: in the switch band and the gallery. */
const SAMPLE_KINDS = ['shell', 'read', 'edit', 'write', 'search'] as const

function chip(t: Table, theme: Theme, role: Role, text: string): RenderElement {
  const { Text } = t
  return (
    <Text color={theme.palette[role]} backgroundColor={theme.palette.bg}>
      {text}
    </Text>
  )
}

/** The one-cell stripe opening every tool and group row: the theme's accent, so a row reads as themed before its icon does. */
function stripe(t: Table, theme: Theme): RenderElement {
  const { Box, Text } = t
  return (
    <Box key="stripe" flexShrink={0}>
      <Text color={theme.palette.bg} backgroundColor={theme.palette.accent}>
        {' '}
      </Text>
    </Box>
  )
}

export function statusOf(call: { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }): Status {
  if (call.isInterrupted) return 'interrupted'
  if (call.isErrored) return 'error'
  return call.isRunning ? 'running' : 'done'
}

/** A tool row: the stripe, the theme's icon, the engine's own row, then status and time. */
export function toolRow(
  t: Table,
  theme: Theme,
  props: RenderPropsOf['ToolUse'],
  timing: WardrobeTiming | undefined,
  engine: RenderElement,
  columns: number | undefined,
): RenderElement {
  const { Box } = t
  const kind = kindOf(props.tool)
  const status = statusOf(props)
  // A time only for a call that ran to the end: a refused or failed call's
  // span is mostly the wait at the approval prompt, not the call.
  const time = status === 'done' && timing?.ms != null ? ` ${formatMs(timing.ms)}` : ''
  return (
    <Box flexDirection="row" gap={1}>
      {stripe(t, theme)}
      <Box key="icon" flexShrink={0}>
        {chip(t, theme, KIND_ROLE[kind], ` ${theme.icons[kind]} `)}
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {engine}
      </Box>
      {(columns ?? 80) >= NARROW && (
        <Box key="status" flexShrink={0}>
          {chip(t, theme, STATUS_ROLE[status], ` ${theme.status[status]}${time} `)}
        </Box>
      )}
    </Box>
  )
}

/** A folded group: the stripe, one icon per call (an error in the error colour), then the engine's count line. */
export function groupRow(t: Table, theme: Theme, calls: ReadonlyArray<ToolGroupCall>, engine: RenderElement): RenderElement {
  const { Box, Text } = t
  const shown = calls.slice(0, 12)
  const more = calls.length - shown.length
  return (
    <Box flexDirection="row" gap={1}>
      {stripe(t, theme)}
      <Box key="icons" flexShrink={0}>
        <Text backgroundColor={theme.palette.bg}>
          {' '}
          {shown.map(call => {
            const kind = kindOf(call.tool)
            const role = call.isErrored ? 'error' : KIND_ROLE[kind]
            return (
              <Text color={theme.palette[role]} backgroundColor={theme.palette.bg}>
                {theme.icons[kind]}
              </Text>
            )
          })}
          {more > 0 && (
            <Text color={theme.palette.muted} backgroundColor={theme.palette.bg}>
              +{more}
            </Text>
          )}{' '}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {engine}
      </Box>
    </Box>
  )
}

const LINE_ROLE: Record<DiffLine['kind'], 'add' | 'remove' | 'context'> = {
  add: 'add',
  remove: 'remove',
  context: 'context',
  gap: 'context',
}

/** A diff card in the theme's diff colours: a summary chip, then numbered lines. */
export function diffTree(t: Table, theme: Theme, card: DiffCard, root: string): RenderElement {
  const { Box, Text } = t
  const { diff, palette } = theme
  const width = String(Math.max(0, ...card.lines.map(line => line.no ?? 0))).length
  const colours = {
    add: { fg: diff.addFg, bg: diff.addBg, marker: '+' },
    remove: { fg: diff.removeFg, bg: diff.removeBg, marker: '-' },
    context: { fg: palette.muted, bg: palette.bg, marker: ' ' },
  }
  return (
    <Box flexDirection="row">
      <Text>{GUTTER}</Text>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Box key="summary" flexDirection="row" gap={1}>
          {chip(t, theme, 'text', ` ${card.verb} ${shortPath(card.path, clean(root))} `)}
          <Text color={diff.addFg} backgroundColor={diff.addBg}>{` +${card.added} `}</Text>
          <Text color={diff.removeFg} backgroundColor={diff.removeBg}>{` -${card.removed} `}</Text>
          {card.userModified && chip(t, theme, 'muted', ' edited by you ')}
        </Box>
        <Box key="lines" flexDirection="column">
          {card.lines.map(line => {
            const c = colours[LINE_ROLE[line.kind]]
            const no = line.no === null ? ''.padStart(width) : String(line.no).padStart(width)
            const body = line.kind === 'gap' ? `${''.padStart(width)}   ${line.text}` : `${no} ${c.marker} ${line.text}`
            return (
              <Box backgroundColor={c.bg}>
                <Text color={c.fg} backgroundColor={c.bg}>
                  {body}
                </Text>
              </Box>
            )
          })}
        </Box>
      </Box>
    </Box>
  )
}

/** A small shell result as a card: stdout in the text colour, stderr marked `!`. */
export function shellTree(t: Table, theme: Theme, card: { stdout: string[]; stderr: string[] }): RenderElement {
  const { Box, Text } = t
  const empty = card.stdout.length === 0 && card.stderr.length === 0
  return (
    <Box flexDirection="row">
      <Text>{GUTTER}</Text>
      <Box key="output" flexDirection="column" flexGrow={1} flexShrink={1} backgroundColor={theme.palette.bg}>
        {card.stdout.map(line => chip(t, theme, 'text', ` ${line} `))}
        {card.stderr.map(line => chip(t, theme, 'warn', ` ! ${line} `))}
        {empty && chip(t, theme, 'muted', ' (no output) ')}
      </Box>
    </Box>
  )
}

const MODE_LABEL: Record<RenderPropsOf['Spinner']['mode'], string> = {
  requesting: 'waiting',
  responding: 'writing',
  thinking: 'thinking',
  'tool-input': 'preparing a tool',
  'tool-use': 'using tools',
}

/** The engine's spinner line, then a chip naming what the turn is doing; narrow, the line alone. */
export function spinnerRow(
  t: Table,
  theme: Theme,
  mode: RenderPropsOf['Spinner']['mode'],
  engine: RenderElement,
  columns: number | undefined,
): RenderElement {
  const { Box } = t
  if ((columns ?? 80) < NARROW) return engine
  return (
    <Box flexDirection="row" gap={1}>
      {engine}
      <Box key="mode" flexShrink={0}>
        {chip(t, theme, 'accent', ` ${theme.mark} ${MODE_LABEL[mode] ?? clean(String(mode))} `)}
      </Box>
    </Box>
  )
}

/** The line closing a turn: `<mark> Baked for 3s`. */
export function turnRow(t: Table, theme: Theme, word: string, durationMs: number): RenderElement {
  const { Box } = t
  return <Box key="turn">{chip(t, theme, 'muted', ` ${theme.mark} ${clean(word)} for ${formatDuration(durationMs)} `)}</Box>
}

/** Columns a string takes: every glyph wardrobe draws is single width. */
const columnsOf = (text: string) => [...text].length

/**
 * The band shown for a few seconds after `/wear`: one row filled with the
 * theme's background, its mark, `wearing <name>`, its five icons as chips, and
 * Bolt in the theme's costume at the right when there is room. The words and
 * icons are one Text of plain runs, no block glyph among them; Bolt
 * is its own element, a cell grid (bolt-draw).
 */
export function switchBand(t: Table, theme: Theme, columns: number, bolt: RenderElement | null, fill = true): RenderElement {
  const { Box, Text } = t
  const { palette } = theme
  // Where the look may not paint (a light look on a dark app), the band keeps its words and icons on the app's own background.
  const bg = fill ? palette.bg : undefined
  const wordColor = fill ? palette.text : palette.accent
  const mark = ` ${theme.mark} `
  const words = `wearing ${theme.id}  `
  const icons = SAMPLE_KINDS.map(kind => `${theme.icons[kind]} `)
  const used = columnsOf(mark) + columnsOf(words) + icons.reduce((n, icon) => n + columnsOf(icon), 0)
  const room = columns - (bolt === null ? 0 : BOLT_COLUMNS.tiny + 1)
  const pad = ' '.repeat(Math.max(1, room - used))
  return (
    <Box key="wardrobe-band" flexDirection="row" gap={1} flexShrink={0}>
      <Text backgroundColor={bg}>
        <Text color={palette.accent} backgroundColor={bg} bold>
          {mark}
        </Text>
        <Text color={wordColor} backgroundColor={bg} bold>
          {words}
        </Text>
        {SAMPLE_KINDS.map((kind, i) => (
          <Text color={palette[KIND_ROLE[kind]]} backgroundColor={bg}>
            {icons[i]}
          </Text>
        ))}
        <Text backgroundColor={bg}>{pad}</Text>
      </Text>
      {bolt}
    </Box>
  )
}

/** Bolt dressed for `theme` (plain for none), as one element keyed `key`, at `size`. */
export function dressedBolt(t: Table & { Raster?: ElementConstructor<RasterProps> }, surface: string, theme: Theme | undefined, size: BoltSize, key: string): RenderElement {
  if (theme === undefined) return boltSprite(t, surface, size === 'small' ? { size: 'small', pose: 'idle' } : { size: 'tiny', pose: 'idle' }, key)
  return cellsSprite(t, surface, wearBolt(theme, size, 'idle'), key)
}

const HELP = '/wear <theme> switches now. /wear auto follows the clock, /wear season the calendar. /wear pin keeps this look for this project; /wear unpin lets go.'

/** What is worn, in words, for the gallery header and command replies. */
export function describeLook(look: WardrobeLook, settings: Settings): string {
  const where = look.scope === 'project' ? 'in this project (pinned)' : 'everywhere without a pin'
  if (look.choice === AUTO) {
    const { dayTheme, nightTheme, dayStarts, nightStarts } = settings
    return `Wearing auto ${where}: ${dayTheme} from ${clockText(dayStarts)}, ${nightTheme} from ${clockText(nightStarts)}; ${look.theme} now (${look.phase}).`
  }
  if (look.choice === SEASON) return `Wearing season ${where}: ${look.theme} now (${seasonWindow(look.theme) ?? 'the rest of the year'}).`
  if (look.choice === DEFAULT) return `Wearing Claude Code's own look ${where}.`
  return `Wearing ${look.theme} ${where}.`
}

/** The sample call every gallery card draws, as a finished Read of 300 ms. */
export const SAMPLE_CALL: RenderPropsOf['ToolUse'] = {
  tool_use_id: 'wardrobe-sample',
  tool: 'Read',
  input: { file_path: 'src/app.ts' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
}
export const SAMPLE_TIMING: WardrobeTiming = { startedAt: 0, ms: 300 }
const SAMPLE_TEXT = 'Read src/app.ts'

/** How big Bolt is drawn in the gallery at this width: small from 60 columns, tiny from 40, none under. */
export function boltSizeFor(columns: number): BoltSize | null {
  if (columns >= NARROW) return 'small'
  return columns >= BOLT_MIN_COLUMNS ? 'tiny' : null
}

export type Gallery = {
  surface: string
  look: WardrobeLook
  settings: Settings
  problems: readonly string[]
  columns: number | undefined
  /** A `$.clock.now()` reading, for what `season` would wear today. */
  now: number
  /** What a card's `wear` button does. */
  onWear: (choice: string) => void
  /** What a theme card's `match theme` button does: wear it and set Claude Code's own theme to match. */
  onMatch: (choice: string) => void
  /** Whether a look may paint its background here (a light look on a dark app may not). */
  fills: (theme: Theme) => boolean
}

const SAMPLE_PROMPT = 'add a /health endpoint'
const SAMPLE_REPLY = 'Adding it now.'

/** One line of a gallery card's mini session: the look's stripe, then the words on its background where it may paint. */
function sampleRow(t: Table, theme: Theme, key: string, role: Role, text: string, fill: boolean): RenderElement {
  const { Box, Text } = t
  return (
    <Box key={key} flexDirection="row">
      <Box flexShrink={0}>
        <Text color={theme.palette.bg} backgroundColor={theme.palette[role]}>
          {' '}
        </Text>
      </Box>
      <Text color={fill ? theme.palette.text : undefined} backgroundColor={fill ? theme.palette.bg : undefined}>
        {' '}
        {text}
        {' '}
      </Text>
    </Box>
  )
}

/**
 * `/wear` with no argument: a gallery. Every theme is a card: its name and
 * blurb, a sample tool row drawn exactly as toolRow draws one in that theme,
 * its diff chips, Bolt in the theme's costume, the worn one marked, and a
 * `wear` button (no hotkey: the pane can hold the focus). Rows for
 * Claude Code's own look, `auto` and `season` round it off.
 */
export function listTree(t: PaneTable, g: Gallery): RenderElement {
  const { Box, Text, Button } = t
  const columns = g.columns ?? 80
  const size = boltSizeFor(columns)
  const wearing = (choice: string) => (g.look.choice === choice ? <Text bold>(wearing)</Text> : null)
  const wearButton = (choice: string) => <Button key={`wear-${choice}`} label="wear" onPress={() => g.onWear(choice)} />
  const worn = <Text>{describeLook(g.look, g.settings)}</Text>
  const wornTheme = themeById(g.look.theme)
  const seasonTheme = seasonOf(g.now)

  /** A row that is not a theme: a name, what it does, the mark and the button. */
  const plainRow = (choice: string, what: string) => (
    <Box key={`theme-${choice}`} flexDirection="row" gap={1} marginBottom={1}>
      <Text bold>{choice}</Text>
      <Text>{what}</Text>
      {wearing(choice)}
      {wearButton(choice)}
    </Box>
  )

  // A card is a mini session in the look: the person's prompt, a reply, a tool row with its
  // diff chips, and the footer label, so the difference shows before choosing. Bolt is an
  // accent at the end of the head row, never the main surface.
  const card = (theme: Theme) => {
    const fill = g.fills(theme)
    return (
      <Box key={`theme-${theme.id}`} flexDirection="column" marginBottom={1}>
        <Box key="head" flexDirection="row" gap={1}>
          <Text bold>{theme.id}</Text>
          <Text dimColor>{theme.tone}</Text>
          {wearing(theme.id)}
          {wearButton(theme.id)}
          <Button key={`match-${theme.id}`} label="match theme" onPress={() => g.onMatch(theme.id)} />
          {size === null ? null : dressedBolt(t, g.surface, theme, 'tiny', `bolt-${theme.id}`)}
        </Box>
        <Text>{theme.blurb}</Text>
        {theme.tone === 'light' ? <Text dimColor>best on a light theme</Text> : null}
        {sampleRow(t, theme, `you-${theme.id}`, 'accent', `> ${SAMPLE_PROMPT}`, fill)}
        {sampleRow(t, theme, `reply-${theme.id}`, 'info', SAMPLE_REPLY, fill)}
        <Box key="sample" flexDirection="row" gap={1}>
          {toolRow(t, theme, SAMPLE_CALL, SAMPLE_TIMING, <Text>{SAMPLE_TEXT}</Text>, columns)}
          <Text color={theme.diff.addFg} backgroundColor={theme.diff.addBg}>
            {' + add '}
          </Text>
          <Text color={theme.diff.removeFg} backgroundColor={theme.diff.removeBg}>
            {' - del '}
          </Text>
        </Box>
        <Text key={`footer-${theme.id}`} color={theme.palette.muted}>
          {theme.mark} wearing {theme.id}
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {size === null ? (
        worn
      ) : (
        <Box key="worn" flexDirection="row" gap={1} marginBottom={1}>
          {dressedBolt(t, g.surface, wornTheme, 'tiny', 'bolt')}
          <Box flexDirection="column" flexShrink={1}>
            {worn}
          </Box>
        </Box>
      )}
      {plainRow(DEFAULT, "Claude Code's own drawing")}
      {THEMES.map(card)}
      {plainRow(AUTO, `${g.settings.dayTheme} from ${clockText(g.settings.dayStarts)}, ${g.settings.nightTheme} from ${clockText(g.settings.nightStarts)}`)}
      {plainRow(SEASON, `by the calendar: ${seasonTheme} now (${seasonWindow(seasonTheme) ?? 'the rest of the year'})`)}
      {g.problems.map(problem => (
        <Text>Setting: {clean(problem)}</Text>
      ))}
      <Text>{HELP}</Text>
    </Box>
  )
}

/** The same gallery as text, without the art: what the model reads, and what other surfaces show. */
export function listText(look: WardrobeLook, settings: Settings, problems: readonly string[], now: number): string {
  const mark = (choice: string) => (look.choice === choice ? ' (wearing)' : '')
  const sample = (theme: Theme) =>
    `${theme.icons.read} ${SAMPLE_TEXT} ${theme.status.done} ${formatMs(SAMPLE_TIMING.ms ?? 0)}  +add -del  Bolt: ${costumeOf(theme)?.name ?? 'none'}`
  const season = seasonOf(now)
  return [
    describeLook(look, settings),
    `- ${DEFAULT}: Claude Code's own drawing${mark(DEFAULT)}`,
    ...THEMES.flatMap(theme => [
      `- ${theme.id} (${theme.tone}) ${SAMPLE_KINDS.map(kind => theme.icons[kind]).join('')}: ${theme.blurb}${theme.tone === 'light' ? ' (best on a light theme)' : ''}${mark(theme.id)}`,
      `    ${sample(theme)}`,
    ]),
    `- ${AUTO}: ${settings.dayTheme} from ${clockText(settings.dayStarts)}, ${settings.nightTheme} from ${clockText(settings.nightStarts)}${mark(AUTO)}`,
    `- ${SEASON}: by the calendar: ${season} now (${seasonWindow(season) ?? 'the rest of the year'})${mark(SEASON)}`,
    ...problems.map(problem => `Setting: ${clean(problem)}`),
    HELP,
  ].join('\n')
}

/** Which transcript rows a look tints, and the palette role of each one's stripe. */
export type TranscriptRow = 'UserMessage' | 'AssistantMessage' | 'CommandOutput'
const ROW_ROLE: Record<TranscriptRow, Role> = { UserMessage: 'accent', AssistantMessage: 'info', CommandOutput: 'muted' }

/**
 * A transcript row (the person's prompt, a reply block, a command's output) in
 * the look: a one-cell stripe in the row's colour, then the engine's own row on
 * the theme's background with a cell of padding each side. The engine's node
 * sits under Boxes with layout-neutral props only, and the
 * tree reads nothing that changes per tick, so a redraw never changes it
 *: the whole row is a pure function of the theme.
 */
export function messageRow(
  t: Table,
  theme: Theme,
  row: TranscriptRow,
  engine: RenderElement,
  opts: { surface: string; fill: boolean },
): RenderElement {
  const { Box } = t
  // The stripe is a one-cell column; a row aligns its children to its full height by default, so it runs beside
  // every line of the row and its margins, never on the blank line above the text.
  const stripe = <Box key="stripe" width={1} flexShrink={0} backgroundColor={theme.palette[ROW_ROLE[row]]} />
  // Both surfaces draw the person's message in a band of their own: a panel around it
  // reads as a box in a box, so there the stripe alone marks the row.
  if (row === 'UserMessage') {
    return (
      <Box key={`look-${row}`} flexDirection="row" alignItems="stretch">
        {stripe}
        <Box key="plain" flexDirection="column" flexGrow={1} flexShrink={1}>
          {engine}
        </Box>
      </Box>
    )
  }
  return (
    <Box key={`look-${row}`} flexDirection="row" alignItems="stretch">
      {stripe}
      {opts.fill ? (
        <Box key="tint" flexDirection="column" flexGrow={1} flexShrink={1} backgroundColor={theme.palette.bg} paddingX={1}>
          {engine}
        </Box>
      ) : (
        <Box key="plain" flexDirection="column" flexGrow={1} flexShrink={1} paddingX={1}>
          {engine}
        </Box>
      )}
    </Box>
  )
}

/** The prompt footer's mode labels with `wearing <theme>` after them, quiet, in the theme's muted colour. */
export function wearingLabel(t: Table, theme: Theme, hasModes: boolean, engine: RenderElement): RenderElement {
  const { Box, Text } = t
  return (
    <Box key="look-modes" flexDirection="row">
      {engine}
      <Box key="wearing" flexShrink={0}>
        <Text color={theme.palette.muted}>
          {hasModes ? ' · ' : ''}
          {theme.mark} wearing {theme.id}
        </Text>
      </Box>
    </Box>
  )
}
