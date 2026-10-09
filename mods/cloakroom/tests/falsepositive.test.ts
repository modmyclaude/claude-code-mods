// MM-074: everyday output that is not a secret stays as it was. A path next to
// a `pwd`-ish name is not a password, and a value too short, too common or too
// plain is hidden only where a detector finds it, never learned and masked in
// unrelated text (the project path in a build log, `postgres` in an image name).
// The data is the review's false-positive battery (_internal/reviews/cloakroom.md).

import { describe, expect, test } from 'claude-code/testing'

import { classifyName, isLearnable, namedValueLooksSecret } from '../hooks/detect'
import { Vault } from '../hooks/vault'
import { alnum } from './corpus'
import { bash, cloakroom, HOME, ROOT, runBash, start, stdoutOf, TICKET, world } from './world'

/** Made-up values, long and varied enough to learn. */
const PW = 'fake-Kq7xW2pLm9'
const KEY = ['sk', '_test_', alnum(24, 740)].join('')

/**
 * Made-up base64 secrets that start with `/`, as 1 in 64 random ones do, each
 * under a secret name: [.env name, the line a tool prints, the value].
 */
const SLASHED: [string, string, string][] = [
  ['AWS_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY=', `/FAKEaws${alnum(24, 750)}+${alnum(8, 751)}`],
  // Short segments between slashes, so only its secret name says it is no path.
  ['aws_secret_access_key', 'aws_secret_access_key = ', `/fakeAws/${alnum(12, 752)}/${alnum(12, 753)}/${alnum(6, 759)}`],
  ['password', '{"password": "', `/FAKEpw${alnum(21, 754)}/${alnum(10, 755)}=`],
  ['JWT_SECRET', 'JWT_SECRET=', `/Xk9FAKE${alnum(28, 756)}=`],
  ['GITHUB_TOKEN', 'export GITHUB_TOKEN=', `/fake+${alnum(30, 757)}/${alnum(4, 758)}`],
]

describe('a path next to a password-like name is not a secret', () => {
  const NAMED: [string, string, boolean][] = [
    ['PWD', `${ROOT}`, false],
    ['OLDPWD', HOME, false],
    ['PASSWORD_STORE_DIR', `${HOME}/.password-store`, false],
    ['PASSWORD_STORE_DIR', '~/.password-store', false],
    ['DB_PASSWORD_FILE', './secrets/db.txt', false],
    ['DB_PASSWORD_FILE', 'secrets/db.txt', false],
    ['GOOGLE_APPLICATION_CREDENTIALS', 'C:\\keys\\sa.json', false],
    // Still a password when it is not a path.
    ['DB_PWD', 'Hk7-fake-pw9', true],
    ['PGPASSWORD', 's3cr3t!x', true],
  ]
  for (const [name, value, expected] of NAMED) {
    test(`${name}=${value} is ${expected ? '' : 'not '}a secret`, () => {
      expect(namedValueLooksSecret(classifyName(name), value, false, name)).toBe(expected)
    })
  }
})

describe('a secret that starts with a slash is still a secret', () => {
  for (const [name, , value] of SLASHED) {
    test(`${name}=${value.slice(0, 12)}... is a secret and learned`, () => {
      expect(namedValueLooksSecret(classifyName(name), value, false, name)).toBe(true)
      expect(isLearnable(value, name)).toBe(true)
    })
  }

  test('seeded from .env and hidden later in unrelated text', async ($, on) => {
    const w = world(on, { [`${ROOT}/.env`]: SLASHED.map(([name, , value]) => `${name}=${value}`).join('\n') + '\n' })
    await start($)
    expect(await cloakroom($)).toMatch(/5 tickets/)
    for (const [, , value] of SLASHED) {
      w.answer.Bash = () => bash(`retrying with ${value} in 5s`)
      const seen = stdoutOf(await runBash($, 'tail app.log'))
      expect(seen.includes(value)).toBe(false)
      expect(seen).toMatch(TICKET)
    }
  })

  test('hidden next to its name in a tool call, then learned', async ($, on) => {
    const w = world(on)
    await start($)
    for (const [, line, value] of SLASHED) {
      w.answer.Bash = () => bash(`${line}${value}${line.endsWith('"') ? '"}' : ''}`)
      const seen = stdoutOf(await runBash($, 'cat config'))
      expect(seen.includes(value)).toBe(false)
      expect(seen).toMatch(TICKET)
      w.answer.Bash = () => bash(`auth failed for ${value}`)
      expect(stdoutOf(await runBash($, 'tail auth.log')).includes(value)).toBe(false)
    }
  })
})

describe('which values are learned', () => {
  const VALUES: [string, boolean][] = [
    [PW, true],
    [KEY, true],
    ['73920184', true], // eight distinct characters: exactly the 3.0-bit floor
    ['/Users/dev/myapp', false],
    ['~/.password-store', false],
    ['../shared/config.json', false],
    ['postgres', false],
    ['Postgres123!', false],
    ['localhost', false],
    ['changeme', false],
    ['supersecret', false],
    ['password1', false],
    ['12345678', false],
    ['hunter2', false], // under 8 characters
    ['aabbccdd', false], // 2.0 bits per character
  ]
  for (const [value, expected] of VALUES) {
    test(`${value.slice(0, 24)} is ${expected ? '' : 'not '}learnable`, () => expect(isLearnable(value)).toBe(expected))
  }

  test('the vault never matches an unlearnable value elsewhere, even once it holds a ticket for it', () => {
    const vault = new Vault()
    vault.ticketFor('/Users/dev/myapp', 'PWD', 'Password', 'Bash output')
    vault.seed('postgres', 'POSTGRES_PASSWORD', '.env')
    const text = '/Users/dev/myapp/src/index.ts\n3f2a9c1d   postgres:16   app-postgres-1'
    expect(vault.scrub(text, 'test')).toEqual({ text, changed: false, entries: [] })
    expect(vault.takeGrown()).toBe(false)
  })

  test('a learnable value is matched everywhere, as before', () => {
    const vault = new Vault()
    const entry = vault.ticketFor(PW, 'DB_PASSWORD', 'Password', 'Bash output')
    expect(vault.takeGrown()).toBe(true)
    expect(vault.scrub(`connecting with ${PW}...`, 'test').text).toBe(`connecting with ${entry.ticket}...`)
  })
})

describe('through a real tool call', () => {
  test('`env` output with PWD and PASSWORD_STORE_DIR passes unchanged, and the project path is not learned', async ($, on) => {
    const w = world(on, { [`${ROOT}/.env`]: `STRIPE_SECRET_KEY=${KEY}\nPORT=3000\n` })
    await start($)
    const env = [
      `PWD=${ROOT}`,
      `OLDPWD=${HOME}`,
      `PASSWORD_STORE_DIR=${HOME}/.password-store`,
      `HOME=${HOME}`,
      'SHELL=/bin/zsh',
      'PORT=3000',
    ].join('\n')
    w.answer.Bash = () => bash(env)
    expect(stdoutOf(await runBash($, 'env'))).toBe(env)

    const lint = `${ROOT}/src/index.ts\n  3:7  error  'x' is assigned a value but never used\n\n${HOME}/.password-store is clean`
    w.answer.Bash = () => bash(lint)
    expect(stdoutOf(await runBash($, 'npx eslint .'))).toBe(lint)
    expect(await cloakroom($)).not.toMatch(/PWD#|PASSWORD_STORE_DIR#/)
  })

  test('POSTGRES_PASSWORD=postgres is not learned, and unrelated text naming postgres passes unchanged', async ($, on) => {
    const w = world(on, { [`${ROOT}/.env`]: 'POSTGRES_PASSWORD=postgres\nJWT_SECRET=supersecret\nPORT=5432\n' })
    await start($)
    expect(await cloakroom($)).toMatch(/no tickets yet/)
    const outputs = [
      'CONTAINER ID   IMAGE         NAMES\n3f2a9c1d   postgres:16   app-postgres-1',
      '"dependencies": { "postgres": "^3.4.4", "pg": "^8.11.3" }',
      '==> Fetching postgresql@16\nsupersecret-docs: up to date',
    ]
    for (const output of outputs) {
      w.answer.Bash = () => bash(output)
      expect(stdoutOf(await runBash($, 'docker ps'))).toBe(output)
    }
  })

  test('a short password is still hidden where its name marks it, and only there', async ($, on) => {
    const w = world(on)
    await start($)
    w.answer.Bash = () => bash('DB_PASSWORD=hunter22')
    const seen = stdoutOf(await runBash($, 'cat config'))
    expect(seen).toMatch(/^DB_PASSWORD=\[secret:DB_PASSWORD#[a-z2-7]{6}\]$/)
    w.answer.Bash = () => bash('user hunter22 logged in')
    expect(stdoutOf(await runBash($, 'last'))).toBe('user hunter22 logged in')
  })

  test('a real high-entropy value is still learned and hidden in unrelated text', async ($, on) => {
    const w = world(on, { [`${ROOT}/.env`]: `DB_PASSWORD=${PW}\n` })
    await start($)
    w.answer.Bash = () => bash(`docker logs db: auth ok with ${PW} for app`)
    const seeded = stdoutOf(await runBash($, 'docker logs db'))
    expect(seeded.includes(PW)).toBe(false)
    expect(seeded).toMatch(TICKET)

    // One a detector found in output is learned the same way.
    const token = alnum(32, 741)
    w.answer.Bash = () => bash(`API_SECRET=${token}`)
    expect(stdoutOf(await runBash($, 'cat deploy.env')).includes(token)).toBe(false)
    w.answer.Bash = () => bash(`retrying with ${token} in 5s`)
    const later = stdoutOf(await runBash($, 'tail deploy.log'))
    expect(later.includes(token)).toBe(false)
    expect(later).toMatch(TICKET)
  })
})
