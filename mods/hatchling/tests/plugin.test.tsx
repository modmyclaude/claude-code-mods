// The mod through its real wiring: session and turn events, tool calls,
// /pet, the band and the /pet rows on the terminal and desktop surfaces.
// The engine beneath is played by the hooks in world(): an in-memory store
// (so a restart can be simulated), a mocked clock, and scripted tools.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, Mounted } from 'claude-code/testing'
import type { On, RenderElement, RenderNode, RenderSurface } from 'claude-code'

import type { HatchlingPet } from '../types'
import { rasterText } from '../hooks/art'

const T0 = Date.UTC(2026, 9, 1, 9)
const DAY = 86_400_000
const FRAME = 300
const SLEEP = 5 * 60_000
const SURFACES = ['terminal', 'desktop'] as const

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

/** What the scripted Bash prints for each command. */
const OUTPUT: Record<string, string> = {
  'npm test': 'PASS src/app.test.ts\nTests:       12 passed, 12 total\nTime:        1.2 s',
  'pytest': '============ 9 passed in 0.31s ============',
  'ls': 'src  tests  package.json',
}

type World = {
  store: Map<string, unknown>
  clock: MockClock
  toasts: string[]
  copies: string[]
  timers: { every: number; after: number }
  hatches: string[]
}

/** The engine beneath the plugin. `saved` is what the store held before. */
function world(on: On, saved?: Record<string, unknown>, options: { brokenStore?: boolean } = {}): World {
  const store = new Map<string, unknown>(Object.entries(saved ?? {}))
  const timers = { every: 0, after: 0 }
  const hatches: string[] = []
  // Counted above the mock clock: every period of a $.clock.every is one
  // dispatch. Matched on the mod's two periods (the frame and the doze timer).
  on('clock.every', { ms: FRAME }, ($, e, next) => {
    timers.every += 1
    return next(e)
  })
  on('clock.after', { ms: SLEEP }, ($, e, next) => {
    timers.after += 1
    return next(e)
  })
  const clock = mock.clock(on, { now: T0 })
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    if (options.brokenStore === true) throw new Error('disk full')
    const value = JSON.parse(JSON.stringify(e.value)) as HatchlingPet
    if (value.hatch !== undefined) hatches.push(JSON.stringify(value.hatch))
    store.set(e.key, value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const copies: string[] = []
  on('ui.copy', ($, e) => {
    copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  // Where the pet yields, the engine draws its own (here: an empty marker).
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('tool.call', ($, e) => {
    if (e.tool !== 'Bash') return { result: 'ok', text: 'ok' }
    if (e.command === 'denied') return { deny: 'not allowed' }
    if (e.command.startsWith('fail')) return { isError: true as const, result: 'Exit code 1', text: 'Exit code 1\nTests:  2 failed, 10 passed' }
    return { result: { stdout: OUTPUT[e.command] ?? 'ok', stderr: '', interrupted: false }, text: OUTPUT[e.command] ?? 'ok' }
  })
  return { store, clock, toasts, copies, timers, hatches }
}

function pet(w: World): HatchlingPet {
  return w.store.get('pet') as HatchlingPet
}

/** A pet saved by an earlier session. */
function savedPet(over: Partial<HatchlingPet> = {}): HatchlingPet {
  return {
    v: 1, bornAt: T0 - 2 * DAY, eggCalls: 25, name: 'Pip', xp: 0, hidden: false,
    toolCalls: 40, turns: 6, testsPassed: 1, hatch: { species: 'geobug', shiny: true, at: T0 - DAY },
    ...over,
  }
}

/** /pet as the person types it at the prompt. */
function petCommand($: Engine, args: string) {
  return $.command.run({ command: 'pet', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
}

async function bash($: Engine, command: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) await $.tool.call({ tool: 'Bash', command })
}

async function turn($: Engine, over: { agentId?: string; reason?: 'answer' | 'aborted' } = {}): Promise<void> {
  const reason = over.reason ?? 'answer'
  const base = { answer: 'done', durationMs: 1000, isAborted: reason === 'aborted', turnId: 't1', reason }
  await $.turn.complete(over.agentId === undefined ? base : { ...base, agentId: over.agentId })
}

function band($: Engine, surface: RenderSurface, props: Partial<typeof BAND> = {}) {
  return $.ui.mount({ plugin: 'hatchling', surface, component: 'AbovePrompt', props: { ...BAND, ...props } })
}

/** What the helpers read from a mounted drawing, whatever its component. */
type Drawing = Pick<Mounted, 'drawn' | 'find'>

/** Every string in a drawn tree, in order. */
function textOf(node: RenderNode | undefined): string {
  if (node === undefined) return ''
  if (typeof node === 'string') return node
  const children = (node as { children?: RenderNode[] }).children ?? []
  return children.map(textOf).join('')
}

async function shown(ui: Drawing): Promise<string> {
  return textOf((await ui.drawn()) as RenderElement).replace(/\u00a0/g, ' ')
}

/** The sprite as rows of characters, from a Raster or from Text rows. */
async function sprite(ui: Drawing): Promise<string[] | undefined> {
  const found = await ui.find({ key: 'sprite' })
  if (found === undefined) return undefined
  if (found.type === 'Raster') return rasterText(String(found.props.cells), Number(found.props.columns))
  return (found.children as RenderNode[]).map(row => textOf(row).replace(/\u00a0/g, ' '))
}

describe('first run and hatching', () => {
  test('an egg appears above the prompt on the terminal and the desktop', async ($, on) => {
    const w = world(on)
    await start($)
    expect(pet(w)).toMatchObject({ eggCalls: 0, xp: 0, bornAt: T0, hidden: false })
    expect(pet(w).hatch).toBeUndefined()
    const drawn: string[][] = []
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await shown(ui)).toContain('Something stirs inside the egg')
      expect(await shown(ui)).toContain('0/25 to hatch')
      expect(await shown(ui)).toContain('hatches in 25 tool calls')
      drawn.push((await sprite(ui)) ?? [])
      await ui.unmount()
    }
    expect((await band($, 'terminal')).surface).toBe('terminal')
    // The same egg, cell for cell, whichever surface draws it.
    expect(drawn[0]).toEqual(drawn[1])
    expect(drawn[0]?.join('')).toMatch(/[▀▄█]/)
  })

  test('the egg hatches on exactly the 25th tool call', async ($, on) => {
    const w = world(on)
    await start($)
    await bash($, 'ls', 24)
    expect(pet(w).eggCalls).toBe(24)
    expect(pet(w).hatch).toBeUndefined()
    expect(w.toasts).toEqual([])
    const egg = await band($, 'terminal')
    expect(await shown(egg)).toContain('24/25 to hatch')
    await egg.unmount()

    await bash($, 'ls')
    const hatch = pet(w).hatch
    expect(hatch).toBeDefined()
    expect(['pebblet', 'fluffle', 'coilsnail', 'nimbit', 'lampwing', 'foldling', 'geobug', 'starwhelp']).toContain(hatch?.species)
    expect(pet(w).xp).toBe(0)
    expect(w.toasts).toHaveLength(1)
    expect(w.toasts[0]).toMatch(/^Your egg hatched! Meet \S+, an? (shiny )?(common|uncommon|rare|legendary) \w+\.$/)
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await shown(ui)).toMatch(/Crack! \S+ hatched/)
      await ui.unmount()
    }
  })

  test('a restart never rerolls: the same pet comes back every time', async ($, on) => {
    const w = world(on)
    await start($)
    await bash($, 'ls', 25)
    const first = pet(w)
    expect(first.hatch).toBeDefined()
    for (let restart = 0; restart < 6; restart += 1) {
      await $.session.end({ reason: 'other', sessionId: `s${restart}`, resume: { id: `s${restart}` } })
      await start($)
      await bash($, 'ls', 5)
      expect(pet(w).hatch).toEqual(first.hatch)
      expect(pet(w).name).toBe(first.name)
    }
    // Every write the plugin ever made carried the one roll.
    expect(new Set(w.hatches).size).toBe(1)
    expect(pet(w).xp).toBe(30)
  })

  test('a pet saved by an earlier session loads as it was', async ($, on) => {
    const w = world(on, { pet: savedPet({ xp: 120 }) })
    await start($)
    await bash($, 'ls', 30)
    expect(pet(w).hatch).toEqual({ species: 'geobug', shiny: true, at: T0 - DAY })
    expect(pet(w).xp).toBe(150)
    expect(w.toasts).toEqual([])
    const ui = await band($, 'desktop')
    expect(await shown(ui)).toContain('rare - baby - shiny')
  })

  test('egg progress survives a restart and still hatches at 25 in total', async ($, on) => {
    const w = world(on)
    await start($)
    await bash($, 'ls', 10)
    await start($)
    await bash($, 'ls', 14)
    expect(pet(w).hatch).toBeUndefined()
    await bash($, 'ls')
    expect(pet(w).hatch).toBeDefined()
  })

  test('two open sessions share one pet: a write from the other is never lost or rerolled', async ($, on) => {
    const w = world(on)
    await start($)
    await bash($, 'ls', 24)
    // Meanwhile another open session hatched the egg and earned XP.
    w.store.set('pet', savedPet({ xp: 40, toolCalls: 70 }))
    await bash($, 'ls')
    expect(pet(w).hatch?.species).toBe('geobug')
    expect(pet(w).xp).toBe(41)
    expect(pet(w).toolCalls).toBe(71)
    expect(w.toasts).toEqual([])
  })
})

describe('reactions', () => {
  test('bounces on a good call, sweats on a failure, cheers when tests pass', async ($, on) => {
    const w = world(on, { pet: savedPet({ name: 'Pip' }) })
    await start($)
    const cases: [string, RegExp][] = [
      ['ls', /Pip bounces - Bash worked/],
      ['fail npm test', /Pip is sweating - Bash failed/],
      ['npm test', /Pip is cheering - tests passed/],
      ['pytest', /Pip is cheering - tests passed/],
    ]
    for (const [command, line] of cases) {
      await bash($, command)
      for (const surface of SURFACES) {
        const ui = await band($, surface)
        expect(await shown(ui), command).toMatch(line)
        await ui.unmount()
      }
      // Each mood plays out and settles back.
      await w.clock.advance(20 * FRAME)
      const ui = await band($, 'terminal')
      expect(await shown(ui)).toContain('Pip is hanging out')
      await ui.unmount()
    }
    expect(pet(w).testsPassed).toBe(3)
  })

  test('the sprite really animates while a mood plays', async ($, on) => {
    const w = world(on, { pet: savedPet() })
    await start($)
    await bash($, 'npm test')
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      const frames = new Set<string>()
      for (let i = 0; i < 3; i += 1) {
        frames.add(JSON.stringify(await sprite(ui)))
        await w.clock.advance(FRAME)
      }
      expect(frames.size, surface).toBeGreaterThan(1)
      await ui.unmount()
    }
  })

  test('a busy mood is not cut short by a lesser one', async ($, on) => {
    world(on, { pet: savedPet() })
    await start($)
    await bash($, 'npm test')
    await bash($, 'ls')
    const ui = await band($, 'terminal')
    expect(await shown(ui)).toContain('cheering')
  })
})

describe('growing up', () => {
  test('XP comes from tool calls and your own finished turns, not a subagent run', async ($, on) => {
    const w = world(on, { pet: savedPet() })
    await start($)
    await turn($)
    expect(pet(w).xp).toBe(5)
    await turn($, { agentId: 'agent-7' })
    expect(pet(w).xp).toBe(5)
    await turn($, { reason: 'aborted' })
    expect(pet(w).xp).toBe(5)
    await bash($, 'ls')
    expect(pet(w).xp).toBe(6)
    await bash($, 'npm test')
    expect(pet(w).xp).toBe(12)
  })

  test('evolves into a teen at 200 XP and an adult at 800, with a celebration and a toast', async ($, on) => {
    const w = world(on, { pet: savedPet({ xp: 199 }) })
    await start($)
    const before = await band($, 'terminal')
    expect((await before.find({ key: 'sprite' }))?.props.columns).toBe(10)
    await before.unmount()

    await bash($, 'ls')
    expect(w.toasts).toEqual(['Pip evolved into a teen!'])
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await shown(ui)).toContain('Pip is evolving!')
      expect(await shown(ui)).toContain('rare - teen - shiny')
      await ui.unmount()
    }
    await w.clock.advance(20 * FRAME)
    const teen = await band($, 'terminal')
    expect((await teen.find({ key: 'sprite' }))?.props.columns).toBe(12)
    expect(await shown(teen)).toContain('Pip is hanging out')
    await teen.unmount()

    w.store.set('pet', { ...pet(w), xp: 796 })
    await turn($)
    expect(w.toasts).toEqual(['Pip evolved into a teen!', 'Pip evolved into an adult!'])
    await w.clock.advance(20 * FRAME)
    const adult = await band($, 'terminal')
    expect((await adult.find({ key: 'sprite' }))?.props.columns).toBe(16)
    expect(await shown(adult)).toContain('801 XP')
  })
})

describe('sleep and timers', () => {
  test('the frame timer runs only while something is happening', async ($, on) => {
    const w = world(on, { pet: savedPet() })
    await start($)
    await w.clock.advance(10_000)
    expect(w.timers.every).toBe(0)
    await bash($, 'ls')
    await w.clock.advance(10 * FRAME)
    const during = w.timers.every
    expect(during).toBeGreaterThan(0)
    await w.clock.advance(60_000)
    expect(w.timers.every).toBe(during)

    // While Claude works, the idle loop breathes; when the turn ends it stops.
    await $.turn.start({ text: 'go', turnId: 't2' })
    await w.clock.advance(10 * FRAME)
    expect(w.timers.every).toBeGreaterThan(during)
    await turn($)
    const after = w.timers.every
    await w.clock.advance(60_000)
    expect(w.timers.every).toBe(after)
  })

  test('falls asleep after 5 idle minutes, with no timer left running', async ($, on) => {
    const w = world(on, { pet: savedPet() })
    await start($)
    await w.clock.advance(SLEEP - 1000)
    let ui = await band($, 'terminal')
    expect(await shown(ui)).toContain('Pip is hanging out')
    await ui.unmount()

    await w.clock.advance(1000)
    for (const surface of SURFACES) {
      ui = await band($, surface)
      expect(await shown(ui)).toContain('Pip dozed off')
      await ui.unmount()
    }
    await w.clock.advance(10 * FRAME) // the doze-off plays, then stops
    const every = w.timers.every
    const after = w.timers.after
    await w.clock.advance(30 * 60_000)
    expect(w.timers.every).toBe(every)
    expect(w.timers.after).toBe(after)

    // Anything happening wakes it.
    await $.turn.start({ text: 'wake up', turnId: 't3' })
    ui = await band($, 'terminal', { isWorking: true })
    expect(await shown(ui)).toContain('Pip is watching Claude work')
  })

  test('an egg sleeps too', async ($, on) => {
    const w = world(on)
    await start($)
    await w.clock.advance(SLEEP)
    const ui = await band($, 'desktop')
    expect(await shown(ui)).toContain('The egg is dreaming')
  })

  test('hidden: no band, no timers, but it still grows', async ($, on) => {
    const w = world(on, { pet: savedPet() })
    await start($)
    const hidden = await petCommand($, 'hide')
    expect(hidden.text).toBe('Pip is hidden. /pet show brings the band back.')
    expect(pet(w).hidden).toBe(true)
    const every = w.timers.every
    const after = w.timers.after
    await bash($, 'npm test')
    await $.turn.start({ text: 'go', turnId: 't4' })
    await turn($)
    await w.clock.advance(30 * 60_000)
    expect(w.timers.every).toBe(every)
    expect(w.timers.after).toBe(after)
    expect(pet(w).xp).toBe(11)
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await ui.find({ key: 'engine' })).toBeDefined()
      expect(await ui.find({ key: 'sprite' })).toBeUndefined()
      await ui.unmount()
    }
    await petCommand($, 'show')
    const ui = await band($, 'terminal')
    expect(await ui.find({ key: 'sprite' })).toBeDefined()
    expect(pet(w).hidden).toBe(false)
  })
})

describe('/pet', () => {
  test('the stat card has name, species, rarity, shiny, stage, XP to go and days together', async ($, on) => {
    world(on, { pet: savedPet({ xp: 320, toolCalls: 512, testsPassed: 4 }) })
    await start($)
    const { text } = await petCommand($, '')
    expect(text).toBe(
      'Pip the Geobug\nrare - teen - shiny\nXP 320 - 480 more to adult\n3 days together - 512 tool calls - 4 test runs cheered',
    )
  })

  test('name renames, and refuses a bad name', async ($, on) => {
    const w = world(on, { pet: savedPet() })
    await start($)
    expect((await petCommand($, 'name  Mochi ')).text).toBe('Your pet is now called Mochi.')
    expect(pet(w).name).toBe('Mochi')
    expect((await petCommand($, 'name <b>')).text).toMatch(/^Names use letters/)
    expect((await petCommand($, 'name')).text).toMatch(/^Give it a name/)
    expect(pet(w).name).toBe('Mochi')
    const ui = await band($, 'desktop')
    expect(await shown(ui)).toContain('Mochi')
  })

  test('an egg can be named before it hatches', async ($, on) => {
    const w = world(on)
    await start($)
    expect((await petCommand($, 'name Nibbles')).text).toBe('The egg will hatch as Nibbles.')
    await bash($, 'ls', 25)
    expect(pet(w).name).toBe('Nibbles')
    expect(w.toasts[0]).toContain('Meet Nibbles,')
  })

  test('card prints a small plain-text card', async ($, on) => {
    world(on, { pet: savedPet({ xp: 900 }) })
    await start($)
    const { text = '' } = await petCommand($, 'card')
    const lines = text.split('\n')
    expect(lines[0]).toBe('```')
    expect(lines[lines.length - 1]).toBe('```')
    const card = lines.slice(1, -1)
    expect(card.length).toBeLessThanOrEqual(12)
    for (const line of card) expect([...line].length).toBe(30)
    expect(text).toContain('Pip the Geobug')
    expect(text).toContain('rare - adult - shiny')
    expect(text).toContain('hatchling')
  })

  test('an unknown word shows the help', async ($, on) => {
    world(on, { pet: savedPet() })
    await start($)
    expect((await petCommand($, 'dance')).text).toContain('/pet name <name>')
  })

  test('the /pet rows draw the pet on every surface, and Copy copies the card', async ($, on) => {
    const w = world(on, { pet: savedPet() })
    await start($)
    const stats = (await petCommand($, '')).text ?? ''
    const card = (await petCommand($, 'card')).text ?? ''
    for (const surface of SURFACES) {
      const row = await $.ui.mount({
        plugin: 'hatchling', surface, component: 'CommandOutput',
        props: { command: 'pet', args: '', text: stats, isErrored: false },
      })
      expect(await row.find({ key: 'portrait' })).toBeDefined()
      expect(await shown(row)).toContain('Pip the Geobug')
      // Old rows keep the pet as it was: growing up later changes nothing here.
      const before = JSON.stringify(await row.drawn())
      w.store.set('pet', savedPet({ xp: 900 }))
      await bash($, 'ls')
      await row.redraw()
      expect(JSON.stringify(await row.drawn())).toBe(before)
      w.store.set('pet', savedPet())
      await row.unmount()

      const shared = await $.ui.mount({
        plugin: 'hatchling', surface, component: 'CommandOutput',
        props: { command: 'pet', args: 'card', text: card, isErrored: false },
      })
      expect(await shown(shared)).toContain('Pip the Geobug')
      await shared.press({ key: 'copy' })
      expect(w.copies[w.copies.length - 1]).toBe(card.replace(/^```\n/, '').replace(/\n```$/, ''))
      expect(w.toasts[w.toasts.length - 1]).toBe('Card copied - paste it anywhere.')
      await shared.unmount()
    }
  })

  test('other /pet rows are left to the engine', async ($, on) => {
    world(on, { pet: savedPet() })
    await start($)
    for (const surface of SURFACES) {
      const row = await $.ui.mount({
        plugin: 'hatchling', surface, component: 'CommandOutput',
        props: { command: 'pet', args: 'name Mochi', text: 'Your pet is now called Mochi.', isErrored: false },
      })
      expect(await row.find({ key: 'engine' })).toBeDefined()
      await row.unmount()
    }
  })
})

describe('the band', () => {
  test('narrow or short: one line instead of the sprite', async ($, on) => {
    world(on, { pet: savedPet() })
    await start($)
    for (const surface of SURFACES) {
      for (const props of [{ bodyColumns: 24 }, { maxRows: 3 }]) {
        const ui = await band($, surface, props)
        expect(await ui.find({ key: 'sprite' })).toBeUndefined()
        expect(await shown(ui)).toMatch(/^[\u2588\u2591]{5} Pip is hanging out$/)
        await ui.unmount()
      }
    }
  })

  test('yields to a survey', async ($, on) => {
    world(on, { pet: savedPet() })
    await start($)
    for (const surface of SURFACES) {
      const ui = await band($, surface, { hasSurvey: true })
      expect(await ui.find({ key: 'engine' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a shiny pet draws in its shiny colours', async ($, on) => {
    const w = world(on, { pet: savedPet({ hatch: { species: 'geobug', shiny: false, at: T0 } }) })
    await start($)
    const plain = JSON.stringify(await (await band($, 'desktop')).find({ key: 'sprite' }))
    w.store.set('pet', savedPet({ hatch: { species: 'geobug', shiny: true, at: T0 } }))
    await start($)
    const shiny = JSON.stringify(await (await band($, 'desktop')).find({ key: 'sprite' }))
    expect(shiny).not.toBe(plain)
    expect(shiny).toContain('#4fe08a')
    expect(plain).toContain('#b57cff')
  })
})

describe('never in the way', () => {
  test('a failing store does not touch the tool result', async ($, on) => {
    world(on, undefined, { brokenStore: true })
    const ran = await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(ran.text).toBe(OUTPUT['npm test'])
    expect(ran.isError).toBeUndefined()
    const failed = await $.tool.call({ tool: 'Bash', command: 'fail now' })
    expect(failed.isError).toBe(true)
    expect(failed.text).toBe('Exit code 1\nTests:  2 failed, 10 passed')
  })

  test('a refused call passes through and is not counted', async ($, on) => {
    const w = world(on)
    await start($)
    const ran = await $.tool.call({ tool: 'Bash', command: 'denied' })
    expect(ran.deny).toBe('not allowed')
    expect(pet(w).eggCalls).toBe(0)
  })

  test('a -p run counts but never starts a timer', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
    await bash($, 'ls', 3)
    await w.clock.advance(SLEEP * 2)
    expect(pet(w).eggCalls).toBe(3)
    expect(w.timers).toEqual({ every: 0, after: 0 })
  })
})
