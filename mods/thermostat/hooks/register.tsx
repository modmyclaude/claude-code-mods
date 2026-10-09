// Thermostat: a countdown to the prompt cache going cold, a guard that holds
// the first expensive cold send once, keep-warm pings that stop when they
// stop paying, and a receipt of what it all cost and saved.

import { atom, read, update } from 'claude-code'
import type { ClassicEventOf, EngineInterface, PromptOrigin, Register, Timer, TurnUsage } from 'claude-code'

import type { ThermostatAuth, ThermostatCache, ThermostatEngineWrite, ThermostatReceipt, ThermostatWarm } from '../types'
import { engineWriteRate, estimatePingUsd, estimateSend, pricesFor, pricesLabel, usageUsd, writeRate } from './pricing'
import type { Prices, SendEstimate } from './pricing'
import {
  HOUR,
  MINUTE,
  SECOND,
  describeTtlSource,
  formatDuration,
  formatTokens,
  formatUsd,
  parseDuration,
  pingLeadMs,
  planKeepWarm,
  readSettings,
  resolveTtl,
  statusColor,
  statusText,
  temperature,
  ttlFromResume,
} from './thermo'
import type { Settings, Temperature, Ttl } from './thermo'

type Dollar = EngineInterface

/** How often the countdown redraws and keep-warm looks at the clock. */
const TICK_MS = 30 * SECOND
/** Below this a cold send costs pennies: not worth stopping anyone for. */
const HOLD_MIN_TOKENS = 20_000
/** How long a hold counts as seen, so the next send in that cold spell goes through. */
const HOLD_ACK_MS = 10 * MINUTE
/** Smaller re-reads are not counted as cold sends on the receipt. */
const COLD_MIN_TOKENS = 4_096
/** A request this large that neither read nor wrote the cache means caching is off. */
const OFF_MIN_TOKENS = 4_096
/** No footer drawn for this long: carry the countdown on the plain status line. */
const FOOTER_STALE_MS = 90 * SECOND
const MAX_WARM_MS = 24 * HOUR
/** Consecutive failed pings before keep-warm gives up. */
const MAX_PING_FAILURES = 3
const PING_PROMPT =
  'Keep-alive ping from the thermostat plugin, sent only to keep the prompt cache warm. Reply with the single word ok and nothing else. Do not use tools.'
const USAGE = 'Use /warm 90m (or 2h, 1h30m, 45) to keep the cache warm while you are away, and /warm off to stop.'

const EMPTY_CACHE: ThermostatCache = { lastAt: null, lastRealAt: null, tokens: 0, model: null, isOff: false }
const EMPTY_RECEIPT: ThermostatReceipt = {
  coldSends: 0,
  coldTokens: 0,
  coldExtraUsd: 0,
  held: 0,
  clearedAfterHold: 0,
  clearAvoidedUsd: 0,
  pings: 0,
  pingUsd: 0,
  rescued: 0,
  rescuedUsd: 0,
}

const cacheState = atom({ plugin: 'thermostat', key: 'cache' } as const, EMPTY_CACHE)
const warmState = atom({ plugin: 'thermostat', key: 'warm' } as const, null)
const heldState = atom({ plugin: 'thermostat', key: 'held' } as const, null)
const receiptState = atom({ plugin: 'thermostat', key: 'receipt' } as const, EMPTY_RECEIPT)
const authState = atom({ plugin: 'thermostat', key: 'auth' } as const, null)
const engineTtlState = atom({ plugin: 'thermostat', key: 'engineTtl' } as const, null)
const engineWriteState = atom({ plugin: 'thermostat', key: 'engineWrite' } as const, null)

/** Everything a decision needs, read at one moment. */
type Snapshot = {
  now: number
  cache: ThermostatCache
  warm: ThermostatWarm | null
  auth: ThermostatAuth | null
  ttl: Ttl
  ttlMs: number
  temp: Temperature
  prices: Prices
  /** The next send's input side, cold and warm. */
  send: SendEstimate
}

/**
 * Only a person at a prompt can read a hold and send again: the terminal's
 * own composer, Remote Control, or the desktop app, whose prompts arrive as
 * an SDK host's (`sdk`) with a desktop surface attached. A plain `claude -p`
 * run is `sdk` with no surface: nobody would see the hold, so it is never held.
 */
async function isPerson($: Dollar, origin: PromptOrigin): Promise<boolean> {
  if (origin.kind === 'composer' || origin.kind === 'bridge') return true
  return origin.kind === 'sdk' && (await $.session.surfaces()).includes('desktop')
}

function pingSummary(warm: ThermostatWarm): string {
  return `${warm.pings} ping${warm.pings === 1 ? '' : 's'} sent, ~${formatUsd(warm.usd)}.`
}

/**
 * What lives only as long as this copy of the module: `register` starts it
 * afresh on every load and reload, while `$.state` above keeps the session.
 */
type Live = {
  settings: Settings
  ticker: Timer | undefined
  isTicking: boolean
  isPinging: boolean
  pingFailures: number
  /** When a footer last drew the countdown; the status line stands in once it is stale. */
  footerSeenAt: number
  /** What this mod last put on the plain status line. */
  shownStatus: string | undefined
}

function freshLive(settings: Settings): Live {
  return {
    settings,
    ticker: undefined,
    isTicking: false,
    isPinging: false,
    pingFailures: 0,
    footerSeenAt: 0,
    shownStatus: undefined,
  }
}

let live: Live = freshLive(readSettings({}))

/** List prices for a model, with Claude Code's own cache-write rate when it has priced that family. */
function pricesWithEngine(model: string, tokens: number, engineWrite: ThermostatEngineWrite | null): Prices {
  const list = pricesFor(model, tokens)
  return engineWrite !== null && engineWrite.family === list.family ? { ...list, write: engineWrite.usdPerMTok } : list
}

async function snapshot($: Dollar): Promise<Snapshot> {
  const [now, cache, warm, auth, engineTtl, engineWrite] = await Promise.all([
    $.clock.now(),
    read($, cacheState),
    read($, warmState),
    read($, authState),
    read($, engineTtlState),
    read($, engineWriteState),
  ])
  const ttl = resolveTtl(live.settings.cacheMinutes, engineTtl, auth)
  const ttlMs = ttl.minutes * MINUTE
  const prices = pricesWithEngine(cache.model ?? '', cache.tokens, engineWrite)
  return {
    now,
    cache,
    warm,
    auth,
    ttl,
    ttlMs,
    temp: temperature(now, cache, ttlMs),
    prices,
    send: estimateSend(cache.tokens, prices, ttl.minutes),
  }
}

function statusFor(s: Snapshot): string {
  return statusText(s.temp, s.cache.tokens, s.warm === null ? null : s.warm.until - s.now)
}

/** `the cache went cold 23m ago, so this send re-reads 182k tokens: ...` */
function coldReason(s: Snapshot): string {
  const ago = s.temp.kind === 'cold' ? ` ${formatDuration(s.temp.msAgo)} ago` : ''
  return (
    `the cache went cold${ago}, so this send re-reads ${formatTokens(s.cache.tokens)} tokens: ` +
    `~${formatUsd(s.send.coldUsd)} cold vs ~${formatUsd(s.send.warmUsd)} warm at ${pricesLabel(s.prices)}`
  )
}

function startTicker($: Dollar, now: number): void {
  if (live.ticker !== undefined) return
  // A grace period: the footer has this long to draw before the status line stands in.
  live.footerSeenAt = Math.max(live.footerSeenAt, now)
  live.ticker = $.clock.every(TICK_MS, () => void tick($))
}

async function tick($: Dollar): Promise<void> {
  if (live.isTicking) return
  live.isTicking = true
  try {
    const s = await snapshot($)
    // The footer label counts down by being drawn again.
    $.ui.invalidate('ui.render')
    // A surface that drew no footer lately (VS Code, mobile, a hidden footer)
    // gets the countdown on the plain status line instead, without colour.
    const fallback = s.now - live.footerSeenAt > FOOTER_STALE_MS ? statusFor(s) || undefined : undefined
    if (fallback !== live.shownStatus) {
      live.shownStatus = fallback
      $.ui.status(fallback)
    }
    await keepWarm($, s)
  } catch (error) {
    $.ui.log(`thermostat: tick failed: ${String(error)}`, { to: 'debug' })
  } finally {
    live.isTicking = false
  }
}

async function stopWarm($: Dollar, reason: string): Promise<void> {
  const warm = await read($, warmState)
  if (warm === null) return
  await update($, warmState, () => null)
  $.ui.log(`thermostat: ${reason}. ${pingSummary(warm)}`)
}

async function keepWarm($: Dollar, s: Snapshot): Promise<void> {
  const warm = s.warm
  if (warm === null) return
  if (s.cache.lastAt === null) return stopWarm($, 'keep-warm stopped, nothing is cached any more')
  const step = planKeepWarm({
    now: s.now,
    lastAt: s.cache.lastAt,
    until: warm.until,
    ttlMs: s.ttlMs,
    leadMs: pingLeadMs(s.ttlMs),
    pingUsd: warm.lastPingUsd ?? estimatePingUsd(s.cache.tokens, s.prices),
    extraUsd: s.send.extraUsd,
  })
  switch (step.kind) {
    case 'finished':
      return stopWarm($, `keep-warm finished after ${formatDuration(warm.until - warm.startedAt)}`)
    case 'cold':
      return stopWarm($, 'keep-warm stopped, the cache went cold before a ping could go out (was this machine asleep?)')
    case 'stop':
      return stopWarm(
        $,
        `keep-warm stopped, ${step.pingsLeft} more ping${step.pingsLeft === 1 ? '' : 's'} (~${formatUsd(step.costUsd)}) ` +
          `would cost more than the one cold re-read they save (~${formatUsd(s.send.extraUsd)})`,
      )
    case 'ping':
      // Due only once no request has touched the cache for a window less the
      // lead: a turn busy making requests never gets one, a turn stuck in one
      // long tool call does, and needs it.
      if (!live.isPinging) await ping($, s)
      return
    case 'covered':
    case 'wait':
      return
  }
}

/**
 * One keep-warm ping. `$.model.fork` re-sends the main thread's last request
 * (its model, system prompt, tools and messages) with one line after it, so it
 * reads the conversation's OWN cache entry, and a read restarts that entry's
 * timer. A separate completion would warm a different entry and do nothing
 * here. The fork's usage proves it every time: if it did not read the
 * conversation back from the cache, keep-warm stops instead of pretending.
 */
async function ping($: Dollar, s: Snapshot): Promise<void> {
  live.isPinging = true
  try {
    const sentAt = await $.clock.now()
    const reply = await $.model.fork({ prompt: PING_PROMPT })
    if (!reply.isAnswered && reply.reason === 'nothing-to-fork') {
      return stopWarm($, 'keep-warm stopped, the conversation has nothing to keep warm')
    }
    const usage = reply.usage
    if (usage.cache_read_input_tokens + usage.cache_creation_input_tokens === 0) {
      // No request reached the cache (an API error, an abort): try again next tick, a few times.
      live.pingFailures += 1
      const why = reply.isAnswered ? 'no cache activity' : reply.reason
      if (live.pingFailures >= MAX_PING_FAILURES) await stopWarm($, `keep-warm stopped, ${live.pingFailures} pings in a row failed (${why})`)
      return
    }
    live.pingFailures = 0
    const usd = usageUsd(usage, s.prices, s.ttl.minutes)
    await update($, warmState, w => (w === null ? null : { ...w, pings: w.pings + 1, usd: w.usd + usd, lastPingUsd: usd }))
    await update($, receiptState, r => ({ ...r, pings: r.pings + 1, pingUsd: r.pingUsd + usd }))
    // Warm, the fork reads back nearly the whole conversation (all but the
    // last reply, which the next real request writes either way).
    if (usage.cache_read_input_tokens < s.cache.tokens * 0.5) {
      return stopWarm(
        $,
        `keep-warm stopped, the ping read only ${formatTokens(usage.cache_read_input_tokens)} of ` +
          `${formatTokens(s.cache.tokens)} tokens from the cache, so it was not keeping this conversation warm`,
      )
    }
    // A read restarts the cache's clock from the start of the request.
    await update($, cacheState, c => (c.lastAt === null ? c : { ...c, lastAt: Math.max(c.lastAt, sentAt) }))
  } finally {
    live.isPinging = false
  }
}

/** Books one finished main-thread request: the cache's new clock, and whether it ran cold. */
async function recordStep($: Dollar, sentAt: number, u: TurnUsage): Promise<void> {
  const s = await snapshot($)
  const prior = s.cache
  const promptTokens = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const prices = pricesWithEngine(u.model, promptTokens, await read($, engineWriteState))
  const premiumPerToken = (writeRate(prices, s.ttl.minutes) - prices.read) / 1e6
  const isOff = promptTokens >= OFF_MIN_TOKENS && u.cache_read_input_tokens === 0 && u.cache_creation_input_tokens === 0
  // Warm, a request reads back at least the prompt before it; far less means the cache had lapsed.
  const isCold =
    !isOff && prior.lastAt !== null && prior.tokens >= COLD_MIN_TOKENS && u.cache_read_input_tokens < prior.tokens * 0.5
  // Kept warm by pings: the last real request is older than the window, yet this one read the cache.
  const isRescued =
    !isCold &&
    !isOff &&
    prior.lastAt !== null &&
    prior.lastRealAt !== null &&
    prior.lastAt > prior.lastRealAt &&
    sentAt - prior.lastRealAt > s.ttlMs
  await update($, cacheState, () => ({
    lastAt: sentAt,
    lastRealAt: sentAt,
    tokens: promptTokens + u.output_tokens,
    model: u.model,
    isOff,
  }))
  if (isCold) {
    await update($, receiptState, r => ({
      ...r,
      coldSends: r.coldSends + 1,
      coldTokens: r.coldTokens + u.cache_creation_input_tokens,
      coldExtraUsd: r.coldExtraUsd + u.cache_creation_input_tokens * premiumPerToken,
    }))
  } else if (isRescued) {
    await update($, receiptState, r => ({
      ...r,
      rescued: r.rescued + 1,
      rescuedUsd: r.rescuedUsd + u.cache_read_input_tokens * premiumPerToken,
    }))
  }
}

async function resetCache($: Dollar): Promise<void> {
  await update($, cacheState, () => EMPTY_CACHE)
  await update($, heldState, () => null)
}

async function learnAuth($: Dollar): Promise<void> {
  try {
    // Only the kind is read: the credential stays with Claude Code, and this
    // mod makes no network call that could spend the handle.
    const found = await $.session.authorize()
    const auth: ThermostatAuth = found === null ? 'none' : found.kind === 'bearer' ? 'bearer' : 'api-key'
    await update($, authState, () => auth)
  } catch {
    // Unknown login: the 5-minute window is assumed until Claude Code says otherwise.
  }
}

async function restoreDraft($: Dollar, text: string): Promise<void> {
  try {
    // Put the held words back so sending again is one key, never over a new draft.
    const box = await $.prompt.read()
    if (box.text.trim() === '') await $.prompt.fill({ text })
  } catch {
    // A convenience only: the hold message already says to send it again.
  }
}

async function onResume($: Dollar, e: ClassicEventOf['classic.SessionStart']): Promise<void> {
  const secondsAgo = e.seconds_since_last_response
  if (secondsAgo === undefined || e.context_tokens === undefined || e.context_tokens <= 0) return
  const now = await $.clock.now()
  const lastAt = now - secondsAgo * SECOND
  const model = e.model ?? (await $.session.model())
  const tokens = e.context_tokens
  await update($, cacheState, () => ({ lastAt, lastRealAt: lastAt, tokens, model, isOff: false }))
  if (e.prompt_cache_likely_expired !== undefined) {
    const minutes = ttlFromResume(secondsAgo, e.prompt_cache_likely_expired)
    if (minutes !== null) await update($, engineTtlState, () => minutes)
  }
  await learnEngineWrite($, model, e.estimated_cache_write_usd, tokens)
}

/** Keeps the cache-write rate behind an estimate Claude Code made of re-caching `tokens` on `model`. */
async function learnEngineWrite($: Dollar, model: string, estimatedUsd: number | undefined, tokens: number): Promise<void> {
  const rate = estimatedUsd === undefined ? null : engineWriteRate(estimatedUsd, tokens)
  if (rate === null) return
  const family = pricesFor(model).family
  await update($, engineWriteState, () => ({ family, usdPerMTok: rate }))
}

async function onClear($: Dollar): Promise<void> {
  const [now, cache, held] = await Promise.all([$.clock.now(), read($, cacheState), read($, heldState)])
  // A hold answered with /clear: the cold re-read was never paid.
  if (held !== null && held.spell === cache.lastAt && now - held.at < HOLD_ACK_MS) {
    await update($, receiptState, r => ({
      ...r,
      clearedAfterHold: r.clearedAfterHold + 1,
      clearAvoidedUsd: r.clearAvoidedUsd + held.coldUsd,
    }))
  }
  await resetCache($)
  await stopWarm($, 'keep-warm stopped, /clear started a new conversation')
}

async function warmCommand($: Dollar, args: string, origin: PromptOrigin): Promise<string> {
  const arg = args.trim().toLowerCase()
  if (arg === 'off' || arg === 'stop') {
    const warm = await read($, warmState)
    if (warm === null) return 'Keep-warm is not on.'
    await update($, warmState, () => null)
    return `Keep-warm off. ${pingSummary(warm)}`
  }
  const s = await snapshot($)
  if (arg === '') {
    return s.warm === null
      ? `Keep-warm is off. ${USAGE}`
      : `Keeping the cache warm for ${formatDuration(s.warm.until - s.now)} more. ${pingSummary(s.warm)} /warm off stops it.`
  }
  // Pings cost money: only a person starts them, never another plugin's command.
  if (!(await isPerson($, origin))) return 'Keep-warm starts only from a /warm you type.'
  const ms = parseDuration(arg)
  if (ms === null || ms < MINUTE || ms > MAX_WARM_MS) {
    return `Could not read "${args.trim()}" as a duration from 1m to 24h. ${USAGE}`
  }
  if (s.temp.kind === 'empty' || s.cache.lastAt === null) return 'Nothing is cached yet: send a prompt first, then /warm.'
  if (s.temp.kind === 'off') return 'Prompt caching looks switched off for this session, so there is nothing to keep warm.'
  if (s.temp.kind === 'cold') return 'The cache is already cold, so your next prompt re-reads it either way. Run /warm after that.'
  const span = formatDuration(ms)
  const pingUsd = s.warm?.lastPingUsd ?? estimatePingUsd(s.cache.tokens, s.prices)
  const plan = planKeepWarm({
    now: s.now,
    lastAt: s.cache.lastAt,
    until: s.now + ms,
    ttlMs: s.ttlMs,
    leadMs: pingLeadMs(s.ttlMs),
    pingUsd,
    extraUsd: s.send.extraUsd,
  })
  if (plan.kind === 'covered') {
    return `No pings needed: the cache stays warm ${formatDuration(s.temp.msLeft)} on its own, past the ${span} you asked for.`
  }
  if (plan.kind === 'stop') {
    return (
      `Not started: keeping ${formatTokens(s.cache.tokens)} tokens warm for ${span} takes about ${plan.pingsLeft} pings ` +
      `(~${formatUsd(plan.costUsd)}), more than the one cold re-read it would save (~${formatUsd(s.send.extraUsd)}).`
    )
  }
  const pings = plan.kind === 'ping' || plan.kind === 'wait' ? plan.pingsLeft : 0
  await update($, warmState, () => ({ until: s.now + ms, startedAt: s.now, pings: 0, usd: 0, lastPingUsd: s.warm?.lastPingUsd ?? null }))
  live.pingFailures = 0
  startTicker($, s.now)
  return (
    `Keeping the cache warm for ${span}: about ${pings} ping${pings === 1 ? '' : 's'} at ~${formatUsd(pingUsd)} each, ` +
    `sent just before it would go cold. Going cold would add ~${formatUsd(s.send.extraUsd)} to your next send. /warm off stops it.`
  )
}

/** The session's real total as /cost counts it, when the host keeps one. */
async function sessionTotalUsd($: Dollar): Promise<number | undefined> {
  try {
    return (await $.session.usage()).cost?.usd
  } catch {
    return undefined
  }
}

async function receiptText($: Dollar): Promise<string> {
  const s = await snapshot($)
  const r = await read($, receiptState)
  const window = `${formatDuration(s.ttlMs)} window, ${describeTtlSource(s.ttl.source)}`
  const tokens = `${formatTokens(s.cache.tokens)} tokens at ${s.prices.family} prices`
  const lines = ['Thermostat receipt for this session']
  switch (s.temp.kind) {
    case 'empty':
      lines.push(`Cache: nothing cached yet (${window}).`)
      break
    case 'off':
      lines.push('Cache: caching looks switched off, the last large request neither read nor wrote it.')
      break
    case 'warm':
      lines.push(
        `Cache: warm, ${formatDuration(s.temp.msLeft)} left (${window}). ${tokens}: ` +
          `~${formatUsd(s.send.warmUsd)} to send warm, ~${formatUsd(s.send.coldUsd)} cold.`,
      )
      break
    case 'cold':
      lines.push(
        `Cache: cold for ${formatDuration(s.temp.msAgo)} (${window}). ${tokens}: ` +
          `the next send costs ~${formatUsd(s.send.coldUsd)} instead of ~${formatUsd(s.send.warmUsd)}.`,
      )
      break
  }
  lines.push(
    `Cold sends paid: ${r.coldSends} (${formatTokens(r.coldTokens)} tokens re-read, ~${formatUsd(r.coldExtraUsd)} more than warm).`,
  )
  lines.push(
    `Prompts held: ${r.held}, followed by /clear instead: ${r.clearedAfterHold} (~${formatUsd(r.clearAvoidedUsd)} not spent).`,
  )
  const running = s.warm === null ? '' : ` Running now, ${formatDuration(s.warm.until - s.now)} left.`
  lines.push(
    `Keep-warm pings: ${r.pings} (~${formatUsd(r.pingUsd)}). Sends that found the cache warm thanks to them: ` +
      `${r.rescued} (~${formatUsd(r.rescuedUsd)} not spent).${running}`,
  )
  const saved = r.clearAvoidedUsd + r.rescuedUsd - r.pingUsd
  lines.push(
    saved >= 0
      ? `Estimated saved: ~${formatUsd(saved)} (not spent, less what the pings cost).`
      : `Estimated saved: -${formatUsd(-saved)} so far (the pings cost more than they saved).`,
  )
  const total = await sessionTotalUsd($)
  if (total !== undefined) lines.push(`Session total so far: ~${formatUsd(total)}, as /cost counts it.`)
  const plan = s.auth === 'bearer' ? ' On a subscription these measure plan usage, not a bill.' : ''
  lines.push(`Guard: ${live.settings.guard}. Dollars are API list prices.${plan}`)
  return lines.join('\n')
}

export const register: Register = (on, options) => {
  live.ticker?.cancel()
  live = freshLive(readSettings(options))

  on('session.start', async ($, e, next) => {
    // Fires at start, on enable and on every reload, so the commands and the
    // ticker come back with the module.
    try {
      await Promise.all([
        $.command.register({
          name: 'warm',
          description: 'Keep the prompt cache warm while you are away (/warm 90m, /warm off)',
          argumentHint: '<duration> | off',
          immediate: true,
        }),
        $.command.register({
          name: 'thermostat',
          description: 'Prompt cache receipt: cold sends paid, pings sent, money saved',
          immediate: true,
        }),
        learnAuth($),
      ])
    } catch (error) {
      $.ui.log(`thermostat: setup failed: ${String(error)}`, { to: 'debug' })
    }
    startTicker($, await $.clock.now())
    return next(e)
  })

  // The guard. It judges before calling `next`, and drops only a person's
  // own prompt (they can read the hold and send again). A prompt typed while a
  // turn runs (`turnId` set) joins that turn, whose next request pays the same
  // either way, so it is never held.
  on('prompt.submit', async ($, e, next) => {
    if (live.settings.guard === 'off' || e.turnId !== undefined || !(await isPerson($, e.origin))) return next(e)
    const s = await snapshot($)
    if (s.temp.kind !== 'cold' || s.cache.lastAt === null || s.cache.tokens < HOLD_MIN_TOKENS) return next(e)
    const why = coldReason(s)
    if (live.settings.guard === 'warn') {
      $.ui.toast(`Cache is cold: ${why}.`, { timeoutMs: 10_000 })
      return next(e)
    }
    const held = await read($, heldState)
    // Held once already in this cold spell: this send is the confirmation.
    if (held !== null && held.spell === s.cache.lastAt && s.now - held.at < HOLD_ACK_MS) return next(e)
    const spell = s.cache.lastAt
    await update($, heldState, () => ({ spell, at: s.now, coldUsd: s.send.coldUsd }))
    await update($, receiptState, r => ({ ...r, held: r.held + 1 }))
    $.clock.after(0, () => void restoreDraft($, e.text))
    const files = e.attachments?.length ? ' Attach your files again: only the text comes back.' : ''
    return {
      drop: `Thermostat held this prompt once: ${why}. Send it again to go ahead, or /clear to start fresh.${files}`,
    }
  })
    // Fails open on purpose: if the estimate itself breaks, the prompt goes
    // through. Blocking someone's prompt on a bug in a cost warning is worse
    // than one missed warning. After a `next` call, `next(e)` replays what it
    // settled to, so nothing runs twice.
    .catch(($, e, next) => next(e))

  // Every main-thread model request moves the cache's clock: it is read (or
  // written) at the request's start. Subagents and pings use other prefixes.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || live.isPinging) return yield* next(e)
    let sentAt: number | undefined
    try {
      sentAt = await $.clock.now()
    } catch {
      sentAt = undefined
    }
    const result = yield* next(e)
    if (sentAt !== undefined && result.usage !== null) {
      try {
        await recordStep($, sentAt, result.usage)
      } catch (error) {
        // Bookkeeping must never touch the turn.
        $.ui.log(`thermostat: could not record a request: ${String(error)}`, { to: 'debug' })
      }
    }
    return result
  })

  // Resume and fork carry how long ago the last response was; compaction and
  // /clear start the conversation's cache over.
  on('classic.SessionStart', async ($, e, next) => {
    try {
      if (e.source === 'resume' || e.source === 'fork') await onResume($, e)
      else if (e.source === 'compact' || e.source === 'clear') await resetCache($)
    } catch (error) {
      $.ui.log(`thermostat: ${String(error)}`, { to: 'debug' })
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // observes only: never blocks a session start

  // A model switch reports the engine's own cache window, and leaves the new
  // model with nothing cached: keep-warm pings would only pay to write it.
  on('classic.PostModelSwitch', async ($, e, next) => {
    try {
      await update($, engineTtlState, () => (e.cache_ttl === '1h' ? 60 : 5))
      // `default` means Claude Code did not know the new model's price either.
      if (e.pricing !== 'default') await learnEngineWrite($, e.to_model, e.estimated_cache_write_usd, e.context_tokens)
      // A resume restores the model the transcript was cached on: nothing is lost.
      if (e.source !== 'resume' && e.from_model !== e.to_model) {
        await stopWarm($, 'keep-warm stopped, the model changed and its cache starts empty')
        await resetCache($)
      }
    } catch (error) {
      $.ui.log(`thermostat: ${String(error)}`, { to: 'debug' })
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // observes only: never blocks a model switch

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      try {
        await onClear($)
      } catch (error) {
        $.ui.log(`thermostat: ${String(error)}`, { to: 'debug' })
      }
    }
    return next(e)
  })

  on('command.run', { command: 'warm' }, async ($, e) => ({ text: await warmCommand($, e.args, e.origin) })).catch(() => ({
    text: 'thermostat: /warm hit an error. Run /thermostat to see where keep-warm stands.',
  }))

  on('command.run', { command: 'thermostat' }, async $ => ({ text: await receiptText($) })).catch(() => ({
    text: 'thermostat: could not build the receipt this time.',
  }))

  // The countdown, at the end of the prompt footer's mode labels: quiet while
  // warm, amber near the end, cold-coloured once the cache has lapsed.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const s = await snapshot($)
    live.footerSeenAt = s.now
    const engine = await next(e)
    if (s.temp.kind === 'empty') return engine
    const { Box, Text } = $.ui.resolve(e)
    const color = statusColor(s.temp)
    return (
      <Box flexDirection="row">
        {engine}
        {e.props.modes.length > 0 ? <Text dimColor> & </Text> : null}
        <Box key="thermostat">
          <Text color={color} dimColor={color === undefined}>
            {statusFor(s)}
          </Text>
        </Box>
      </Box>
    )
  })
}
