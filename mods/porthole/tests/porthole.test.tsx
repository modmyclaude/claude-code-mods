// Behaviour tests through the real wiring: the /porthole command, Bash and Edit tool
// calls, the pane on each surface. Everything beneath the plugin (processes, files,
// clock, env, the surface) is answered here, so the argv Chrome gets is asserted exactly.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, Plugin } from 'claude-code/testing'
import type { On, PromptOrigin, RenderSurface } from 'claude-code'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TMP = '/tmp/pt'
const PANE = { title: 'Porthole', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 41 }, view: {} } as const
const VIEWPORT = { columns: 200, rows: 50, isFullscreen: true }

type World = {
  clock: MockClock
  runs: string[][]
  spawns: string[][]
  toasts: string[]
  /** Toasts the command raised for its own success lines. */
  notes: string[]
  opened: string[]
  blits: number
  files: Set<string>
  surfaces: RenderSurface[]
  isOpen: boolean
  blitDeny: string | undefined
  chrome: 'writes' | 'exits-silently' | 'fails' | 'lingers'
  stderrLine: string
  pulledPastWritten: boolean
  mktempOut: string | undefined
  toastThrows: boolean
  openDenied: boolean
  registered: unknown[]
}

/** Answers every noun porthole calls, as a terminal session on a Mac with Chrome would. */
function world(on: On, chromePath: string | null = CHROME): World {
  const w: World = {
    clock: mock.clock(on),
    runs: [],
    spawns: [],
    toasts: [],
    notes: [],
    opened: [],
    blits: 0,
    files: new Set(chromePath === null ? [] : [chromePath]),
    surfaces: ['terminal'],
    isOpen: false,
    blitDeny: undefined,
    chrome: 'writes',
    pulledPastWritten: false,
    stderrLine: '[1:2:1008/1.2:ERROR:ozone.cc:1] Missing X server or $DISPLAY',
    mktempOut: undefined,
    toastThrows: false,
    openDenied: false,
    registered: [],
  }
  mock.env(on, { TMPDIR: `${TMP}/`, PATH: '/usr/bin:/bin' })
  let made = 0
  on('process.run', ($, e) => {
    w.runs.push([...e.argv])
    let stdout = ''
    if (e.argv[0] === 'mktemp') {
      made += 1
      stdout = w.mktempOut ?? `${String(e.argv[2]).replace('XXXXXX', `run00${made}`)}\n`
    }
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* ($, e) {
    w.spawns.push([...e.argv])
    const screenshot = e.argv.find(arg => arg.startsWith('--screenshot='))?.slice('--screenshot='.length) ?? ''
    if (w.chrome === 'fails') {
      yield { stream: 'stderr' as const, text: `${w.stderrLine}\n` }
      return { value: { code: 1, signal: null } }
    }
    w.files.add(screenshot)
    if (w.chrome !== 'exits-silently') yield { stream: 'stderr' as const, text: `22337 bytes written to file ${screenshot}\n` }
    // Real Chrome 154 stays alive after its screenshot: porthole must stop reading here.
    if (w.chrome === 'lingers') w.pulledPastWritten = true
    return { value: { code: 0, signal: null } }
  })
  on('fs.exists', ($, e) => ({ value: w.files.has(e.path) }))
  on('session.surfaces', () => ({ value: w.surfaces }))
  on('ui.open', ($, e) => {
    if (w.openDenied) return { deny: 'no pane for you' }
    w.opened.push(e.id)
    w.isOpen = true
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', () => {
    w.isOpen = false
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: w.isOpen ? [{ id: 'porthole', title: 'Porthole', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('ui.toast', ($, e) => {
    if (w.toastThrows) throw new Error('toast broke')
    if (/^(Porthole: |Viewport set to )/.test(e.text)) w.notes.push(e.text)
    else w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.blit', () => {
    w.blits += 1
    return { value: w.blitDeny === undefined ? {} : { deny: w.blitDeny } }
  })
  on('ui.log', () => ({ value: undefined }))
  on('command.register', ($, e) => {
    w.registered.push({ ...e })
    return { value: { command: e.name } }
  })
  return w
}

const run = ($: Engine, args: string, command = 'porthole', origin: PromptOrigin = { kind: 'composer' }) =>
  $.command.run({ command, args, origin, presentation: { isFullscreen: true, columns: 200 } })

/** Runs /porthole expecting success: no text for the model, one toast for the person. */
async function shown($: Engine, w: World, args: string, origin: PromptOrigin = { kind: 'composer' }): Promise<string | undefined> {
  const before = w.notes.length
  const answer = await run($, args, 'porthole', origin)
  expect(answer.text, `answer to "${args}"`).toBeUndefined()
  expect(w.notes.length).toBe(before + 1)
  return w.notes.at(-1)
}

/** Lets the background capture (started by the command, not awaited by it) finish. */
async function settled(w: World): Promise<void> {
  for (let i = 0; i < 12; i += 1) await w.clock.settle()
}

/** Mounts the pane on a surface and reads one keyed element's text. */
async function paneText($: Engine, key: string, surface: 'terminal' | 'desktop' = 'terminal'): Promise<string | undefined> {
  const ui = await $.ui.mount({ plugin: 'porthole', surface, component: 'Pane', requestId: 'porthole', props: PANE, viewport: VIEWPORT })
  const text = (await ui.find({ key }))?.text
  await ui.unmount()
  return text
}

function argvFor(n: number, size: string, url: string): string[] {
  const dir = `${TMP}/porthole.run00${n}`
  return [
    CHROME,
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--use-mock-keychain',
    '--force-device-scale-factor=1',
    '--timeout=15000',
    `--user-data-dir=${dir}/profile`,
    `--window-size=${size}`,
    `--screenshot=${dir}/shot.png`,
    url,
  ]
}

const editCall = { tool: 'Edit' as const, file_path: '/app/src/App.tsx', old_string: 'a', new_string: 'b' }
const editResult = {
  result: {
    filePath: '/app/src/App.tsx',
    oldString: 'a',
    newString: 'b',
    originalFile: 'a',
    structuredPatch: [],
    userModified: false,
    replaceAll: false,
  },
  text: 'The file was updated.',
}

test('the command is registered at session start, runnable mid-turn (immediate)', async ($, on) => {
  const w = world(on)
  on('session.start', ($2, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/app', surface: 'terminal', isInteractive: true })
  expect(w.registered).toEqual([
    {
      name: 'porthole',
      description: 'Preview a local web page in a side pane (headless Chrome screenshot)',
      argumentHint: '[url] [mobile|desktop]',
      immediate: true,
    },
  ])
})

test('/porthole <url> shoots with headless Chrome, a fresh profile and the desktop viewport', async ($, on) => {
  const w = world(on)
  expect(await shown($, w, 'http://localhost:5173')).toBe('Porthole: http://localhost:5173/ at 1280 px (desktop).')
  expect(w.opened).toEqual(['porthole'])
  await settled(w)

  expect(w.spawns).toEqual([argvFor(1, '1280,800', 'http://localhost:5173/')])
  expect(w.runs).toEqual([
    ['mktemp', '-d', `${TMP}/porthole.XXXXXX`],
    ['rm', '-rf', `${TMP}/porthole.run001/profile`], // the throwaway profile goes at once
  ])
  expect(await paneText($, 'status')).toBe('localhost:5173 - desktop 1280px - shot 1')

  // A second shot gets its own profile, and the first run folder is deleted.
  await run($, 'mobile')
  await settled(w)
  expect(w.spawns[1]).toEqual(argvFor(2, '390,844', 'http://localhost:5173/'))
  expect(w.runs).toContainEqual(['rm', '-rf', `${TMP}/porthole.run002/profile`])
  expect(w.runs).toContainEqual(['rm', '-rf', `${TMP}/porthole.run001`])
})

test('/porthole mobile and /porthole desktop switch the viewport width', async ($, on) => {
  const w = world(on)
  expect(await shown($, w, 'mobile')).toBe('Viewport set to mobile (390 px wide). Open a page with /porthole <url>.')
  expect(w.spawns).toEqual([])
  expect(await shown($, w, '127.0.0.1:8000')).toBe('Porthole: http://127.0.0.1:8000/ at 390 px (mobile).')
  await settled(w)
  expect(w.spawns[0]?.find(arg => arg.startsWith('--window-size='))).toBe('--window-size=390,844')
  expect(await shown($, w, 'desktop')).toBe('Porthole: http://127.0.0.1:8000/ at 1280 px (desktop).')
  await settled(w)
  expect(w.spawns[1]?.find(arg => arg.startsWith('--window-size='))).toBe('--window-size=1280,800')
})

test('only http(s) pages open; shorthands only ever mean localhost', async ($, on) => {
  const w = world(on)
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings', 'example.com', 'evil.com:3000']) {
    const answer = await run($, bad)
    expect(answer.text ?? '').toMatch(/only opens http and https|not a full URL/)
  }
  expect(w.spawns).toEqual([])
  expect(w.runs).toEqual([])
  expect(w.opened).toEqual([])

  // A full URL the person typed is theirs to open.
  await run($, 'https://example.com/docs')
  await settled(w)
  expect(w.spawns[0]?.at(-1)).toBe('https://example.com/docs')
})

test('when opening the pane fails, the command says so and Chrome never runs', async ($, on) => {
  const w = world(on)
  w.openDenied = true
  const answer = await run($, 'http://localhost:5173')
  expect(answer.text ?? '').toMatch(/^porthole: .*no pane for you/)
  await settled(w)
  expect(w.spawns).toEqual([])
})

test('no toast for the address the pane is already showing', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: 'http://localhost:5173/', stderr: '', interrupted: false },
    text: '  Local: http://localhost:5173/',
  }))
  await run($, 'http://localhost:5173/about')
  await settled(w)
  await $.tool.call({ tool: 'Bash', command: 'npm run dev' })
  expect(w.toasts).toEqual([])
})

test('bare /porthole with nothing seen says how to start', async ($, on) => {
  const w = world(on)
  expect((await run($, '')).text).toMatch(/^No dev server address seen yet/)
  expect(w.opened).toEqual([])
})

test('Bash output naming a local server toasts "Open in porthole" once per address', async ($, on) => {
  const w = world(on)
  let output = ''
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: output, stderr: '', interrupted: false },
    text: output,
  }))
  output = '  VITE v5.4.0  ready\n  \u001b[32m➜\u001b[39m  Local:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m\n'
  const ran = await $.tool.call({ tool: 'Bash', command: 'npm run dev' })
  expect(ran.text).toBe(output) // the call itself is untouched
  expect(w.toasts).toEqual(['Open in porthole: http://localhost:5173/ - type /porthole'])

  await $.tool.call({ tool: 'Bash', command: 'npm run dev' })
  expect(w.toasts).toHaveLength(1)

  output = 'Network: http://192.168.1.4:5173/\npostgres://me@localhost:5432/db\n'
  await $.tool.call({ tool: 'Bash', command: 'cat log' })
  expect(w.toasts).toHaveLength(1)

  output = '- Local: http://localhost:3000\n'
  await $.tool.call({ tool: 'Bash', command: 'npx next dev' })
  expect(w.toasts).toEqual([
    'Open in porthole: http://localhost:5173/ - type /porthole',
    'Open in porthole: http://localhost:3000/ - type /porthole',
  ])

  // Bare /porthole now opens the last address seen.
  expect(await shown($, w, '')).toBe('Porthole: http://localhost:3000/ at 1280 px (desktop).')
  await settled(w)
  expect(w.spawns[0]?.at(-1)).toBe('http://localhost:3000/')
})

test('no toast on a surface that cannot show porthole', async ($, on) => {
  const w = world(on)
  w.surfaces = ['desktop']
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: 'http://localhost:5173/', stderr: '', interrupted: false },
    text: 'http://localhost:5173/',
  }))
  await $.tool.call({ tool: 'Bash', command: 'npm run dev' })
  expect(w.toasts).toEqual([])
})

test('a failure inside detection never changes the Bash result', async ($, on) => {
  const w = world(on)
  w.toastThrows = true
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: 'http://localhost:5173/', stderr: '', interrupted: false },
    text: 'http://localhost:5173/',
  }))
  const ran = await $.tool.call({ tool: 'Bash', command: 'npm run dev' })
  expect(ran.deny).toBeUndefined()
  expect(ran.isError).toBeUndefined()
  expect(ran.text).toBe('http://localhost:5173/')
})

test('edits refresh the open pane at most once every 2 seconds', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Edit' }, () => editResult)
  await run($, 'http://localhost:5173')
  await settled(w)
  expect(w.spawns).toHaveLength(1)

  const start = w.clock.now()
  await $.tool.call(editCall)
  await w.clock.advance(500)
  await $.tool.call(editCall)
  await w.clock.advance(1000)
  await $.tool.call(editCall) // three edits inside one window
  await w.clock.set(start + 1999)
  expect(w.spawns).toHaveLength(1)
  await w.clock.set(start + 2000)
  await settled(w)
  expect(w.spawns).toHaveLength(2) // one refresh for all three

  const second = w.clock.now()
  await $.tool.call(editCall)
  await w.clock.set(second + 1999)
  expect(w.spawns).toHaveLength(2)
  await w.clock.set(second + 2000)
  await settled(w)
  expect(w.spawns).toHaveLength(3)
})

/** Another plugin standing in for the person's close mark: it closes porthole's pane. */
const CLOSER: Plugin = {
  name: 'closer',
  register(on) {
    on('command.run', { command: 'close-porthole' }, async $ => {
      await $.ui.close({ id: 'porthole' })
      return { text: 'closed' }
    })
  },
}

test('closing the pane deletes the picture and stops edit refreshes', { plugins: [CLOSER] }, async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Edit' }, () => editResult)
  await run($, 'http://localhost:5173')
  await settled(w)
  await run($, '', 'close-porthole')
  expect(w.runs).toContainEqual(['rm', '-rf', `${TMP}/porthole.run001`])
  expect(await paneText($, 'shot')).toBeUndefined()

  await $.tool.call(editCall)
  await w.clock.advance(5000)
  await settled(w)
  expect(w.spawns).toHaveLength(1)
})

test('edits do nothing while no pane is open', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Edit' }, () => editResult)
  await run($, 'http://localhost:5173')
  await settled(w)
  w.isOpen = false // the engine no longer lists the pane
  await $.tool.call(editCall)
  await w.clock.advance(5000)
  await settled(w)
  expect(w.spawns).toHaveLength(1)
})

test('the pane: an Image on the terminal, one line on the desktop', async ($, on) => {
  const w = world(on)
  w.surfaces = ['terminal', 'desktop']
  await run($, 'http://localhost:5173')
  await settled(w)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'porthole', surface, component: 'Pane', requestId: 'porthole', props: PANE, viewport: VIEWPORT })
    if (surface === 'terminal') {
      const image = await ui.find({ type: 'Image', key: 'shot' })
      expect(image?.props.source).toEqual({ file: `${TMP}/porthole.run001/shot.png`, format: 'png' })
      expect([image?.props.columns, image?.props.rows]).toEqual([80, 25]) // 1280x800 kept unstretched
      expect(String(image?.props.alt)).toMatch(/cannot draw images/)
      expect((await ui.find({ key: 'status' }))?.text).toBe('localhost:5173 - desktop 1280px - shot 1')
      expect(await ui.find({ key: 'elsewhere' })).toBeUndefined()

      // Refresh: the next shot takes the pane's shape (80 x 40 rows -> 1280 x 1280).
      await ui.press({ key: 'refresh' })
      expect(w.spawns[1]).toEqual(argvFor(2, '1280,1280', 'http://localhost:5173/'))
      expect((await ui.find({ key: 'status' }))?.text).toBe('localhost:5173 - desktop 1280px - shot 2')

      // The viewport button flips to mobile and shoots again.
      expect((await ui.find({ key: 'mode' }))?.props.label).toBe('Mobile')
      await ui.press({ key: 'mode' })
      expect(w.spawns[2]?.find(arg => arg.startsWith('--window-size='))).toBe('--window-size=390,844')
      expect((await ui.find({ key: 'mode' }))?.props.label).toBe('Desktop')
    } else {
      const line = await ui.find({ key: 'elsewhere' })
      expect(line?.text).toBe(
        'Porthole draws its preview in a terminal. In the desktop app, open http://localhost:5173/ in the built-in browser pane instead.',
      )
      expect(await ui.find({ key: 'shot' })).toBeUndefined()
      expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    }
    await ui.unmount()
  }
})

test('a desktop-only session gets the browser-pane hint and no Chrome run', async ($, on) => {
  const w = world(on)
  w.surfaces = ['desktop']
  const answer = await run($, 'http://localhost:5173')
  expect(answer.text).toMatch(/built-in browser pane/)
  await settled(w)
  expect(w.spawns).toEqual([])
  expect(w.runs).toEqual([])
})

test('a terminal that cannot draw images is told once and auto refresh pauses', async ($, on) => {
  const w = world(on)
  w.blitDeny = 'the Image draws its alt here: this terminal shows no placeholder images'
  on('tool.call', { tool: 'Edit' }, () => editResult)
  await run($, 'http://localhost:5173')
  await settled(w)
  await w.clock.advance(300) // the probe after the first picture
  expect(w.blits).toBe(1)
  expect(w.toasts).toEqual([
    "porthole: This terminal cannot draw images here. The desktop app's built-in browser pane can preview the page.",
  ])

  const ui = await $.ui.mount({ plugin: 'porthole', surface: 'terminal', component: 'Pane', requestId: 'porthole', props: PANE, viewport: VIEWPORT })
  expect((await ui.find({ key: 'no-images' }))?.text).toMatch(/cannot draw images/)

  await $.tool.call(editCall)
  await w.clock.advance(3000)
  await settled(w)
  expect(w.spawns).toHaveLength(1) // paused: nothing to look at

  await ui.press({ key: 'refresh' }) // a manual refresh still works, and is not told again
  await w.clock.advance(300)
  expect(w.spawns).toHaveLength(2)
  expect(w.toasts).toHaveLength(1)
  expect(w.blits).toBe(1)
  await ui.unmount()
})

test('a blit refused for another reason is not mistaken for "no images"', async ($, on) => {
  const w = world(on)
  w.blitDeny = 'nothing of porthole is mounted there'
  on('tool.call', { tool: 'Edit' }, () => editResult)
  await run($, 'http://localhost:5173')
  await settled(w)
  await w.clock.advance(300)
  expect(w.blits).toBe(1)
  expect(w.toasts).toEqual([])
  expect(await paneText($, 'no-images')).toBeUndefined()

  // Still unknown, so auto refresh carries on and the next picture is probed again.
  await $.tool.call(editCall)
  await w.clock.advance(2000)
  await settled(w)
  expect(w.spawns).toHaveLength(2)
  await w.clock.advance(300)
  expect(w.blits).toBe(2)
})

test('no Chrome installed: the pane says so and nothing runs', async ($, on) => {
  const w = world(on, null)
  const answer = await run($, 'http://localhost:5173')
  expect(answer.text).toBe('No Chrome or Chromium found. Install one, or set the chromePath setting in /config.')
  await settled(w)
  expect(w.opened).toEqual([])
  expect(w.spawns).toEqual([])
  expect(w.runs).toEqual([])
})

test('Chromium found on PATH when there is no macOS app', async ($, on) => {
  const w = world(on, '/usr/bin/chromium')
  await run($, 'http://localhost:5173')
  await settled(w)
  expect(w.spawns[0]?.[0]).toBe('/usr/bin/chromium')
})

test('the chromePath setting wins', { options: { chromePath: '/opt/chrome/chrome' } }, async ($, on) => {
  const w = world(on)
  w.files.add('/opt/chrome/chrome')
  await run($, 'http://localhost:5173')
  await settled(w)
  expect(w.spawns[0]?.[0]).toBe('/opt/chrome/chrome')
})

test('a chromePath that does not exist is named in the error', { options: { chromePath: '/nope/chrome' } }, async ($, on) => {
  const w = world(on)
  expect((await run($, 'http://localhost:5173')).text).toBe('Chrome was not found at "/nope/chrome" (the chromePath setting).')
  await settled(w)
  expect(w.spawns).toEqual([])
})

test('Chrome that writes nothing: the reason is shown and the run folder removed', async ($, on) => {
  const w = world(on)
  w.chrome = 'fails'
  await run($, 'http://localhost:5173')
  await settled(w)
  expect(await paneText($, 'error')).toBe('Chrome did not write a screenshot: Missing X server or $DISPLAY')
  expect(w.runs).toContainEqual(['rm', '-rf', `${TMP}/porthole.run001`])
})

test('a Chrome that exits without the "written" line still counts when the file is there', async ($, on) => {
  const w = world(on)
  w.chrome = 'exits-silently'
  await run($, 'http://localhost:5173')
  await settled(w)
  expect(await paneText($, 'status')).toBe('localhost:5173 - desktop 1280px - shot 1')
  expect(await paneText($, 'error')).toBeUndefined()
})

// MM-045: a site other than localhost opens only when the person typed the command.
const NOT_PERSON: PromptOrigin[] = [
  { kind: 'sdk' },
  { kind: 'task-notification' },
  { kind: 'scheduled-trigger' },
  { kind: 'peer' },
  { kind: 'peer-send-message' },
  { kind: 'projects-relay' },
  { kind: 'channel', server: 'slack' },
  { kind: 'coordinator' },
  { kind: 'observer' },
  { kind: 'observer-activity' },
  { kind: 'auto-continuation' },
  { kind: 'unclassified' },
  { kind: 'slack-ping' },
  { kind: 'plugin', name: 'other' },
  { kind: 'plugin', name: 'other', asUser: true },
]
const REFUSAL = 'Porthole opens a site other than localhost only when you type /porthole <url> yourself.'

test('a remote URL opens for the person typing: composer and bridge', async ($, on) => {
  const w = world(on)
  for (const origin of [{ kind: 'composer' }, { kind: 'bridge' }] as const) {
    expect(await shown($, w, `https://example.com/${origin.kind}`, origin)).toBe(`Porthole: https://example.com/${origin.kind} at 1280 px (desktop).`)
    await settled(w)
  }
  expect(w.spawns.map(argv => argv.at(-1))).toEqual(['https://example.com/composer', 'https://example.com/bridge'])
})

test('every other origin gets localhost only', async ($, on) => {
  const w = world(on)
  for (const origin of NOT_PERSON) {
    const before = w.spawns.length
    const remote = await run($, 'https://attacker.example/?q=secret', 'porthole', origin)
    expect(remote.text, origin.kind).toBe(REFUSAL)
    await settled(w)
    expect(w.spawns.length, origin.kind).toBe(before)

    // The local page still opens from the same origin.
    expect(await shown($, w, `http://localhost:${5000 + before}`, origin)).toBe(`Porthole: http://localhost:${5000 + before}/ at 1280 px (desktop).`)
    await settled(w)
    expect(w.spawns.length, origin.kind).toBe(before + 1)
  }
  expect(w.spawns.some(argv => argv.some(arg => arg.includes('attacker')))).toBe(false)
})

test('another origin cannot re-shoot a remote page the person opened', async ($, on) => {
  const w = world(on)
  await run($, 'https://example.com/')
  await settled(w)
  for (const args of ['mobile', '']) {
    expect((await run($, args, 'porthole', { kind: 'plugin', name: 'other' })).text).toBe(REFUSAL)
  }
  await settled(w)
  expect(w.spawns).toHaveLength(1)
})

test('edits do not re-shoot a remote page (a local edit cannot change it)', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Edit' }, () => editResult)
  await run($, 'https://example.com/')
  await settled(w)
  await $.tool.call(editCall)
  await w.clock.advance(5000)
  await settled(w)
  expect(w.spawns).toHaveLength(1)
})

test('Chrome that stays alive after its screenshot is stopped at the "written" line', async ($, on) => {
  const w = world(on)
  w.chrome = 'lingers'
  await run($, 'http://localhost:5173')
  await settled(w)
  expect(await paneText($, 'status')).toBe('localhost:5173 - desktop 1280px - shot 1')
  expect(w.pulledPastWritten).toBe(false)
})

test('a desktop-only session never starts Chrome, even after edits', async ($, on) => {
  const w = world(on)
  w.surfaces = ['desktop']
  on('tool.call', { tool: 'Edit' }, () => editResult)
  await run($, 'http://localhost:5173')
  await $.tool.call(editCall)
  await w.clock.advance(5000)
  await settled(w)
  expect(w.spawns).toEqual([])
})

test('a mktemp answer outside the temp root is refused, nothing runs or is removed', async ($, on) => {
  const w = world(on)
  w.mktempOut = '/Users/me/project\n'
  await run($, 'http://localhost:5173')
  await settled(w)
  expect(w.spawns).toEqual([])
  expect(w.runs.filter(argv => argv[0] === 'rm')).toEqual([])
  expect(await paneText($, 'error')).toMatch(/^Could not make a temp folder/)
})

test('session end deletes the picture', async ($, on) => {
  const w = world(on)
  on('session.end', ($2, e) => ({ sessionId: e.sessionId }))
  await run($, 'http://localhost:5173')
  await settled(w)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
  expect(w.runs).toContainEqual(['rm', '-rf', `${TMP}/porthole.run001`])
})

test('bare /porthole prefers the last dev server seen over the page in the pane', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: '', stderr: '', interrupted: false },
    text: '  Local: http://localhost:3000/',
  }))
  await run($, 'http://localhost:5173')
  await settled(w)
  await $.tool.call({ tool: 'Bash', command: 'npm run dev' })
  expect(await shown($, w, '')).toBe('Porthole: http://localhost:3000/ at 1280 px (desktop).')
})

test('failed or staged edits do not refresh', async ($, on) => {
  const w = world(on)
  let answer: 'error' | 'staged' = 'error'
  on('tool.call', { tool: 'Edit' }, () =>
    answer === 'error'
      ? { isError: true as const, result: 'String not found', text: 'String not found' }
      : { ...editResult, result: { ...editResult.result, staged: true } },
  )
  await run($, 'http://localhost:5173')
  await settled(w)
  await $.tool.call(editCall)
  await w.clock.advance(5000)
  answer = 'staged'
  await $.tool.call(editCall)
  await w.clock.advance(5000)
  await settled(w)
  expect(w.spawns).toHaveLength(1)
})

// MM-050: the engine refuses a drawn tree holding control characters, so untrusted text is cleaned.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/

test('control characters in a URL or in Chrome stderr never break the pane', async ($, on) => {
  const w = world(on)
  w.chrome = 'fails'
  w.stderrLine = '\u001b[31mfatal:\u001b[0m bad\u0085thing\u0007 here\u0000'
  const answer = await run($, 'http://localhost:5173/a\u001bb\u0085c')
  expect(CONTROL.test(answer.text ?? '')).toBe(false)
  await settled(w)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'porthole', surface, component: 'Pane', requestId: 'porthole', props: PANE, viewport: VIEWPORT })
    const drawn = JSON.stringify(await ui.drawn())
    expect(/\\u00[01][0-9a-f]|\\u007f|[\u0080-\u009f]/i.test(drawn), surface).toBe(false)
    if (surface === 'terminal') {
      expect((await ui.find({ key: 'error' }))?.text).toBe('Chrome did not write a screenshot: fatal: bad�thing� here�')
      expect((await ui.find({ key: 'status' }))?.text).toMatch(/^localhost:5173\/a/)
    } else {
      expect((await ui.find({ key: 'elsewhere' }))?.text).toMatch(/localhost:5173\/a/)
    }
    await ui.unmount()
  }
})
