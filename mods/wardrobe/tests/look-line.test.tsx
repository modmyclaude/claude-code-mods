// The look stays visible after the switch band goes: `wearing <theme>` in the
// prompt footer, the theme's mark at the end of the terminal's hint line, and
// one verb per turn on the spinner and the closing line, picked when the turn
// starts and held until the next one (a word that changes mid-turn reads as
// flashing on the desktop). The engine's own words are never hidden: a status
// message, a desktop step, and the two accessibility themes keep theirs.

import { describe, expect, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import { pickVerb, themeById, VERBS } from '../hooks/themes'
import { ENGINE, start, SURFACES, wear, world } from './setup'

const halloween = themeById('halloween')!
const SPIN: RenderPropsOf['Spinner'] = { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' }
const HINT: RenderPropsOf['PromptHint'] = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

const ENGINE_BENEATH = {
  name: 'engine-beneath',
  tier: 'append' as const,
  register(on: On) {
    on('ui.render', { component: 'SessionMode' }, () => ({ type: 'engine', ref: 0 }) as never)
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

describe('the prompt footer names the look', () => {
  test('wearing <theme> follows the engine\'s mode labels, separated when there are any, on both surfaces', { plugins: [ENGINE_BENEATH] }, async ($, on) => {
    world(on, { surfaces: ['terminal', 'desktop'] })
    await start($)
    await wear($, 'halloween')
    for (const surface of SURFACES) {
      const some = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'SessionMode', props: { modes: ['focus'] } })
      expect((await some.find({ key: 'wearing' }))?.text, surface).toBe(` · ${halloween.mark} wearing halloween`)
      expect(engineNodeConcealers(await some.drawn()), surface).toEqual([[]])
      await some.unmount()
      const none = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'SessionMode', props: { modes: [] } })
      expect((await none.find({ key: 'wearing' }))?.text, surface).toBe(`${halloween.mark} wearing halloween`)
      await none.unmount()
    }
  })

  test('with no theme worn the footer is the engine\'s own', { plugins: [ENGINE_BENEATH] }, async ($, on) => {
    world(on, { surfaces: ['terminal', 'desktop'] })
    await start($)
    const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } })
    expect(await ui.drawn()).toEqual(ENGINE)
    await ui.unmount()
  })
})

describe('the hint line', () => {
  test('is the engine\'s own on both surfaces: the footer label already names the look', async ($, on) => {
    const w = world(on, { surfaces: ['terminal', 'desktop'] })
    await start($)
    await wear($, 'halloween')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface, component: 'PromptHint', props: HINT })
      expect(await ui.drawn(), surface).toEqual(ENGINE)
      expect(w.drawnByEngine.at(-1), surface).toEqual(HINT)
      await ui.unmount()
    }
  })
})

describe('one verb per turn', () => {
  test('pickVerb answers the same verb for the same turn, from the theme\'s own list, and none for the accessibility themes', () => {
    const a = pickVerb('halloween', 'turn-1')
    expect(a).not.toBeNull()
    expect(VERBS.halloween).toContainEqual(a)
    expect(pickVerb('halloween', 'turn-1')).toEqual(a)
    expect(pickVerb('high-contrast', 'turn-1')).toBeNull()
    expect(pickVerb('colorblind', 'turn-1')).toBeNull()
    for (const [id, verbs] of Object.entries(VERBS)) {
      expect(themeById(id), id).toBeDefined()
      for (const [present, past] of verbs) expect(`${present} ${past}`, id).toMatch(/^[A-Z][a-z]+ing [A-Z][a-z]+(ed|ied|t)$/)
    }
  })

  test('the terminal spinner says the verb for the whole turn, then the closing line says its past tense', async ($, on) => {
    const w = world(on, { surfaces: ['terminal', 'desktop'] })
    await start($)
    await wear($, 'halloween')
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    const [present, past] = pickVerb('halloween', 'turn-1')!
    for (let i = 0; i < 2; i++) {
      const ui = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'Spinner', props: SPIN })
      await ui.drawn()
      expect(w.drawnByEngine.at(-1)).toMatchObject({ word: present, suffix: halloween.spinnerSuffix })
      await ui.unmount()
    }
    const line = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 3000 } })
    expect((await line.find({ key: 'turn' }))?.text).toBe(` ${halloween.mark} ${past} for 3s `)
    await line.unmount()
  })

  test('the engine\'s own words stand: a status message, a desktop step, and a theme with no verbs', async ($, on) => {
    const w = world(on, { surfaces: ['terminal', 'desktop'] })
    await start($)
    await wear($, 'halloween')
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    const [present] = pickVerb('halloween', 'turn-1')!
    const message = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'Spinner', props: { ...SPIN, message: 'Running tests...' } })
    await message.drawn()
    expect(w.drawnByEngine.at(-1)).toMatchObject({ word: 'Sauteing', message: 'Running tests...' })
    await message.unmount()
    const step = await $.ui.mount({ plugin: 'wardrobe', surface: 'desktop', component: 'Spinner', props: { ...SPIN, word: 'Creating notes.md' } })
    await step.drawn()
    expect(w.drawnByEngine.at(-1)).toMatchObject({ word: 'Creating notes.md' })
    await step.unmount()
    const idle = await $.ui.mount({ plugin: 'wardrobe', surface: 'desktop', component: 'Spinner', props: { ...SPIN, word: 'Working' } })
    await idle.drawn()
    expect(w.drawnByEngine.at(-1)).toMatchObject({ word: present })
    await idle.unmount()
    await wear($, 'high-contrast')
    await $.turn.start({ text: 'go', turnId: 'turn-2' })
    const plain = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'Spinner', props: SPIN })
    await plain.drawn()
    expect(w.drawnByEngine.at(-1)).toMatchObject({ word: 'Sauteing' })
    await plain.unmount()
  })

  test('a new turn picks again from the theme worn then; the theme worn when the turn started is the one that counts', async ($, on) => {
    const w = world(on, { surfaces: ['terminal'] })
    await start($)
    await wear($, 'halloween')
    await $.turn.start({ text: 'go', turnId: 'turn-7' })
    await wear($, 'christmas') // a switch mid-turn: the word must not change under the person
    const mid = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'Spinner', props: SPIN })
    await mid.drawn()
    expect(w.drawnByEngine.at(-1)).toMatchObject({ word: pickVerb('halloween', 'turn-7')![0] })
    await mid.unmount()
    await $.turn.start({ text: 'go', turnId: 'turn-8' })
    const next = await $.ui.mount({ plugin: 'wardrobe', surface: 'terminal', component: 'Spinner', props: SPIN })
    await next.drawn()
    expect(w.drawnByEngine.at(-1)).toMatchObject({ word: pickVerb('christmas', 'turn-8')![0] })
    await next.unmount()
  })
})
