// Untrusted text (commands, paths, shell output, diff lines, typed words,
// settings) never reaches a drawn tree with a control character in it: the
// engine refuses such a tree whole. Each control class, on both surfaces.

import { describe, expect, test } from 'claude-code/testing'
import type { RenderPropsOf } from 'claude-code'

import { themeById } from '../hooks/themes'
import { controlsIn, EDIT, ENGINE, start, SURFACES, TOOL_ROW, wear, world } from './setup'

const dracula = themeById('dracula')!

// `sequence`: an escape sequence, removed whole (with what it introduces);
// otherwise a bare control, drawn as U+FFFD or left to the engine.
const CLASSES: [string, string, 'sequence' | 'control'][] = [
  ['ESC (an ANSI colour)', '\u001b[31m', 'sequence'],
  ['ESC (a two-character escape)', '\u001b', 'sequence'],
  ['BEL', '\u0007', 'control'],
  ['NUL', '\u0000', 'control'],
  ['DEL', '\u007f', 'control'],
  ['C1 NEL', '\u0085', 'control'],
  ['C1 CSI', '\u009b2J', 'sequence'],
  ['C1 U+009F', '\u009f', 'control'],
]

for (const [name, control, kind] of CLASSES) {
  describe(`${name} in untrusted text`, () => {
    test('in a command: the row draws, with no control in it', async ($, on) => {
      world(on)
      await start($)
      await wear($, 'dracula')
      for (const surface of SURFACES) {
        const row: RenderPropsOf['ToolUse'] = { ...TOOL_ROW, input: { command: `ls ${control}x` } }
        const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolUse', props: row })
        expect(await ui.find({ key: 'icon' })).toBeDefined()
        expect(controlsIn(await ui.drawn())).toEqual([])
        await ui.unmount()
      }
    })

    test('in a path: the diff card names it cleaned', async ($, on) => {
      world(on, { root: '/work/alpha' })
      await start($)
      await wear($, 'dracula')
      for (const surface of SURFACES) {
        const output = { ...EDIT, filePath: `/work/alpha/src/a${control}b.ts` }
        const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolResult', props: { tool_use_id: 't', tool: 'Edit', output, isErrored: false } })
        const summary = await ui.find({ key: 'summary' })
        expect(summary?.text).toMatch(/^ Updated src\/a(\uFFFD)?b?\.ts {2}\+1 {2}-1 $/)
        expect(controlsIn(await ui.drawn())).toEqual([])
        await ui.unmount()
      }
    })

    test('in shell output: a clean card, or the engine own drawing, never a control', async ($, on) => {
      world(on)
      await start($)
      await wear($, 'dracula')
      for (const surface of SURFACES) {
        const output = { stdout: `ok${control}done\n`, stderr: '', interrupted: false }
        const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolResult', props: { tool_use_id: 't', tool: 'Bash', output, isErrored: false } })
        const drawn = await ui.drawn()
        if (kind === 'sequence') {
          // An escape sequence is dropped: the theme colours the text instead.
          expect((await ui.find({ type: 'Text', text: /^ ok.*one $/ }))?.props).toEqual({ color: dracula.palette.text, backgroundColor: dracula.palette.bg })
        } else {
          expect(drawn).toEqual(ENGINE) // a bare control means it is not plain text
        }
        expect(controlsIn(drawn)).toEqual([])
        await ui.unmount()
      }
    })

    test('in a diff line: drawn as U+FFFD (binary NUL content is the engine own)', async ($, on) => {
      world(on)
      await start($)
      await wear($, 'dracula')
      for (const surface of SURFACES) {
        const output = { ...EDIT, structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-x = 1', `+x = "${control}"`] }] }
        const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'ToolResult', props: { tool_use_id: 't', tool: 'Edit', output, isErrored: false } })
        const drawn = await ui.drawn()
        if (control === '\u0000') expect(drawn).toEqual(ENGINE)
        else expect(await ui.find({ type: 'Text', text: /^1 \+ x = "�?(2J)?"$/ })).toBeDefined()
        expect(controlsIn(drawn)).toEqual([])
        await ui.unmount()
      }
    })

    test('in the turn word and a typed /wear word', async ($, on) => {
      world(on)
      await start($)
      await wear($, 'dracula')
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'TurnDuration', props: { word: `Baked${control}`, durationMs: 3000 } })
        expect(controlsIn(await ui.drawn())).toEqual([])
        await ui.unmount()
      }
      const reply = await wear($, `neon${control}`)
      expect(reply).toContain('No theme called "neon')
      expect(controlsIn(reply)).toEqual([])
    })

    test('in a setting: the list names it cleaned', { options: { dayStarts: `7${control}` } }, async ($, on) => {
      world(on)
      await start($)
      const text = await wear($, '')
      expect(text).toContain('Setting: dayStarts "7')
      expect(controlsIn(text)).toEqual([])
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'CommandOutput', props: { command: 'wear', args: '', text, isErrored: false } })
        expect(await ui.find({ type: 'Text', text: /Setting: dayStarts/ })).toBeDefined()
        expect(controlsIn(await ui.drawn())).toEqual([])
        await ui.unmount()
      }
    })
  })
}
