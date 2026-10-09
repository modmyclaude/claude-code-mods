// Control characters (MM-050): the engine refuses a whole drawn tree holding a
// C0 or C1 control and draws its own, hiding this band and every band beneath.
// Rules read from CLAUDE.md files and the model's own rule are untrusted.

import { describe, expect, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'

import { clean } from '../hooks/text'
import { BAND, GLOBAL, PRESENTATION, PROJECT, PROMPT_FROM_PERSON, SURFACES, verdict, world } from './world'

const PNPM = 'Use pnpm, not npm, in this repo.'
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/

describe('clean', () => {
  const cases: Array<[string, string]> = [
    ['plain', 'plain'],
    ['\u001b[31mred\u001b[0m text', 'red text'],
    ['csi \u009b2J gone', 'csi  gone'],
    ['bell\u0007 nul\u0000 del\u007f c1\u0085', 'bell� nul� del� c1�'],
    ['line\nbreak\ttab', 'line break tab'],
  ]
  for (const [raw, drawn] of cases) {
    test(JSON.stringify(raw), () => {
      expect(clean(raw)).toBe(drawn)
      expect(CONTROLS.test(clean(raw))).toBe(false)
    })
  }
})

describe('the band draws untrusted text without control characters', () => {
  for (const surface of SURFACES) {
    test(`a CLAUDE.md rule holding ESC and U+009B still shows the conflict band on ${surface}`, async ($, on) => {
      const hostile = '- Use \u001b[31mnpm\u001b[0m for installs\u0007.\u009b'
      const before = `# Me\r\n\r\n## House rules\r\n\r\n${hostile}\r\n- Ring the \u0007bell.\r\n`
      const w = world(on, { files: { [GLOBAL]: before }, reply: verdict(PNPM, { conflictsWith: 1 }) })
      await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })

      const ui = await $.ui.mount({ plugin: 'noted', surface, component: 'AbovePrompt', props: BAND })
      const conflict = await ui.find({ key: 'conflict' })
      expect(conflict?.text).toContain('Use npm for installs')
      expect(CONTROLS.test(conflict?.text ?? '')).toBe(false)

      // Replace rewrites that one line; every other byte, controls included, stays.
      await ui.press({ key: 'replace' })
      expect(w.files[GLOBAL]).toBe(before.replace(hostile, `- ${PNPM}`))
      await ui.unmount()
    })

    test(`a duplicate holding controls still shows "already a rule" on ${surface}`, async ($, on) => {
      const w = world(on, { files: { [PROJECT]: `## House rules\n\n- Use \u001b[1mpnpm\u001b[0m, not npm, in this repo.\u0085\n` }, reply: verdict(PNPM) })
      await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
      const ui = await $.ui.mount({ plugin: 'noted', surface, component: 'AbovePrompt', props: BAND })
      const shown = await ui.find({ key: 'notice' })
      expect(shown?.text).toContain('already a rule in ./CLAUDE.md')
      expect(CONTROLS.test(shown?.text ?? '')).toBe(false)
      expect(w.writes).toEqual([])
      await ui.unmount()
    })

    test(`a model rule holding controls is drawn and written clean on ${surface}`, async ($, on) => {
      const w = world(on, { reply: verdict('Use \u001b[31mpnpm\u001b[0m, not npm\u0007, in this repo.\u009b') })
      await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
      const ui = await $.ui.mount({ plugin: 'noted', surface, component: 'AbovePrompt', props: BAND })
      expect((await ui.find({ key: 'rule' }))?.text).toBe(PNPM)
      await ui.press({ key: 'save-project' })
      expect(w.files[PROJECT]).toBe(`## House rules\n\n- ${PNPM}\n`)
      await ui.unmount()
    })
  }
})

/** noted drew, and no Text or Button label holds a control character. */
async function expectClean(ui: Mounted<(typeof SURFACES)[number], 'AbovePrompt'>, where: string) {
  expect(await ui.find({ key: 'noted' }), `noted drawn: ${where}`).toBeDefined()
  for (const t of await ui.findAll({ type: 'Text' })) expect(CONTROLS.test(t.text), `${where}: ${JSON.stringify(t.text)}`).toBe(false)
  for (const b of await ui.findAll({ type: 'Button' })) expect(CONTROLS.test(String(b.props.label)), where).toBe(false)
}

// A config folder whose name holds ESC and BEL: every file label drawn from it.
const HOSTILE_DIR = '/c\u001b[31mfg\u0007'
const HOSTILE_FILE = `${HOSTILE_DIR}/CLAUDE.md`

describe('file labels, stored rules and notes are drawn clean too', () => {
  for (const surface of SURFACES) {
    test(`a hostile CLAUDE_CONFIG_DIR in the conflict label and the replaced notice on ${surface}`, async ($, on) => {
      const w = world(on, {
        env: { CLAUDE_CONFIG_DIR: HOSTILE_DIR },
        files: { [HOSTILE_FILE]: '## House rules\n\n- Use npm for installs.\n' },
        reply: verdict(PNPM, { conflictsWith: 1 }),
      })
      await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
      const ui = await $.ui.mount({ plugin: 'noted', surface, component: 'AbovePrompt', props: BAND })
      expect((await ui.find({ key: 'conflict' }))?.text).toContain('Use npm for installs.')
      await expectClean(ui, 'conflict')
      await ui.press({ key: 'replace' })
      expect(w.files[HOSTILE_FILE]).toBe(`## House rules\n\n- ${PNPM}\n`)
      await expectClean(ui, 'replaced')
      await ui.unmount()
    })

    test(`a hostile label in the vanished-conflict note on ${surface}`, async ($, on) => {
      const w = world(on, {
        env: { CLAUDE_CONFIG_DIR: HOSTILE_DIR },
        files: { [HOSTILE_FILE]: '## House rules\n\n- Use npm.\n' },
        reply: verdict(PNPM, { conflictsWith: 1 }),
      })
      await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
      const ui = await $.ui.mount({ plugin: 'noted', surface, component: 'AbovePrompt', props: BAND })
      w.files[HOSTILE_FILE] = '## House rules\n'
      await ui.press({ key: 'replace' })
      expect((await ui.find({ key: 'note' }))?.text).toContain('no longer in')
      await expectClean(ui, 'vanished note')
      await ui.unmount()
    })

    test(`a stored rule and label holding controls in the /rules list, its message and the command text on ${surface}`, async ($, on) => {
      const w = world(on, {
        env: { CLAUDE_CONFIG_DIR: HOSTILE_DIR },
        files: { [HOSTILE_FILE]: '## House rules\n\n- Keep it small.\n- Never push to main.\n' },
        store: {
          learned: [
            { id: 'a', rule: 'Keep \u001b[31mit\u001b[0m small.\u0085', scope: 'global', path: HOSTILE_FILE, addedAt: '2026-10-01T12:00:00.000Z' },
            { id: 'b', rule: 'Never push to main.', scope: 'global', path: HOSTILE_FILE, addedAt: '2026-10-02T12:00:00.000Z' },
          ],
        },
      })
      const run = (args: string) => $.command.run({ command: 'rules', args, origin: { kind: 'composer' }, presentation: PRESENTATION })
      const listed = await run('')
      expect(listed.text).toContain('1. Keep it small.')
      expect(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(listed.text ?? '')).toBe(false)

      const ui = await $.ui.mount({ plugin: 'noted', surface, component: 'AbovePrompt', props: BAND })
      expect((await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('remove-'))).toHaveLength(2)
      await expectClean(ui, '/rules list')
      await ui.press({ key: 'remove-a' })
      expect(w.files[HOSTILE_FILE]).toBe('## House rules\n\n- Never push to main.\n')
      expect((await ui.find({ key: 'message' }))?.text).toContain('Removed from')
      await expectClean(ui, '/rules after remove')

      const out = await run('remove 1')
      expect(out.text).toContain('Removed from')
      expect(CONTROLS.test(out.text ?? '')).toBe(false)
      await expectClean(ui, '/rules after command remove')
      await ui.unmount()
    })
  }
})
