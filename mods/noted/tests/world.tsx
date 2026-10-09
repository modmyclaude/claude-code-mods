// The world beneath noted in a test: a project and a home folder in memory,
// a scripted model, a transcript, a store, a clock and an env. Every noun the
// plugin calls is answered here, so nothing reaches a real disk or model.

import { mock } from 'claude-code/testing'
import type { ModelCompleteInput, ModelUsage, On, RenderSurface, SessionMessage } from 'claude-code'

export const ROOT = '/work/app'
export const PROJECT = `${ROOT}/CLAUDE.md`
export const GLOBAL = '/home/me/.claude/CLAUDE.md'
/** 2026-10-08 at noon UTC: the same calendar day in every time zone the tests run in. */
export const NOW = Date.UTC(2026, 9, 8, 12)

export const SURFACES = ['terminal', 'desktop'] as const

/** What a band above the prompt is handed by a surface. */
export const BAND = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 14,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 13 },
  view: {},
}

export const PROMPT_FROM_PERSON = { wait: false, origin: { kind: 'composer' } } as const

export const PRESENTATION = { isFullscreen: true, columns: 120 }

const ZERO: ModelUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

/** A model reply in the shape noted asks for. */
export function verdict(rule: string | null, extra: { duplicateOf?: number; conflictsWith?: number } = {}): string {
  return JSON.stringify({ rule, duplicateOf: extra.duplicateOf ?? null, conflictsWith: extra.conflictsWith ?? null })
}

type Options = {
  files?: Record<string, string>
  /** The model's text, or a function of the request; `null` makes it fail. */
  reply?: string | null | ((e: ModelCompleteInput) => string)
  messages?: SessionMessage[]
  surfaces?: RenderSurface[]
  /** Paths that exist but cannot be read. */
  unreadable?: string[]
}

export function world(on: On, options: Options = {}) {
  const files: Record<string, string> = { ...options.files }
  const calls: ModelCompleteInput[] = []
  const writes: string[] = []
  const logs: string[] = []
  const unreadable = new Set(options.unreadable ?? [])
  const messages: SessionMessage[] = options.messages ?? [
    { role: 'user', text: 'install the deps', toolUses: [] },
    { role: 'assistant', text: 'I ran npm install and added lodash.', toolUses: [] },
    { role: 'user', text: 'no, use pnpm', toolUses: [] },
  ]

  mock.store(on)
  mock.env(on, { HOME: '/home/me' })
  mock.clock(on, { now: NOW })

  on('session.root', () => ({ value: ROOT }))
  on('session.surfaces', () => ({ value: options.surfaces ?? ['terminal'] }))
  on('session.messages', () => ({ value: messages }))

  on('fs.exists', ($, e) => ({ value: e.path in files || unreadable.has(e.path) }))
  on('fs.read', ($, e) => {
    const text = files[e.path]
    if (unreadable.has(e.path) || text === undefined) return { deny: `EACCES: cannot read ${e.path}` }
    return { value: text }
  })
  on('fs.write', ($, e) => {
    files[e.path] = e.text
    writes.push(e.path)
    return { value: undefined }
  })

  on('model.complete', ($, e) => {
    calls.push(e)
    const reply = options.reply === undefined ? verdict(null) : options.reply
    if (reply === null) {
      return { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: ZERO } }
    }
    let text: string
    try {
      text = typeof reply === 'function' ? reply(e) : reply
    } catch (err) {
      return { deny: String(err) } // the call itself fails
    }
    return { value: { isAnswered: true, text, usage: ZERO } }
  })

  // The engine's own end of each chain the plugin passes on.
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key="engine">
        <Text>the engine's own band</Text>
      </Box>
    )
  })

  return { files, calls, writes, logs, messages }
}
