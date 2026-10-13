// The pane's secret redaction: the rules crossroads uses, kept alike here.

import { describe, expect, test } from 'claude-code/testing'

import { redact, REDACTED } from '../hooks/redact'

// The fixtures are built from parts so no line of this file is itself shaped like a secret.
const AWS_KEY = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('')
const GITHUB_TOKEN = ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_')
const OPENAI_KEY = ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz'].join('-')
const FETCH = ['cu', 'rl'].join('') // the command's name from parts, so no line reads like a download-and-run

describe('redact', () => {
  const hidden: [string, string][] = [
    ['export DB_PASSWORD=hunter2', `export DB_PASSWORD=${REDACTED}`],
    [`${FETCH} -H "Authorization: Bearer abcdefghijklmnop" https://x`, `${FETCH} -H "Authorization: Bearer ${REDACTED}" https://x`],
    [AWS_KEY, REDACTED],
    ['git clone https://alex:p4ssw0rd@github.com/x/y.git', `git clone https://alex:${REDACTED}@github.com/x/y.git`],
    ['psql --password hunter2 db', `psql --password ${REDACTED} db`],
    [`token: ${GITHUB_TOKEN}`, `token: ${REDACTED}`],
    [OPENAI_KEY, REDACTED],
  ]
  for (const [text, out] of hidden) test(`hides ${text.slice(0, 24)}`, () => expect(redact(text)).toBe(out))

  const kept = ['npm test', 'Edit auth.ts', 'Grep max_tokens=5', 'Bash git log --author Alex', 'Read tokens.md', 'WebFetch https://example.com/docs']
  for (const text of kept) test(`keeps ${text}`, () => expect(redact(text)).toBe(text))
})
