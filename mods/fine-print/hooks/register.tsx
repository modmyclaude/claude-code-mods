// Fine Print: after a long reply, a small model reads it (plus the turn's
// tool names and targets) and, only when something matters, a note appears
// above the prompt. Silence is the default.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register, TurnCompleteInput } from 'claude-code'

import type { FinePrintNote, FinePrintNoteStatus, FinePrintTopic } from '../types'
import {
  MAX_NOTES,
  MAX_TOKENS,
  MIN_WORDS,
  MODEL,
  buildRequest,
  countWords,
  drawable,
  explainPrompt,
  isOwnQuestion,
  noteBlocks,
  noteLines,
  parseMaxChecks,
  parseVerdict,
  parseWatchFor,
  summarizeTools,
  turnToolUses,
  withStatus,
} from './logic'

const notes = atom({ plugin: 'fine-print', key: 'notes' } as const, [])
const shown = atom({ plugin: 'fine-print', key: 'shown' } as const, null)
const checks = atom({ plugin: 'fine-print', key: 'checks' } as const, 0)
const capNoticed = atom({ plugin: 'fine-print', key: 'capNoticed' } as const, false)
const warned = atom({ plugin: 'fine-print', key: 'warned' } as const, false)

type Settings = { topics: readonly FinePrintTopic[]; maxChecks: number }
type Request = { system: string; prompt: string }

// The engine follows `$` only into functions declared at the top of this
// file, so every helper that touches `$` lives out here.

function debug($: EngineInterface, text: string) {
  $.ui.log(drawable(`fine-print: ${text}`), { to: 'debug' })
}

// One toast per session when the model cannot be reached, so a blocked or
// failing model is never mistaken for "nothing to flag".
async function warnOnce($: EngineInterface, why: string) {
  let isFirst = false
  await update($, warned, was => ((isFirst = !was), true))
  if (isFirst) $.ui.toast(drawable(`Could not run its check (${why}). It will try again after the next long reply.`))
}

function capLine(maxChecks: number): string {
  return maxChecks === 0
    ? 'Off: maxChecksPerSession is 0.'
    : `Paused: all ${maxChecks} checks for this session are used. /fineprint keeps its notes.`
}

// The cap's status line follows the count: up once (when every check is
// spent), down when one is free again (a /clear, or a cap raised in /config).
// A reload re-asserts it, in case the reload took the line down.
async function syncCapLine($: EngineInterface, used: number, maxChecks: number, isReload = false) {
  const isSpent = used >= maxChecks
  let wasUp = false
  await update($, capNoticed, was => ((wasUp = was), isSpent))
  if (isSpent && (!wasUp || isReload)) $.ui.status(capLine(maxChecks))
  if (!isSpent && wasUp) $.ui.status(undefined)
}

// Counts a check against the cap; false once every check is spent.
async function spendCheck($: EngineInterface, maxChecks: number) {
  let isAllowed = false
  const used = await update($, checks, count => ((isAllowed = count < maxChecks), isAllowed ? count + 1 : count))
  await syncCapLine($, used, maxChecks)

  return isAllowed
}

// A /clear starts a new conversation: its notes, band and spend start fresh.
async function clearSession($: EngineInterface, maxChecks: number) {
  await update($, notes, () => [])
  await update($, shown, () => null)
  await update($, checks, () => 0)
  await update($, warned, () => false)
  await syncCapLine($, 0, maxChecks)
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

// The model call. Runs from a timer so the turn ends without waiting on it.
async function check($: EngineInterface, turnId: string, request: Request, topics: readonly FinePrintTopic[]) {
  let reply: ModelCompleteResult
  try {
    reply = await $.model.complete({ model: MODEL, ...request, maxTokens: MAX_TOKENS, effort: 'low', timeoutMs: 30_000 })
  } catch (error) {
    debug($, `model request refused: ${errorText(error)}`)
    await warnOnce($, 'the model request was refused')
    return
  }
  if (!reply.isAnswered) {
    debug($, `no answer (${reply.reason})`)
    if (reply.reason === 'api-error') await warnOnce($, `model error: ${reply.error}`)
    return
  }

  if (reply.usage.output_tokens >= MAX_TOKENS) debug($, 'the answer hit the token cap')
  const verdict = parseVerdict(reply.text, topics)
  if (verdict.kind === 'malformed') debug($, `ignored a malformed answer (${verdict.why})`)
  if (verdict.kind !== 'note') return

  const { headline, bullets, topics: flagged } = verdict
  const note: FinePrintNote = { id: turnId, at: await $.clock.now(), headline, bullets, topics: flagged, status: 'open' }
  await update($, notes, list => [...list.filter(one => one.id !== turnId), note].slice(-MAX_NOTES))
  await update($, shown, () => turnId)

  // The band draws on the terminal and desktop only; anywhere else the note
  // arrives as a toast so it is never flagged unseen.
  const surfaces = await $.session.surfaces().catch(() => [])
  if (surfaces.length > 0 && !surfaces.some(surface => surface === 'terminal' || surface === 'desktop')) {
    $.ui.toast(`${headline} (/fineprint has the details)`)
  }
}

// Decides whether this turn is read at all; cheap tests first, the model last.
async function consider($: EngineInterface, e: TurnCompleteInput, settings: Settings) {
  if (e.agentId !== undefined || e.reason !== 'answer') return
  if (settings.topics.length === 0 || countWords(e.answer) <= MIN_WORDS) return
  // Nothing draws (a -p run): no one would see a note, so spend nothing.
  if ((await $.session.surfaces()).length === 0) return

  // Read now, while the transcript still ends with this turn.
  const messages = await $.session.messages()
  // The answer to our own Explain more is about the note already shown.
  if (isOwnQuestion(messages)) return
  if (!(await spendCheck($, settings.maxChecks))) return

  const toolLines = summarizeTools(turnToolUses(messages))
  const request = buildRequest(e.answer, toolLines, settings.topics)
  $.clock.after(0, () => {
    check($, e.turnId, request, settings.topics).catch(error => debug($, `check failed: ${errorText(error)}`))
  })
}

async function settle($: EngineInterface, id: string, status: FinePrintNoteStatus) {
  await update($, notes, list => withStatus(list, id, status))
  await update($, shown, current => (current === id ? null : current))
}

// Explain more: a prompt framed as this plugin's (never as the person's
// words), so the model and the transcript both say who wrote it.
async function explain($: EngineInterface, id: string) {
  // Claim the note in one write, so a second press before the redraw sends nothing.
  let note: FinePrintNote | undefined
  await update($, notes, list => {
    note = list.find(one => one.id === id && one.status === 'open')
    return note === undefined ? list : withStatus(list, id, 'explained')
  })
  if (note === undefined) return
  await update($, shown, current => (current === id ? null : current))

  let why: string | undefined
  try {
    const sent = await $.prompt.submit({ text: explainPrompt(note) })
    why = sent.drop
  } catch (error) {
    why = errorText(error)
  }
  if (why === undefined) return

  // Not sent: put the note back as it was, so its record stays true.
  await update($, notes, list => withStatus(list, id, 'open'))
  await update($, shown, () => id)
  // The reason is another hook's or the engine's words: make them drawable.
  $.ui.toast(drawable(`Could not send the question (${why}). The note is still open.`))
}

// Where no surface seats a pane: the list as transcript lines, which the
// person sees and the model does not. One line per note, so a long session's
// list is never cut at the 2,000 characters a terminal draws of one line.
async function logNotes($: EngineInterface, maxChecks: number) {
  const [list, used, now] = await Promise.all([read($, notes), read($, checks), $.clock.now()])
  for (const block of noteBlocks(list, now, used, maxChecks)) $.ui.log(block)
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    topics: parseWatchFor(options.watchFor),
    maxChecks: parseMaxChecks(options.maxChecksPerSession),
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'fineprint',
      description: 'List the notes Fine Print flagged this session, newest first',
      // It only reads notes, so it may open while Claude works.
      immediate: true,
    })
    // Also raised on a reload, possibly with a new cap: put the line right.
    await syncCapLine($, await read($, checks), settings.maxChecks, true)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      try {
        await clearSession($, settings.maxChecks)
      } catch (error) {
        debug($, `could not reset after /clear: ${errorText(error)}`)
      }
    }

    return next(e)
  })

  // The list opens in a pane, never as command text the model would read.
  on('command.run', { command: 'fineprint' }, async $ => {
    const opened = await $.ui.open({ id: 'fineprint', title: 'Fine Print', focus: true, closeOnEscape: true })
    if (!opened.isPlaced) await logNotes($, settings.maxChecks)

    return {}
  }).catch($ => {
    $.ui.toast('Could not open its notes.')

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: 'fineprint' }, async ($, e) => {
    const [list, used, now] = await Promise.all([read($, notes), read($, checks), $.clock.now()])
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {noteLines(list, now, used, settings.maxChecks).map(line =>
          line.kind === 'blank' ? (
            <Text> </Text>
          ) : (
            <Text bold={line.kind === 'head' || line.kind === 'title'} dimColor={line.kind === 'spend'} wrap="wrap">
              {line.text}
            </Text>
          ),
        )}
      </Box>
    )
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      await consider($, e, settings)
    } catch (error) {
      debug($, `skipped a turn: ${errorText(error)}`)
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const id = await read($, shown)
    if (id === null) return next(e)
    const list = await read($, notes)
    const note = list.find(one => one.id === id)
    if (note === undefined) return next(e)

    const others = list.filter(one => one.status === 'open' && one.id !== id).length
    const { Box, Button, Text } = $.ui.resolve(e)
    // Other mods' bands draw first, the note after them: never erased by it,
    // and when the band overflows it is the note's end that scrolls away,
    // never another mod's buttons.
    const below = await next(e)

    return (
      <Box key="fine-print" flexDirection="column">
        {below}
        <Box flexDirection="row">
          <Box flexShrink={0}>
            <Text bold color="warning">
              Fine print:{' '}
            </Text>
          </Box>
          <Text bold wrap="truncate-end">
            {note.headline}
          </Text>
        </Box>
        {note.bullets.map(bullet => (
          <Box flexDirection="row" paddingLeft={1}>
            <Box flexShrink={0}>
              <Text>- </Text>
            </Box>
            <Text wrap="wrap">{bullet}</Text>
          </Box>
        ))}
        {others > 0 && (
          <Text dimColor>
            {others === 1 ? '1 more open note' : `${others} more open notes`}: /fineprint lists them
          </Text>
        )}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="got-it" label="Got it" hotkey="g" variant="primary" onPress={() => settle($, id, 'acknowledged')} />
          {/* No letter key: a stray keystroke must never send a message or spend a turn. */}
          <Button key="explain" label="Explain more" onPress={() => explain($, id)} />
          <Button key="dismiss" label="Dismiss" hotkey="d" role="dismiss" onPress={() => settle($, id, 'dismissed')} />
        </Box>
      </Box>
    )
  })
}
