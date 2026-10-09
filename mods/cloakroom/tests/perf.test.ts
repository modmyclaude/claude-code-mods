// Hostile text must not stall a check. Text built from the shapes that make a
// backtracking pattern go quadratic (long runs, prefixes with no end, names
// every few characters, quotes that never close), with real secrets mixed in,
// goes through the real tool.call door in linear time: five times the text
// takes about five times as long, not twenty-five. Linearity is checked as a
// ratio of two sizes timed in the same run, which a slow or busy machine does
// not skew; the absolute ceiling is only a backstop.

import { expect, test } from 'claude-code/testing'

import { alnum } from './corpus'
import { bash, ROOT, runBash, start, stdoutOf, TICKET, world } from './world'

const MB = 1024 * 1024
/** Linear is 5x for five times the text, quadratic 25x: 8x leaves room for noise. */
const MAX_RATIO = 8
/**
 * A backstop only. A hook's own budget is 10 s and one scan is cut off at 4 s
 * (SCAN_BUDGET_MS); 5 MB takes about 0.6 s on an idle laptop and up to about
 * 5 s on a slow CI runner, so a tighter number fails on the machine, not the code.
 */
const CEILING_MS = 15_000

function repeat(piece: string, bytes: number): string {
  return piece.repeat(Math.ceil(bytes / piece.length)).slice(0, bytes)
}

function adversarial(secret: string, bytes: number): string {
  const slice = Math.floor(bytes / 16)
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

/** The fastest of three runs: load and garbage collection only ever add time. */
async function bestOfThree(run: () => Promise<void>): Promise<number> {
  let best = Infinity
  for (let i = 0; i < 3; i++) {
    const began = performance.now()
    await run()
    best = Math.min(best, performance.now() - began)
  }
  return best
}

function expectLinear(small: number, large: number): void {
  const took = `1 MB: ${Math.round(small)} ms, 5 MB: ${Math.round(large)} ms`
  expect(large / small, took).toBeLessThan(MAX_RATIO)
  expect(large, took).toBeLessThan(CEILING_MS)
}

test('adversarial text is scanned in linear time, and still hides', { timeoutMs: 180_000 }, async ($, on) => {
  const known = `kn0wn-${alnum(20, 77)}`
  const w = world(on, { [`${ROOT}/.env`]: `DB_PASSWORD=${known}\n` })
  await start($)
  const secret = ['sk', '_live_', alnum(24, 78)].join('')
  let seen = ''
  const timeFor = (bytes: number) => {
    const text = adversarial(secret, bytes) + `\n${known}\n`
    expect(text.length).toBeGreaterThanOrEqual(bytes)
    w.answer.Bash = () => bash(text)
    return bestOfThree(async () => {
      seen = stdoutOf(await runBash($, 'cat hostile.log'))
    })
  }

  const small = await timeFor(MB)
  const large = await timeFor(5 * MB)

  expect(seen.includes(secret)).toBe(false)
  expect(seen.includes(known)).toBe(false)
  expect(seen).toMatch(TICKET)
  expectLinear(small, large)
})

test('hostile text with nothing to hide passes through unchanged, in linear time', { timeoutMs: 180_000 }, async ($, on) => {
  const w = world(on)
  await start($)
  let unchanged = true
  const timeFor = (bytes: number) => {
    const text = harmless(bytes)
    w.answer.Bash = () => bash(text)
    return bestOfThree(async () => {
      unchanged &&= stdoutOf(await runBash($, 'cat hostile.log')) === text
    })
  }

  const small = await timeFor(MB)
  const large = await timeFor(5 * MB)

  expect(unchanged).toBe(true)
  expectLinear(small, large)
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
