import { describe, expect, test } from 'claude-code/testing'
import type { SessionMessage, ToolUseSummary } from 'claude-code'

import type { FinePrintNote, FinePrintTopic } from '../types'
import {
  TOPICS,
  ago,
  buildRequest,
  clean,
  clipReply,
  countWords,
  describeToolUse,
  drawable,
  explainPrompt,
  formatNotes,
  isOwnQuestion,
  maskSecrets,
  noteBlocks,
  parseMaxChecks,
  parseVerdict,
  parseWatchFor,
  summarizeTools,
  turnToolUses,
} from '../hooks/logic'

// Secret-shaped fixtures are built from parts, so no line of this file is itself shaped like a key.
const AWS_KEY = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('')
const AWS_SECRET = ['wJalrXUtnFEMI', 'K7MDENG'].join('/')
const ANTHROPIC_KEY = ['sk', 'ant', 'api03', 'abcdefghijklmnopqrst'].join('-')
const STRIPE_KEY = ['sk', 'live', '51Habcdefghijk'].join('_')
const GITHUB_TOKEN = ['ghp', 'abcdefghijklmnopqrstuvwxyz0123'].join('_')
const SLACK_TOKEN = ['xoxb', '1234567890', 'abcdefghij'].join('-')

const ALL = [...TOPICS]

// The fastest of three runs, in ms: a busy machine slows one run, not all three,
// while a super-linear pattern is slow every time.
function bestOfThree(run: () => unknown): number {
  return Math.min(
    ...[0, 1, 2].map(() => {
      const started = performance.now()
      run()
      return performance.now() - started
    }),
  )
}

describe('parseWatchFor', () => {
  const cases: [unknown, FinePrintTopic[]][] = [
    [undefined, ALL],
    [[], ALL],
    ['', ALL],
    ['all', ALL],
    [['cost', 'all'], ALL],
    [ALL, ALL],
    [['cost'], ['cost']],
    ['security, cost', ['cost', 'security']],
    ['Data Loss', ['data-loss']],
    ['data_loss,customer', ['data-loss', 'customers']],
    ['privacy', ['security']],
    [['cost', 'bogus'], ['cost']],
    ['secruity', ALL],
    ['none', []],
    [['off'], []],
    [['none', 'cost'], ['cost']],
    [['none', 'secuirty'], []],
  ]
  for (const [raw, expected] of cases) {
    test(`${JSON.stringify(raw)} -> ${expected.join(',') || '(none)'}`, () => {
      expect(parseWatchFor(raw)).toEqual(expected)
    })
  }
})

describe('parseMaxChecks', () => {
  const cases: [unknown, number][] = [
    [30, 30],
    [0, 0],
    [5, 5],
    [-4, 0],
    [2.7, 2],
    [Number.NaN, 30],
    ['10', 30],
    [undefined, 30],
  ]
  for (const [raw, expected] of cases) {
    test(`${String(raw)} -> ${expected}`, () => expect(parseMaxChecks(raw)).toBe(expected))
  }
})

describe('countWords', () => {
  const cases: [string, number][] = [
    ['', 0],
    ['one two three', 3],
    ['  spaced\n\nout\ttext  ', 3],
    ['- | ``` ---', 0],
    ['run `npm test` - then 2 more', 6],
  ]
  for (const [text, expected] of cases) {
    test(JSON.stringify(text), () => expect(countWords(text)).toBe(expected))
  }
})

const use = (id: string, tool: string, input: Record<string, unknown>, isError?: true): ToolUseSummary =>
  isError ? { tool_use_id: id, tool, input, isError } : { tool_use_id: id, tool, input }

describe('turnToolUses', () => {
  test('keeps only the calls since the last prompt', () => {
    const messages: SessionMessage[] = [
      { role: 'user', text: 'old prompt', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [use('o', 'Bash', { command: 'echo old' })] },
      { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'o', text: 'old', isError: false }] },
      { role: 'assistant', text: 'done', toolUses: [] },
      { role: 'user', text: 'new prompt', toolUses: [] },
      { role: 'assistant', text: 'looking', toolUses: [use('a', 'Read', { file_path: '/a' })] },
      { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'x', isError: false }] },
      { role: 'assistant', text: '', toolUses: [use('b', 'Bash', { command: 'ls' })] },
      { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'b', text: 'y', isError: false }] },
      { role: 'assistant', text: 'final', toolUses: [] },
    ]
    expect(turnToolUses(messages).map(one => one.tool_use_id)).toEqual(['a', 'b'])
  })

  test('no tool calls, or no messages at all', () => {
    expect(turnToolUses([{ role: 'user', text: 'hi', toolUses: [] }])).toEqual([])
    expect(turnToolUses([])).toEqual([])
  })
})

describe('describeToolUse', () => {
  const cases: [ToolUseSummary, string][] = [
    [use('1', 'Bash', { command: 'fly deploy --app prod\necho second line' }), 'Bash (command: fly deploy --app prod)'],
    [use('2', 'Write', { file_path: '/app/.env', content: 'TOKEN=hunter2' }), 'Write (file_path: /app/.env)'],
    [
      use('3', 'Edit', { file_path: 'a.ts', old_string: 'secret old', new_string: 'secret new' }),
      'Edit (file_path: a.ts)',
    ],
    [use('4', 'TodoWrite', { todos: [] }), 'TodoWrite'],
    [use('5', 'Bash', { command: 'rm -rf build' }, true), 'Bash (command: rm -rf build) [failed]'],
    [
      use('6', 'mcp__mail__send', { to: 'all@customers.example', subject: 'Price change', body: 'long body' }),
      'mcp__mail__send (to: all@customers.example; subject: Price change)',
    ],
  ]
  for (const [input, expected] of cases) {
    test(expected, () => expect(describeToolUse(input)).toBe(expected))
  }

  test('caps a long target', () => {
    const line = describeToolUse(use('7', 'Bash', { command: 'x'.repeat(500) }))
    expect(line.length).toBeLessThan(200)
    expect(line).toContain('...')
  })
})

describe('maskSecrets hides secret-shaped text', () => {
  const hidden: [string, string, string][] = [
    // [input, a secret that must be gone, text that must remain]
    ['curl -H "Authorization: Bearer sk-xxxxxxxxxxxxxxxxxxxx" https://api.example.com', 'xxxxxxxxxxxxxxxxxxxx', 'https://api.example.com'],
    ['curl -u x --oauth2-bearer abcdef123456789 https://a.io', 'abcdef123456789', 'https://a.io'],
    ['echo "DB_PASSWORD=hunter2" >> .env', 'hunter2', '>> .env'],
    ['PGPASSWORD=s3cr3t psql -h db', 's3cr3t', 'psql -h db'],
    ['https://api.example.com/v1/items?api_key=AKIASECRET&page=2', 'AKIASECRET', 'page=2'],
    ['export GITHUB_TOKEN=abc123def456', 'abc123def456', 'export GITHUB_TOKEN='],
    ['deploy --token=tok_live_xxxxxx --app prod', 'tok_live_xxxxxx', '--app prod'],
    ['{"client_secret": "shh-very-quiet"}', 'shh-very-quiet', 'client_secret'],
    [`AWS_SECRET_ACCESS_KEY=${AWS_SECRET} aws s3 ls`, AWS_SECRET.slice(0, 13), 'aws s3 ls'],
    ['git push https://alex:p4ssw0rd@github.com/a/b.git', 'p4ssw0rd', 'github.com/a/b.git'],
    [`use ${ANTHROPIC_KEY} now`, 'abcdefghijklmnopqrst', 'now'],
    [`stripe key ${STRIPE_KEY}`, '51Habcdefghijk', 'stripe'],
    [`gh auth ${GITHUB_TOKEN}`, GITHUB_TOKEN.slice(0, 14), 'gh auth'],
    [`slack ${SLACK_TOKEN}`, SLACK_TOKEN.slice(0, 15), 'slack'],
    [`aws ${AWS_KEY}`, AWS_KEY, 'aws'],
    ['checksum 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', '9f86d081884c7d65', 'checksum'],
    ['blob dGhpc0lzQVZlcnlMb25nU2VjcmV0VmFsdWUxMjM0NTY3OA== end', 'dGhpc0lzQVZlcnlMb25n', 'end'],
  ]
  for (const [input, secret, kept] of hidden) {
    test(input.slice(0, 50), () => {
      const masked = maskSecrets(input)
      expect(masked).not.toContain(secret)
      expect(masked).toContain('[hidden]')
      expect(masked).toContain(kept)
    })
  }

  const untouched = [
    'npm test -- --watch=false',
    'fly deploy --app prod',
    '/usr/local/lib/node_modules/typescript/lib/tsc.js',
    'git commit -m "fix token handling"',
    'curl https://api.example.com/v1/items?page=2&max_tokens=1024',
    'setxkbmap keyboard_layout=us',
    'src/components/AccountSettingsPanel.tsx',
  ]
  for (const input of untouched) test(`leaves alone: ${input}`, () => expect(maskSecrets(input)).toBe(input))

  // Repetitive input shaped to make a backtracking regex explode. Each must
  // finish fast: the masker runs inside turn.complete, before the turn ends.
  const adversarial: [string, string][] = [
    ['key- runs', 'key-'.repeat(12_500)],
    ['api-key- runs', 'api-key-'.repeat(6_250)],
    ['token- runs', 'token-'.repeat(8_334)],
    ['a= pairs', 'a='.repeat(25_000)],
    ['token= pairs', 'token='.repeat(8_334)],
    ['open quotes', 'password="'.repeat(5_000)],
    ['spaces before no separator', `authorization${' '.repeat(50_000)}`],
    ['one long name', `${'x'.repeat(50_000)}!`],
    ['userinfo without @', `//${'a:'.repeat(25_000)}`],
    ['hex then a letter', `${'a'.repeat(50_000)}g`],
    ['mixed base64 with no end', `${'aA1'.repeat(16_667)}`],
    ['sk- runs', 'sk-'.repeat(16_667)],
  ]
  for (const [name, input] of adversarial) {
    test(`stays fast on ${input.length} characters of ${name}`, () => {
      expect(bestOfThree(() => maskSecrets(input))).toBeLessThan(200)
    })
  }

  test('describeToolUse masks before it caps', () => {
    const line = describeToolUse(use('s', 'Bash', { command: `${'x'.repeat(150)} API_KEY=abcdefghijklmnop` }))
    expect(line).not.toContain('abcdefghijklmnop')
    // A secret that straddles the 160-character cap is masked whole, not cut in half.
    const straddle = describeToolUse(use('t', 'Bash', { command: `${'x'.repeat(145)} ${GITHUB_TOKEN}` }))
    expect(straddle).not.toContain(GITHUB_TOKEN.slice(0, 7))
    expect(describeToolUse(use('u', 'WebFetch', { url: 'https://h.io/?token=zzz111' }))).toBe('WebFetch (url: https://h.io/?token=[hidden])')
  })
})

test('isOwnQuestion is true only when the last prompt is Fine Print\'s Explain more', () => {
  const asked: SessionMessage[] = [
    { role: 'user', text: explainPrompt(note('n', 0, 'open')), toolUses: [] },
    { role: 'assistant', text: 'Here is what it means.', toolUses: [] },
  ]
  expect(isOwnQuestion(asked)).toBe(true)
  expect(isOwnQuestion([...asked, { role: 'user', text: 'thanks, now deploy', toolUses: [] }])).toBe(false)
  expect(isOwnQuestion([{ role: 'user', text: 'Fine Print is a nice name', toolUses: [] }])).toBe(false)
  expect(isOwnQuestion([])).toBe(false)
})

test('summarizeTools keeps the newest 40 and says how many it cut', () => {
  const uses = Array.from({ length: 45 }, (_, index) => use(String(index), 'Read', { file_path: `/f${index}` }))
  const lines = summarizeTools(uses)
  expect(lines).toHaveLength(41)
  expect(lines[0]).toBe('(5 earlier calls not shown)')
  expect(lines.at(-1)).toBe('Read (file_path: /f44)')
})

test('clipReply keeps short replies whole and long ones as head and tail', () => {
  expect(clipReply('short')).toBe('short')
  const long = `${'a'.repeat(10_000)}${'z'.repeat(10_000)}`
  const clipped = clipReply(long)
  expect(clipped.length).toBeLessThan(12_100)
  expect(clipped).toContain('characters cut')
  expect(clipped.startsWith('a')).toBe(true)
  expect(clipped.endsWith('z')).toBe(true)
})

test('buildRequest sends only the watched topics, the tool lines and the reply', () => {
  const { system, prompt } = buildRequest('THE REPLY', ['Bash (command: ls)'], ['cost', 'security'])
  expect(system).toContain('JSON')
  expect(prompt).toContain('- cost:')
  expect(prompt).toContain('- security:')
  expect(prompt).not.toContain('- customers:')
  expect(prompt).toContain('- Bash (command: ls)')
  expect(prompt).toContain('<reply>\nTHE REPLY\n</reply>')
  expect(buildRequest('r', [], ALL).prompt).toContain('(none)')
})

describe('clean', () => {
  const cases: [unknown, string][] = [
    [42, ''],
    ['  plain   text ', 'plain text'],
    ['a\u2014b', 'a - b'],
    ['cost \u2013 high', 'cost - high'],
    ['- leading marker', 'leading marker'],
    ['2) numbered', 'numbered'],
    ['line\none\u0007', 'line one\ufffd'],
    ['\u001b[31mred\u001b[0m alert', 'red alert'],
    ['bell\u0007 nul\u0000 del\u007f nel\u0085', 'bell\ufffd nul\ufffd del\ufffd nel\ufffd'],
    ['safe\u202eevil\u2066', 'safe evil'],
  ]
  for (const [raw, expected] of cases) {
    test(JSON.stringify(raw), () => expect(clean(raw, 100)).toBe(expected))
  }

  test('caps with an ellipsis', () => expect(clean('abcdefghij', 8)).toBe('abcde...'))
})

describe('drawable', () => {
  const cases: [string, string][] = [
    ['plain text', 'plain text'],
    ['keeps\nnewlines', 'keeps\nnewlines'],
    ['tab\there\r', 'tab here '],
    ['\u001b[1;31mbold red\u001b[0m', 'bold red'],
    ['\u001b]0;title\u0007after', 'after'],
    ['\u001b]8;;https://x.io\u001b\\link\u001b]8;;\u001b\\', 'link'],
    ['\u009b2Jcleared', 'cleared'],
    ['\u001bcreset', 'reset'],
    ['a\u0000b\u0007c\u007fd\u0085e\u0098f', 'a\ufffdb\ufffdc\ufffdd\ufffde\ufffdf'],
    // The C1 CSI byte with its final byte is a whole sequence, removed.
    ['e\u009bf', 'e'],
    ['lone escape \u001b', 'lone escape \ufffd'],
    // An unterminated OSC loses its ESC ] like any two-byte escape; no control is left.
    ['unterminated \u001b]0;title', 'unterminated 0;title'],
  ]
  for (const [raw, expected] of cases) {
    test(JSON.stringify(raw), () => expect(drawable(raw)).toBe(expected))
  }

  test('leaves no control character behind, on any input', () => {
    const every = Array.from({ length: 0xa0 }, (_, code) => String.fromCharCode(code)).join('')
    expect(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(drawable(every))).toBe(false)
  })

  test('stays fast on 50000 characters of escapes', () => {
    expect(bestOfThree(() => drawable('\u001b]'.repeat(25_000)))).toBeLessThan(200)
    expect(bestOfThree(() => drawable('\u001b['.repeat(25_000)))).toBeLessThan(200)
  })
})

describe('parseVerdict', () => {
  const NOTE = { flag: true, topics: ['cost'], headline: 'A paid database is left running', bullets: ['About $50 a month'] }
  const cases: [string, string, Record<string, unknown>?][] = [
    ['{"flag": false}', 'silent'],
    [JSON.stringify(NOTE), 'note', { headline: 'A paid database is left running', topics: ['cost'] }],
    ['```json\n' + JSON.stringify(NOTE) + '\n```', 'note'],
    ['Here you go: ' + JSON.stringify(NOTE) + ' Thanks.', 'note'],
    ['not json at all', 'malformed'],
    ['{"flag": tru', 'malformed'],
    ["{flag: true, headline: 'single quotes', topics: ['cost']}", 'malformed'],
    ['[1, 2]', 'malformed'],
    ['{"flag": "yes"}', 'malformed'],
    ['{"flag": true, "topics": ["cost"]}', 'malformed'],
    ['{"flag": true, "headline": "  ", "topics": ["cost"]}', 'malformed'],
    ['{"flag": true, "headline": "x", "topics": "cost"}', 'malformed'],
    ['{"flag": true, "headline": "x", "topics": ["cost"], "bullets": "one"}', 'malformed'],
    ['{"flag": true, "headline": "x", "topics": ["customers"]}', 'silent'],
    ['{"flag": true, "headline": "x", "topics": ["made-up"]}', 'silent'],
    ['{"flag": true, "headline": "No bullets is fine", "topics": ["cost"]}', 'note', { bullets: [] }],
    [
      '{"flag": true, "headline": "Dash \u2014 here", "topics": ["Cost", 7], "bullets": ["1", "2", "3", "4", "5", "6", 9]}',
      'note',
      { headline: 'Dash - here', bullets: ['1', '2', '3', '4'], topics: ['cost'] },
    ],
  ]
  for (const [raw, kind, fields] of cases) {
    test(`${kind}: ${raw.slice(0, 60)}`, () => {
      const verdict = parseVerdict(raw, ['cost', 'security'])
      expect(verdict.kind).toBe(kind)
      if (fields !== undefined) expect(verdict).toMatchObject(fields)
    })
  }
})

describe('ago', () => {
  const cases: [number, string][] = [
    [-5, 'just now'],
    [30_000, 'just now'],
    [4 * 60_000, '4 min ago'],
    [2 * 3_600_000, '2 h ago'],
    [3 * 86_400_000, '3 d ago'],
  ]
  for (const [ms, expected] of cases) test(expected, () => expect(ago(ms)).toBe(expected))
})

const note = (id: string, at: number, status: FinePrintNote['status']): FinePrintNote => ({
  id,
  at,
  headline: `Headline ${id}`,
  bullets: [`Bullet ${id}`],
  topics: ['cost'],
  status,
})

test('formatNotes lists newest first with status, age and spend', () => {
  const text = formatNotes([note('old', 0, 'dismissed'), note('new', 600_000, 'open')], 660_000, 2, 30)
  expect(text).toContain('Fine Print: 2 notes this session, newest first.')
  expect(text.indexOf('Headline new')).toBeLessThan(text.indexOf('Headline old'))
  expect(text).toContain('1. Headline new (open, 1 min ago; cost)')
  expect(text).toContain('2. Headline old (dismissed, 11 min ago; cost)')
  expect(text).toContain('   - Bullet old')
  expect(text).toContain('Checks used this session: 2 of 30.')
})

test('formatNotes keeps notes of the same moment newest first', () => {
  const text = formatNotes([note('first', 5, 'open'), note('second', 5, 'open')], 5, 2, 30)
  expect(text.indexOf('Headline second')).toBeLessThan(text.indexOf('Headline first'))
})

test('noteBlocks gives one block per note, each with its bullets', () => {
  const blocks = noteBlocks([note('old', 0, 'dismissed'), note('new', 600_000, 'open')], 660_000, 2, 30)
  expect(blocks).toEqual([
    'Fine Print: 2 notes this session, newest first.',
    '1. Headline new (open, 1 min ago; cost)\n   - Bullet new',
    '2. Headline old (dismissed, 11 min ago; cost)\n   - Bullet old',
    'Checks used this session: 2 of 30.',
  ])
  expect(noteBlocks([], 0, 0, 30)).toEqual(['Fine Print has flagged nothing this session. Checks used this session: 0 of 30.'])
})

test('formatNotes says when nothing was flagged', () => {
  expect(formatNotes([], 0, 3, 30)).toBe('Fine Print has flagged nothing this session. Checks used this session: 3 of 30.')
})

test('explainPrompt names the plugin and carries the note', () => {
  const text = explainPrompt(note('n', 0, 'open'))
  expect(text).toContain('Fine Print (a second-reader plugin)')
  expect(text).toContain('Headline n')
  expect(text).toContain('- Bullet n')
})
