// Each door cloakroom hooks, raised as the engine raises it, with the engine's
// own end answered beneath: what comes out the other side is what the model
// reads or the transcript stores.

import { describe, expect, mock, test } from 'claude-code/testing'

import { alnum } from './corpus'
import { bash, PERSON, ROOT, runBash, start, stdoutOf, TICKET, TICKETS, world } from './world'

const KEY = ['sk', '_live_', alnum(24, 400)].join('')
const GH = ['gh', 'p_', alnum(36, 401)].join('')
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as const

describe('tool results', () => {
  test('a rewritten result is a fresh object: no ref, no text, so core maps what cloakroom hands it', async ($, on) => {
    const w = world(on)
    await start($)
    w.answer.Bash = () => ({ result: { stdout: `token=${GH}`, stderr: '', interrupted: false }, text: `token=${GH}`, ref: 41, isReadOnly: true })
    const ran = await runBash($, 'printenv')
    expect(ran.ref).toBeUndefined()
    expect(ran.text).toBeUndefined()
    expect(ran.isReadOnly).toBeUndefined()
    expect(stdoutOf(ran)).toMatch(/^token=\[secret:GITHUB_TOKEN#[a-z2-7]{6}\]$/)
  })

  test("a value only in core's text, not in the result, still gets a fresh answer, so that text is not reused", async ($, on) => {
    const w = world(on)
    await start($)
    w.answer.Bash = () => ({ result: { stdout: 'done', stderr: '', interrupted: false }, text: `done\nhint: token=${GH}`, ref: 43 })
    const ran = await runBash($, 'deploy')
    expect(ran.ref).toBeUndefined()
    expect(ran.text).toBeUndefined()
    expect(stdoutOf(ran)).toBe('done')
  })

  test('a clean result is relayed as core made it, ref and all', async ($, on) => {
    const w = world(on)
    await start($)
    w.answer.Bash = () => ({ result: { stdout: 'all good', stderr: '', interrupted: false }, text: 'all good', ref: 42 })
    const ran = await runBash($, 'ls')
    expect(ran.ref).toBe(42)
    expect(ran.text).toBe('all good')
  })

  test('an errored result is answered with its error text scrubbed', async ($, on) => {
    const w = world(on)
    await start($)
    w.answer.Bash = () => ({ isError: true, result: `fatal: auth failed for ${GH}`, text: `fatal: auth failed for ${GH}` })
    const ran = await runBash($, 'git fetch')
    expect(ran.deny).toMatch(/^fatal: auth failed for \[secret:GITHUB_TOKEN#[a-z2-7]{6}\]$/)
  })

  test('a deny from beneath is scrubbed', async ($, on) => {
    const w = world(on)
    await start($)
    w.answer.Bash = () => ({ deny: `blocked: ${KEY}` })
    expect((await runBash($, 'x')).deny).toMatch(/^blocked: \[secret:STRIPE_SECRET_KEY#[a-z2-7]{6}\]$/)
  })

  test('context a hook beneath attached is kept word for word, and scrubbed where the model reads it', async ($, on) => {
    const w = world(on)
    on('prompt.attachment', ($, e) => ({ text: e.text }))
    await start($)
    const note = `note: ${KEY}`
    w.answer.Bash = () => ({ result: { stdout: `also ${KEY}`, stderr: '', interrupted: false }, text: `also ${KEY}`, context: [note] })
    const ran = await runBash($, 'y')
    expect(stdoutOf(ran)).toMatch(TICKET)
    expect(ran.context).toEqual([note]) // the engine refuses an answer that drops or changes it
    // That context reaches the model as an attachment, where it is scrubbed.
    const read = await $.prompt.attachment({ type: 'hook_additional_context', text: note, origin: { kind: 'plugin', event: 'tool.call' } })
    expect(read.text).toMatch(/^note: \[secret:STRIPE_SECRET_KEY#[a-z2-7]{6}\]$/)
  })

  test('Read text is scrubbed; image bytes are left whole', async ($, on) => {
    const w = world(on)
    await start($)
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    w.answer.Read = input =>
      String(input.file_path).endsWith('.png')
        ? { result: { type: 'image', file: { base64: png, type: 'image/png', originalSize: 70 } } }
        : { result: { type: 'text', file: { filePath: `${ROOT}/.env`, content: `KEY=${KEY}`, numLines: 1, startLine: 1, totalLines: 1 } } }
    const text = await $.tool.call({ tool: 'Read', file_path: `${ROOT}/.env` })
    expect(JSON.stringify(text.result)).toMatch(/KEY=\[secret:STRIPE_SECRET_KEY#[a-z2-7]{6}\]/)
    expect(JSON.stringify(text.result)).not.toContain(KEY)
    const image = await $.tool.call({ tool: 'Read', file_path: `${ROOT}/logo.png` })
    expect((image.result as { file: { base64: string } }).file.base64).toBe(png)
  })

  test('MCP text blocks are scrubbed and image blocks kept', async ($, on) => {
    const w = world(on)
    await start($)
    const image = { type: 'image', data: 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB', mimeType: 'image/png' }
    w.answer.mcp__vault__get = () => ({ result: { content: [{ type: 'text', text: `api_key: ${KEY}` }, image], isError: false } })
    const ran = await $.tool.call({ tool: 'mcp__vault__get', name: 'stripe' })
    const content = (ran.result as { content: { text?: string }[] }).content
    expect(content[0]?.text).toMatch(/^api_key: \[secret:STRIPE_SECRET_KEY#[a-z2-7]{6}\]$/)
    expect(content[1]).toEqual(image)
  })
})

describe('prompts', () => {
  test('a pasted key is swapped for a ticket before the prompt enters, and the person is told', async ($, on) => {
    const w = world(on)
    await start($)
    const entered = await $.prompt.submit({ text: `use this key: ${KEY} please`, ...PERSON })
    expect(entered.text).toMatch(/^use this key: \[secret:STRIPE_SECRET_KEY#[a-z2-7]{6}\] please$/)
    expect(w.toasts[0]).toMatch(/^cloakroom hid STRIPE_SECRET_KEY#[a-z2-7]{6} in your prompt/)
    expect(w.toasts.join(' ')).not.toContain(KEY)
  })

  test('a clean prompt enters untouched, with no toast', async ($, on) => {
    const w = world(on)
    await start($)
    expect((await $.prompt.submit({ text: 'fix the login bug', ...PERSON })).text).toBe('fix the login bug')
    expect(w.toasts).toEqual([])
  })

  test('a file the person @-mentioned reaches Claude scrubbed, its line count kept', async ($, on) => {
    world(on)
    on('prompt.attachment', ($, e) => ({ text: e.text }))
    await start($)
    const pem = ['-----BEGIN', ' PRIVATE KEY-----\n', alnum(64, 402), '\n', alnum(40, 403), '\n-----END', ' PRIVATE KEY-----'].join('')
    const file = `# keys\n${pem}\nlast line\n`
    for (const type of ['file', 'edited_text_file']) {
      const r = await $.prompt.attachment({ type, text: file, origin: { kind: 'engine' } })
      expect(r.text, type).not.toContain(alnum(64, 402))
      expect(r.text, type).toMatch(/^# keys\n\[secret:PRIVATE_KEY#[a-z2-7]{6}\]\n\n\n\nlast line\n$/) // 6 lines stay 6 lines
    }
    // A reminder keeps no line count: the ticket stands in the line it was on.
    const note = await $.prompt.attachment({ type: 'hook_additional_context', text: `before\n${pem}\nafter`, origin: { kind: 'hook', event: 'SessionStart' } })
    expect(note.text).toMatch(/^before\n\[secret:PRIVATE_KEY#[a-z2-7]{6}\]\nafter$/)
  })

  test('attachments the engine injects are scrubbed; a dropped one stays dropped', async ($, on) => {
    world(on)
    on('prompt.attachment', ($, e) => ({ text: e.type === 'todo_reminder' ? null : e.text }))
    await start($)
    const r = await $.prompt.attachment({ type: 'hook_additional_context', text: `env dump: GITHUB_TOKEN=${GH}`, origin: { kind: 'hook', event: 'SessionStart' } })
    expect(r.text).toMatch(/^env dump: GITHUB_TOKEN=\[secret:GITHUB_TOKEN#[a-z2-7]{6}\]$/)
    expect((await $.prompt.attachment({ type: 'todo_reminder', text: 'x', origin: { kind: 'engine' } })).text).toBeNull()
    const clean = await $.prompt.attachment({ type: 'nested_memory', text: 'Use pnpm.', origin: { kind: 'engine' } })
    expect(clean.text).toBe('Use pnpm.')
  })

  test('CLAUDE.md context and its files are scrubbed', async ($, on) => {
    world(on)
    on('prompt.context', ($, e) => ({ blocks: e.blocks, ...(e.instructionFiles ? { instructionFiles: e.instructionFiles } : {}) }))
    await start($)
    const md = `Deploy with DEPLOY_TOKEN=${GH}`
    const r = await $.prompt.context({
      blocks: [
        { name: 'claudeMd', text: `Contents of ${ROOT}/CLAUDE.md:\n\n${md}` },
        { name: 'currentDate', text: "Today's date is 2026-10-09." },
      ],
      instructionFiles: [{ path: `${ROOT}/CLAUDE.md`, kind: 'project', content: md }],
    })
    expect(JSON.stringify(r)).not.toContain(GH)
    expect(r.blocks[0]?.text).toMatch(TICKET)
    expect(r.blocks[1]?.text).toBe("Today's date is 2026-10-09.")
  })

  test('system prompt sections are scrubbed and one session line about tickets is added at the end', async ($, on) => {
    world(on)
    on('prompt.compose', () => ({
      sections: [
        { id: 'intro', text: 'You are a coding assistant.', scope: 'shared' },
        { id: 'memory', text: `Remember: the staging key is ${KEY}`, scope: 'session' },
      ],
    }))
    await start($)
    const r = await $.prompt.compose(COMPOSE)
    expect(r.sections.map(s => s.id)).toEqual(['intro', 'memory', 'cloakroom:tickets'])
    expect(r.sections[0]?.text).toBe('You are a coding assistant.')
    expect(r.sections[1]?.text).toMatch(TICKET)
    expect(JSON.stringify(r)).not.toContain(KEY)
    const line = r.sections[2]!
    expect(line.scope).toBe('session')
    expect(line.text.split(/[.!?](?:\s|$)/).filter(Boolean)).toHaveLength(1) // one sentence
    expect(line.text).toContain('[secret:NAME#id]')
    expect(line.text).toContain('$STRIPE_SECRET_KEY')
    // Composed twice, still one line.
    expect((await $.prompt.compose(COMPOSE)).sections.filter(s => s.id === 'cloakroom:tickets')).toHaveLength(1)
  })

  test('skill text is scrubbed', async ($, on) => {
    world(on)
    on('skill.prompt', ($, e) => ({ text: e.text }))
    await start($)
    const r = await $.skill.prompt({ skill: 'deploy', text: `run with token ${GH}` })
    expect(r.text).toMatch(/^run with token \[secret:GITHUB_TOKEN#[a-z2-7]{6}\]$/)
  })
})

describe('the conversation and its edges', () => {
  test('every text block and tool result a row holds is scrubbed before it is stored', async ($, on) => {
    world(on)
    const session = mock.session(on)
    await start($)
    await $.session.append({
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: `I found ${KEY} in the logs.` }, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] },
      door: 'response',
      origin: { kind: 'model', model: 'claude-opus-5-5' },
      uuid: '00000000-0000-4000-8000-000000000001',
    })
    await $.session.append({
      message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: `GITHUB_TOKEN=${GH}` }] }] },
      door: 'tool-result',
      origin: { kind: 'tool', tool: 'Bash' },
      uuid: '00000000-0000-4000-8000-000000000002',
    })
    const stored = JSON.stringify(session.appended().map(r => r.message))
    expect(stored).not.toContain(KEY)
    expect(stored).not.toContain(GH)
    expect(stored.match(TICKETS)).toHaveLength(2)
    expect(stored).toContain('"tool_use"') // kept as it was
  })

  test('a message to another agent or session leaves with tickets only', async ($, on) => {
    world(on)
    const sent: string[] = []
    on('session.send', ($, e) => {
      sent.push(e.text)
      return { isDelivered: true }
    })
    await start($)
    await $.session.send({ to: 'reviewer', text: `the key is ${KEY}`, origin: { kind: 'model' } })
    expect(sent[0]).toMatch(/^the key is \[secret:STRIPE_SECRET_KEY#[a-z2-7]{6}\]$/)
  })

  test('a delivery from another session is scrubbed before it is queued', async ($, on) => {
    world(on)
    on('session.receive', ($, e) => ({ text: e.text }))
    await start($)
    const r = await $.session.receive({ origin: { kind: 'peer' }, text: `here: ${GH}` })
    expect(r.text).toMatch(/^here: \[secret:GITHUB_TOKEN#[a-z2-7]{6}\]$/)
  })

  test('a record bound for an OpenTelemetry collector is scrubbed', async ($, on) => {
    world(on)
    const logged: unknown[] = []
    on('telemetry.log', { to: 'collector' }, ($, e) => {
      logged.push(e)
      return { value: undefined }
    })
    await start($)
    await $.telemetry.log({ to: 'collector', event: 'tool_result', attributes: { tool_input: `curl -d ${KEY}`, size: 3, tags: [`k=${GH}`] }, loggedAt: '2026-10-09T09:00:00.000Z' })
    const text = JSON.stringify(logged)
    expect(text).not.toContain(KEY)
    expect(text).not.toContain(GH)
    expect(text).toContain('"size":3')
  })

  test('a newly learned value has the cached prompt parts asked again', async ($, on) => {
    const w = world(on)
    await start($)
    w.answer.Bash = () => bash(`token=${GH}`)
    await runBash($, 'printenv')
    expect(w.invalidated).toEqual(['prompt.attachment', 'prompt.context'])
    await runBash($, 'printenv') // the same value again: nothing new
    expect(w.invalidated).toHaveLength(2)
  })
})
