// The mod through its real wiring: session and turn events, tool calls,
// /pet, the band and the /pet rows on the terminal and desktop surfaces.
// The engine beneath is played by the hooks in world(): an in-memory store
// (so a restart can be simulated), a mocked clock, and scripted tools.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, Mounted } from 'claude-code/testing'
import type { On, RenderElement, RenderNode, RenderSurface } from 'claude-code'

import type { HatchlingPet } from '../types'
import { rasterText } from '../hooks/art'
import { boltOf, rasterCells } from '../hooks/bolt-draw'
import type { BoltPick } from '../hooks/bolt-draw'
import { applyToolCall, normalizePet } from '../hooks/pet'

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
  /** What $.session.surfaces() answers; tests attach and detach by editing it. */
  surfaces: RenderSurface[]
  store: Map<string, unknown>
  clock: MockClock
  toasts: string[]
  copies: string[]
  timers: { every: number; after: number }
  hatches: string[]
  /** Every store write the plugin made, and every command it registered. */
  writes: string[]
  registered: Record<string, unknown>[]
}

/** The engine beneath the plugin. `saved` is what the store held before. */
type WorldOptions = {
  brokenStore?: boolean
  surfaces?: RenderSurface[]
  /** Runs inside a store read, after the value is taken: another session writing meanwhile. */
  race?: (store: Map<string, unknown>) => void
}

function world(on: On, saved?: Record<string, unknown>, options: WorldOptions = {}): World {
  const store = new Map<string, unknown>(Object.entries(saved ?? {}))
  const writes: string[] = []
  const registered: Record<string, unknown>[] = []
  const surfaces: RenderSurface[] = [...(options.surfaces ?? ['terminal'])]
  on('session.surfaces', () => ({ value: [...surfaces] }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  on('session.detach', ($, e) => ({ clientId: e.clientId }))
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
  on('store.get', ($, e) => {
    const value = store.get(e.key)
    options.race?.(store)
    return { value }
  })
  on('store.set', ($, e) => {
    if (options.brokenStore === true) throw new Error('disk full')
    writes.push(e.key)
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
  on('command.register', ($, e) => {
    registered.push({ ...e })
    return { value: { command: e.name } }
  })
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
  return { surfaces, store, clock, toasts, copies, timers, hatches, writes, registered }
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

/** Every element key in a drawn tree, in document order. */
function keysOf(node: unknown): string[] {
  if (node === null || typeof node !== 'object') return []
  const element = node as { props?: { key?: unknown }; key?: unknown; children?: unknown[] }
  const key = element.props?.key ?? element.key
  return [...(typeof key === 'string' ? [key] : []), ...(element.children ?? []).flatMap(keysOf)]
}

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

/** The sprite as rows of characters, from a Raster or from the desktop's rows of one-cell Boxes. */
async function sprite(ui: Drawing): Promise<string[] | undefined> {
  const found = await ui.find({ key: 'sprite' })
  if (found === undefined) return undefined
  if (found.type === 'Raster') return rasterText(String(found.props.cells), Number(found.props.columns))
  return (found.children as RenderNode[]).map(row => ((row as { children?: RenderNode[] }).children ?? []).map(cell => textOf(cell) || ' ').join(''))
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
    ui = await band($, 'terminal')
    expect(await shown(ui)).toContain('Pip is asleep')
    await ui.unmount()

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
    expect(hidden.text).toBeUndefined()
    expect(w.toasts).toEqual(['Pip is hidden. /pet show brings the band back.'])
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
      'Pip the Geobug\nrare - teen - shiny\nXP 320 - 480 more to adult\n3 days together - 512 tool calls - 4 test runs cheered\n' +
        'Plain rock outside. Make it grin and the crystals show.',
    )
  })

  test('name renames, and refuses a bad name', async ($, on) => {
    const w = world(on, { pet: savedPet() })
    await start($)
    expect((await petCommand($, 'name  Mochi ')).text).toBeUndefined()
    expect(pet(w).name).toBe('Mochi')
    await petCommand($, 'name <b>')
    await petCommand($, 'name')
    expect(w.toasts).toEqual([
      'Your pet is now called Mochi.',
      "Names use letters, numbers, spaces and - ' . _",
      'Give it a name, for example: /pet name Pip',
    ])
    expect(pet(w).name).toBe('Mochi')
    const ui = await band($, 'desktop')
    expect(await shown(ui)).toContain('Mochi')
  })

  test('an egg can be named before it hatches', async ($, on) => {
    const w = world(on)
    await start($)
    await petCommand($, 'name Nibbles')
    expect(w.toasts).toEqual(['The egg will hatch as Nibbles.'])
    await bash($, 'ls', 25)
    expect(pet(w).name).toBe('Nibbles')
    expect(w.toasts[1]).toContain('Meet Nibbles,')
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

  test('an unknown word shows the help, and the model reads none of these', async ($, on) => {
    const w = world(on, { pet: savedPet() })
    await start($)
    expect((await petCommand($, 'dance')).text).toBeUndefined()
    expect(w.toasts).toEqual(['Try /pet, /pet name <name>, /pet hide, /pet show or /pet card.'])
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

  // Another mod's band, loaded beneath this one: the pet must draw on top of
  // it, never erase it, in both the full and the one-line layouts.
  const neighbour = {
    name: 'neighbour',
    tier: 'append' as const,
    register: (on: On) => {
      on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
        const { Box, Text } = $.ui.resolve(e)
        return (
          <Box key="neighbour-band">
            <Text>neighbour safety notice</Text>
          </Box>
        )
      })
    },
  }

  test('shares the band with other mods on every layout', { plugins: [neighbour] }, async ($, on) => {
    world(on, { pet: savedPet() })
    await start($)
    for (const surface of SURFACES) {
      for (const props of [{}, { bodyColumns: 24 }]) {
        const ui = await band($, surface, props)
        expect(await ui.find({ key: 'neighbour-band' }), `${surface} ${JSON.stringify(props)}`).toBeDefined()
        expect(await ui.find({ key: 'band' })).toBeDefined()
        expect(await shown(ui)).toContain('neighbour safety notice')
        // The neighbour comes first, so the pet can never scroll it out of view.
        const order = keysOf(await ui.drawn()).filter(key => key === 'neighbour-band' || key === 'band')
        expect(order, `${surface} ${JSON.stringify(props)}`).toEqual(['neighbour-band', 'band'])
        await ui.unmount()
      }
      // Hidden: the neighbour alone.
      await petCommand($, 'hide')
      const hidden = await band($, surface)
      expect(await hidden.find({ key: 'neighbour-band' })).toBeDefined()
      expect(await hidden.find({ key: 'band' })).toBeUndefined()
      await hidden.unmount()
      await petCommand($, 'show')
    }
  })

  // A session refuses a tree that puts the engine's own node under a Box that
  // sizes, hides or moves it ("engine node under a Box with prop ..."), and draws
  // its own band instead. The kit does not check this, so the test walks the tree.
  const engineBeneath = {
    name: 'engine-beneath',
    tier: 'append' as const,
    register: (on: On) => {
      on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as never)
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

  test('the engine band beneath the pet is never under a Box that sizes or hides it, on every layout', { plugins: [engineBeneath] }, async ($, on) => {
    world(on, { pet: savedPet() })
    await start($)
    for (const surface of SURFACES) {
      for (const props of [{}, { bodyColumns: 24 }]) {
        const ui = await band($, surface, props)
        expect(await ui.find({ key: 'band' }), `${surface} ${JSON.stringify(props)}`).toBeDefined()
        expect(engineNodeConcealers(await ui.drawn()), `${surface} ${JSON.stringify(props)}`).toEqual([[]])
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
      expect(await ui.find({ key: 'band' })).toBeUndefined()
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

  test('a -p run (nothing drawing) counts but never starts a timer', async ($, on) => {
    const w = world(on, undefined, { surfaces: [] })
    await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
    await bash($, 'ls', 3)
    await w.clock.advance(SLEEP * 2)
    expect(pet(w).eggCalls).toBe(3)
    expect(w.timers).toEqual({ every: 0, after: 0 })
  })
})

describe('the desktop app (an SDK session) and parallel sessions', () => {
  // The desktop app starts the engine headless: no surface and isInteractive
  // false at session start; its client attaches afterwards.
  async function sdkStart($: Engine): Promise<void> {
    await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  }

  test('a desktop-only session animates, settles and sleeps', async ($, on) => {
    const w = world(on, { pet: savedPet() }, { surfaces: [] })
    await sdkStart($)
    w.surfaces.push('desktop')
    await $.session.attach({ surface: 'desktop', clientId: 'app' })

    // The client joining is enough to start the countdown to sleep.
    await w.clock.advance(SLEEP + 10 * FRAME)
    let ui = await band($, 'desktop')
    expect(await shown(ui)).toContain('Pip is asleep')
    await ui.unmount()

    await bash($, 'npm test')
    ui = await band($, 'desktop')
    expect(await shown(ui)).toContain('Pip is cheering - tests passed')
    await ui.unmount()
    await w.clock.advance(20 * FRAME)
    expect(w.timers.every).toBeGreaterThan(0)
    ui = await band($, 'desktop')
    expect(await shown(ui)).toContain('Pip is hanging out')
    await ui.unmount()

    await bash($, 'fail now')
    ui = await band($, 'desktop')
    expect(await shown(ui)).toContain('Pip is sweating - Bash failed')
    await ui.unmount()

    await w.clock.advance(SLEEP + 10 * FRAME)
    ui = await band($, 'desktop')
    expect(await shown(ui)).toContain('Pip is asleep')
    await ui.unmount()
  })

  test('timers stop when the last drawing surface detaches', async ($, on) => {
    const w = world(on, { pet: savedPet() }, { surfaces: [] })
    await sdkStart($)
    w.surfaces.push('desktop')
    await $.session.attach({ surface: 'desktop', clientId: 'app' })
    await $.turn.start({ text: 'go', turnId: 't5' })
    await w.clock.advance(5 * FRAME)
    expect(w.timers.every).toBeGreaterThan(0)
    w.surfaces.length = 0
    await $.session.detach({ surface: 'desktop', clientId: 'app', reason: 'detach' })
    const every = w.timers.every
    const after = w.timers.after
    await w.clock.advance(30 * 60_000)
    expect(w.timers.every).toBe(every)
    expect(w.timers.after).toBe(after)
  })

  test('detaching cancels the countdown to sleep', async ($, on) => {
    const w = world(on, { pet: savedPet() }, { surfaces: [] })
    await sdkStart($)
    w.surfaces.push('desktop')
    await $.session.attach({ surface: 'desktop', clientId: 'app' })
    await w.clock.advance(60_000)
    w.surfaces.length = 0
    await $.session.detach({ surface: 'desktop', clientId: 'app', reason: 'detach' })
    await w.clock.advance(2 * SLEEP)
    // No timer ran while nothing drew: the pet did not doze off unseen.
    const ui = await band($, 'desktop')
    expect(await shown(ui)).toContain('Pip is hanging out')
  })

  test('a mood set while nothing draws never freezes the band later', async ($, on) => {
    const w = world(on, { pet: savedPet() }, { surfaces: [] })
    await sdkStart($)
    await bash($, 'npm test')
    await bash($, 'fail now')
    expect(w.timers.every).toBe(0)
    const ui = await band($, 'desktop')
    expect(await shown(ui)).toContain('Pip is sweating - Bash failed')
  })

  test('two sessions hatching at the same moment end with one pet', async ($, on) => {
    let other: HatchlingPet | undefined
    const w = world(on, undefined, {
      race: store => {
        // The other session reads the same egg at call 24 and hatches it with
        // random numbers of its own, between our read and our write.
        const egg = normalizePet(store.get('pet'), T0)
        if (other !== undefined || egg.eggCalls !== 24) return
        other = applyToolCall(egg, { hasPassedTests: false }, T0, () => 0x9e3779b9).pet
        store.set('pet', other)
      },
    })
    await start($)
    expect(pet(w).seed).toHaveLength(4)
    await bash($, 'ls', 25)
    expect(other?.hatch).toBeDefined()
    expect(pet(w).hatch?.species).toBe(other?.hatch?.species)
    expect(pet(w).hatch?.shiny).toBe(other?.hatch?.shiny)
    expect(pet(w).name).toBe(other?.name)
    // And the toast this session showed names that same pet.
    expect(w.toasts.some(text => text.startsWith(`Your egg hatched! Meet ${other?.name ?? '?'},`))).toBe(true)
  })

  test('the egg keeps its seed across restarts', async ($, on) => {
    const w = world(on)
    await start($)
    const seed = pet(w).seed
    expect(seed).toHaveLength(4)
    await start($)
    await bash($, 'ls', 3)
    expect(pet(w).seed).toEqual(seed)
  })
})

describe('timing details', () => {
  test('activity pushes sleep back: a tool call at minute 4 means asleep at minute 9', async ($, on) => {
    const w = world(on, { pet: savedPet() })
    await start($)
    await w.clock.advance(4 * 60_000)
    await bash($, 'ls')
    await w.clock.advance(4 * 60_000 + 30_000)
    let ui = await band($, 'terminal')
    expect(await shown(ui)).not.toContain('asleep')
    expect(await shown(ui)).not.toContain('dozed')
    await ui.unmount()
    await w.clock.advance(30_000)
    ui = await band($, 'terminal')
    expect(await shown(ui)).toContain('Pip dozed off')
  })

  test('an interrupted or failed turn stops the working loop too', async ($, on) => {
    const w = world(on, { pet: savedPet() })
    await start($)
    for (const reason of ['aborted', 'answer'] as const) {
      await $.turn.start({ text: 'go', turnId: 't6' })
      await w.clock.advance(5 * FRAME)
      await turn($, { reason })
      const every = w.timers.every
      await w.clock.advance(60_000)
      expect(w.timers.every, reason).toBe(every)
    }
    await $.turn.start({ text: 'go', turnId: 't7' })
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 't7', reason: 'error' })
    const every = w.timers.every
    await w.clock.advance(60_000)
    expect(w.timers.every).toBe(every)
  })

  test('ten tool calls at once all count', async ($, on) => {
    const w = world(on, { pet: savedPet({ xp: 0, toolCalls: 0 }) })
    await start($)
    await Promise.all(Array.from({ length: 10 }, () => $.tool.call({ tool: 'Bash', command: 'ls' })))
    expect(pet(w).xp).toBe(10)
    expect(pet(w).toolCalls).toBe(10)
  })

  test('the band sizes to its own body, not the whole terminal', async ($, on) => {
    world(on, { pet: savedPet() })
    await start($)
    const ui = await $.ui.mount({
      plugin: 'hatchling', surface: 'terminal', component: 'AbovePrompt',
      props: { ...BAND, bodyColumns: 24 }, viewport: { columns: 200, rows: 50 },
    })
    expect(await ui.find({ key: 'sprite' })).toBeUndefined()
  })
})

describe('control characters', () => {
  const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

  /** Every string anywhere in a drawn tree: children, labels, props. */
  function strings(value: unknown): string[] {
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value.flatMap(strings)
    if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings)
    return []
  }

  async function expectClean(ui: Drawing, label: string): Promise<void> {
    const found = strings(await ui.drawn()).filter(text => CONTROL.test(text))
    expect(found, label).toEqual([])
  }

  test('a name typed with ESC, BEL and U+0085 is cleaned, and band and card still draw', async ($, on) => {
    const w = world(on, { pet: savedPet({ name: 'Bean' }) })
    await start($)
    await petCommand($, 'name \u001b[31mPip\u0007\u0085')
    expect(pet(w).name).toBe('Pip')
    const card = (await petCommand($, 'card')).text ?? ''
    expect(card.split('\n').filter(line => CONTROL.test(line))).toEqual([])
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await ui.find({ key: 'sprite' })).toBeDefined()
      expect(await shown(ui)).toContain('Pip')
      await expectClean(ui, `${surface} band`)
      await ui.unmount()
      const row = await $.ui.mount({
        plugin: 'hatchling', surface, component: 'CommandOutput',
        props: { command: 'pet', args: 'card', text: card, isErrored: false },
      })
      expect(await row.find({ key: 'card' })).toBeDefined()
      await expectClean(row, `${surface} card`)
      await row.unmount()
    }
  })

  test("a tool's name with control characters is drawn safe", async ($, on) => {
    world(on, { pet: savedPet() })
    await start($)
    await $.tool.call({ tool: 'mcp__evil__run\u001b]0;title\u0007\u0007\u0085' })
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await ui.find({ key: 'sprite' })).toBeDefined()
      expect(await shown(ui)).toContain('Pip bounces - run\ufffd\ufffd worked')
      await expectClean(ui, surface)
      await ui.unmount()
    }
  })

  test('a stored name damaged by hand is cleaned on load', async ($, on) => {
    world(on, { pet: savedPet({ name: 'Mo\u001b[2Jchi\u009b' }) })
    await start($)
    const ui = await band($, 'desktop')
    expect(await shown(ui)).toContain('Mochi')
    await expectClean(ui, 'desktop')
  })
})

describe('verify follow-ups', () => {
  test('/pet is registered to run at once, even mid-turn', async ($, on) => {
    const w = world(on)
    await start($)
    expect(w.registered).toEqual([
      expect.objectContaining({ name: 'pet', immediate: true, argumentHint: '[name <name> | hide | show | card]' }),
    ])
  })

  test('/pet rows with control characters in their text still draw, cleaned', async ($, on) => {
    world(on, { pet: savedPet() })
    await start($)
    const dirty = (text: string) =>
      text.replace('Pip the Geobug', 'P\u001b[31mip\u0007 the Geobug').replace('Plain rock', 'Plain\u0000 rock\u007f\u009b')
    const stats = dirty((await petCommand($, '')).text ?? '')
    const card = dirty((await petCommand($, 'card')).text ?? '')
    for (const surface of SURFACES) {
      for (const [args, text, key] of [['', stats, 'stats'], ['card', card, 'card']] as const) {
        const row = await $.ui.mount({
          plugin: 'hatchling', surface, component: 'CommandOutput',
          props: { command: 'pet', args, text, isErrored: false },
        })
        expect(await row.find({ key }), `${surface} ${key}`).toBeDefined()
        // JSON escapes C0 as \\u00XX but leaves DEL and C1 as they are.
        const drawn = JSON.stringify(await row.drawn())
        expect(/\\u00[01][0-9a-f]/.test(drawn) || /[\u007f-\u009f]/.test(drawn), `${surface} ${key}`).toBe(false)
        expect(await shown(row)).toContain('the Geobug')
        await row.unmount()
      }
    }
  })

  test('an old egg without a seed gets one on its first call, even with no fresh start', async ($, on) => {
    const egg = { v: 1, bornAt: T0 - DAY, eggCalls: 10, xp: 0, hidden: false, toolCalls: 10, turns: 1, testsPassed: 0 }
    const w = world(on, { pet: egg })
    await bash($, 'ls')
    expect(pet(w).seed).toHaveLength(4)
    const seed = pet(w).seed
    await bash($, 'ls', 3)
    expect(pet(w).seed).toEqual(seed)
  })

  test('a phone alone draws no band, so no timer runs', async ($, on) => {
    const w = world(on, { pet: savedPet() }, { surfaces: ['mobile'] })
    await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })
    await bash($, 'npm test')
    await $.turn.start({ text: 'go', turnId: 't8' })
    await turn($)
    await w.clock.advance(2 * SLEEP)
    expect(w.timers).toEqual({ every: 0, after: 0 })
  })

  test('/pet and /pet card only read the saved pet', async ($, on) => {
    const w = world(on, { pet: savedPet() })
    await start($)
    const before = w.writes.length
    await petCommand($, '')
    await petCommand($, 'card')
    expect(w.writes.length).toBe(before)
    // A change another session saved a moment ago is shown, and left alone.
    w.store.set('pet', savedPet({ name: 'Bao', xp: 300 }))
    expect((await petCommand($, '')).text).toContain('Bao the Geobug')
    expect(pet(w).name).toBe('Bao')
  })
})

describe("Bolt's egg, and the desktop's cell grid", () => {
  // The egg is Bolt's (MM-091): `egg`, leaning with the wobble while Claude works,
  // cracked from 15 calls, and lifting its lid as it hatches. A Raster on the terminal;
  // on the desktop, like every hatchling sprite, one code-font cell per character so
  // rows never drift (MM-084).
  type Drawn = { type?: unknown; key?: unknown; props?: Record<string, unknown>; children?: unknown[] }
  /** Bolt as drawn: the Raster's cells, or each desktop row as `width:ch|fg|bg` per one-cell Box. */
  const drawnBolt = (bolt: Drawn | undefined) => {
    if (bolt === undefined) return undefined
    if (bolt.type === 'Raster') return [bolt.props?.columns, bolt.props?.rows, bolt.props?.cells]
    return ((bolt.children ?? []) as Drawn[]).map(line =>
      ((line.children ?? []) as Drawn[]).map(cell => {
        const text = (cell.children ?? [])[0] as Drawn | undefined
        const paint = text === undefined ? ' ' : `${(text.children ?? []).join('')}|${text.props?.color ?? ''}|${text.props?.backgroundColor ?? ''}`
        return `${String(cell.type)}${String(cell.props?.width)}:${paint}`
      }),
    )
  }
  /** What `pick` must draw as on `surface`: its exact cells, at its exact size. */
  const boltAs = (surface: string, pick: BoltPick) => {
    const cells = boltOf(pick)
    if (surface === 'terminal') return [cells[0]?.length, cells.length, rasterCells(cells)]
    return cells.map(line =>
      line.map(c => `Box1:${c.fg === undefined && c.bg === undefined ? ' ' : `${c.ch}|${c.fg ?? ''}|${c.bg ?? ''}`}`),
    )
  }
  const EGG: BoltPick = { size: 'small', pose: 'egg' }
  const CRACK: BoltPick = { size: 'small', pose: 'egg-crack-1' }
  const pick = (pose: 'egg-wobble-l' | 'egg-wobble-r' | 'egg-crack-3' | 'egg-hatch'): BoltPick => ({ size: 'small', pose })
  /** Every desktop sprite row: a no-wrap row of Boxes one cell wide, each holding at most one character. */
  const gridOf = (found: Drawn | undefined) =>
    ((found?.children ?? []) as Drawn[]).map(row => {
      const cells = (row.children ?? []) as Drawn[]
      const isGrid =
        row.type === 'Box' && row.props?.flexWrap === 'nowrap' &&
        cells.every(cell => cell.type === 'Box' && cell.props?.width === 1 && [...textOf(cell as RenderNode)].length <= 1)
      return isGrid ? cells.length : -1
    })

  test("the egg is Bolt's egg on both surfaces, cracked from 15 calls, and the info beside it is unchanged", async ($, on) => {
    const w = world(on)
    await start($)
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(drawnBolt(await ui.find({ key: 'sprite' })), surface).toEqual(boltAs(surface, EGG))
      expect(await shown(ui)).toContain('Egg  hatches in 25 tool calls')
      expect(await shown(ui)).toContain('Something stirs inside the egg')
      await ui.unmount()
    }
    await bash($, 'ls', 14)
    const still = await band($, 'desktop')
    expect(drawnBolt(await still.find({ key: 'sprite' }))).toEqual(boltAs('desktop', EGG))
    await still.unmount()
    await bash($, 'ls')
    expect(pet(w).eggCalls).toBe(15)
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(drawnBolt(await ui.find({ key: 'sprite' })), surface).toEqual(boltAs(surface, CRACK))
      expect(await shown(ui)).toContain('15/25 to hatch')
      await ui.unmount()
    }
  })

  test("while Claude works the egg wobbles on its own timer through Bolt's upright and leaning poses", async ($, on) => {
    const w = world(on)
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const poses = [EGG, pick('egg-wobble-l'), pick('egg-wobble-r')]
    for (const surface of SURFACES) {
      const ui = await band($, surface, { isWorking: true })
      const seen = new Set<number>()
      for (let i = 0; i < 8; i += 1) {
        const drawn = drawnBolt(await ui.find({ key: 'sprite' }))
        const at = poses.findIndex(one => JSON.stringify(boltAs(surface, one)) === JSON.stringify(drawn))
        expect(at, `${surface} frame ${i}`).toBeGreaterThanOrEqual(0)
        seen.add(at)
        await w.clock.advance(FRAME)
      }
      expect(seen.size, surface).toBe(3)
      expect(await shown(ui)).toContain('The egg is wobbling...')
      await ui.unmount()
    }
    expect(w.timers.every).toBeGreaterThanOrEqual(16)
  })

  test('the hatch shows the last crack, the lid lifting, then the pet, never Bolt again; a narrow band draws no egg', async ($, on) => {
    const w = world(on)
    await start($)
    const narrow = await band($, 'terminal', { bodyColumns: 24 })
    expect(await narrow.find({ key: 'sprite' })).toBeUndefined()
    expect(await shown(narrow)).toMatch(/^[\u2588\u2591]{5} Something stirs inside the egg$/)
    await narrow.unmount()
    await bash($, 'ls', 25)
    expect(pet(w).hatch).toBeDefined()
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(drawnBolt(await ui.find({ key: 'sprite' })), surface).toEqual(boltAs(surface, pick('egg-crack-3')))
      await ui.unmount()
    }
    await w.clock.advance(4 * FRAME)
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(drawnBolt(await ui.find({ key: 'sprite' })), surface).toEqual(boltAs(surface, pick('egg-hatch')))
      await ui.unmount()
    }
    await w.clock.advance(16 * FRAME)
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      const drawn = drawnBolt(await ui.find({ key: 'sprite' }))
      expect(drawn, surface).toBeDefined()
      for (const one of [EGG, CRACK, pick('egg-crack-3'), pick('egg-hatch')]) expect(drawn, surface).not.toEqual(boltAs(surface, one))
      await ui.unmount()
    }
  })

  test('on the desktop every sprite row is one code-font cell per character: egg, pets at each stage, and the /pet row', async ($, on) => {
    const w = world(on)
    await start($)
    const sizes: [number, number][] = [[10, 5], [10, 5], [12, 5], [16, 6]]
    const pets = [undefined, savedPet({ xp: 0 }), savedPet({ xp: 300 }), savedPet({ xp: 900 })]
    for (const [i, saved] of pets.entries()) {
      if (saved !== undefined) {
        w.store.set('pet', saved)
        await start($)
      }
      const [columns, rows] = sizes[i] ?? [0, 0]
      const ui = await band($, 'desktop')
      expect(gridOf(await ui.find({ key: 'sprite' })), `pet ${i}`).toEqual(Array<number>(rows).fill(columns))
      await ui.unmount()
      const terminal = await band($, 'terminal')
      expect((await terminal.find({ key: 'sprite' }))?.type, `pet ${i}`).toBe('Raster')
      await terminal.unmount()
    }
    const stats = (await petCommand($, '')).text ?? ''
    const row = await $.ui.mount({
      plugin: 'hatchling', surface: 'desktop', component: 'CommandOutput',
      props: { command: 'pet', args: '', text: stats, isErrored: false },
    })
    expect(gridOf(await row.find({ key: 'portrait' }))).toEqual(Array<number>(6).fill(16))
    expect(await shown(row)).toContain('Pip the Geobug')
  })
})
