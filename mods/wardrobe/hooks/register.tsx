// Wardrobe: restyles what a mod may draw (tool rows, tool results, diff cards,
// the spinner, the turn-duration line), switchable live with /wear, and in the
// desktop app dresses the app itself: the look's palette on its page, panels,
// text and accents, and an animated scene behind the chat.
//
// Display only. It reads and writes its own $.store and the session's theme
// (the look's palette and scene); and when a look is put on it sets Claude
// Code's own `theme` setting to match, as the person could in /config, and
// puts theirs back on /wear default (the Match setting turns that off). No
// files, no processes, no network. Every hook that draws falls back to Claude
// Code's own drawing when it has nothing to add, and when it fails.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, Timer } from 'claude-code'

import type { WardrobeApp, WardrobeLook } from '../types'
import { appColors } from './app-colors'
import { clean, diffCard, shellCard } from './content'
import { describeLook, diffTree, dressedBolt, groupRow, listText, listTree, messageRow, shellTree, spinnerRow, switchBand, toolRow, turnRow, wearingLabel } from './draw'
import { AT_REST, gpuValues } from './live'
import { AUTO, CHOICES, DEFAULT, minuteOfDay, parseWear, pinsOf, resolveLook, sameLook, type Settings, settingsFrom } from './look'
import { glassFor, hasScene, sceneOf } from './scenes'
import { lightAt, sameLight } from './sky'
import { teamNote, wornTheme } from './tailor'
import { pickVerb, themeById, THEMES, type Theme } from './themes'

const LOOK = { plugin: 'wardrobe', key: 'look' } as const
const TIMING = { plugin: 'wardrobe', key: 'timing' } as const
const SWITCH = { plugin: 'wardrobe', key: 'switch' } as const
const VERB = { plugin: 'wardrobe', key: 'verb' } as const
const APP = { plugin: 'wardrobe', key: 'app' } as const
const BACKDROP = { plugin: 'wardrobe', key: 'backdrop' } as const
const GALLERY = { plugin: 'wardrobe', key: 'gallery' } as const
const LIVE = { plugin: 'wardrobe', key: 'live' } as const
const SKY = { plugin: 'wardrobe', key: 'sky' } as const
/** The store key that turns the wallpapers off (`off`); absent or anything else, they are on. */
const WALLPAPER = 'wallpaper'

const look = atom(LOOK, { theme: DEFAULT, choice: DEFAULT, scope: 'global', phase: null, root: '' })
/** The last `/wear` that put a theme on, for the switch band; null before the first. */
const switched = atom(SWITCH, null)
/** The verb this turn wears, picked at turn start from the theme worn then; null until a turn starts. */
const verb = atom(VERB, null)
/** Claude Code's own theme tone, read from its theme setting; `unknown` for a custom theme or where the row cannot be read. */
const app = atom(APP, { tone: 'unknown' })
/** The theme wardrobe set for the app, if any: the look whose palette it is, and its scene behind the chat. */
const backdrop = atom(BACKDROP, { look: null, scene: null, isDrawn: false })
/** The family of looks the gallery shows; null until one is picked, and then the worn look's own. */
const gallery = atom(GALLERY, { family: null })
/** What a scene on the GPU is told of the session: whether Claude works. */
const live = atom(LIVE, AT_REST)
/** The light of the local hour, which a scene stands in; null until the clock is first read, and with the clock light off. */
const sky = atom(SKY, null)

/** How often the worn theme is re-resolved: auto mode's switch, the season's, a choice made in another session. */
const TICK_MS = 60_000
/** How long the switch band stays above the prompt after `/wear`. */
const BAND_MS = 6_000
/** A band narrower than this has no room for Bolt beside the words. */
const BAND_BOLT_MIN_COLUMNS = 60

/** The pane `/wear` lists the themes in. */
const PANE = 'wardrobe'

type Dollar = Pick<EngineInterface, 'state' | 'store' | 'session' | 'clock' | 'ui' | 'config' | 'theme'>

/**
 * Where wardrobe draws in place of a component (a result card, the turn line),
 * it first asks what lies beneath: when another mod drew its own
 * tree there, that tree stands and wardrobe steps aside.
 */
const drewOwn = (below: RenderElement) => below.type !== 'engine'

/**
 * Whether this engine has the theme noun, which Claude Code 2.1.325 brought,
 * learnt from the first set: an older engine throws a TypeError there, and the
 * wallpaper is left alone on it while the look goes on. Unknown until then.
 */
let themeNoun: 'present' | 'absent' | null = null

/**
 * The plugin whose scene was last drawn in place of ours, said once. Module
 * state, not `$.state`: a drawing may not write state, and a reload, which
 * sets our scene again, rightly starts it over.
 */
let holder: string | null = null

/**
 * What `refresh` does about the app's theme: `start` puts the worn look's up
 * (an unload took the last one down); `follow` sets one that changed; `force`
 * sets it again even unchanged, as `/wear` does to bring it back from under
 * another plugin's. Absent, the theme is left as it is.
 */
type Dress = 'start' | 'follow' | 'force'

/**
 * Publishes the light of the hour, for the scene behind the chat. It moves in
 * steps and stands still all day and all night, and only a light that moved is
 * written: the scene is drawn again a few times an hour at dawn and dusk, and
 * never between.
 */
async function tellHour($: Pick<EngineInterface, 'state'>, now: number, settings: Settings): Promise<void> {
  const light = settings.clockLight ? lightAt(minuteOfDay(now), settings.dayStarts, settings.nightStarts) : null
  const current = await $.state.get(SKY)
  if (!sameLight(current.value, light)) await $.state.set(SKY, light)
}

/** Works out what to wear now and publishes it; every drawing that reads it redraws. */
async function refresh($: Dollar, settings: Settings, how?: Dress): Promise<WardrobeLook> {
  const root = await $.session.root()
  const global = await $.store.get('global')
  const pins = await $.store.get('pins')
  const now = await $.clock.now()
  // The hour's light first, so a scene set below is drawn in it from its first frame; a failure here never costs the look.
  await tellHour($, now, settings).catch(() => undefined)
  const fresh = resolveLook({ root, global, pins, now, settings })
  // Compared field by field (state crosses as JSON, so identity never matches):
  // an unchanged look writes nothing and redraws nothing.
  const current = await $.state.get(LOOK)
  const changed = !sameLook(current.value, fresh)
  if (changed) await $.state.set(LOOK, fresh)
  // The app's theme rides along: an engine without the theme noun, or one that cannot answer, leaves the look as it is.
  if (how !== undefined) await dress($, fresh, how, settings).catch(() => undefined)
  // A look that changed by itself (the clock, the calendar, a choice made in another session) may have
  // come with a theme set there: the tone is read again, and a match already made follows the look.
  // Only the look every project shares carries a match: one theme setting serves the whole machine,
  // and a pinned project's look must not turn the others' over (matchTheme holds the rest of the rule).
  if (how === 'follow' && changed) await readAppTone($).catch(() => undefined)
  if (settings.matchTheme && fresh.scope === 'global' && (how === 'start' || (how === 'follow' && changed))) await matchTheme($, fresh, 'carry').catch(() => undefined)
  return fresh
}

/**
 * Dresses the app in the worn look: its palette, its light or dark mode and,
 * with wallpapers on, its scene behind the chat; or takes wardrobe's own theme
 * down. `$.theme.set` names the whole theme and the latest set stands, so a
 * set replaces any plugin's earlier one, and wallpapers off is a set with no
 * scene in it. `$.theme.clear` clears the session's theme whoever set it, so
 * wardrobe clears only where its own stands, and never at session start,
 * where an unload already took its own down.
 */
async function dress($: Dollar, look: WardrobeLook, how: Dress, settings: Settings): Promise<void> {
  if (themeNoun === 'absent') return
  // A sports look goes on in the team's colours where the settings give them: its palette and its scene both.
  const worn = wornTheme(look.theme, settings)
  // A value an older version kept has no `look` in it: read as none.
  const standing = { look: null, ...(await read($, backdrop)) }
  if (worn === undefined) {
    if (standing.look === null && standing.scene === null) return
    await $.state.set(BACKDROP, { look: null, scene: null, isDrawn: false })
    // Where another plugin's scene was seen in place of ours, the theme that stands is theirs: left alone.
    if (how !== 'start' && holder === null) await $.theme.clear()
    holder = null
    return
  }
  const scene = hasScene(worn) && (await $.store.get(WALLPAPER)) !== 'off' ? worn.id : null
  if (how === 'follow' && standing.look === worn.id && standing.scene === scene) return
  // Built before the call, so that only the call itself can tell of an engine with no theme noun.
  const attributes = {
    colors: appColors(worn).colors,
    overrideColorScheme: worn.tone,
    ...(scene === null ? {} : { backdrop: { scene, glass: glassFor(worn, settings.glass) } }),
  }
  let set: { isDrawn: boolean }
  try {
    set = await $.theme.set(attributes)
  } catch (err) {
    if (err instanceof TypeError) {
      themeNoun = 'absent'
      return
    }
    throw err
  }
  themeNoun = 'present'
  holder = null
  await $.state.set(BACKDROP, { look: worn.id, scene, isDrawn: set.isDrawn })
}

/** What `/wear wallpaper` answers: on or off, and where the scene draws. */
async function wallpaperText($: Dollar, look: WardrobeLook, changed: boolean | null): Promise<string> {
  const on = (await $.store.get(WALLPAPER)) !== 'off'
  const lead = changed === null ? `Wallpapers are ${on ? 'on' : 'off'}.` : on ? 'Wallpapers on.' : 'Wallpapers off.'
  const theme = themeById(look.theme)
  if (!on) return theme === undefined ? `${lead} Nothing of wardrobe's draws behind the chat.` : `${lead} The look stays; nothing of wardrobe's draws behind the chat.`
  const scene = theme !== undefined && hasScene(theme) ? `The ${theme.id} scene draws behind the chat in the desktop app.` : 'Wear a look and its scene draws behind the chat in the desktop app.'
  const standing = await read($, backdrop)
  const nowhere = themeNoun === 'absent' || (standing.scene !== null && !standing.isDrawn)
  const where = nowhere
    ? ' Nothing here draws it yet: wallpapers need the desktop app on Claude Code 2.1.325 or newer.'
    : holder !== null && standing.scene !== null
      ? ` ${clean(holder)} draws the backdrop now; /wear ${standing.scene} brings ours back.`
      : ''
  return `${lead} ${scene}${where}`
}

/**
 * `/wear <choice>`: changes what this project shows (its pin if it has one,
 * else the global choice); with `everywhere`, what every project shows: the
 * global choice, and every pin let go. A theme put on (by name, or by `auto`
 * or `season` resolving to one) raises the switch band, which one timer takes
 * down.
 */
async function wear($: Dollar, settings: Settings, choice: string, everywhere = false): Promise<string> {
  const root = await $.session.root()
  const pins = pinsOf(await $.store.get('pins'))
  let letGo = ''
  if (everywhere) {
    const count = Object.keys(pins).length
    if (count > 0) await $.store.set('pins', {})
    await $.store.set('global', choice)
    // With no pin left, a match made in a pinned project is the shared look's now.
    await $.store.delete(MATCH_ROOT)
    // Every session reads the same store, and re-resolves its look each minute.
    letGo = `${count === 0 ? '' : count === 1 ? ' One project pin was let go.' : ` ${count} project pins were let go.`} Sessions already open follow within a minute.`
  } else if (Object.hasOwn(pins, root)) {
    pins[root] = choice
    await $.store.set('pins', pins)
  } else {
    await $.store.set('global', choice)
  }
  const look = await refresh($, settings, 'force')
  if (themeById(look.theme)) {
    await $.state.set(SWITCH, { theme: look.theme, at: await $.clock.now() })
    $.clock.after(BAND_MS, () => $.ui.invalidate('ui.render'))
  }
  return describeLook(look, settings) + letGo + (await elsewhere($, look))
}

/**
 * `/wear <choice>` whole, from the command or a gallery button: the look goes
 * on, then Claude Code's own theme follows it (said in full on `--match`,
 * quietly where the Match setting is on) or, on `default`, goes back to the
 * person's own. The quiet match is the shared look's alone: a pinned project's
 * look is its own, and leaves the one theme setting to `--match`. `note` is
 * what the caller has to add about the choice itself.
 */
async function putOn($: Dollar, settings: Settings, choice: string, how: { match?: boolean; everywhere?: boolean }, note: string): Promise<string> {
  const said = (await wear($, settings, choice, how.everywhere === true)) + note
  const worn = await read($, look)
  const text = said + teamNote(worn.theme, settings)
  if (choice === DEFAULT) return text + (await restoreTheme($, worn))
  if (how.match === true) return `${text} ${await matchTheme($, worn, 'said')}`
  const tried = settings.matchTheme && worn.scope === 'global'
  const matched = tried ? await matchTheme($, worn, 'quiet').catch(() => '') : ''
  // Where the match said something (the first change, or a refusal) that is the whole of it.
  return text + (matched === '' ? await lightNoteNow($, !tried) : ` ${matched}`)
}

/** How long a `/wear` answer stays up: longer when it has a second sentence to read. */
const readingMs = (text: string) => (text.length > 110 ? 7000 : 4000)

/** The light-look line for what is worn now, where it cannot paint; empty otherwise. `hint` names `--match` where no match was tried. */
async function lightNoteNow($: Dollar, hint: boolean): Promise<string> {
  const worn = themeById((await read($, look)).theme)
  return worn ? lightNote(worn, (await read($, app)).tone, hint) : ''
}

/** The id Claude Code gives a theme file wardrobe ships: `custom:<plugin>:<slug>`, one per look. */
const ownThemeId = (id: string) => `custom:wardrobe:${id}`

/** The tone of a Claude Code theme value: `dark`, `dark-ansi`, `light-daltonized`, one of wardrobe's own theme files, or another plugin's `custom:...` (unknown). */
function toneOf(value: unknown): WardrobeApp['tone'] {
  if (typeof value !== 'string') return 'unknown'
  if (value.startsWith('light')) return 'light'
  if (value.startsWith('dark')) return 'dark'
  const own = THEMES.find(t => ownThemeId(t.id) === value)
  return own ? own.tone : 'unknown'
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

/**
 * The one line a light look gets where it cannot paint: what it is for, and,
 * where no match was tried (the setting is off, or the project is pinned), how
 * to match the app to it. Where one was tried, what stopped it was said (a
 * refusal) or is not theirs to change here (a locked setting).
 */
function lightNote(theme: Theme, tone: WardrobeApp['tone'], hint: boolean): string {
  if (theme.tone !== 'light' || tone === 'light') return ''
  return hint ? ` ${theme.id} is made for a light theme; /wear ${theme.id} --match sets Claude Code's theme to match.` : ` ${theme.id} is made for a light theme.`
}

/** The store key holding the theme Claude Code had before a match, so `/wear default` can put it back. */
const OWN_THEME = 'ownTheme'
/** The store key holding the theme wardrobe last set, so a restore can tell when the person changed it since. */
const MATCHED_THEME = 'matchedTheme'
/**
 * The store key naming the pinned project a match was made in (with `--match`,
 * on the person's word); absent, the match is the look's that every project
 * shares. A match belongs to where it was made: only from there does it move
 * with the look, and only `/wear default` there gives the theme back.
 */
const MATCH_ROOT = 'matchRoot'

/** The built-in theme nearest a look: its tone, keeping the person's variant (daltonized, ansi) where that option exists. */
function nearestTheme(tone: 'dark' | 'light', current: string, options: readonly string[]): string {
  const suffix = current.startsWith('dark') ? current.slice(4) : current.startsWith('light') ? current.slice(5) : ''
  const kept = tone + suffix
  return options.includes(kept) ? kept : tone
}

/**
 * How a match is made. `said`: on the person's word (`--match`, `/wear match`,
 * the gallery's `match theme` button), answered in full. `quiet`: with a look
 * put on in a project with no pin while the Match setting is on, saying only
 * the first change and a refusal. `carry`: by itself, when the shared look
 * changed without a `/wear` here; it only moves a match the shared look made
 * and that still stands exactly as wardrobe left it, never starts one, and
 * says nothing. Where the look that follows is Claude Code's own (auto by day,
 * say), a carry sets the person's own theme and keeps the match for the look
 * after it.
 */
type Match = 'said' | 'quiet' | 'carry'

/**
 * Sets Claude Code's own `theme` to the one nearest the look, as the person
 * could in /config, and remembers the theme they had so `/wear default` puts
 * it back. A refusal (another plugin's hook, a locked row) is reported, not
 * retried. A theme the person chose since the last match is theirs: it is what
 * `/wear default` then returns to, and a carry leaves it alone.
 */
async function matchTheme($: Dollar, look: WardrobeLook, mode: Match): Promise<string> {
  const said = mode === 'said'
  const theme = themeById(look.theme)
  if (!theme && mode !== 'carry') return said ? 'No look is worn, so there is no theme to match. Wear one first: /wear <theme> --match.' : ''
  const row = (await $.config.list()).find(r => r.key === 'theme')
  if (!row || typeof row.value !== 'string') return said ? "Claude Code's theme setting was not found; nothing changed." : ''
  const current = row.value
  const own = await $.store.get(OWN_THEME)
  const last = await $.store.get(MATCHED_THEME)
  // A match stands while the theme is still the one wardrobe set.
  const stands = typeof own === 'string' && (typeof last !== 'string' || last === current)
  if (mode === 'carry' && (typeof own !== 'string' || last !== current || (await $.store.get(MATCH_ROOT)) !== undefined)) return ''
  // The look's own theme file when Claude Code lists it (the input box border, the message
  // background and the diff colours then follow the look); else the nearest built-in.
  const options = row.options ?? []
  let target: string
  if (theme) target = options.includes(ownThemeId(theme.id)) ? ownThemeId(theme.id) : nearestTheme(theme.tone, current, options)
  else if (typeof own === 'string') target = own
  else return ''
  if (target === current) return said ? `Claude Code's theme is already ${current}.` : ''
  if (row.isLocked) return said ? `Claude Code's theme stays ${current}: the setting is locked.` : ''
  // Remembered first, so a change that lands is never one wardrobe cannot undo; taken back where it does not land.
  if (!stands) await $.store.set(OWN_THEME, current)
  const takeBack = async () => {
    if (!stands) await (typeof own === 'string' ? $.store.set(OWN_THEME, own) : $.store.delete(OWN_THEME))
  }
  let out: Awaited<ReturnType<Dollar['config']['set']>>
  try {
    out = await $.config.set({ key: 'theme', value: target })
  } catch (err) {
    await takeBack()
    throw err
  }
  if (out.deny !== undefined) {
    await takeBack()
    return mode === 'carry' ? '' : `Claude Code's theme stays ${current}: ${clean(out.deny)}`
  }
  await $.store.set(MATCHED_THEME, target)
  // On the person's word the match is where it was made; a carry leaves that as it is.
  if (mode !== 'carry') await (look.scope === 'project' ? $.store.set(MATCH_ROOT, look.root) : $.store.delete(MATCH_ROOT))
  await $.state.set(APP, { tone: toneOf(target) })
  if (!theme || mode === 'carry' || (mode === 'quiet' && stands)) return ''
  // The desktop app wears the look through its palette; the setting is the theme a terminal shows.
  const attached: readonly string[] = await $.session.surfaces().catch(() => [])
  const desktopNote = attached.includes('desktop') ? " The desktop app wears the look's own palette; this setting is the terminal's theme." : ''
  return `Claude Code's theme set to ${target} to match ${theme.id} (was ${current}). /wear default puts it back.${desktopNote}`
}

/**
 * `/wear default` after a match: Claude Code's theme goes back to the one the
 * person had, unless the theme was changed since the match (by them in another
 * session, or by hand): then their later choice stands and the memory is
 * dropped. Only from where the match was made: `/wear default` in a pinned
 * project leaves a match the shared look made, which other projects still
 * wear, and the other way round. A theme row that cannot be read is never
 * written over.
 */
async function restoreTheme($: Dollar, look: WardrobeLook): Promise<string> {
  const own = await $.store.get(OWN_THEME)
  if (typeof own !== 'string') return ''
  const here = look.scope === 'project' ? look.root : undefined
  if ((await $.store.get(MATCH_ROOT)) !== here) return ''
  const matched = await $.store.get(MATCHED_THEME)
  const rows = await $.config.list().catch(() => undefined)
  const row = rows?.find(r => r.key === 'theme')
  const current = typeof row?.value === 'string' ? row.value : undefined
  if (current === undefined) return " Claude Code's theme could not be read, so it stays as it is. Run /wear default again to retry."
  if (typeof matched === 'string' && current !== matched) {
    await forgetMatch($)
    return ` Claude Code's theme was changed since the match, so it stays ${clean(current)}.`
  }
  const out = await $.config.set({ key: 'theme', value: own })
  if (out.deny !== undefined) return ` Claude Code's theme stays as it is: ${clean(out.deny)} Run /wear default again to retry.`
  await forgetMatch($)
  await $.state.set(APP, { tone: toneOf(own) })
  return ` Claude Code's theme is back to ${own}.`
}

/** Forgets the matched theme, the one before it and where the match was made: nothing is left for `/wear default` to restore. */
async function forgetMatch($: Pick<EngineInterface, 'store'>): Promise<void> {
  await $.store.delete(OWN_THEME)
  await $.store.delete(MATCHED_THEME)
  await $.store.delete(MATCH_ROOT)
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
  const after = await refresh($, settings, 'follow')
  const what = after.choice === DEFAULT ? "Claude Code's own look" : after.choice
  return `Pinned ${what} to ${clean(after.root)}. Other projects keep the global choice.`
}

/**
 * `/wear unpin`: this project follows the global choice again. A match made on
 * this pin goes with it: the shared look takes it over (the refresh carries it
 * there), or, where that look is Claude Code's own, the person's theme comes
 * back.
 */
async function unpin($: Dollar, settings: Settings): Promise<string> {
  const root = await $.session.root()
  const pins = pinsOf(await $.store.get('pins'))
  if (!Object.hasOwn(pins, root)) return `${clean(root)} has no pin. ${describeLook(await refresh($, settings), settings)}`
  delete pins[root]
  await $.store.set('pins', pins)
  const handed = (await $.store.get(MATCH_ROOT)) === root
  if (handed) await $.store.delete(MATCH_ROOT)
  const now = await refresh($, settings, 'follow')
  const theme = handed && themeById(now.theme) === undefined ? await restoreTheme($, now) : ''
  return `Unpinned ${clean(root)}. ${describeLook(now, settings)}${theme}`
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

// Answers the mod's command, `/wear`, and `/wardrobe`, the same command under the mod's own name. It changes wardrobe's
// own store, the session's theme and, for the match, Claude Code's `theme` setting; and it answers `{}`: nothing it says
// is added to what the model reads.
async function answerWear($: Dollar, args: string, settings: Settings, problems: readonly string[], autoNote: (choice: string) => string): Promise<Record<string, never>> {
  const command = parseWear(args)
  if (command.kind === 'list') {
    await showList($, listText(await refresh($, settings), settings, problems, await $.clock.now()))
  } else if (command.kind === 'unknown') {
    await say($, `No theme called "${clean(command.word)}". Try one of: ${CHOICES.join(', ')}; or pin, unpin, everywhere.`, 8000)
  } else if (command.kind === 'wear' || command.kind === 'everywhere') {
    // `/wear everywhere` alone: what this project wears now, for every project.
    const choice = command.kind === 'wear' ? command.choice : (await refresh($, settings)).choice
    const how = { match: command.match === true, everywhere: command.kind === 'everywhere' || command.everywhere === true }
    const text = await putOn($, settings, choice, how, autoNote(choice))
    await say($, text, readingMs(text))
  } else if (command.kind === 'match') {
    await say($, await matchTheme($, await refresh($, settings), 'said'), 6000)
  } else if (command.kind === 'wallpaper') {
    // A plain ask only answers; on or off is made so, and on sets the scene again, over anyone's.
    if (command.on !== null) await $.store.set(WALLPAPER, command.on ? 'on' : 'off')
    const look = command.on === null ? await refresh($, settings) : await refresh($, settings, 'force')
    await say($, await wallpaperText($, look, command.on), 6000)
  } else {
    await say($, command.kind === 'pin' ? await pin($, settings) : await unpin($, settings))
  }
  return {}
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
        argumentHint: '[theme [everywhere] | auto | season | pin | unpin]',
        immediate: true,
      })
      .catch(() => undefined)
    // The mod's own name is what people type first: `/wardrobe` answers as `/wear` does.
    await $.command
      .register({
        name: 'wardrobe',
        description: 'The same as /wear: list themes, or wear one',
        argumentHint: '[theme [everywhere] | auto | season | pin | unpin]',
        immediate: true,
      })
      .catch(() => undefined)
    // A store or clock that cannot answer leaves Claude Code's own look on.
    await refresh($, settings, 'start').catch(() => undefined)
    await readAppTone($).catch(() => undefined)
    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => {
      refresh($, settings, 'follow').catch(() => undefined)
    })
    return next(e)
  })

  on('command.run', { command: 'wear' }, ($, e) => answerWear($, e.args, settings, problems, autoNote)).catch($ => {
    $.ui.toast('/wear could not finish. Run /wear to see what is worn.')
    return {}
  })
  // The mod's own name is what people type first.
  on('command.run', { command: 'wardrobe' }, ($, e) => answerWear($, e.args, settings, problems, autoNote)).catch($ => {
    $.ui.toast('/wardrobe could not finish. Run /wear to see what is worn.')
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
    const theme = wornTheme((await read($, look)).theme, settings)
    if (!theme) return next(e)
    const timing = await read($, { ...TIMING, id: e.props.tool_use_id })
    return toolRow($.ui.resolve(e), theme, e.props, timing, await next(e), e.viewport?.columns)
  }).catch(($, e, next) => next(e))

  // A folded run of reads and searches: one icon per call before the engine's count line.
  // Unfolded, each call is its own ToolUse row and is restyled there.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if (e.props.isExpanded || e.props.calls.length === 0) return next(e)
    const theme = wornTheme((await read($, look)).theme, settings)
    if (!theme) return next(e)
    return groupRow($.ui.resolve(e), theme, e.props.calls, await next(e))
  }).catch(($, e, next) => next(e))

  // Results: diff cards and small plain shell output in the theme's colours;
  // anything else (errors, big or unusual output) the engine draws.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if (e.props.isErrored) return next(e)
    const worn = await read($, look)
    const theme = wornTheme(worn.theme, settings)
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
    const theme = wornTheme((await read($, look)).theme, settings)
    if (!theme) return next(e)
    return messageRow($.ui.resolve(e), theme, 'UserMessage', await next(e), { surface: e.surface, fill: fills(theme, e.surface, (await read($, app)).tone) })
  }).catch(($, e, next) => next(e))
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const theme = wornTheme((await read($, look)).theme, settings)
    if (!theme) return next(e)
    return messageRow($.ui.resolve(e), theme, 'AssistantMessage', await next(e), { surface: e.surface, fill: fills(theme, e.surface, (await read($, app)).tone) })
  }).catch(($, e, next) => next(e))
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const theme = wornTheme((await read($, look)).theme, settings)
    if (!theme) return next(e)
    return messageRow($.ui.resolve(e), theme, 'CommandOutput', await next(e), { surface: e.surface, fill: fills(theme, e.surface, (await read($, app)).tone) })
  }).catch(($, e, next) => next(e))

  // Claude Code's theme changed in /config (another plugin's set reaches here too; wardrobe's
  // own calls skip its hooks and update the tone themselves): re-read the tone once it is written.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const out = await next(e)
    if (out.deny === undefined) {
      await $.state.set(APP, { tone: toneOf(out.value) })
      // A theme the person (or another plugin) chose after a match stands: /wear default will not
      // undo it. Wardrobe's own writes are not that (the engine keeps them from its hooks; the test
      // kit hands them over, some with no origin at all, so the origin is checked too).
      const origin: typeof e.origin | undefined = e.origin
      const isOwn = origin === undefined || (origin.kind === 'plugin' && origin.name === 'wardrobe')
      if (!isOwn && typeof (await $.store.get(OWN_THEME)) === 'string') await forgetMatch($)
    }
    return out
  }).catch(($, e, next) => next(e))

  // One verb per turn for the spinner and the closing line: picked when the
  // turn starts, from the theme worn then, and held until the next turn starts.
  on('turn.start', async ($, e, next) => {
    const theme = wornTheme((await read($, look)).theme, settings)
    const pick = theme ? pickVerb(theme.id, e.turnId) : null
    await $.state.set(VERB, pick ? { turnId: e.turnId, present: pick[0], past: pick[1] } : null)
    // A scene on the GPU answers the session: the weather picks up while Claude works. An agent's turn is not the session's.
    if (e.agentId === undefined) await update($, live, was => ({ ...was, isWorking: true }))
    return next(e)
  }).catch(($, e, next) => next(e))

  // ... and settles when the turn ends, however it ends. It only watches: the answer goes on unchanged.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, live, was => ({ ...was, isWorking: false }))
    return next(e)
  }).catch(($, e, next) => next(e))

  // The prompt footer: `wearing <theme>` after the engine's own mode labels, as
  // long as a theme is worn, so the look stays named after the switch band goes.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const theme = wornTheme((await read($, look)).theme, settings)
    if (!theme) return next(e)
    return wearingLabel($.ui.resolve(e), theme, e.props.modes.length > 0, await next(e))
  }).catch(($, e, next) => next(e))

  // The spinner: the theme's suffix after the word; on the terminal, a chip
  // naming what the turn is doing. Elapsed time and tokens stay the engine's,
  // and so does any status message of its own ("Running tests..."): while one
  // shows, its text is left exactly as the engine wrote it.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const theme = wornTheme((await read($, look)).theme, settings)
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
    const theme = wornTheme((await read($, look)).theme, settings)
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
    const theme = last === null ? undefined : wornTheme(last.theme, settings)
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

  // The wallpaper: the desktop app asks every plugin to draw the backdrop that
  // `$.theme.set` named. Wardrobe draws its own scene for the look that is worn
  // and passes on any other plugin's, saying once, kindly, that the other
  // plugin holds the backdrop now. Over its own scene it lays what a plugin
  // asked after it draws there, such as a card in a side column. The terminal
  // never asks; mobile is left to Claude Code's own drawing, like the rest of
  // wardrobe there.
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    if (e.props.plugin !== 'wardrobe') {
      const own = await read($, backdrop)
      if (own.scene !== null && holder !== e.props.plugin) {
        holder = e.props.plugin
        await $.ui.toast(`${clean(e.props.plugin)} draws the backdrop now, so the ${own.scene} wallpaper waits. /wear ${own.scene} brings it back.`, { timeoutMs: 8000 })
      }
      return next(e)
    }
    const theme = wornTheme(e.props.scene, settings)
    // The scene stands in the light of the local hour, where the clock light is on and the look takes it.
    const scene = theme === undefined ? undefined : sceneOf(theme, { motion: settings.motion, light: await read($, sky) })
    if (scene === undefined) return next(e)
    const { Box, Shader, Svg } = $.ui.resolve(e)
    const picture = async (): Promise<RenderElement> => {
      if (settings.motion !== 'full' || Shader === undefined) return <Svg source={scene.source} alt={scene.alt} isInteractive />
      // A flagship scene also plays on the GPU, over the same picture: the app shows the picture alone under Reduce Motion,
      // or where it plays no shader. Calm and still motion keep to the picture, and so does an app older than the Shader.
      const values = gpuValues(await read($, live))
      // Each names its file in the element itself, as the app asks: the engine reads the file from there.
      switch (theme?.id) {
        case 'christmas':
          return (
            <Shader module="./gpu/snow.ts" values={values}>
              <Svg source={scene.source} alt={scene.alt} isInteractive />
            </Shader>
          )
        case 'noir':
          return (
            <Shader module="./gpu/rain.ts" values={values}>
              <Svg source={scene.source} alt={scene.alt} isInteractive />
            </Shader>
          )
        case 'tokyo-night':
          return (
            <Shader module="./gpu/neon.ts" values={values}>
              <Svg source={scene.source} alt={scene.alt} isInteractive />
            </Shader>
          )
        case 'nord':
          return (
            <Shader module="./gpu/aurora.ts" values={values}>
              <Svg source={scene.source} alt={scene.alt} isInteractive />
            </Shader>
          )
        case 'halloween':
          return (
            <Shader module="./gpu/embers.ts" values={values}>
              <Svg source={scene.source} alt={scene.alt} isInteractive />
            </Shader>
          )
        case 'summer':
          return (
            <Shader module="./gpu/sea.ts" values={values}>
              <Svg source={scene.source} alt={scene.alt} isInteractive />
            </Shader>
          )
        default:
          return <Svg source={scene.source} alt={scene.alt} isInteractive />
      }
    }
    // A mod asked after wardrobe may lay something over the scene, a card in a side column say: it is asked for that,
    // and what it draws goes on top, so it shows whichever of the two the app asks first.
    const over = await next(e)
    if (!drewOwn(over)) return picture()
    return (
      <Box position="relative" width="100%" height="100%">
        {await picture()}
        <Box position="absolute" top={0} left={0} right={0} bottom={0}>
          {over}
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // The `/wear` gallery: a card per theme in its own colours with Bolt in its
  // costume, the worn one marked, a `wear` button on each, and in the desktop
  // app a small still of the look's scene.
  // Box, Text and Button, but for Bolt's Raster on the terminal.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const tone = (await read($, app)).tone
    const press = (choice: string, match: boolean) => {
      putOn($, settings, choice, { match }, autoNote(choice))
        .then(text => say($, text, match ? 6000 : readingMs(text)))
        .catch(() => undefined)
        .finally(() => $.ui.invalidate('ui.render'))
    }
    return listTree($.ui.resolve(e), {
      surface: e.surface,
      look: await read($, look),
      family: (await read($, gallery)).family,
      onFamily: (family: string) => {
        $.state.set(GALLERY, { family }).catch(() => undefined)
      },
      settings,
      problems,
      columns: e.props.bodyColumns,
      now: await $.clock.now(),
      onWear: (choice: string) => press(choice, false),
      onMatch: (choice: string) => press(choice, true),
      fills: (theme: Theme) => fills(theme, e.surface, tone),
      // The scene shows where its wallpaper would: the desktop app.
      ...(e.surface === 'desktop' ? { thumb: (theme: Theme) => sceneOf(theme, { thumb: true }) } : {}),
    })
  }).catch(($, e, next) => next(e))
}
