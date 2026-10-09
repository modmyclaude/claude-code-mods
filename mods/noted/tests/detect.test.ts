// The keyword pre-filter, table-driven: what may reach the model and what may not.

import { describe, expect, test } from 'claude-code/testing'

import { looksLikeCorrection, MAX_PROMPT_CHARS } from '../hooks/detect'

const CORRECTIONS = [
  'no, use pnpm',
  'No. Use pnpm in this repo.',
  'nope, tabs not spaces',
  'nah - keep it in one file',
  'ok, no - use the existing helper',
  'Wait, no, the API is v2',
  "don't add comments to every line",
  'Do not use default exports',
  'please don\u2019t commit without asking',
  'always run the tests before saying it is done',
  'never push to main',
  'we use pnpm not npm',
  'We use vitest, not jest.',
  "we don't use semicolons here",
  'stop adding emojis to the README',
  'Stop doing that',
  'Hey Claude, stop using any in TypeScript',
  'I told you to use tabs',
  'I already told you we deploy from main',
  'as I said, the tests live in spec/',
  'use pnpm, not npm',
  'Prefer const over let',
  'from now on, write the test first',
  'you keep forgetting the changelog',
  "Thanks. Don't rename files without asking though.",
]

const NOT_CORRECTIONS = [
  '',
  '   ',
  'no worries',
  'No worries, that works!',
  'no problem, thanks',
  'no thanks',
  'No.',
  'do not disturb mode feature',
  'Add a do not disturb mode feature to settings',
  'never mind',
  'Nevermind, it works now',
  'note: the API changed',
  'nothing changed after the deploy',
  'No-op the logger in tests',
  'Can you add a no-results message?',
  'fix the login bug',
  'it always fails on CI',
  'This never worked',
  'stop the dev server',
  "don't worry about the tests for now",
  'Why don\'t we add caching?',
  "Don't you think this is slow?",
  'Always?',
  "I don't know why this fails",
  'Refactor the client to use fetch instead of axios',
  'Here is the snippet:\n```\n// no, use pnpm\n```\nwhat does it do',
  '/rules',
  '! npm install',
]

describe('looksLikeCorrection', () => {
  for (const text of CORRECTIONS) {
    test(`passes: ${JSON.stringify(text)}`, () => {
      expect(looksLikeCorrection(text)).toBe(true)
    })
  }
  for (const text of NOT_CORRECTIONS) {
    test(`stops: ${JSON.stringify(text)}`, () => {
      expect(looksLikeCorrection(text)).toBe(false)
    })
  }

  test('stops long prompts, which are tasks rather than corrections', () => {
    const long = `don't use npm. ${'Then build the whole settings page with tabs. '.repeat(30)}`
    expect(long.length).toBeGreaterThan(MAX_PROMPT_CHARS)
    expect(looksLikeCorrection(long)).toBe(false)
    expect(looksLikeCorrection(long.slice(0, 200))).toBe(true)
  })
})
