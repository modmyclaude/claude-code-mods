// Swear-jar: a jar that counts the model's verbal tics ("You're absolutely
// right", "Great question", the em dash) in a dim line above the prompt and a
// /swear-jar scoreboard, with an opt-in nudge for plain words.
//
// It counts the text of each main-conversation response as Claude Code receives
// it from the model, once per response, in memory. It never rewrites a reply,
// never holds a tool call, never reads a file.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode } from 'claude-code'

import type { SwearJarCounts, SwearJarHit } from '../types'
import { BOLT_COLUMNS, boltSprite } from './bolt-draw'
import { NUDGE_TEXT, bandWords, countReply, countsOf, merge, rowsOf, scoreboardText, showOf, statusWords, ticsOf, total, worst } from './jar'
import type { Show } from './jar'

const PANE = 'swear-jar'
const NUDGE_ID = 'swear-jar:plain-words'
const ALL_TIME = 'allTime'
const NUDGE = 'nudge'

const session = atom({ plugin: 'swear-jar', key: 'session' } as const, {} as SwearJarCounts)
const allTime = atom({ plugin: 'swear-jar', key: 'allTime' } as const, {} as SwearJarCounts)
const last = atom({ plugin: 'swear-jar', key: 'last' } as const, [] as SwearJarHit[])
const nudge = atom({ plugin: 'swear-jar', key: 'nudge' } as const, false)

/**
 * The button pairs a safety hold draws (Proceed with Cancel, Allow once with Deny). While a
 * pair is beneath, the band is left to the hold alone. One button alone is not a hold: a mod
 * that waits with Send now and Cancel keeps the jar's line.
 */
const HOLD_PAIRS: readonly (readonly [string, string])[] = [
  ['Proceed', 'Cancel'],
  ['Allow once', 'Deny'],
]

function buttonLabels(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const child of node) buttonLabels(child, found)
    return found
  }
  if (typeof node !== 'object' || node === null) return found
  const el = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown }
  const type = typeof el.type === 'string' ? el.type : (el.type as { name?: string } | undefined)?.name
  if (type === 'Button' && typeof el.props?.label === 'string') found.add(el.props.label)
  buttonLabels(el.props?.children, found)
  buttonLabels(el.children, found)
  return found
}

function holdsBeneath(node: unknown): boolean {
  const labels = buttonLabels(node)
  return HOLD_PAIRS.some(([yes, no]) => labels.has(yes) && labels.has(no))
}

/** The status line's count while that view is on; cleared when the jar is empty. */
function showStatus($: EngineInterface, show: Show, counts: SwearJarCounts): void {
  if (show.status) $.ui.status(total(counts) > 0 ? statusWords(counts) : undefined)
}

async function safely($: EngineInterface, work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch (error) {
    $.ui.log(`swear-jar: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  }
}

export const register: Register = (on, options) => {
  const settings = (options ?? {}) as Record<string, unknown>
  const tics = ticsOf(settings.tics)
  const show = showOf(settings.show)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await safely($, async () => {
      await $.command.register({
        name: 'swear-jar',
        description: "The jar for the model's verbal tics: scoreboard, reset, nudge on|off",
        argumentHint: '[reset [all] | nudge on|off]',
        immediate: true,
      })
    })
    await safely($, async () => {
      const stored = countsOf(await $.store.get(ALL_TIME))
      await update($, allTime, () => stored)
      const isOn = (await $.store.get(NUDGE)) === true
      await update($, nudge, () => isOn)
    })
    return started
  })

  // Each main-conversation response, as the model wrote it: counted once, in memory.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    if (e.agentId === undefined && response.answer !== '') {
      await safely($, async () => {
        const { counts, hits } = countReply(response.answer, tics)
        if (hits.length > 0) {
          const now = merge(await read($, session), counts)
          await update($, session, () => now)
          const all = merge(await read($, allTime), counts)
          await update($, allTime, () => all)
          await $.store.set(ALL_TIME, all)
          await update($, last, () => hits)
          showStatus($, show, now)
        } else if ((await read($, last)).length > 0) {
          await update($, last, () => [])
        }
      })
    }
    return response
  })

  // The nudge: one short session-scoped section at the end of the system prompt, only while it is on.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, nudge))) return composed
    return { ...composed, sections: [...composed.sections, { id: NUDGE_ID, text: NUDGE_TEXT, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  // A command's text is read by the model, so every answer here is {} and the words go to toasts, the pane or a log row.
  on('command.run', { command: 'swear-jar' }, async ($, e) => {
    const [verb, arg] = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (verb === undefined) {
      const opened = await $.ui.open({ id: PANE, title: 'Swear jar', closeOnEscape: true })
      if (!opened.isPlaced) $.ui.log(scoreboardText(await read($, session), await read($, allTime), await read($, last), await read($, nudge)))
      return {}
    }
    if (verb === 'reset') {
      await update($, session, () => ({}))
      await update($, last, () => [])
      if (arg === 'all') {
        await update($, allTime, () => ({}))
        await $.store.delete(ALL_TIME)
      }
      showStatus($, show, {})
      $.ui.toast(arg === 'all' ? 'Swear jar emptied: this session and all time.' : 'Swear jar emptied for this session.')
      return {}
    }
    if (verb === 'nudge') {
      if (arg === 'on' || arg === 'off') {
        const isOn = arg === 'on'
        await update($, nudge, () => isOn)
        await $.store.set(NUDGE, isOn)
        $.ui.toast(isOn ? 'Plain-words nudge is on: one short line joins every request, about 30 tokens.' : 'Plain-words nudge is off.')
      } else {
        $.ui.toast(`Plain-words nudge is ${(await read($, nudge)) ? 'on' : 'off'}. /swear-jar nudge on|off`)
      }
      return {}
    }
    $.ui.toast('/swear-jar opens the scoreboard; /swear-jar reset [all]; /swear-jar nudge on|off.')
    return {}
  }).catch($ => {
    $.ui.toast('/swear-jar could not finish.')
    return {}
  })

  // The band: one dim line under whatever other mods draw, nothing while the jar is empty,
  // and nothing at all while a safety hold beneath waits for an answer.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!show.band || e.props.hasSurvey) return next(e)
    const counts = await read($, session)
    if (total(counts) === 0) return next(e)
    const below = await next(e).catch(() => null)
    if (below !== null && holdsBeneath(below)) return below
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key="swear-jar-wrap" flexDirection="column">
        {below}
        <Box key="swear-jar">
          <Text dimColor wrap="truncate-end">{bandWords(counts)}</Text>
        </Box>
      </Box>
    )
  })

  // The scoreboard pane: this session, all time, the worst offender, the last reply's hits in their sentences.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    const counts = await read($, session)
    const all = await read($, allTime)
    const hits = await read($, last)
    const isNudge = await read($, nudge)
    const columns = e.props.bodyColumns
    const rows = (c: SwearJarCounts, key: string): RenderNode[] =>
      rowsOf(c).map(r => (
        <Box key={`${key}-${r.label}`} flexDirection="row" gap={1}>
          <Box key="label" flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">{r.label}</Text>
          </Box>
          <Box key="count" flexShrink={0}>
            <Text bold>{String(r.count)}</Text>
          </Box>
        </Box>
      ))
    const top = worst(all, counts)
    return (
      <Box key="swear-jar-pane" flexDirection="column" paddingX={1}>
        <Box key="title" flexDirection="row" gap={1} alignItems="center">
          {columns >= BOLT_COLUMNS.tiny + 37 ? boltSprite(elements, e.surface, { size: 'tiny', pose: 'idle' }, 'title-bolt') : null}
          <Text bold>Swear jar</Text>
        </Box>
        <Box key="session-title" marginTop={1}>
          <Text bold>{`This session: ${total(counts)}`}</Text>
        </Box>
        {total(counts) === 0 ? (
          <Text key="session-none" dimColor>
            nothing yet
          </Text>
        ) : (
          rows(counts, 'session')
        )}
        <Box key="all-title" marginTop={1}>
          <Text bold>{`All time: ${total(all)}`}</Text>
        </Box>
        {rows(all, 'all')}
        {top ? (
          <Box key="worst" marginTop={1}>
            <Text>{`Worst offender: ${top.label} (${top.count})`}</Text>
          </Box>
        ) : null}
        <Box key="last-title" marginTop={1}>
          <Text bold>Last reply</Text>
        </Box>
        {hits.length === 0 ? (
          <Text key="last-none" dimColor>
            no tics in the last reply
          </Text>
        ) : (
          hits.slice(0, 5).map((hit, i) => (
            <Box key={`hit-${i}`}>
              <Text wrap="wrap">
                {hit.before}
                <Text bold>{hit.tic}</Text>
                {hit.after}
              </Text>
            </Box>
          ))
        )}
        <Box key="foot" marginTop={1}>
          <Text color="subtle" wrap="wrap">
            {`Plain-words nudge ${isNudge ? 'on' : 'off'} (/swear-jar nudge on|off). /swear-jar reset empties this session; reset all empties the jar for good. Counts come from the text of each reply, in memory; nothing here reaches the model.`}
          </Text>
        </Box>
      </Box>
    )
  })
}
