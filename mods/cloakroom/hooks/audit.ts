// /cloakroom audit: which secrets were already written into past transcripts.
//
// Read-only. Values found here are never learned into the vault and never
// printed: a finding shows its kind, the format's public prefix and at most
// its last three characters (only for values of 16 characters or more).

import { detect } from './detect'
import { isMediaPayload } from './scrub'
import type { Vault } from './vault'

export type Finding = {
  kind: string
  name: string
  preview: string
  first: string
  last: string
  files: Set<string>
}

export type AuditState = {
  /** Transcripts already read this session (a later run goes on from here). */
  done: Set<string>
  /** Keyed by the raw value, in memory only, so one secret is one line. */
  findings: Map<string, Finding>
  tooBig: number
  unreadable: number
}

export function newAudit(): AuditState {
  return { done: new Set(), findings: new Map(), tooBig: 0, unreadable: 0 }
}

/** The format's public prefix of a value (`sk_live_`), when a detector knows it. */
function prefixOf(value: string): string | undefined {
  return detect(value).find(hit => hit.start === 0 && hit.end === value.length)?.prefix
}

/** A preview that identifies a secret to its owner without giving it away. */
export function mask(value: string, prefix = prefixOf(value)): string {
  const lines = value.split('\n').length
  if (value.startsWith('-----BEGIN')) {
    const head = value.slice(0, value.indexOf('-----', 11) + 5)
    return `${head} (${lines} lines)`
  }
  const trimmed = value.trimEnd()
  const tail = trimmed.length >= 16 ? trimmed.slice(-3) : ''
  if (prefix && value.startsWith(prefix) && value.length - prefix.length >= 8) {
    return tail ? `${prefix}...${tail}` : `${prefix}...`
  }
  return tail ? `...${tail} (${trimmed.length} chars)` : `(${trimmed.length} chars)`
}

function record(state: AuditState, value: string, kind: string, name: string, file: string, date: string, prefix?: string): void {
  const known = state.findings.get(value)
  if (known) {
    known.files.add(file)
    if (date < known.first) known.first = date
    if (date > known.last) known.last = date
    return
  }
  state.findings.set(value, { kind, name, preview: mask(value, prefix), first: date, last: date, files: new Set([file]) })
}

function walkStrings(value: unknown, visit: (s: string) => void, depth = 0): void {
  if (depth > 64) return
  if (typeof value === 'string') {
    visit(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, visit, depth + 1)
    return
  }
  if (value !== null && typeof value === 'object') {
    const owner = value as Record<string, unknown>
    for (const [key, item] of Object.entries(owner)) {
      if (!isMediaPayload(key, owner)) walkStrings(item, visit, depth + 1)
    }
  }
}

/** Adds the secrets in one transcript (JSON lines) to the findings. */
export function auditTranscript(state: AuditState, vault: Vault, text: string, file: string, fileDate: string): void {
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      row = line // a torn last line: scan it as text
    }
    const stamp = (row as { timestamp?: unknown } | null)?.timestamp
    const date = typeof stamp === 'string' && /^\d{4}-\d{2}-\d{2}/.test(stamp) ? stamp.slice(0, 10) : fileDate
    walkStrings(row, s => {
      if (s.length < 8) return
      for (const found of vault.scanKnown(s)) {
        const e = found.entry
        record(state, e.value, e.kind, e.label.split('#')[0]!, file, date, e.prefix)
      }
      for (const hit of detect(s)) {
        const value = s.slice(hit.start, hit.end)
        if (!vault.isIgnored(value)) record(state, value, hit.kind, hit.name, file, date, hit.prefix)
      }
    })
  }
}

/** The findings as lines, most recently exposed first. */
export function findingLines(state: AuditState, limit = 50): string[] {
  const all = [...state.findings.values()].sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0))
  const lines = all.slice(0, limit).map(f => {
    const when = f.first === f.last ? f.first : `${f.first} to ${f.last}`
    const where = f.files.size === 1 ? '1 transcript' : `${f.files.size} transcripts`
    return `- ${f.kind}: ${f.preview} (${f.name}) - ${where}, ${when}`
  })
  if (all.length > limit) lines.push(`- ...and ${all.length - limit} more`)
  return lines
}
