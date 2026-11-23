// scorebug: live scores beside the chat. In the desktop app, with a scene worn
// behind the conversation (any mod's, wardrobe's looks among them), each
// followed game is a card in a side column of that scene. Elsewhere, and in
// the desktop app with no scene, the games sit in one row above the prompt. A
// toast says when a followed team scores and when a game ends.
//
// Where the scores come from: for now the pretend feed alone, two made-up
// games that play on the clock, so the cards can be seen and judged before a
// real feed is chosen. It sends nothing anywhere.
//
// Drawing over another mod's scene: every plugin's Backdrop hook is asked, in
// an order no one sets. Asked before the scene's own hook, scorebug lays its
// cards over the scene that hook draws. Asked after it, it gets nothing
// beneath and answers with the cards alone, for a scene's hook that lays what
// the hooks beneath it draw over its scene, as wardrobe's does.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, Timer } from 'claude-code'

import type { ScoreGame, ScoreMeta, ScoreView } from '../types'
import {
  alertsOf, backoff, captionOf, clampRefresh, DEFAULT_REFRESH_S, demoGames, isBand, isSide, isSource, leaderOf, lineOf, parseTeams, sameGames,
  shownOf, waitOf,
} from './games'
import type { Band, Side, Source } from './games'

const games = atom({ plugin: 'scorebug', key: 'games' } as const, [] as ScoreGame[])
const meta = atom({ plugin: 'scorebug', key: 'meta' } as const, { lastOk: null, lastErr: null, intervalMs: DEFAULT_REFRESH_S * 1000 } as ScoreMeta)
const view = atom({ plugin: 'scorebug', key: 'view' } as const, { on: true } as ScoreView)
/** One more after every look: the band and the cards both read it, so both are drawn again at each look. */
const beat = atom({ plugin: 'scorebug', key: 'beat' } as const, 0)

// The settings, as the manifest's fields hold them; config.set keeps them current.
let enabled = true
let teams: string[] = []
let source: Source = 'demo'
let refreshS = DEFAULT_REFRESH_S
let sideSetting: Side = 'left'
let band: Band = 'auto'
let alerts = true

// The loop. A module value, so a code reload drops it: session.start starts it again.
let timer: Timer | undefined
/**
 * The beat at which the cards were last drawn in the desktop app. Only a scene
 * behind the chat asks for them, and a drawing hook may not write state, so
 * this is how the band learns that a card shows: drawn at this beat or the one
 * before, the band steps aside; a scene gone, it is back within two looks. A
 * reload starts it over, and the band shows until the cards are drawn again.
 */
let cardsAt = -2

type Elements = ReturnType<EngineInterface['ui']['resolve']>

// The cards' colours: a dark card that reads over any scene, its edge lit while the game is on.
const CARD = '#0b0f1a'
const EDGE = '#3b4261'
const LIVE = '#7aa2f7'
const BRIGHT = '#ffffff'
const SOFT = '#c0caf5'
const DIM = '#9aa5ce'

function stop() {
  timer?.cancel()
  timer = undefined
}

/** One look at a time: a new schedule replaces the old. */
function schedule($: EngineInterface, ms: number) {
  stop()
  timer = $.clock.after(ms, () => {
    timer = undefined
    void look($)
  })
}

/** Starts looking, at once; nothing while off. */
async function start($: EngineInterface) {
  stop()
  const v = await read($, view)
  if (enabled && v.on) schedule($, 0)
}

/** Every game the feed has now. The pretend feed is worked out here and costs nothing. */
async function feed(now: number): Promise<{ all: ScoreGame[]; costsNothing: boolean }> {
  switch (source) {
    case 'demo':
      return { all: demoGames(now), costsNothing: true }
  }
}

/** One look at the feed, then the next is scheduled: soon while a game is on, later while none is, later still after each failure. */
async function look($: EngineInterface) {
  if (!enabled) return
  const v = await read($, view)
  if (!v.on) return
  const now = await $.clock.now()
  try {
    const { all, costsNothing } = await feed(now)
    const shown = shownOf(all, teams)
    const before = await read($, games)
    if (!sameGames(before, shown)) await update($, games, () => shown)
    await update($, meta, x => ({ ...x, lastOk: now, intervalMs: refreshS * 1000 }))
    if (alerts) for (const text of alertsOf(before, shown)) $.ui.toast(text, { timeoutMs: 6000 })
    schedule($, waitOf(shown, refreshS, now, costsNothing))
  } catch {
    const m = await read($, meta)
    const wait = backoff(m.intervalMs)
    await update($, meta, x => ({ ...x, lastErr: now, intervalMs: wait }))
    schedule($, wait)
  }
  await update($, beat, n => n + 1)
}

/** One game's card. */
function card(R: Elements, g: ScoreGame): RenderElement {
  const { Box, Text } = R
  const lead = leaderOf(g)
  const live = g.state === 'live'
  return (
    <Box key={g.id} flexDirection="column" borderStyle="round" borderColor={live ? LIVE : EDGE} backgroundColor={CARD} paddingX={2} paddingY={1} marginBottom={1}>
      <Text size="caption" weight="semibold" color={live ? LIVE : DIM}>{captionOf(g)}</Text>
      <Text size="title" weight={lead === 'away' ? 'bold' : 'regular'} color={lead === 'home' ? SOFT : BRIGHT}>{`${g.away.short}  ${g.away.score}`}</Text>
      <Text size="title" weight={lead === 'home' ? 'bold' : 'regular'} color={lead === 'away' ? SOFT : BRIGHT}>{`${g.home.short}  ${g.home.score}`}</Text>
      <Text size="footnote" color={DIM}>{`${g.away.name} at ${g.home.name}, ${g.league}`}</Text>
    </Box>
  )
}

/** The cards in one column of the scene, over what is beneath them: the scene, or nothing, for a hook that lays them over its own. */
function laid(R: Elements, side: Side, shown: readonly ScoreGame[], beneath: RenderElement | null): RenderElement {
  const { Box } = R
  const column = (
    <Box position="absolute" top={3} {...(side === 'left' ? { left: 3 } : { right: 3 })} flexDirection="column">
      {shown.map(g => card(R, g))}
    </Box>
  )
  return (
    <Box position="relative" width="100%" height="100%">
      {beneath}
      {column}
    </Box>
  )
}

export const register: Register = (on, options) => {
  enabled = options.enabled !== false
  teams = parseTeams(options.teams)
  source = isSource(options.source) ? options.source : 'demo'
  refreshS = clampRefresh(options.refresh)
  sideSetting = isSide(options.side) ? options.side : 'left'
  band = isBand(options.band) ? options.band : 'auto'
  alerts = options.alerts !== false

  on('session.start', async ($, e, next) => {
    await $.command
      .register({ name: 'scores', description: 'Live scores beside the chat: /scores, /scores on, /scores off, /scores left, /scores right', argumentHint: '[on | off | left | right]', immediate: true })
      .catch(() => undefined)
    await start($)
    return next(e)
  })

  // The settings as they change in /config.
  on('config.set', { key: 'scorebug.enabled' }, async ($, e, next) => {
    const r = await next(e)
    enabled = e.value !== false
    if (enabled) await start($)
    else stop()
    $.ui.invalidate('ui.render')
    return r
  })
  on('config.set', { key: 'scorebug.teams' }, async ($, e, next) => {
    const r = await next(e)
    teams = parseTeams(e.value)
    await start($)
    return r
  })
  on('config.set', { key: 'scorebug.source' }, async ($, e, next) => {
    const r = await next(e)
    source = isSource(e.value) ? e.value : 'demo'
    await start($)
    return r
  })
  on('config.set', { key: 'scorebug.refresh' }, async ($, e, next) => {
    const r = await next(e)
    refreshS = clampRefresh(e.value)
    await start($)
    return r
  })
  on('config.set', { key: 'scorebug.side' }, async ($, e, next) => {
    const r = await next(e)
    sideSetting = isSide(e.value) ? e.value : 'left'
    await update($, view, x => {
      const { side: _, ...rest } = x
      return rest
    })
    return r
  })
  on('config.set', { key: 'scorebug.band' }, async ($, e, next) => {
    const r = await next(e)
    band = isBand(e.value) ? e.value : 'auto'
    $.ui.invalidate('ui.render')
    return r
  })
  on('config.set', { key: 'scorebug.alerts' }, async ($, e, next) => {
    const r = await next(e)
    alerts = e.value !== false
    return r
  })

  on('command.run', { command: 'scores' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    const v = await read($, view)
    switch (word) {
      case '': {
        const shown = await read($, games)
        const list = shown.length === 0 ? 'no games' : shown.map(lineOf).join('; ')
        const where = !enabled ? 'off in /config' : !v.on ? 'off this session' : `cards in the ${v.side ?? sideSetting} column over a scene`
        $.ui.log(`scorebug: ${list} (${source === 'demo' ? 'pretend games' : source}, ${where})`)
        break
      }
      case 'on':
        await update($, view, x => ({ ...x, on: true }))
        await start($)
        break
      case 'off':
        await update($, view, x => ({ ...x, on: false }))
        stop()
        break
      case 'left':
      case 'right':
        await update($, view, x => ({ ...x, side: word }))
        break
      default:
        $.ui.log('scorebug: /scores, /scores on, /scores off, /scores left, /scores right; teams, feed and refresh are in /config')
    }
    return {}
  })

  // The cards, in a side column of whatever scene stands behind the chat in the desktop app.
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const v = await read($, view)
    if (!enabled || !v.on) return next(e)
    const shown = await read($, games)
    const at = await read($, beat)
    const below = await next(e)
    if (shown.length === 0) return below
    cardsAt = at
    const R = $.ui.resolve(e)
    return laid(R, v.side ?? sideSetting, shown, below.type === 'engine' ? null : below)
  })

  // The band: one row above the prompt where no card shows, or always when set so.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || band === 'off' || !enabled) return next(e)
    const v = await read($, view)
    if (!v.on) return next(e)
    if (band === 'auto' && e.surface === 'desktop' && cardsAt >= (await read($, beat)) - 1) return next(e)
    const shown = await read($, games)
    if (shown.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const below = await next(e)
    return (
      <Box flexDirection="column">
        {below}
        <Box key="scorebug" flexDirection="row" width={Math.max(1, e.props.bodyColumns)} minWidth={0}>
          <Box flexShrink={0}>
            <Text dimColor>{'scores │ '}</Text>
          </Box>
          <Box flexDirection="row" flexShrink={1} minWidth={0}>
            {shown.map((g, i) => (
              <Text key={g.id} dimColor={g.state !== 'live'} wrap="truncate-end">{`${i === 0 ? '' : '   '}${lineOf(g)}`}</Text>
            ))}
          </Box>
        </Box>
      </Box>
    )
  })
}
