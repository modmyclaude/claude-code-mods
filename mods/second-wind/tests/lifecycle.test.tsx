// The run's life around the session: which surfaces can show it, the turn
// events it hands on to the mods beneath, and the edges of a turn (a closing
// exhale, the fold line, an unanswered card, /breathe mid-turn).

import { describe, expect, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

import { timerSpy, world } from './world'

/** A mod beneath Second Wind that says which session and turn events reached it. */
const beneath: Plugin = {
  name: 'beneath',
  register(on) {
    on('turn.start', ($, e, next) => {
      $.ui.toast('beneath:turn.start')
      return next(e)
    })
    on('turn.complete', ($, e, next) => {
      $.ui.toast(`beneath:turn.complete:${e.agentId ?? 'main'}`)
      return next(e)
    })
    on('session.attach', ($, e, next) => {
      $.ui.toast(`beneath:session.attach:${e.surface}`)
      return next(e)
    })
    on('session.detach', ($, e, next) => {
      $.ui.toast(`beneath:session.detach:${e.surface}`)
      return next(e)
    })
  },
}

describe('only where something draws', () => {
  test('a plain -p run (nothing attached) never ticks and never counts', { plugins: [timerSpy] }, async ($, on) => {
    const w = world(on, { surfaces: [] })
    await w.start($)
    await w.clock.advance(3000 + 62_000)
    await w.complete($)
    await w.clock.advance(20_000)
    expect(w.timers().all).toBe(0)
    expect(w.store.has('stats')).toBe(false)
    expect(w.rec.statuses).toEqual([])
  })

  test('a client that attaches mid-turn arms the band then, its breath starting there', { plugins: [timerSpy] }, async ($, on) => {
    const w = world(on, { surfaces: [] })
    await w.start($)
    await w.clock.advance(5000)
    expect(w.timers().all).toBe(0)
    expect(await w.attach($, 'desktop')).toEqual({ clientId: 'desktop:default' })
    const ui = await w.band($, 'desktop')
    // A whole sigh from here, not 2 s into one: the guide opens at its first frame.
    expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('linear 0ms 1 both')
    await w.clock.advance(2000)
    await w.complete($)
    await w.clock.advance(3375)
    expect((await ui.find({ key: 'sw-fold' }))?.text).toBe('1 breath while Claude worked · 1 today · 1-day streak')
  })

  test('a second client attaching mid-breath changes nothing', async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000 + 5000)
    const ui = await w.band($, 'terminal')
    expect((await ui.find({ key: 'sw-cue' }))?.text ?? ((await ui.find({ type: 'Svg' })) !== undefined ? 'guide' : undefined)).toBe('Sip in 1')
    await w.attach($, 'mobile')
    await w.clock.advance(1500)
    expect((await ui.find({ key: 'sw-cue' }))?.text ?? ((await ui.find({ type: 'Svg' })) !== undefined ? 'guide' : undefined)).toBe('Out 9') // 6.5 s into the same sigh
  })

  test('on mobile the status line is set only when its words change, never again with the same words', async ($, on) => {
    const w = world(on, { surfaces: ['mobile'] })
    await w.start($)
    await w.clock.advance(3000 + 20_000)
    const s = w.rec.statuses
    expect(s.length).toBeGreaterThan(3)
    for (let i = 1; i < s.length; i++) expect(s[i], `status ${i} repeats ${s[i - 1]}`).not.toBe(s[i - 1])
  })

  test('the last client leaving drops the run: no clock, no counts, the status line cleared', { plugins: [timerSpy] }, async ($, on) => {
    const w = world(on, { surfaces: ['mobile'] })
    await w.start($)
    await w.clock.advance(3000 + 5000)
    expect(w.rec.statuses.at(-1)).toBe('Sip in 1')
    await w.detach($, 'mobile')
    expect(w.rec.statuses.at(-1)).toBeUndefined()
    const ticks = w.timers().all
    await w.clock.advance(60_000)
    expect(w.timers().all).toBe(ticks)
    await w.complete($)
    await w.clock.advance(20_000)
    expect(w.store.has('stats')).toBe(false)
  })
})

describe('handing events on', () => {
  test('session and turn events still reach the mods beneath', { plugins: [beneath] }, async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000 + 2000)
    await w.attach($, 'mobile')
    await w.complete($, { agentId: 'agent-2' })
    await w.detach($, 'mobile')
    await w.complete($)
    expect(w.rec.toasts.filter(t => t.startsWith('beneath:'))).toEqual([
      'beneath:turn.start',
      'beneath:session.attach:mobile',
      'beneath:turn.complete:agent-2',
      'beneath:session.detach:mobile',
      'beneath:turn.complete:main',
    ])
  })
})

describe('the edges of a turn', () => {
  test('a turn that starts during the closing exhale carries the breath on', async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000 + 2000)
    await w.complete($)
    await w.clock.settle()
    const ui = await w.band($, 'terminal')
    expect((await ui.find({ key: 'sw-cue' }))?.text ?? ((await ui.find({ type: 'Svg' })) !== undefined ? 'guide' : undefined)).toBe('Out 4')
    await w.start($)
    await w.clock.settle()
    expect((await ui.find({ key: 'sw-cue' }))?.text ?? ((await ui.find({ type: 'Svg' })) !== undefined ? 'guide' : undefined)).toBe('Breathe in 2')
    // It now belongs to the new turn, whose answer folds it.
    await w.complete($)
    await w.clock.advance(3375)
    expect((await ui.find({ key: 'sw-fold' }))?.text).toStartWith('1 breath while Claude worked')
  })

  test('an unanswered movement card goes when the next turn starts', { options: { movementCard: true, motion: 'still' } }, async ($, on) => {
    const w = world(on, { store: { stats: { longTurns: 4 } } })
    await w.start($)
    await w.clock.advance(62_000)
    await w.complete($)
    await w.clock.advance(20_000)
    const ui = await w.band($, 'terminal')
    expect(await ui.find({ key: 'sw-card' })).toBeDefined()
    await w.start($)
    expect(await ui.find({ key: 'sw-card' })).toBeUndefined()
  })

  test('the fold line shows plainly first, then dims', async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000 + 2000)
    await w.complete($)
    await w.clock.advance(3375)
    const ui = await w.band($, 'terminal')
    const line = async () => ui.find({ type: 'Text', text: /while Claude worked/ })
    expect((await line())?.props.dimColor).not.toBe(true)
    await w.clock.advance(3000)
    expect((await line())?.props.dimColor).toBe(true)
  })

  test('running /breathe mid-turn gives the band its full size back', async ($, on) => {
    const w = world(on)
    await w.start($)
    await w.clock.advance(3000 + 2000)
    const ui = await w.band($, 'terminal')
    await w.edit($, '', 0, 0, '/breathe')
    expect(await ui.find({ key: 'sw-compact' })).toBeDefined()
    await w.say($)
    expect(await ui.find({ key: 'sw-breath' })).toBeDefined()
  })
})
