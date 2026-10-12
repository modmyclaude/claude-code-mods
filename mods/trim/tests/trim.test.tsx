// trim through the real chains: a Bash call folded before the model reads it,
// what is never touched, the row under a folded call, /trim and its panes.

import { describe, expect, test } from 'claude-code/testing'

import { KEEP_CALLS, KEEP_CHARS, remember } from '../hooks/register'
import { PANE_PROPS, PLUGIN, SURFACES, bash, numbered, paneTexts, row, start, stdoutOf, trim, world } from './world'

const BIG = numbered(2_000)

describe('the fold Claude reads', () => {
  test('a long output reaches the model folded, with its footer; the status line counts the saving', async ($, on) => {
    const w = world(on)
    w.stdout['npm test'] = BIG
    await start($)
    const ran = await bash($, 'npm test')
    const read = stdoutOf(ran)
    expect(read.split('\n').slice(0, 15)).toEqual(BIG.split('\n').slice(0, 15))
    expect(read).toContain('line 2000')
    expect(read).not.toContain('line 500\n')
    expect(read).toMatch(/\[trim: 1,945 of 2,000 lines folded, about [\d,]+ tokens saved\./)
    expect(read.length).toBeLessThan(BIG.length / 5)
    expect(ran.ref).toBeUndefined() // a fresh result, never core's own messages
    expect(w.status).toMatch(/^trim ~[\d.]+k saved$/)
  })

  test('short output, a failed command, another tool and a paused session pass untouched', async ($, on) => {
    const w = world(on)
    w.stdout['ls'] = numbered(100)
    w.failing['make'] = `Exit code 2\n${BIG}`
    w.stdout['npm test'] = BIG
    await start($)
    expect(stdoutOf(await bash($, 'ls'))).toBe(numbered(100))
    const failed = await bash($, 'make')
    expect(failed.isError).toBe(true)
    expect(failed.text).toBe(`Exit code 2\n${BIG}`)
    const read = await $.tool.call({ tool: 'Read', file_path: '/work/big.txt' })
    expect(read.text).toHaveLength(20_000)
    await trim($, 'off')
    expect(stdoutOf(await bash($, 'npm test'))).toBe(BIG)
    await trim($, 'on')
    expect(stdoutOf(await bash($, 'npm test'))).not.toBe(BIG)
    expect(w.status).toMatch(/^trim ~/)
  })

  test('an image, a background job and output Claude Code already saved to a file pass untouched', async ($, on) => {
    const w = world(on)
    w.stdout['npm test'] = BIG
    await start($)
    for (const extra of [{ isImage: true }, { backgroundTaskId: 'b1' }, { persistedOutputPath: '/tmp/out.txt' }, { structuredContent: [] }]) {
      w.extra = extra
      expect(stdoutOf(await bash($, 'npm test')), JSON.stringify(extra)).toBe(BIG)
    }
    w.extra = {}
    expect(stdoutOf(await bash($, 'npm test'))).not.toBe(BIG)
  })

  test('stderr is never touched, however long', async ($, on) => {
    const w = world(on)
    w.stdout['build'] = BIG
    w.stderr['build'] = numbered(3_000, 'stderr')
    await start($)
    const ran = await bash($, 'build')
    expect((ran.result as { stderr: string }).stderr).toBe(numbered(3_000, 'stderr'))
    expect(stdoutOf(ran)).not.toBe(BIG)
  })

  test('the person\'s keep pattern survives the fold', { options: { keep: 'deploy id' } }, async ($, on) => {
    const w = world(on)
    w.stdout['deploy'] = BIG.replace('line 777\n', 'deploy id: d-42\n')
    await start($)
    expect(stdoutOf(await bash($, 'deploy'))).toContain('deploy id: d-42')
  })

  // 110 lines of 50 characters: under both default limits, past a 40-line one.
  const MID = Array.from({ length: 110 }, (_, i) => `row ${String(i).padStart(3, '0')} ${'x'.repeat(42)}`).join('\n') + '\n'

  test('a lower line limit from settings folds sooner', { options: { lines: 40 } }, async ($, on) => {
    const w = world(on)
    w.stdout['ls'] = MID
    await start($)
    expect(stdoutOf(await bash($, 'ls'))).toContain('[trim: ')
  })

  test('the same output under the default limits is left alone', async ($, on) => {
    const w = world(on)
    w.stdout['ls'] = MID
    await start($)
    expect(stdoutOf(await bash($, 'ls'))).toBe(MID)
  })
})

describe('the row under a folded call', () => {
  for (const surface of SURFACES) {
    test(`says what was saved and expands the drawing alone, on ${surface}`, async ($, on) => {
      const w = world(on)
      w.stdout['npm test'] = BIG
      await start($)
      const read = stdoutOf(await bash($, 'npm test'))
      const id = w.ids[0]!
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolResult', props: row(id, read) })
      expect((await ui.find({ type: 'Text', text: /^engine row/ }))?.text).toBe(`engine row: ${read.split('\n').length} lines`)
      expect((await ui.find({ type: 'Text', text: /^trim: / }))?.text).toMatch(/^trim: 1,945 lines folded · ~[\d.]+k tokens saved$/)
      await ui.press({ key: 'expand' })
      expect((await ui.find({ type: 'Text', text: /^engine row/ }))?.text).toBe('engine row: 2001 lines')
      expect((await ui.find({ key: 'expand' }))?.props.label).toBe('fold')
      await ui.press({ key: 'expand' })
      expect((await ui.find({ type: 'Text', text: /^engine row/ }))?.text).toBe(`engine row: ${read.split('\n').length} lines`)
      await ui.unmount()
      // What Claude read is unchanged by any of it.
      expect((await trim($, 'show 1')).text).toBeUndefined()
    })
  }

  test('a row trim did not fold is the engine\'s own', async ($, on) => {
    world(on)
    await start($)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolResult', props: row('other', 'hi\n') })
    expect(await ui.find({ type: 'Text', text: /^trim: / })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^engine row/ }))?.text).toBe('engine row: 2 lines')
  })
})

describe('/trim', () => {
  test('lists the folded calls in a pane, newest first, with a total; answers never reach Claude', async ($, on) => {
    const w = world(on)
    w.stdout['npm test'] = BIG
    w.stdout['npm run build'] = numbered(500)
    await start($)
    await bash($, 'npm test')
    await bash($, 'npm run build')
    const answer = await trim($)
    expect(answer.text).toBeUndefined()
    expect(w.opened).toEqual(['trim'])
    for (const surface of SURFACES) {
      const texts = await paneTexts($, 'trim', surface)
      expect(texts[0], surface).toMatch(/^2 calls folded · about [\d,]+ tokens saved$/)
      expect(texts.slice(1, 7)).toEqual(['#2', 'npm run build', expect.stringMatching(/^500 lines, 445 folded · ~/), '#1', 'npm test', expect.stringMatching(/^2,000 lines, 1,945 folded · ~/)])
    }
  })

  test('show <n> draws that call\'s full output in a pane of its own, cleaned', async ($, on) => {
    const w = world(on)
    w.stdout['npm test'] = BIG.replace('line 3\n', 'line 3 \x1b[31mred\x1b[0m\x07\n')
    await start($)
    await bash($, 'npm test')
    expect((await trim($, 'show 1')).text).toBeUndefined()
    expect(w.opened).toEqual(['trim-output'])
    const [title, full] = await paneTexts($, 'trim-output', 'desktop')
    expect(title).toBe('#1 npm test')
    expect(full).toContain('line 1000')
    expect(full).toContain('line 3 red�')
    expect(full).not.toContain('\x1b')
  })

  test('a very long output draws its first 90,000 characters in the pane, and says so', async ($, on) => {
    const w = world(on)
    w.stdout['cat big.log'] = numbered(20_000)
    await start($)
    await bash($, 'cat big.log')
    await trim($, 'show 1')
    const texts = await paneTexts($, 'trim-output')
    expect(texts[1]).toHaveLength(90_000)
    expect(texts[2]).toBe(`Showing the first 90,000 of ${numbered(20_000).length.toLocaleString('en-US')} characters.`)
  })

  test(`only the last ${KEEP_CALLS} full outputs are kept; an older one says so`, async ($, on) => {
    const w = world(on)
    w.stdout['npm test'] = BIG
    await start($)
    for (let i = 0; i < KEEP_CALLS + 5; i++) await bash($, 'npm test')
    await trim($, 'show 3')
    expect(w.toasts.at(-1)).toBe(`trim: no full output for call 3. /trim lists the last ${KEEP_CALLS}.`)
    await trim($, `show ${KEEP_CALLS + 5}`)
    expect(w.opened.at(-1)).toBe('trim-output')
    const texts = await paneTexts($, 'trim')
    expect(texts[0]).toMatch(/^25 calls folded/)
    expect(texts.filter(t => t.startsWith('#'))).toHaveLength(KEEP_CALLS)
  })

  test('the memory of full outputs holds at most 20 calls and two million characters', () => {
    const store = new Map<string, string>()
    for (let i = 0; i < 30; i++) remember(store, `c${i}`, 'x')
    expect([...store.keys()]).toEqual(Array.from({ length: KEEP_CALLS }, (_, i) => `c${i + 10}`))
    for (let i = 0; i < 5; i++) remember(store, `big${i}`, 'y'.repeat(600_000))
    expect([...store.values()].reduce((n, t) => n + t.length, 0)).toBeLessThanOrEqual(KEEP_CHARS)
    expect(store.has('big4')).toBe(true)
    expect(store.has('big0')).toBe(false)
  })

  test('off and on run only for the person; another plugin is told so and nothing changes', async ($, on) => {
    const w = world(on)
    w.stdout['npm test'] = BIG
    await start($)
    await trim($, 'off', { kind: 'plugin', name: 'other' })
    expect(w.toasts.at(-1)).toBe('trim: /trim off runs only when you type it yourself.')
    expect(stdoutOf(await bash($, 'npm test'))).not.toBe(BIG)
    await trim($, 'off')
    expect(w.toasts.at(-1)).toBe('trim is paused for this session. /trim on resumes it.')
    expect((await paneTexts($, 'trim'))).toContain('Paused for this session. /trim on resumes it.')
  })

  test('where no pane can be drawn, the total comes as a toast', async ($, on) => {
    const w = world(on)
    w.stdout['npm test'] = BIG
    w.isPanePlaced = false
    await start($)
    await bash($, 'npm test')
    await trim($)
    expect(w.toasts.at(-1)).toMatch(/^trim: 1 call folded, about [\d,]+ tokens saved this session\.$/)
  })

  test('every token figure drawn says about or ~', async ($, on) => {
    const w = world(on)
    w.stdout['npm test'] = BIG
    await start($)
    await bash($, 'npm test')
    const drawn = [...(await paneTexts($, 'trim')), w.status ?? '']
    for (const text of drawn.filter(t => /token|saved/.test(t))) expect(text).toMatch(/(about |~)[\d,.]+k? (tokens )?saved|· ~[\d.]+k?$|about four characters/)
    void PANE_PROPS
  })
})
