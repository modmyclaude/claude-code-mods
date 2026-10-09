// Session start: the project's .env files teach cloakroom their secret-named
// values, so a password echoed back later, in any common spelling, is hidden
// though no pattern would catch it. And nothing of it is kept on disk.

import { describe, expect, test } from 'claude-code/testing'

import { alnum } from './corpus'
import { bash, cloakroom, ROOT, runBash, start, stdoutOf, TICKET, TICKETS, world } from './world'

/** A made-up password: long and varied enough to learn (see isLearnable). */
const PW = 'fake-Kq7xW2pLm9'
const KEY = ['sk', '_live_', alnum(24, 900)].join('')

describe('seeding from .env files', () => {
  test('reads .env, .env.local and a subfolder app, secret names only', async ($, on) => {
    const w = world(on, {
      [`${ROOT}/.env`]: `DB_PASSWORD=${PW}\nPORT=3000\nNODE_ENV=production\n`,
      [`${ROOT}/.env.local`]: `export STRIPE_SECRET_KEY="${KEY}"\n`,
      [`${ROOT}/apps/web/.env`]: 'SESSION_SECRET=w3b-s3ss10n-value\n',
      [`${ROOT}/node_modules/pkg/.env`]: 'NPM_SECRET=never-read-this\n',
      [`${ROOT}/.env.example`]: 'STRIPE_SECRET_KEY=your-stripe-key-here\n',
    })
    await start($)
    const list = await cloakroom($)
    expect(list).toMatch(/DB_PASSWORD#[a-z2-7]{6}: From a \.env file, from \.env;/)
    expect(list).toMatch(/STRIPE_SECRET_KEY#[a-z2-7]{6}: From a \.env file, from \.env\.local;/)
    expect(list).toMatch(/SESSION_SECRET#[a-z2-7]{6}: From a \.env file, from apps\/web\/\.env;/)
    expect(list).toMatch(/3 tickets/) // not PORT or NODE_ENV, not the example's placeholder
    expect(w.reads).not.toContain(`${ROOT}/node_modules/pkg/.env`)
  })

  test('tolerates a project with no .env file, and one it cannot read', async ($, on) => {
    const w = world(on, { [`${ROOT}/.env`]: `DB_PASSWORD=${PW}\n`, [`${ROOT}/src/index.ts`]: '' })
    w.unreadable.add(`${ROOT}/.env`)
    await start($)
    expect(await cloakroom($)).toMatch(/no tickets yet/)
  })

  test('a seeded password is hidden in every spelling a tool hands back', async ($, on) => {
    const w = world(on, { [`${ROOT}/.env`]: `DB_PASSWORD=${PW}\nPORT=3000\n` })
    await start($)
    const spellings = [
      `DB_PASSWORD=${PW}\nPORT=3000`, // printenv
      `{"password":"${PW}"}`,
      `connecting with ${PW}...`,
      `encoded: ${btoa(PW)}`, // echo -n ... | base64
      `?pw=${encodeURIComponent(PW)}`,
    ]
    for (const output of spellings) {
      w.answer.Bash = () => bash(output)
      const seen = stdoutOf(await runBash($, 'printenv'))
      expect(seen.includes(PW), output).toBe(false)
      expect(seen.includes(btoa(PW)), output).toBe(false)
      expect(seen, output).toMatch(TICKET)
    }
    w.answer.Bash = () => bash('PORT=3000')
    expect(stdoutOf(await runBash($, 'printenv PORT'))).toBe('PORT=3000')
  })

  test('the same value keeps one ticket for the session', async ($, on) => {
    const w = world(on, { [`${ROOT}/.env`]: `STRIPE_SECRET_KEY=${KEY}\n` })
    await start($)
    w.answer.Bash = () => bash(`${KEY} and again ${KEY}`)
    const first = stdoutOf(await runBash($, 'a')).match(TICKETS)
    const second = stdoutOf(await runBash($, 'b')).match(TICKETS)
    expect(new Set([...(first ?? []), ...(second ?? [])]).size).toBe(1)
  })
})

describe('nothing is kept on disk', () => {
  test('no store writes and no file writes, through every door that saw values', async ($, on) => {
    const w = world(on, { [`${ROOT}/.env`]: `STRIPE_SECRET_KEY=${KEY}\nDB_PASSWORD=${PW}\n` })
    await start($)
    w.answer.Bash = () => bash(`STRIPE_SECRET_KEY=${KEY}`)
    await runBash($, 'cat .env')
    await $.prompt.submit({ text: `my password is ${PW}`, wait: false, origin: { kind: 'composer' } })
    await cloakroom($)
    expect(w.persisted).toEqual([])
    expect(w.writes).toEqual([])
  })
})
