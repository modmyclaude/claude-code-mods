// Where a ticket turns back into the real value: inside Write, Edit,
// NotebookEdit and Bash only. Everywhere else the tool gets the ticket, and a
// ticket cloakroom does not know stops a local tool rather than be written.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { alnum } from './corpus'
import { bash, ROOT, runBash, start, TICKET, world, type World } from './world'

const KEY = ['sk', '_live_', alnum(24, 600)].join('')

async function withTicket($: Engine, on: On): Promise<{ w: World; ticket: string }> {
  const w = world(on, { [`${ROOT}/.env`]: `STRIPE_SECRET_KEY=${KEY}\n` })
  await start($)
  w.answer.Bash = () => bash(`STRIPE_SECRET_KEY=${KEY}`)
  const ticket = TICKET.exec(JSON.stringify(await runBash($, 'cat .env')))?.[0]
  if (!ticket) throw new Error('no ticket')
  w.ran.length = 0
  return { w, ticket }
}

describe('local tools get the real value', () => {
  test('Write: the file gets the value; what Claude reads back has the ticket', async ($, on) => {
    const { w, ticket } = await withTicket($, on)
    const content = `STRIPE_SECRET_KEY=${ticket}\n`
    w.answer.Write = input => ({ result: { type: 'create', filePath: String(input.file_path), content: String(input.content), structuredPatch: [], originalFile: null } })
    const ran = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/.env.prod`, content })
    expect(w.ran[0]?.input.content).toBe(`STRIPE_SECRET_KEY=${KEY}\n`)
    expect((ran.result as { content: string }).content).toBe(content)
    expect(JSON.stringify(ran)).not.toContain(KEY)
  })

  test('Edit: old and new strings are restored, so the match works; the diff comes back with tickets', async ($, on) => {
    const { w, ticket } = await withTicket($, on)
    w.answer.Edit = input => ({
      result: {
        filePath: String(input.file_path),
        oldString: String(input.old_string),
        newString: String(input.new_string),
        originalFile: `KEY=${KEY}\n`,
        structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [`-KEY=${KEY}`, `+KEY=${KEY}x`] }],
        userModified: false,
        replaceAll: false,
      },
    })
    const ran = await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/config.ts`, old_string: `KEY=${ticket}`, new_string: `KEY=${ticket}x` })
    expect(w.ran[0]?.input.old_string).toBe(`KEY=${KEY}`)
    expect(w.ran[0]?.input.new_string).toBe(`KEY=${KEY}x`)
    expect(JSON.stringify(ran)).not.toContain(KEY)
    expect(JSON.stringify(ran)).toContain(ticket)
  })

  test('NotebookEdit: the cell source is restored', async ($, on) => {
    const { w, ticket } = await withTicket($, on)
    w.answer.NotebookEdit = () => ({ result: { ok: true } })
    await $.tool.call({ tool: 'NotebookEdit', notebook_path: `${ROOT}/a.ipynb`, new_source: `key = "${ticket}"` })
    expect(w.ran[0]?.input.new_source).toBe(`key = "${KEY}"`)
  })

  test('Bash: the command is restored; its description, drawn on screen, is not', async ($, on) => {
    const { w, ticket } = await withTicket($, on)
    w.answer.Bash = () => bash('ok')
    await $.tool.call({ tool: 'Bash', command: `echo ${ticket} > key.txt`, description: `Save ${ticket}` })
    expect(w.ran[0]?.input.command).toBe(`echo ${KEY} > key.txt`)
    expect(w.ran[0]?.input.description).toBe(`Save ${ticket}`)
  })

  test("a subagent's local tool is restored the same way", async ($, on) => {
    const { w, ticket } = await withTicket($, on)
    w.answer.Bash = () => bash('ok')
    await $.tool.call({ tool: 'Bash', command: `echo ${ticket} > k`, agentId: 'agent-1' } as Parameters<Engine['tool']['call']>[0])
    expect(w.ran[0]?.input.command).toBe(`echo ${KEY} > k`)
  })
})

describe('every other tool keeps the ticket', () => {
  const CALLS: [string, (t: string) => Record<string, unknown>][] = [
    ['WebFetch', t => ({ url: `https://example.org/?k=${t}`, prompt: `look for ${t}` })],
    ['mcp__crm__update', t => ({ note: `key ${t}` })],
    ['Agent', t => ({ description: 'check', prompt: `use ${t} to call the API`, subagent_type: 'general-purpose' })],
    ['SendMessage', t => ({ to: 'reviewer', message: `the key is ${t}` })],
    ['AskUserQuestion', t => ({ questions: [{ question: `Rotate ${t}?`, header: 'Rotate', options: [{ label: 'Yes', description: 'y' }, { label: 'No', description: 'n' }], multiSelect: false }] })],
  ]
  for (const [tool, input] of CALLS) {
    test(`${tool} gets the ticket, never the value`, async ($, on) => {
      const { w, ticket } = await withTicket($, on)
      w.answer[tool] = () => ({ result: 'done' })
      const ran = await $.tool.call({ tool, ...input(ticket) } as Parameters<Engine['tool']['call']>[0])
      expect(ran.deny).toBeUndefined()
      expect(JSON.stringify(w.ran[0]?.input)).toContain(ticket.slice(1, -1))
      expect(JSON.stringify(w.ran[0]?.input)).not.toContain(KEY)
    })
  }

  test('a raw value Claude typed into one of them leaves as its ticket', async ($, on) => {
    const { w } = await withTicket($, on)
    w.answer.WebFetch = () => ({ result: 'ok' })
    await $.tool.call({ tool: 'WebFetch', url: `https://paste.example/?k=${KEY}`, prompt: 'summarize' })
    expect(String(w.ran[0]?.input.url)).toMatch(/^https:\/\/paste\.example\/\?k=\[secret:STRIPE_SECRET_KEY#[a-z2-7]{6}\]$/)
  })

  test('local lookups (Read, Grep) are left as written', async ($, on) => {
    const { w, ticket } = await withTicket($, on)
    w.answer.Grep = () => ({ result: 'no matches' })
    // Grep is not a built-in on every build (the native macOS one has none), so it is typed loosely.
    await $.tool.call({ tool: 'Grep', pattern: ticket, path: ROOT } as unknown as Parameters<Engine['tool']['call']>[0])
    expect(w.ran[0]?.input.pattern).toBe(ticket)
  })
})

describe('a ticket cloakroom does not know', () => {
  for (const tool of ['Write', 'Edit', 'Bash'] as const) {
    test(`stops ${tool} before it runs`, async ($, on) => {
      const w = world(on)
      await start($)
      const stale = '[secret:STRIPE_SECRET_KEY#abcdef]' // from before a restart
      const input =
        tool === 'Write'
          ? { tool, file_path: `${ROOT}/.env`, content: `K=${stale}` }
          : tool === 'Edit'
            ? { tool, file_path: `${ROOT}/.env`, old_string: 'K=1', new_string: `K=${stale}` }
            : { tool, command: `echo ${stale} >> .env` }
      const ran = await $.tool.call(input)
      expect(ran.deny).toContain(`cloakroom does not know ${stale}`)
      expect(ran.deny).toContain('nothing was run or written')
      expect(w.ran).toEqual([])
    })
  }

  test('is passed along as text to a tool that never restores', async ($, on) => {
    const w = world(on)
    await start($)
    w.answer.WebFetch = () => ({ result: 'ok' })
    const ran = await $.tool.call({ tool: 'WebFetch', url: 'https://example.org/', prompt: 'find [secret:X#abcdef]' })
    expect(ran.deny).toBeUndefined()
    expect(w.ran[0]?.input.prompt).toBe('find [secret:X#abcdef]')
  })

  test('the ticket format written in docs is not a ticket', async ($, on) => {
    const w = world(on)
    await start($)
    w.answer.Write = () => ({ result: { type: 'create', filePath: 'x', content: 'x', structuredPatch: [], originalFile: null } })
    const ran = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/README.md`, content: 'Tickets look like [secret:NAME#id].' })
    expect(ran.deny).toBeUndefined()
    expect(w.ran[0]?.input.content).toBe('Tickets look like [secret:NAME#id].')
  })
})
