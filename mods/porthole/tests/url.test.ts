// Table-driven tests for the pure URL rules: what porthole will open and what it detects.

import { describe, expect, test } from 'claude-code/testing'

import { checkTypedUrl, displayUrl, findLocalAddresses, isLocalAddress, parseArgs } from '../hooks/url'

describe('checkTypedUrl', () => {
  const allowed: Array<[string, string]> = [
    ['http://localhost:5173', 'http://localhost:5173/'],
    ['http://127.0.0.1:8000/admin?x=1', 'http://127.0.0.1:8000/admin?x=1'],
    ['https://example.com', 'https://example.com/'], // a full URL the person typed
    ['HTTP://Example.com/Path', 'http://example.com/Path'],
    ['3000', 'http://localhost:3000/'],
    ['localhost:5173', 'http://localhost:5173/'],
    ['localhost:5173/app', 'http://localhost:5173/app'],
    ['127.0.0.1:4321', 'http://127.0.0.1:4321/'],
    ['  http://localhost:3000  ', 'http://localhost:3000/'],
  ]
  for (const [input, url] of allowed) {
    test(`opens ${JSON.stringify(input)}`, () => {
      expect(checkTypedUrl(input)).toEqual({ ok: true, url })
    })
  }

  const refused: Array<[string, RegExp]> = [
    ['file:///etc/passwd', /only opens http and https/],
    ['javascript:alert(1)', /only opens http and https/],
    ['data:text/html,<h1>x</h1>', /only opens http and https/],
    ['chrome://settings', /only opens http and https/],
    ['about:blank', /only opens http and https/],
    ['view-source:http://localhost:3000', /only opens http and https/],
    ['ftp://localhost:21', /only opens http and https/],
    ['example.com', /not a full URL/], // another host needs the full URL
    ['evil.localhost.example.com:80', /not a full URL/],
    ['--remote-debugging-port=9222', /not a full URL/], // can never reach Chrome as a switch
    ['', /No address/],
    ['http://', /not a valid URL/],
  ]
  for (const [input, reason] of refused) {
    test(`refuses ${JSON.stringify(input)}`, () => {
      const verdict = checkTypedUrl(input)
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) expect(verdict.reason).toMatch(reason)
    })
  }
})

describe('isLocalAddress', () => {
  const cases: Array<[string, boolean]> = [
    ['http://localhost:5173/', true],
    ['https://127.0.0.1:8443/x', true],
    ['http://localhost/', false], // no port
    ['http://0.0.0.0:3000/', false],
    ['http://192.168.1.4:5173/', false],
    ['http://localhost.evil.com:3000/', false],
    ['http://localhost:3000@evil.com/', false], // the host is evil.com
    ['http://user:pw@localhost:3000/', false], // credentials
    ['ws://localhost:24678/', false],
    ['file://localhost/etc/passwd', false],
    ['not a url', false],
  ]
  for (const [href, expected] of cases) {
    test(`${href} -> ${expected}`, () => {
      expect(isLocalAddress(href)).toBe(expected)
    })
  }
})

describe('findLocalAddresses', () => {
  const cases: Array<[string, string, string[]]> = [
    [
      'Vite with ANSI bold port',
      '  VITE v5.4.0  ready in 312 ms\n\n  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m\n  ➜  Network: use --host to expose',
      ['http://localhost:5173/'],
    ],
    ['Next.js', '   ▲ Next.js 15.0.0\n   - Local:        http://localhost:3000\n   - Network:      http://192.168.1.4:3000', ['http://localhost:3000/']],
    ['Django, trailing period', 'Starting development server at http://127.0.0.1:8000/.', ['http://127.0.0.1:8000/']],
    ['deep path reduced to the origin', 'GET http://localhost:5173/src/main.tsx 500', ['http://localhost:5173/']],
    ['two servers, each once', 'http://localhost:3000 http://localhost:3000/api http://127.0.0.1:6006', ['http://localhost:3000/', 'http://127.0.0.1:6006/']],
    ['in parentheses', 'ready (http://localhost:4321)', ['http://localhost:4321/']],
    ['OSC 8 hyperlink', '\u001b]8;;http://localhost:8080/\u0007http://localhost:8080/\u001b]8;;\u0007', ['http://localhost:8080/']],
    ['database URLs are not dev servers', 'postgres://me@localhost:5432/db redis://localhost:6379', []],
    ['no port, no match', 'see http://localhost/ for docs', []],
    ['network address only', 'Network: http://192.168.1.4:5173/', []],
    ['nothing', 'npm ERR! missing script: dev', []],
  ]
  for (const [name, output, expected] of cases) {
    test(name, () => {
      expect(findLocalAddresses(output)).toEqual(expected)
    })
  }
})

describe('parseArgs', () => {
  const cases: Array<[string, ReturnType<typeof parseArgs>]> = [
    ['', {}],
    ['   ', {}],
    ['mobile', { mode: 'mobile' }],
    ['Desktop', { mode: 'desktop' }],
    ['http://localhost:3000', { target: 'http://localhost:3000' }],
    ['http://localhost:3000 mobile', { mode: 'mobile', target: 'http://localhost:3000' }],
    ['mobile 5173', { mode: 'mobile', target: '5173' }],
    ['mobile desktop', { error: 'Pick one of mobile or desktop.' }],
    ['a b', { error: 'Give one address at a time: /porthole <url> [mobile|desktop].' }],
  ]
  for (const [args, expected] of cases) {
    test(JSON.stringify(args), () => {
      expect(parseArgs(args)).toEqual(expected)
    })
  }
})

test('displayUrl drops the scheme and a lone slash', () => {
  expect(displayUrl('http://localhost:5173/')).toBe('localhost:5173')
  expect(displayUrl('https://example.com/a/b?q=1')).toBe('example.com/a/b?q=1')
})
