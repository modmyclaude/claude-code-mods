// Wardrobe: restyles what a mod may draw (tool rows, tool results, diff cards,
// the spinner, the turn-duration line), switchable live with /wear.
//
// Display only: it reads and writes its own $.store and nothing else; no files,
// no processes, no network. Every hook that draws falls back to Claude Code's
// own drawing when it has nothing to add, and when it fails.

import { atom, read } from 'claude-code'
import type { EngineInterface, Register, RenderElement, Timer } from 'claude-code'

import type { WardrobeApp, WardrobeLook } from '../types'
import { clean, diffCard, shellCard } from './content'
import { describeLook, diffTree, dressedBolt, groupRow, listText, listTree, messageRow, shellTree, spinnerRow, switchBand, toolRow, turnRow, wearingLabel } from './draw'
import { AUTO, CHOICES, DEFAULT, parseWear, pinsOf, resolveLook, sameLook, type Settings, settingsFrom } from './look'
import { pickVerb, themeById, type Theme } from './themes'

const LOOK = { plugin: 'wardrobe', key: 'look' } as const
const TIMING = { plugin: 'wardrobe', key: 'timing' } as const
const SWITCH = { plugin: 'wardrobe', key: 'switch' } as const
const VERB = { plugin: 'wardrobe', key: 'verb' } as const
const APP = { plugin: 'wardrobe', key: 'app' } as const

const look = atom(LOOK, { theme: DEFAULT, choice: DEFAULT, scope: 'global', phase: null, root: '' })
/** The last `/wear` that put a theme on, for the switch band; null before the first. */
const switched = atom(SWITCH, null)
/** The verb this turn wears, picked at turn start from the theme worn then; null until a turn starts. */
const verb = atom(VERB, null)
/** Claude Code's own theme tone, read from its theme setting; `unknown` for a custom theme or where the row cannot be read. */
const app = atom(APP, { tone: 'unknown' })

/** How often the worn theme is re-resolved: auto mode's switch, the season's, a choice made in another session. */
const TICK_MS = 60_000
/** How long the switch band stays above the prompt after `/wear`. */
const BAND_MS = 6_000
/** A band narrower than this has no room for Bolt beside the words. */
const BAND_BOLT_MIN_COLUMNS = 60

/** The pane `/wear` lists the themes in. */
const PANE = 'wardrobe'

type Dollar = Pick<EngineInterface, 'state' | 'store' | 'session' | 'clock' | 'ui' | 'config'>

/**
 * Where wardrobe draws in place of a component (a result card, the turn line),
 * it first asks what lies beneath: when another mod drew its own
 * tree there, that tree stands and wardrobe steps aside.
 */
const drewOwn = (below: RenderElement) => below.type !== 'engine'

/** Works out what to wear now and publishes it; every drawing that reads it redraws. */
async function refresh($: Dollar, settings: Settings): Promise<WardrobeLook> {
  const root = await $.session.root()
  const global = await $.store.get('global')
  const pins = await $.store.get('pins')
  const now = await $.clock.now()
  const fresh = resolveLook({ root, global, pins, now, settings })
  // Compared field by field (state crosses as JSON, so identity never matches):
  // an unchanged look writes nothing and redraws nothing.
  const current = await $.state.get(LOOK)
  if (!sameLook(current.value, fresh)) await $.state.set(LOOK, fresh)
  return fresh
}

/**
 * `/wear <choice>`: changes what this project shows (its pin if it has one,
 * else the global choice). A theme put on (by name, or by `auto` or `season`
 * resolving to one) raises the switch band, which one timer takes down.
 */
async function wear($: Dollar, settings: Settings, choice: string): Promise<string> {
  const root = await $.session.root()
  const pins = pinsOf(await $.store.get('pins'))
  if (Object.hasOwn(pins, root)) {
    pins[root] = choice
    await $.store.set('pins', pins)
  } else {
    await $.store.set('global', choice)
  }
  const look = await refresh($, settings)
  if (themeById(look.theme)) {
    await $.state.set(SWITCH, { theme: look.theme, at: await $.clock.now() })
    $.clock.after(BAND_MS, () => $.ui.invalidate('ui.render'))
  }
  const worn = themeById(look.theme)
  const note = worn ? lightNote(worn, (await read($, app)).tone) : ''
  return describeLook(look, settings) + note + (await elsewhere($, look))
}

/** The tone of a Claude Code theme value: `dark`, `dark-ansi`, `light-daltonized`, or a plugin's `custom:...` (unknown). */
function toneOf(value: unknown): WardrobeApp['tone'] {
  if (typeof value !== 'string') return 'unknown'
  if (value.startsWith('light')) return 'light'
  if (value.startsWith('dark')) return 'dark'
  return 'unknown'
}

/** Reads Claude Code's theme tone into state; a row that cannot be read leaves it unknown. */
async function readAppTone($: Pick<EngineInterface, 'config' | 'state'>): Promise<void> {
  const row = await $.config.list().then(rows => rows.find(r => r.key === 'theme')).catch(() => undefined)
  await $.state.set(APP, { tone: toneOf(row?.value) })
}

/**
 * Whether a look may paint its background on this surface: a dark look always;
 * a light look only on a terminal whose Claude Code theme is light, since light
 * panels under the app's light text are unreadable, and the desktop's own theme
 * cannot be read. Elsewhere the look keeps its stripe and colours, no fill.
 */
function fills(theme: Theme, surface: string, tone: WardrobeApp['tone']): boolean {
  return theme.tone === 'dark' || (surface === 'terminal' && tone === 'light')
}

/** The one line a light look gets where it cannot paint: what it is for, and how to match the app to it. */
function lightNote(theme: Theme, tone: WardrobeApp['tone']): string {
  return theme.tone === 'light' && tone !== 'light' ? ` ${theme.id} is made for a light theme; /wear ${theme.id} --match sets Claude Code's theme to match.` : ''
}

/** The store key holding the theme Claude Code had before a match, so `/wear default` can put it back. */
const OWN_THEME = 'ownTheme'

/** The built-in theme nearest a look: its tone, keeping the person's variant (daltonized, ansi) where that option exists. */
function nearestTheme(tone: 'dark' | 'light', current: string, options: readonly string[]): string {
  const suffix = current.startsWith('dark') ? current.slice(4) : current.startsWith('light') ? current.slice(5) : ''
  const kept = tone + suffix
  return options.includes(kept) ? kept : tone
}

/**
 * `/wear <look> --match` and the gallery's `match theme` button: sets Claude Code's
 * own `theme` to the built-in nearest the look, as the person could in /config,
 * and remembers the theme they had so `/wear default` puts it back. Only ever on
 * their word; a refusal (another plugin's hook, a locked row) is reported, not retried.
 */
async function matchTheme($: Dollar, settings: Settings): Promise<string> {
  const look = await refresh($, settings)
  const theme = themeById(look.theme)
  if (!theme) return 'No look is worn, so there is no theme to match. Wear one first: /wear <theme> --match.'
  const row = (await $.config.list()).find(r => r.key === 'theme')
  if (!row || typeof row.value !== 'string') return "Claude Code's theme setting was not found; nothing changed."
  const current = row.value
  const target = nearestTheme(theme.tone, current, row.options ?? [])
  if (target === current) return `Claude Code's theme is already ${current}.`
  if (row.isLocked) return `Claude Code's theme stays ${current}: the setting is locked.`
  const own = await $.store.get(OWN_THEME)
  if (typeof own !== 'string') await $.store.set(OWN_THEME, current)
  const out = await $.config.set({ key: 'theme', value: target })
  if (out.deny !== undefined) {
    if (typeof own !== 'string') await $.store.delete(OWN_THEME)
    return `Claude Code's theme stays ${current}: ${clean(out.deny)}`
  }
  await $.state.set(APP, { tone: toneOf(target) })
  return `Claude Code's theme set to ${target} to match ${theme.id} (was ${current}). /wear default puts it back.`
}

/** `/wear default` after a match: Claude Code's theme goes back to the one the person had. */
async function restoreTheme($: Dollar): Promise<string> {
  const own = await $.store.get(OWN_THEME)
  if (typeof own !== 'string') return ''
  const out = await $.config.set({ key: 'theme', value: own })
  if (out.deny !== undefined) return ` Claude Code's theme stays as it is: ${clean(out.deny)} Run /wear default again to retry.`
  await $.store.delete(OWN_THEME)
  await $.state.set(APP, { tone: toneOf(own) })
  return ` Claude Code's theme is back to ${own}.`
}

/** Names the attached surfaces wardrobe does not restyle, so a theme never seems to fail there. */
async function elsewhere($: Pick<EngineInterface, 'session'>, look: WardrobeLook): Promise<string> {
  if (look.choice === DEFAULT) return ''
  const attached = await $.session.surfaces().catch(() => [])
  const others = attached.filter(surface => surface !== 'terminal' && surface !== 'desktop')
  return others.length === 0 ? '' : ` On ${others.join(' and ')}, Claude Code draws its own look.`
}

/** `/wear pin`: this project keeps what it wears now, whatever the global choice becomes. */
async function pin($: Dollar, settings: Settings): Promise<string> {
  const now = await refresh($, settings)
  const pins = pinsOf(await $.store.get('pins'))
  pins[now.root] = now.choice
  await $.store.set('pins', pins)
  const after = await refresh($, settings)
  const what = after.choice === DEFAULT ? "Claude Code's own look" : after.choice
  return `Pinned ${what} to ${clean(after.root)}. Other projects keep the global choice.`
}

/** `/wear unpin`: this project follows the global choice again. */
async function unpin($: Dollar, settings: Settings): Promise<string> {
  const root = await $.session.root()
  const pins = pinsOf(await $.store.get('pins'))
  if (!Object.hasOwn(pins, root)) return `${clean(root)} has no pin. ${describeLook(await refresh($, settings), settings)}`
  delete pins[root]
  await $.store.set('pins', pins)
  return `Unpinned ${clean(root)}. ${describeLook(await refresh($, settings), settings)}`
}

// What /wear says is for the person, never the model: a command's `text` is a
// row the model reads, so /wear answers `{}` and shows its words itself.

/** A line for the person: a toast, or a log line where nothing draws one (a `-p` run). */
async function say($: Pick<EngineInterface, 'session' | 'ui'>, text: string, timeoutMs = 4000): Promise<void> {
  const surfaces = await $.session.surfaces().catch(() => [])
  if (surfaces.length === 0) $.ui.log(text)
  else $.ui.toast(text, { timeoutMs })
}

/** The theme list: a pane in each theme's own colours, or the text where no pane is drawn. */
async function showList($: Pick<EngineInterface, 'session' | 'ui'>, text: string): Promise<void> {
  const surfaces = await $.session.surfaces().catch(() => [])
  const opened = surfaces.length === 0 ? undefined : await $.ui.open({ id: PANE, title: 'Wardrobe' }).catch(() => undefined)
  if (opened?.isPlaced !== true) $.ui.log(text)
}

export const register: Register = (on, options) => {
  const { settings, problems } = settingsFrom(options)
  // Bad auto settings are named where they matter: the list and /wear auto.
  const autoNote = (choice: string) => (choice === AUTO && problems.length > 0 ? ` Settings: ${problems.join('; ')}.` : '')
  let ticker: Timer | undefined

  on('session.start', async ($, e, next) => {
    // Each step on its own: a failure in one never costs the others, or the session.
    await $.command
      .register({
        name: 'wear',
        description: 'Restyle Claude Code: list themes, or wear one, auto, pin or unpin',
        argumentHint: '[theme | auto | pin | unpin]',
        immediate: true,
      })
      .catch(() => undefined)
    // A store or clock that cannot answer leaves Claude Code's own look on.
    await refresh($, settings).catch(() => undefined)
    await readAppTone($).catch(() => undefined)
    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => {
      refresh($, settings).catch(() => undefined)
    })
    return next(e)
  })

  // Answers its own command; it only ever changes wardrobe's own store, and it
  // answers `{}`: nothing it says is added to what the model reads.
  on('command.run', { command: 'wear' }, async ($, e) => {
    const command = parseWear(e.args)
    if (command.kind === 'list') {
      await showList($, listText(await refresh($, settings), settings, problems, await $.clock.now()))
    } else if (command.kind === 'unknown') {
      await say($, `No theme called "${clean(command.word)}". Try one of: ${CHOICES.join(', ')}; or pin, unpin.`, 8000)
    } else if (command.kind === 'wear') {
      let text = (await wear($, settings, command.choice)) + autoNote(command.choice)
      if (command.choice === DEFAULT) text += await restoreTheme($)
      else if (command.match) text += ' ' + (await matchTheme($, settings))
      await say($, text)
    } else if (command.kind === 'match') {
      await say($, await matchTheme($, settings), 6000)
    } else {
      await say($, command.kind === 'pin' ? await pin($, settings) : await unpin($, settings))
    }
    return {}
  }).catch($ => {
    $.ui.toast('/wear could not finish. Run /wear to see what is worn.')
    return {}
  })

  // Why a display mod hooks tool.call: it is the only place a call's start and
  // end can be timed, for the timing on its row. It only watches: `e` goes on
  // unchanged, the result comes back unchanged, it never refuses, and if it
  // fails the call goes on untouched (the .catch passes, it does not deny).
  on('tool.call', async ($, e, next) => {
    if (!e.tool_use_id) return next(e)
    const ref = { ...TIMING, id: e.tool_use_id }
    const startedAt = await $.clock.now()
    await $.state.set(ref, { startedAt, ms: null })
    const ran = await next(e)
    await $.state.set(ref, { startedAt, ms: Math.max(0, (await $.clock.now()) - startedAt) })
    return ran
  }).catch(($, e, next) => next(e))

  // Tool rows: the theme's icon and a status/timing chip around the engine's own row.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const theme = themeById((await read($, look)).theme)
    if (!theme) return next(e)
    const timing = await read($, { ...TIMING, id: e.props.tool_use_id })
    return toolRow($.ui.resolve(e), theme, e.props, timing, await next(e), e.viewport?.columns)
  }).catch(($, e, next) => next(e))

  // A folded run of reads and searches: one icon per call before the engine's count line.
  // Unfolded, each call is its own ToolUse row and is restyled there.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if (e.props.isExpanded || e.props.calls.length === 0) return next(e)
    const theme = themeById((await read($, look)).theme)
    if (!theme) return next(e)
    return groupRow($.ui.resolve(e), theme, e.props.calls, await next(e))
  }).catch(($, e, next) => next(e))

  // Results: diff cards and small plain shell output in the theme's colours;
  // anything else (errors, big or unusual output) the engine draws.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if (e.props.isErrored) return next(e)
    const worn = await read($, look)
    const theme = themeById(worn.theme)
    if (!theme) return next(e)
    const diff = diffCard(e.props.tool, e.props.output)
    const shell = !diff && e.props.tool === 'Bash' ? shellCard(e.props.output) : null
    if (!diff && !shell) return next(e)
    const below = await next(e)
    if (drewOwn(below)) return below
    if (diff) return diffTree($.ui.resolve(e), theme, diff, worn.root)
    return shell ? shellTree($.ui.resolve(e), theme, shell) : below
  }).catch(($, e, next) => next(e))

  // Transcript rows (transcript rows): the person's prompt, each reply block and a
  // command's output drawn on the look's background behind a stripe. The engine's row
  // stays its own (a rewrite of its props is never made); only the look is read,
  // never the clock, so the desktop has nothing to redraw mid-turn.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const theme = themeById((await read($, look)).theme)
    if (!theme) return next(e)
    return messageRow($.ui.resolve(e), theme, 'UserMessage', await next(e), { surface: e.surface, fill: fills(theme, e.surface, (await read($, app)).tone) })
  }).catch(($, e, next) => next(e))
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const theme = themeById((await read($, look)).theme)
    if (!theme) return next(e)
    return messageRow($.ui.resolve(e), theme, 'AssistantMessage', await next(e), { surface: e.surface, fill: fills(theme, e.surface, (await read($, app)).tone) })
  }).catch(($, e, next) => next(e))
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const theme = themeById((await read($, look)).theme)
    if (!theme) return next(e)
    return messageRow($.ui.resolve(e), theme, 'CommandOutput', await next(e), { surface: e.surface, fill: fills(theme, e.surface, (await read($, app)).tone) })
  }).catch(($, e, next) => next(e))

  // Claude Code's theme changed in /config (another plugin's set reaches here too; wardrobe's
  // own calls skip its hooks and update the tone themselves): re-read the tone once it is written.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const out = await next(e)
    if (out.deny === undefined) await $.state.set(APP, { tone: toneOf(out.value) })
    return out
  }).catch(($, e, next) => next(e))

  // One verb per turn for the spinner and the closing line: picked when the
  // turn starts, from the theme worn then, and held until the next turn starts.
  on('turn.start', async ($, e, next) => {
    const theme = themeById((await read($, look)).theme)
    const pick = theme ? pickVerb(theme.id, e.turnId) : null
    await $.state.set(VERB, pick ? { turnId: e.turnId, present: pick[0], past: pick[1] } : null)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The prompt footer: `wearing <theme>` after the engine's own mode labels, as
  // long as a theme is worn, so the look stays named after the switch band goes.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const theme = themeById((await read($, look)).theme)
    if (!theme) return next(e)
    return wearingLabel($.ui.resolve(e), theme, e.props.modes.length > 0, await next(e))
  }).catch(($, e, next) => next(e))

  // The hint line under the prompt, on the terminal: the engine's line and its
  // live pills as they are, with the theme's mark and name dim at the end. Not
  // while typing, when the line is about the draft. The desktop draws no tail.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isDraft) return next(e)
    const theme = themeById((await read($, look)).theme)
    if (!theme) return next(e)
    return next({ ...e, props: { ...e.props, tail: ` ${theme.mark} ${theme.id}` } })
  }).catch(($, e, next) => next(e))

  // The spinner: the theme's suffix after the word; on the terminal, a chip
  // naming what the turn is doing. Elapsed time and tokens stay the engine's,
  // and so does any status message of its own ("Running tests..."): while one
  // shows, its text is left exactly as the engine wrote it.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const theme = themeById((await read($, look)).theme)
    if (!theme) return next(e)
    // The turn's verb replaces the engine's word on the terminal, and on the desktop
    // only while the row says nothing of its own ("Working"); a status message of
    // the engine's, and a desktop step ("Creating notes.md"), are left as written.
    const worn = await read($, verb)
    const lends = worn !== null && (e.surface === 'terminal' || e.props.word === 'Working')
    const engine = await next(e.props.message === null ? { ...e, props: { ...e.props, word: lends ? worn.present : e.props.word, suffix: theme.spinnerSuffix } } : e)
    return e.surface === 'terminal' ? spinnerRow($.ui.resolve(e), theme, e.props.mode, engine, e.viewport?.columns) : engine
  }).catch(($, e, next) => next(e))

  // The line closing a turn; the engine raises it on the terminal alone.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { word, durationMs } = e.props
    if (typeof word !== 'string' || !Number.isFinite(durationMs) || durationMs < 0) return next(e)
    const theme = themeById((await read($, look)).theme)
    if (!theme) return next(e)
    const below = await next(e)
    const worn = await read($, verb)
    return drewOwn(below) ? below : turnRow($.ui.resolve(e), theme, worn ? worn.past : word, durationMs)
  }).catch(($, e, next) => next(e))

  // The switch band: for a few seconds after /wear, one themed row above the
  // prompt with Bolt in the theme's costume. What is beneath (other mods'
  // bands, the engine's own) draws first and is never under a sized Box; a
  // survey holding the band is left alone. Nothing is drawn when no switch
  // happened, and the one timer `wear` set takes the band down.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const last = await read($, switched)
    const theme = last === null ? undefined : themeById(last.theme)
    if (last === null || !theme || (await $.clock.now()) - last.at >= BAND_MS) return next(e)
    const below = await next(e)
    const { Box } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const bolt = columns >= BAND_BOLT_MIN_COLUMNS ? dressedBolt($.ui.resolve(e), e.surface, theme, 'tiny', 'wardrobe-bolt') : null
    return (
      <Box flexDirection="column">
        {below}
        {switchBand($.ui.resolve(e), theme, columns, bolt, fills(theme, e.surface, (await read($, app)).tone))}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // The `/wear` gallery: a card per theme in its own colours with Bolt in its
  // costume, the worn one marked, a `wear` button on each.
  // Box, Text and Button, but for Bolt's Raster on the terminal.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const onWear = (choice: string) => {
      wear($, settings, choice)
        .then(text => say($, text + autoNote(choice)))
        .catch(() => undefined)
        .finally(() => $.ui.invalidate('ui.render'))
    }
    return listTree($.ui.resolve(e), {
      surface: e.surface,
      look: await read($, look),
      settings,
      problems,
      columns: e.props.bodyColumns,
      now: await $.clock.now(),
      onWear,
      onMatch: (choice: string) => {
        wear($, settings, choice)
          .then(async text => say($, text + autoNote(choice) + ' ' + (await matchTheme($, settings)), 6000))
          .catch(() => undefined)
          .finally(() => $.ui.invalidate('ui.render'))
      },
    })
  }).catch(($, e, next) => next(e))
}
