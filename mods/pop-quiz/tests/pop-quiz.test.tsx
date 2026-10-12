// pop-quiz through the real chains: which turns get a quiz, what the small
// model is sent, the band and its presses, the score, and the logic alone.

import { describe, expect, test } from 'claude-code/testing'

import { MAX_DIFF, MAX_PROMPT, changeOf, costOf, isQuizTurn, isSecretFile, parseReply, sanitize, summarize } from '../hooks/logic'
import { readSettings } from '../hooks/register'
import { ROOT, SURFACES, TWO, band, bandTexts, edit, quizCmd, readFile, reply, start, turn, world, write } from './world'

const ON = { options: { enabled: true, every: 1 } }

describe('which turns get a quiz', () => {
  test('a turn that edited a file gets one call, carrying the file list and a short diff', ON, async ($, on) => {
    const w = world(on)
    await start($)
    await turn($, w, [edit()])
    expect(w.calls).toHaveLength(1)
    expect(w.calls[0]!.model).toBe('haiku')
    expect(w.calls[0]!.prompt).toBe('Files changed: src/db.ts\n\nThe change:\n--- src/db.ts\n- const a = 1\n+ const a = 2')
  })

  test('a turn that only read files, or answered with no tools, gets none', ON, async ($, on) => {
    const w = world(on)
    await start($)
    await turn($, w, [readFile()])
    await turn($, w, [])
    expect(w.calls).toEqual([])
  })

  test('off by default: no call until /pop-quiz on', async ($, on) => {
    const w = world(on)
    await start($)
    await quizCmd($, 'every 1')
    await turn($, w, [edit()])
    expect(w.calls).toEqual([])
    await quizCmd($, 'on')
    await turn($, w, [edit()])
    expect(w.calls).toHaveLength(1)
  })

  test('every 3 quizzes the 3rd, 6th and 9th turns that changed files, and no other', { options: { enabled: true } }, async ($, on) => {
    const w = world(on)
    await start($)
    const quizzedAfter: number[] = []
    let changed = 0
    for (let i = 0; i < 12; i++) {
      const before = w.calls.length
      if (i % 4 === 3) await turn($, w, [readFile()]) // read-only turns never count
      else {
        changed++
        await turn($, w, [edit()])
      }
      if (w.calls.length > before) quizzedAfter.push(changed)
    }
    expect(quizzedAfter).toEqual([3, 6, 9])
  })

  test('the model is sent the diff summary only, capped, secrets redacted, a .env never', ON, async ($, on) => {
    const w = world(on)
    await start($)
    const key = ['sk', '_live_', 'Q'.repeat(24)].join('')
    await turn($, w, [edit(`${ROOT}/src/pay.ts`, 'const k = 1', `const STRIPE_KEY = "${key}"\n${'x'.repeat(5_000)}`), write(`${ROOT}/.env`, `STRIPE_KEY=${key}\n`)])
    const prompt = w.calls[0]!.prompt
    expect(prompt).not.toContain(key)
    expect(prompt).toContain('--- .env (contents not sent)')
    expect(prompt.length).toBeLessThanOrEqual(MAX_PROMPT)
    expect(prompt.slice(prompt.indexOf('The change:\n') + 12).length).toBeLessThanOrEqual(MAX_DIFF)
  })

  test('a reply that fails is asked again once, then nothing shows; a refused model is not asked again', ON, async ($, on) => {
    const w = world(on)
    w.replies = ['fail', 'fail']
    await start($)
    await turn($, w, [edit()])
    expect(w.calls).toHaveLength(2)
    expect(await bandTexts($)).toEqual([])
    w.replies = ['fail', TWO]
    w.calls = []
    await turn($, w, [edit()])
    expect(w.calls).toHaveLength(2)
    expect((await bandTexts($))[1]).toBe('1. Why does the migration add an index on user_id?')
    w.replies = ['deny']
    w.calls = []
    await turn($, w, [edit()])
    expect(w.calls).toHaveLength(1)
  })

  test('no call where nothing draws the band (VS Code, a headless run)', ON, async ($, on) => {
    const w = world(on)
    w.surfaces = ['vscode']
    await start($)
    await turn($, w, [edit()])
    expect(w.calls).toEqual([])
  })
})

describe('the band', () => {
  for (const surface of SURFACES) {
    test(`two questions with show answer each, and skip, on ${surface}`, ON, async ($, on) => {
      const w = world(on)
      await start($)
      await turn($, w, [edit()])
      expect(await bandTexts($, surface)).toEqual([
        'pop quiz on the last change',
        '1. Why does the migration add an index on user_id?',
        '2. What does retry() now do on a 429?',
        'No grading. It clears when you send your next prompt.',
      ])
      const ui = await band($, surface)
      await ui.press({ key: 'show-0' })
      expect((await ui.findAll({ type: 'Text' })).map(t => t.text)[1]).toBe('1. Lookups by user were a full scan.')
      await ui.press({ key: 'skip' })
      await ui.unmount()
      expect(await bandTexts($, surface)).toEqual([])
    })
  }

  test('the next prompt clears it, and a quiz still being written for an older turn is dropped', ON, async ($, on) => {
    const w = world(on)
    await start($)
    await turn($, w, [edit()])
    await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
    expect(await bandTexts($)).toEqual([])
  })

  test('the model\'s words are cleaned before they are drawn', ON, async ($, on) => {
    const w = world(on)
    w.replies = [reply([{ q: 'Why\x1b[2J this?\x07', a: 'a' }, { q: 'And\nthat?', a: 'b' }])]
    await start($)
    await turn($, w, [edit()])
    expect((await bandTexts($)).slice(1, 3)).toEqual(['1. Why this?', '2. And that?'])
  })
})

describe('/pop-quiz', () => {
  test('score counts asked, shown and skipped, and the store keeps the all-time totals', ON, async ($, on) => {
    const w = world(on)
    await start($)
    await turn($, w, [edit()])
    const ui = await band($)
    await ui.press({ key: 'show-0' })
    await ui.press({ key: 'skip' })
    await ui.unmount()
    await turn($, w, [edit()])
    expect((await quizCmd($, 'score')).text).toBeUndefined()
    expect(w.toasts.at(-1)).toMatch(/^pop-quiz: this session 2 asked, 1 answers shown, 1 skipped; all time 2 asked, 1 shown, 1 skipped\. About \$0\.\d{4} this session at small-model list prices\.$/)
    expect(w.store.get('allTime')).toEqual({ asked: 2, shown: 1, skipped: 1 })
  })

  test('ask quizzes the last changed turn now; on, ask and every run only for the person', async ($, on) => {
    const w = world(on)
    await start($)
    await quizCmd($, 'ask')
    expect(w.toasts.at(-1)).toBe('pop-quiz: no turn has changed a file yet this session.')
    await turn($, w, [write()])
    expect(w.calls).toEqual([])
    await quizCmd($, 'ask', { kind: 'plugin', name: 'other' })
    expect(w.calls).toEqual([])
    expect(w.toasts.at(-1)).toBe('pop-quiz: /pop-quiz ask runs only when you type it yourself.')
    await quizCmd($, 'ask')
    await w.clock.advance(1)
    expect(w.calls).toHaveLength(1)
    expect(w.calls[0]!.prompt).toContain('--- src/new.ts (written whole)')
  })

  test('every cost the person reads says about', async ($, on) => {
    const w = world(on)
    await start($)
    await quizCmd($, 'on')
    await quizCmd($, 'score')
    for (const toast of w.toasts.filter(t => t.includes('$'))) expect(toast).toMatch(/about \$|About \$/)
  })
})

describe('the logic alone', () => {
  test('changes from Edit, MultiEdit, Write and NotebookEdit; anything else is none', () => {
    expect(changeOf('Edit', { file_path: '/a', old_string: 'x', new_string: 'y' })).toEqual({ path: '/a', kind: 'edit', before: 'x', after: 'y' })
    expect(changeOf('MultiEdit', { file_path: '/a', edits: [{ old_string: 'x', new_string: 'y' }] })?.after).toBe('y')
    expect(changeOf('Write', { file_path: '/a', content: 'z' })).toEqual({ path: '/a', kind: 'write', after: 'z' })
    expect(changeOf('NotebookEdit', { notebook_path: '/n.ipynb', new_source: 'print(1)' })?.kind).toBe('notebook')
    expect(changeOf('Read', { file_path: '/a' })).toBeNull()
    expect(changeOf('Bash', { command: 'rm -rf x' })).toBeNull()
  })

  test('many changed files: each keeps a share, and the whole diff stays within its cap', () => {
    const changes = Array.from({ length: 30 }, (_, i) => ({ path: `${ROOT}/f${i}.ts`, kind: 'write' as const, after: 'y'.repeat(1_000) }))
    const s = summarize(changes, ROOT)
    expect(s.diff.length).toBeLessThanOrEqual(MAX_DIFF)
    expect(s.diff).toContain('--- f0.ts')
    expect(s.files).toHaveLength(30)
  })

  test('every kind of secret file is sent by name only; look-alikes are sent', () => {
    const secret = [
      '.env', '.env.local', '/app/.env.production', 'server.pem', 'tls.key', 'cert.p12', 'cert.pfx', 'release.jks', 'app.keystore', 'putty.ppk', 'signing.asc', 'backup.gpg',
      'id_rsa', 'id_ed25519.pub', 'id_ecdsa', 'credentials', 'credentials.yml.enc', '/home/me/.npmrc', '.netrc', '.pgpass', '.pypirc',
      '.git-credentials', '.htpasswd', 'prod.tfvars', 'prod.tfvars.json', 'secrets.yaml', 'secret.json',
    ]
    for (const name of secret) expect(isSecretFile(name), name).toBe(true)
    for (const name of ['env.ts', 'src/environment.ts', 'keyboard.ts', 'monkey.ts', 'README.md', 'main.tf', 'npmrc.md', 'id.ts']) expect(isSecretFile(name), name).toBe(false)
  })

  test('the pace setting is clamped from 1 to 20', () => {
    expect([0, 1, 3, 7.4, 20, 99, Number.NaN, '5'].map(every => readSettings({ every }).every)).toEqual([1, 1, 3, 7, 20, 20, 3, 3])
    expect(readSettings({}).enabled).toBe(false)
    expect(readSettings({ enabled: true }).enabled).toBe(true)
  })

  test('the summary lists each file once, relative to the project', () => {
    const s = summarize([{ path: `${ROOT}/a.ts`, kind: 'write', after: '1' }, { path: `${ROOT}/a.ts`, kind: 'write', after: '2' }, { path: '/elsewhere/b.ts', kind: 'write', after: '3' }], ROOT)
    expect(s.files).toEqual(['a.ts', '/elsewhere/b.ts'])
  })

  test('a reply must be whole: two questions with answers, then END', () => {
    expect(parseReply(TWO)).toHaveLength(2)
    expect(parseReply(TWO.replace('\nEND', ''))).toBeNull()
    expect(parseReply(reply([{ q: 'one', a: 'a' }]))).toBeNull()
    expect(parseReply('not json\nEND')).toBeNull()
    expect(sanitize('x'.repeat(300), 160)).toHaveLength(160)
  })

  test('a quiz turn is every n-th; cost at list prices', () => {
    expect([1, 2, 3, 4, 5, 6].filter(n => isQuizTurn(n, 3))).toEqual([3, 6])
    expect(isQuizTurn(1, 1)).toBe(true)
    expect(Math.abs(costOf({ input_tokens: 1_000_000, output_tokens: 1_000_000 }) - 0.6)).toBeLessThan(1e-9)
  })
})
