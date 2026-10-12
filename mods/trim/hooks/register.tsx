// trim: long shell output, folded before Claude reads it. A Bash result past the
// line or character limit keeps its head, its tail and every error-like line;
// the rest folds, and one footer line tells Claude what was folded and how to
// read a part again. stderr, failed commands and short output are never touched.
//
// The model reads what a tool.call hook answers: a fresh `{ result }` is mapped
// with Bash's own mapper (never the object next(e) gave, whose messages core
// would reuse). The person can still see everything: the row under the call
// says what was saved and expands, and /trim lists the calls and shows each in
// full, in panes Claude never reads. Full outputs live in this module's memory.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TrimCall, TrimLog } from '../types'
import { aboutTokens, clean, grouped, oneLine, readSettings, rowLine, shortTokens, statusLine, trimOutput } from './logic'
import type { Settings } from './logic'

const LOG = { plugin: 'trim', key: 'log' } as const
const OFF = { plugin: 'trim', key: 'isOff' } as const
const SHOWN = { plugin: 'trim', key: 'shown' } as const

const EMPTY: TrimLog = { calls: [], count: 0, saved: 0 }
const log = atom(LOG, EMPTY)
const isOff = atom(OFF, false)
const shown = atom(SHOWN, 0)

const LIST_PANE = 'trim'
const OUTPUT_PANE = 'trim-output'
/** Full outputs kept for showing: the last 20 calls, two million characters in all. */
export const KEEP_CALLS = 20
export const KEEP_CHARS = 2_000_000
/** The most of one output the pane draws at once. */
const SHOW_CHARS = 90_000
/** Origins that are the person: typed, the phone bridge, the desktop app's box. */
const PERSON = new Set(['composer', 'bridge', 'sdk'])
const USAGE = '/trim lists the folded calls; /trim show <n> shows one in full; /trim off pauses it; /trim on resumes it.'

/** Bash's result record, the fields trim reads or must leave alone. */
type BashRecord = {
  stdout: string
  stderr: string
  interrupted: boolean
  isImage?: boolean
  backgroundTaskId?: string
  persistedOutputPath?: string
  structuredContent?: unknown[]
}

// What lives only as long as this copy of the module: the settings, the full
// outputs (by tool call id, oldest first) and the rows the person expanded.
let settings: Settings = readSettings({})
const fulls = new Map<string, string>()
const expanded = new Set<string>()

/** Keeps one full output, dropping the oldest past the call or size cap. */
export function remember(store: Map<string, string>, id: string, full: string): void {
  store.delete(id)
  store.set(id, full)
  let chars = 0
  for (const text of store.values()) chars += text.length
  while (store.size > KEEP_CALLS || chars > KEEP_CHARS) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    chars -= store.get(oldest)?.length ?? 0
    store.delete(oldest)
  }
}

function debug($: EngineInterface, error: unknown): void {
  $.ui.log(`trim: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
}

function redraw($: EngineInterface): void {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // nothing drawing
  }
}

/**
 * A result trim may fold: a Bash record of plain text output, not an image, a background job or one
 * core already saved to a file. A failed call's result is its error text, never a record: it passes.
 */
function foldable(result: unknown): BashRecord | null {
  const out = result as Partial<BashRecord> | null | undefined
  if (out === null || typeof out !== 'object' || typeof out.stdout !== 'string') return null
  if (out.isImage || out.backgroundTaskId || out.persistedOutputPath || out.structuredContent) return null
  return out as BashRecord
}

async function openPane($: EngineInterface, id: string, title: string): Promise<boolean> {
  try {
    return (await $.ui.open({ id, title, focus: true, closeOnEscape: true })).isPlaced
  } catch {
    return false
  }
}

function summary(l: TrimLog): string {
  if (l.count === 0) return 'trim: nothing folded yet this session.'
  return `trim: ${grouped(l.count)} call${l.count === 1 ? '' : 's'} folded, ${aboutTokens(l.saved)} tokens saved this session.`
}

/** /trim and its words; every answer is a toast or a pane, never text Claude reads. */
async function command($: EngineInterface, args: string, origin: string): Promise<void> {
  const [verb = '', arg = ''] = args.trim().split(/\s+/)
  const action = verb.toLowerCase()
  if ((action === 'off' || action === 'on') && !PERSON.has(origin)) {
    return $.ui.toast(`trim: /trim ${action} runs only when you type it yourself.`)
  }
  if (action === 'off' || action === 'on') {
    await update($, isOff, () => action === 'off')
    return $.ui.toast(action === 'off' ? 'trim is paused for this session. /trim on resumes it.' : 'trim is on again.')
  }
  const l = await read($, log)
  if (action === '' || action === 'list') {
    if (!(await openPane($, LIST_PANE, 'trim'))) $.ui.toast(summary(l))
    return
  }
  if (action === 'show') {
    const n = Number(arg)
    const call = l.calls.find(c => c.n === n)
    if (!call || !fulls.has(call.id)) {
      return $.ui.toast(`trim: no full output for call ${oneLine(clean(arg), 12) || '(none given)'}. /trim lists the last ${KEEP_CALLS}.`)
    }
    await update($, shown, () => n)
    if (!(await openPane($, OUTPUT_PANE, `trim: call ${n}`))) $.ui.toast('trim: the full output draws in a pane, which only the terminal and the desktop app have.')
    redraw($)
    return
  }
  $.ui.toast(`trim: unknown command "${oneLine(clean(verb), 24)}". ${USAGE}`)
}

export const register: Register = (on, options) => {
  settings = readSettings(options)

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'trim',
        description: 'List the shell outputs trim folded, show one in full, or pause it',
        argumentHint: '[show <n> | off | on]',
        immediate: true,
      })
      const l = await read($, log)
      if (l.saved > 0) $.ui.status(statusLine(l.saved))
    } catch (error) {
      debug($, error)
    }
    return next(e)
  })

  // The fold itself. The tool has run once its answer is in hand, so nothing here may run it
  // again: any failure answers with what the tool gave, untouched.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== 'Bash' || ran.deny !== undefined) return ran
    try {
      if (await read($, isOff)) return ran
      const out = foldable(ran.result)
      if (out === null) return ran
      const trimmed = trimOutput(out.stdout, settings)
      if (trimmed === null) return ran
      const id = e.tool_use_id ?? ''
      if (id !== '') remember(fulls, id, out.stdout)
      const l = await update($, log, prev => {
        const call: TrimCall = {
          n: prev.count + 1,
          id,
          command: oneLine(clean(e.command), 80),
          linesIn: trimmed.linesIn,
          folded: trimmed.folded,
          saved: trimmed.saved,
        }
        return { calls: [...prev.calls, call].slice(-KEEP_CALLS), count: prev.count + 1, saved: prev.saved + trimmed.saved }
      })
      $.ui.status(statusLine(l.saved))
      return { result: { ...out, stdout: trimmed.text }, ...(ran.context ? { context: ran.context } : {}) }
    } catch (error) {
      debug($, error)
      return ran
    }
  })

  // Under a folded call's row: what was saved, and expand (the drawing only; Claude's read stays folded).
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.tool !== 'Bash' || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    const id = e.props.tool_use_id
    const call = (await read($, log)).calls.find(c => c.id === id)
    if (call === undefined) return next(e)
    const full = fulls.get(id)
    const isOpen = full !== undefined && expanded.has(id)
    const output = e.props.output as BashRecord | undefined
    const row = await next(isOpen && output ? { ...e, props: { ...e.props, output: { ...output, stdout: full } } } : e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {row}
        <Box key="trim" flexDirection="row" gap={1}>
          <Text key="saved" dimColor>
            {rowLine(call)}
          </Text>
          {full === undefined ? null : (
            <Button
              key="expand"
              label={isOpen ? 'fold' : 'expand'}
              onPress={() => {
                if (expanded.has(id)) expanded.delete(id)
                else expanded.add(id)
                redraw($)
              }}
            />
          )}
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // /trim: one row per folded call, with Show for each one still kept in full.
  on('ui.render', { component: 'Pane', requestId: LIST_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const l = await read($, log)
    const paused = await read($, isOff)
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text key="total" bold>
          {l.count === 0 ? 'Nothing folded yet this session' : `${grouped(l.count)} call${l.count === 1 ? '' : 's'} folded · ${aboutTokens(l.saved)} tokens saved`}
        </Text>
        {paused ? (
          <Text key="paused" color="warning">
            Paused for this session. /trim on resumes it.
          </Text>
        ) : null}
        {[...l.calls].reverse().map(call => (
          <Box key={`call-${call.n}`} flexDirection="row" gap={1}>
            <Box key="n" width={4} flexShrink={0}>
              <Text dimColor>{`#${call.n}`}</Text>
            </Box>
            <Box key="command" flexGrow={1} flexShrink={1} minWidth={8}>
              <Text wrap="truncate-end">{call.command}</Text>
            </Box>
            <Box key="lines" flexShrink={0}>
              <Text dimColor>{`${grouped(call.linesIn)} lines, ${grouped(call.folded)} folded · ${shortTokens(call.saved)}`}</Text>
            </Box>
            {fulls.has(call.id) ? (
              <Button
                key="show"
                label="Show"
                onPress={async () => {
                  await update($, shown, () => call.n)
                  await openPane($, OUTPUT_PANE, `trim: call ${call.n}`)
                  redraw($)
                }}
              />
            ) : null}
          </Box>
        ))}
        <Text key="note" dimColor>
          Token figures are estimates (about four characters each). Full outputs are kept in memory for the last {KEEP_CALLS} calls only.
        </Text>
      </Box>
    )
  })

  // /trim show <n>: one call's full output, on the person's screen only.
  on('ui.render', { component: 'Pane', requestId: OUTPUT_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const n = await read($, shown)
    const call = (await read($, log)).calls.find(c => c.n === n)
    const full = call ? fulls.get(call.id) : undefined
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text key="command" bold>
          {call ? `#${call.n} ${call.command}` : 'No call to show'}
        </Text>
        <Text key="output">{full === undefined ? 'This output is no longer kept: only the last 20 calls are.' : clean(full.slice(0, SHOW_CHARS))}</Text>
        {full !== undefined && full.length > SHOW_CHARS ? (
          <Text key="more" dimColor>
            {`Showing the first ${grouped(SHOW_CHARS)} of ${grouped(full.length)} characters.`}
          </Text>
        ) : null}
      </Box>
    )
  })

  on('command.run', { command: 'trim' }, async ($, e) => {
    try {
      await command($, e.args, e.origin.kind)
    } catch (error) {
      debug($, error)
      $.ui.toast('trim: that command failed, and nothing changed.')
    }
    return {}
  })
}
