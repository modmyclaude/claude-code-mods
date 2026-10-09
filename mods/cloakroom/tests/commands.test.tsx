// /cloakroom: the list, show, forget and audit, typed as the person types
// them, and refused where the run did not come from the person.

import { describe, expect, test } from 'claude-code/testing'
import type { On, PromptOrigin } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { alnum } from './corpus'
import { BAND, bash, cloakroom, HOME, ROOT, runBash, start, stdoutOf, SURFACES, TICKET, world, type World } from './world'

const KEY = ['sk', '_live_', alnum(24, 700)].join('')
const PASSWORD = 'hunter2'
const ENV = `STRIPE_SECRET_KEY=${KEY}\nDB_PASSWORD=${PASSWORD}\nPORT=3000\n`

async function setUp($: Engine, on: On, files: Record<string, string> = {}): Promise<World> {
  const w = world(on, { [`${ROOT}/.env`]: ENV, ...files })
  await start($)
  return w
}

function run($: Engine, args: string, origin: PromptOrigin) {
  return $.command.run({ command: 'cloakroom', args, origin, presentation: { isFullscreen: true, columns: 140 } })
}

/** The ticket label the vault drew for a seeded name, read off the list. */
async function labelFor($: Engine, name: string): Promise<string> {
  const m = new RegExp(`${name}#[a-z2-7]{6}`).exec(await cloakroom($))
  if (!m) throw new Error(`no ticket for ${name}`)
  return m[0]
}

describe('/cloakroom', () => {
  test("lists this session's tickets with kind, source and use, never a value", async ($, on) => {
    const w = await setUp($, on)
    w.answer.Bash = () => bash(ENV)
    await runBash($, 'cat .env')
    const text = await cloakroom($)
    expect(text).toMatch(/2 tickets this session/)
    expect(text).toMatch(/- STRIPE_SECRET_KEY#[a-z2-7]{6}: From a \.env file, from \.env; hidden 1x, restored 0x/)
    expect(text).toMatch(/- DB_PASSWORD#[a-z2-7]{6}: From a \.env file, from \.env; hidden 1x, restored 0x/)
    expect(text).not.toContain(KEY)
    expect(text).not.toContain(PASSWORD)
    expect(text).not.toContain('PORT')
  })

  test('says so when there are no tickets yet', async ($, on) => {
    world(on)
    await start($)
    expect(await cloakroom($)).toMatch(/^cloakroom: no tickets yet this session/)
  })
})

describe('/cloakroom show', () => {
  for (const surface of SURFACES) {
    test(`draws the value in the band for the person alone, never in what Claude reads, on ${surface}`, async ($, on) => {
      const w = await setUp($, on)
      const label = await labelFor($, 'STRIPE_SECRET_KEY')
      const out = await run($, `show ${label}`, { kind: 'composer' })
      expect(out.text).toContain(`showing ${label} in the band above the prompt for 30 seconds`)
      expect(JSON.stringify(out)).not.toContain(KEY) // the command's text is read by the model
      expect(w.toasts.join('\n')).not.toContain(KEY)

      const ui = await $.ui.mount({ plugin: 'cloakroom', surface, component: 'AbovePrompt', props: BAND })
      expect((await ui.find({ type: 'Text', text: KEY }))?.text).toBe(KEY)
      expect((await ui.find({ type: 'Button', key: 'hide' }))?.props.autoFocus).toBe(true)
      expect((await ui.find({ type: 'Button', key: 'hide' }))?.props.hotkey).toBeUndefined()
      await ui.press({ key: 'hide' })
      expect(await ui.find({ type: 'Text', text: KEY })).toBeUndefined()
      await ui.unmount()
    })
  }

  test('hides the value again after 30 seconds', async ($, on) => {
    const w = await setUp($, on)
    const label = await labelFor($, 'DB_PASSWORD')
    await run($, `show [secret:${label}]`, { kind: 'composer' })
    const ui = await $.ui.mount({ plugin: 'cloakroom', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: PASSWORD })).toBeDefined()
    await w.clock.advance(31_000)
    expect(await ui.find({ type: 'Text', text: PASSWORD })).toBeUndefined()
  })

  test('accepts typing from the desktop app (sdk) and Remote Control (bridge)', async ($, on) => {
    await setUp($, on)
    const label = await labelFor($, 'DB_PASSWORD')
    for (const kind of ['sdk', 'bridge'] as const) {
      expect((await run($, `show ${label}`, { kind })).text).toContain('showing')
    }
  })

  const OTHERS: PromptOrigin[] = [
    { kind: 'plugin', name: 'helper' },
    { kind: 'peer' },
    { kind: 'channel', server: 'slack' },
    { kind: 'task-notification' },
    { kind: 'scheduled-trigger' },
    { kind: 'unclassified' },
  ]
  for (const origin of OTHERS) {
    test(`is refused when run by ${origin.kind}, and reveals nothing`, async ($, on) => {
      await setUp($, on)
      const label = await labelFor($, 'STRIPE_SECRET_KEY')
      const out = await run($, `show ${label}`, origin)
      expect(out.text).toBe(`cloakroom: /cloakroom show runs only when you type it yourself; this run came from ${origin.kind}.`)
      const ui = await $.ui.mount({ plugin: 'cloakroom', surface: 'terminal', component: 'AbovePrompt', props: BAND })
      expect(JSON.stringify(await ui.drawn().catch(() => null))).not.toContain(KEY)
      expect(await ui.find({ key: 'cloakroom' })).toBeUndefined()
    })
  }

  test('says so for an unknown ticket, and where no band can be drawn', async ($, on) => {
    const w = await setUp($, on)
    expect((await run($, 'show NOPE#abcdef', { kind: 'composer' })).text).toMatch(/no ticket NOPE#abcdef/)
    w.surfaces = ['mobile']
    const label = await labelFor($, 'DB_PASSWORD')
    expect((await run($, `show ${label}`, { kind: 'composer' })).text).toMatch(/only the terminal and the desktop app/)
  })
})

describe('/cloakroom forget', () => {
  test('stops hiding a value and its ticket stops working in tools', async ($, on) => {
    const w = await setUp($, on)
    const label = await labelFor($, 'DB_PASSWORD')
    expect((await run($, `forget ${label}`, { kind: 'composer' })).text).toContain(`forgot ${label}`)
    w.answer.Bash = () => bash(`password is ${PASSWORD}`)
    expect(stdoutOf(await runBash($, 'echo'))).toBe(`password is ${PASSWORD}`)
    const ran = await runBash($, `echo [secret:${label}]`)
    expect(ran.deny).toContain('cloakroom does not know')
  })

  test('is refused for anyone but the person, so no one else can lower the guard', async ($, on) => {
    const w = await setUp($, on)
    const label = await labelFor($, 'DB_PASSWORD')
    const out = await run($, `forget ${label}`, { kind: 'plugin', name: 'helper' })
    expect(out.text).toContain('runs only when you type it yourself')
    w.answer.Bash = () => bash(`password is ${PASSWORD}`)
    expect(stdoutOf(await runBash($, 'echo'))).toMatch(TICKET)
  })
})

describe('/cloakroom audit', () => {
  const PROJECTS = `${HOME}/.claude/projects`
  const row = (timestamp: string, text: string) => JSON.stringify({ type: 'user', timestamp, message: { role: 'user', content: text } })
  const GH = ['gh', 'p_', alnum(36, 701)].join('')

  function transcripts(): Record<string, string> {
    return {
      [`${PROJECTS}/-work-app/2026-09-12_a.jsonl`]: [row('2026-09-12T10:00:00.000Z', `my key ${GH}`), row('2026-09-12T10:01:00.000Z', 'thanks')].join('\n'),
      [`${PROJECTS}/-work-app/2026-10-01_b.jsonl`]: row('2026-10-01T08:00:00.000Z', `again ${GH} and DB_PASSWORD=${PASSWORD}`),
      [`${PROJECTS}/-work-app/2026-10-01_b/subagents/agent-1.jsonl`]: row('2026-10-02T08:00:00.000Z', `the stripe key ${KEY}`),
      [`${PROJECTS}/-other/2026-08-01_c.jsonl`]: row('2026-08-01T08:00:00.000Z', 'nothing secret here'),
    }
  }

  test('lists exposed secrets by kind and date with masked previews, and writes nothing', async ($, on) => {
    const w = await setUp($, on, transcripts())
    const text = (await run($, 'audit', { kind: 'composer' })).text ?? ''
    expect(text).toContain('cloakroom audit (read-only): 4 of 4 transcripts in ~/.claude/projects checked')
    expect(text).toContain(`- GitHub token: ghp_...${GH.slice(-3)} (GITHUB_TOKEN) - 2 transcripts, 2026-09-12 to 2026-10-01`)
    expect(text).toContain(`- From a .env file: sk_live_...${KEY.slice(-3)} (STRIPE_SECRET_KEY) - 1 transcript, 2026-10-02`)
    expect(text).toContain('- From a .env file: (7 chars) (DB_PASSWORD) - 1 transcript, 2026-10-01')
    for (const secret of [GH, KEY, PASSWORD]) expect(text).not.toContain(secret)
    expect(w.writes).toEqual([])
    // Values found in old transcripts are reported, not learned.
    expect(await cloakroom($)).not.toMatch(/GITHUB_TOKEN#/)
  })

  test('counts transcripts too big to read, and reads none of them', async ($, on) => {
    const big = `${PROJECTS}/-work-app/2026-10-05_big.jsonl`
    const w = await setUp($, on, { ...transcripts(), [big]: 'x'.repeat(4 * 1024 * 1024 + 1) })
    const text = (await run($, 'audit', { kind: 'composer' })).text ?? ''
    expect(text).toContain('Not checked: 1 over 4 MiB')
    expect(w.reads).not.toContain(big)
  })

  test('says so when there are no transcripts', async ($, on) => {
    await setUp($, on)
    expect((await run($, 'audit', { kind: 'composer' })).text).toBe('cloakroom audit: no transcripts found in ~/.claude/projects.')
  })

  test('is refused for anyone but the person, and reads nothing', async ($, on) => {
    const w = await setUp($, on, transcripts())
    const reads = w.reads.length
    const out = await run($, 'audit', { kind: 'peer' })
    expect(out.text).toContain('runs only when you type it yourself')
    expect(w.reads.length).toBe(reads)
  })
})
