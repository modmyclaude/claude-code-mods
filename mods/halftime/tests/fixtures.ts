// Shared test scaffolding: the world beneath the plugin, and readers for what
// the band drew. Every event the plugin passes on is answered here, so a test
// fails on the plugin's behaviour, never on a missing bottom.

import { expect, mock } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { ClassicResultOf, On, RenderSurface } from 'claude-code'

/** 3 pm local time on 9 October 2026: the daily board's day is 2026-10-09 wherever the test runs. */
export const T0 = new Date(2026, 9, 9, 15, 0, 0).getTime()

export const BAND = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 14,
  bodyColumns: 70,
  scroll: { offset: 0, bodyRows: 14 },
  view: {},
}

export const VIEWPORT = { columns: 75, rows: 30 }

export const SURFACES = ['terminal', 'desktop'] as const

/** What the engine draws when the plugin passes the band on. */
export const ENGINE_BAND = { type: 'Box' as const, props: {}, children: ['ENGINE'] }

export type Seen = {
  questions: number
  copies: string[]
  toasts: string[]
  /** Lines logged by plugins; the meter's start with `meter `. */
  logs: string[]
  commands: string[]
}

/**
 * Answers every event the plugin hands down, with a mocked clock and store.
 * Returns the clock and what the bottom saw.
 */
export function world(
  on: On,
  options: {
    store?: Record<string, unknown> | Map<string, unknown>
    now?: number
    permission?: ClassicResultOf['classic.PermissionRequest']
    /** What `$.session.surfaces()` answers: the terminal unless a test says otherwise. */
    surfaces?: RenderSurface[]
  } = {},
) {
  const clock = mock.clock(on, { now: options.now ?? T0 })
  const disk = options.store
  if (disk instanceof Map) {
    // A store the test can also write to directly, standing for another open session.
    on('store.get', (_$, e) => ({ value: disk.get(e.key) }))
    on('store.set', (_$, e) => {
      disk.set(e.key, JSON.parse(JSON.stringify(e.value)))
      return { value: undefined }
    })
  } else mock.store(on, disk ?? {})
  const seen: Seen = { questions: 0, copies: [], toasts: [], logs: [], commands: [] }
  on('ui.render', () => ENGINE_BAND)
  on('ui.message', () => ({}))
  on('command.register', (_$, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.log', (_$, e) => {
    seen.logs.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: options.surfaces ?? ['terminal'] }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('classic.PermissionRequest', () => options.permission ?? {})
  on('classic.Elicitation', () => ({}))
  on('classic.Notification', () => ({}))
  on('classic.PostToolBatch', () => ({}))
  on('tool.call', { tool: 'AskUserQuestion' }, () => {
    seen.questions += 1
    return { result: { answers: { 'Ship it?': 'Yes' } } as never, text: 'User answered: Yes' }
  })
  on('ui.copy', (_$, e) => {
    seen.copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  return { clock, seen }
}

/**
 * A plugin standing above halftime that logs every clock call halftime makes:
 * `$.clock.now` (each processed board post and each redraw reads it) and every
 * timer it schedules. Silence on the meter means nothing ticks and nothing redraws.
 */
export const METER: Plugin = {
  name: 'meter',
  tier: 'prepend',
  register(on) {
    on('clock.now', ($, e, next) => {
      $.ui.log('meter now', { to: 'debug' })
      return next(e)
    })
    on('clock.every', ($, e, next) => {
      $.ui.log(`meter every ${e.ms}`, { to: 'debug' })
      return next(e)
    })
    on('clock.after', ($, e, next) => {
      $.ui.log(`meter after ${e.ms}`, { to: 'debug' })
      return next(e)
    })
  },
}

export const meterCount = (seen: Seen, kind = '') => seen.logs.filter(l => l.startsWith(`meter ${kind}`)).length

/** The command as the person runs it at the prompt. */
export const halftime = (args: string) => ({
  command: 'halftime',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 80 },
})

/**
 * Runs `/halftime <args>` where the band draws and returns what it told the
 * person. It must answer {}: a command's text is a row the model reads
 *, so its words go to a toast instead.
 */
export async function said($: Engine, seen: Seen, args: string): Promise<string> {
  const before = seen.toasts.length
  expect(await $.command.run(halftime(args)), `/halftime ${args}`).toEqual({})
  return seen.toasts.slice(before).join(' | ')
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

function findClient(node: unknown): Node | undefined {
  if (!node || typeof node !== 'object') return undefined
  const n = node as Node
  if (n.type === 'Client') return n
  for (const child of n.children ?? []) {
    const hit = findClient(child)
    if (hit) return hit
  }
  return undefined
}

export type BoardSeen = {
  key: string
  rid: number
  live: boolean
  tick: number
  keys: string[]
  ack: [string, number]
  title: [string, string, string, number][]
  rows: [string, string, string, number][][]
  /** Field geometry for clicks (tailchase, sweep); null for a game with no field to aim at. */
  grid: { x: number; cw: number; ox: number; oy: number; w: number; h: number; vw: number } | null
  wait: string
  hint: string
}

/** The board's Client as the band drew it, with the props it was handed; undefined when no board is drawn. */
export async function boardOf(ui: { drawn: () => Promise<unknown> }): Promise<BoardSeen | undefined> {
  const client = findClient(await ui.drawn())
  if (!client) return undefined
  return { key: String(client.props?.key), ...(client.props?.props as Omit<BoardSeen, 'key'>) }
}

/**
 * Where on the board a field cell is drawn, as a pointer position (the field starts on the
 * board's second row). It reads the board's own grid, so a click here is a click on that cell
 * wherever the field was centered; `fieldAnchors` (ui.test) pins the grid to the drawn art.
 */
export function cellAt(b: BoardSeen, cx: number, cy: number): { x: number; y: number } {
  const g = b.grid!
  return { x: g.x + (cx - g.ox) * g.cw, y: cy - g.oy + 1 }
}

export const titleText = (b: BoardSeen) => b.title.map(s => s[0]).join('')
export const fieldText = (b: BoardSeen) => b.rows.map(r => r.map(s => s[0]).join(''))

/** Real time passing while the board ticks: the mocked clock and the board's frame clock move together. */
export async function play(clock: { advance: (ms: number) => Promise<void> }, ui: { advance: (ms: number) => Promise<void> }, ms: number, step = 60) {
  for (let t = 0; t < ms; t += step) {
    await clock.advance(step)
    await ui.advance(step)
  }
}

/** Every text the band drew, joined: for asserting on lines outside the board. */
export async function bandText(ui: { drawn: () => Promise<unknown> }): Promise<string> {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (typeof n === 'string') out.push(n)
    else if (n && typeof n === 'object') {
      const node = n as Node
      if (node.type === 'Button' && typeof node.props?.label === 'string') out.push(`[${node.props.label}]`)
      for (const c of node.children ?? []) walk(c)
    }
  }
  walk(await ui.drawn())
  return out.join(' ')
}
