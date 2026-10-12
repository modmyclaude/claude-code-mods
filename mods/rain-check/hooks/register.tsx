// Rain Check: once Claude Code refuses a turn on a usage limit (the 5-hour or
// weekly window), a prompt the person sends waits instead of failing, and goes
// out by itself just after the window resets. The turn the limit cut off can be
// picked up the same way, but only when the person asks: nothing is sent unasked.
//
// Signals: `classic.StopFailure` with `error: 'rate_limit'` (the refusal) and
// `session.measure`'s `rateLimits` (which window, and its `resetsAt`). A reading
// at 100% alone never holds a prompt: extra usage can still let requests through.
// While something waits, the countdown ticks once a minute; otherwise no timer.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register, RenderNode, Timer } from 'claude-code'

import type { RainCheckQueued } from '../types'
import {
  CONTINUE_TEXT, SECOND_REFUSAL_MS, TICK_MS, clockWords, cutOffWindow, holdText, joined, limitLine, oneLine, ownWords, preview,
  sendTime, waitingLine,
} from './logic'
import type { Window } from './logic'

const LIMIT = { plugin: 'rain-check', key: 'limit' } as const
const QUEUED = { plugin: 'rain-check', key: 'queued' } as const
const NOW = { plugin: 'rain-check', key: 'now' } as const
const LAST = { plugin: 'rain-check', key: 'lastSent' } as const

const limit = atom(LIMIT, null)
const queued = atom(QUEUED, null)
const clock = atom(NOW, 0)
const lastSent = atom(LAST, null)

// What lives only as long as this copy of the module: the last windows Claude Code
// reported, and the countdown's timer (a reload starts both over; heal re-arms it).
let windows: readonly Window[] = []
let timer: Timer | null = null
/** When the last refusal near (not at) a cap came: a second one soon after makes it count. */
let nearRefusalAt = -Infinity
/** Set before send's first await, so two presses (or a press and the tick) cannot both send. */
let isSending = false

/** A prompt the person sent themselves: typed, from the phone bridge, or the desktop app's box. */
async function isPerson($: EngineInterface, origin: PromptOrigin | undefined): Promise<boolean> {
  if (origin === undefined || origin.kind === 'composer' || origin.kind === 'bridge') return true
  return origin.kind === 'sdk' && (await $.session.surfaces()).includes('desktop')
}

async function safely($: EngineInterface, work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch (error) {
    $.ui.log(`rain-check: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  }
}

/** Starts the minute tick while a limit or a waiting prompt is shown, and stops it when neither is. */
async function sync($: EngineInterface): Promise<void> {
  const isActive = (await read($, limit)) !== null || (await read($, queued)) !== null
  if (isActive && timer === null) timer = $.clock.every(TICK_MS, () => void safely($, () => tick($)))
  if (!isActive && timer !== null) {
    timer.cancel()
    timer = null
  }
  const now = await $.clock.now()
  await update($, clock, () => now)
}

/** Once a minute: moves the countdown, and at the reset sends what waits or clears the limit. */
async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, clock, () => now)
  const waiting = await read($, queued)
  if (waiting !== null && now >= waiting.sendAt) return send($)
  const cur = await read($, limit)
  if (waiting === null && cur !== null && now >= sendTime(cur)) {
    await update($, limit, () => null)
    $.ui.toast('Usage limit reset.')
    await sync($)
  }
}

/**
 * Sends what waits as a turn of its own. It reads the queue afresh, so the tick, Send now and
 * /rain-check now never send it twice. A prompt another hook drops comes back to the person;
 * one the limit refuses again waits again (classic.StopFailure, from lastSent).
 */
async function send($: EngineInterface): Promise<void> {
  if (isSending) return
  isSending = true
  try {
    const waiting = await read($, queued)
    if (waiting === null) return
    await update($, queued, () => null)
    await update($, limit, () => null)
    await update($, lastSent, () => waiting)
    await sync($)
    const result = await $.prompt.submit({ text: waiting.text })
    if (result.drop !== undefined) {
      await update($, lastSent, () => null)
      await giveBack($, waiting, `Not sent: ${oneLine(result.drop, 80)}.`)
      return
    }
    $.ui.toast(waiting.source === 'continue' ? 'Usage limit reset. Picking up where Claude stopped.' : 'Usage limit reset. Your waiting prompt is sent.')
  } finally {
    isSending = false
  }
}

/** Puts the person's own words back in the prompt box (after any draft there), or in a toast where no box takes them. */
async function giveBack($: EngineInterface, waiting: RainCheckQueued, lead: string): Promise<void> {
  const words = ownWords(waiting)
  if (words === '') return $.ui.toast(lead)
  let isFilled = false
  try {
    const box = await $.prompt.read()
    const text = box.text.trim() === '' ? words : `${box.text}\n\n${words}`
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled
  } catch {
    isFilled = false
  }
  $.ui.toast(isFilled ? `${lead} Your words are back in the prompt box.` : `${lead} "${oneLine(words, 60)}"`)
}

/** Drops what waits, and never the person's words: they go back in the box. */
async function cancel($: EngineInterface): Promise<void> {
  const waiting = await read($, queued)
  if (waiting === null) return $.ui.toast('Nothing is waiting.')
  await update($, queued, () => null)
  await sync($)
  await giveBack($, waiting, 'Cancelled.')
}

/** The window a refused turn ran into, from a reading taken now (the last one can trail), else the last one. */
async function refusedWindow($: EngineInterface, now: number): Promise<ReturnType<typeof cutOffWindow>> {
  try {
    const fresh = (await $.session.usage()).rateLimits
    if (fresh.length > 0) return cutOffWindow(fresh, now)
  } catch {
    // No fresh reading: the last one stands.
  }
  return cutOffWindow(windows, now)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rain-check',
      description: 'See the prompt waiting for your usage limit; /rain-check now sends it, /rain-check cancel drops it',
      argumentHint: '[now|cancel]',
      immediate: true,
    })
    const started = await next(e)
    // After a reload the limit and the waiting prompt are still in $.state, but not their tick.
    await safely($, () => sync($))
    return started
  })

  // Keeps the latest windows: a refusal reads its reset time from them.
  on('session.measure', ($, e, next) => {
    windows = e.rateLimits
    return next(e)
  })

  // A turn Claude Code ended on the usage limit: hold what comes next until the reset.
  on('classic.StopFailure', async ($, e, next) => {
    if (e.error === 'rate_limit') {
      await safely($, async () => {
        const now = await $.clock.now()
        const out = await refusedWindow($, now)
        // No window near full: a passing 429 (or an API key, which has none). Claude Code retries those itself.
        if (out === null) return
        const again = await read($, lastSent)
        // Near a cap but not at it, one refusal may be a passing one: hold only on a second soon after
        // (or on a refusal of what Rain Check just sent, which follows a limit already seen).
        const isFirstNear = !out.isSure && again === null && now - nearRefusalAt > SECOND_REFUSAL_MS
        nearRefusalAt = out.isSure ? -Infinity : now
        if (isFirstNear) return
        await update($, limit, () => ({ kind: out.kind, resetsAt: out.resetsAt }))
        // What Rain Check sent was refused again: it waits for this reset instead.
        if (again !== null) {
          await update($, lastSent, () => null)
          await update($, queued, cur => joined(cur, again.text, sendTime(out)))
          $.ui.toast(`Still at the usage limit. It waits for ${clockWords(sendTime(out), now)}.`)
        }
        await sync($)
      })
    }
    return next(e)
  })

  // At the limit, a prompt the person sends waits for the reset instead of failing. A hook that
  // throws is skipped and the prompt goes through, so a bug here never eats one (a test pins it).
  on('prompt.submit', async ($, e, next) => {
    if (e.turnId !== undefined || !(await isPerson($, e.origin))) return next(e)
    // Slash commands and shell lines never reach the model's limit: they always run.
    if (/^\s*[/!]/.test(e.text)) return next(e)
    const cur = await read($, limit)
    const now = await $.clock.now()
    if (cur === null || now >= sendTime(cur)) return next(e)
    const waiting = await read($, queued)
    const held = joined(waiting, e.text, sendTime(cur))
    await update($, queued, () => held)
    await sync($)
    return { drop: holdText(held, now, waiting !== null, (e.attachments?.length ?? 0) > 0) }
  })

  // A main turn that answered means the limit is over: what waits can go now.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer') {
      await safely($, async () => {
        await update($, lastSent, () => null)
        if ((await read($, limit)) === null) return
        await update($, limit, () => null)
        // A hook cannot submit inside the turn it is ending: the send goes one clock turn later.
        if ((await read($, queued)) !== null) $.clock.after(0, () => void safely($, () => send($)))
        else await sync($)
      })
    }
    return next(e)
  })

  // A /clear or a resumed conversation: picking up the old turn no longer makes sense.
  // The limit is the account's and stays, and so does a prompt the person wrote.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await safely($, async () => {
        if ((await read($, queued))?.source === 'continue') {
          await update($, queued, () => null)
          await sync($)
        }
      })
    }
    return next(e)
  })

  on('command.run', { command: 'rain-check' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    const waiting = await read($, queued)
    const cur = await read($, limit)
    const now = await $.clock.now()
    if (word === 'now') {
      // A command's hook holds the turn it runs in: the send waits one clock turn, past it.
      if (waiting === null) $.ui.toast('Nothing is waiting.')
      else $.clock.after(0, () => void safely($, () => send($)))
      return {}
    }
    if (word === 'cancel') {
      await cancel($)
      return {}
    }
    if (word !== '') {
      $.ui.toast('Try /rain-check, /rain-check now or /rain-check cancel.')
      return {}
    }
    if (waiting !== null) $.ui.toast(`${waitingLine(waiting, now)}. /rain-check now sends it, /rain-check cancel drops it.`)
    else if (cur !== null) $.ui.toast(`${limitLine(cur, now)}. What you send now waits for it.`)
    else $.ui.toast('Nothing is waiting. At a usage limit, what you send waits here.')
    return {}
  }).catch($ => {
    $.ui.toast('/rain-check could not finish.')
    return {}
  })

  // The band: beneath whatever other mods draw, one line (two while a prompt waits).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const waiting = await read($, queued)
    const cur = await read($, limit)
    if (waiting === null && cur === null) return next(e)
    if (timer === null) void safely($, () => sync($))
    const now = (await read($, clock)) || (await $.clock.now())
    const rest = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const rows: RenderNode[] = []
    if (waiting !== null) {
      rows.push(
        <Box key="rain-waiting" flexDirection="row" gap={1}>
          <Text color="warning" wrap="truncate-end">{waitingLine(waiting, now)}</Text>
          <Button key="rain-now" label="Send now" onPress={() => safely($, () => send($))} />
          <Button key="rain-cancel" label="Cancel" onPress={() => safely($, () => cancel($))} />
        </Box>,
        <Box key="rain-preview">
          <Text dimColor wrap="truncate-end">{preview(waiting, e.props.bodyColumns)}</Text>
        </Box>,
      )
    } else if (cur !== null) {
      rows.push(
        <Box key="rain-limit" flexDirection="row" gap={1}>
          <Text color="warning" wrap="truncate-end">{limitLine(cur, now)}</Text>
          <Button
            key="rain-continue"
            label="Continue then"
            variant="primary"
            onPress={() =>
              safely($, async () => {
                await update($, queued, () => ({ text: CONTINUE_TEXT, sendAt: sendTime(cur), source: 'continue' as const }))
                await sync($)
              })
            }
          />
          <Button
            key="rain-dismiss"
            label="Dismiss"
            onPress={() =>
              safely($, async () => {
                await update($, limit, () => null)
                await sync($)
              })
            }
          />
        </Box>,
      )
    }
    // What other mods draw here comes first.
    return (
      <Box key="rain-check" flexDirection="column">
        {rest}
        {rows}
      </Box>
    )
  })
}
