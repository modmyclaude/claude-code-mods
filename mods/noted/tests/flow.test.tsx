// noted end to end, through the real wiring: a prompt is submitted, the model
// (answered beneath the plugin) proposes a rule, the band is mounted on each
// surface and its buttons pressed, and the files (answered beneath) checked.

import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  BAND,
  GLOBAL,
  PRESENTATION,
  PROJECT,
  PROMPT_FROM_PERSON,
  SURFACES,
  verdict,
  world,
} from './world'

const PNPM = 'Use pnpm, not npm, in this repo.'

/** Another mod with a band of its own, composing what is beneath it. */
const NEIGHBOUR = {
  name: 'neighbour',
  register(on: On) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const { Box, Text } = $.ui.resolve(e)
      const below = await next(e)
      return (
        <Box flexDirection="column">
          <Box key="neighbour">
            <Text>another mod's band</Text>
          </Box>
          {below}
        </Box>
      )
    })
  },
}

describe('a correction', () => {
  for (const surface of SURFACES) {
    test(`becomes a proposed rule in the band, saved to the project on ${surface}`, async ($, on) => {
      const w = world(on, { files: { [PROJECT]: '# App\n\nSome notes.\n' }, reply: verdict(PNPM) })

      const entered = await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
      expect(entered.text).toBe('no, use pnpm') // the prompt itself is never altered

      // One cheap call, carrying the correction and the reply it corrects.
      expect(w.calls).toHaveLength(1)
      expect(w.calls[0]?.model).toBe('haiku')
      expect(w.calls[0]?.maxTokens).toBe(1024) // headroom: the haiku alias thinks first
      expect(w.calls[0]?.effort).toBe('low')
      expect(w.calls[0]?.prompt).toContain('no, use pnpm')
      expect(w.calls[0]?.prompt).toContain('I ran npm install and added lodash.')

      const ui = await $.ui.mount({ plugin: 'noted', surface, component: 'AbovePrompt', props: BAND })
      expect((await ui.find({ key: 'rule' }))?.text).toBe(PNPM)
      for (const key of ['save-project', 'save-global', 'edit', 'skip']) {
        expect(await ui.find({ type: 'Button', key })).toBeDefined()
      }
      expect(await ui.find({ key: 'replace' })).toBeUndefined()
      expect(w.writes).toEqual([]) // nothing is written before a press

      await ui.press({ key: 'save-project' })
      expect(w.files[PROJECT]).toBe(`# App\n\nSome notes.\n\n## House rules\n\n- ${PNPM}\n`)
      expect(w.writes).toEqual([PROJECT])
      expect((await ui.find({ key: 'notice' }))?.text).toContain('saved to ./CLAUDE.md')
      await ui.unmount()
    })

    test(`saves globally, creating the file, on ${surface}`, async ($, on) => {
      const w = world(on, { reply: verdict('Never push to main.') })
      await $.prompt.submit({ text: 'never push to main', ...PROMPT_FROM_PERSON })

      const ui = await $.ui.mount({ plugin: 'noted', surface, component: 'AbovePrompt', props: BAND })
      await ui.press({ key: 'save-global' })
      expect(w.files[GLOBAL]).toBe('## House rules\n\n- Never push to main.\n')
      expect(w.files[PROJECT]).toBeUndefined()
      expect((await ui.find({ key: 'notice' }))?.text).toContain('~/.claude/CLAUDE.md')
      await ui.unmount()
    })

    test(`can be edited before saving on ${surface}`, async ($, on) => {
      const w = world(on, { reply: verdict(PNPM) })
      await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })

      const ui = await $.ui.mount({ plugin: 'noted', surface, component: 'AbovePrompt', props: BAND })
      await ui.press({ key: 'edit' })
      expect((await ui.find({ type: 'Input', key: 'rule-input' }))?.props.value).toBe(PNPM)
      expect(await ui.find({ key: 'save-project' })).toBeUndefined() // no save mid-edit

      await ui.input({ key: 'rule-input', text: '  Use pnpm for every install.  ' })
      expect((await ui.find({ key: 'rule' }))?.text).toBe('Use pnpm for every install.')
      await ui.press({ key: 'save-project' })
      expect(w.files[PROJECT]).toBe('## House rules\n\n- Use pnpm for every install.\n')
      await ui.unmount()
    })

    test(`is dropped by Skip, writing nothing, on ${surface}`, async ($, on) => {
      const w = world(on, { reply: verdict(PNPM) })
      await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })

      const ui = await $.ui.mount({ plugin: 'noted', surface, component: 'AbovePrompt', props: BAND })
      await ui.press({ key: 'skip' })
      expect(await ui.find({ key: 'noted' })).toBeUndefined() // the band is the engine's again
      expect(w.writes).toEqual([])
      await ui.unmount()
    })
  }

  test('keeps the rest of an existing file byte for byte, CRLF included', async ($, on) => {
    const before = '# Project\r\n\r\n## House rules\r\n\r\n- Keep functions small.\r\n\r\n## Notes\r\n\r\nSee docs.'
    const w = world(on, { files: { [PROJECT]: before }, reply: verdict(PNPM) })
    await $.prompt.submit({ text: 'we use pnpm not npm', ...PROMPT_FROM_PERSON })

    const ui = await $.ui.mount({ plugin: 'noted', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    await ui.press({ key: 'save-project' })
    const at = before.indexOf('- Keep functions small.') + '- Keep functions small.'.length
    expect(w.files[PROJECT]).toBe(`${before.slice(0, at)}\r\n- ${PNPM}${before.slice(at)}`)
  })

  test('is never written over a file that exists but cannot be read', async ($, on) => {
    const w = world(on, { unreadable: [PROJECT], reply: verdict(PNPM) })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })

    const ui = await $.ui.mount({ plugin: 'noted', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    await ui.press({ key: 'save-project' })
    expect(w.writes).toEqual([])
    expect((await ui.find({ key: 'notice' }))?.text).toContain('could not read ./CLAUDE.md')
    expect((await ui.find({ type: 'Text', text: /could not read/ }))?.props.color).toBe('error')
  })

  test('is not replaced by a newer one while the person is editing it', async ($, on) => {
    const w = world(on, { reply: verdict(PNPM) })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    const ui = await $.ui.mount({ plugin: 'noted', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    await ui.press({ key: 'edit' })

    await $.prompt.submit({ text: "don't add comments", ...PROMPT_FROM_PERSON })
    expect(w.calls).toHaveLength(1) // no second call while editing
    expect(await ui.find({ key: 'rule-input' })).toBeDefined()
  })
})

describe('sharing the band', () => {
  for (const surface of SURFACES) {
    test(`noted draws after other mods' bands, never in place of them, on ${surface}`, { plugins: [NEIGHBOUR] }, async ($, on) => {
      world(on, { reply: verdict(PNPM) })
      const ui = await $.ui.mount({ plugin: 'noted', surface, component: 'AbovePrompt', props: BAND })
      // All three drawn, noted's last: an overflowing band scrolls its end away, never their buttons.
      const all = async () => {
        const keys = (await ui.findAll({ type: 'Box' })).map(b => b.key)
        const at = (key: string) => keys.indexOf(key)
        expect(at('neighbour')).toBeGreaterThanOrEqual(0)
        expect(at('engine')).toBeGreaterThanOrEqual(0)
        expect(at('noted')).toBeGreaterThan(at('neighbour'))
        expect(at('noted')).toBeGreaterThan(at('engine'))
        return [await ui.find({ key: 'noted' })]
      }

      await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
      await ui.redraw()
      for (const found of await all()) expect(found).toBeDefined() // the proposal

      await ui.press({ key: 'save-project' })
      for (const found of await all()) expect(found).toBeDefined() // the notice

      await $.command.run({ command: 'rules', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
      await ui.redraw()
      expect(await ui.find({ key: 'done' })).toBeDefined()
      for (const found of await all()) expect(found).toBeDefined() // the /rules list
    })
  }

  // A session refuses a tree that puts the engine's own node under a Box that
  // sizes, hides or moves it ("engine node under a Box with prop ..."), and draws
  // its own band instead. The kit does not check this, so the test walks the tree.
  const ENGINE_BENEATH = {
    name: 'engine-beneath',
    tier: 'append' as const,
    register(on: On) {
      on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as never)
    },
  }
  const CONCEALING = ['display', 'overflow', 'position', 'width', 'height', 'minWidth', 'minHeight', 'top', 'left', 'right', 'bottom']
  type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
  function engineNodeConcealers(node: unknown, around: string[] = []): string[][] {
    if (node === null || typeof node !== 'object') return []
    const n = node as Node
    if (n.type === 'engine') return [around]
    const mine = n.type === 'Box' ? CONCEALING.filter(k => n.props?.[k] !== undefined) : []
    return (n.children ?? []).flatMap(c => engineNodeConcealers(c, [...around, ...mine]))
  }

  test('the engine band beneath noted is never under a Box that sizes or hides it', { plugins: [ENGINE_BENEATH] }, async ($, on) => {
    world(on, { reply: verdict(PNPM) })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'noted', surface, component: 'AbovePrompt', props: BAND })
      expect((await ui.find({ key: 'rule' }))?.text).toBe(PNPM)
      expect(engineNodeConcealers(await ui.drawn())).toEqual([[]])
      await ui.unmount()
    }
  })
})

describe('the pre-filter', () => {
  test('keeps ordinary prompts away from the model', async ($, on) => {
    const w = world(on, { reply: verdict(PNPM) })
    for (const text of ['fix the login bug', 'no worries, that works', 'add a do not disturb mode feature']) {
      const entered = await $.prompt.submit({ text, ...PROMPT_FROM_PERSON })
      expect(entered.text).toBe(text)
    }
    expect(w.calls).toHaveLength(0)
    const ui = await $.ui.mount({ plugin: 'noted', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ key: 'noted' })).toBeUndefined()
  })

  test('takes desktop-app prompts, which arrive with origin sdk', async ($, on) => {
    const w = world(on, { reply: verdict(PNPM), surfaces: ['desktop'] })
    await $.prompt.submit({ text: 'no, use pnpm', wait: false, origin: { kind: 'sdk' } })
    expect(w.calls).toHaveLength(1)
    const ui = await $.ui.mount({ plugin: 'noted', surface: 'desktop', component: 'AbovePrompt', props: BAND })
    expect((await ui.find({ key: 'rule' }))?.text).toBe(PNPM)
  })

  test('ignores prompts that are not the person\u2019s own words', async ($, on) => {
    const w = world(on, { reply: verdict(PNPM) })
    await $.prompt.submit({ text: 'no, use pnpm', wait: false, origin: { kind: 'plugin', name: 'other' } })
    await $.prompt.submit({ text: 'no, use pnpm', wait: false, origin: { kind: 'task-notification' } })
    expect(w.calls).toHaveLength(0)
  })
})

describe('no duplicates', () => {
  test('a rule already in the file is "already a rule", with no model-proposed save', async ($, on) => {
    const file = `## House rules\n\n- ${PNPM}\n`
    const w = world(on, { files: { [PROJECT]: file }, reply: verdict('use PNPM, not npm in this repo') })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })

    expect(w.calls[0]?.prompt).toContain(`1. ${PNPM}`) // the model saw the existing rules
    const ui = await $.ui.mount({ plugin: 'noted', surface: 'desktop', component: 'AbovePrompt', props: BAND })
    expect((await ui.find({ key: 'notice' }))?.text).toContain(`already a rule in ./CLAUDE.md: ${PNPM}`)
    expect(await ui.find({ key: 'save-project' })).toBeUndefined()
    expect(w.writes).toEqual([])
  })

  test('a rule the model calls a duplicate in other words is "already a rule" too', async ($, on) => {
    const w = world(on, {
      files: { [GLOBAL]: '## House rules\n\n- Always use pnpm instead of npm.\n' },
      reply: verdict(PNPM, { duplicateOf: 1 }),
    })
    await $.prompt.submit({ text: 'I told you, pnpm', ...PROMPT_FROM_PERSON })
    const ui = await $.ui.mount({ plugin: 'noted', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect((await ui.find({ key: 'notice' }))?.text).toContain('already a rule in ~/.claude/CLAUDE.md: Always use pnpm instead of npm.')
    expect(w.writes).toEqual([])
  })

  test('the notice clears on the next prompt', async ($, on) => {
    world(on, { files: { [PROJECT]: `## House rules\n\n- ${PNPM}\n` }, reply: verdict(PNPM) })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    await $.prompt.submit({ text: 'thanks, now fix the build', ...PROMPT_FROM_PERSON })
    const ui = await $.ui.mount({ plugin: 'noted', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ key: 'noted' })).toBeUndefined()
  })

  for (const surface of SURFACES) {
    test(`a conflicting rule offers Replace old rule, which rewrites it in place, on ${surface}`, async ($, on) => {
      const before = '# Me\n\n## House rules\n\n- Use npm for installs.\n- Keep commits small.\n'
      const w = world(on, { files: { [GLOBAL]: before }, reply: verdict(PNPM, { conflictsWith: 1 }) })
      await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })

      const ui = await $.ui.mount({ plugin: 'noted', surface, component: 'AbovePrompt', props: BAND })
      expect((await ui.find({ key: 'conflict' }))?.text).toContain('~/.claude/CLAUDE.md: Use npm for installs.')
      expect(await ui.find({ key: 'replace' })).toBeDefined()
      expect(await ui.find({ key: 'save-project' })).toBeUndefined() // no contradiction added
      expect(await ui.find({ key: 'save-global' })).toBeUndefined()

      await ui.press({ key: 'replace' })
      expect(w.files[GLOBAL]).toBe(`# Me\n\n## House rules\n\n- ${PNPM}\n- Keep commits small.\n`)
      expect(w.files[PROJECT]).toBeUndefined()
      expect((await ui.find({ key: 'notice' }))?.text).toContain('replaced the old rule')
      await ui.unmount()
    })
  }

  test('a conflict whose old rule vanished falls back to a plain save', async ($, on) => {
    const w = world(on, { files: { [GLOBAL]: '## House rules\n\n- Use npm for installs.\n' }, reply: verdict(PNPM, { conflictsWith: 1 }) })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    w.files[GLOBAL] = '## House rules\n\n- Keep commits small.\n' // edited by hand meanwhile

    const ui = await $.ui.mount({ plugin: 'noted', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    await ui.press({ key: 'replace' })
    expect(w.writes).toEqual([])
    expect((await ui.find({ key: 'note' }))?.text).toContain('no longer in ~/.claude/CLAUDE.md')
    await ui.press({ key: 'save-global' })
    expect(w.files[GLOBAL]).toBe(`## House rules\n\n- Keep commits small.\n- ${PNPM}\n`)
  })
})

describe('the model call', () => {
  const malformed = [
    'Sure! Rule: use pnpm',
    '{"rule": 5}',
    '{"duplicateOf": null}',
    '{"rule": "Use pnpm.", "conflictsWith": 9}',
    '[{"rule": "Use pnpm."}]',
    // Cut off by the token cap, mid-line:
    '{"rule": "Use pnpm, not npm, in this',
    '```json\n{"rule": "Use pnpm.", "duplicateOf": null',
    '{"rule": "Use pnpm.", "duplicateOf": null, "conflictsWith": ',
  ]
  for (const reply of malformed) {
    test(`proposes nothing when the reply is malformed: ${reply}`, async ($, on) => {
      const w = world(on, { reply })
      const entered = await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
      expect(entered.text).toBe('no, use pnpm')
      expect(w.calls).toHaveLength(1)
      const ui = await $.ui.mount({ plugin: 'noted', surface: 'terminal', component: 'AbovePrompt', props: BAND })
      expect(await ui.find({ key: 'noted' })).toBeUndefined()
    })
  }

  test('proposes nothing when the model finds no lasting rule', async ($, on) => {
    world(on, { reply: verdict(null) })
    await $.prompt.submit({ text: "no, that's fine", ...PROMPT_FROM_PERSON })
    const ui = await $.ui.mount({ plugin: 'noted', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ key: 'noted' })).toBeUndefined()
  })

  test('a failed call lets the prompt through and proposes nothing', async ($, on) => {
    const w = world(on, { reply: null })
    const entered = await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    expect(entered.text).toBe('no, use pnpm')
    expect(w.calls).toHaveLength(1)
    const ui = await $.ui.mount({ plugin: 'noted', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ key: 'noted' })).toBeUndefined()
  })

  test('a refused call lets the prompt through and says once that the model is unavailable', async ($, on) => {
    const w = world(on, {
      reply: () => {
        throw new Error('model not allowed')
      },
    })
    const entered = await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    expect(entered.text).toBe('no, use pnpm')
    await $.prompt.submit({ text: "don't add comments", ...PROMPT_FROM_PERSON })
    expect(w.calls).toHaveLength(2)
    const said = w.logs.flatMap((l, i) => (l.includes('haiku model is not available here') ? [w.sinks[i]] : []))
    expect(said).toEqual(['transcript']) // once, and where the person sees it
  })

  test('the hook failing outright still lets the prompt through (the .catch path)', async ($, on) => {
    const w = world(on, { reply: verdict(PNPM) })
    // An input with no origin makes the hook itself throw before it calls next.
    const entered = await $.prompt.submit({ text: 'no, use pnpm', wait: false } as never)
    expect(entered.text).toBe('no, use pnpm')
    expect(w.calls).toHaveLength(0)
  })

  test('is not made where no surface can show the band, and says so once', async ($, on) => {
    const w = world(on, { reply: verdict(PNPM), surfaces: ['vscode'] })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    await $.prompt.submit({ text: "don't add comments", ...PROMPT_FROM_PERSON })
    expect(w.calls).toHaveLength(0)
    expect(w.logs.filter(l => l.includes('terminal and the desktop app only'))).toHaveLength(1)
  })

  test('is not made in a headless run', async ($, on) => {
    const w = world(on, { reply: verdict(PNPM), surfaces: [] })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    expect(w.calls).toHaveLength(0)
  })
})

describe('/rules', () => {
  test('is registered at session start', async ($, on) => {
    const specs: Array<{ name: string; immediate?: true }> = []
    on('command.register', ($, e) => {
      specs.push(e)
      return { value: { command: e.name } }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    expect(specs.map(s => s.name)).toEqual(['rules'])
    expect(specs[0]?.immediate).toBe(true) // a listing need not wait for the turn to end
  })

  for (const surface of SURFACES) {
    test(`lists learned rules with dates and removes one from the band on ${surface}`, async ($, on) => {
      let next = PNPM
      const w = world(on, { files: { [PROJECT]: '# App\n' }, reply: () => verdict(next) })
      const ui = await $.ui.mount({ plugin: 'noted', surface, component: 'AbovePrompt', props: BAND })

      // Learn two rules through the real flow, one per file.
      await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
      await ui.redraw()
      await ui.press({ key: 'save-project' })
      next = 'Never push to main.'
      await $.prompt.submit({ text: 'never push to main', ...PROMPT_FROM_PERSON })
      await ui.redraw()
      await ui.press({ key: 'save-global' })

      const listed = await $.command.run({ command: 'rules', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
      expect(listed.text).toContain(`1. ${PNPM} (./CLAUDE.md, added 2026-10-08)`)
      expect(listed.text).toContain('2. Never push to main. (~/.claude/CLAUDE.md, added 2026-10-08)')

      await ui.redraw()
      const removes = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('remove-'))
      expect(removes).toHaveLength(2)
      expect((await ui.findAll({ type: 'Text', text: /added 2026-10-08/ })).length).toBe(2)

      await ui.press({ key: removes[0]?.key ?? '' })
      expect(w.files[PROJECT]).toBe('# App\n\n## House rules\n\n') // only the rule's own line went
      expect(w.files[GLOBAL]).toBe('## House rules\n\n- Never push to main.\n')
      expect((await ui.find({ key: 'message' }))?.text).toContain(`Removed from ./CLAUDE.md: ${PNPM}`)
      expect((await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('remove-'))).toHaveLength(1)

      await ui.press({ key: 'done' })
      expect(await ui.find({ key: 'noted' })).toBeUndefined()
    })
  }

  test('removes by number from the command, for surfaces without the band', async ($, on) => {
    const w = world(on, { reply: verdict('Never push to main.') })
    await $.prompt.submit({ text: 'never push to main', ...PROMPT_FROM_PERSON })
    const ui = await $.ui.mount({ plugin: 'noted', surface: 'desktop', component: 'AbovePrompt', props: BAND })
    await ui.press({ key: 'save-global' })

    const run = (args: string) => $.command.run({ command: 'rules', args, origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect((await run('remove 5')).text).toContain('There is no rule 5')
    expect((await run('remove 1')).text).toContain('Removed from ~/.claude/CLAUDE.md: Never push to main.')
    expect(w.files[GLOBAL]).toBe('## House rules\n\n')
    expect((await run('')).text).toContain('No house rules learned yet')
  })

  test('forgets a rule the person deleted from the file by hand', async ($, on) => {
    const w = world(on, { reply: verdict(PNPM) })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    const ui = await $.ui.mount({ plugin: 'noted', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    await ui.press({ key: 'save-project' })
    w.files[PROJECT] = '## House rules\n'

    const listed = await $.command.run({ command: 'rules', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(listed.text).toContain('No house rules learned yet')
  })
})
