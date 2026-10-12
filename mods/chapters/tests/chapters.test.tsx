// chapters through the real chains: which git commands each scope runs, what
// the model is sent, the pane and its presses, the band, and the logic alone.

import { describe, expect, test } from 'claude-code/testing'

import { batches, editDiff, hunksFor, isSecretFile, newFileDiff, parseDiff } from '../hooks/diff'
import { MAX_INPUT, costWords, parseReply } from '../hooks/review'
import { shortHunk } from '../hooks/register'
import { DIFF, MB, ROOT, SURFACES, TWO, bandTexts, chapters, pane, paneTexts, reply, start, world } from './world'

describe('the diff, read-only', () => {
  test('/chapters reads uncommitted changes and new files with read-only plumbing, git optional locks off', async ($, on) => {
    const w = world(on)
    w.untracked = { 'src/new.ts': 'export const n = 1\n' }
    await start($)
    await chapters($, w)
    expect(w.gits).toEqual(['rev-parse --is-inside-work-tree', 'rev-parse --verify HEAD', 'diff-index -p --no-color -M HEAD --', 'ls-files --others --exclude-standard -z'])
    expect(w.lockingGit).toEqual([])
    expect(w.prompts[0]).toContain('diff --git a/src/new.ts b/src/new.ts')
    expect(w.prompts[0]).toContain('+export const n = 1')
  })

  test('staged and branch scopes: diff-index --cached, and merge-base then diff-tree; never git diff', async ($, on) => {
    const w = world(on)
    await start($)
    await chapters($, w, 'staged')
    await chapters($, w, 'branch develop')
    expect(w.gits).toContain('diff-index -p --no-color -M --cached HEAD --')
    expect(w.gits).toContain('merge-base develop HEAD')
    expect(w.gits).toContain(`diff-tree -p --no-color -r -M ${MB} HEAD`)
    expect(w.gits.some(g => g.startsWith('diff '))).toBe(false)
    expect(w.lockingGit).toEqual([])
  })

  test('a branch name that looks like an option is never passed to git', async ($, on) => {
    const w = world(on)
    await start($)
    await chapters($, w, 'branch --output=/tmp/x')
    expect(w.gits).toContain('merge-base main HEAD')
    expect(w.gits.some(g => g.includes('--output'))).toBe(false)
  })

  test('a repository with no commit yet is compared with the empty tree', async ($, on) => {
    const w = world(on)
    w.hasHead = false
    await start($)
    await chapters($, w)
    expect(w.gits).toContain('diff-index -p --no-color -M 4b825dc642cb6eb9a060e54bf8d69288fbee4904 --')
  })

  test('outside git, the last turn\'s own edits are reviewed', async ($, on) => {
    const w = world(on)
    w.isGit = false
    await start($)
    await $.turn.start({ turnId: 't1', prompt: 'go', origin: { kind: 'composer' } } as never)
    await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/a.ts`, old_string: 'let a = 1', new_string: 'const a = 1' } as never)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await chapters($, w)
    expect(w.prompts[0]).toContain('diff --git a/src/a.ts b/src/a.ts')
    expect(w.prompts[0]).toContain('-let a = 1\n+const a = 1')
    expect((await paneTexts($))[0]).toMatch(/^the last turn's edits · 0 of 2 read$/)
  })

  test('the hunks of an edit and of a new file draw as real diffs, their counts true', async ($, on) => {
    const w = world(on)
    w.isGit = false
    w.replies = [reply([{ title: 'Const', files: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }], what: 'let became const', risk: 'low' }])]
    await start($)
    await $.turn.start({ turnId: 't1', prompt: 'go', origin: { kind: 'composer' } } as never)
    await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/a.ts`, old_string: 'let a = 1\nlet b = 2', new_string: 'const a = 1' } as never)
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/b.ts`, content: 'export const b = 2\nexport const c = 3\n' } as never)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await chapters($, w, 'last')
    const ui = await pane($, 'desktop')
    const code = await ui.findAll({ type: 'Code' })
    expect(code.map(c => [c.props.path, c.props.format])).toEqual([['src/a.ts', 'diff'], ['src/b.ts', 'diff']])
  })
})

describe('secrets never reach the model', () => {
  test('an untracked secrets file is never read, and goes by its name alone; other new files go whole', async ($, on) => {
    const w = world(on)
    const token = ['np', 'm_', 'Q'.repeat(36)].join('')
    w.untracked = { '.env.local': 'API_TOKEN=abc123', '.npmrc': `//registry/:_authToken=${token}`, 'src/new.ts': 'export const n = 1\n' }
    await start($)
    await chapters($, w)
    const prompt = w.prompts[0]!
    expect(prompt).toContain('diff --git a/.env.local b/.env.local\n(a secrets file changed: its contents are not sent)')
    expect(prompt).toContain('diff --git a/.npmrc b/.npmrc\n(a secrets file changed: its contents are not sent)')
    expect(prompt).not.toContain('abc123')
    expect(prompt).not.toContain(token)
    expect(w.reads).toEqual(['src/new.ts'])
  })

  test('a tracked secrets file in a staged or branch diff is named, its lines neither sent nor drawn', async ($, on) => {
    const w = world(on)
    w.diff = `${DIFF}\ndiff --git a/config/prod.tfvars b/config/prod.tfvars\n@@ -1 +1 @@\n-db_password = "old"\n+db_password = "new-secret-value"`
    w.replies = [reply([{ title: 'Config', files: [{ path: 'config/prod.tfvars' }], what: 'the prod values changed', risk: 'high' }])]
    await start($)
    await chapters($, w, 'staged')
    expect(w.prompts[0]).toContain('diff --git a/config/prod.tfvars b/config/prod.tfvars\n(a secrets file changed: its contents are not sent)')
    expect(w.prompts[0]).not.toContain('new-secret-value')
    const ui = await pane($)
    expect(await ui.findAll({ type: 'Code' })).toEqual([])
  })

  test('every kind of secrets file is known by its name; look-alikes are not', () => {
    const secret = [
      '.env', '.env.local', 'app/.env.production', 'server.pem', 'tls.key', 'cert.p12', 'cert.pfx', 'release.jks', 'app.keystore', 'putty.ppk', 'signing.asc',
      'backup.gpg', 'id_rsa', 'id_ed25519.pub', 'id_ecdsa', 'credentials', 'credentials.yml.enc', '.npmrc', '.netrc', '.pgpass', '.pypirc', '.git-credentials',
      '.htpasswd', 'prod.tfvars', 'prod.tfvars.json', 'secrets.yaml', 'secret.json',
    ]
    for (const name of secret) expect(isSecretFile(name), name).toBe(true)
    for (const name of ['env.ts', 'src/environment.ts', 'keyboard.ts', 'monkey.ts', 'README.md', 'main.tf', 'npmrc.md', 'id.ts']) expect(isSecretFile(name), name).toBe(false)
  })

  test('anything that looks like a secret in an ordinary file is redacted before it is sent', async ($, on) => {
    const w = world(on)
    const key = ['sk', '_live_', 'A1b2'.repeat(6)].join('')
    w.diff = `${DIFF}\ndiff --git a/src/pay.ts b/src/pay.ts\n@@ -1 +1 @@\n-const k = ''\n+const STRIPE_KEY = "${key}"`
    await start($)
    await chapters($, w, 'branch')
    expect(w.prompts[0]).not.toContain(key)
    expect(w.prompts[0]).toContain('[REDACTED]')
  })
})

describe('what the model is sent', () => {
  test('the diff and its paths only, in one call under the cap', async ($, on) => {
    const w = world(on)
    await start($)
    await chapters($, w)
    expect(w.prompts).toHaveLength(1)
    expect(w.prompts[0]).toBe(`The diff:\n${parseDiff(DIFF).map(f => [`diff --git a/${f.path} b/${f.path}`, ...f.hunks.map(h => h.text)].join('\n')).join('\n')}`)
    expect(w.models).toEqual(['haiku'])
  })

  test('a big diff goes in two calls at most, each under the cap, and what is left is said', async ($, on) => {
    const w = world(on)
    const file = (i: number) => [`diff --git a/f${i}.ts b/f${i}.ts`, '@@ -1,1 +1,400 @@', ...Array.from({ length: 400 }, (_, j) => `+line ${j} of file ${i} with some words`)].join('\n')
    w.diff = Array.from({ length: 40 }, (_, i) => file(i)).join('\n')
    await start($)
    await chapters($, w)
    expect(w.prompts).toHaveLength(2)
    for (const p of w.prompts) expect(p.length).toBeLessThanOrEqual(MAX_INPUT + 400)
    expect(w.prompts[0]).toMatch(/^This is part 1 of 2 of the diff/)
    expect(w.prompts[1]).toMatch(/more changed files were not sent \(too long\)/)
    expect((await paneTexts($)).at(-1)).toMatch(/^\d+ changed files were too long to send and are not in this review\./)
  })

  test('the model you set writes the review', { options: { model: 'sonnet' } }, async ($, on) => {
    const w = world(on)
    await start($)
    await chapters($, w)
    expect(w.models).toEqual(['sonnet'])
  })

  test('a reply that does not read is asked again once, then the pane says no review this time', async ($, on) => {
    const w = world(on)
    w.replies = ['not json\nEND', 'fail']
    await start($)
    await chapters($, w)
    expect(w.prompts).toHaveLength(2)
    expect(await paneTexts($)).toEqual(['no review this time: the model did not answer in the shape asked for'])
  })

  test('a new review runs only when the person types it; another plugin is told so and nothing is sent', async ($, on) => {
    const w = world(on)
    await start($)
    expect((await chapters($, w, '', { kind: 'plugin', name: 'other' })).text).toBeUndefined()
    expect(w.prompts).toEqual([])
    expect(w.toasts.at(-1)).toBe('chapters: a new review runs only when you type /chapters yourself.')
  })
})

describe('the pane', () => {
  for (const surface of SURFACES) {
    test(`the chapters in order with risk marks, the open one with its hunks, and the buttons, on ${surface}`, async ($, on) => {
      const w = world(on)
      await start($)
      await chapters($, w)
      expect(w.opened).toEqual(['chapters'])
      const ui = await pane($, surface)
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      expect(texts.slice(0, 7)).toEqual(['uncommitted changes · 0 of 2 read', '!', '1. Retry on 429', '', '·', '2. Docs', ''])
      expect(texts).toContain('Chapter 1 of 2: Retry on 429')
      expect(texts).toContain('! high risk: it can double a write')
      expect(texts).toContain('Check: Is the write idempotent?')
      const code = await ui.findAll({ type: 'Code' })
      expect(code).toHaveLength(1)
      expect(code[0]!.props).toMatchObject({ format: 'diff', path: 'src/api.ts' })
      expect(String(code[0]!.props.source)).toMatch(/^@@ -10,2 \+10,4 @@/)
      for (const key of ['prev', 'next', 'read', 'ask']) expect(await ui.find({ key }), key).toBeDefined()
      await ui.press({ key: 'read' })
      const after = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      expect(after[0]).toBe('uncommitted changes · 1 of 2 read')
      expect(after).toContain('Chapter 2 of 2: Docs')
      await ui.press({ key: 'prev' })
      expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain('Chapter 1 of 2: Retry on 429')
      await ui.unmount()
    })
  }

  test('ask Claude fills the prompt box after any draft, and never sends', async ($, on) => {
    const w = world(on)
    await start($)
    await chapters($, w)
    w.box = 'my draft'
    const ui = await pane($)
    await ui.press({ key: 'ask' })
    expect(w.box).toBe('my draft\n\nAbout chapter 1, Retry on 429: Is the write idempotent?')
    expect(w.submits).toEqual([])
    expect(w.toasts.at(-1)).toBe('chapters: the question is in your prompt box. Send it when you want.')
  })

  test('every cost the person reads says about', async ($, on) => {
    const w = world(on)
    await start($)
    await chapters($, w)
    const note = (await paneTexts($)).at(-1)!
    expect(note).toMatch(/about \$0\.\d{4} per review of 500 changed lines at small-model list prices/)
    expect(costWords()).toMatch(/^about /)
  })
})

describe('the band', () => {
  test('while a review waits unread and its pane is not on screen; gone when every chapter is read', async ($, on) => {
    const w = world(on)
    await start($)
    await chapters($, w)
    expect(await bandTexts($)).toEqual(['chapters: 2 chapters, 1 risky, 2 unread · /chapters to read'])
    w.isPaneShown = true
    expect(await bandTexts($)).toEqual([])
    w.isPaneShown = false
    const ui = await pane($)
    await ui.press({ key: 'read' })
    await ui.press({ key: 'read' })
    await ui.unmount()
    expect(await bandTexts($)).toEqual([])
  })
})

describe('the logic alone', () => {
  test('a diff reads into files and hunks; binary files by name; controls cleaned', () => {
    const files = parseDiff(`${DIFF}\ndiff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\ndiff --git a/x.ts b/x.ts\n@@ -1 +1 @@\n-a\x1b[31m\n+b\x07`)
    expect(files.map(f => [f.path, f.hunks.length, f.isBinary])).toEqual([['src/api.ts', 1, false], ['README.md', 1, false], ['logo.png', 0, true], ['x.ts', 1, false]])
    expect(files[3]!.hunks[0]!.text).toBe('@@ -1 +1 @@\n-a\n+b�')
  })

  test('hunks for a chapter: those touching its lines, else the file\'s', () => {
    const files = parseDiff([DIFF, '@@ -40,2 +42,3 @@', ' x', '+y', ' z'].join('\n'))
    expect(hunksFor(files, 'README.md', [42, 44]).map(h => h.newStart)).toEqual([42])
    expect(hunksFor(files, 'README.md', [1, 1]).map(h => h.newStart)).toEqual([1])
    expect(hunksFor(files, 'README.md', [100, 120]).map(h => h.newStart)).toEqual([1, 42]) // none near: the whole file
    expect(hunksFor(files, 'nowhere.ts')).toEqual([])
  })

  test('a long hunk is cut by lines with a header that stays true', () => {
    const h = parseDiff(['diff --git a/a b/a', '@@ -5,200 +5,200 @@', ...Array.from({ length: 200 }, (_, i) => (i % 2 ? `+n${i}` : `-o${i}`))].join('\n'))[0]!.hunks[0]!
    const cut = shortHunk(h, 10).split('\n')
    expect(cut[0]).toBe('@@ -5,5 +5,5 @@')
    expect(cut).toHaveLength(11)
  })

  test('two batches at most; a file bigger than a batch is cut and marked', () => {
    const f = (path: string, n: number) => ({ path, hunks: [{ header: '@@', newStart: 1, newLines: n, text: `@@ -0,0 +1,${n} @@\n${'+x\n'.repeat(n)}` }], isBinary: false, isSecret: false })
    const { texts, left } = batches([f('a', 10), f('b', 10), f('c', 10)], 120)
    expect(texts).toHaveLength(2)
    expect(left).toBe(1)
    expect(batches([f('big', 1000)], 500).texts[0]).toMatch(/\[\.\.\. the rest of big was cut\]$/)
  })

  test('edits and new files as diffs', () => {
    expect(editDiff('a.ts', 'x', 'y')).toBe('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-x\n+y')
    expect(newFileDiff('n.ts', 'a\nb\n')).toBe('diff --git a/n.ts b/n.ts\nnew file\n--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1,2 @@\n+a\n+b')
  })

  test('a reply is read strictly: whole, at most 12 chapters, paths without .., risk one of three', () => {
    expect(parseReply(TWO)?.map(c => c.risk)).toEqual(['high', 'none'])
    expect(parseReply(TWO.replace('\nEND', ''))).toBeNull()
    expect(parseReply(reply([{ title: 'x', what: 'y', risk: 'extreme', files: [{ path: '../etc/passwd' }, { path: 'a.ts', lines: [9, 3] }] }]))![0]).toMatchObject({ risk: 'none', files: [{ path: 'a.ts', lines: [3, 9] }] })
    expect(parseReply(reply(Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, what: 'w' }))))!).toHaveLength(12)
    expect(parseReply(reply([{ title: '', what: 'w' }]))).toBeNull()
  })
})
