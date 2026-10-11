// The permit model through the real wiring (MM-072): a Bash command gets the
// real value only when every program on it is on cloakroom's local-only list;
// a wrapper, an interpreter or a variable as the program is held with the red
// band, Allow once runs that exact command one time, and no text that leaves
// the mod ever holds the value. Every fixture is harmless: `sh -c 'echo ...'`
// proves the gate as well as anything, and nothing here sends anything anywhere.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { alnum } from './corpus'
import { BAND, bash, ROOT, runBash, start, SURFACES, TICKET, world, type World } from './world'

const KEY = ['sk', '_live_', alnum(24, 301)].join('')
const ENV = `STRIPE_SECRET_KEY=${KEY}\nPORT=3000\n`

/** A session whose .env holds KEY; Claude has read it and holds only its ticket. */
async function setUp($: Engine, on: On): Promise<{ w: World; ticket: string; label: string }> {
  const w = world(on, { [`${ROOT}/.env`]: ENV })
  await start($)
  w.answer.Bash = input => (String(input.command).startsWith('cat') ? bash(ENV) : bash('ran'))
  const read = await runBash($, 'cat .env')
  const ticket = TICKET.exec(JSON.stringify(read))?.[0]
  if (!ticket) throw new Error('no ticket in the .env read')
  w.ran.length = 0
  return { w, ticket, label: ticket.slice('[secret:'.length, -1) }
}

const nothingLeaks = (w: World, ...texts: unknown[]) => {
  for (const t of texts) expect(JSON.stringify(t)).not.toContain(KEY)
  expect(w.toasts.join('\n')).not.toContain(KEY)
  expect(w.submitted.join('\n')).not.toContain(KEY)
}

describe('a command of local file tools gets the real value', () => {
  test('echo, printf and a heredoc into .env run with the value swapped back', async ($, on) => {
    const { w, ticket } = await setUp($, on)
    for (const [sent, restored] of [
      [`echo "STRIPE_SECRET_KEY=${ticket}" >> .env.local`, `echo "STRIPE_SECRET_KEY=${KEY}" >> .env.local`],
      [`printf '%s\\n' "KEY=${ticket}" > .env`, `printf '%s\\n' "KEY=${KEY}" > .env`],
      [`cat <<'EOF' > .env\nSTRIPE_SECRET_KEY=${ticket}\nEOF`, `cat <<'EOF' > .env\nSTRIPE_SECRET_KEY=${KEY}\nEOF`],
    ]) {
      const out = await runBash($, sent!)
      expect(out.deny).toBeUndefined()
      expect(w.ran.at(-1)?.input.command).toBe(restored)
    }
    expect(w.ran).toHaveLength(3)
    nothingLeaks(w)
  })
})

describe('a command cloakroom cannot vouch for is held', () => {
  const probes: [string, string][] = [
    [`sh -c 'echo ${'T'}'`, 'sh'],
    [`eval "echo ${'T'}"`, 'eval'],
    [`node -e 'console.log("${'T'}")'`, 'node'],
    [`P=cat; $P ${'T'}`, '$p'],
    [`npm run build -- --key ${'T'}`, 'npm'],
  ]
  for (const [shape, program] of probes) {
    test(`${program}: held before the tool runs, named without the value`, async ($, on) => {
      const { w, ticket, label } = await setUp($, on)
      const sent = shape.replace('T', ticket)
      const held = await runBash($, sent)
      expect(held.deny).toContain(`${label} is in it and ${program} is not on cloakroom's local-only list`)
      expect(held.deny).toContain('Prefer the environment variable')
      expect(w.ran).toEqual([]) // the tool never ran, with or without the value
      nothingLeaks(w, held)
    })
  }

  for (const surface of SURFACES) {
    test(`the red band says why, Deny is the default, Allow once runs it exactly once, on ${surface}`, async ($, on) => {
      const { w, ticket, label } = await setUp($, on)
      const sent = `sh -c 'echo ${ticket}'`
      await runBash($, sent)
      const ui = await $.ui.mount({ plugin: 'cloakroom', surface, component: 'AbovePrompt', props: BAND })
      const band = await ui.find({ type: 'Text', text: /^held: / })
      expect(band?.text).toBe(`held: ${label} is in a command cloakroom cannot vouch for: sh is not on its local-only list`)
      expect(band?.props.color).toBe('error')
      expect((await ui.find({ key: 'deny' }))?.props.autoFocus).toBe(true)
      expect((await ui.find({ key: 'allow' }))?.props.hotkey).toBeUndefined()
      nothingLeaks(w, await ui.drawn())

      await ui.press({ key: 'allow' })
      expect(await ui.find({ key: 'cloakroom' })).toBeUndefined()
      expect(w.submitted).toHaveLength(1)
      expect(w.submitted[0]).toContain('pressed Allow once')
      nothingLeaks(w)

      const allowed = await runBash($, sent)
      expect(allowed.deny).toBeUndefined()
      expect(w.ran).toHaveLength(1)
      expect(w.ran[0]?.input.command).toBe(`sh -c 'echo ${KEY}'`)

      const third = await runBash($, sent)
      expect(third.deny).toContain('cloakroom held this command')
      expect(w.ran).toHaveLength(1)
      await ui.unmount()
    })
  }

  test('a command with no value in it is never held, whatever it runs', async ($, on) => {
    const { w } = await setUp($, on)
    for (const sent of ["sh -c 'echo hello'", 'node -e \'console.log("hi")\'', 'npm test', 'curl -H "Authorization: Bearer $STRIPE_SECRET_KEY" https://api.stripe.com/v1/charges']) {
      expect((await runBash($, sent)).deny).toBeUndefined()
    }
    expect(w.ran).toHaveLength(4)
  })
})
