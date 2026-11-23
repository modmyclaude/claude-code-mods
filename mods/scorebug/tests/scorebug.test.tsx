// scorebug through its real wiring: the band and when it steps aside, the
// cards over another mod's scene in either order, the toasts through a whole
// round of the pretend games, and the command.

import { describe, expect, test } from 'claude-code/testing'

import { captionOf, demoGames, lineOf, ROUND } from '../hooks/games'
import { AT, columnOf, hasBackdrop, HOST, keyOf, LONER, mountBackdrop, mountBand, rowOf, SCENERY, scores, texts, walk, world } from './world'
import type { Drawn } from './world'

const [one, two] = demoGames(AT) as [ReturnType<typeof demoGames>[number], ReturnType<typeof demoGames>[number]]

/** What the two cards say, top to bottom. */
const CARDS = [
  captionOf(one),
  `RDG  ${one.away.score}`,
  `HBR  ${one.home.score}`,
  'Ridgeline at Harbour, pretend game',
  captionOf(two),
  `LKS  ${two.away.score}`,
  `FDY  ${two.home.score}`,
  'Lakeside at Foundry, pretend game',
]

describe('the band', () => {
  test('in the terminal: both pretend games on one row above the prompt, beneath what the engine draws there', async ($, on) => {
    const w = world(on)
    await w.start($)
    expect([one.status, two.status]).toEqual(['P1 13:20', 'Q4 10:40'])
    const band = await mountBand($, 'terminal')
    expect(await rowOf(band)).toBe(`scores │ ${lineOf(one)}   ${lineOf(two)}`)
    // What other mods and the engine draw in the band stays, above the row.
    const holder = walk(await band.drawn(), n => (n.children ?? []).some(c => typeof c === 'object' && c !== null && keyOf(c as Drawn) === 'scorebug'))[0]
    expect(holder?.children).toHaveLength(2)
    expect(keyOf(holder?.children?.[1] as Drawn)).toBe('scorebug')
    await w.pass(30_000)
    expect(await rowOf(band)).toBe(`scores │ ${demoGames(AT + 30_001).map(lineOf).join('   ')}`)
    await band.unmount()
  })

  test('in the desktop app it steps aside once the scene behind the chat has drawn the cards, and is back two looks after the scene goes; the terminal keeps it', { plugins: [SCENERY] }, async ($, on) => {
    const w = world(on)
    if (!(await hasBackdrop($))) return
    await w.start($, 'desktop')
    const desk = await mountBand($, 'desktop')
    const term = await mountBand($, 'terminal')
    expect(await rowOf(desk)).toContain('scores │ RDG')
    const ui = await mountBackdrop($, 'scenery', 'garden')
    await w.pass(30_000)
    expect(await rowOf(desk)).toBe('')
    expect(await rowOf(term)).toContain('scores │ RDG')
    await ui.unmount()
    await w.pass(30_000)
    expect(await rowOf(desk)).toBe('')
    await w.pass(30_000)
    expect(await rowOf(desk)).toContain('scores │ RDG')
    await desk.unmount()
    await term.unmount()
  })

  test('band on: shown beside the cards too', { plugins: [SCENERY], options: { band: 'on' } }, async ($, on) => {
    const w = world(on)
    if (!(await hasBackdrop($))) return
    await w.start($, 'desktop')
    const desk = await mountBand($, 'desktop')
    const ui = await mountBackdrop($, 'scenery', 'garden')
    await w.pass(30_000)
    expect(texts(columnOf(await ui.drawn()))).toHaveLength(8)
    expect(await rowOf(desk)).toContain('scores │ RDG')
    await ui.unmount()
    await desk.unmount()
  })

  test('band off, no team followed, a survey holding the band, or the mod off: no row', async ($, on) => {
    const w = world(on)
    await w.start($)
    const survey = await mountBand($, 'terminal', { hasSurvey: true })
    expect(await rowOf(survey)).toBe('')
    await survey.unmount()
    await scores($, 'off')
    const off = await mountBand($, 'terminal')
    expect(await rowOf(off)).toBe('')
    await off.unmount()
  })

  const quiet: Record<string, string | boolean>[] = [{ band: 'off' }, { teams: 'summit' }, { enabled: false }]
  for (const options of quiet) {
    test(`with ${JSON.stringify(options)}: no row`, { options }, async ($, on) => {
      const w = world(on)
      await w.start($)
      const band = await mountBand($, 'terminal')
      expect(await rowOf(band)).toBe('')
      await band.unmount()
    })
  }

  test('a team followed by one word of its name: that game alone', { options: { teams: 'foundry' } }, async ($, on) => {
    const w = world(on)
    await w.start($)
    const band = await mountBand($, 'terminal')
    expect(await rowOf(band)).toBe(`scores │ ${lineOf(two)}`)
    await band.unmount()
  })
})

describe('the cards', () => {
  test("over another mod's scene, asked before it: that scene beneath, a card for each game in the left column, the edge lit while live", { plugins: [SCENERY] }, async ($, on) => {
    const w = world(on)
    if (!(await hasBackdrop($))) return
    await w.start($, 'desktop')
    const ui = await mountBackdrop($, 'scenery', 'garden')
    const drawn = (await ui.drawn()) as Drawn
    expect(drawn).toMatchObject({ type: 'Box', props: { position: 'relative', width: '100%', height: '100%' } })
    expect(drawn.children?.[0]).toMatchObject({ type: 'Svg', props: { alt: "another mod's scene" } })
    const column = columnOf(drawn)
    expect(column?.props).toMatchObject({ position: 'absolute', top: 3, left: 3, flexDirection: 'column' })
    expect(column?.props?.right).toBe(undefined)
    const cards = (column?.children ?? []).filter(c => typeof c === 'object' && c !== null) as Drawn[]
    expect(cards).toHaveLength(2)
    for (const c of cards) expect(c.props).toMatchObject({ borderStyle: 'round', borderColor: '#7aa2f7', backgroundColor: '#0b0f1a' })
    expect(texts(column)).toEqual(CARDS)
    await ui.unmount()
  })

  test('the right column: by /scores right for the session, by the setting for good', { plugins: [SCENERY], options: { side: 'right' } }, async ($, on) => {
    const w = world(on)
    if (!(await hasBackdrop($))) return
    await w.start($, 'desktop')
    const ui = await mountBackdrop($, 'scenery', 'garden')
    expect(columnOf(await ui.drawn())?.props).toMatchObject({ right: 3 })
    await scores($, 'left')
    expect(columnOf(await ui.drawn())?.props).toMatchObject({ left: 3 })
    await scores($, 'right')
    expect(columnOf(await ui.drawn())?.props).toMatchObject({ right: 3 })
    await ui.unmount()
  })

  test('asked after a scene that lays what is beneath it over itself: the cards alone, laid over that scene', { plugins: [HOST] }, async ($, on) => {
    const w = world(on)
    if (!(await hasBackdrop($))) return
    await w.start($, 'desktop')
    const ui = await mountBackdrop($, 'host', 'den')
    const drawn = (await ui.drawn()) as Drawn
    expect(drawn.children?.[0]).toMatchObject({ type: 'Svg', props: { alt: "the host's scene" } })
    expect(drawn.children?.[1]).toMatchObject({ type: 'Box', props: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } })
    expect(texts(columnOf(drawn))).toEqual(CARDS)
    expect(texts(drawn).filter(t => t.includes('scene'))).toEqual([])
    await ui.unmount()
  })

  test('asked after a scene that answers alone: that scene stands, with no card', { plugins: [LONER] }, async ($, on) => {
    const w = world(on)
    if (!(await hasBackdrop($))) return
    await w.start($, 'desktop')
    const ui = await mountBackdrop($, 'loner', 'cave')
    expect(await ui.drawn()).toMatchObject({ type: 'Svg', props: { alt: "the loner's scene" } })
    await ui.unmount()
  })

  test('the cards move with the games, and leave when the games do or the mod is off for the session', { plugins: [SCENERY] }, async ($, on) => {
    const w = world(on)
    if (!(await hasBackdrop($))) return
    await w.start($, 'desktop')
    const ui = await mountBackdrop($, 'scenery', 'garden')
    await w.pass(60_000)
    expect(texts(columnOf(await ui.drawn()))[0]).toBe(captionOf(demoGames(AT + 60_001)[0]!))
    await scores($, 'off')
    expect(await ui.drawn()).toMatchObject({ type: 'Svg' })
    await w.pass(120_000)
    // No look while off: the games kept are those of the last look before it.
    await scores($, '')
    expect(w.rec.logs.at(-1)).toBe(`scorebug: ${demoGames(AT + 60_001).map(lineOf).join('; ')} (pretend games, off this session)`)
    await scores($, 'on')
    await w.pass(1)
    expect(texts(columnOf(await ui.drawn()))[0]).toBe(captionOf(demoGames(AT + 180_002)[0]!))
    await ui.unmount()
  })
})

describe('toasts', () => {
  test('through a whole round: one for each goal, one for the end of each game, and nothing for points along the way', async ($, on) => {
    const w = world(on)
    await w.start($)
    for (let ms = 0; ms < ROUND; ms += 30_000) await w.pass(30_000)
    const goals = w.rec.toasts.filter(t => !t.startsWith('Final: '))
    const finals = w.rec.toasts.filter(t => t.startsWith('Final: '))
    expect(finals).toHaveLength(2)
    expect(finals.filter(t => t.startsWith('Final: RDG '))).toHaveLength(1)
    expect(finals.filter(t => t.startsWith('Final: LKS '))).toHaveLength(1)
    expect(goals.length).toBeGreaterThan(0)
    for (const t of goals) expect(t).toMatch(/^(RDG|HBR)( and HBR)? scores?: RDG \d+, HBR \d+$/)
  })

  test('toasts off: none', { options: { alerts: false } }, async ($, on) => {
    const w = world(on)
    await w.start($)
    for (let ms = 0; ms < ROUND; ms += 30_000) await w.pass(30_000)
    expect(w.rec.toasts).toEqual([])
  })
})

describe('/scores', () => {
  test('writes the games, the feed and where they show; a word it does not know gets the usage', async ($, on) => {
    const w = world(on)
    await w.start($)
    await scores($, '')
    expect(w.rec.logs).toEqual([`scorebug: ${lineOf(one)}; ${lineOf(two)} (pretend games, cards in the left column over a scene)`])
    await scores($, 'sideways')
    expect(w.rec.logs[1]).toBe('scorebug: /scores, /scores on, /scores off, /scores left, /scores right; teams, feed and refresh are in /config')
    await scores($, 'off')
    await scores($, '')
    expect(w.rec.logs[2]).toContain('(pretend games, off this session)')
  })
})
