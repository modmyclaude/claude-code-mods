// The consent and file-safety guards a review asked to see tested: each
// test here fails if its guard is removed.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { BAND, GLOBAL, PRESENTATION, PROJECT, PROMPT_FROM_PERSON, SURFACES, verdict, world } from './world'

const PNPM = 'Use pnpm, not npm, in this repo.'
type Surface = (typeof SURFACES)[number]

const mount = ($: Engine, surface: Surface = 'terminal') =>
  $.ui.mount({ plugin: 'noted', surface, component: 'AbovePrompt', props: BAND })

/** The only hotkeys the band may carry: none of them writes a file. */
const SAFE_HOTKEYS: Record<string, string> = { edit: 'e', skip: 's', ok: 'o', done: 'd' }

/** Buttons that only dismiss: the one the focus ring may start on. */
const DISMISSERS = new Set(['skip', 'ok', 'done'])

/**
 * Every Button drawn: a hotkey only where SAFE_HOTKEYS allows it, never on a
 * writer; `autoFocus` only on a dismissing button, and on the one drawn.
 */
async function expectSafeHotkeys(ui: Mounted<Surface, 'AbovePrompt'>) {
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.length).toBeGreaterThan(0)
  for (const b of buttons) {
    const hotkey = b.props.hotkey
    if (hotkey !== undefined) expect(SAFE_HOTKEYS[b.key ?? ''], `hotkey ${String(hotkey)} on ${b.key}`).toBe(hotkey)
    if (b.props.autoFocus === true) expect(DISMISSERS.has(b.key ?? ''), `autoFocus on ${b.key}`).toBe(true)
  }
  const dismisser = buttons.find(b => DISMISSERS.has(b.key ?? ''))
  if (dismisser) expect(dismisser.props.autoFocus, `focus starts on ${dismisser.key}`).toBe(true)
  return buttons
}

describe('no keystroke writes a CLAUDE.md', () => {
  for (const surface of SURFACES) {
    test(`writers are click-only, and every hotkeyed button writes nothing, on ${surface}`, async ($, on) => {
      let next = verdict(PNPM)
      const w = world(on, { files: { [GLOBAL]: '## House rules\n\n- Use npm for installs.\n' }, reply: () => next })
      const ui = await mount($, surface)

      // The review's repro: click Edit (the band takes the keyboard), Enter to
      // keep the wording; the proposal is back in a band that still has focus.
      await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
      await ui.redraw()
      await ui.press({ key: 'edit' })
      await expectSafeHotkeys(ui)
      await ui.input({ key: 'rule-input', text: 'Use pnpm for installs.' })
      for (const key of ['save-project', 'save-global']) {
        expect((await ui.find({ type: 'Button', key }))?.props.hotkey).toBeUndefined()
      }
      await expectSafeHotkeys(ui)
      await ui.press({ key: 'skip' }) // s
      expect(w.writes).toEqual([])

      // A conflict: Replace old rule is click-only too.
      next = verdict(PNPM, { conflictsWith: 1 })
      await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
      await ui.redraw()
      expect((await ui.find({ type: 'Button', key: 'replace' }))?.props.hotkey).toBeUndefined()
      await expectSafeHotkeys(ui)
      await ui.press({ key: 'skip' })
      expect(w.writes).toEqual([])

      // A notice (o) and the /rules list (Remove click-only, d) write nothing either.
      next = verdict('Never push to main.')
      await $.prompt.submit({ text: 'never push to main', ...PROMPT_FROM_PERSON })
      await ui.redraw()
      await ui.press({ key: 'save-project' }) // a click: the one write in this test
      expect(w.writes).toEqual([PROJECT])
      await expectSafeHotkeys(ui)
      await ui.press({ key: 'ok' })
      await $.command.run({ command: 'rules', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
      await ui.redraw()
      const listed = await expectSafeHotkeys(ui)
      for (const b of listed.filter(b => b.key?.startsWith('remove-'))) expect(b.props.hotkey).toBeUndefined()
      await ui.press({ key: 'done' })
      expect(w.writes).toEqual([PROJECT])
    })
  }
})

describe('/rules remove acts only for the person typing', () => {
  const others = [
    { kind: 'peer' },
    { kind: 'channel', server: 'slack' },
    { kind: 'plugin', name: 'other' },
    { kind: 'task-notification' },
    { kind: 'scheduled-trigger' },
  ] as const
  for (const origin of others) {
    test(`refused from ${origin.kind}`, async ($, on) => {
      const w = world(on, { reply: verdict('Never push to main.') })
      await $.prompt.submit({ text: 'never push to main', ...PROMPT_FROM_PERSON })
      await (await mount($)).press({ key: 'save-global' })

      const out = await $.command.run({ command: 'rules', args: 'remove 1', origin, presentation: PRESENTATION })
      expect(out.text).toContain('only when you type it')
      expect(w.writes).toEqual([GLOBAL])
      expect(w.files[GLOBAL]).toContain('- Never push to main.')
      // Listing stays open: it writes nothing.
      const listed = await $.command.run({ command: 'rules', args: '', origin, presentation: PRESENTATION })
      expect(listed.text).toContain('1. Never push to main.')
    })
  }
  for (const origin of [{ kind: 'composer' }, { kind: 'bridge' }, { kind: 'sdk' }] as const) {
    test(`done when typed (${origin.kind})`, async ($, on) => {
      const w = world(on, { reply: verdict('Never push to main.') })
      await $.prompt.submit({ text: 'never push to main', ...PROMPT_FROM_PERSON })
      await (await mount($)).press({ key: 'save-global' })

      const out = await $.command.run({ command: 'rules', args: 'remove 1', origin, presentation: PRESENTATION })
      expect(out.text).toContain('Removed from ~/.claude/CLAUDE.md')
      expect(w.files[GLOBAL]).toBe('## House rules\n\n')
    })
  }
})

describe('file safety', () => {
  test('Save re-checks the file: a rule added meanwhile is not added twice', async ($, on) => {
    const w = world(on, { files: { [PROJECT]: '# App\n' }, reply: verdict(PNPM) })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    w.files[PROJECT] = `# App\n\n## House rules\n\n- ${PNPM}\n` // another session saved it
    const ui = await mount($)
    await ui.press({ key: 'save-project' })
    expect(w.writes).toEqual([])
    expect((await ui.find({ key: 'notice' }))?.text).toContain('already a rule in ./CLAUDE.md')
  })

  test('a file with bytes that are not UTF-8 is never written', async ($, on) => {
    const w = world(on, { files: { [PROJECT]: '# App \uFFFD\n' }, reply: verdict(PNPM) })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    const ui = await mount($)
    await ui.press({ key: 'save-project' })
    expect(w.writes).toEqual([])
    expect((await ui.find({ key: 'notice' }))?.text).toContain('not UTF-8')
  })

  test('a code fence that never closes is not written into', async ($, on) => {
    const before = '# App\n\n## House rules\n\n- Keep it small.\n\n```sh\nmake\n'
    const w = world(on, { files: { [PROJECT]: before }, reply: verdict(PNPM) })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    const ui = await mount($)
    await ui.press({ key: 'save-project' })
    // The section ends before the fence opens, so the rule still goes in safely.
    expect(w.files[PROJECT]).toBe(before.replace('- Keep it small.\n', `- Keep it small.\n- ${PNPM}\n`))

    w.files[PROJECT] = '```md\n# App\n'
    w.writes.length = 0
    await $.prompt.submit({ text: "don't add comments", ...PROMPT_FROM_PERSON })
    await ui.redraw()
    await ui.press({ key: 'save-project' })
    expect(w.writes).toEqual([])
    expect((await ui.find({ key: 'notice' }))?.text).toContain('code fence that never closes')
  })

  test('/rules keeps a rule whose file is unreadable for now', async ($, on) => {
    const w = world(on, { reply: verdict('Never push to main.') })
    await $.prompt.submit({ text: 'never push to main', ...PROMPT_FROM_PERSON })
    await (await mount($)).press({ key: 'save-global' })
    const saved = w.files[GLOBAL] ?? ''
    w.files[GLOBAL] = `\uFFFD${saved}` // unreadable for a moment
    const run = () => $.command.run({ command: 'rules', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect((await run()).text).toContain('1. Never push to main.')
    w.files[GLOBAL] = saved
    expect((await run()).text).toContain('1. Never push to main.')
  })

  test('two quick presses write once', async ($, on) => {
    const w = world(on, { files: { [PROJECT]: '# App\n' }, reply: verdict(PNPM) })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    const ui = await mount($)
    await Promise.all([ui.press({ key: 'save-project' }), ui.press({ key: 'save-project' }).catch(() => undefined)])
    expect(w.writes).toEqual([PROJECT])
    expect(w.files[PROJECT]).toBe(`# App\n\n## House rules\n\n- ${PNPM}\n`)
  })

  test('Save globally honours CLAUDE_CONFIG_DIR', async ($, on) => {
    const w = world(on, { reply: verdict(PNPM), env: { CLAUDE_CONFIG_DIR: '/cfg/claude/' } })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    await (await mount($)).press({ key: 'save-global' })
    expect(w.writes).toEqual(['/cfg/claude/CLAUDE.md'])
  })

  test('the global file follows USERPROFILE where it is set (Windows)', async ($, on) => {
    const w = world(on, { reply: verdict(PNPM), env: { USERPROFILE: 'C:\\Users\\me' } })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    await (await mount($)).press({ key: 'save-global' })
    // (The kit makes a path absolute against the working directory before the
    // hook beneath sees it, so on this host only its end is the plugin's.)
    expect(w.writes).toHaveLength(1)
    expect(w.writes[0]).toEndWith('C:\\Users\\me/.claude/CLAUDE.md')
  })
})

describe('learning', () => {
  test('a prompt dropped beneath is not learned from', async ($, on) => {
    const w = world(on, { reply: verdict(PNPM), dropPrompts: 'blocked' })
    const entered = await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    expect(entered.drop).toBe('blocked')
    expect(w.calls).toHaveLength(0)
  })

  test('the context is the reply the correction answered, not the new turn', async ($, on) => {
    const w = world(on, {
      reply: verdict(PNPM),
      messages: [
        { role: 'assistant', text: 'I ran npm install.', toolUses: [] },
        { role: 'user', text: 'no, use pnpm', toolUses: [] },
        { role: 'assistant', text: 'Switching to pnpm now.', toolUses: [] },
      ],
    })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    expect(w.calls[0]?.prompt).toContain('I ran npm install.')
    expect(w.calls[0]?.prompt).not.toContain('Switching to pnpm now.')
  })

  test('a provider without the model says so once, visibly', async ($, on) => {
    const w = world(on, { reply: null, modelError: 'model_not_found' })
    await $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    await $.prompt.submit({ text: "don't add comments", ...PROMPT_FROM_PERSON })
    expect(w.calls).toHaveLength(2)
    const said = w.logs.flatMap((l, i) => (l.includes('haiku model is not available here') ? [w.sinks[i]] : []))
    expect(said).toEqual(['transcript']) // once, and where the person sees it
  })

  test('an older correction answering late never replaces a newer one', async ($, on) => {
    let slow = true
    const w = world(on, {
      reply: async () => {
        if (!slow) return verdict('Never push to main.')
        slow = false
        await w.clock.sleep(1000)
        return verdict(PNPM)
      },
    })
    const older = $.prompt.submit({ text: 'no, use pnpm', ...PROMPT_FROM_PERSON })
    await w.clock.settle() // the older call is now waiting on the model
    await $.prompt.submit({ text: 'never push to main', ...PROMPT_FROM_PERSON })
    await w.clock.advance(1000)
    await older
    expect(w.calls).toHaveLength(2)
    const ui = await mount($)
    expect((await ui.find({ key: 'rule' }))?.text).toBe('Never push to main.')
  })
})
