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
const LEAF: Record<Kind, string> = { ...OUTLINE, search: '✤', web: '❧' } // heavy four-balloon asterisk, rotated floral heart

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
]

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
}

/** The verb a theme lends a turn: the same answer for the same turn id, null for a theme with none. */
export function pickVerb(themeId: string, turnId: string): readonly [string, string] | null {
  const verbs = VERBS[themeId]
  if (!verbs || verbs.length === 0) return null
  const h = [...turnId].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)
  return verbs[h % verbs.length] ?? null
}
