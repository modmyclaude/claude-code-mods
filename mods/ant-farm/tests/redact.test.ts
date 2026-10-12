// The pane's secret redaction: the rules crossroads uses, kept alike here.

import { describe, expect, test } from 'claude-code/testing'

import { redact, REDACTED } from '../hooks/redact'

describe('redact', () => {
  const hidden: [string, string][] = [
    ['export DB_PASSWORD=hunter2', `export DB_PASSWORD=${REDACTED}`],
    ['curl -H "Authorization: Bearer abcdefghijklmnop" https://x', `curl -H "Authorization: Bearer ${REDACTED}" https://x`],
    ['AKIAIOSFODNN7EXAMPLE', REDACTED],
    ['git clone https://alex:p4ssw0rd@github.com/x/y.git', `git clone https://alex:${REDACTED}@github.com/x/y.git`],
    ['psql --password hunter2 db', `psql --password ${REDACTED} db`],
    ['token: ghp_abcdefghijklmnopqrstuvwxyz0123456789', `token: ${REDACTED}`],
    ['sk-proj-abcdefghijklmnopqrstuvwxyz', REDACTED],
  ]
  for (const [text, out] of hidden) test(`hides ${text.slice(0, 24)}`, () => expect(redact(text)).toBe(out))

  const kept = ['npm test', 'Edit auth.ts', 'Grep max_tokens=5', 'Bash git log --author Alex', 'Read tokens.md', 'WebFetch https://example.com/docs']
  for (const text of kept) test(`keeps ${text}`, () => expect(redact(text)).toBe(text))
})
