// The band through its real wiring: turns start and end as a session raises
// them, the clock moves, and the band and spinner are drawn on the terminal
// and the desktop alike.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Mounted, Plugin } from 'claude-code/testing'

import { barWidth } from '../hooks/draw'
import { DAY_MS, SURFACES, T0, lateTicks, neighbour, timerSpy, world } from './world'
import type { World } from './world'

type Ui = Mounted<'terminal' | 'desktop', 'AbovePrompt'>

/** The step's words: the band's cue, or on the desktop the guide's own (its alt carries them). */
/** The step's words as text; on the desktop they live inside the guide, which reads as 'guide'. */
const cue = async (ui: Ui) => (await ui.find({ key: 'sw-cue' }))?.text ?? ((await ui.find({ type: 'Svg' })) !== undefined ? 'guide' : undefined)
const caption = async (ui: Ui) => (await ui.find({ key: 'sw-caption' }))?.text
/** The compact row's words: its text, or on the desktop the guide's (its alt carries the cue). */
const compactWords = async (ui: Ui) => (await ui.find({ key: 'sw-compact' }))?.text ?? ''

const fold = async (ui: Ui) => ui.find({ key: 'sw-fold' })
const isShown = async (ui: Ui) => (await ui.find({ key: 'second-wind' })) !== undefined

/** Every element of a drawn tree, depth first. */
function walk(node: unknown, out: { type: string; props: Record<string, unknown> }[] = []) {
  if (typeof node !== 'object' || node === null) return out
  const el = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
  if (typeof el.type === 'string') out.push({ type: el.type, props: el.props ?? {} })
  for (const c of el.children ?? []) walk(c, out)
  return out
}

describe('when it shows', () => {
  test('a quick turn never shows the band and never ticks', { plugins: [timerSpy] }, async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(2900)
    for (const surface of SURFACES) {
      const ui = await w.band($, surface)
      expect(await isShown(ui)).toBe(false)
      await ui.unmount()
    }
    await w.complete($)
    await w.clock.advance(60_000)
    const ui = await w.band($, 'terminal')
    expect(await isShown(ui)).toBe(false)
    expect(w.timers().every).toBe(0)
    expect(w.store.has('stats')).toBe(false)
  })

  test('after the delay it opens with a physiological sigh, on both surfaces', async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000)
    for (const surface of SURFACES) {
      const ui = await w.band($, surface)
      expect(await cue(ui)).toBe(surface === 'desktop' ? 'guide' : 'Breathe in 4')
      // The desktop's label holds for the whole span, which runs on into the paced pattern.
      expect(await caption(ui)).toBe(surface === 'desktop' ? 'physiological sigh, then slow paced breathing' : 'physiological sigh')
      // What was beneath (the engine's own band) is still drawn under ours.
      expect(await ui.find({ key: 'engine-band' })).toBeDefined()
      await ui.unmount()
    }
    const term = await w.band($, 'terminal')
    expect((await term.find({ key: 'sw-shape' }))?.text.length).toBe(barWidth(100))
    const desk = await w.band($, 'desktop')
    const svg = await desk.find({ type: 'Svg' })
    // An image, not a frame: the desktop reloads a frame on every band redraw (seen live).
    // A frame: the desktop draws an image still, so only a frame runs the keyframes (seen live).
    expect(svg?.props.isInteractive).toBe(true)
    // Bolt breathing on the drawing's own clock: one stable markup, eased keyframes, reduced motion honoured.
    expect(String(svg?.props.source)).toContain('@keyframes h0{')
    expect(String(svg?.props.source)).toContain('cubic-bezier(.45,0,.55,1)')
    expect(String(svg?.props.source)).toContain('prefers-reduced-motion')
    expect(Number(svg?.props.height)).toBeLessThanOrEqual(72)
    // The words are text beside the guide, never inside it: a word change must not touch the drawing.
    // The words live inside the drawing; beside it, only what holds still for the span.
    expect(await cue(desk)).toBe('guide')
    expect(String(svg?.props.source)).toContain('>Breathe in</text>')
    expect(await desk.find({ key: 'sw-shape' })).toBeUndefined()
  })

  test('the delay is a setting', { options: { delaySeconds: 10 } }, async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(9900)
    const ui = await w.band($, 'terminal')
    expect(await isShown(ui)).toBe(false)
    await w.clock.advance(100)
    expect(await cue(ui)).toBe('Breathe in 4')
  })

  test('it escalates: sigh, slow paced breathing, an eye rest past 60 s, then breathing again', { options: { motion: 'still' } }, async ($, on) => {
    const w = world(on)
    await w.start($)
    const ui = await w.band($, 'terminal')
    const at = async (turnMs: number) => {
      await w.clock.set(T0 + turnMs)
      return cue(ui)
    }
    expect(await at(3000 + 4500)).toBe('Sip in 2')
    expect(await at(3000 + 9000)).toBe('Out 6')
    expect(await at(3000 + 15000)).toBe('Breathe in 6')
    expect(await caption(ui)).toBe('slow paced breathing · 1 breath')
    expect(await at(3000 + 58_500)).toBe('Out 1')
    expect(await at(3000 + 59_000)).toBe('Look at something 20 feet away · 20')
    expect(await caption(ui)).toBe('20-20-20 eye rest')
    expect(await at(3000 + 79_000)).toBe('Breathe in 6')
  })

  test('box breathing reads Hold; a stretch stands in when eye rest is off', { options: { motion: 'still', pattern: 'box', eyeRest: false } }, async ($, on) => {
    const w = world(on)
    await w.start($)
    const ui = await w.band($, 'desktop')
    await w.clock.set(T0 + 3000 + 15000 + 4000)
    expect(await cue(ui)).toBe('Hold 4')
    expect(await caption(ui)).toBe('box breathing · 1 breath')
    await w.clock.set(T0 + 3000 + 63_000)
    expect(await cue(ui)).toBe('Roll your shoulders back, slowly · 20')
  })
})

describe('following only the main conversation', () => {
  test('a subagent finishing mid-breath leaves the phase and the clock alone', { plugins: [timerSpy] }, async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000 + 2000)
    for (const surface of SURFACES) {
      const ui = await w.band($, surface)
      expect(await cue(ui)).toBe(surface === 'desktop' ? 'guide' : 'Breathe in 2')
      await ui.unmount()
    }
    const ui = await w.band($, 'terminal')
    const shape = (await ui.find({ key: 'sw-shape' }))?.text
    const r = await w.complete($, { agentId: 'agent-7', answer: 'subagent report' })
    expect(r.text).toBe('subagent report')
    await w.clock.settle()
    expect(await cue(ui)).toBe('Breathe in 2')
    expect((await ui.find({ key: 'sw-shape' }))?.text).toBe(shape)
    // The schedule runs on from the same zero: 5 s in is the sip, not a restart or a finish.
    await w.clock.advance(3000)
    expect(await cue(ui)).toBe('Sip in 1')
    expect(await fold(ui)).toBeUndefined()
    expect(w.store.has('stats')).toBe(false)
  })

  test('a subagent finishing before the band shows does not cancel it', async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(1000)
    await w.complete($, { agentId: 'agent-1' })
    await w.clock.advance(2000)
    const ui = await w.band($, 'terminal')
    expect(await cue(ui)).toBe('Breathe in 4')
  })

  test('a run whose turn.complete never came stops ticking, and the next turn starts fresh and counts only itself', { plugins: [timerSpy], options: { motion: 'still' } }, async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000 + 5000)
    // The turn ended, but its turn.complete never reached the mod.
    const idle = await w.band($, 'terminal', { isWorking: false })
    expect(await isShown(idle)).toBe(false)
    const ticks = w.timers().every
    await w.clock.advance(1_800_000) // half an hour idle
    expect(w.timers().every).toBe(ticks)
    await idle.unmount()
    await w.start($)
    const ui = await w.band($, 'terminal')
    await w.clock.advance(1500)
    expect(await isShown(ui)).toBe(false) // a fresh run waits its own delay
    await w.clock.advance(1500)
    expect(await cue(ui)).toBe('Breathe in 4')
    await w.clock.advance(2000)
    await w.complete($)
    await w.clock.advance(15_000)
    const stats = w.store.get('stats') as { today: { breaths: number; eyeRests: number; stretches: number }; longTurns: number }
    expect(stats.today).toEqual({ breaths: 1, eyeRests: 0, stretches: 0, moves: 0 })
    expect(stats.longTurns).toBe(0)
  })

  test('a turn.complete for another turn drops the run uncounted', { plugins: [timerSpy] }, async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000 + 20_000)
    const ui = await w.band($, 'terminal')
    expect(await isShown(ui)).toBe(true)
    await w.complete($, { turnId: 'turn-0' })
    await w.clock.settle()
    expect(await isShown(ui)).toBe(false)
    const ticks = w.timers().all
    await w.clock.advance(60_000)
    expect(w.timers().all).toBe(ticks)
    expect(w.store.has('stats')).toBe(false)
  })
})

describe('pace', () => {
  test('late ticks do not slow the breath: it reads the wall clock', { plugins: [lateTicks] }, async ($, on) => {
    const w = world(on)
    await w.start($)
    const ui = await w.band($, 'terminal')
    await w.clock.set(T0 + 3000 + 6500)
    expect(await cue(ui)).toBe('Out 9')
    await w.clock.set(T0 + 3000 + 15_000 + 2850)
    expect(await cue(ui)).toBe('Breathe in 3')
  })
})

describe('the soft finish', () => {
  test('mid-inhale: an exhale, then the fold line, which fades and clears; then no timer runs', { plugins: [timerSpy] }, async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000 + 2000)
    const ui = await w.band($, 'terminal')
    const r = await w.complete($, { answer: 'Here is the fix.' })
    expect(r.text).toBe('Here is the fix.')
    await w.clock.settle()
    expect(await cue(ui)).toBe('Out 4')
    expect(await caption(ui)).toBe('1 breath')
    await w.clock.advance(3375)
    const line = await fold(ui)
    expect(line?.text).toBe('1 breath while Claude worked · 1 today · 1-day streak')
    const desk = await w.band($, 'desktop')
    expect((await fold(desk))?.text).toBe(line?.text)
    const ticksAtFold = w.timers().every
    await w.clock.advance(3000)
    const text = await ui.find({ type: 'Text', text: /while Claude worked/ })
    expect(text?.props.dimColor).toBe(true)
    await w.clock.advance(3000)
    expect(await isShown(ui)).toBe(false)
    expect(await ui.find({ key: 'engine-band' })).toBeDefined()
    // No ticking while the line showed, and nothing at all once idle.
    expect(w.timers().every).toBe(ticksAtFold)
    const idle = w.timers().all
    await w.clock.advance(600_000)
    expect(w.timers().all).toBe(idle)
  })

  test('mid-exhale: the exhale runs out its own time', async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000 + 10_500)
    const ui = await w.band($, 'terminal')
    expect(await cue(ui)).toBe('Out 5')
    await w.complete($)
    await w.clock.settle()
    expect(await cue(ui)).toBe('Out 5')
    await w.clock.advance(4400)
    expect(await cue(ui)).toBe('Out 1')
    await w.clock.advance(200)
    expect((await fold(ui))?.text).toStartWith('1 breath while Claude worked')
  })

  test('interrupted: it folds at once with the breaths already taken', async ($, on) => {
    const w = world(on)
    await w.start($)
    const ui = await w.band($, 'terminal')
    await w.clock.set(T0 + 3000 + 17_750)
    await w.complete($, { reason: 'aborted' })
    await w.clock.settle()
    expect((await fold(ui))?.text).toStartWith('1 breath while Claude worked')
  })

  test('an answer before the first breath was under way leaves no line and no count', async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000 + 400)
    const ui = await w.band($, 'terminal')
    expect(await isShown(ui)).toBe(true)
    await w.complete($)
    await w.clock.settle()
    expect(await isShown(ui)).toBe(false)
    expect(w.store.has('stats')).toBe(false)
  })
})

describe('counts and streak', () => {
  test('counts add up per day and the streak grows across days', { options: { motion: 'still' } }, async ($, on) => {
    const w = world(on)
    const ui = await w.band($, 'terminal')
    for (const [day, want] of [[0, '2 breaths while Claude worked · 2 today · 1-day streak'], [1, '2 breaths while Claude worked · 2 today · 2-day streak']] as const) {
      await w.clock.set(T0 + day * DAY_MS)
      await w.start($)
      await w.clock.set(T0 + day * DAY_MS + 3000 + 26_000) // the sigh and one slow breath are out
      await w.complete($)
      await w.clock.settle()
      expect((await fold(ui))?.text).toBe(want)
      await w.clock.advance(10_000)
    }
    // The store keeps counts and dates, nothing else.
    const stats = w.store.get('stats') as Record<string, unknown>
    expect(Object.keys(stats).sort()).toEqual(['all', 'day', 'longTurns', 'streak', 'streakDay', 'today', 'v'])
    expect(stats.all).toEqual({ breaths: 4, eyeRests: 0, stretches: 0, moves: 0 })
  })

  test('if the store fails, the band still breathes and the fold says this turn', async ($, on) => {
    const w = world(on, { storeFails: true })
    await w.start($)
    await w.clock.advance(3000 + 2000)
    const ui = await w.band($, 'terminal')
    expect(await cue(ui)).toBe('Breathe in 2')
    await w.complete($)
    await w.clock.advance(3375)
    expect((await fold(ui))?.text).toBe('1 breath while Claude worked')
  })
})

describe('typing', () => {
  test('a draft in the prompt line makes the band one quiet line on both surfaces, with no prompt.edit at all', async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000 + 2000)
    for (const surface of SURFACES) {
      const ui = await w.band($, surface)
      expect(await ui.find({ key: 'sw-breath' })).toBeDefined()
      const draft = await w.hint($, surface, true)
      // The engine's own line is drawn as it was.
      expect((await draft.find({ key: 'engine-hint' }))?.text).toBe('esc to interrupt')
      await w.clock.settle()
      expect(await ui.find({ key: 'sw-breath' })).toBeUndefined()
      expect(await ui.find({ key: 'sw-compact' })).toBeDefined()
      // The desktop's line holds for the span (a countdown would draw the band again).
      const words = surface === 'desktop' ? 'physiological sigh' : 'Breathe in 2'
      expect(await compactWords(ui)).toContain(words)
      expect((await ui.findAll({ type: 'Text' })).filter(t => t.text.includes(words)).every(t => t.props.dimColor === true)).toBe(true)
      await draft.unmount()
      const empty = await w.hint($, surface, false) // however the box was emptied
      await w.clock.settle()
      expect(await ui.find({ key: 'sw-breath' })).toBeDefined()
      await empty.unmount()
      await ui.unmount()
    }
    expect(w.rec.edits).toEqual([])
  })

  test('in the terminal each edit also shrinks it at once and passes through untouched', async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000 + 2000)
    const term = await w.band($, 'terminal')
    const box = await w.edit($, '', 0, 0, 'f')
    expect(box).toEqual({ text: 'f', cursor: 1 })
    expect(w.rec.edits.at(-1)).toEqual({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'f' })
    expect((await term.find({ key: 'sw-compact' }))?.text).toContain('Breathe in 2')
    await w.edit($, 'fix', 0, 3, '') // cleared
    expect(await term.find({ key: 'sw-breath' })).toBeDefined()
    await term.unmount()
    // Submitting ends typing too.
    const ui = await w.band($, 'terminal')
    await w.edit($, '', 0, 0, 'next')
    expect(await ui.find({ key: 'sw-compact' })).toBeDefined()
    await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
    await w.clock.settle()
    expect(await ui.find({ key: 'sw-breath' })).toBeDefined()
  })

  test('an edit never waits on the mod, even when its own write is slow', { options: { motion: 'still' } }, async ($, on) => {
    const w = world(on)
    // Hold the mod's typing write until the clock moves 10 s.
    on('state.set', async ($, e, next) => {
      if (e.key === 'isTyping') await w.clock.sleep(10_000)
      return next(e)
    })
    await w.start($)
    await w.clock.advance(3000)
    const ui = await w.band($, 'terminal')
    const box = await w.edit($, 'hel', 3, 3, 'lo') // resolves with the clock standing still
    expect(box).toEqual({ text: 'hello', cursor: 5 })
    expect(await ui.find({ key: 'sw-compact' })).toBeUndefined() // the write is still held
    await w.clock.advance(10_000)
    expect(await ui.find({ key: 'sw-compact' })).toBeDefined()
  })
})

describe('the spinner', () => {
  test('carries the phase only where the engine shows nothing of its own', async ($, on) => {
    const w = world(on)
    await w.start($)
    const spin = async (surface: 'terminal' | 'desktop', over: { word?: string; message?: string | null }) => {
      const ui = await w.spinner($, surface, over)
      const text = (await ui.find({ key: 'engine-spinner' }))?.text
      const word = (await ui.find({ key: 'engine-spinner-word' }))?.text
      await ui.unmount()
      // Left alone means left alone: the word reaches the engine as it was.
      if (over.message != null || (surface === 'desktop' && over.word !== 'Working')) expect(word).toBe(over.word ?? 'Sauteing')
      return text
    }
    expect(await spin('terminal', {})).toBe('Sauteing…') // before the band shows
    await w.clock.advance(3000)
    expect(await spin('terminal', {})).toBe('Breathing in…')
    expect(await spin('terminal', { message: 'Compacting conversation' })).toBe('Compacting conversation…')
    // The desktop's turn row is Claude's own: the guide in the band does the breathing.
    expect(await spin('desktop', { word: 'Working' })).toBe('Working…')
    expect(await spin('desktop', { word: 'Creating notes.md' })).toBe('Creating notes.md…')
    await w.clock.advance(6000)
    expect(await spin('terminal', {})).toBe('Breathing out…')
  })
})

describe('fitting the space', () => {
  test('the band sizes to its body width, and other mods keep their place', { plugins: [neighbour] }, async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000 + 2000)
    for (const cols of [100, 30, 12]) {
      const ui = await w.band($, 'terminal', { bodyColumns: cols })
      const shape = (await ui.find({ key: 'sw-shape' }))?.text ?? ''
      expect(shape.length).toBe(Math.min(40, cols - (cols % 2)))
      const head = (await ui.find({ key: 'sw-head' }))?.text ?? ''
      expect(head.length <= cols).toBe(true)
      expect(await ui.find({ type: 'Text', text: 'neighbour mod' })).toBeDefined()
      expect(await ui.find({ key: 'engine-band' })).toBeDefined()
      expect(await caption(ui)).toBe(cols >= 32 ? 'physiological sigh' : undefined)
      await ui.unmount()
    }
  })

  test('other mods in the band draw first, the breath beneath them', { plugins: [neighbour] }, async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000 + 2000)
    for (const surface of SURFACES) {
      const ui = await w.band($, surface)
      const order = walk(await ui.drawn()).map(el => el.props.key).filter(k => k === 'neighbour' || k === 'sw-breath')
      expect(order, surface).toEqual(['neighbour', 'sw-breath'])
      expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { flexDirection: 'column' } })
      await ui.unmount()
    }
  })

  test('a band with under three rows to give gets the one-line form', async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000)
    for (const surface of SURFACES) {
      const ui = await w.band($, surface, { maxRows: 2 })
      expect(await ui.find({ key: 'sw-compact' })).toBeDefined()
      // The desktop's line holds for the span (a countdown would draw the band again).
      expect(await compactWords(ui)).toContain(surface === 'desktop' ? 'physiological sigh' : 'Breathe in 4')
      expect(await ui.find({ key: 'sw-breath' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('a survey has the band: the mod steps aside', async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000)
    for (const surface of SURFACES) {
      const ui = await w.band($, surface, { hasSurvey: true })
      expect(await isShown(ui)).toBe(false)
      await ui.unmount()
    }
  })

  test('a run left breathing with no turn working draws nothing', async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000)
    const ui = await w.band($, 'terminal', { isWorking: false })
    expect(await isShown(ui)).toBe(false)
  })
})

const THEME_KEYS = new Set(['text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error', 'warning', 'merged', 'claude', 'permission', 'planMode', 'autoAccept', 'promptBorder', 'bashBorder', 'ide'])

describe('theme and motion', () => {
  test('every colour the band names is a theme key', async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000 + 2000)
    for (const surface of SURFACES) {
      const ui = await w.band($, surface)
      const colours = walk(await ui.drawn()).flatMap(el => [el.props.color, el.props.backgroundColor, el.props.borderColor]).filter(c => c !== undefined)
      // On the desktop the guide's colours live inside its drawing (Bolt's own palette).
      if (surface === 'terminal') expect(colours.length > 0).toBe(true)
      for (const c of colours) expect(THEME_KEYS.has(String(c))).toBe(true)
      await ui.unmount()
    }
  })

  for (const [motion, ms] of [['full', 125], ['gentle', 500], ['still', 1000]] as const) {
    test(`${motion} motion ticks every ${ms} ms while visible`, { plugins: [timerSpy], options: { motion } }, async ($, on) => {
      const w = world(on)
      await w.start($)
      await w.clock.advance(2999)
      expect(w.timers().every).toBe(0) // nothing ticks before the band shows
      await w.clock.advance(1)
      const shown = w.timers().every
      await w.clock.advance(4000)
      const ticks = w.rec.toasts.filter(t => t.startsWith('spy:every:'))
      expect(ticks.length - shown).toBe(4000 / ms)
      expect(ticks.every(t => t === `spy:every:${ms}`)).toBe(true)
      for (const surface of SURFACES) {
        const ui = await w.band($, surface)
        const hasShape = (await ui.find({ key: 'sw-shape' })) !== undefined || (await ui.find({ type: 'Svg' })) !== undefined
        expect(hasShape).toBe(motion !== 'still')
        await ui.unmount()
      }
    })
  }
})

describe('the movement card', () => {
  /** One turn of `ms` with its answer, then long enough for the fold to clear. */
  async function longTurn($: Engine, w: World, ms = 62_000) {
    await w.start($)
    await w.clock.advance(ms)
    await w.complete($)
    await w.clock.advance(20_000)
  }

  test('every fifth long turn offers a card; Did it counts a move', { options: { movementCard: true, motion: 'still' } }, async ($, on) => {
    const w = world(on)
    const ui = await w.band($, 'terminal')
    for (let i = 0; i < 4; i++) await longTurn($, w)
    expect(await ui.find({ key: 'sw-card' })).toBeUndefined()
    await w.start($)
    await w.clock.advance(62_000)
    for (const surface of SURFACES) {
      const card = await w.band($, surface)
      expect((await card.find({ key: 'sw-card' }))?.text).toContain('Stand up and stretch')
      expect((await card.find({ key: 'sw-did' }))?.props.label).toBe('Did it')
      expect((await card.find({ key: 'sw-skip' }))?.props.label).toBe('Skip')
      // Click only: d and s belong to other band mods' Dismiss, Deny, Done and Skip.
      expect((await card.find({ key: 'sw-did' }))?.props.hotkey).toBeUndefined()
      expect((await card.find({ key: 'sw-skip' }))?.props.hotkey).toBeUndefined()
      await card.unmount()
    }
    // It never blocks the prompt: typing goes through while it shows.
    expect(await w.edit($, '', 0, 0, 'k')).toEqual({ text: 'k', cursor: 1 })
    await w.complete($)
    await w.clock.advance(20_000)
    expect(await ui.find({ key: 'sw-card' })).toBeDefined() // it waits for an answer, not a timer
    await ui.press({ key: 'sw-did' })
    expect(await ui.find({ key: 'sw-card' })).toBeUndefined()
    expect((w.store.get('stats') as { today: { moves: number }; longTurns: number }).today.moves).toBe(1)
    expect((w.store.get('stats') as { longTurns: number }).longTurns).toBe(5)
  })

  test('the tenth offers squats; Skip just closes it', { options: { movementCard: true, motion: 'still' } }, async ($, on) => {
    const w = world(on, { store: { stats: { longTurns: 9 } } })
    await longTurn($, w)
    const ui = await w.band($, 'desktop')
    expect((await ui.find({ key: 'sw-card' }))?.text).toContain('10 squats')
    await ui.press({ key: 'sw-skip' })
    expect(await ui.find({ key: 'sw-card' })).toBeUndefined()
    expect((w.store.get('stats') as { today: { moves: number } }).today.moves).toBe(0)
  })

  test('off by default: long turns offer nothing', { options: { motion: 'still' } }, async ($, on) => {
    const w = world(on)
    const ui = await w.band($, 'terminal')
    for (let i = 0; i < 5; i++) await longTurn($, w)
    expect(await ui.find({ key: 'sw-card' })).toBeUndefined()
    expect((w.store.get('stats') as { longTurns: number }).longTurns).toBe(5)
  })
})

describe('mobile and VS Code', () => {
  test('where only VS Code draws, the cue rides the status line, and clears after', async ($, on) => {
    const w = world(on, { surfaces: ['vscode'] })
    await w.start($)
    await w.clock.advance(3000)
    expect(w.rec.statuses.at(-1)).toBe('Breathe in 4')
    await w.clock.advance(2000)
    expect(w.rec.statuses.at(-1)).toBe('Breathe in 2')
    await w.complete($)
    await w.clock.advance(3375)
    expect(w.rec.statuses.at(-1)).toBe('1 breath while Claude worked · 1 today · 1-day streak')
    await w.clock.advance(6000)
    expect(w.rec.statuses.at(-1)).toBeUndefined()
  })

  test('with a terminal or the desktop attached the status line stays untouched', async ($, on) => {
    const w = world(on, { surfaces: ['terminal', 'mobile'] })
    await w.start($)
    await w.clock.advance(3000 + 5000)
    await w.complete($)
    await w.clock.advance(20_000)
    expect(w.rec.statuses).toEqual([])
  })
})

// A live session refuses a band tree that puts the
// engine's own node under a Box that sizes, hides or moves it, and draws its
// own band instead. The kit does not check this, so the test walks the tree.
const ENGINE_BENEATH: Plugin = {
  name: 'engine-beneath',
  tier: 'append',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as never)
  },
}
const CONCEALING = ['display', 'overflow', 'position', 'width', 'height', 'minWidth', 'minHeight', 'top', 'left', 'right', 'bottom']
type DrawnNode = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
function engineNodeConcealers(node: unknown, around: string[] = []): string[][] {
  if (node === null || typeof node !== 'object') return []
  const n = node as DrawnNode
  if (n.type === 'engine') return [around]
  const mine = n.type === 'Box' ? CONCEALING.filter(k => n.props?.[k] !== undefined) : []
  return (n.children ?? []).flatMap(c => engineNodeConcealers(c, [...around, ...mine]))
}

test('#39: the engine band beneath is never under a Box that sizes or hides it', { plugins: [ENGINE_BENEATH] }, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.clock.advance(3000 + 2000)
  for (const surface of SURFACES) {
    const ui = await w.band($, surface)
    expect(await ui.find({ key: 'sw-breath' }), surface).toBeDefined()
    expect(engineNodeConcealers(await ui.drawn()), surface).toEqual([[]])
    await ui.unmount()
  }
})

test('on the desktop the band is not drawn again across a span, so its frame is never re-set', { options: { eyeRest: false, stretch: false } }, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.clock.advance(3000 + 500)
  const ui = await w.band($, 'desktop')
  const first = await ui.find({ type: 'Svg' })
  expect(first?.props.isInteractive).toBe(true)
  const tree = JSON.stringify(await ui.drawn())
  const draws = w.rec.bandDraws
  // 70 s of ticks (the clock atom written 8 times a second) and the turn turning long at 60 s:
  // the desktop band is not drawn even once more. The desktop re-sets the guide's frame on every
  // draw, identical tree or not (seen live), so the only fix is no draw at all.
  for (let i = 0; i < 70; i += 1) {
    await w.clock.advance(1000)
    expect(JSON.stringify(await ui.drawn()), `t+${i + 1}s`).toBe(tree)
    expect(w.rec.bandDraws, `t+${i + 1}s`).toBe(draws)
  }
  // The count counts: the terminal band carries a text bar and draws on every tick.
  const term = await w.band($, 'terminal')
  const before = w.rec.bandDraws
  await w.clock.advance(1000)
  await term.drawn()
  expect(w.rec.bandDraws).toBeGreaterThan(before)
  await term.unmount()
  await ui.unmount()
})

test('a draft collapses the desktop band to one still line, and the guide comes back in step', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.clock.advance(3000 + 500)
  const ui = await w.band($, 'desktop')
  const draft = await w.hint($, 'desktop', true)
  await w.clock.settle()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await compactWords(ui)).toBe('physiological sigh, then slow paced breathing')
  await w.clock.advance(5000)
  await draft.unmount()
  const empty = await w.hint($, 'desktop', false)
  await w.clock.settle()
  // Rebuilt from now, 5.5 s into the span (which began at 3 s): its first keyframes already behind it.
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('linear -5500ms')
  await empty.unmount()
  await ui.unmount()
})
