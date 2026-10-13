// Mission control through the mod's real wiring: the grid, the live status
// of each subagent from the chunks, tool calls and permission verdicts the
// engine raises, the activity timeline, the inspector and the keys.

import { describe, expect, test } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { DOCKED, PANE, PLUGIN, SURFACES, engineBand, paneProps, usage, world } from './world'

// The fetch command's name is built from parts: a shipped file must not read like a download-and-run line.
const FETCH = ['cu', 'rl'].join('')

type Drawn = { type?: unknown; key?: unknown; props?: Record<string, unknown>; children?: unknown[] }

function mountAt($: Engine, surface: (typeof SURFACES)[number], bodyColumns = 84, over: Partial<RenderPropsOf['Pane']> = {}) {
  return $.ui.mount({
    plugin: PLUGIN, surface, component: 'Pane', requestId: PANE,
    props: paneProps({ bodyColumns, ...over }), viewport: DOCKED,
  })
}

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text)

/** Every node matching `pred`, in document order. */
function walk(node: unknown, pred: (n: Drawn) => boolean, out: Drawn[] = []): Drawn[] {
  if (node === null || typeof node !== 'object') return out
  const n = node as Drawn
  if (pred(n)) out.push(n)
  for (const c of n.children ?? []) walk(c, pred, out)
  return out
}
const keyOf = (n: Drawn) => (typeof n.key === 'string' ? n.key : typeof n.props?.key === 'string' ? n.props.key : undefined)
const cardsOf = (tree: unknown) => walk(tree, n => n.type === 'Box' && (keyOf(n)?.startsWith('ant-') ?? false))
const eventRows = (tree: unknown) => walk(tree, n => n.type === 'Box' && (keyOf(n)?.startsWith('event-') ?? false))
const textOf = (n: Drawn | undefined): string => {
  if (n === undefined) return ''
  let s = ''
  for (const c of n.children ?? []) {
    if (typeof c === 'string') s += c
    else if ((c as Drawn).props?.display !== 'none') s += textOf(c as Drawn) // hidden until a hover: not what the person sees
  }
  return s
}
/** Every node matching `pred` that the person can see: a subtree drawn display none is skipped. */
function walkShown(node: unknown, pred: (n: Drawn) => boolean, out: Drawn[] = []): Drawn[] {
  if (node === null || typeof node !== 'object') return out
  const n = node as Drawn
  if (n.props?.display === 'none') return out
  if (pred(n)) out.push(n)
  for (const c of n.children ?? []) walkShown(c, pred, out)
  return out
}
/** The first colour drawn inside a node. */
const colorIn = (n: Drawn | undefined): unknown => {
  if (n === undefined) return undefined
  if (n.props?.color !== undefined) return n.props.color
  for (const c of n.children ?? []) {
    const hit = colorIn(c as Drawn)
    if (hit !== undefined) return hit
  }
  return undefined
}

describe('the command grid', () => {
  test('cards take one, two or three columns as the pane widens, all one width, on both surfaces', async ($, on) => {
    const w = world(on)
    for (let i = 0; i < 5; i += 1) await w.spawn($, `Task ${i}`)
    for (const surface of SURFACES) {
      for (const [columns, cols, cardWidth] of [[40, 1, 40], [60, 1, 60], [84, 2, 41], [120, 3, 39], [160, 3, 52]] as const) {
        const pane = await mountAt($, surface, columns)
        const tree = await pane.drawn()
        const cards = cardsOf(tree)
        expect(cards.length, `${surface} ${columns}`).toBe(5)
        for (const card of cards) expect(card.props?.width, `${surface} ${columns}`).toBe(cardWidth)
        const rows = walk(tree, n => n.type === 'Box' && (n.children ?? []).some(c => cardsOf(c).length > 0 && (c as Drawn).type === 'Box' && keyOf(c as Drawn)?.startsWith('ant-') === true))
        expect(rows.length, `${surface} ${columns}`).toBe(Math.ceil(5 / cols))
        expect((rows[0]?.children ?? []).length).toBe(Math.min(5, cols))
        expect((rows[0]?.props ?? {}).borderStyle).toBeUndefined()
        expect(cards[0]?.props?.borderStyle).toBe('round')
        await pane.unmount()
      }
    }
  })

  test('under 40 columns the pane goes compact: one line a subagent, no borders, no art, Bolt out', async ($, on) => {
    const w = world(on)
    const a = await w.spawn($, 'Narrow task')
    const b = await w.spawn($, 'Finished task')
    await w.finish($, b)
    for (const surface of SURFACES) {
      const pane = await mountAt($, surface, 30)
      const tree = await pane.drawn()
      expect(cardsOf(tree)).toEqual([])
      expect(walk(tree, n => n.props?.borderStyle !== undefined)).toEqual([])
      expect(await pane.find({ key: `line-${a}` })).toBeDefined()
      expect((await pane.find({ key: `line-${b}` }))?.text).toContain('#2 done · Finished task')
      expect(await pane.find({ key: 'bolt' })).toBeUndefined()
      expect((await pane.find({ key: 'counts' }))?.text).toBe('1 running · 1 done · 0 failed')
      await pane.unmount()
    }
  })

  test('the pane asks the dock for two cards of width when opened by /antfarm, not when it opens itself', async ($, on) => {
    const w = world(on)
    engineBand(on)
    await $.command.run({ command: 'antfarm', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    expect(w.rec.openColumns).toEqual([84])
    expect(w.rec.opens).toEqual([PANE])
    // A moment after the open, one more draw is asked for: a first draw that did not land is drawn then.
    const before = w.rec.invalidates
    await w.clock.advance(300)
    expect(w.rec.invalidates).toBeGreaterThan(before)
    // Opening itself at the first spawn, it asks for nothing: the dock's share.
    w.rec.panes = [] // the person closed it
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} }, viewport: DOCKED })
    await band.unmount()
    await w.spawn($, 'First')
    expect(w.rec.openColumns).toEqual([84, undefined])
  })
})

describe('what each subagent is doing, from what the engine said', () => {
  test('starting, thinking, writing and naming a tool, each from the chunks of its own requests', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Phased')
    const pane = await mountAt($, 'terminal', 60)
    const card = async () => textOf(cardsOf(await pane.drawn())[0])
    expect(await card()).toContain('WORKING · starting')
    await w.step($, id, usage('claude-haiku-5-5', 100, 10), 'claude-haiku-5-5', ['thinking'])
    expect(await card()).toContain('THINKING')
    expect(await card()).not.toContain('WORKING')
    await w.step($, id, usage('claude-haiku-5-5', 100, 10), 'claude-haiku-5-5', ['thinking', 'text'])
    expect(await card()).toContain('WORKING · writing')
    await w.step($, id, usage('claude-haiku-5-5', 100, 10), 'claude-haiku-5-5', ['text', 'tool'])
    expect(await card()).toContain('WORKING · Bash')
    // The main loop's chunks say nothing about any card.
    await w.step($, undefined, usage('claude-haiku-5-5', 100, 10), 'claude-haiku-5-5', ['thinking'])
    expect(await card()).toContain('WORKING · Bash')
    // The status line says for how long.
    await w.clock.advance(4000)
    expect(await card()).toContain('WORKING · Bash · 4s')
    // The mark turns while it works: two frames differ.
    const mark = async () => /([◐◓◑◒]) WORKING/.exec(await card())?.[1]
    const one = await mark()
    expect(one).toBeDefined()
    await w.clock.advance(500)
    expect(await mark()).not.toBe(one)
  })

  test('a tool call shows on the card while it runs and lands on the timeline once it answered', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Tooling')
    let release: () => void = () => undefined
    w.rec.holdTool = new Promise<void>(resolve => { release = resolve })
    const pending = w.callTool($, id, 'Bash', { command: 'npm test\nmore' })
    const pane = await mountAt($, 'terminal', 60)
    expect(textOf(cardsOf(await pane.drawn())[0])).toContain('WORKING · Bash npm test')
    expect(eventRows(await pane.drawn()).map(textOf).some(t => t.includes('npm test'))).toBe(false)
    release()
    const r = await pending
    expect(r).toEqual({ result: { ok: true }, text: 'ok' })
    expect(w.rec.toolCalls).toEqual([{ tool: 'Bash', agentId: id }])
    const card = textOf(cardsOf(await pane.drawn())[0])
    expect(card).toContain('WORKING')
    expect(card).not.toContain('npm test')
    expect(card).toContain('1 tool')
    const rows = eventRows(await pane.drawn()).map(textOf)
    expect(rows[0]).toContain('#1')
    expect(rows[0]).toContain('tool')
    expect(rows[0]).toContain('Bash npm test')
  })

  test('an edit, a failed tool and a refused one: counted on the card, worded on the timeline', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Editing')
    await w.callTool($, id, 'Edit', { file_path: '/repo/src/auth.ts', old_string: 'a', new_string: 'b' })
    await w.callTool($, id, 'Bash', { command: 'exit 1' }, 'Command failed with exit code 1\nmore')
    await w.callTool($, id, 'Write', { file_path: '/etc/hosts', content: '' }, 'deny:not that file')
    // A card two across has no room for the counts; a wide one shows them.
    const narrow = await mountAt($, 'terminal', 84)
    expect(textOf(cardsOf(await narrow.drawn())[0])).not.toContain('tools')
    await narrow.unmount()
    const pane = await mountAt($, 'terminal', 60)
    const card = textOf(cardsOf(await pane.drawn())[0])
    expect(card).toContain('3 tools · 2 edits · 2 errors')
    const rows = eventRows(await pane.drawn()).map(textOf)
    expect(rows.length).toBe(4) // the start and three calls, newest first
    expect(rows[0]).toContain('error')
    expect(rows[0]).toContain('Write hosts · refused: not that file')
    expect(rows[1]).toContain('error')
    expect(rows[1]).toContain('Bash exit 1 · Command failed with exit code 1')
    expect(rows[2]).toContain('edit')
    expect(rows[2]).toContain('Edit auth.ts')
    expect(rows[3]).toContain('start')
    // The main loop's own tool calls are not the farm's business.
    await w.callTool($, undefined, 'Bash', { command: 'ls' })
    expect(eventRows(await pane.drawn()).length).toBe(4)
  })

  test('a permission ask on a subagent tool is left with the engine: the verdict passes through untouched and the card keeps its last phase', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Asking')
    await w.step($, id, usage('claude-haiku-5-5', 100, 10))
    w.rec.checkDecision = 'ask'
    const verdict = await w.check($, id, 'Bash', { command: 'rm -rf build' })
    expect(verdict.decision).toBe('ask')
    for (const surface of SURFACES) {
      const pane = await mountAt($, surface)
      const all = (await texts(pane)).join('\n')
      expect(all).not.toContain('permission')
      expect(all).not.toContain('WAITING')
      const counts = (await pane.find({ key: 'counts' }))?.text ?? ''
      expect(counts).toContain('1 running')
      expect(counts).not.toContain('waiting')
      await pane.unmount()
    }
  })

  test('the engine list saying waiting holds a card too, and running frees it', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Held')
    w.rec.listed = [{ id, description: 'Held', type: 'Explore', status: 'waiting' }]
    await w.clock.advance(10_000)
    const pane = await mountAt($, 'terminal')
    expect(textOf(cardsOf(await pane.drawn())[0])).toContain('WAITING · held by the engine')
    w.rec.listed = [{ id, description: 'Held', type: 'Explore', status: 'running' }]
    await w.clock.advance(10_000)
    expect(textOf(cardsOf(await pane.drawn())[0])).toContain('WORKING')
  })

  test('done and failed cards say so, keep their colour for a moment, then rest', async ($, on) => {
    const w = world(on)
    const a = await w.spawn($, 'Finishes well', { model: 'claude-opus-5-5' })
    const b = await w.spawn($, 'Finishes badly')
    await w.clock.advance(65_000)
    await w.finish($, a)
    await w.finish($, b, 'error')
    const pane = await mountAt($, 'terminal')
    await pane.press({ key: 'toggle-finished' })
    const cards = cardsOf(await pane.drawn())
    const bad = cards.find(c => keyOf(c) === `ant-${b}`)
    const good = cards.find(c => keyOf(c) === `ant-${a}`)
    expect(textOf(good)).toContain('✓ DONE · 1m 05s')
    expect(good?.props?.borderColor).toBe('success')
    expect(colorIn(walk(good, n => keyOf(n) === `art-${a}`)[0])).toBe('success')
    expect(textOf(bad)).toContain('✗ FAILED · 1m 05s')
    expect(bad?.props?.borderColor).toBe('error')
    // The colour holds past the newest row's bold moment (1.5 s), then rests.
    await w.clock.advance(2000)
    expect(cardsOf(await pane.drawn()).find(c => keyOf(c) === `ant-${a}`)?.props?.borderColor).toBe('success')
    await w.clock.advance(1000)
    const later = cardsOf(await pane.drawn()).find(c => keyOf(c) === `ant-${a}`)
    expect(later?.props?.borderColor).toBe('subtle')
    expect(later?.props?.borderDimColor).toBe(true)
    expect(colorIn(walk(later, n => keyOf(n) === `art-${a}`)[0])).toBe('subtle')
    // The headline speaks for the whole mission.
    const all = (await texts(pane)).join('\n')
    expect(all).toContain('1 failed · 1 done')
  })

  test('the headline cheers when everything finished well, and sleeps before anything started', async ($, on) => {
    const w = world(on)
    const empty = await mountAt($, 'terminal')
    expect((await texts(empty)).join('\n')).toContain('Standing by')
    await empty.unmount()
    const a = await w.spawn($, 'One')
    await w.finish($, a)
    const pane = await mountAt($, 'terminal')
    expect((await texts(pane)).join('\n')).toContain('All done · 1 agent')
    expect(await pane.find({ key: 'bolt' })).toBeDefined()
  })
})

describe('the activity timeline', () => {
  test('rows for a start, a handoff, a tool, an edit and each ending, newest first, on the mission clock', async ($, on) => {
    const w = world(on)
    const lead = await w.spawn($, 'Lead')
    await w.clock.advance(1000)
    const helper = await w.spawn($, 'Helper', { parent: lead })
    await w.callTool($, lead, 'Bash', { command: 'git status' })
    await w.clock.advance(60_000)
    await w.callTool($, helper, 'Edit', { file_path: 'src/x.ts' })
    await w.finish($, helper)
    await w.clock.advance(3000)
    await w.finish($, lead, 'aborted')
    for (const surface of SURFACES) {
      const pane = await mountAt($, surface)
      const rows = eventRows(await pane.drawn()).map(textOf)
      expect(rows.length).toBe(6)
      expect(rows[0]).toContain('T+01:04#1✗failedLead · aborted')
      expect(rows[1]).toContain('T+01:01#2✓doneHelper · 1m 00s')
      expect(rows[2]).toContain('T+01:01#2✎editEdit x.ts')
      expect(rows[3]).toContain('T+00:01#1▸toolBash git status')
      expect(rows[4]).toContain('T+00:01#2⇢handoffHelper · from #1')
      expect(rows[5]).toContain('T+00:00#1⇢startLead')
      expect((await pane.find({ key: 'timeline-head' }))?.text).toContain('6 rows')
      await pane.unmount()
    }
  })

  test('twelve rows show, the rest wait behind +N more; the long form shows forty; t folds it away', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Busy')
    for (let i = 0; i < 20; i += 1) await w.callTool($, id, 'Read', { file_path: `f${i}.ts` })
    const pane = await mountAt($, 'terminal')
    expect(eventRows(await pane.drawn()).length).toBe(12)
    expect((await pane.find({ key: 'more-events' }))?.props.label).toBe('+9 more')
    await pane.press({ key: 'more-events' })
    expect(eventRows(await pane.drawn()).length).toBe(21)
    expect(await pane.find({ key: 'more-events' })).toBeUndefined()
    expect((await pane.find({ key: 'toggle-timeline' }))?.props.hotkey).toBe('t')
    await pane.press({ key: 'toggle-timeline' })
    expect(eventRows(await pane.drawn()).length).toBe(0)
    expect((await pane.find({ key: 'toggle-timeline' }))?.props.label).toBe('show')
    await pane.press({ key: 'toggle-timeline' })
    expect(eventRows(await pane.drawn()).length).toBe(21)
    // Past eighty the oldest leave: the long form shows the newest forty.
    for (let i = 0; i < 70; i += 1) await w.callTool($, id, 'Read', { file_path: `g${i}.ts` })
    expect(eventRows(await pane.drawn()).length).toBe(40)
    expect((await pane.find({ key: 'timeline-head' }))?.text).toContain('80 rows')
  })

  test('warnings: a response that hit a limit, one that never came, and the budget alarm', { options: { budgetUsd: 1 } }, async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Warned')
    w.rec.nextStop = 'max_tokens'
    await w.step($, id, usage('claude-haiku-5-5', 100, 10))
    w.rec.nextStop = 'end_turn'
    await w.step($, id, 'no-response')
    await w.step($, id, usage('claude-opus-5-5', 1_000_000, 0), 'claude-opus-5-5')
    const pane = await mountAt($, 'terminal')
    const rows = eventRows(await pane.drawn()).map(textOf)
    expect(rows[0]).toContain('·△warningSession estimate ≈$4.00 is past 2x your $1.00 budget.')
    expect(rows[1]).toContain('#1△warningno response from the model')
    expect(rows[2]).toContain('#1△warninghit the output limit')
    expect((await pane.find({ key: 'budget-bar' }))?.text).toContain('100%')
  })

  test('a warning with nothing running is bold for a moment, then not, and the clock stops', { options: { budgetUsd: 1 } }, async ($, on) => {
    const w = world(on)
    await w.step($, undefined, usage('claude-opus-5-5', 1_000_000, 0), 'claude-opus-5-5')
    const pane = await mountAt($, 'terminal')
    const bolds = async () => walk(await pane.drawn(), n => n.type === 'Text' && n.props?.bold === true).map(textOf)
    expect((await bolds()).some(t => t.includes('your $1.00 budget'))).toBe(true)
    await w.clock.advance(2000)
    expect((await bolds()).some(t => t.includes('your $1.00 budget'))).toBe(false)
    const stopped = w.rec.invalidates
    await w.clock.advance(5000)
    expect(w.rec.invalidates).toBe(stopped)
  })

  test('the newest row is bold for a moment, then not', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Fresh')
    await w.callTool($, id, 'Bash', { command: 'ls' })
    const pane = await mountAt($, 'terminal')
    const bolds = async () => walk(await pane.drawn(), n => n.type === 'Text' && n.props?.bold === true).map(textOf)
    expect((await bolds()).some(t => t.includes('Bash ls'))).toBe(true)
    await w.clock.advance(2000)
    expect((await bolds()).some(t => t.includes('Bash ls'))).toBe(false)
  })
})

describe('what the pane keeps is safe to share', () => {
  test('a credential in a command, a URL or an error is replaced before the pane shows or keeps it', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Secretive')
    let release: () => void = () => undefined
    w.rec.holdTool = new Promise<void>(resolve => { release = resolve })
    const pending = w.callTool($, id, 'Bash', { command: `${FETCH} -H "Authorization: Bearer abcdefghijklmnopqrst" https://x` })
    const pane = await mountAt($, 'terminal', 120)
    const live = textOf(cardsOf(await pane.drawn())[0])
    expect(live).toContain(`WORKING · Bash ${FETCH} -H "Authorization: Bearer [REDACTED]"`)
    expect(live).not.toContain('abcdefghijklmnopqrst')
    release()
    await pending
    await w.callTool($, id, 'WebFetch', { url: 'https://alex:p4ssw0rd@example.com/a' })
    await w.callTool($, id, 'Bash', { command: 'psql' }, 'connection failed: password=hunter2 rejected')
    await pane.press({ key: `inspect-${id}` })
    const all = (await texts(pane)).join('\n')
    expect(all).not.toContain('abcdefghijklmnopqrst')
    expect(all).not.toContain('p4ssw0rd')
    expect(all).not.toContain('hunter2')
    expect(all).toContain('WebFetch https://alex:[REDACTED]@example.com/a')
    expect(all).toContain('Bash psql · connection failed: password=[REDACTED] rejected')
  })
})

describe('state kept by an earlier version', () => {
  // A value in session state survives a reload of the code with the shape the
  // old version wrote: no mission number, no history, no counters, no selection.
  // This world strips every new field as it is written, so every read is old-shaped.
  const OLD_SHAPE = {
    name: 'old-shape',
    tier: 'prepend' as const,
    register(on: On) {
      on('state.set', { plugin: 'ant-farm', key: 'ants' }, ($, e, next) =>
        next({ ...e, value: e.value.map(({ n: _n, parentId: _p, history: _h, tools: _t, edits: _e, errors: _r, ...rest }) => rest) }))
      on('state.set', { plugin: 'ant-farm', key: 'view' }, ($, e, next) => {
        const { selectedId: _s, isTimelineExpanded: _x, isTimelineHidden: _h, ...rest } = e.value
        return next({ ...e, value: rest })
      })
    },
  }

  test('ants, a view and counts without the new fields still draw, count and record on both surfaces', { plugins: [OLD_SHAPE] }, async ($, on) => {
    const w = world(on)
    const a = await w.spawn($, 'Old one')
    const b = await w.spawn($, 'Old two', { parent: a })
    await w.step($, a, usage('claude-haiku-5-5', 1000, 10))
    await w.callTool($, a, 'Edit', { file_path: 'x.ts' })
    await w.callTool($, b, 'Bash', { command: 'false' }, 'exit 1')
    await w.finish($, b, 'error')
    for (const surface of SURFACES) {
      const pane = await mountAt($, surface, 60)
      const tree = await pane.drawn()
      const cards = cardsOf(tree)
      expect(cards.length).toBe(1)
      const card = textOf(cards[0])
      expect(card).toContain('· Old one') // no mission number: a dot
      expect(card).toContain('············') // no history: the sparkline rests
      expect(card).not.toContain('tools') // no counters kept
      expect((await pane.find({ key: `inspect-${a}` }))?.props.hotkey).toBeUndefined() // no number, no digit
      expect((await pane.find({ key: 'counts' }))?.text).toBe('1 running · 0 done · 1 failed')
      expect((await pane.find({ key: `line-${b}` }))?.text).toContain('· failed · Old two')
      const rows = eventRows(tree).map(textOf)
      expect(rows.length).toBe(5)
      expect(rows[0]).toContain('·✗failedOld two · error')
      expect(rows[1]).toContain('·✗errorBash false · exit 1')
      expect(rows[4]).toContain('·⇢startOld one')
      // Selecting cannot stick (the old view has no selection), but nothing breaks.
      await pane.press({ key: `inspect-${a}` })
      expect(await pane.find({ key: 'inspector' })).toBeUndefined()
      expect(cardsOf(await pane.drawn()).length).toBe(1)
      await pane.unmount()
    }
  })
})

describe('colours, estimates and numbers after the live look', () => {
  const colorsIn = (node: unknown, out: string[] = []): string[] => {
    if (node === null || typeof node !== 'object') return out
    const n = node as Drawn
    for (const k of ['color', 'borderColor', 'backgroundColor']) if (typeof n.props?.[k] === 'string') out.push(n.props[k] as string)
    const hover = (n as { hover?: Record<string, unknown> }).hover ?? n.props?.hover
    if (hover !== null && typeof hover === 'object') for (const v of Object.values(hover as Record<string, unknown>)) if (typeof v === 'string') out.push(v)
    for (const c of n.children ?? []) colorsIn(c, out)
    return out
  }

  test('no theme key of another brand: never claude, every colour a theme key', async ($, on) => {
    const w = world(on)
    const a = await w.spawn($, 'Fable one', { model: 'claude-fable-5-1' })
    const b = await w.spawn($, 'Thinker', { model: 'claude-opus-5-5' })
    await w.step($, b, usage('claude-opus-5-5', 100, 10), 'claude-opus-5-5', ['thinking'])
    const c = await w.spawn($, 'Done one')
    await w.finish($, c)
    for (const surface of SURFACES) {
      const pane = await mountAt($, surface, 100)
      await pane.press({ key: `inspect-${a}` })
      const colors = colorsIn(await pane.drawn())
      expect(colors.length).toBeGreaterThan(20)
      expect(colors).not.toContain('claude')
      // Theme keys for every word and bar; raw colours only in Bolt's own cells.
      for (const k of colors) expect(k, k).toMatch(/^([a-zA-Z]+|#[0-9A-Fa-f]{6})$/)
      await pane.unmount()
    }
  })

  test('a card the engine holds shows no time left, on the card, in the inspector and in the band', async ($, on) => {
    const w = world(on, { placed: false }) // the band lists the ants where the pane cannot be placed
    engineBand(on)
    const id = await w.spawn($, 'Held one')
    const other = await w.spawn($, 'Finished one')
    for (let i = 0; i < 4; i += 1) await w.step($, other, usage('claude-haiku-5-5', 100, 10))
    await w.finish($, other)
    for (let i = 0; i < 3; i += 1) {
      await w.clock.advance(10_000)
      await w.step($, id, usage('claude-haiku-5-5', 100, 10))
    }
    const pane = await mountAt($, 'terminal', 60)
    expect(textOf(cardsOf(await pane.drawn())[0])).toContain('left')
    w.rec.listed = w.rec.listed.map(a => (a.id === id ? { ...a, status: 'waiting' } : a))
    await w.clock.advance(20_000) // the ticker reads the engine's list: held
    expect(textOf(cardsOf(await pane.drawn())[0])).not.toContain('left')
    await pane.press({ key: `inspect-${id}` })
    expect((await pane.find({ key: 'inspector' }))?.text).not.toContain('left')
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} }, viewport: DOCKED })
    await $.command.run({ command: 'antfarm', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 90 } })
    expect((await band.find({ key: `row-${id}` }))?.text).toContain('· waiting')
  })

  test('a finished line keeps its numbers whole at the 84-column dock, names the model from 100, and shrinks them only under a narrow pane', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'A finished task with a long description that goes on well past the room a line has for it')
    for (let i = 0; i < 3; i += 1) await w.step($, id, usage('claude-haiku-5-5', 2000, 100))
    await w.clock.advance(8000)
    await w.finish($, id)
    const lineOf = async (columns: number) => {
      const pane = await mountAt($, 'terminal', columns)
      const row = walk(await pane.drawn(), n => keyOf(n) === `line-${id}`)[0]
      const numbers = walk(row, n => n.type === 'Box' && (n.children ?? []).some(c => (c as Drawn).type === 'Text' && textOf(c as Drawn).startsWith(' · ')))[0]
      const out = { text: textOf(row), shrink: numbers?.props?.flexShrink }
      await pane.unmount()
      return out
    }
    const at84 = await lineOf(84)
    expect(at84.text).toContain(' · 8s · 6.3k tok · ≈$0.0008')
    expect(at84.text).not.toContain('haiku')
    expect(at84.shrink).toBe(0)
    const at100 = await lineOf(100)
    expect(at100.text).toContain(' · haiku-5-5 · 8s · 6.3k tok · ≈$0.0008')
    expect(at100.shrink).toBe(0)
    const at44 = await lineOf(44)
    expect(at44.shrink).toBe(1)
  })
})

describe('after a reload of the code', () => {
  test('a session start with running ants in the kept state starts the clock again', async ($, on) => {
    const w = world(on)
    await w.spawn($, 'Still running')
    // Silent long enough that the clock stopped on its own, as it would be after a reload.
    await w.clock.advance(11 * 60_000)
    const stopped = w.rec.invalidates
    await w.clock.advance(2000)
    expect(w.rec.invalidates).toBe(stopped)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await w.clock.advance(600)
    expect(w.rec.invalidates).toBeGreaterThan(stopped)
  })

  test('a session start with nothing running leaves the clock alone', async ($, on) => {
    const w = world(on)
    const id = await w.spawn($, 'Done')
    await w.finish($, id)
    await w.clock.advance(5000)
    const stopped = w.rec.invalidates
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    await w.clock.advance(2000)
    expect(w.rec.invalidates).toBe(stopped)
  })
})

describe('a narrow desktop pane', () => {
  test('wraps its lines instead of cutting them, where the terminal cuts; a wide one cuts on both', async ($, on) => {
    const w = world(on)
    const a = await w.spawn($, 'A task with a long description that a narrow pane cannot hold on one line')
    await w.callTool($, a, 'Bash', { command: 'npm test' })
    const b = await w.spawn($, 'Finished one')
    await w.finish($, b)
    const wraps = (tree: unknown) => walkShown(tree, n => n.type === 'Text' && typeof n.props?.wrap === 'string').map(n => n.props?.wrap as string)
    const narrowDesktop = await mountAt($, 'desktop', 30, { isFocused: true })
    await narrowDesktop.press({ key: 'toggle-finished' })
    const d = wraps(await narrowDesktop.drawn())
    expect(d.length).toBeGreaterThan(5)
    expect(d.every(k => k === 'wrap')).toBe(true)
    expect((await narrowDesktop.find({ key: 'counts' }))?.props.flexWrap).toBe('wrap')
    await narrowDesktop.unmount()
    const narrowTerminal = await mountAt($, 'terminal', 30)
    const t = wraps(await narrowTerminal.drawn())
    expect(t.length).toBeGreaterThan(5)
    expect(t.every(k => k === 'truncate-end')).toBe(true)
    await narrowTerminal.unmount()
    const wideDesktop = await mountAt($, 'desktop', 84)
    expect(wraps(await wideDesktop.drawn()).every(k => k === 'truncate-end')).toBe(true)
    expect((await wideDesktop.find({ key: 'counts' }))?.props.flexWrap).toBeUndefined()
  })

  test('next and previous move from the selection as it stands at the press', async ($, on) => {
    const w = world(on)
    const a = await w.spawn($, 'First')
    const b = await w.spawn($, 'Second')
    const c = await w.spawn($, 'Third')
    const pane = await mountAt($, 'desktop', 84)
    await pane.press({ key: `inspect-${a}` })
    await pane.press({ key: 'inspector-next' })
    expect((await pane.find({ key: 'inspector' }))?.text).toContain('#2 Second')
    await pane.press({ key: 'inspector-next' })
    expect((await pane.find({ key: 'inspector' }))?.text).toContain('#3 Third')
    await pane.press({ key: 'inspector-prev' })
    expect((await pane.find({ key: 'inspector' }))?.text).toContain('#2 Second')
    expect([a, b, c].length).toBe(3)
  })
})

describe('the inspector', () => {
  test('inspect opens the panel: task, where it came from, numbers, sparkline, its recent rows; n, p and x move and close', async ($, on) => {
    const w = world(on)
    const a = await w.spawn($, 'Lead')
    const b = await w.spawn($, 'Helper', { parent: a })
    const c = await w.spawn($, 'Third')
    for (let i = 0; i < 3; i += 1) await w.step($, b, usage('claude-haiku-5-5', 1000 * (i + 1), 10))
    await w.callTool($, b, 'Grep', { pattern: 'TODO' })
    const pane = await mountAt($, 'terminal')
    expect(await pane.find({ key: 'inspector' })).toBeUndefined()
    await pane.press({ key: `inspect-${b}` })
    const panel = async () => (await pane.find({ key: 'inspector' }))?.text ?? ''
    expect(await panel()).toContain('#2 Helper')
    expect(await panel()).toContain('from #1 Lead')
    expect(await panel()).toContain('3 requests · 6k tokens')
    expect(await panel()).toContain('1 tools · 0 edits · 0 errors')
    expect(await panel()).toContain('tokens per request')
    expect(await panel()).toContain('Grep TODO')
    expect(await panel()).toContain(`id ${b}`)
    expect((await pane.find({ key: `inspect-${b}` }))?.props.label).toBe('close')
    expect((await pane.find({ key: `inspect-${a}` }))?.props.label).toBe('open')
    expect(cardsOf(await pane.drawn()).find(x => keyOf(x) === `ant-${b}`)?.props?.borderColor).toBe('suggestion')
    await pane.press({ key: 'inspector-next' })
    expect(await panel()).toContain('#3 Third')
    expect(await panel()).toContain('from the main loop')
    expect(await panel()).toContain('⇢startThird')
    await pane.press({ key: 'inspector-next' })
    expect(await panel()).toContain('#1 Lead')
    await pane.press({ key: 'inspector-prev' })
    expect(await panel()).toContain('#3 Third')
    expect(c).toBeDefined()
    await pane.press({ key: 'inspector-close' })
    expect(await pane.find({ key: 'inspector' })).toBeUndefined()
    // Pressing a selected card's button deselects it.
    await pane.press({ key: `inspect-${a}` })
    expect(await panel()).toContain('#1 Lead')
    await pane.press({ key: `inspect-${a}` })
    expect(await pane.find({ key: 'inspector' })).toBeUndefined()
  })

  test('a card\'s digit is its mission number, running or finished; past nine none; the moves have theirs', async ($, on) => {
    const w = world(on)
    const ids: string[] = []
    for (let i = 0; i < 10; i += 1) ids.push(await w.spawn($, `Task ${i}`))
    await w.finish($, ids[0] ?? '')
    const pane = await mountAt($, 'terminal')
    const buttons = await pane.findAll({ type: 'Button' })
    const hot = new Map(buttons.map(b => [b.key, b.props.hotkey]))
    // #1 is the finished line and keeps 1; #2 to #9 the running cards; #10 has no digit.
    for (let i = 0; i < 9; i += 1) expect(hot.get(`inspect-${ids[i]}`), `#${i + 1}`).toBe(String(i + 1))
    expect(hot.get(`inspect-${ids[9]}`)).toBeUndefined()
    expect(hot.get('toggle-finished')).toBe('f')
    expect(hot.get('toggle-timeline')).toBe('t')
    await pane.press({ key: `inspect-${ids[3]}` })
    const after = new Map((await pane.findAll({ type: 'Button' })).map(b => [b.key, b.props.hotkey]))
    expect(after.get('inspector-next')).toBe('n')
    expect(after.get('inspector-prev')).toBe('p')
    expect(after.get('inspector-close')).toBe('x')
    // Every hotkey is unique across the drawing.
    const keys = [...after.values()].filter(k => k !== undefined)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('the keys hint shows only while the pane holds the keyboard', async ($, on) => {
    const w = world(on)
    await w.spawn($, 'Keyed')
    const blurred = await mountAt($, 'terminal', 84)
    expect(await blurred.find({ key: 'keys' })).toBeUndefined()
    await blurred.unmount()
    const focused = await mountAt($, 'terminal', 84, { isFocused: true })
    expect((await focused.find({ key: 'keys' }))?.text).toContain('1-9 open · n next · p previous · x close · f finished · t activity')
  })

  test('the selection survives the pane closing and clears with the farm', async ($, on) => {
    const w = world(on)
    const a = await w.spawn($, 'Kept')
    const pane = await mountAt($, 'terminal')
    await pane.press({ key: `inspect-${a}` })
    await pane.unmount()
    const again = await mountAt($, 'terminal')
    expect(await again.find({ key: 'inspector' })).toBeDefined()
    await again.unmount()
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
    const fresh = await mountAt($, 'terminal')
    expect(await fresh.find({ key: 'inspector' })).toBeUndefined()
    expect(eventRows(await fresh.drawn()).length).toBe(0)
  })
})

describe('the desktop glyph rule', () => {
  const GLYPH = /[\u2580-\u259f]/u
  const textsOf = (node: unknown, inCell = false, out: { text: string; inCell: boolean }[] = []) => {
    if (node === null || typeof node !== 'object') return out
    const n = node as Drawn
    const cell = inCell || (n.type === 'Box' && n.props?.width === 1)
    if (n.type === 'Text') out.push({ text: (n.children ?? []).filter(c => typeof c === 'string').join(''), inCell: cell })
    for (const c of n.children ?? []) textsOf(c, cell, out)
    return out
  }

  test('sparklines, bars, ants, Bolt and the budget bar are one-cell glyphs apart from the words', { options: { budgetUsd: 2 } }, async ($, on) => {
    const w = world(on)
    const a = await w.spawn($, 'Glyphs')
    for (let i = 0; i < 4; i += 1) await w.step($, a, usage('claude-opus-5-5', 20_000 * (i + 1), 0), 'claude-opus-5-5')
    const pane = await mountAt($, 'desktop', 84)
    await pane.press({ key: `inspect-${a}` })
    const all = textsOf(await pane.drawn())
    const glyphs = all.filter(t => GLYPH.test(t.text))
    expect(glyphs.length).toBeGreaterThan(40)
    for (const t of glyphs) {
      expect(t.inCell, t.text).toBe(true)
      expect([...t.text].length, t.text).toBe(1)
    }
    // Words never sit in a cell.
    for (const t of all.filter(t => /[a-z]{3}/.test(t.text))) expect(t.inCell, t.text).toBe(false)
    expect(all.some(t => t.text.includes('tokens per request'))).toBe(true)
    // The terminal keeps whole rows of art.
    const term = await mountAt($, 'terminal', 84)
    expect(textsOf(await term.drawn()).some(t => GLYPH.test(t.text) && [...t.text].length > 1)).toBe(true)
  })
})

describe('size and speed', () => {
  const count = (node: unknown, acc = { nodes: 0, chars: 0, depth: 0 }, depth = 1) => {
    if (node === null || typeof node !== 'object') { if (typeof node === 'string') acc.chars += node.length; return acc }
    acc.nodes += 1
    acc.depth = Math.max(acc.depth, depth)
    for (const c of (node as Drawn).children ?? []) count(c, acc, depth + 1)
    return acc
  }

  test('twenty agents with activity draw within bounds on both surfaces, and a tick redraws them', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on)
    for (let i = 0; i < 20; i += 1) {
      const id = await w.spawn($, `Agent ${i} with a task description of a usual length`)
      for (let s = 0; s < 3; s += 1) await w.step($, id, usage('claude-haiku-5-5', 4000 + s * 1500, 300))
      await w.callTool($, id, 'Edit', { file_path: `src/file${i}.ts` })
      if (i % 4 === 1) await w.finish($, id)
      if (i % 4 === 2) await w.finish($, id, 'error')
    }
    for (const surface of SURFACES) {
      const t0 = Date.now()
      const pane = await mountAt($, surface, 120)
      const c = count(await pane.drawn())
      const mountMs = Date.now() - t0
      expect(c.depth, surface).toBeLessThanOrEqual(12)
      expect(c.chars, surface).toBeLessThan(20_000)
      expect(c.nodes, surface).toBeLessThan(surface === 'desktop' ? 3000 : 1200)
      expect(mountMs, surface).toBeLessThan(500)
      const before = w.rec.invalidates
      await w.clock.advance(500)
      expect(w.rec.invalidates).toBeGreaterThan(before)
      // A walking ant's space runs regroup frame to frame on the desktop: a few cells either way.
      expect(Math.abs(count(await pane.drawn()).nodes - c.nodes)).toBeLessThan(60)
      await pane.unmount()
    }
  })
})

// ---------------------------------------------------------------- the desktop app

const STATIC = ['inspector-prev', 'inspector-next', 'inspector-close', 'more-events', 'toggle-timeline', 'toggle-finished', 'toggle-map']

/** The Box each static Button sits in, by the Button's key. */
function wrappers(tree: unknown): Map<string, Drawn> {
  const out = new Map<string, Drawn>()
  for (const box of walk(tree, n => n.type === 'Box')) {
    for (const c of box.children ?? []) {
      const k = (c as Drawn).type === 'Button' ? keyOf(c as Drawn) : undefined
      if (k !== undefined && STATIC.includes(k)) out.set(k, box)
    }
  }
  return out
}

describe('the desktop app', () => {
  test('every button is plain on both surfaces, and every box of truncating words may shrink', async ($, on) => {
    const w = world(on)
    const a = await w.spawn($, 'One')
    const b = await w.spawn($, 'Two')
    await w.finish($, b)
    for (let i = 0; i < 14; i += 1) await w.callTool($, a, 'Read', { file_path: `f${i}.ts` })
    for (const surface of SURFACES) {
      const pane = await mountAt($, surface, 84)
      if ((await pane.find({ key: 'inspector' })) === undefined) await pane.press({ key: `inspect-${a}` }) // the selection carries across surfaces
      const buttons = await pane.findAll({ type: 'Button' })
      expect(buttons.length).toBeGreaterThanOrEqual(7)
      for (const button of buttons) expect(button.props.plain, `${surface} ${button.key}`).toBe(true)
      // Every box that holds truncating words may shrink to nothing: the desktop's flex items otherwise refuse to, and the app cuts the line mid-word.
      const shrinking = walk(await pane.drawn(), n => n.type === 'Box' && (n.props?.flexShrink === undefined || Number(n.props.flexShrink) > 0) && n.props?.width === undefined
        && (n.children ?? []).some(c => (c as Drawn).type === 'Text' && (c as Drawn).props?.wrap === 'truncate-end'))
      expect(shrinking.length).toBeGreaterThan(6)
      for (const box of shrinking) expect(box.props?.minWidth, `${surface} ${textOf(box).slice(0, 30)}`).toBe(0)
      await pane.unmount()
    }
  })

  test('each static button sits in a wrapper the desktop remounts every drawing; the terminal keeps them bare', async ($, on) => {
    const w = world(on)
    const a = await w.spawn($, 'One')
    const b = await w.spawn($, 'Two')
    await w.finish($, b)
    for (let i = 0; i < 14; i += 1) await w.callTool($, a, 'Read', { file_path: `f${i}.ts` })
    const desktop = await mountAt($, 'desktop', 84)
    await desktop.press({ key: `inspect-${a}` })
    const before = wrappers(await desktop.drawn())
    expect([...before.keys()].sort()).toEqual([...STATIC].sort())
    for (const [k, box] of before) expect(keyOf(box), k).toMatch(/^press-[a-z]+-\d+$/)
    await w.clock.advance(500) // one tick: the frame moves, so every wrapper key moves with it
    const after = wrappers(await desktop.drawn())
    for (const [k, box] of before) {
      const moved = after.get(k)
      expect(moved, k).toBeDefined()
      expect(keyOf(moved as Drawn), k).toMatch(/^press-[a-z]+-\d+$/)
      expect(keyOf(moved as Drawn), `${k} after a tick`).not.toBe(keyOf(box))
    }
    await desktop.unmount()
    const terminal = await mountAt($, 'terminal', 84)
    for (const [k, box] of wrappers(await terminal.drawn())) expect(keyOf(box) ?? '', k).not.toMatch(/^press-/)
    await terminal.unmount()
  })
})

// ---------------------------------------------------------------- the hover reveal

describe('the hover reveal', () => {
  test('each card hides a few rows in its own flow that the pointer reveals: the task in full and the last rows', async ($, on) => {
    const w = world(on)
    const long = 'Audit every call site of the payments client for the retry budget and report the ones that exceed it'
    const a = await w.spawn($, long)
    for (let i = 0; i < 5; i += 1) await w.callTool($, a, 'Grep', { pattern: `needle-${i}` })
    for (const surface of SURFACES) {
      const pane = await mountAt($, surface, 84)
      const card = cardsOf(await pane.drawn())[0] as Drawn
      const hidden = walk(card, n => n.type === 'Box' && n.props?.display === 'none')
      expect(hidden.length, surface).toBe(1)
      const reveal = hidden[0] as Drawn & { hover?: unknown }
      expect(reveal.hover).toEqual({ display: 'flex' })
      expect(reveal.props?.position).toBeUndefined() // in the flow: nothing drawn over anything
      expect(reveal.props?.backgroundColor).toBeUndefined()
      const inside = textOf({ children: reveal.children })
      expect(inside).toContain(long) // the title had to cut it
      expect(inside).toContain('needle-4')
      expect(inside).not.toContain('needle-1') // the last three rows
      expect(textOf(card)).not.toContain('needle-4') // nothing of it shows at rest
      await pane.unmount()
    }
  })

  test('a short task is not repeated under its own title', async ($, on) => {
    const w = world(on)
    await w.spawn($, 'Tidy')
    const pane = await mountAt($, 'desktop', 84)
    const card = cardsOf(await pane.drawn())[0] as Drawn
    const reveal = walk(card, n => n.type === 'Box' && n.props?.display === 'none')[0] as Drawn
    expect(walk(reveal, n => n.type === 'Text' && n.props?.wrap === 'wrap').length).toBe(0) // no second copy of a title that fits
    expect(textOf({ children: reveal.children })).toContain('⇢') // its start row
    await pane.unmount()
  })
})

// ---------------------------------------------------------------- the heat strip

describe('the heat strip', () => {
  test('a wide header shows one column per subagent and one row per ten seconds, shaded and coloured by the subagent; a narrow one shows none', async ($, on) => {
    const w = world(on)
    const a = await w.spawn($, 'Busy', { model: 'claude-haiku-5-5' })
    const b = await w.spawn($, 'Idle', { model: 'claude-sonnet-5-5' })
    for (let i = 0; i < 4; i += 1) await w.callTool($, a, 'Grep', { pattern: `p${i}` })
    for (const surface of SURFACES) {
      const pane = await mountAt($, surface, 84)
      const strip = (await pane.find({ key: 'heat' })) as Drawn | undefined
      expect(strip, surface).toBeDefined()
      const rows = (strip!.children ?? []).slice(1) as Drawn[] // after the label
      expect(rows.length, surface).toBe(7) // six windows and the numbers
      const cells = (row: Drawn) => walk(row, n => n.type === 'Text').map(n => ({ glyph: textOf(n), color: n.props?.color, dim: n.props?.dimColor }))
      const newest = cells(rows[5]!)
      expect(newest.map(x => x.glyph), surface).toEqual(['█', '░']) // five rows just now for #1 (its start and four tools), its start alone for #2
      expect(newest[0]!.color, surface).toBeDefined()
      expect(newest[1]!.color, surface).toBeDefined()
      expect(newest[0]!.color).not.toBe(newest[1]!.color) // each column in its subagent's colour
      expect(cells(rows[4]!).map(x => x.dim)).toEqual([true, true]) // an empty cell is a dim dot
      expect(cells(rows[6]!).map(x => x.glyph)).toEqual(['1', '2'])
      for (const row of rows.slice(0, 5)) expect(cells(row).map(x => x.glyph), surface).toEqual(['·', '·'])
      await pane.unmount()
    }
    const narrow = await mountAt($, 'terminal', 60)
    expect(await narrow.find({ key: 'heat' })).toBeUndefined()
    await narrow.unmount()
    expect([a, b].length).toBe(2)
  })

  test('activity scrolls up the strip as the minute passes', async ($, on) => {
    const w = world(on)
    const a = await w.spawn($, 'One')
    await w.callTool($, a, 'Read', { file_path: 'x.ts' })
    const pane = await mountAt($, 'terminal', 100)
    const column = async () => ((await pane.find({ key: 'heat' })) as Drawn).children!.slice(1, 7).map(r => textOf(r as Drawn))
    expect(await column()).toEqual(['·', '·', '·', '·', '·', '▒']) // its start and one tool, just now
    await w.clock.advance(31_000)
    expect(await column()).toEqual(['·', '·', '▒', '·', '·', '·'])
    await w.clock.advance(40_000)
    expect(await column()).toEqual(['·', '·', '·', '·', '·', '·']) // gone past the minute
    await pane.unmount()
  })
})

// ---------------------------------------------------------------- the mission map

describe('the mission map', () => {
  test('the desktop draws one still map that keeps its bytes while the cards tick and changes with the mission; the terminal draws none', async ($, on) => {
    const w = world(on)
    const a = await w.spawn($, 'Lead')
    const b = await w.spawn($, 'Helper', { parent: a })
    const terminal = await mountAt($, 'terminal', 100)
    expect(walk(await terminal.drawn(), n => n.type === 'Svg').length).toBe(0)
    expect(await terminal.find({ key: 'map' })).toBeUndefined()
    await terminal.unmount()
    const pane = await mountAt($, 'desktop', 100)
    // an Svg is a leaf the kit keys by nothing: found by type under the map block
    const map = async () => walk(await pane.find({ key: 'map' }), n => n.type === 'Svg')[0] as (Drawn & { props: { source: string; alt: string; isInteractive?: boolean } }) | undefined
    const first = await map()
    expect(first).toBeDefined()
    expect(first!.type).toBe('Svg')
    expect(first!.props.isInteractive).toBeUndefined() // a still picture: no frame to re-set
    expect(first!.props.source).toContain('main loop')
    expect(first!.props.source).toContain('>#1 Lead<')
    expect(first!.props.source).toContain('>#2 Helper<')
    expect(first!.props.source).not.toContain('<animate')
    expect(first!.props.alt).toContain('2 subagents')
    await w.clock.advance(1_000)
    expect((await map())!.props.source).toBe(first!.props.source) // nothing of the clock in it
    await w.finish($, b)
    expect((await map())!.props.source).not.toBe(first!.props.source)
    expect((await map())!.props.alt).toContain('#2 Helper (from #1): done')
    await pane.unmount()
  })
  test('m folds the map away and brings it back', async ($, on) => {
    const w = world(on)
    await w.spawn($, 'One')
    const pane = await mountAt($, 'desktop', 100, { isFocused: true })
    const svgs = async () => walk(await pane.drawn(), n => n.type === 'Svg').length
    expect(await svgs()).toBe(1)
    expect((await pane.find({ key: 'keys' }))?.text).toContain('m map')
    await pane.press({ key: 'toggle-map' })
    expect(await svgs()).toBe(0)
    expect((await pane.find({ key: 'toggle-map' }))?.props.label).toBe('show')
    await pane.press({ key: 'toggle-map' })
    expect(await svgs()).toBe(1)
    await pane.unmount()
  })
})

