// Table-driven tests for the pure rules: redaction, sanitizing, risk, kinds,
// numbered options, the digest, the reply parser, the list and the counts.

import { describe, expect, test } from 'claude-code/testing'
import type { AgentInfo, CommandInfo, SessionMessage } from 'claude-code'

import {
  REDACTED,
  arrange,
  buildDigest,
  buildRequest,
  busyAgents,
  closingQuestion,
  endsWithNumberedOptions,
  guessKind,
  isTrivial,
  parseReply,
  pickSlashCommands,
  redact,
  riskOf,
  sanitize,
} from '../hooks/logic'
import {
  addUsage,
  backoffGap,
  coerceRecord,
  coerceUsage,
  decideTurn,
  emptyRecord,
  estimateUsd,
  formatStatus,
  projectKey,
  recordOutcome,
  topKinds,
} from '../hooks/learn'

const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

describe('redact', () => {
  const secrets: [string, string][] = [
    ['AWS access key', 'aws key AKIAIOSFODNN7EXAMPLE here'],
    ['GitHub token', 'token ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789 ok'],
    ['GitHub fine-grained', 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz'],
    ['Anthropic key', 'use sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv-wxyz'],
    ['OpenAI key', 'OPENAI sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345'],
    ['Stripe live key', 'stripe sk_live_51HAbCdEfGhIjKlMn0'],
    ['Stripe webhook secret', 'whsec_AbCdEfGhIjKlMnOpQrSt'],
    ['JWT', 'auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
    ['private key block', '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7\n-----END RSA PRIVATE KEY-----'],
    ['password assignment', 'export DB_PASSWORD=hunter2'],
    ['quoted JSON secret', '{"client_secret": "abc123def456"}'],
    ['api key colon', 'API_KEY: s3cr3tvalue'],
    ['bearer header', 'curl -H "Authorization: Bearer abcdef1234567890xyz"'],
    ['URL password', 'git clone https://alex:p4ssw0rd@github.com/x/y.git'],
  ]
  for (const [name, text] of secrets) {
    test(`hides a ${name}`, () => {
      const out = redact(text)
      expect(out).toContain(REDACTED)
    })
  }

  test('the secret value itself is gone', () => {
    expect(redact('export DB_PASSWORD=hunter2')).toBe(`export DB_PASSWORD=${REDACTED}`)
    expect(redact('git clone https://alex:p4ssw0rd@github.com/x/y.git')).not.toContain('p4ssw0rd')
    expect(redact('AKIAIOSFODNN7EXAMPLE')).toBe(REDACTED)
  })

  const harmless = [
    'git show 3f2a9c1e5b7d8f0a1c2e3b4d5f6a7b8c9d0e1f2a',
    'commit 3f2a9c1',
    'id 123e4567-e89b-12d3-a456-426614174000',
    'pip install sk-learn',
    'set max_tokens=1024',
    'author: Alex',
    'the token count is 5',
    'open src/keys/apiKeyStore.ts',
    'task-runner --verbose',
  ]
  for (const text of harmless) {
    test(`leaves "${text}" alone`, () => {
      expect(redact(text)).toBe(text)
    })
  }
})

describe('sanitize', () => {
  const cases: [string, string, string][] = [
    ['ANSI colour codes', '\u001b[31mrun the tests\u001b[0m', 'run the tests'],
    ['an OSC title or link', '\u001b]0;pwned\u0007fix the bug', 'fix the bug'],
    ['control characters', 'run\u0000 the\u0007 tests', 'run the tests'],
    ['newlines', 'run the\ntests', 'run the tests'],
    ['zero-width and bidi', 'run\u200b the \u202etests\u202c', 'run the tests'],
    ['tag characters', 'run the tests\u{e0041}\u{e0042}', 'run the tests'],
    ['a list marker', '1. run the tests', 'run the tests'],
    ['wrapping quotes', '"run the tests"', 'run the tests'],
  ]
  for (const [name, raw, clean] of cases) {
    test(`strips ${name}`, () => {
      expect(sanitize(raw)).toBe(clean)
    })
  }

  test('caps the length at a word', () => {
    const long = Array.from({ length: 60 }, () => 'word').join(' ')
    const out = sanitize(long, 40)
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out.endsWith('word')).toBe(true)
  })
})

describe('riskOf', () => {
  const risky: [string, string][] = [
    ['push to main', 'pushes'],
    ['git push --force origin main', 'force-pushes'],
    ['force-push the branch', 'force-pushes'],
    ['deploy the app to production', 'deploys'],
    ['publish v1.2 to npm', 'publishes'],
    ['cut a release for 2.0', 'releases'],
    ['merge the PR into main', 'merges'],
    ['delete the old migrations', 'deletes'],
    ['rm -rf dist and rebuild', 'removes files'],
    ['drop the users table', 'drops'],
    ['send the summary to the team', 'sends'],
    ['open a pull request for this', 'sends'],
    ['email the client the report', 'sends'],
  ]
  for (const [text, note] of risky) {
    test(`"${text}" is risky (${note})`, () => {
      expect(riskOf(text)).toBe(note)
    })
  }

  const safe = [
    'run the auth tests',
    'add the same guard to signup.ts',
    'explain why the cache misses',
    'show the dropdown component',
    'confirm the config loads',
    'enforce the lint rule in CI',
  ]
  for (const text of safe) {
    test(`"${text}" is safe`, () => {
      expect(riskOf(text)).toBe(null)
    })
  }
})

describe('guessKind', () => {
  const cases: [string, string][] = [
    ['run the auth tests', 'test'],
    ['fix the failing login', 'fix'],
    ['push to main', 'ship'],
    ['commit these changes', 'commit'],
    ['explain why it broke', 'explain'],
    ['refactor the parser', 'refactor'],
    ['update the README', 'docs'],
    ['add the same guard to signup.ts', 'feature'],
    ['hello there', 'other'],
  ]
  for (const [text, kind] of cases) {
    test(`"${text}" is ${kind}`, () => {
      expect(guessKind(text)).toBe(kind)
    })
  }
})

describe('endsWithNumberedOptions', () => {
  const yes = [
    'I can go two ways:\n\n1. Patch the guard\n2. Roll back the change\n\nWhich would you like?',
    'Options:\n1) Keep it\n2) Drop it',
    '**Option 1:** rewrite it\n**Option 2:** leave it\n\nPick one.',
    'Choose:\n1. First\n   with a detail line\n2. Second\n3. Third',
    'Should I (1) patch it or (2) roll it back?',
  ]
  for (const text of yes) {
    test(`numbered: ${JSON.stringify(text.slice(0, 30))}`, () => {
      expect(endsWithNumberedOptions(text)).toBe(true)
    })
  }

  const no = [
    'Done. All 12 tests pass.',
    'Steps I took:\n1. Read the file\n2. Fixed the bug\n\nThe build is green now and the guard covers both routes. I also tidied two imports and updated the changelog entry for this fix.\nNothing else changed.\nLet me know.\nThanks.',
    'Only one:\n1. Run it\n\nGo ahead?',
    'Version 2.1 is out.',
  ]
  for (const text of no) {
    test(`not numbered: ${JSON.stringify(text.slice(0, 30))}`, () => {
      expect(endsWithNumberedOptions(text)).toBe(false)
    })
  }
})

describe('closingQuestion and isTrivial', () => {
  test('finds the closing question', () => {
    expect(closingQuestion('I fixed it. Want me to add a test for signup too?')).toBe('Want me to add a test for signup too?')
    expect(closingQuestion('Fixed.\n\n**Should I also update the docs?**')).toBe('Should I also update the docs?')
    expect(closingQuestion('Is this right? I think so.\nI changed three files.\nAll tests pass.')).toBe(null)
  })

  const cases: [string, string, number, boolean][] = [
    ['a one-word reply', 'Done.', 5, true],
    ['three words', 'All tests pass', 2, true],
    ['no tools and no question', 'Here is how the cache works, in some detail.', 0, true],
    ['no tools but a question', 'I can do that. Should I start with the parser?', 0, false],
    ['tools used', 'I fixed the null check in auth.ts and the tests pass.', 3, false],
  ]
  for (const [name, answer, tools, trivial] of cases) {
    test(`${name}: trivial is ${trivial}`, () => {
      expect(isTrivial(answer, tools, closingQuestion(answer))).toBe(trivial)
    })
  }
})

describe('the digest', () => {
  const messages: SessionMessage[] = [
    { role: 'user', text: 'make login safer', toolUses: [] },
    { role: 'assistant', text: 'ok', toolUses: [{ tool_use_id: 'r0', tool: 'Read', input: { file_path: '/repo/old.ts' } }] },
    { role: 'user', text: '<command-name>/review</command-name>', toolUses: [] },
    { role: 'user', text: 'add a guard to auth.ts, key is sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv', toolUses: [] },
    {
      role: 'assistant',
      text: '',
      toolUses: [
        { tool_use_id: 'a', tool: 'Read', input: { file_path: '/repo/src/auth.ts' } },
        { tool_use_id: 'b', tool: 'Edit', input: { file_path: '/repo/src/auth.ts', old_string: 'SECRET_BODY', new_string: 'x' } },
        { tool_use_id: 'c', tool: 'Bash', input: { command: 'npm test -- auth\necho hidden-second-line' }, text: 'ok' },
        { tool_use_id: 'd', tool: 'Bash', input: { command: 'DB_PASSWORD=hunter2 npm run e2e' }, isError: true, text: 'fail' },
        { tool_use_id: 'e', tool: 'Bash', input: { command: 'npm run lint' } },
      ],
    },
    {
      role: 'user',
      text: '',
      toolUses: [],
      toolResults: [{ tool_use_id: 'e', text: 'lint failed', isError: true }],
    },
  ]
  const answer = 'Added the guard. Want me to add the same to signup.ts?'
  const digest = buildDigest(messages, answer, ['review', 'deploy'])

  test('goal, last prompt and question, secrets replaced', () => {
    expect(digest.goal).toBe('make login safer')
    expect(digest.lastPrompt).toContain('add a guard to auth.ts')
    expect(digest.lastPrompt).not.toContain('sk-ant-')
    expect(digest.question).toBe('Want me to add the same to signup.ts?')
  })

  test('file names only, this turn only', () => {
    expect(digest.edited).toEqual(['auth.ts'])
    expect(digest.read).toEqual([])
    expect(JSON.stringify(digest)).not.toContain('/repo')
    expect(JSON.stringify(digest)).not.toContain('old.ts')
    expect(JSON.stringify(digest)).not.toContain('SECRET_BODY')
  })

  test('commands with pass or fail, first line, redacted', () => {
    expect(digest.commands).toEqual([
      { command: 'npm test -- auth', outcome: 'ok' },
      { command: `DB_PASSWORD=${REDACTED} npm run e2e`, outcome: 'fail' },
      { command: 'npm run lint', outcome: 'fail' },
    ])
    expect(digest.toolUses).toBe(5)
  })

  test('the request carries the digest and nothing else of the transcript', () => {
    const request = buildRequest(digest, { want: 2, already: 'run the auth tests', topKinds: ['test', 'fix'] })
    expect(request.prompt).toContain('2 different next prompts')
    expect(request.prompt).toContain('Already suggested (do not repeat): run the auth tests')
    expect(request.prompt).toContain('This person most often takes: test, fix')
    expect(request.prompt).toContain('/review, /deploy')
    expect(request.prompt).not.toContain('hidden-second-line')
    expect(request.prompt).not.toContain('hunter2')
  })

  test('slash commands: used here first, then custom ones, never built-ins or its own', () => {
    const listed: CommandInfo[] = [
      { name: 'help', description: '', source: 'builtin' },
      { name: 'deploy', description: '', source: 'user' },
      { name: 'crossroads', description: '', source: 'plugin' },
      { name: 'review', description: '', source: 'plugin' },
    ]
    expect(pickSlashCommands(messages, listed, 'crossroads')).toEqual(['review', 'deploy'])
  })
})

describe('parseReply', () => {
  const good = '{"items":[{"text":"run the auth tests","kind":"test"},{"text":"push to main","kind":"ship"},{"text":"add a guard to signup.ts","kind":"feature"}]}\nEND'
  test('a well-formed reply', () => {
    expect(parseReply(good, 3)).toEqual([
      { text: 'run the auth tests', kind: 'test' },
      { text: 'push to main', kind: 'ship' },
      { text: 'add a guard to signup.ts', kind: 'feature' },
    ])
  })
  test('code fences are tolerated, a bad kind is guessed', () => {
    const fenced = '```json\n{"items":[{"text":"fix the login bug","kind":"vibes"}]}\n```\nEND'
    expect(parseReply(fenced, 1)).toEqual([{ text: 'fix the login bug', kind: 'fix' }])
  })

  const bad: [string, string][] = [
    ['no sentinel (cut off)', good.replace(/\nEND$/, '')],
    ['cut mid-JSON', '{"items":[{"text":"run the'],
    ['prose', 'You could run the tests next.\nEND'],
    ['not JSON', "{items: ['run tests']}\nEND"],
    ['a non-string text', '{"items":[{"text":3},{"text":"b"},{"text":"c"}]}\nEND'],
    ['too few items', '{"items":[{"text":"run the tests","kind":"test"}]}\nEND'],
    ['no items key', '{"suggestions":[]}\nEND'],
    ['sentinel inside the JSON only', '{"items":[{"text":"END"}]}'],
  ]
  for (const [name, raw] of bad) {
    test(`${name}: nothing`, () => {
      expect(parseReply(raw, 3)).toBe(null)
    })
  }
})

describe('arrange', () => {
  const gen = [
    { text: 'push to main', kind: 'ship' as const },
    { text: 'add a guard to signup.ts', kind: 'feature' as const },
  ]
  test('a safe engine guess is option 1', () => {
    const items = arrange({ text: 'run the auth tests', risky: false }, gen)
    expect(items.map(item => item.text)).toEqual(['run the auth tests', 'add a guard to signup.ts', 'push to main'])
    expect(items[0]?.fromEngine).toBe(true)
    expect(items[2]?.risk).toBe('pushes')
  })
  test('a risky engine guess is never option 1', () => {
    const items = arrange({ text: 'git push origin main', risky: true }, [
      { text: 'run the auth tests', kind: 'test' },
      { text: 'add a guard to signup.ts', kind: 'feature' },
    ])
    expect(items[0]?.risk).toBe(null)
    expect(items[2]?.text).toBe('git push origin main')
    expect(items[2]?.fromEngine).toBe(true)
  })
  test('duplicates of the guess are dropped', () => {
    const items = arrange({ text: 'Run the auth tests.', risky: false }, [
      { text: 'run the auth tests', kind: 'test' },
      { text: 'fix the bug', kind: 'fix' },
    ])
    expect(items).toHaveLength(2)
  })
})

describe('busyAgents', () => {
  const agent = (status: AgentInfo['status'], extra: Partial<AgentInfo> = {}): AgentInfo => ({
    id: status,
    description: 'x',
    type: 'general-purpose',
    status,
    ...extra,
  })
  test('counts running background work, not finished agents or teammates', () => {
    expect(
      busyAgents([
        agent('running'),
        agent('pending'),
        agent('completed'),
        agent('failed'),
        agent('running', { teammateId: 'ann@team', type: 'teammate' }),
      ]),
    ).toBe(2)
  })
})

describe('learning and back-off', () => {
  test('three ignored lists back off, a take recovers', () => {
    let record = emptyRecord()
    for (let i = 0; i < 3; i++) record = recordOutcome(record, { type: 'ignored', kinds: ['test', 'fix'] })
    expect(record.streak).toBe(3)
    expect(backoffGap(record.streak)).toBe(2)

    const first = decideTurn(record)
    expect(first.isAllowed).toBe(false)
    const second = decideTurn(first.record)
    expect(second.isAllowed).toBe(true)

    record = recordOutcome(second.record, { type: 'taken', kind: 'test' })
    expect(record.streak).toBe(0)
    expect(decideTurn(record).isAllowed).toBe(true)
  })

  test('the gap grows to every 8th turn', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(backoffGap)).toEqual([1, 1, 1, 2, 4, 8, 8])
  })

  test('top kinds by takes and edits', () => {
    let record = emptyRecord()
    for (const kind of ['fix', 'test', 'test', 'run', 'docs', 'docs', 'docs'] as const) record = recordOutcome(record, { type: 'taken', kind })
    record = recordOutcome(record, { type: 'edited', kind: 'fix' })
    expect(topKinds(record)).toEqual(['docs', 'test', 'fix'])
  })

  test('a stored record is read back safely', () => {
    expect(coerceRecord('junk')).toEqual(emptyRecord())
    expect(coerceRecord({ taken: { test: 2, nope: 5, fix: -1 }, streak: 'x' })).toEqual({ ...emptyRecord(), taken: { test: 2 } })
  })

  test('project keys are short, stable and do not hold the path', () => {
    const key = projectKey('/Users/me/secret-project')
    expect(key).toBe(projectKey('/Users/me/secret-project'))
    expect(key).not.toBe(projectKey('/Users/me/other'))
    expect(key).toMatch(/^project:[0-9a-f]{8}$/)
  })
})

describe('cost', () => {
  test('a typical call is about $0.0002', () => {
    const usd = estimateUsd({ ...ZERO, input_tokens: 700, output_tokens: 250 })
    expect(usd).toBeGreaterThan(0.0001)
    expect(usd).toBeLessThan(0.0003)
  })
  test('the tally restarts each day and the status prints it', () => {
    const usage = { ...ZERO, input_tokens: 1000, output_tokens: 200 }
    const one = addUsage(undefined, '2026-10-09', usage)
    const two = addUsage(one, '2026-10-09', usage)
    expect(two.calls).toBe(2)
    expect(coerceUsage(two, '2026-10-10').calls).toBe(0)
    const text = formatStatus(true, two, emptyRecord())
    expect(text).toContain('Today: 2 calls, about $0.0004')
  })
})
