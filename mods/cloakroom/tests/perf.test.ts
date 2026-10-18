// Hostile text must not stall a check. Text built from the shapes that make a
// backtracking pattern go quadratic (long runs, prefixes with no end, names
// every few characters, quotes that never close), with real secrets mixed in,
// goes through the real tool.call door in linear time: five times the text
// takes about five times as long, not twenty-five. Linearity is checked as a
// ratio of two sizes timed in the same run, turn and turn about, keeping the
// fastest run of each: a slow machine does not skew the ratio, and a burst of
// load lands on both sizes rather than inflating the larger one alone. Past
// the scan budget the text is withheld (the fail-closed backstop), so a run
// that long says the machine was saturated, not that the code is slow.

import { expect, test } from 'claude-code/testing'

import { SCAN_BUDGET_MS } from '../hooks/vault'
import { alnum } from './corpus'
import { bash, ROOT, runBash, start, stdoutOf, TICKET, world } from './world'

const MB = 1024 * 1024
/**
 * Linear is 5x for five times the text, quadratic 25x. Measured this way the
 * clean scan reads 4.4x to 5.1x alone and up to 6x with four suites at once,
 * and a scan with a quadratic part half its linear cost reads 11x: 9x tells
 * the two apart with room for a busy machine.
 */
const MAX_RATIO = 9
/** Rounds of the two sizes timed turn about; the same again when the first read as slow. */
const ROUNDS = 3

function repeat(piece: string, bytes: number): string {
  return piece.repeat(Math.ceil(bytes / piece.length)).slice(0, bytes)
}

function adversarial(secret: string, bytes: number): string {
  const slice = Math.floor(bytes / 16)
  const parts = [
    repeat('a', slice), // one long run of name characters
    repeat('eyJ' + 'a'.repeat(5000) + ' ', slice), // JWT head, no dots
    repeat(['-----BEGIN', ' PRIVATE KEY-----'].join(''), slice), // key blocks that never end
    repeat('key:a:', slice), // a secret-ish name every 6 characters
    repeat('token=', slice), // names with empty values
    repeat('ab://c:d', slice), // URL credentials with no "@"
    repeat('Bearer ' + 'A'.repeat(5000) + ' ', slice), // a token run past the cap
    repeat('Basic QUFB', slice), // base64 that never decodes to user:pass
    repeat('AKIA' + 'A'.repeat(40), slice), // AWS prefix, too long to be a key
    repeat('--password ', slice), // flags with flags for values
    repeat('"' + 'a'.repeat(600), slice), // quotes that never close
    repeat('password: "', slice), // quoted values that never close
    repeat('sk-ant-a-', slice), // a vendor prefix with no body
    repeat('x'.repeat(63) + '=', slice), // long names, then a sign
    repeat('\\"api_key\\": \\"', slice), // escaped JSON keys, no values
    repeat(`${secret} `, slice), // and real secrets, many times
  ]
  return parts.join('\n')
}

function harmless(bytes: number): string {
  const slice = Math.floor(bytes / 8)
  return [
    repeat('a', slice),
    repeat('eyJ' + 'a'.repeat(5000) + ' ', slice),
    repeat('ab://c:d', slice),
    repeat('Bearer ' + 'A'.repeat(5000) + ' ', slice),
    repeat('AKIA' + 'A'.repeat(40), slice),
    repeat('"' + 'a'.repeat(600), slice),
    repeat('x'.repeat(63) + '=', slice),
    repeat('key:a:', slice),
  ].join('\n')
}

/** The fastest run of each size, its time and what came back from it. */
type Timing = { small: number; large: number; ratio: number; smallOut: string; largeOut: string }

async function timed(run: () => Promise<string>): Promise<{ ms: number; out: string }> {
  const began = performance.now()
  const out = await run()
  return { ms: performance.now() - began, out }
}

/**
 * The fastest run of each size, the two sizes timed turn and turn about so a
 * burst of load on the machine lands on both. Load and garbage collection only
 * ever add time, so the fastest run is the closest to the code's own cost. The
 * first scan is not timed: it pays for compiling the patterns. Three rounds,
 * and three more only when the first three still read as slow: a quadratic
 * scan reads as slow in every round, a busy machine does not.
 */
async function slowdown(small: () => Promise<string>, large: () => Promise<string>, limit: number): Promise<Timing> {
  await small()
  let best = { small: Infinity, large: Infinity, smallOut: '', largeOut: '' }
  const round = async () => {
    const s = await timed(small)
    if (s.ms < best.small) best = { ...best, small: s.ms, smallOut: s.out }
    const l = await timed(large)
    if (l.ms < best.large) best = { ...best, large: l.ms, largeOut: l.out }
  }
  for (let i = 0; i < ROUNDS; i++) await round()
  if (best.large / best.small >= limit) for (let i = 0; i < ROUNDS; i++) await round()
  return { ...best, ratio: best.large / best.small }
}

function expectLinear(t: Timing): void {
  const took = `1 MB: ${Math.round(t.small)} ms, 5 MB: ${Math.round(t.large)} ms`
  const saturated = `${took}; the 5 MB scan reached the ${SCAN_BUDGET_MS} ms scan budget and was cut off, so the machine was saturated: run cloakroom's tests alone`
  expect(t.large, saturated).toBeLessThan(SCAN_BUDGET_MS)
  expect(t.ratio, took).toBeLessThan(MAX_RATIO)
}

test('adversarial text is scanned in linear time, and still hides', { timeoutMs: 180_000 }, async ($, on) => {
  const known = `kn0wn-${alnum(20, 77)}`
  const w = world(on, { [`${ROOT}/.env`]: `DB_PASSWORD=${known}\n` })
  await start($)
  const secret = ['sk', '_live_', alnum(24, 78)].join('')
  const scan = (bytes: number) => {
    const text = adversarial(secret, bytes) + `\n${known}\n`
    expect(text.length).toBeGreaterThanOrEqual(bytes)
    return async () => {
      w.answer.Bash = () => bash(text)
      return stdoutOf(await runBash($, 'cat hostile.log'))
    }
  }

  const t = await slowdown(scan(MB), scan(5 * MB), MAX_RATIO)

  expectLinear(t)
  for (const seen of [t.smallOut, t.largeOut]) {
    expect(seen.includes(secret)).toBe(false)
    expect(seen.includes(known)).toBe(false)
    expect(seen).toMatch(TICKET)
  }
})

test('hostile text with nothing to hide passes through unchanged, in linear time', { timeoutMs: 180_000 }, async ($, on) => {
  const w = world(on)
  await start($)
  const scan = (text: string) => async () => {
    w.answer.Bash = () => bash(text)
    return stdoutOf(await runBash($, 'cat hostile.log'))
  }
  const smallText = harmless(MB)
  const largeText = harmless(5 * MB)

  const t = await slowdown(scan(smallText), scan(largeText), MAX_RATIO)

  expectLinear(t)
  expect(t.smallOut === smallText).toBe(true)
  expect(t.largeOut === largeText).toBe(true)
})

test('the scan is linear: four times the hostile text takes about four times as long, not sixteen', { timeoutMs: 60_000 }, async ($, on) => {
  const w = world(on)
  await start($)
  const piece = ['key:a:', 'token=', 'eyJ' + 'a'.repeat(300) + ' ', '"' + 'a'.repeat(600), 'ab://c:d', '--password '].join('\n')
  const scan = (bytes: number) => {
    const text = repeat(piece, bytes)
    return async () => {
      w.answer.Bash = () => bash(text)
      return stdoutOf(await runBash($, 'cat hostile.log'))
    }
  }
  const t = await slowdown(scan(MB), scan(4 * MB), 9)
  expect(t.ratio, `1 MB: ${Math.round(t.small)} ms, 4 MB: ${Math.round(t.large)} ms`).toBeLessThan(9)
})
