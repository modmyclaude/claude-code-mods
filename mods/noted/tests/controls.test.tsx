// Control characters (MM-050): the engine refuses a whole drawn tree holding a
// C0 or C1 control and draws its own, hiding this band and every band beneath.
// Rules read from CLAUDE.md files and the model's own rule are untrusted.

import { describe, expect, test } from 'claude-code/testing'

import { clean } from '../hooks/text'
import { BAND, GLOBAL, PROJECT, PROMPT_FROM_PERSON, SURFACES, verdict, world } from './world'

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
