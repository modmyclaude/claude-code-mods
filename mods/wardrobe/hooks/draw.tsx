// The trees wardrobe draws. Each builder takes the surface's element table
// (Box and Text, which every surface has) and a theme, and returns plain data.
// Every coloured span is painted on the theme's own background (a chip), so
// its contrast does not depend on the terminal's.

import type { BoxProps, ElementConstructor, RenderElement, RenderPropsOf, TextProps, ToolGroupCall } from 'claude-code'

import type { WardrobeLook, WardrobeTiming } from '../types'
import type { DiffCard, DiffLine } from './content'
import { shortPath } from './content'
import { AUTO, clockText, DEFAULT, formatDuration, formatMs, type Settings } from './look'
import { KIND_ROLE, kindOf, STATUS_ROLE, THEMES, type Role, type Status, type Theme } from './themes'

export type Table = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

/** Under this many columns a tool row drops its status and timing chip. */
const NARROW = 60

/** The engine's own result gutter, drawn in the terminal's default colours. */
const GUTTER = '  ⎿ '

function chip(t: Table, theme: Theme, role: Role, text: string): RenderElement {
  const { Text } = t
  return (
    <Text color={theme.palette[role]} backgroundColor={theme.palette.bg}>
      {text}
    </Text>
  )
}

export function statusOf(call: { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }): Status {
  if (call.isInterrupted) return 'interrupted'
  if (call.isErrored) return 'error'
  return call.isRunning ? 'running' : 'done'
}

/** A tool row: the theme's icon, the engine's own row, then status and time. */
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
  const time = status !== 'running' && timing?.ms != null ? ` ${formatMs(timing.ms)}` : ''
  return (
    <Box flexDirection="row" gap={1}>
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

/** A folded group: one icon per call (an error in the error colour), then the engine's count line. */
export function groupRow(t: Table, theme: Theme, calls: ReadonlyArray<ToolGroupCall>, engine: RenderElement): RenderElement {
  const { Box, Text } = t
  const shown = calls.slice(0, 12)
  const more = calls.length - shown.length
  return (
    <Box flexDirection="row" gap={1}>
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
          {chip(t, theme, 'text', ` ${card.verb} ${shortPath(card.path, root)} `)}
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

/** The engine's spinner line, then a chip naming what the turn is doing. */
export function spinnerRow(t: Table, theme: Theme, mode: RenderPropsOf['Spinner']['mode'], engine: RenderElement): RenderElement {
  const { Box } = t
  return (
    <Box flexDirection="row" gap={1}>
      {engine}
      <Box key="mode" flexShrink={0}>
        {chip(t, theme, 'accent', ` ${theme.mark} ${MODE_LABEL[mode] ?? mode} `)}
      </Box>
    </Box>
  )
}

/** The line closing a turn: `<mark> Baked for 3s`. */
export function turnRow(t: Table, theme: Theme, word: string, durationMs: number): RenderElement {
  const { Box } = t
  return <Box key="turn">{chip(t, theme, 'muted', ` ${theme.mark} ${word} for ${formatDuration(durationMs)} `)}</Box>
}

const NAME_WIDTH = Math.max(...THEMES.map(theme => theme.id.length))

const HELP = '/wear <theme> switches now. /wear auto follows the clock. /wear pin keeps this look for this project; /wear unpin lets go.'

/** What is worn, in words, for the list header and command replies. */
export function describeLook(look: WardrobeLook, settings: Settings): string {
  const where = look.scope === 'project' ? 'in this project (pinned)' : 'everywhere without a pin'
  if (look.choice === AUTO) {
    const { dayTheme, nightTheme, dayStarts, nightStarts } = settings
    return `Wearing auto ${where}: ${dayTheme} from ${clockText(dayStarts)}, ${nightTheme} from ${clockText(nightStarts)}; ${look.theme} now (${look.phase}).`
  }
  if (look.choice === DEFAULT) return `Wearing Claude Code's own look ${where}.`
  return `Wearing ${look.theme} ${where}.`
}

/** `/wear` with no argument: every theme with a one-line preview in its own colours. */
export function listTree(
  t: Table,
  look: WardrobeLook,
  settings: Settings,
  problems: readonly string[],
  columns: number | undefined,
): RenderElement {
  const { Box, Text } = t
  const wide = (columns ?? 80) >= 76
  const wearing = (choice: string) => (look.choice === choice ? <Text bold>(wearing)</Text> : null)
  return (
    <Box flexDirection="column">
      <Text>{describeLook(look, settings)}</Text>
      <Box key="theme-default" flexDirection="row" gap={1}>
        <Text>{DEFAULT.padEnd(NAME_WIDTH)}</Text>
        <Text>Claude Code's own drawing</Text>
        {wearing(DEFAULT)}
      </Box>
      {THEMES.map(theme => (
        <Box key={`theme-${theme.id}`} flexDirection="row" gap={1}>
          <Text>{theme.id.padEnd(NAME_WIDTH)}</Text>
          <Text backgroundColor={theme.palette.bg}>
            {' '}
            {(['shell', 'read', 'edit', 'write', 'search'] as const).map(kind => (
              <Text color={theme.palette[KIND_ROLE[kind]]} backgroundColor={theme.palette.bg}>
                {theme.icons[kind]}
              </Text>
            ))}{' '}
          </Text>
          <Text color={theme.diff.addFg} backgroundColor={theme.diff.addBg}>
            {' + add '}
          </Text>
          <Text color={theme.diff.removeFg} backgroundColor={theme.diff.removeBg}>
            {' - del '}
          </Text>
          {wide && <Text>{theme.blurb}</Text>}
          {wearing(theme.id)}
        </Box>
      ))}
      <Box key="theme-auto" flexDirection="row" gap={1}>
        <Text>{AUTO.padEnd(NAME_WIDTH)}</Text>
        <Text>
          {settings.dayTheme} from {clockText(settings.dayStarts)}, {settings.nightTheme} from {clockText(settings.nightStarts)}
        </Text>
        {wearing(AUTO)}
      </Box>
      {problems.map(problem => (
        <Text>Setting: {problem}</Text>
      ))}
      <Text>{HELP}</Text>
    </Box>
  )
}

/** The same list as text: what the model reads, and what other surfaces show. */
export function listText(look: WardrobeLook, settings: Settings, problems: readonly string[]): string {
  const mark = (choice: string) => (look.choice === choice ? ' (wearing)' : '')
  return [
    describeLook(look, settings),
    `- ${DEFAULT}: Claude Code's own drawing${mark(DEFAULT)}`,
    ...THEMES.map(theme => `- ${theme.id} (${theme.tone}) ${theme.icons.shell}${theme.icons.read}${theme.icons.edit}${theme.icons.write}: ${theme.blurb}${mark(theme.id)}`),
    `- ${AUTO}: ${settings.dayTheme} from ${clockText(settings.dayStarts)}, ${settings.nightTheme} from ${clockText(settings.nightStarts)}${mark(AUTO)}`,
    ...problems.map(problem => `Setting: ${problem}`),
    HELP,
  ].join('\n')
}
