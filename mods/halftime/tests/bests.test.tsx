// Personal bests survive two open sessions: every save re-reads the store
// right before writing, so a lower score never overwrites a higher one.

import { describe, expect, test } from 'claude-code/testing'

import { addTotals, saveBest, saveDaily, type Store } from '../hooks/bests'
import { BAND, VIEWPORT, bandText, boardOf, halftime, play, titleText, world } from './fixtures'

/** One shared disk, and a session's view of it; `afterSet` runs once right after this session's next write. */
function sessionOn(disk: Map<string, unknown>, hooks: { afterSet?: () => void } = {}): Store {
  return {
    get: async key => disk.get(key),
    set: async (key, value) => {
      disk.set(key, value)
      const later = hooks.afterSet
      hooks.afterSet = undefined
      later?.()
    },
  }
}

describe('compare-and-set, two sessions on one store', () => {
  test('interleaved saves keep the higher best', async () => {
    const disk = new Map<string, unknown>()
    const a = sessionOn(disk)
    const b = sessionOn(disk)
    expect(await saveBest(a, 'hurdle', 300)).toEqual({ best: 300, isBest: true })
    expect(await saveBest(b, 'hurdle', 500)).toEqual({ best: 500, isBest: true })
    // A still remembers 300 as its best; its next save re-reads and finds 500.
    expect(await saveBest(a, 'hurdle', 400)).toEqual({ best: 500, isBest: false })
    expect(disk.get('best:hurdle')).toBe(500)
    expect(await saveBest(a, 'hurdle', 600)).toEqual({ best: 600, isBest: true })
    expect(await saveBest(b, 'hurdle', 550)).toEqual({ best: 600, isBest: false })
    expect(disk.get('best:hurdle')).toBe(600)
  })

  test('a lower score written in the gap after our write is repaired', async () => {
    const disk = new Map<string, unknown>([['best:hurdle', 100]])
    const hooks: { afterSet?: () => void } = {}
    const a = sessionOn(disk, hooks)
    // B read 100 before A wrote, and writes its 450 just after A's 600 lands.
    hooks.afterSet = () => disk.set('best:hurdle', 450)
    expect(await saveBest(a, 'hurdle', 600)).toEqual({ best: 600, isBest: true })
    expect(disk.get('best:hurdle')).toBe(600)
  })

  test('sweep keeps the lower time; the daily best is per day', async () => {
    const disk = new Map<string, unknown>([['best:sweep', 47], ['daily:sweep', { day: '2026-10-08', score: 20 }]])
    const a = sessionOn(disk)
    expect(await saveBest(a, 'sweep', 52)).toEqual({ best: 47, isBest: false })
    expect(await saveBest(a, 'sweep', 41)).toEqual({ best: 41, isBest: true })
    // Yesterday's 20s does not count against today.
    expect(await saveDaily(a, 'sweep', '2026-10-09', 60)).toEqual({ day: '2026-10-09', score: 60 })
    expect(await saveDaily(a, 'sweep', '2026-10-09', 70)).toEqual({ day: '2026-10-09', score: 60 })
  })

  test('totals add up across saves', async () => {
    const disk = new Map<string, unknown>()
    await addTotals(sessionOn(disk), [60_000, 30_000, 1])
    expect(await addTotals(sessionOn(disk), [1_000, 1_000, 1])).toEqual({ playedMs: 61_000, waitPlayedMs: 31_000, runs: 2 })
  })
})

describe('through the plugin', () => {
  test('a run ending below a best another session just saved never overwrites it', async ($, on) => {
    const disk = new Map<string, unknown>([['best:hurdle', 10]])
    const { clock } = world(on, { store: disk })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.command.run(halftime('hurdle'))
    const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
    expect(titleText((await boardOf(ui))!)).toContain('best 10')
    // Mid-run, the other session saves a far better run.
    disk.set('best:hurdle', 9999)
    await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
    await play(clock, ui, 5000)
    const over = await boardOf(ui)
    expect(over?.wait).toContain('crashed at')
    expect(over?.wait).toContain('best 9999')
    expect(titleText(over!)).toContain('best 9999')
    expect(disk.get('best:hurdle')).toBe(9999)
  })

  test('a better run is saved, with its daily score and the time played while waiting', async ($, on) => {
    const disk = new Map<string, unknown>([['best:hurdle', 5]])
    const { clock } = world(on, { store: disk })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.turn.start({ text: 'build it', turnId: 'main-1' })
    await $.command.run(halftime('hurdle'))
    const ui = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
    await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left' })
    await play(clock, ui, 5000)
    const over = await boardOf(ui)
    const score = Number(/crashed at (\d+)/.exec(over?.wait ?? '')?.[1])
    expect(score).toBeGreaterThan(5)
    expect(over?.wait).toContain('new personal best')
    expect(disk.get('best:hurdle')).toBe(score)
    expect(disk.get('daily:hurdle')).toEqual({ day: '2026-10-09', score })
    expect(disk.get('last')).toBe('hurdle')
    const totals = disk.get('totals') as { playedMs: number; waitPlayedMs: number; runs: number }
    expect(totals.runs).toBe(1)
    expect(totals.waitPlayedMs).toBeGreaterThan(2000)
    expect(await bandText(ui)).toContain(`halftime daily 10-09 · hurdle ${score} · played`)
  })
})
