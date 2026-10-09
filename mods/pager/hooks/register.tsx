// Pager: a sound (and a toast, and optionally a phone push) when a turn
// finishes, when Claude waits on you, or when a turn ends on an error.
//
// Every function that takes `$` is declared at the top of this file: the
// engine reads the module's source to see which nouns it calls.

import type { EngineInterface, Register } from 'claude-code'

import {
  DEFAULT_MUTE_MS,
  DEFAULT_PACK,
  GAP_MS,
  KINDS,
  LABEL,
  PACKS,
  assetFor,
  formatDuration,
  isPack,
  isQuiet,
  minuteOfDay,
  notificationAlert,
  parseDuration,
  parseQuietHours,
  parseTopic,
  pushFor,
  sessionName,
  turnAlert,
  untilText,
  type Kind,
  type Pack,
  type QuietHours,
} from './logic'

// Kept in $.store, so a pack choice and a mute last across sessions and apply
// to every session at once.
const PACK_KEY = 'pack'
const MUTED_KEY = 'mutedUntil'

const COMMANDS = '/pager pack <classic|arcade|zen>, /pager test, /pager mute <30m>, /pager unmute'
const NO_PLAYER =
  'Heard nothing? Sounds play through macOS afplay; on Linux and Windows Claude Code has no player, so Pager shows toasts (and pushes) only.'

/** The settings, read once per load, and the little memory one load keeps. */
type Pager = {
  minMs: number
  quietText: string
  quiet: QuietHours | null | undefined
  topic: string | null | undefined
  // A hot reload forgets these two, which costs at most one early sound or a
  // toast naming the folder until the next prompt.
  lastSoundAt: number
  title: string | undefined
}

// The engine's errors lead with the plugin's own name; drop it in Pager's own lines.
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^pager: /, '')

function debug($: EngineInterface, line: string) {
  $.ui.log(`pager: ${line}`, { to: 'debug' })
}

async function currentPack($: EngineInterface): Promise<Pack> {
  const stored = await $.store.get(PACK_KEY)
  return isPack(stored) ? stored : DEFAULT_PACK
}

/** Why alerts are silent right now, or undefined when they are not. */
async function silence($: EngineInterface, pager: Pager, now: number): Promise<string | undefined> {
  const until = await $.store.get(MUTED_KEY)
  if (typeof until === 'number' && now < until) return `muted until ${untilText(now, until)}`
  if (isQuiet(pager.quiet, minuteOfDay(now))) return `quiet hours (${pager.quietText})`
  return undefined
}

async function nameOf($: EngineInterface, pager: Pager): Promise<string> {
  if (pager.title) return sessionName(pager.title, undefined)
  const root = await $.session.root().catch(() => undefined)
  return sessionName(undefined, root)
}

/** The one network call Pager makes, and only when ntfyTopic is set. */
function push($: EngineInterface, topic: string, kind: Kind, durationMs: number | undefined) {
  const { title, body } = pushFor(kind, durationMs)
  // Not awaited: a slow push never holds up the turn; a failed one only
  // reaches the debug log.
  void $.http
    .fetch(`https://ntfy.sh/${topic}`, { method: 'POST', headers: { Title: title }, body })
    .then(res => (res.ok ? undefined : debug($, `ntfy.sh answered ${res.status}`)))
    .catch(err => debug($, `ntfy.sh push failed: ${reason(err)}`))
}

/** One alert: always a toast; a sound and a push unless silenced or too soon. */
async function alert($: EngineInterface, pager: Pager, kind: Kind, durationMs?: number) {
  const now = await $.clock.now()
  const took = durationMs === undefined ? '' : ` (${formatDuration(durationMs)})`
  $.ui.toast(`${LABEL[kind]} - ${await nameOf($, pager)}${took}`)

  if ((await silence($, pager, now)) !== undefined) return
  if (now - pager.lastSoundAt < GAP_MS) return
  pager.lastSoundAt = now

  const pack = await currentPack($)
  // Not awaited: the clip plays while the turn's end is drawn.
  void $.audio.play({ asset: assetFor(pack, kind) }).catch(err => debug($, `could not play ${kind}: ${reason(err)}`))
  if (typeof pager.topic === 'string') push($, pager.topic, kind, durationMs)
}

/** A pager must never break the session: an alert that fails is logged and dropped. */
async function safeAlert($: EngineInterface, pager: Pager, kind: Kind, durationMs?: number) {
  try {
    await alert($, pager, kind, durationMs)
  } catch (err) {
    debug($, `alert failed: ${reason(err)}`)
  }
}

async function status($: EngineInterface, pager: Pager, now: number): Promise<string> {
  const silent = await silence($, pager, now)
  const phone =
    pager.topic === null ? 'off' : pager.topic === undefined ? 'off (the topic setting is not valid)' : 'on'
  return [
    `Pager: ${await currentPack($)} pack, ${silent ? `silent (${silent})` : 'sounds on'}.`,
    `Done pages after turns of ${formatDuration(pager.minMs)} or more. Quiet hours: ${pager.quiet ? pager.quietText : 'off'}. Phone push: ${phone}.`,
    `Commands: ${COMMANDS}.`,
  ].join('\n')
}

async function choosePack($: EngineInterface, arg: string): Promise<string> {
  if (arg === '') return `Pack: ${await currentPack($)}. Packs: ${PACKS.join(', ')}.`
  const name = arg.toLowerCase()
  if (!isPack(name)) return `No pack called "${arg.slice(0, 40)}". Packs: ${PACKS.join(', ')}.`
  await $.store.set(PACK_KEY, name)
  return `Pack set to ${name}. Run /pager test to hear it.`
}

/** You asked for it, so it plays even while muted or in quiet hours, one clip after another. */
async function testPack($: EngineInterface, pager: Pager, now: number): Promise<string> {
  const pack = await currentPack($)
  const failed: string[] = []
  for (const kind of KINDS) {
    await $.audio.play({ asset: assetFor(pack, kind) }).catch(err => {
      failed.push(`${LABEL[kind]}: ${reason(err)}`)
    })
  }
  const silent = await silence($, pager, now)
  return [
    failed.length === 0
      ? `Played the ${pack} pack: done, needs you, error.`
      : `Played the ${pack} pack, but ${failed.length} of 3 failed: ${failed.join('; ')}.`,
    silent ? `Real alerts are silent now (${silent}).` : '',
    NO_PLAYER,
  ]
    .filter(Boolean)
    .join('\n')
}

async function mute($: EngineInterface, arg: string, now: number): Promise<string> {
  const ms = arg === '' ? DEFAULT_MUTE_MS : parseDuration(arg)
  if (ms === undefined) {
    return `Could not read "${arg.slice(0, 40)}" as a duration. Try /pager mute 30m, 2h or 1h30m (up to 7d).`
  }
  await $.store.set(MUTED_KEY, now + ms)
  return `Muted for ${formatDuration(ms)}, until ${untilText(now, now + ms)}. Toasts still show. /pager unmute ends it early.`
}

async function unmute($: EngineInterface, now: number): Promise<string> {
  const until = await $.store.get(MUTED_KEY)
  await $.store.delete(MUTED_KEY)
  return typeof until === 'number' && now < until ? 'Unmuted. Sounds are back on.' : 'Pager was not muted.'
}

async function runCommand($: EngineInterface, pager: Pager, args: string): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  const arg = rest.join(' ')
  const now = await $.clock.now()
  switch (verb.toLowerCase()) {
    case '':
    case 'status':
      return status($, pager, now)
    case 'pack':
      return choosePack($, arg)
    case 'test':
      return testPack($, pager, now)
    case 'mute':
      return mute($, arg, now)
    case 'unmute':
      return unmute($, now)
    default:
      return `Unknown: "${verb.slice(0, 40)}". ${COMMANDS}.`
  }
}

export const register: Register = (on, options) => {
  const minSeconds = Number(options.minDuration)
  const quietText = typeof options.quietHours === 'string' ? options.quietHours.trim() : ''
  const pager: Pager = {
    minMs: (Number.isFinite(minSeconds) && minSeconds >= 0 ? minSeconds : 20) * 1000,
    quietText,
    quiet: parseQuietHours(quietText),
    topic: parseTopic(options.ntfyTopic),
    lastSoundAt: -Infinity,
    title: undefined,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pager',
      description: 'Sound alerts: switch pack, test, mute or unmute',
      argumentHint: '[pack <name> | test | mute <30m> | unmute]',
      immediate: true,
    })
    // Say a bad setting once, here, instead of failing quietly at every alert.
    if (pager.quiet === undefined) {
      $.ui.log(`pager: quietHours "${quietText}" is not like 22:00-07:00, so quiet hours are off.`)
    }
    if (pager.topic === undefined) {
      $.ui.log('pager: ntfyTopic must be 1-64 letters, digits, - or _, so phone push is off.')
    }
    return next(e)
  })

  // These hooks only observe. Should one fail, its .catch passes the event on
  // untouched, so Pager can never block a prompt, a session or a notification.

  // The session's title rides on these two settings-hook events; read it, change nothing.
  on('classic.SessionStart', ($, e, next) => {
    if (e.session_title?.trim()) pager.title = e.session_title
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.UserPromptSubmit', ($, e, next) => {
    if (e.session_title?.trim()) pager.title = e.session_title
    return next(e)
  }).catch(($, e, next) => next(e))

  // Done and error: the main loop's turn ending, timed by the engine's own
  // durationMs (measured from the turn's start).
  on('turn.complete', async ($, e, next) => {
    const kind = turnAlert(e, pager.minMs)
    if (kind !== undefined) await safeAlert($, pager, kind, kind === 'done' ? e.durationMs : undefined)
    return next(e)
  })

  // Needs you: Claude Code's own "waiting on you" notification (see notificationAlert).
  on('classic.Notification', async ($, e, next) => {
    const kind = notificationAlert(e.notification_type)
    if (kind !== undefined) await safeAlert($, pager, kind)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'pager' }, async ($, e) => ({ text: await runCommand($, pager, e.args) }))
}
