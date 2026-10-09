// Hostile text must not stall a check. 5 MB built from the shapes that make a
// backtracking pattern go quadratic (long runs, prefixes with no end, names
// every few characters, quotes that never close), with real secrets mixed in,
// goes through the real tool.call door well inside a hook's 10 s budget.

import { expect, test } from 'claude-code/testing'

import { alnum } from './corpus'
import { bash, ROOT, runBash, start, stdoutOf, TICKET, world } from './world'

const MB = 1024 * 1024
/**
 * A hook's own budget is 10 s; the check must finish in half of it on a busy
 * machine (it takes well under a second on an idle one). Linearity is also
 * checked on its own, as a ratio, which load does not skew.
 */
const LIMIT_MS = 5_000

function repeat(piece: string, bytes: number): string {
  return piece.repeat(Math.ceil(bytes / piece.length)).slice(0, bytes)
}

function adversarial(secret: string): string {
  const slice = Math.floor((5 * MB) / 16)
  const parts = [
    repeat('a', slice), // one long run of name characters
    repeat('eyJ' + 'a'.repeat(5000) + ' ', slice), // JWT head, no dots
    repeat('-----BEGIN PRIVATE KEY-----', slice), // key blocks that never end
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

test('5 MB of adversarial text is scanned well inside the budget, and still hides', { timeoutMs: 60_000 }, async ($, on) => {
  const known = `kn0wn-${alnum(20, 77)}`
  const w = world(on, { [`${ROOT}/.env`]: `DB_PASSWORD=${known}\n` })
  await start($)
  const secret = ['sk', '_live_', alnum(24, 78)].join('')
  const text = adversarial(secret) + `\n${known}\n`
  expect(text.length).toBeGreaterThanOrEqual(5 * MB)
  w.answer.Bash = () => bash(text)

  const began = performance.now()
  const ran = await runBash($, 'cat hostile.log')
  const took = performance.now() - began

  expect(took, `took ${Math.round(took)} ms`).toBeLessThan(LIMIT_MS)
  const seen = stdoutOf(ran)
  expect(seen.includes(secret)).toBe(false)
  expect(seen.includes(known)).toBe(false)
  expect(seen).toMatch(TICKET)
})

test('5 MB of hostile text with nothing to hide passes through unchanged, inside the budget', { timeoutMs: 60_000 }, async ($, on) => {
  const w = world(on)
  await start($)
  const slice = Math.floor((5 * MB) / 8)
  const text = [
    repeat('a', slice),
    repeat('eyJ' + 'a'.repeat(5000) + ' ', slice),
    repeat('ab://c:d', slice),
    repeat('Bearer ' + 'A'.repeat(5000) + ' ', slice),
    repeat('AKIA' + 'A'.repeat(40), slice),
    repeat('"' + 'a'.repeat(600), slice),
    repeat('x'.repeat(63) + '=', slice),
    repeat('key:a:', slice),
  ].join('\n')
  w.answer.Bash = () => bash(text)

  const began = performance.now()
  const ran = await runBash($, 'cat hostile.log')
  const took = performance.now() - began

  expect(took, `took ${Math.round(took)} ms`).toBeLessThan(LIMIT_MS)
  expect(stdoutOf(ran) === text).toBe(true)
})

test('the scan is linear: four times the hostile text takes about four times as long, not sixteen', { timeoutMs: 60_000 }, async ($, on) => {
  const w = world(on)
  await start($)
  const piece = ['key:a:', 'token=', 'eyJ' + 'a'.repeat(300) + ' ', '"' + 'a'.repeat(600), 'ab://c:d', '--password '].join('\n')
  const timeFor = async (bytes: number) => {
    const text = repeat(piece, bytes)
    w.answer.Bash = () => bash(text)
    const began = performance.now()
    await runBash($, 'cat hostile.log')
    return performance.now() - began
  }
  await timeFor(256 * 1024) // warm up
  const small = await timeFor(MB)
  const large = await timeFor(4 * MB)
  expect(large / small, `1 MB: ${Math.round(small)} ms, 4 MB: ${Math.round(large)} ms`).toBeLessThan(9)
})
