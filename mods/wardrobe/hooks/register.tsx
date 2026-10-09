// Wardrobe: restyles what a mod may draw (tool rows, tool results, diff cards,
// the spinner, the turn-duration line), switchable live with /wear.
//
// Display only: it reads and writes its own $.store and nothing else; no files,
// no processes, no network. Every hook that draws falls back to Claude Code's
// own drawing when it has nothing to add, and when it fails.

import { atom, read } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { WardrobeLook } from '../types'
import { diffCard, shellCard } from './content'
import { describeLook, diffTree, groupRow, listText, listTree, shellTree, spinnerRow, toolRow, turnRow } from './draw'
import { AUTO, CHOICES, DEFAULT, minuteOfDay, parseWear, pinsOf, resolveLook, sameLook, type Settings, settingsFrom } from './look'
import { themeById } from './themes'

const LOOK = { plugin: 'wardrobe', key: 'look' } as const
const TIMING = { plugin: 'wardrobe', key: 'timing' } as const

const look = atom(LOOK, { theme: DEFAULT, choice: DEFAULT, scope: 'global', phase: null, root: '' })

/** How often the worn theme is re-resolved: auto mode's switch, a choice made in another session. */
const TICK_MS = 60_000

type Dollar = Pick<EngineInterface, 'state' | 'store' | 'session' | 'clock'>

/** Works out what to wear now and publishes it; every drawing that reads it redraws. */
async function refresh($: Dollar, settings: Settings): Promise<WardrobeLook> {
  const root = await $.session.root()
  const global = await $.store.get('global')
  const pins = await $.store.get('pins')
  const now = await $.clock.now()
  const fresh = resolveLook({ root, global, pins, minute: minuteOfDay(now), settings })
  // Compared field by field (state crosses as JSON, so identity never matches):
  // an unchanged look writes nothing and redraws nothing.
  const current = await $.state.get(LOOK)
  if (!sameLook(current.value, fresh)) await $.state.set(LOOK, fresh)
  return fresh
}

/** `/wear <choice>`: changes what this project shows (its pin if it has one, else the global choice). */
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
  return describeLook(look, settings) + (await elsewhere($, look))
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
  return `Pinned ${what} to ${after.root}. Other projects keep the global choice.`
}

/** `/wear unpin`: this project follows the global choice again. */
async function unpin($: Dollar, settings: Settings): Promise<string> {
  const root = await $.session.root()
  const pins = pinsOf(await $.store.get('pins'))
  if (!Object.hasOwn(pins, root)) return `${root} has no pin. ${describeLook(await refresh($, settings), settings)}`
  delete pins[root]
  await $.store.set('pins', pins)
  return `Unpinned ${root}. ${describeLook(await refresh($, settings), settings)}`
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
    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => {
      refresh($, settings).catch(() => undefined)
    })
    return next(e)
  })

  // Answers its own command; it only ever changes wardrobe's own store.
  on('command.run', { command: 'wear' }, async ($, e) => {
    const command = parseWear(e.args)
    switch (command.kind) {
      case 'list':
        return { text: listText(await refresh($, settings), settings, problems) }
      case 'wear':
        return { text: (await wear($, settings, command.choice)) + autoNote(command.choice) }
      case 'pin':
        return { text: await pin($, settings) }
      case 'unpin':
        return { text: await unpin($, settings) }
      case 'unknown':
        return { text: `No theme called "${command.word}". Try one of: ${CHOICES.join(', ')}; or pin, unpin.` }
    }
  }).catch(() => ({ text: 'wardrobe: /wear could not finish. Run /wear to see what is worn.' }))

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
    if (diff) return diffTree($.ui.resolve(e), theme, diff, worn.root)
    const shell = e.props.tool === 'Bash' ? shellCard(e.props.output) : null
    if (shell) return shellTree($.ui.resolve(e), theme, shell)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The spinner: the theme's suffix after the word; on the terminal, a chip
  // naming what the turn is doing. Elapsed time and tokens stay the engine's,
  // and so does any status message of its own ("Running tests..."): while one
  // shows, its text is left exactly as the engine wrote it.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const theme = themeById((await read($, look)).theme)
    if (!theme) return next(e)
    const engine = await next(e.props.message === null ? { ...e, props: { ...e.props, suffix: theme.spinnerSuffix } } : e)
    return e.surface === 'terminal' ? spinnerRow($.ui.resolve(e), theme, e.props.mode, engine) : engine
  }).catch(($, e, next) => next(e))

  // The line closing a turn; the engine raises it on the terminal alone.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const theme = themeById((await read($, look)).theme)
    if (!theme) return next(e)
    return turnRow($.ui.resolve(e), theme, e.props.word, e.props.durationMs)
  }).catch(($, e, next) => next(e))

  // `/wear` with no argument: the list, each theme previewed in its own colours.
  on('ui.render', { component: 'CommandOutput', props: { command: 'wear' } }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if (e.props.isErrored || parseWear(e.props.args).kind !== 'list') return next(e)
    return listTree($.ui.resolve(e), await read($, look), settings, problems, e.viewport?.columns)
  }).catch(($, e, next) => next(e))
}
