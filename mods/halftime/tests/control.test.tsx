// API-GOTCHAS #31: one control character in a drawn string and the engine
// refuses the band's whole tree, taking every other mod's band with it.
// The one outside text halftime draws is why a board failed (the surface's
// words, quoting what the board threw); the rest is its own words, game ids
// and numbers. Each control class goes through every way outside text gets
// in: a fault's reason, what a board posts, what the store holds, and what is
// typed after /halftime.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'

import { clean } from '../hooks/share'
import { BAND, SURFACES, VIEWPORT, halftime, said, world } from './fixtures'

const CONTROLS = [
  ['BEL', '\u0007'],
  ['ESC with a CSI sequence', '\u001b[2J'],
  ['DEL', '\u007f'],
  ['NUL', '\u0000'],
  ['C1 CSI (U+009B)', '\u009b31m'],
] as const
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** Another mod's band beneath halftime: it must survive whatever halftime draws. */
const NEIGHBOUR: Plugin = {
  name: 'neighbour',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const { Box, Text } = $.ui.resolve(e)
      const rest = await next(e)
      return (
        <Box key="neighbour" flexDirection="column">
          <Text>neighbour band</Text>
          {rest}
        </Box>
      )
    })
  },
}

/**
 * Stands above halftime: breaks the board once on each surface (its rows
 * become a string, so the board throws while drawing and the engine reports a
 * fault), and puts the control character the test names into the fault's
 * reason as halftime stores it. The engine promises a reason with no control
 * character; this breaks that promise on purpose, so the band never leans on it.
 */
const BREAKER: Plugin = {
  name: 'breaker',
  tier: 'prepend',
  register(on) {
    const broken = new Set<string>()
    const corrupt = (node: unknown): unknown => {
      if (node === null || typeof node !== 'object') return node
      const el = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
      if (el.type === 'Client') return { ...el, props: { ...el.props, props: { ...(el.props?.props as object), rows: 'not rows' } } }
      return el.children ? { ...el, children: el.children.map(corrupt) } : el
    }
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const tree = await next(e)
      if (broken.has(e.surface) || !JSON.stringify(tree ?? null).includes('"Client"')) return tree
      broken.add(e.surface)
      return corrupt(tree) as typeof tree
    })
    on('state.set', async ($, e, next) => {
      const write = e as unknown as { plugin: string; key: string; value: { surface: string; reason: string } | null }
      if (write.plugin !== 'halftime' || write.key !== 'fault' || write.value === null) return next(e)
      const dirt = (await $.env.get('HALFTIME_DIRT')) ?? ''
      return next({ ...e, value: { ...write.value, reason: `the board${dirt} broke` } } as typeof e)
    })
  },
}

/** The strings a tree draws: text children, labels, alts. A Client's props are its data, not drawn. */
function drawnTexts(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) for (const child of node) drawnTexts(child, out)
  else if (node !== null && typeof node === 'object') {
    const el = node as { props?: Record<string, unknown>; children?: unknown }
    for (const prop of ['label', 'alt']) if (typeof el.props?.[prop] === 'string') out.push(el.props[prop] as string)
    drawnTexts(el.children, out)
  }
  return out
}

function clientKey(node: unknown): string | undefined {
  if (node === null || typeof node !== 'object') return undefined
  const el = node as { type?: string; props?: { key?: unknown }; children?: unknown[] }
  if (el.type === 'Client') return String(el.props?.key)
  for (const child of el.children ?? []) {
    const key = clientKey(child)
    if (key) return key
  }
  return undefined
}

type Band = Awaited<ReturnType<typeof mountBand>>

/** Every drawn string clean, the board's own drawing included, and the neighbour still there. */
async function expectClean(ui: Band, where: string) {
  const tree = await ui.drawn()
  expect(await ui.find({ key: 'neighbour' }), where).toBeDefined()
  for (const text of drawnTexts(tree)) expect(text, where).not.toMatch(CONTROL)
  const key = clientKey(tree)
  if (key) for (const text of drawnTexts(await ui.drawn({ in: key }))) expect(text, `${where} board`).not.toMatch(CONTROL)
}

/** The band with the neighbour beneath. The kit rejects the mount when the engine refuses the tree. */
async function mountBand($: Engine, surface: (typeof SURFACES)[number]) {
  return $.ui.mount({ plugin: 'halftime', surface, component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
}

describe('control characters (API-GOTCHAS #31)', () => {
  test('clean() handles each control class, bidi and zero-width', () => {
    const cases: [string, string][] = [
      ['boom\u0007', 'boom�'],
      ['\u001b[31mboom\u001b[0m', 'boom'],
      ['boom\u007f', 'boom�'],
      ['bo\u0000om', 'bo�om'],
      ['boom\u009b2J', 'boom'],
      ['\u001b]0;title\u0007boom', 'boom'],
      ['bo\u200bom\u202e', 'boom'],
      ['at line 1\nat line 2', 'at line 1 at line 2'],
      ['RangeError', 'RangeError'],
    ]
    for (const [raw, out] of cases) expect(clean(raw)).toBe(out)
  })

  for (const [name, c] of CONTROLS) {
    test(`${name} in why the board failed: the fallback line draws clean`, { plugins: [BREAKER, NEIGHBOUR] }, async ($, on) => {
      world(on)
      mock.env(on, { HALFTIME_DIRT: c })
      await $.command.run(halftime('cratehop'))
      for (const surface of SURFACES) {
        // The first drawing here: the board throws, and the engine reports the fault.
        await expect(mountBand($, surface)).rejects.toThrow(/Client/)
        const ui = await mountBand($, surface)
        await expectClean(ui, surface)
        expect((await ui.find({ type: 'Text', text: /could not run here/ }))?.text).toMatch(/could not run here \(the board�? broke\)/)
        await ui.unmount()
      }
    })

    test(`${name} in what a board posts: dropped or ignored, never drawn`, { plugins: [NEIGHBOUR] }, async ($, on) => {
      world(on)
      await $.command.run(halftime('sweep'))
      for (const surface of SURFACES) {
        const ui = await mountBand($, surface)
        await ui.post({ iid: 'board', arm: 1, ev: [[1, c], [2, `click:0,0,left${c}`], [3, `x${c}`]], tick: true })
        await ui.post({ iid: `board${c}`, arm: 2, ev: [[1, `click:1,1,${c}`]], tick: false })
        await expectClean(ui, surface)
        await ui.unmount()
      }
    })

    test(`${name} in what the store holds: picker, scorecard and board draw clean`, { plugins: [NEIGHBOUR] }, async ($, on) => {
      const { seen } = world(on, {
        store: {
          'best:cratehop': `12${c}`, 'best:sweep': 47, 'daily:cratehop': { day: `2026-10-09${c}`, score: 5 },
          totals: { playedMs: c, waitPlayedMs: `9${c}`, runs: 1 }, last: `cratehop${c}`, auto: c,
        },
      })
      await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
      expect(await said($, seen, '')).toBe('halftime · cratehop - · tailchase - · merge - · sweep 47s · 0s played while waiting')
      for (const surface of SURFACES) {
        const ui = await mountBand($, surface)
        await expectClean(ui, `${surface} picker`)
        await ui.press({ key: 'pick:cratehop' })
        await expectClean(ui, `${surface} board`)
        await ui.press({ key: 'games' })
        await ui.unmount()
      }
      for (const surface of ['vscode', 'mobile'] as const) {
        const ui = await $.ui.mount({ plugin: 'halftime', surface, component: 'CommandOutput', props: { command: 'halftime', args: '', text: 'halftime', isErrored: false } })
        for (const text of drawnTexts(await ui.drawn())) expect(text, surface).not.toMatch(CONTROL)
      }
    })

    test(`${name} typed after /halftime is never repeated back`, async ($, on) => {
      const { seen } = world(on)
      for (const args of [c, `cratehop${c}`, `auto ${c}`, `sweep ${c}`]) expect(await said($, seen, args)).not.toMatch(CONTROL)
    })
  }
})
