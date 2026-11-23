// Themes are plain data: one object per theme. Nothing in this file draws.
//
// Every colour a theme paints is painted together with the theme's own
// background (a "chip"), so the contrast the tests measure is the contrast on
// screen, whatever the terminal's own background is.

/** What a tool does, for picking its icon. */
export type Kind =
  | 'shell'
  | 'read'
  | 'edit'
  | 'write'
  | 'search'
  | 'web'
  | 'agent'
  | 'todo'
  | 'mcp'
  | 'other'

export const KINDS: readonly Kind[] = [
  'shell',
  'read',
  'edit',
  'write',
  'search',
  'web',
  'agent',
  'todo',
  'mcp',
  'other',
]

/** Where a tool call stands. Each has its own glyph, so colour is never the only cue. */
export type Status = 'running' | 'done' | 'error' | 'interrupted'

export const STATUSES: readonly Status[] = ['running', 'done', 'error', 'interrupted']

/** The named colours of a palette; every one is drawn on `bg`. */
export type Role = 'text' | 'muted' | 'accent' | 'info' | 'ok' | 'warn' | 'error' | 'special'

export const ROLES: readonly Role[] = ['text', 'muted', 'accent', 'info', 'ok', 'warn', 'error', 'special']

export type Theme = {
  id: string
  tone: 'dark' | 'light'
  /** The one-line description `/wear` shows. */
  blurb: string
  palette: Record<Role, string> & { bg: string }
  /** Diff lines: each foreground is drawn on its own background. */
  diff: { addFg: string; addBg: string; removeFg: string; removeBg: string }
  icons: Record<Kind, string>
  status: Record<Status, string>
  /** The glyph leading the turn-duration line. */
  mark: string
  /** Drawn after the spinner's word (the engine's own is one ellipsis). */
  spinnerSuffix: string
  /** A sports look in a team's colours (tailor.ts): the two colours as given, for the scene's paint, where no word is drawn. */
  team?: { primary: string; secondary: string }
}

/** Which palette colour each tool kind's icon takes. */
export const KIND_ROLE: Record<Kind, Role> = {
  shell: 'accent',
  read: 'info',
  edit: 'warn',
  write: 'ok',
  search: 'special',
  web: 'info',
  agent: 'special',
  todo: 'muted',
  mcp: 'accent',
  other: 'muted',
}

/** Which palette colour each status takes. */
export const STATUS_ROLE: Record<Status, Role> = {
  running: 'warn',
  done: 'ok',
  error: 'error',
  interrupted: 'muted',
}

// Glyph sets. Every set gives each kind its own glyph; GEO is also a set of
// different SHAPES (triangle, circle, diamond, square, cross, bars), which is
// what the colorblind theme relies on. All are single-width text characters,
// none of them emoji.
const GEO: Record<Kind, string> = {
  shell: '▸', // small right triangle
  read: '●', // circle
  edit: '◆', // diamond
  write: '■', // square
  search: '▲', // up triangle
  web: '✚', // heavy cross
  agent: '▼', // down triangle
  todo: '≡', // three bars
  mcp: '⊕', // circled plus
  other: '∴', // three dots
}

const OUTLINE: Record<Kind, string> = {
  shell: '›', // single right angle quote
  read: '○', // white circle
  edit: '◇', // white diamond
  write: '□', // white square
  search: '△', // white up triangle
  web: '◎', // bullseye
  agent: '▽', // white down triangle
  todo: '≡',
  mcp: '⊙', // circled dot
  other: '·', // middle dot
}

const ASCII: Record<Kind, string> = {
  shell: '$',
  read: '<',
  edit: '~',
  write: '>',
  search: '?',
  web: '@',
  agent: '&',
  todo: '=',
  mcp: '%',
  other: ':',
}

// The seasonal packs' sets: a solid or an outline set with a season's own
// glyph for search and the web (an eye and a moon, two snowflakes, a blossom,
// waves and a sun, a fleuron). Single-width BMP characters, none of them emoji
// and no stars: a four-point star reads as the AI sparkle (COPY-NOTES).
const NIGHT: Record<Kind, string> = { ...GEO, search: '◉', web: '☾' } // fisheye (an eye), last-quarter moon
const FROST: Record<Kind, string> = { ...OUTLINE, search: '❅', web: '❄' } // tight trifoliate snowflake, snowflake
const BLOOM: Record<Kind, string> = { ...OUTLINE, search: '✿', web: '❀' } // black florette, white florette
const SHORE: Record<Kind, string> = { ...GEO, search: '≈', web: '☼' } // waves (almost equal to), white sun
const LEAF: Record<Kind, string> = { ...OUTLINE, search: '❦', web: '❧' } // floral heart, rotated floral heart

// The tech, sports and holiday looks' sets, on the same rule: a solid or an
// outline set with the look's own glyph for search and the web.
const PULSE: Record<Kind, string> = { ...GEO, search: '∿', web: '◉' } // sine wave (a trace), fisheye (a status light)
const DAWN: Record<Kind, string> = { ...OUTLINE, search: '⚘', web: '☼' } // flower (a lily), white sun
const CRESCENT: Record<Kind, string> = { ...GEO, search: '◈', web: '☽' } // diamond in a diamond (a lantern), first-quarter moon

const MARKS: Record<Status, string> = {
  running: '…', // ellipsis
  done: '✓', // check
  error: '✗', // ballot x
  interrupted: '⊘', // circled slash
}

export const THEMES: readonly Theme[] = [
  {
    id: 'noir',
    tone: 'dark',
    blurb: 'Monochrome ink; status told apart by shape alone',
    palette: {
      bg: '#101010',
      text: '#e8e8e8',
      muted: '#a8a8a8',
      accent: '#ffffff',
      info: '#cfcfcf',
      ok: '#d8d8d8',
      warn: '#bdbdbd',
      error: '#ff8a8a',
      special: '#e0e0e0',
    },
    diff: { addFg: '#ffffff', addBg: '#3a3a3a', removeFg: '#c4c4c4', removeBg: '#1c1c1c' },
    icons: ASCII,
    status: MARKS,
    mark: '■',
    spinnerSuffix: '...',
  },
  {
    id: 'paper',
    tone: 'light',
    blurb: 'Light, warm and quiet, for bright rooms',
    palette: {
      bg: '#fbf8f1',
      text: '#2b2b2b',
      muted: '#5c5c5c',
      accent: '#1f5fbf',
      info: '#0f6a80',
      ok: '#1e6b34',
      warn: '#8a5300',
      error: '#b3261e',
      special: '#7a3a9e',
    },
    diff: { addFg: '#14532d', addBg: '#dcf2df', removeFg: '#8b1a12', removeBg: '#fbe0dd' },
    icons: OUTLINE,
    status: MARKS,
    mark: '§',
    spinnerSuffix: '…',
  },
  {
    id: 'tokyo-night',
    tone: 'dark',
    blurb: 'Cool blues and neon, after the Tokyo Night palette',
    palette: {
      bg: '#1a1b26',
      text: '#c0caf5',
      muted: '#9aa5ce',
      accent: '#7aa2f7',
      info: '#7dcfff',
      ok: '#9ece6a',
      warn: '#e0af68',
      error: '#f7768e',
      special: '#bb9af7',
    },
    diff: { addFg: '#b9f27c', addBg: '#1f3326', removeFg: '#ff9eaf', removeBg: '#3a1f2a' },
    icons: GEO,
    status: MARKS,
    mark: '◆',
    spinnerSuffix: ' ~',
  },
  {
    id: 'dracula',
    tone: 'dark',
    blurb: 'Purple, pink and green on deep slate',
    palette: {
      bg: '#282a36',
      text: '#f8f8f2',
      muted: '#c0c4d8',
      accent: '#bd93f9',
      info: '#8be9fd',
      ok: '#50fa7b',
      warn: '#f1fa8c',
      error: '#ff6e6e',
      special: '#ff79c6',
    },
    diff: { addFg: '#69ff94', addBg: '#1e3a2b', removeFg: '#ff9580', removeBg: '#46222b' },
    icons: GEO,
    status: MARKS,
    mark: '▼',
    spinnerSuffix: ' ›',
  },
  {
    id: 'catppuccin',
    tone: 'dark',
    blurb: 'Soft pastels, after Catppuccin Mocha',
    palette: {
      bg: '#1e1e2e',
      text: '#cdd6f4',
      muted: '#a6adc8',
      accent: '#cba6f7',
      info: '#89dceb',
      ok: '#a6e3a1',
      warn: '#f9e2af',
      error: '#f38ba8',
      special: '#f5c2e7',
    },
    diff: { addFg: '#a6e3a1', addBg: '#253a2c', removeFg: '#f5a3bb', removeBg: '#3e2433' },
    icons: GEO,
    status: MARKS,
    mark: '●',
    spinnerSuffix: '…',
  },
  {
    id: 'solarized',
    tone: 'dark',
    blurb: 'Solarized dark, nudged brighter to pass contrast',
    palette: {
      bg: '#002b36',
      text: '#93a1a1',
      muted: '#8a9a9c',
      accent: '#41a7e8',
      info: '#2fb5aa',
      ok: '#97ad00',
      warn: '#c99a00',
      error: '#ff6e5c',
      special: '#a6a9e8',
    },
    diff: { addFg: '#b3cc1a', addBg: '#0b3a2a', removeFg: '#ff8a7a', removeBg: '#3a1f24' },
    icons: ASCII,
    status: MARKS,
    mark: '⊙',
    spinnerSuffix: '…',
  },
  {
    id: 'nord',
    tone: 'dark',
    blurb: 'Arctic frost blues, after the Nord palette',
    palette: {
      bg: '#2e3440',
      text: '#eceff4',
      muted: '#d8dee9',
      accent: '#88c0d0',
      info: '#8fbcbb',
      ok: '#a3be8c',
      warn: '#ebcb8b',
      error: '#e5939b',
      special: '#c5a3c0',
    },
    diff: { addFg: '#c2dba9', addBg: '#3b4a3c', removeFg: '#f2b8be', removeBg: '#4f3a42' },
    icons: OUTLINE,
    status: MARKS,
    mark: '◇',
    spinnerSuffix: '…',
  },
  {
    id: 'high-contrast',
    tone: 'dark',
    blurb: 'WCAG AAA: at least 7:1 contrast on everything it draws',
    palette: {
      bg: '#000000',
      text: '#ffffff',
      muted: '#e0e0e0',
      accent: '#ffff00',
      info: '#00ffff',
      ok: '#7fff7f',
      warn: '#ffd75f',
      error: '#ff8f8f',
      special: '#ffafff',
    },
    diff: { addFg: '#000000', addBg: '#9dff9d', removeFg: '#000000', removeBg: '#ffb0b0' },
    icons: GEO,
    status: MARKS,
    mark: '■',
    spinnerSuffix: '...',
  },
  {
    id: 'colorblind',
    tone: 'dark',
    blurb: 'Diffs in blue and orange, icons that differ by shape',
    palette: {
      bg: '#1b1d23',
      text: '#e6e6e6',
      muted: '#b4b8c0',
      accent: '#56b4e9',
      info: '#8fd0ff',
      ok: '#56b4e9',
      warn: '#f0e442',
      error: '#ffa94d',
      special: '#cc79a7',
    },
    diff: { addFg: '#9fd7ff', addBg: '#0c2a45', removeFg: '#ffbe6b', removeBg: '#3d2608' },
    icons: GEO,
    status: MARKS,
    mark: '▲',
    spinnerSuffix: '…',
  },
  // The tech looks: the rooms and screens of people who build software.
  {
    id: 'phosphor',
    tone: 'dark',
    blurb: 'Green and amber phosphor on near-black, the old terminal',
    palette: {
      bg: '#0a0f0a',
      text: '#b7f5c4',
      muted: '#7fb58c',
      accent: '#4dff7c',
      info: '#7de8c5',
      ok: '#9dff6a',
      warn: '#ffc24d',
      error: '#ff7a66',
      special: '#ffd98a',
    },
    diff: { addFg: '#aaffbe', addBg: '#0f3a1c', removeFg: '#ffb199', removeBg: '#3d1a12' },
    icons: ASCII,
    status: MARKS,
    mark: '▮',
    spinnerSuffix: ' _',
  },
  {
    id: 'graphite',
    tone: 'dark',
    blurb: 'Dimmed greys and one calm blue, for long days of reading code',
    palette: {
      bg: '#1c1e21',
      text: '#d7dae0',
      muted: '#9aa0aa',
      accent: '#6cb6ff',
      info: '#7fd1e0',
      ok: '#8fcf9a',
      warn: '#d9b56c',
      error: '#f08f8f',
      special: '#b8a9e6',
    },
    diff: { addFg: '#b4e3bd', addBg: '#22382a', removeFg: '#f2b3b3', removeBg: '#3f2527' },
    icons: OUTLINE,
    status: MARKS,
    mark: '◦',
    spinnerSuffix: '…',
  },
  {
    id: 'clay',
    tone: 'dark',
    blurb: 'Terracotta, sand and sage on warm charcoal',
    palette: {
      bg: '#262321',
      text: '#f0e9df',
      muted: '#b8ad9f',
      accent: '#e0825f',
      info: '#8fb8c9',
      ok: '#a3bf8a',
      warn: '#e3b56b',
      error: '#f08a80',
      special: '#d7a6b8',
    },
    diff: { addFg: '#c5dba9', addBg: '#2f3a24', removeFg: '#f5b3a8', removeBg: '#472620' },
    icons: GEO,
    status: MARKS,
    mark: '◒',
    spinnerSuffix: '…',
  },
  {
    id: 'synthwave',
    tone: 'dark',
    blurb: 'Magenta and cyan on indigo, a sunset over the grid',
    palette: {
      bg: '#1a1033',
      text: '#f4e9ff',
      muted: '#b9a8d9',
      accent: '#ff5fd2',
      info: '#5ce1ff',
      ok: '#72f1b8',
      warn: '#ffd166',
      error: '#ff6b8b',
      special: '#b893ff',
    },
    diff: { addFg: '#9af7cf', addBg: '#143a33', removeFg: '#ffa3b8', removeBg: '#4a1a33' },
    icons: GEO,
    status: MARKS,
    mark: '◢',
    spinnerSuffix: ' ~',
  },
  {
    id: 'on-call',
    tone: 'dark',
    blurb: 'Pager amber and red on graphite, for the night shift',
    palette: {
      bg: '#17191d',
      text: '#e6e8ec',
      muted: '#a3a9b4',
      accent: '#ffb347',
      info: '#7cc4ff',
      ok: '#5fe08a',
      warn: '#ffd75f',
      error: '#ff7a70',
      special: '#ff9f6b',
    },
    diff: { addFg: '#a8f0bf', addBg: '#143524', removeFg: '#ffb0a8', removeBg: '#451c1c' },
    icons: PULSE,
    status: MARKS,
    mark: '◉',
    spinnerSuffix: '...',
  },
  // The sports looks: a sport each, never a league or a team. A team's two colours come from the settings (tailor.ts).
  {
    id: 'hardwood',
    tone: 'dark',
    blurb: 'Basketball: maple, orange and arena lights',
    palette: {
      bg: '#1f150d',
      text: '#f6ead8',
      muted: '#c4b199',
      accent: '#ff8c3a',
      info: '#8fc2e8',
      ok: '#9ed67a',
      warn: '#ffc857',
      error: '#ff7b6b',
      special: '#f2d2a0',
    },
    diff: { addFg: '#c3e6a0', addBg: '#2c3a1a', removeFg: '#ffb3a3', removeBg: '#4a2018' },
    icons: GEO,
    status: MARKS,
    mark: '◐',
    spinnerSuffix: '…',
  },
  {
    id: 'gridiron',
    tone: 'dark',
    blurb: 'Football: night turf, chalk lines and goalpost yellow',
    palette: {
      bg: '#0f2318',
      text: '#f2f7ee',
      muted: '#b3c7b3',
      accent: '#f5d547',
      info: '#9fd3ff',
      ok: '#8fe08a',
      warn: '#ffb84d',
      error: '#ff8a7a',
      special: '#e8c9a0',
    },
    diff: { addFg: '#b4f0b4', addBg: '#17472a', removeFg: '#ffb5a8', removeBg: '#4a2120' },
    icons: OUTLINE,
    status: MARKS,
    mark: '◊',
    spinnerSuffix: '…',
  },
  {
    id: 'rink',
    tone: 'dark',
    blurb: 'Hockey: ice blue and the red line under arena lights',
    palette: {
      bg: '#0e1b2c',
      text: '#eaf4ff',
      muted: '#a9bdd4',
      accent: '#7cc7ff',
      info: '#a5e8f0',
      ok: '#7fe0b0',
      warn: '#ffd166',
      error: '#ff9d6b',
      special: '#ff8585',
    },
    diff: { addFg: '#aef0cf', addBg: '#113a30', removeFg: '#ffb3b3', removeBg: '#481f29' },
    icons: OUTLINE,
    status: MARKS,
    mark: '⊙',
    spinnerSuffix: '…',
  },
  // The seasonal packs. `/wear season` picks one by the date (look.ts SEASONS).
  {
    id: 'halloween',
    tone: 'dark',
    blurb: 'Pumpkin orange, violet and bone white on near-black',
    palette: {
      bg: '#0f0a16',
      text: '#f2ead8',
      muted: '#b7acc4',
      accent: '#ff8c2b',
      info: '#c9a6ff',
      ok: '#a6e85c',
      warn: '#ffb347',
      error: '#ff6b6b',
      special: '#dcb8ff',
    },
    diff: { addFg: '#b5f08a', addBg: '#1b2a12', removeFg: '#ffa07a', removeBg: '#3a1a12' },
    icons: NIGHT,
    status: MARKS,
    mark: '☾',
    spinnerSuffix: ' ~',
  },
  {
    id: 'christmas',
    tone: 'dark',
    blurb: 'Holly green, berry red, snow white and gold on deep pine',
    palette: {
      bg: '#0e2a1c',
      text: '#f6faf4',
      muted: '#b9cdbe',
      accent: '#ff7b86',
      info: '#9fdcff',
      ok: '#8ee08e',
      warn: '#f2c94c',
      error: '#ff8a93',
      special: '#ffd766',
    },
    diff: { addFg: '#b4f0b4', addBg: '#174a2a', removeFg: '#ffb3b9', removeBg: '#4a1e26' },
    icons: FROST,
    status: MARKS,
    mark: '❄',
    spinnerSuffix: '…',
  },
  {
    id: 'spring',
    tone: 'light',
    blurb: 'Fresh green, blossom pink and sky blue on cream',
    palette: {
      bg: '#fbf7ec',
      text: '#2f3a2f',
      muted: '#5e6a5e',
      accent: '#2e7d32',
      info: '#1769aa',
      ok: '#2e7d32',
      warn: '#8a5a00',
      error: '#b3261e',
      special: '#a8307a',
    },
    diff: { addFg: '#1b5e20', addBg: '#dff3dc', removeFg: '#8b1a3a', removeBg: '#fbdde6' },
    icons: BLOOM,
    status: MARKS,
    mark: '❀',
    spinnerSuffix: '…',
  },
  {
    id: 'summer',
    tone: 'dark',
    blurb: 'Sun yellow, sea teal and coral on deep navy',
    palette: {
      bg: '#0b1e3a',
      text: '#f1f5fb',
      muted: '#b4c1d6',
      accent: '#ffd84d',
      info: '#4fd8d0',
      ok: '#5fe0a8',
      warn: '#ffc14d',
      error: '#ff8a73',
      special: '#ff9aa8',
    },
    diff: { addFg: '#8ff0c0', addBg: '#0f3a2e', removeFg: '#ffb0a0', removeBg: '#3e1c22' },
    icons: SHORE,
    status: MARKS,
    mark: '☼',
    spinnerSuffix: ' ~',
  },
  {
    id: 'autumn',
    tone: 'dark',
    blurb: 'Amber, rust, moss and cream on dark brown',
    palette: {
      bg: '#241a12',
      text: '#f3e9d7',
      muted: '#c0b19b',
      accent: '#f5a623',
      info: '#9ec5b8',
      ok: '#a9c46c',
      warn: '#e8884f',
      error: '#ff7a66',
      special: '#e0a884',
    },
    diff: { addFg: '#c9d98a', addBg: '#2f3a1a', removeFg: '#ffb098', removeBg: '#4a2418' },
    icons: LEAF,
    status: MARKS,
    mark: '❧',
    spinnerSuffix: '…',
  },
  // The two holiday looks, worn by name; `/wear season` wears one only where its setting asks (look.ts).
  {
    id: 'easter',
    tone: 'dark',
    blurb: 'Easter: dawn gold, lily white and blossom on a violet morning',
    palette: {
      bg: '#1d1530',
      text: '#fbf3e4',
      muted: '#c3b6cf',
      accent: '#ffd27a',
      info: '#a9c9ff',
      ok: '#a8dba0',
      warn: '#ffb37a',
      error: '#ff8f9c',
      special: '#f2b6d8',
    },
    diff: { addFg: '#bfe8b8', addBg: '#213a26', removeFg: '#ffb3bd', removeBg: '#4a1f33' },
    icons: DAWN,
    status: MARKS,
    mark: '⚘',
    spinnerSuffix: '…',
  },
  {
    id: 'eid',
    tone: 'dark',
    blurb: 'Eid al-Fitr: lantern gold and a crescent over a teal night',
    palette: {
      bg: '#0c2a2a',
      text: '#f7f1df',
      muted: '#b5c9c0',
      accent: '#f2c96b',
      info: '#8fd9d1',
      ok: '#8ee0a0',
      warn: '#ffb866',
      error: '#ff8f85',
      special: '#f0a8c0',
    },
    diff: { addFg: '#b4f0c2', addBg: '#12402e', removeFg: '#ffb5ad', removeBg: '#4a2424' },
    icons: CRESCENT,
    status: MARKS,
    mark: '☽',
    spinnerSuffix: '…',
  },
]

/** The sports looks: the ones a team's two colours recolour, and the ones a game day may wear. */
export const SPORTS: readonly string[] = ['hardwood', 'gridiron', 'rink']

/**
 * The looks in families, as the gallery shows them: one family at a time, so a
 * gallery of many looks stays a short page. Every look is in exactly one.
 */
export const FAMILIES: readonly { name: string; what: string; ids: readonly string[] }[] = [
  { name: 'everyday', what: 'the classics', ids: ['noir', 'paper', 'tokyo-night', 'dracula', 'catppuccin', 'solarized', 'nord'] },
  { name: 'tech', what: 'rooms and screens', ids: ['phosphor', 'graphite', 'clay', 'synthwave', 'on-call'] },
  { name: 'sports', what: 'a sport each, in your team colours', ids: SPORTS },
  { name: 'seasons', what: 'the calendar and two holidays', ids: ['halloween', 'christmas', 'spring', 'summer', 'autumn', 'easter', 'eid'] },
  { name: 'accessible', what: 'contrast and shape first', ids: ['high-contrast', 'colorblind'] },
]

/** The family a look is in; the first for a name that is no look (Claude Code's own drawing). */
export function familyOf(id: string): string {
  return (FAMILIES.find(family => family.ids.includes(id)) ?? FAMILIES[0]!).name
}

/** The theme with this id, or undefined (for `default`, too: no restyle). */
export function themeById(id: string): Theme | undefined {
  return THEMES.find(theme => theme.id === id)
}

/** The kind a tool's name says it is. */
export function kindOf(tool: string): Kind {
  if (tool.startsWith('mcp__')) return 'mcp'
  return TOOL_KIND[tool] ?? 'other'
}

const TOOL_KIND: Record<string, Kind> = {
  Bash: 'shell',
  PowerShell: 'shell',
  BashOutput: 'shell',
  KillShell: 'shell',
  Monitor: 'shell',
  Read: 'read',
  NotebookRead: 'read',
  LSP: 'read',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Write: 'write',
  Grep: 'search',
  Glob: 'search',
  ToolSearch: 'search',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'agent',
  Task: 'agent',
  SendMessage: 'agent',
  TodoWrite: 'todo',
  TaskCreate: 'todo',
  TaskUpdate: 'todo',
  TaskList: 'todo',
  TaskGet: 'todo',
}

/**
 * A verb for the spinner and the turn's closing line, [present, past], per
 * theme: one is picked when a turn starts and held for the whole turn, never
 * cycled (a word swapped mid-turn reads as flashing on the desktop). The two
 * accessibility themes keep the engine's own words.
 */
export const VERBS: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  noir: [['Tailing', 'Tailed'], ['Sleuthing', 'Sleuthed'], ['Casing', 'Cased']],
  paper: [['Drafting', 'Drafted'], ['Inking', 'Inked'], ['Sketching', 'Sketched']],
  'tokyo-night': [['Cruising', 'Cruised'], ['Humming', 'Hummed'], ['Drifting', 'Drifted']],
  dracula: [['Stalking', 'Stalked'], ['Brooding', 'Brooded'], ['Lurking', 'Lurked']],
  catppuccin: [['Purring', 'Purred'], ['Napping', 'Napped'], ['Pouncing', 'Pounced']],
  solarized: [['Sunning', 'Sunned'], ['Shading', 'Shaded'], ['Basking', 'Basked']],
  nord: [['Skiing', 'Skied'], ['Trekking', 'Trekked'], ['Gliding', 'Glided']],
  halloween: [['Brewing', 'Brewed'], ['Haunting', 'Haunted'], ['Conjuring', 'Conjured']],
  christmas: [['Wrapping', 'Wrapped'], ['Gifting', 'Gifted'], ['Carolling', 'Carolled']],
  spring: [['Blooming', 'Bloomed'], ['Sprouting', 'Sprouted'], ['Planting', 'Planted']],
  summer: [['Surfing', 'Surfed'], ['Sailing', 'Sailed'], ['Paddling', 'Paddled']],
  autumn: [['Raking', 'Raked'], ['Harvesting', 'Harvested'], ['Simmering', 'Simmered']],
  phosphor: [['Booting', 'Booted'], ['Dialing', 'Dialed'], ['Scanning', 'Scanned']],
  graphite: [['Parsing', 'Parsed'], ['Tracing', 'Traced'], ['Reviewing', 'Reviewed']],
  clay: [['Shaping', 'Shaped'], ['Kneading', 'Kneaded'], ['Firing', 'Fired']],
  synthwave: [['Cruising', 'Cruised'], ['Glowing', 'Glowed'], ['Looping', 'Looped']],
  'on-call': [['Paging', 'Paged'], ['Triaging', 'Triaged'], ['Patching', 'Patched']],
  hardwood: [['Dribbling', 'Dribbled'], ['Dunking', 'Dunked'], ['Rebounding', 'Rebounded']],
  gridiron: [['Huddling', 'Huddled'], ['Rushing', 'Rushed'], ['Punting', 'Punted']],
  rink: [['Skating', 'Skated'], ['Passing', 'Passed'], ['Forechecking', 'Forechecked']],
  easter: [['Dawning', 'Dawned'], ['Gathering', 'Gathered'], ['Rejoicing', 'Rejoiced']],
  eid: [['Gathering', 'Gathered'], ['Sharing', 'Shared'], ['Celebrating', 'Celebrated']],
}

/** The verb a theme lends a turn: the same answer for the same turn id, null for a theme with none. */
export function pickVerb(themeId: string, turnId: string): readonly [string, string] | null {
  const verbs = VERBS[themeId]
  if (!verbs || verbs.length === 0) return null
  const h = [...turnId].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)
  return verbs[h % verbs.length] ?? null
}
