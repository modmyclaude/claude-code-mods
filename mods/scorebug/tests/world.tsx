// The world beneath scorebug in a test: a clock at a moment when both pretend
// games are on, recorders for every toast and log line, the
// engine's own answers for the band and the backdrop, and two other mods with
// a scene of their own: one asked after scorebug, one before it that lays what
// the hooks beneath it draw over its scene.

import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf, RenderViewport } from 'claude-code'

import { ROUND } from '../hooks/games'

export const PLUGIN = 'scorebug'
/** Two minutes into a round: the first game a minute into its first period, the second early in its fourth quarter. */
export const AT = 1_888_889 * ROUND + 120_000
export const VIEWPORT: RenderViewport = { columns: 120, rows: 40, isFullscreen: true }

export function world(on: On) {
  const clock = mock.clock(on, { now: AT })
  const rec = { toasts: [] as string[], logs: [] as string[] }
  on('ui.toast', (_$, e) => {
    rec.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    rec.logs.push(e.text)
    return { value: undefined }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('config.set', (_$, e) => ({ value: e.value }))
  // What the engine draws when no plugin draws: one marker Text in the band, nothing behind the chat.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  on('ui.render', { component: 'Backdrop' }, () => ({ type: 'engine', ref: 0 }))
  return {
    clock,
    rec,
    /** Lets the look a timer started finish. */
    async settle() {
      for (let i = 0; i < 40; i += 1) await Promise.resolve()
    },
    /** Starts the session and lets the first look, on a zero-delay timer, fire and settle. */
    async start($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
      await $.session.start({ cwd: '/work', surface, isInteractive: true })
      await clock.advance(1)
      await this.settle()
    },
    /** Moves the clock on and lets every look it starts finish. */
    async pass(ms: number) {
      await clock.advance(ms)
      await this.settle()
    },
  }
}

export const scores = ($: Engine, args: string) =>
  $.command.run({ command: 'scores', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

// `isCollapsed` is new in Claude Code 2.1.326's band props and unknown to older types: kept in an untyped base, never a typed literal.
const BAND = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} }

export function mountBand($: Engine, surface: 'terminal' | 'desktop', over: Partial<RenderPropsOf['AbovePrompt']> = {}) {
  return $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: { ...BAND, ...over }, viewport: VIEWPORT })
}

/**
 * Whether this engine draws a scene behind the chat (Claude Code 2.1.325+). An
 * older one has no Backdrop to mount, and the tests of the cards stand down
 * there: scorebug still loads and shows the row above the prompt.
 */
export async function hasBackdrop($: Engine): Promise<boolean> {
  try {
    const ui = await mountBackdrop($, 'nobody', 'probe')
    await ui.unmount()
    return true
  } catch (err) {
    if (String(err).includes('is not a component')) return false
    throw err
  }
}

/** The backdrop of a scene `plugin` set, as the desktop app asks for it. */
export function mountBackdrop($: Engine, plugin: string, scene: string) {
  return $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Backdrop', props: { scene, plugin, glass: { blur: 14, opacity: 0.56 } } })
}

export type Drawn = { type?: unknown; key?: unknown; props?: Record<string, unknown>; children?: unknown[] }

export function walk(node: unknown, pred: (n: Drawn) => boolean, out: Drawn[] = []): Drawn[] {
  if (Array.isArray(node)) {
    for (const c of node) walk(c, pred, out)
    return out
  }
  if (node === null || typeof node !== 'object') return out
  const n = node as Drawn
  if (pred(n)) out.push(n)
  walk(n.children ?? [], pred, out)
  return out
}

/** Every text in a drawn tree, in order. */
export function texts(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) for (const c of node) texts(c, out)
  else if (typeof node === 'object' && node !== null) texts((node as Drawn).children ?? [], out)
  return out
}

export const keyOf = (n: Drawn) => (typeof n.key === 'string' ? n.key : typeof n.props?.key === 'string' ? n.props.key : undefined)

/** The band's row as words, or '' where scorebug drew none. */
export async function rowOf(band: { drawn: () => Promise<unknown> }): Promise<string> {
  const row = walk(await band.drawn(), n => keyOf(n) === 'scorebug')[0]
  return row === undefined ? '' : texts(row).join('')
}

/** The column of cards in a drawn backdrop, if any. */
export function columnOf(drawn: unknown): Drawn | undefined {
  return walk(drawn, n => n.type === 'Box' && n.props?.position === 'absolute' && n.props?.top === 3)[0]
}

/** Another mod with a scene, asked after scorebug. */
export const SCENERY = {
  name: 'scenery',
  tier: 'append' as const,
  register(on: On) {
    on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
      if (e.surface !== 'desktop' || e.props.plugin !== 'scenery') return next(e)
      // A plugin's hooks run apart from this file, so its scene is written here in full.
      const { Svg } = $.ui.resolve(e)
      return <Svg source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#123"/></svg>' alt="another mod's scene" isInteractive />
    })
  },
}

/** Another mod with a scene, asked before scorebug, that lays over its scene what the hooks beneath it draw, as wardrobe does. */
export const HOST = {
  name: 'host',
  tier: 'prepend' as const,
  register(on: On) {
    on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
      if (e.surface !== 'desktop' || e.props.plugin !== 'host') return next(e)
      const { Box, Svg } = $.ui.resolve(e)
      const over = await next(e)
      const own = <Svg source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#321"/></svg>' alt="the host's scene" isInteractive />
      if (over.type === 'engine') return own
      return (
        <Box position="relative" width="100%" height="100%">
          {own}
          <Box position="absolute" top={0} left={0} right={0} bottom={0}>
            {over}
          </Box>
        </Box>
      )
    })
  },
}

/** Another mod with a scene, asked before scorebug, that answers for its scene alone. */
export const LONER = {
  name: 'loner',
  tier: 'prepend' as const,
  register(on: On) {
    on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
      if (e.surface !== 'desktop' || e.props.plugin !== 'loner') return next(e)
      const { Svg } = $.ui.resolve(e)
      return <Svg source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#111"/></svg>' alt="the loner's scene" isInteractive />
    })
  },
}
