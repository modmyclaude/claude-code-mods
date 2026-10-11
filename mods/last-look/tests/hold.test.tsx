// End to end, through the engine: a real `tool.call` on Bash, the plugin's
// hook holding it, the pane or band drawn on each surface, a press deciding.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On, ToolCallResult } from 'claude-code'

import { FOOTER } from '../hooks/view'
import { COULD_NOT } from '../hooks/measure'
import { isReadOnly, makeWorld } from './world'
import type { WorldSpec } from './world'

const SURFACES = ['terminal', 'desktop'] as const
const PANE = 'last-look'
const paneProps = (bodyRows = 40) => ({ title: 'Last Look', isFocused: true, bodyColumns: 72, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} })
const BAND = { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 64, scroll: { offset: 0, bodyRows: 11 }, view: {} }

const FILES: WorldSpec = {
  files: {
    'build/app.js': { size: 4096, git: 'ignored' },
    'src/a.ts': { size: 10, git: 'modified' },
    'src/b.ts': { size: 10, git: 'untracked' },
    'src/c.ts': { size: 10, git: 'clean' },
    'dist/x.js': { size: 10, git: 'ignored' },
  },
}

/** Another mod that draws in the band, with a control character (the engine would refuse it). */
const DIRTY_NEIGHBOUR: Plugin = {
  name: 'dirty-neighbour',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box key="dirty">
          <Text>{'bell \u0007 here'}</Text>
        </Box>
      )
    })
  },
}

/** Another mod that draws in the band. */
const NEIGHBOUR: Plugin = {
  name: 'neighbour',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box key="neighbour">
          <Text>neighbour band</Text>
        </Box>
      )
    })
  },
}

const sleep = (ms: number) => new Promise<void>(resolve => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(resolve, ms))

async function until(check: () => boolean, what: string, ms = 4500): Promise<void> {
  for (let waited = 0; waited < ms && !check(); waited += 10) await sleep(10)
  expect(check(), `waited for: ${what}`).toBe(true)
}

function setup(on: On, spec: WorldSpec = FILES) {
  const world = makeWorld(spec)
  const seen = world.install(on)
  const ran: string[] = []
  // Beneath the plugin: the Bash tool itself.
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    ran.push(e.command)
    return { result: { stdout: 'ran', stderr: '', interrupted: false }, text: 'ran' }
  })
  return { world, seen, ran }
}

function bash($: Engine, command: string): Promise<ToolCallResult> {
  return $.tool.call({ tool: 'Bash', command, description: 'test' })
}

function refusal(result: ToolCallResult): string | undefined {
  return result.deny ?? (result.isError ? result.text : undefined)
}

describe('a destructive command is held', () => {
  test('Proceed runs it, on every surface', async ($, on) => {
    const { seen, ran, world } = setup(on)
    for (const [index, surface] of SURFACES.entries()) {
      const before = seen.opened.length
      const call = bash($, 'rm -rf src')
      await until(() => seen.opened.length > before, 'the pane to open')
      expect(ran, 'nothing runs while held').toHaveLength(index)

      const ui = await $.ui.mount({ plugin: 'last-look', surface, component: 'Pane', requestId: PANE, props: paneProps() })
      expect((await ui.find({ key: 'command' }))?.text).toContain('rm -rf src')
      expect((await ui.find({ key: 'headline' }))?.text).toBe('2 files have unsaved work you would lose')
      expect(await ui.find({ type: 'Text', text: '  src/a.ts  (modified)' })).toBeDefined()
      expect((await ui.find({ key: 'footer' }))?.text).toContain(FOOTER)
      await ui.press({ key: 'proceed' })
      const result = await call
      expect(refusal(result)).toBeUndefined()
      expect(result.text).toBe('ran')
      await ui.unmount()
    }
    expect(ran).toEqual(['rm -rf src', 'rm -rf src'])
    expect(seen.closed).toContain(PANE)
    for (const argv of world.calls) expect(isReadOnly(argv), argv.join(' ')).toBe(true)
  })

  test('Cancel denies it, on every surface, and tells the model not to work around it', async ($, on) => {
    const { seen, ran } = setup(on)
    for (const surface of SURFACES) {
      const before = seen.opened.length
      const call = bash($, 'git reset --hard')
      await until(() => seen.opened.length > before, 'the pane to open')
      const ui = await $.ui.mount({ plugin: 'last-look', surface, component: 'Pane', requestId: PANE, props: paneProps() })
      await ui.press({ key: 'cancel' })
      const why = refusal(await call)
      expect(why).toContain('chose Cancel')
      expect(why).toContain('Do not retry it')
      await ui.unmount()
    }
    expect(ran).toEqual([])
    expect(seen.logs).toContain('you cancelled: git reset --hard')
  })

  test('Cancel holds the focus, so Enter cancels; only Cancel has a hotkey', async ($, on) => {
    const { seen } = setup(on)
    const call = bash($, 'rm -rf src')
    await until(() => seen.opened.length > 0, 'the pane to open')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'last-look', surface, component: 'Pane', requestId: PANE, props: paneProps() })
      const buttons = await ui.findAll({ type: 'Button' })
      expect(buttons.map(b => b.key)).toEqual(['cancel', 'proceed'])
      const [cancel, proceed] = buttons
      expect(cancel?.props.autoFocus).toBe(true)
      expect(cancel?.props.hotkey).toBe('c')
      expect(proceed?.props.autoFocus).toBeUndefined()
      expect(proceed?.props.hotkey).toBeUndefined()
      expect(proceed?.props.action).toBeUndefined()
      await ui.unmount()
    }
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
    await ui.press({ key: 'cancel' })
    expect(refusal(await call)).toContain('chose Cancel')
  })

  test('the pane never takes the keyboard on its own', async ($, on) => {
    const { seen } = setup(on)
    const call = bash($, 'rm -rf src')
    await until(() => seen.opened.length > 0, 'the pane to open')
    expect(seen.openArgs[0]?.focus).toBeUndefined()
    expect(seen.openArgs[0]?.closeOnEscape).toBe(true)
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
    await ui.press({ key: 'cancel' })
    await call
  })

  for (const isPanePlaced of [true, false]) {
    test(`typing any letter a-z at the ${isPanePlaced ? 'pane' : 'band'} never approves`, async ($, on) => {
      const { seen, ran } = setup(on, { ...FILES, isPanePlaced })
      for (const surface of SURFACES) {
        const before = seen.opened.length
        let settled: ToolCallResult | undefined
        const call = bash($, 'rm -rf src').then(result => (settled = result))
        await until(() => seen.opened.length > before, 'the hold')
        const ui = isPanePlaced
          ? await $.ui.mount({ plugin: 'last-look', surface, component: 'Pane', requestId: PANE, props: paneProps() })
          : await $.ui.mount({ plugin: 'last-look', surface, component: 'AbovePrompt', props: BAND })
        // A letter key presses the Button whose hotkey it is, as the site does.
        const typeLetter = async (letter: string) => {
          for (const button of await ui.findAll({ type: 'Button' })) {
            if (button.props.hotkey === letter && button.key) await ui.press({ key: button.key })
          }
        }
        for (const letter of 'abdefghijklmnopqrstuvwxyz') await typeLetter(letter)
        await sleep(50)
        expect(settled, 'still held after every letter but c').toBeUndefined()
        expect(ran).toEqual([])
        await typeLetter('c')
        await call
        expect(refusal(settled as ToolCallResult)).toContain('chose Cancel')
        expect(ran).toEqual([])
        await ui.unmount()
      }
    })
  }

  test('a long list is cut to the room it has, with "and N more"', async ($, on) => {
    const files: WorldSpec['files'] = {}
    for (let k = 0; k < 30; k++) files[`out/f${k}.js`] = { size: 1000, git: 'ignored' }
    const { seen } = setup(on, { files })
    const call = bash($, 'rm -rf out')
    await until(() => seen.opened.length > 0, 'the pane to open')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'last-look', surface, component: 'Pane', requestId: PANE, props: paneProps(18) })
      expect(await ui.find({ type: 'Text', text: 'Deletes 30 files, 30.0 KB' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^ {2}and \d+ more$/ })).toBeDefined()
      expect(await ui.find({ key: 'cancel' })).toBeDefined()
      await ui.unmount()
    }
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
    await ui.press({ key: 'cancel' })
    await call
  })

  test('the status line says a command is waiting, and clears after', async ($, on) => {
    const { seen } = setup(on)
    const call = bash($, 'rm -rf src')
    await until(() => seen.opened.length > 0, 'the pane to open')
    expect(seen.status).toContain('holding a command: Cancel or Proceed')
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
    await ui.press({ key: 'proceed' })
    await call
    expect(seen.status[seen.status.length - 1]).toBeUndefined()
  })

  test('two holds at once queue, each decided on its own', async ($, on) => {
    const { seen, ran } = setup(on)
    const first = bash($, 'rm -rf src')
    await until(() => seen.opened.length > 0, 'the pane to open')
    const second = bash($, 'git reset --hard')
    await until(() => seen.opened.length > 1, 'the second hold')
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
    expect(await ui.find({ type: 'Text', text: '1 more held after this one' })).toBeDefined()
    expect((await ui.find({ key: 'command' }))?.text).toContain('rm -rf src')
    await ui.press({ key: 'proceed' })
    await first
    expect((await ui.find({ key: 'command' }))?.text).toContain('git reset --hard')
    await ui.press({ key: 'cancel' })
    expect(refusal(await second)).toContain('chose Cancel')
    expect(ran).toEqual(['rm -rf src'])
  })

  test('the hold outlives the 10 s hook budget: it waits for the person', { timeoutMs: 30_000 }, async ($, on) => {
    const { seen, ran } = setup(on)
    const call = bash($, 'rm -rf src')
    await until(() => seen.opened.length > 0, 'the pane to open')
    await sleep(11_500)
    expect(ran).toEqual([])
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
    await ui.press({ key: 'proceed' })
    const result = await call
    expect(refusal(result)).toBeUndefined()
    expect(ran).toEqual(['rm -rf src'])
  })
})

describe('the band, where the pane has no room', () => {
  test('draws the decision above the prompt on every surface, sized to its body width', async ($, on) => {
    const { seen, ran } = setup(on, { ...FILES, isPanePlaced: false })
    for (const surface of SURFACES) {
      const before = seen.opened.length
      const call = bash($, 'rm -rf src')
      await until(() => seen.opened.length > before, 'the hold')
      const ui = await $.ui.mount({ plugin: 'last-look', surface, component: 'AbovePrompt', props: BAND, viewport: { columns: 200, rows: 50 } })
      expect((await ui.find({ key: 'last-look' }))?.props.width).toBe(64)
      expect((await ui.find({ key: 'command' }))?.text).toContain('rm -rf src')
      expect((await ui.find({ key: 'headline' }))?.text).toBe('2 files have unsaved work you would lose')
      expect((await ui.find({ key: 'footer' }))?.text).toContain(FOOTER)
      expect((await ui.find({ key: 'cancel' }))?.props.autoFocus).toBe(true)
      await ui.press({ key: surface === 'terminal' ? 'cancel' : 'proceed' })
      const result = await call
      if (surface === 'terminal') expect(refusal(result)).toContain('chose Cancel')
      else expect(refusal(result)).toBeUndefined()
      await ui.unmount()
    }
    expect(ran).toEqual(['rm -rf src'])
  })

  test('while a hold waits it draws alone; with nothing held, other mods keep the band', { plugins: [NEIGHBOUR] }, async ($, on) => {
    const { seen, ran } = setup(on, { ...FILES, isPanePlaced: false })
    for (const surface of SURFACES) {
      const idle = await $.ui.mount({ plugin: 'last-look', surface, component: 'AbovePrompt', props: BAND })
      expect((await idle.find({ key: 'neighbour' }))?.text).toBe('neighbour band')
      await idle.unmount()

      const before = seen.opened.length
      const call = bash($, 'rm -rf src')
      await until(() => seen.opened.length > before, 'the hold')
      const ui = await $.ui.mount({ plugin: 'last-look', surface, component: 'AbovePrompt', props: BAND })
      expect(await ui.find({ key: 'last-look' })).toBeDefined()
      expect(await ui.find({ key: 'neighbour' })).toBeUndefined()
      expect((await ui.find({ key: 'alone' }))?.text).toBe('Other bands are hidden until you decide.')
      await ui.press({ key: 'cancel' })
      expect(refusal(await call)).toContain('chose Cancel')
      await ui.unmount()
    }
    expect(ran).toEqual([])
  })

  test('a band beneath that draws a control character cannot hide the hold', { plugins: [DIRTY_NEIGHBOUR] }, async ($, on) => {
    const { seen, ran } = setup(on, { ...FILES, isPanePlaced: false })
    const call = bash($, 'rm -rf src')
    await until(() => seen.opened.length > 0, 'the hold')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'last-look', surface, component: 'AbovePrompt', props: BAND })
      expect(await ui.find({ key: 'cancel' })).toBeDefined()
      await ui.unmount()
    }
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    await ui.press({ key: 'cancel' })
    expect(refusal(await call)).toContain('chose Cancel')
    expect(ran).toEqual([])
  })

  test('with nothing held the band is left to the engine', async ($, on) => {
    setup(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'last-look', surface, component: 'AbovePrompt', props: BAND })
      expect(await ui.find({ key: 'cancel' })).toBeUndefined()
      await ui.unmount()
    }
  })
})

describe('untrusted text', () => {
  // The model writes the command; file names and git output come from disk.
  const DIRTY = 'rm -rf src # \u001b[31mred\u001b[0m \u0007 \u0000 \u007f \u0085 \u009b2J \u001b]0;title\u0007'
  const DIRTY_FILES: WorldSpec = { files: { 'src/a\u001b[1mb\u0007.ts': { size: 10, git: 'modified' } } }
  const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/

  for (const isPanePlaced of [true, false]) {
    test(`control characters never hide the hold (${isPanePlaced ? 'pane' : 'band'})`, async ($, on) => {
      const { seen, ran } = setup(on, { ...DIRTY_FILES, isPanePlaced })
      const call = bash($, DIRTY)
      await until(() => seen.opened.length > 0, 'the hold')
      for (const surface of SURFACES) {
        const ui = isPanePlaced
          ? await $.ui.mount({ plugin: 'last-look', surface, component: 'Pane', requestId: PANE, props: paneProps() })
          : await $.ui.mount({ plugin: 'last-look', surface, component: 'AbovePrompt', props: BAND })
        expect(await ui.find({ key: 'cancel' })).toBeDefined()
        expect(JSON.stringify(await ui.drawn())).not.toMatch(CONTROL)
        expect((await ui.find({ key: 'command' }))?.text).toContain('rm -rf src')
        if (isPanePlaced) expect(await ui.find({ type: 'Text', text: /src\/ab\uFFFD\.ts/ })).toBeDefined()
        await ui.unmount()
      }
      for (const text of [...seen.status, ...seen.logs]) expect(String(text ?? '')).not.toMatch(CONTROL)
      const ui = isPanePlaced
        ? await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
        : await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'AbovePrompt', props: BAND })
      await ui.press({ key: 'cancel' })
      expect(refusal(await call)).toContain('chose Cancel')
      expect(ran).toEqual([])
    })
  }
})

describe('what passes untouched', () => {
  test('safe commands run as given, with nothing measured and nothing shown', async ($, on) => {
    const { seen, ran, world } = setup(on)
    const safe = ['ls -la', 'rm file.txt', 'echo "rm -rf /"', 'grep -r TODO src', 'git push --force-with-lease', 'git status', 'echo hi >> log.txt']
    for (const command of safe) {
      const result = await bash($, command)
      expect(result.text, command).toBe('ran')
    }
    expect(ran).toEqual(safe)
    expect(world.calls).toEqual([])
    expect(seen.opened).toEqual([])
  })

  test('not destructive after all: a redirect to a new file, a branch switch', async ($, on) => {
    const { seen, ran } = setup(on, { files: { 'src/a.ts': { size: 1, git: 'clean' } }, git: { refs: ['refs/heads/main'] } })
    for (const command of ['echo hi > new.txt', 'git checkout main']) {
      expect((await bash($, command)).text, command).toBe('ran')
    }
    expect(ran).toHaveLength(2)
    expect(seen.opened).toEqual([])
  })

  test('a destructive command that finds nothing to destroy still holds', async ($, on) => {
    const { seen, ran } = setup(on, { files: { 'src/a.ts': { size: 1, git: 'clean' } } })
    for (const command of ['rm -rf out', 'git reset --hard', 'find . -name "*.pyc" -delete']) {
      const before = seen.opened.length
      const call = bash($, command)
      await until(() => seen.opened.length > before, `the hold for ${command}`)
      const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
      await ui.press({ key: 'cancel' })
      expect(refusal(await call), command).toContain('chose Cancel')
      await ui.unmount()
    }
    expect(ran).toEqual([])
  })

  test('the Monitor tool runs a shell command too: it is held the same way', async ($, on) => {
    const { seen } = setup(on)
    const monitored: string[] = []
    on('tool.call', { tool: 'Monitor' }, (_$, e) => {
      monitored.push(e.command ?? '')
      return { result: { taskId: 't' }, text: 'watching' } as never
    })
    expect((await $.tool.call({ tool: 'Monitor', command: 'tail -f log.txt', description: 'watch', timeout_ms: 1000 })).text).toBe('watching')
    const call = $.tool.call({ tool: 'Monitor', command: 'rm -rf src', description: 'watch', timeout_ms: 1000 })
    await until(() => seen.opened.length > 0, 'the hold')
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
    await ui.press({ key: 'cancel' })
    expect(refusal(await call)).toContain('chose Cancel')
    expect(monitored).toEqual(['tail -f log.txt'])
  })

  test('alwaysAllow folders pass (the default list)', async ($, on) => {
    const { seen, ran } = setup(on)
    expect((await bash($, 'rm -rf dist')).text).toBe('ran')
    expect((await bash($, 'rm -rf build dist')).text).toBe('ran')
    expect(ran).toEqual(['rm -rf dist', 'rm -rf build dist'])
    expect(seen.opened).toEqual([])
  })

  test('with alwaysAllow emptied, the same command is held', { options: { alwaysAllow: '' } }, async ($, on) => {
    const { seen, ran } = setup(on)
    const call = bash($, 'rm -rf dist')
    await until(() => seen.opened.length > 0, 'the pane to open')
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
    await ui.press({ key: 'cancel' })
    await call
    expect(ran).toEqual([])
  })

  test('one target outside alwaysAllow holds the whole command', async ($, on) => {
    const { seen } = setup(on)
    const call = bash($, 'rm -rf dist src')
    await until(() => seen.opened.length > 0, 'the pane to open')
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
    await ui.press({ key: 'cancel' })
    expect(refusal(await call)).toContain('chose Cancel')
  })
})

describe('failing safe', () => {
  test('a command it cannot measure is still held, and says so', async ($, on) => {
    const { seen, ran } = setup(on, { ...FILES, fail: /^(find|du|git)\b/ })
    const call = bash($, 'rm -rf src')
    await until(() => seen.opened.length > 0, 'the pane to open')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'last-look', surface, component: 'Pane', requestId: PANE, props: paneProps() })
      expect(await ui.find({ type: 'Text', text: COULD_NOT })).toBeDefined()
      expect((await ui.find({ key: 'headline' }))?.text).toBe('Could not measure all of it: review it yourself')
      await ui.unmount()
    }
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
    await ui.press({ key: 'cancel' })
    expect(refusal(await call)).toContain('chose Cancel')
    expect(ran).toEqual([])
  })

  test('a path only known at run time is held, not waved through', async ($, on) => {
    const { seen, ran } = setup(on)
    const call = bash($, 'rm -rf "$BUILD_DIR"')
    await until(() => seen.opened.length > 0, 'the pane to open')
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'desktop', component: 'Pane', requestId: PANE, props: paneProps() })
    expect(await ui.find({ type: 'Text', text: COULD_NOT })).toBeDefined()
    await ui.press({ key: 'proceed' })
    await call
    expect(ran).toEqual(['rm -rf "$BUILD_DIR"'])
  })

  test('when the mod itself errors, the command is denied', { options: {} }, async ($, on) => {
    const { ran, seen } = setup(on, { ...FILES, isCwdBroken: true })
    const why = refusal(await bash($, 'rm -rf src'))
    expect(why).toContain('safety check failed')
    expect(ran).toEqual([])
    expect(seen.opened).toEqual([])
  })

  test('with nobody to ask (a -p run) it denies at once, saying what it would destroy', async ($, on) => {
    const { ran, seen } = setup(on, { ...FILES, surfaces: [] })
    const why = refusal(await bash($, 'rm -rf src'))
    expect(why).toContain('nobody can review')
    expect(why).toContain('2 files have unsaved work you would lose')
    expect(ran).toEqual([])
    expect(seen.opened).toEqual([])
  })

  test('with no pane placed and no surface that draws the band, it denies', async ($, on) => {
    const { ran } = setup(on, { ...FILES, surfaces: ['mobile'], isPanePlaced: false })
    const why = refusal(await bash($, 'rm -rf src'))
    expect(why).toContain('no terminal or desktop view')
    expect(ran).toEqual([])
  })

  test('a path that exists but cannot be read is held unmeasured, not taken as missing', async ($, on) => {
    const { seen, ran } = setup(on, { ...FILES, unreadable: ['secret'] })
    const call = bash($, 'rm -rf secret')
    await until(() => seen.opened.length > 0, 'the pane to open')
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
    expect(await ui.find({ type: 'Text', text: COULD_NOT })).toBeDefined()
    await ui.press({ key: 'cancel' })
    await call
    expect(ran).toEqual([])
  })

  test('V-1: a redirect after a command that creates its target is held', async ($, on) => {
    const { seen, ran } = setup(on, { files: { 'a.ts': { size: 100, git: 'modified' } } })
    const call = bash($, 'mv a.ts tmp && echo x > tmp')
    await until(() => seen.opened.length > 0, 'the pane to open')
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
    await ui.press({ key: 'cancel' })
    expect(refusal(await call)).toContain('chose Cancel')
    expect(ran).toEqual([])
  })

  test('V-2: find through a link in an allowed folder is held with the default alwaysAllow', async ($, on) => {
    const { seen, ran } = setup(on, { files: { 'src/a.ts': { size: 1, git: 'modified' }, 'dist/x.js': { size: 1, git: 'ignored' } }, links: { 'dist/src': '/work/app/src' } })
    const call = bash($, 'find -L dist -delete')
    await until(() => seen.opened.length > 0, 'the pane to open')
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
    await ui.press({ key: 'cancel' })
    await call
    expect(ran).toEqual([])
  })

  test('V-3: git branch -D -- feature is held', async ($, on) => {
    const { seen, ran } = setup(on, { files: { 'a.ts': { size: 1, git: 'clean' } }, git: { refs: ['refs/heads/feature'], ranges: { 'only:feature': ['1111111 wip'] } } })
    const call = bash($, 'git branch -D -- feature')
    await until(() => seen.opened.length > 0, 'the pane to open')
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
    expect((await ui.find({ key: 'headline' }))?.text).toBe('1 commit would be lost')
    await ui.press({ key: 'cancel' })
    await call
    expect(ran).toEqual([])
  })

  test('a stat error is never taken for "does not exist": the redirect holds', async ($, on) => {
    const { seen, ran } = setup(on, { ...FILES, unreadable: ['secret.txt'] })
    const call = bash($, 'echo hi > secret.txt')
    await until(() => seen.opened.length > 0, 'the pane to open')
    const ui = await $.ui.mount({ plugin: 'last-look', surface: 'terminal', component: 'Pane', requestId: PANE, props: paneProps() })
    expect(await ui.find({ type: 'Text', text: COULD_NOT })).toBeDefined()
    await ui.press({ key: 'cancel' })
    await call
    expect(ran).toEqual([])
  })

  test('with no way to wait (no sleep command), it denies rather than run unreviewed', async ($, on) => {
    const { ran, seen } = setup(on, { ...FILES, fail: /^(sleep|powershell)\b/ })
    const why = refusal(await bash($, 'rm -rf src'))
    expect(why).toContain('could not wait for a review')
    expect(ran).toEqual([])
    expect(seen.closed).toContain(PANE)
  })
})
