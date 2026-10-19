// The wiring: counting each response once, the band under other mods and never
// over a hold, the status line, the pane on both surfaces, the commands that
// answer nothing the model reads, and the opt-in nudge.

import { describe, expect, test } from 'claude-code/testing'

import { EM_DASH } from '../hooks/jar'
import { BAND_PROPS, COMPOSE, SURFACES, band, pane, reply, run, start, world } from './world'

const THREE = "You're absolutely right, great question. I apologize for the mess; let me know if it helps. You are absolutely right."

describe('counting', () => {
  test('a reply with tics counts each once, and the band shows the top three in order on both surfaces', async ($, on) => {
    world(on)
    await start($)
    await reply($, THREE)
    for (const surface of SURFACES) {
      const drawn = await band($, surface)
      expect(drawn.line).toBe('swear-jar: absolutely right 2 · great question 1 · i apologize 1')
      expect(drawn.other).toBe("another mod's line")
    }
    await reply($, 'Done.')
    await reply($, 'Certainly! Done.')
    expect((await band($, 'terminal')).line).toBe('swear-jar: absolutely right 2 · great question 1 · i apologize 1')
  })

  test('a summary row, a subagent\'s response and an empty response count nothing', async ($, on) => {
    world(on)
    await start($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'swear-jar', surface, component: 'AssistantMessage', props: { text: 'Great question! You are absolutely right.', isFirstOfReply: true, isSummary: true } })
      await ui.unmount()
    }
    await reply($, 'Great question! You are absolutely right.', { agentId: 'agent-1' })
    await reply($, '')
    expect((await band($, 'terminal')).line).toBeUndefined()
  })

  test('four em dashes count four, under their name, and the band never draws the character', async ($, on) => {
    world(on)
    await start($)
    await reply($, `A${EM_DASH}B${EM_DASH}C${EM_DASH}D${EM_DASH}E`)
    const drawn = await band($, 'desktop')
    expect(drawn.line).toBe('swear-jar: em dashes 4')
    expect(drawn.texts.join('\n')).not.toContain(EM_DASH)
  })

  test('with the jar empty the band passes through untouched', async ($, on) => {
    world(on)
    await start($)
    for (const surface of SURFACES) {
      const drawn = await band($, surface)
      expect(drawn.line).toBeUndefined()
      expect(drawn.other).toBe("another mod's line")
    }
  })

  test('while a safety hold waits beneath, the band is left to it alone', async ($, on) => {
    world(on, { holdBeneath: true })
    await start($)
    await reply($, THREE)
    for (const surface of SURFACES) {
      const drawn = await band($, surface)
      expect(drawn.hold).toContain('held: rm -rf build')
      expect(drawn.line).toBeUndefined()
      expect(drawn.texts.join('\n')).not.toContain('swear-jar')
    }
  })

  test('a mod waiting beneath with Send now and Cancel is not a hold: the jar line stays', async ($, on) => {
    world(on, { waitBeneath: true })
    await start($)
    await reply($, THREE)
    const drawn = await band($, 'terminal')
    expect(drawn.texts.join('\n')).toContain('held until the limit resets')
    expect(drawn.line).toBe('swear-jar: absolutely right 2 · great question 1 · i apologize 1')
  })

  test('while a survey holds the band, the jar draws nothing and passes through', async ($, on) => {
    world(on)
    await start($)
    await reply($, THREE)
    const ui = await $.ui.mount({ plugin: 'swear-jar', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, hasSurvey: true } })
    expect(await ui.find({ key: 'swear-jar' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: "another mod's line" })).toBeDefined()
    await ui.unmount()
  })

  test('a host that refuses the command still gets the counts and the nudge loaded', async ($, on) => {
    world(on, { store: { allTime: { delve: 2 }, nudge: true }, refuseCommand: true })
    await start($)
    expect((await pane($, 'terminal')).whole).toContain('All time: 2')
    expect((await $.prompt.compose(COMPOSE)).sections.map(s => s.id)).toEqual(['system', 'swear-jar:plain-words'])
  })

  test('with show set to status the count goes to the status line and no band is drawn', { options: { show: 'status' } }, async ($, on) => {
    const w = world(on)
    await start($)
    await reply($, THREE)
    // The engine prefixes the status line with the mod's name, so the words never repeat it.
    expect(w.statuses.at(-1)).toBe('5 tics')
    const drawn = await band($, 'terminal')
    expect(drawn.line).toBeUndefined()
    expect(drawn.other).toBe("another mod's line")
    await run($, 'reset')
    expect(w.statuses.at(-1)).toBeUndefined()
  })

  test('the tics setting replaces the list', { options: { tics: ['synergy', 'em dash'] } }, async ($, on) => {
    world(on)
    await start($)
    await reply($, `Great question! Synergy${EM_DASH}now.`)
    expect((await band($, 'terminal')).line).toBe('swear-jar: synergy 1 · em dashes 1')
  })
})

describe('the pane and the commands', () => {
  test('/swear-jar opens the scoreboard: this session, all time, the worst offender, the last reply in its sentence; the answer is {}', async ($, on) => {
    const w = world(on, { store: { allTime: { 'great question': 7 } } })
    await start($)
    await reply($, THREE)
    expect(await run($, '')).toEqual({})
    expect(w.panes).toEqual(['swear-jar'])
    for (const surface of SURFACES) {
      const { texts, whole } = await pane($, surface)
      expect(whole).toContain('Swear jar')
      expect(whole).toContain('This session: 5')
      expect(whole).toContain('All time: 12')
      expect(whole).toContain('Worst offender: great question (8)')
      expect(texts.some(t => t.bold && t.text === "You're absolutely right")).toBe(true)
      expect(whole).toContain('Plain-words nudge off')
    }
    expect(w.store.get('allTime')).toEqual({ 'great question': 8, 'absolutely right': 2, 'i apologize': 1, 'let me know if': 1 })
  })

  test('on the desktop the Bolt accent is one glyph per cell, never block characters beside words', async ($, on) => {
    world(on)
    await start($)
    const { texts } = await pane($, 'desktop')
    const glyph = /[▀-▟]/u
    const cells = texts.filter(t => glyph.test(t.text))
    expect(cells.length).toBeGreaterThan(0)
    for (const t of cells) expect([...t.text].length, t.text).toBe(1)
    expect((await pane($, 'desktop', 30)).texts.some(t => glyph.test(t.text))).toBe(false)
  })

  test('where no pane can be placed the scoreboard goes to a transcript row, still never to the model', async ($, on) => {
    const w = world(on, { isPanePlaced: false })
    await start($)
    await reply($, THREE)
    expect(await run($, '')).toEqual({})
    expect(w.logs[0]).toContain('Swear jar: 5 this session, 5 all time')
  })

  test('reset empties this session and keeps all time; reset all empties both', async ($, on) => {
    const w = world(on)
    await start($)
    await reply($, THREE)
    expect(await run($, 'reset')).toEqual({})
    expect((await band($, 'terminal')).line).toBeUndefined()
    expect(w.store.get('allTime')).toEqual({ 'absolutely right': 2, 'great question': 1, 'i apologize': 1, 'let me know if': 1 })
    expect(w.toasts.at(-1)).toBe('Swear jar emptied for this session.')
    await reply($, 'Certainly!')
    expect(await run($, 'reset all')).toEqual({})
    expect(w.store.get('allTime')).toBeUndefined()
    expect((await pane($, 'terminal')).whole).toContain('All time: 0')
    expect(w.toasts.at(-1)).toBe('Swear jar emptied: this session and all time.')
  })

  test('unknown words answer with the usage, in a toast', async ($, on) => {
    const w = world(on)
    await start($)
    expect(await run($, 'bogus')).toEqual({})
    expect(w.toasts[0]).toContain('/swear-jar reset [all]')
  })
})

describe('the nudge', () => {
  test('off by default: no section; on: exactly one session section at the end; off again: gone; the switch is remembered', async ($, on) => {
    const w = world(on)
    await start($)
    expect((await $.prompt.compose(COMPOSE)).sections.map(s => s.id)).toEqual(['system'])
    expect(await run($, 'nudge on')).toEqual({})
    expect(w.toasts.at(-1)).toContain('about 30 tokens')
    const on1 = (await $.prompt.compose(COMPOSE)).sections
    expect(on1.map(s => s.id)).toEqual(['system', 'swear-jar:plain-words'])
    expect(on1[1]).toMatchObject({ scope: 'session' })
    expect(on1[1]?.text).toContain('Plain words')
    expect(w.store.get('nudge')).toBe(true)
    await run($, 'nudge off')
    expect((await $.prompt.compose(COMPOSE)).sections.map(s => s.id)).toEqual(['system'])
    expect(w.store.get('nudge')).toBe(false)
  })

  test('a remembered nudge is on from the start of the next session', async ($, on) => {
    world(on, { store: { nudge: true } })
    await start($)
    expect((await $.prompt.compose(COMPOSE)).sections.map(s => s.id)).toEqual(['system', 'swear-jar:plain-words'])
    expect((await pane($, 'terminal')).whole).toContain('Plain-words nudge on')
  })
})

describe('two open sessions share one jar', () => {
  test("each reply adds to what the store holds now, not to what this session read at start, so another session's tallies survive", async ($, on) => {
    const w = world(on, { store: { allTime: { delve: 1 } } })
    await start($)
    await reply($, 'Certainly!')
    expect(w.store.get('allTime')).toEqual({ delve: 1, certainly: 1 })
    // The other session wrote in between: its tallies are in the store, this session's atom is behind.
    w.store.set('allTime', { delve: 1, certainly: 1, 'great question': 4 })
    await reply($, 'Certainly!')
    expect(w.store.get('allTime')).toEqual({ delve: 1, certainly: 2, 'great question': 4 })
    // The pane reads the store afresh when it opens, so it shows the jar as it is, even with no
    // reply of this session's in between.
    w.store.set('allTime', { delve: 20 })
    await run($, '')
    expect((await pane($, 'terminal')).whole).toContain('All time: 20')
  })

  test("a reset all in the other session sticks: this session's next tic starts the jar from empty", async ($, on) => {
    const w = world(on)
    await start($)
    await reply($, THREE)
    expect(w.store.get('allTime')).toEqual({ 'absolutely right': 2, 'great question': 1, 'i apologize': 1, 'let me know if': 1 })
    w.store.delete('allTime') // the other session ran /swear-jar reset all
    await reply($, 'Certainly!')
    expect(w.store.get('allTime')).toEqual({ certainly: 1 })
    await run($, '')
    expect((await pane($, 'terminal')).whole).toContain('All time: 1')
  })

  test('the status line reads one tic as one, and never the name twice', { options: { show: 'status' } }, async ($, on) => {
    const w = world(on)
    await start($)
    await reply($, 'Certainly!')
    expect(w.statuses.at(-1)).toBe('1 tic')
    expect(w.statuses.at(-1)).not.toContain('swear-jar')
  })
})

describe('the last reply', () => {
  test('a reply without tics clears the last reply in the pane', async ($, on) => {
    world(on)
    await start($)
    await reply($, THREE)
    await run($, '')
    expect((await pane($, 'terminal')).whole).toContain("You're absolutely right")
    await reply($, 'Nothing to see here.')
    const { whole } = await pane($, 'terminal')
    expect(whole).toContain('no tics in the last reply')
    expect(whole).not.toContain("You're absolutely right")
  })
})
