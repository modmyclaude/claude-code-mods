// Scrubbing whole values: tool results, tool inputs, conversation rows.
// Every function returns the same object when nothing changed, so a caller
// can tell "clean" from "rewritten" by identity, and builds fresh objects
// when something did.

import type { Entry, Vault } from './vault'
import { ScanError } from './vault'

/** What the model reads in place of a text cloakroom could not scan. */
export const WITHHELD = '[cloakroom: result withheld, redaction failed]'

const MAX_DEPTH = 64

export type Deep<T> = { value: T; changed: boolean; entries: Entry[] }

/** Media payloads: base64 bytes are not text, and rewriting them would corrupt the file. */
export function isMediaPayload(key: string, owner: Record<string, unknown>): boolean {
  if (key === 'base64') return true
  if (key !== 'data') return false
  const kind = typeof owner.type === 'string' ? owner.type : ''
  const mime = typeof owner.mimeType === 'string' ? owner.mimeType : typeof owner.media_type === 'string' ? owner.media_type : ''
  return /^(?:image|audio|document)$/.test(kind) || /^(?:image|audio|video)\/|pdf$/.test(mime)
}

/**
 * Every string inside `value` scrubbed, at any depth (to 64), keys kept.
 * Throws ScanError for a value nested too deep to walk: the caller withholds it.
 */
export function scrubDeep<T>(vault: Vault, value: T, source: string, depth = 0): Deep<T> {
  if (depth > MAX_DEPTH) throw new ScanError('a value nested too deep to scan')
  if (typeof value === 'string') {
    const s = vault.scrub(value, source)
    return { value: s.text as T, changed: s.changed, entries: s.entries }
  }
  if (Array.isArray(value)) {
    let changed = false
    const entries: Entry[] = []
    const items = value.map(item => {
      const r = scrubDeep(vault, item, source, depth + 1)
      if (r.changed) changed = true
      entries.push(...r.entries)
      return r.value
    })
    return { value: (changed ? items : value) as T, changed, entries }
  }
  if (value !== null && typeof value === 'object') {
    const owner = value as Record<string, unknown>
    let changed = false
    const entries: Entry[] = []
    const copy: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(owner)) {
      if (isMediaPayload(key, owner)) {
        copy[key] = item
        continue
      }
      const r = scrubDeep(vault, item, source, depth + 1)
      if (r.changed) changed = true
      entries.push(...r.entries)
      copy[key] = r.value
    }
    return { value: (changed ? copy : value) as T, changed, entries }
  }
  return { value, changed: false, entries: [] }
}

/** Every string inside `value` restored from tickets; unknown tickets collected. */
export function restoreDeep<T>(vault: Vault, value: T, depth = 0): { value: T; unknown: string[]; entries: Entry[]; changed: boolean } {
  if (depth > MAX_DEPTH) throw new ScanError('a value nested too deep to restore')
  if (typeof value === 'string') {
    const r = vault.restore(value)
    return { value: r.text as T, unknown: r.unknown, entries: r.entries, changed: r.text !== value }
  }
  if (Array.isArray(value)) {
    const unknown: string[] = []
    const entries: Entry[] = []
    let changed = false
    const items = value.map(item => {
      const r = restoreDeep(vault, item, depth + 1)
      unknown.push(...r.unknown)
      entries.push(...r.entries)
      if (r.changed) changed = true
      return r.value
    })
    return { value: (changed ? items : value) as T, unknown, entries, changed }
  }
  if (value !== null && typeof value === 'object') {
    const unknown: string[] = []
    const entries: Entry[] = []
    let changed = false
    const copy: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const r = restoreDeep(vault, item, depth + 1)
      unknown.push(...r.unknown)
      entries.push(...r.entries)
      if (r.changed) changed = true
      copy[key] = r.value
    }
    return { value: (changed ? copy : value) as T, unknown, entries, changed }
  }
  return { value, unknown: [], entries: [], changed: false }
}

type Block = { type: string; [field: string]: unknown }

/**
 * A conversation row's blocks scrubbed: text blocks and tool_result content
 * (a string or its own text blocks). Thinking, tool_use and media blocks are
 * left: the engine puts those back as they were whatever a hook answers.
 */
export function scrubBlocks(vault: Vault, blocks: readonly Block[], source: string): Deep<Block[]> {
  let changed = false
  const entries: Entry[] = []
  const out = blocks.map(block => {
    if (block.type === 'text' && typeof block.text === 'string') {
      const s = vault.scrub(block.text, source)
      if (!s.changed) return block
      changed = true
      entries.push(...s.entries)
      return { ...block, text: s.text }
    }
    if (block.type === 'tool_result') {
      const r = scrubDeep(vault, block.content, source)
      if (!r.changed) return block
      changed = true
      entries.push(...r.entries)
      return { ...block, content: r.value }
    }
    return block
  })
  return { value: changed ? out : (blocks as Block[]), changed, entries }
}

/** The blocks with every text the model could read replaced by WITHHELD (the fail-closed answer). */
export function withheldBlocks(blocks: readonly Block[]): Block[] {
  return blocks.map(block => {
    if (block.type === 'text') return { ...block, text: WITHHELD }
    if (block.type === 'tool_result') return { ...block, content: WITHHELD }
    return block
  })
}

/** `NAME#id, OTHER#id` for messages: labels only, never values. */
export function labels(entries: readonly Entry[]): string {
  return [...new Set(entries.map(e => e.label))].join(', ')
}
