// The thermostat's reasoning about time: how long the cache lives, how warm
// it is now, how the status reads, and when a keep-warm ping is worth it.
// Pure, so every rule here is table-tested.

import type { PluginOptions } from 'claude-code'

import type { ThermostatAuth, ThermostatCache } from '../types'

export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE

// ---------------------------------------------------------------- settings

export type Guard = 'hold' | 'warn' | 'off'

export type Settings = {
  guard: Guard
  /** The cache window in minutes when set; 0 works it out. */
  cacheMinutes: number
}

/** Reads the userConfig values, falling back to the defaults on anything odd. */
export function readSettings(options: PluginOptions): Settings {
  const guard = options.guard === 'warn' || options.guard === 'off' ? options.guard : 'hold'
  const minutes = Number(options.cacheMinutes)
  const cacheMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 1440) : 0
  return { guard, cacheMinutes }
}

// ------------------------------------------------------------- cache window

/** Where the window came from, for the receipt. */
export type TtlSource = 'setting' | 'engine' | 'subscription' | 'api-key' | 'default'

export type Ttl = { minutes: number; source: TtlSource }

/**
 * The cache window: what Claude Code itself reported (its `cache_ttl` on a
 * model switch, or its verdict on a resumed cache) wins, since it is the
 * engine's own setting. Until it has said, your cacheMinutes setting, then
 * your login: about an hour on a subscription, 5 minutes on an API key.
 * Unknown means 5 minutes, the shorter guess, so the countdown never promises
 * warmth that is not there.
 */
export function resolveTtl(settingMinutes: number, engineMinutes: number | null, auth: ThermostatAuth | null): Ttl {
  if (engineMinutes !== null) return { minutes: engineMinutes, source: 'engine' }
  if (settingMinutes > 0) return { minutes: settingMinutes, source: 'setting' }
  if (auth === 'bearer') return { minutes: 60, source: 'subscription' }
  if (auth === 'api-key') return { minutes: 5, source: 'api-key' }
  return { minutes: 5, source: 'default' }
}

/** Words for the receipt: where the window figure came from. */
export function describeTtlSource(source: TtlSource): string {
  switch (source) {
    case 'setting':
      return 'from your cacheMinutes setting'
    case 'engine':
      return 'as Claude Code reported it'
    case 'subscription':
      return 'subscription login'
    case 'api-key':
      return 'API key login'
    case 'default':
      return 'no subscription or API key seen, so the shorter window is assumed'
  }
}

/**
 * Claude Code says on a resume whether the cache has likely expired after
 * `secondsAgo`. Only two windows exist (5 minutes and 1 hour), so that answer
 * pins the window whenever it disagrees with one of them.
 */
export function ttlFromResume(secondsAgo: number, isLikelyExpired: boolean): number | null {
  if (isLikelyExpired && secondsAgo < 60 * 60) return 5
  if (!isLikelyExpired && secondsAgo > 5 * 60) return 60
  return null
}

// -------------------------------------------------------------- temperature

export type Temperature =
  | { kind: 'empty' }
  | { kind: 'off' }
  | { kind: 'warm'; msLeft: number; isAmber: boolean }
  | { kind: 'cold'; msAgo: number }

/**
 * When the countdown turns amber: 10 minutes before the cache goes cold, or
 * earlier in a short window (2 minutes of a 5-minute one) so the colour
 * still means "soon".
 */
export function amberMs(ttlMs: number): number {
  return Math.min(10 * MINUTE, ttlMs * 0.4)
}

/** How warm the cache is at `now`, measured from the start of the last request that read or wrote it. */
export function temperature(now: number, cache: ThermostatCache, ttlMs: number): Temperature {
  if (cache.lastAt === null || cache.tokens <= 0) return { kind: 'empty' }
  if (cache.isOff) return { kind: 'off' }
  const expiresAt = cache.lastAt + ttlMs
  if (now >= expiresAt) return { kind: 'cold', msAgo: now - expiresAt }
  const msLeft = expiresAt - now
  return { kind: 'warm', msLeft, isAmber: msLeft < amberMs(ttlMs) }
}

// --------------------------------------------------------------- formatting

/** `41m`, `60m`, `1h12m`, `<1m`: whole minutes, rounded down so it never overstates. */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE)
  if (minutes < 1) return '<1m'
  if (minutes <= 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h${rest}m`
}

/** `950`, `48k`, `182k`, `1.2M`. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens))
  if (tokens < 999_500) return `${Math.round(tokens / 1000)}k`
  return `${(tokens / 1e6).toFixed(1)}M`
}

/** `$1.82`, `$0.04`, `<$0.01`. */
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.005) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

/** The status line's text, e.g. `cache warm · 41m left`. */
export function statusText(temp: Temperature, tokens: number, warmLeftMs: number | null): string {
  const warming = warmLeftMs !== null && warmLeftMs > 0 ? ` · warming ${formatDuration(warmLeftMs)}` : ''
  switch (temp.kind) {
    case 'empty':
      return ''
    case 'off':
      return 'cache off'
    case 'warm':
      return `cache warm · ${formatDuration(temp.msLeft)} left${warming}`
    case 'cold':
      return `cache cold · ${formatTokens(tokens)} to re-read`
  }
}

/** The theme colour for each state; warm text stays as quiet as the footer around it. */
export function statusColor(temp: Temperature): 'warning' | 'suggestion' | undefined {
  if (temp.kind === 'warm' && temp.isAmber) return 'warning'
  if (temp.kind === 'cold') return 'suggestion'
  return undefined
}

// ------------------------------------------------------------ outside text

// ANSI sequences (CSI, OSC, two-byte escapes, and the 8-bit CSI), then any
// control character left: the engine refuses a drawn text that holds one.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]|\x9b[0-?]*[ -/]*[@-~]/g
const CONTROL = /[\x00-\x1f\x7f-\x9f]/g

/** Makes text from outside the mod safe to draw: ANSI stripped, C0, DEL and C1 shown as U+FFFD. */
export function clean(text: string): string {
  return text.replace(ANSI, '').replace(CONTROL, '\uFFFD')
}

// ---------------------------------------------------------------- durations

/**
 * Reads `/warm`'s argument: `90m`, `2h`, `1h30m`, `1.5h`, `90 min`, or a bare
 * number of minutes. Returns milliseconds, or null when it does not parse.
 */
export function parseDuration(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, '')
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * MINUTE)
  const m = /^(?:(\d+(?:\.\d+)?)(?:h|hr|hrs|hour|hours))?(?:(\d+(?:\.\d+)?)(?:m|min|mins|minute|minutes))?$/.exec(s)
  if (m === null || (m[1] === undefined && m[2] === undefined)) return null
  return Math.round(Number(m[1] ?? 0) * HOUR + Number(m[2] ?? 0) * MINUTE)
}

// ---------------------------------------------------------------- keep-warm

/** How long before expiry a ping goes out: the status tick is 30 s, so 60 s is the least lead that cannot miss. */
export function pingLeadMs(ttlMs: number): number {
  return ttlMs <= 10 * MINUTE ? MINUTE : 2 * MINUTE
}

export type KeepWarmInput = {
  now: number
  /** Start of the last request that read or wrote the cache. */
  lastAt: number
  /** When the keep-warm window ends. */
  until: number
  ttlMs: number
  leadMs: number
  /** What one ping costs (measured, or estimated before the first). */
  pingUsd: number
  /** What one cold re-read costs over a warm one. */
  extraUsd: number
}

export type KeepWarmStep =
  /** The window has ended. */
  | { kind: 'finished' }
  /** Too late: the cache lapsed before a ping could go out. */
  | { kind: 'cold' }
  /** The cache outlives the window on its own; no ping needed. */
  | { kind: 'covered' }
  /** Pinging is worth it, but not yet. */
  | { kind: 'wait'; pingAt: number; pingsLeft: number; costUsd: number }
  | { kind: 'ping'; pingsLeft: number; costUsd: number }
  /** The pings still needed cost more than the cold re-read they would save. */
  | { kind: 'stop'; pingsLeft: number; costUsd: number }

/**
 * The smart keep-warm rule. Each ping lands `leadMs` before expiry and buys
 * `ttlMs - leadMs` more warmth, so the pings still needed are the gap
 * between expiry and the window's end over that step. Their total is
 * weighed against the one cold re-read they prevent before every ping.
 */
export function planKeepWarm(i: KeepWarmInput): KeepWarmStep {
  if (i.now >= i.until) return { kind: 'finished' }
  const expiresAt = i.lastAt + i.ttlMs
  if (i.now >= expiresAt) return { kind: 'cold' }
  if (expiresAt >= i.until) return { kind: 'covered' }
  const step = Math.max(i.ttlMs - i.leadMs, MINUTE)
  const pingsLeft = Math.ceil((i.until - expiresAt) / step)
  const costUsd = pingsLeft * i.pingUsd
  if (costUsd > i.extraUsd) return { kind: 'stop', pingsLeft, costUsd }
  const pingAt = expiresAt - i.leadMs
  return i.now >= pingAt ? { kind: 'ping', pingsLeft, costUsd } : { kind: 'wait', pingAt, pingsLeft, costUsd }
}
