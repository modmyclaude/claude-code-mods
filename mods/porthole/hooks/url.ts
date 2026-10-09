// Pure URL rules: what porthole may open, and how it spots a dev server in shell output.
// No `$` here, so every rule is table-tested on its own.

import type { PortholeMode } from '../types'

/** The only hosts porthole opens on its own (detected output, bare ports, shorthands). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

export type UrlVerdict = { ok: true; url: string } | { ok: false; reason: string }

/** True for an http(s) URL on localhost or 127.0.0.1 with an explicit port and no credentials. */
export function isLocalAddress(href: string): boolean {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return false
  }
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    LOCAL_HOSTS.has(url.hostname) &&
    url.port !== '' &&
    url.username === '' &&
    url.password === ''
  )
}

/** True for an http(s) URL on localhost or 127.0.0.1 (any port, no credentials). */
export function isLocalHost(href: string): boolean {
  try {
    const url = new URL(href)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      LOCAL_HOSTS.has(url.hostname) &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

/**
 * Judges what the person typed after /porthole. A full http(s) URL to any host is
 * theirs to open; shorthands (`3000`, `localhost:5173/app`) only ever mean a local
 * address; every other scheme (file:, javascript:, data:, chrome:, ...) is refused.
 */
export function checkTypedUrl(input: string): UrlVerdict {
  const text = input.trim()
  if (text === '') return { ok: false, reason: 'No address given.' }

  let candidate = text
  if (/^\d{1,5}$/.test(text)) candidate = `http://localhost:${text}/`
  else if (/^(localhost|127\.0\.0\.1)(:\d{1,5})?([/?#]|$)/i.test(text)) candidate = `http://${text}`
  // A dotted prefix (`example.com:3000`) is a host, not a scheme.
  else if (!/^[a-z][a-z0-9+-]*:/i.test(text)) {
    return {
      ok: false,
      reason: `"${text}" is not a full URL. Porthole opens localhost on its own; for another site type it in full (https://...).`,
    }
  }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { ok: false, reason: `"${text}" is not a valid URL.` }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Porthole only opens http and https pages, not ${url.protocol} addresses.` }
  }
  if (url.hostname === '') return { ok: false, reason: `"${text}" has no host.` }
  return { ok: true, url: url.href }
}

// ANSI colour/cursor codes and OSC sequences (terminal hyperlinks): dev servers wrap
// their URLs in these (Vite bolds the port), so they are removed before scanning.
const ANSI = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g
const ADDRESS = /https?:\/\/(?:localhost|127\.0\.0\.1):\d{1,5}(?:[/?#][^\s'"`<>()[\]{}]*)?/gi

/**
 * Text safe to draw: the engine refuses a whole tree that holds a control character,
 * and URLs, Chrome's stderr and shell output are not ours. ANSI and OSC sequences
 * are removed, tabs and line breaks become spaces, and every other C0, DEL or C1
 * character becomes U+FFFD.
 */
export function clean(text: string): string {
  return text
    .replace(ANSI, '')
    .replace(/[\t\n\r]/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '\uFFFD')
}

/**
 * The local dev-server addresses in a piece of shell output, as origin roots
 * (`http://localhost:5173/`), each once, in the order they appear.
 */
export function findLocalAddresses(output: string): string[] {
  const found: string[] = []
  for (const match of output.replace(ANSI, '').matchAll(ADDRESS)) {
    const href = match[0].replace(/[.,;:!?]+$/, '')
    if (!isLocalAddress(href)) continue
    const root = `${new URL(href).origin}/`
    if (!found.includes(root)) found.push(root)
  }
  return found
}

/** The URL as the pane header shows it: host, path and query, no scheme or lone slash. */
export function displayUrl(href: string): string {
  try {
    const url = new URL(href)
    const path = url.pathname === '/' ? '' : url.pathname
    return `${url.host}${path}${url.search}`
  } catch {
    return href
  }
}

export type PortholeArgs = { mode?: PortholeMode; target?: string } | { error: string }

/** Splits `/porthole` arguments: an optional `mobile`/`desktop` and an optional address, any order. */
export function parseArgs(args: string): PortholeArgs {
  const parsed: { mode?: PortholeMode; target?: string } = {}
  for (const word of args.trim().split(/\s+/).filter(Boolean)) {
    const lower = word.toLowerCase()
    if (lower === 'mobile' || lower === 'desktop') {
      if (parsed.mode !== undefined && parsed.mode !== lower) return { error: 'Pick one of mobile or desktop.' }
      parsed.mode = lower
    } else if (parsed.target === undefined) {
      parsed.target = word
    } else {
      return { error: 'Give one address at a time: /porthole <url> [mobile|desktop].' }
    }
  }
  return parsed
}
