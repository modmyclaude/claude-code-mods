// Last Look: holds a destructive Bash command, measures what it would
// destroy, and waits for the person to press Cancel or Proceed.
//
// A safety net, not a permission system: it judges commands by their text,
// measures with read-only commands, and on any fault of its own it stops the
// command rather than let it run unchecked.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { LastLookHold, LastLookReport } from '../types'
import { classify } from './classify'
import { MEASURE_ENV, measureAll, shouldHold } from './measure'
import type { Ctx, Probe } from './measure'
import { parseAllow } from './paths'
import { drawHold } from './view'

const PANE = 'last-look'
const holds = atom({ plugin: 'last-look', key: 'holds' } as const, [])

type Choice = 'proceed' | 'cancel'
type Outcome = Choice | 'aborted' | 'no-wait' | 'nowhere'

/**
 * The press handlers' way back to the waiting hook. A function cannot live in
 * $.state, so this one map is module state; a hold it no longer knows (the
 * module reloaded) is simply cleared when pressed.
 */
const waiting = new Map<string, (choice: Choice) => void>()

/**
 * What the hold keeps in flight while it waits. A hook's 10 s budget counts
 * only its own running time and stands still while a `$` call is in flight,
 * but a `$.clock` wait counts; so the hold keeps one cheap, read-only
 * `sleep` running until the person answers. The second line is for Windows.
 */
const SLEEPERS: readonly (readonly string[])[] = [
  ['sleep', '1'],
  ['powershell', '-NoProfile', '-Command', 'Start-Sleep -Seconds 1'],
]

const STATUS = 'Last Look is holding a command: Cancel or Proceed'
const LOGGED: Record<Outcome, string> = {
  proceed: 'you let this run',
  cancel: 'you cancelled',
  aborted: 'stopped when the turn was interrupted',
  'no-wait': 'stopped, it could not wait for your review',
  nowhere: 'stopped, nowhere to show the review',
}
const STOP = 'Do not retry it or reach the same result another way; ask the person what they want instead.'
const FAILED = 'last-look: its safety check failed, so this command was stopped instead of running unchecked. Ask the person to run it themselves if they intend it.'

export const register: Register = (on, options) => {
  const allow = parseAllow(String(options.alwaysAllow ?? ''))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    // Judge first: nothing runs until this hook has decided.
    if (classify(e.command).length === 0) return next(e)
    const home = await $.env.get('HOME')
    const findings = classify(e.command, home === undefined ? {} : { home })
    const ctx = await context($, home, allow)

    $.ui.status(`Last Look is measuring: ${clip(e.command, 60)}`)
    let report: LastLookReport
    try {
      report = await measureAll(ctx, e.command, findings)
    } finally {
      $.ui.status(undefined)
    }
    if (!shouldHold(report)) return next(e)

    const surfaces = await $.session.surfaces()
    if (surfaces.length === 0) {
      return { deny: `last-look: nobody can review this command in this session, so it was stopped (${report.headline}). Ask the person to run it themselves if they intend it.` }
    }
    const outcome = await hold($, { id: e.tool_use_id, report, isSubagent: e.agentId !== undefined }, surfaces, next.signal)
    $.ui.log(`Last Look: ${LOGGED[outcome]}: ${clip(e.command, 80)}`)
    if (outcome === 'proceed') return next(e)
    return { deny: refusal(outcome, report) }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: FAILED }))

  // Closing the pane by hand (its close mark, Esc) is a Cancel.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') for (const resolve of waiting.values()) resolve('cancel')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const list = await read($, holds)
    const first = list[0]
    if (!first) return <kit.Text dimColor>Nothing is held right now.</kit.Text>
    return drawHold(kit, first, {
      rows: e.props.scroll.bodyRows,
      columns: e.props.bodyColumns,
      compact: false,
      surface: e.surface,
      queued: list.length - 1,
      onCancel: () => decide($, first.id, 'cancel'),
      onProceed: () => decide($, first.id, 'proceed'),
    })
  })

  // The band above the prompt: where the pane has no room to open.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const list = await read($, holds)
    const first = list.find(h => h.mode === 'band')
    if (!first) return next(e)
    return drawHold($.ui.resolve(e), first, {
      rows: e.props.maxRows,
      columns: e.props.bodyColumns,
      compact: true,
      surface: e.surface,
      queued: list.length - 1,
      onCancel: () => decide($, first.id, 'cancel'),
      onProceed: () => decide($, first.id, 'proceed'),
    })
  })
}

async function context($: EngineInterface, home: string | undefined, allow: readonly string[]): Promise<Ctx> {
  const [cwd, root, now] = await Promise.all([$.session.cwd(), $.session.root(), $.clock.now()])
  // Read-only: a command by argv (no shell), a stat, a directory listing.
  const probe: Probe = {
    run: (argv, cwd, timeoutMs) => $.process.run(argv, { cwd, timeoutMs, env: MEASURE_ENV }),
    // Missing is undefined; a stat that fails for another reason (permissions)
    // rejects, so that part is held unmeasured instead of read as not there.
    stat: async path => {
      try {
        return await $.fs.stat(path, { resolve: true })
      } catch (error) {
        if (await $.fs.exists(path)) throw error
        return undefined
      }
    },
    list: path => $.fs.list(path),
  }
  const real = (path: string) => probe.stat(path).then(s => s?.realPath ?? path, () => path)
  const [cwdReal, rootReal] = await Promise.all([real(cwd), real(root)])
  return { probe, cwd, cwdReal, root, rootReal, allow, now, ...(home === undefined ? {} : { home }) }
}

async function hold($: EngineInterface, entry: Omit<LastLookHold, 'mode'>, surfaces: readonly RenderSurface[], signal: AbortSignal): Promise<Outcome> {
  const decision = new Promise<Choice>(resolve => waiting.set(entry.id, resolve))
  try {
    // State first, so the pane's first drawing already has the report.
    await update($, holds, list => [...list.filter(h => h.id !== entry.id), { ...entry, mode: 'pane' as const }])
    // No `focus`: the pane never takes the keyboard on its own. With it, a
    // person typing their next prompt as the hold appears would be typing into
    // the pane (Tab then Enter could reach Proceed). They click or ctrl+x tab
    // in, and then Cancel holds the focus, so Enter cancels.
    const opened = await $.ui
      .open({ id: PANE, title: 'Last Look', closeOnEscape: true, holdToasts: true, rows: 22, columns: 72 })
      .catch(() => ({ isPlaced: false as const, reason: 'refused' }))
    if (!opened.isPlaced) {
      // A pane opened unasked waits on narrow terminals: use the band.
      if (!surfaces.some(s => s === 'terminal' || s === 'desktop')) return 'nowhere'
      await update($, holds, list => list.map(h => (h.id === entry.id ? { ...h, mode: 'band' as const } : h)))
    }
    $.ui.status(STATUS)
    return await waitFor($, decision, signal)
  } finally {
    waiting.delete(entry.id)
    const left = await update($, holds, list => list.filter(h => h.id !== entry.id)).catch(() => [])
    if (left.length === 0) {
      $.ui.status(undefined)
      await $.ui.close({ id: PANE }).catch(() => undefined)
    }
  }
}

async function waitFor($: EngineInterface, decision: Promise<Choice>, signal: AbortSignal): Promise<Outcome> {
  const aborted = new Promise<'aborted'>(resolve => {
    if (signal.aborted) resolve('aborted')
    else signal.addEventListener('abort', () => resolve('aborted'), { once: true })
  })
  let sleeper = 0
  while (true) {
    const argv = SLEEPERS[sleeper]
    if (!argv) return 'no-wait'
    const tick = $.process.run([...argv], { timeoutMs: 10_000 }).then(
      () => 'tick' as const,
      () => 'broken' as const,
    )
    const first = await Promise.race([decision, aborted, tick])
    if (first === 'broken') sleeper++
    else if (first !== 'tick') return first
  }
}

async function decide($: EngineInterface, id: string, choice: Choice): Promise<void> {
  const resolve = waiting.get(id)
  if (resolve) return resolve(choice)
  // Nothing waits on it (an earlier load of this module): clear it away.
  const left = await update($, holds, list => list.filter(h => h.id !== id))
  if (left.length === 0) await $.ui.close({ id: PANE })
}

function refusal(outcome: Exclude<Outcome, 'proceed'>, report: LastLookReport): string {
  if (outcome === 'cancel') return `last-look: the person reviewed this command and chose Cancel, so it did not run (${report.headline}). ${STOP}`
  if (outcome === 'aborted') return `last-look: this command was held for review when the turn was interrupted, so it did not run. ${STOP}`
  if (outcome === 'nowhere') return 'last-look: this session has no terminal or desktop view to show the review in, so the command was stopped. Ask the person to run it themselves if they intend it.'
  return 'last-look: it could not wait for a review here (no sleep command to wait with), so it stopped the command. Ask the person to run it themselves if they intend it.'
}

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= max ? line : `${line.slice(0, max - 3)}...`
}
