// Bouncer's pure parts: reading a validator report into what a mod can reach,
// a hash of that reach, the plugin registry files, and the words the band and
// the pane say. Nothing here touches the engine.

import type { BouncerReach, BouncerRow } from '../types'

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g

/** Text made safe to draw: no escape sequences or control characters, one line, cut to `max`. */
export function clean(text: string, max = 200): string {
  const flat = text.replace(ANSI, '').replace(CONTROL, '�').replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  return chars.length <= max ? flat : `${chars.slice(0, max - 1).join('')}…`
}

/** Splits a validator list on ", " outside braces: a matcher such as `tool.call{tool=Bash, agentId=x}` keeps its commas. */
export function splitTop(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < list.length; i++) {
    const ch = list[i]!
    if (ch === '{') depth++
    if (ch === '}') depth = Math.max(0, depth - 1)
    if (depth === 0 && ch === ',' && list[i + 1] === ' ') {
      out.push(cur.trim())
      cur = ''
      i++
      continue
    }
    cur += ch
  }
  if (cur.trim() !== '') out.push(cur.trim())
  return out
}

type Content = { notes?: unknown; gatingHooks?: unknown }

/**
 * A validator report (`claude plugin validate --json`) read into what the mod
 * can reach; null when the text is not such a report.
 */
export function parseReport(text: string): { success: boolean; reach: BouncerReach } | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof json !== 'object' || json === null) return null
  const report = json as { success?: unknown; contents?: unknown }
  if (typeof report.success !== 'boolean' || !Array.isArray(report.contents)) return null
  const notes: string[] = []
  const gates: string[] = []
  for (const content of report.contents as Content[]) {
    if (Array.isArray(content.notes)) for (const n of content.notes) if (typeof n === 'string') notes.push(n)
    if (Array.isArray(content.gatingHooks)) {
      for (const g of content.gatingHooks) {
        const hook = (g as { hook?: unknown } | null)?.hook
        if (typeof hook === 'string') gates.push(hook)
      }
    }
  }
  const calls = [
    ...new Set(
      notes
        .filter(n => / calls: /.test(n))
        .flatMap(n => splitTop(n.split(' calls: ')[1] ?? ''))
        .map(c => c.replace(/\s*\(via .*\)$/, '').trim())
        .filter(c => c.startsWith('$.')),
    ),
  ].sort()
  const hooks = [...new Set(notes.filter(n => / hooks: /.test(n)).flatMap(n => splitTop(n.split(' hooks: ')[1] ?? '')))].sort()
  const has = (re: RegExp) => calls.some(c => re.test(c))
  const hooksOn = (event: string) => hooks.some(h => h === event || h.startsWith(`${event}{`)) || gates.some(g => g === event || g.startsWith(`${event}{`))
  const reach: BouncerReach = {
    files: has(/^\$\.fs\.write/) ? 'read-write' : has(/^\$\.fs\.(read|list|stat|exists|ancestors)/) ? 'read' : 'none',
    processes: has(/^\$\.process\.(run|spawn)/),
    network: has(/^\$\.http\./),
    model: has(/^\$\.model\./),
    sound: has(/^\$\.audio\./),
    env: has(/^\$\.env\./),
    settings: has(/^\$\.settings\./),
    typesForYou: has(/^\$\.prompt\.(submit|fill)/),
    changesToolCalls: hooksOn('tool.call'),
    holdsPrompts: hooksOn('prompt.submit'),
    changesPrompt: hooksOn('prompt.compose') || hooksOn('prompt.section') || hooksOn('prompt.context'),
    hooks,
    calls,
    notes: notes.map(n => clean(n, 400)),
  }
  return { success: report.success, reach }
}

/** A short, stable hash of what a mod can reach (its calls and hooks): the band fires when it changes. */
export function hashOf(reach: Pick<BouncerReach, 'calls' | 'hooks'>): string {
  const text = `${reach.calls.join(',')}|${reach.hooks.join(',')}`
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** The reach in words for a row; `warn` marks the ones worth a second look. */
export function reachWords(reach: BouncerReach): { word: string; warn: boolean }[] {
  const out: { word: string; warn: boolean }[] = []
  if (reach.files === 'read') out.push({ word: 'reads files', warn: false })
  if (reach.files === 'read-write') out.push({ word: 'reads and writes files', warn: false })
  if (reach.processes) out.push({ word: 'runs programs', warn: true })
  if (reach.network) out.push({ word: 'reaches the network', warn: true })
  if (reach.model) out.push({ word: 'calls the model', warn: false })
  if (reach.typesForYou) out.push({ word: 'can type for you', warn: true })
  if (reach.changesToolCalls) out.push({ word: 'can change tool calls', warn: true })
  if (reach.holdsPrompts) out.push({ word: 'can hold your prompts', warn: false })
  if (reach.changesPrompt) out.push({ word: 'changes the system prompt', warn: false })
  if (reach.sound) out.push({ word: 'plays sound', warn: false })
  if (reach.env) out.push({ word: 'reads environment variables', warn: false })
  if (reach.settings) out.push({ word: 'reads settings', warn: false })
  if (out.length === 0) out.push({ word: 'nothing declared', warn: false })
  return out
}

const notable = (reach: BouncerReach): string => {
  const words = reachWords(reach)
    .filter(w => w.warn)
    .map(w => w.word)
  return words.length === 0 ? 'nothing notable' : words.join(', ')
}

/** The band's one line while a mod is new or changed, else null. */
export function bandWords(rows: readonly BouncerRow[]): string | null {
  const fresh = rows.filter((r): r is Extract<BouncerRow, { ok: true }> => r.ok && r.isNew)
  const changed = rows.filter((r): r is Extract<BouncerRow, { ok: true }> => r.ok && r.isChanged)
  if (fresh.length === 0 && changed.length === 0) return null
  const parts: string[] = []
  if (fresh.length > 0) {
    parts.push(`${fresh.length} new mod${fresh.length === 1 ? '' : 's'}: ${fresh.map(r => `${r.name} (${notable(r.reach)})`).join('; ')}`)
  }
  if (changed.length > 0) {
    parts.push(`${changed.length} changed: ${changed.map(r => `${r.name} (${notable(r.reach)})`).join('; ')}`)
  }
  return `bouncer: ${parts.join(' · ')}`
}

/** The install paths in `installed_plugins.json` (version 2): every scope, every plugin. */
export function installedRoots(json: unknown): string[] {
  if (typeof json !== 'object' || json === null) return []
  const plugins = (json as { plugins?: unknown }).plugins
  if (typeof plugins !== 'object' || plugins === null) return []
  const roots: string[] = []
  for (const entries of Object.values(plugins as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      const path = (entry as { installPath?: unknown } | null)?.installPath
      if (typeof path === 'string' && path.startsWith('/')) roots.push(path)
    }
  }
  return roots
}

/** The directory marketplaces in `known_marketplaces.json`: their install locations, where a marketplace.json names its plugins. */
export function directoryMarketplaces(json: unknown): string[] {
  if (typeof json !== 'object' || json === null) return []
  const out: string[] = []
  for (const entry of Object.values(json as Record<string, unknown>)) {
    const m = entry as { source?: { source?: unknown }; installLocation?: unknown } | null
    if (m?.source?.source === 'directory' && typeof m.installLocation === 'string' && m.installLocation.startsWith('/')) out.push(m.installLocation.replace(/\/+$/, ''))
  }
  return out
}

/** The plugin folders a marketplace.json names by a relative `source`, under `base`. */
export function marketplaceRoots(json: unknown, base: string): string[] {
  if (typeof json !== 'object' || json === null) return []
  const plugins = (json as { plugins?: unknown }).plugins
  if (!Array.isArray(plugins)) return []
  const out: string[] = []
  for (const p of plugins) {
    const source = (p as { source?: unknown } | null)?.source
    if (typeof source === 'string' && source.startsWith('./') && !source.includes('..')) out.push(`${base}/${source.slice(2).replace(/\/+$/, '')}`)
  }
  return out
}

/** A plugin.json's name and version, when the text is one. */
export function manifestOf(text: string): { name?: string; version?: string } {
  try {
    const m = JSON.parse(text) as { name?: unknown; version?: unknown }
    return {
      ...(typeof m.name === 'string' ? { name: clean(m.name, 60) } : {}),
      ...(typeof m.version === 'string' ? { version: clean(m.version, 20) } : {}),
    }
  } catch {
    return {}
  }
}

/** The seen record as the store holds it: mod name to reach hash, anything else dropped. */
export function seenOf(stored: unknown): Record<string, string> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}
  const out: Record<string, string> = {}
  for (const [name, hash] of Object.entries(stored as Record<string, unknown>)) if (typeof hash === 'string' && /^[0-9a-f]{8}$/.test(hash)) out[name] = hash
  return out
}

/** The pane as plain lines, for a surface that places no pane. */
export function doorText(rows: readonly BouncerRow[]): string {
  const lines = [`Bouncer: ${rows.length} mod${rows.length === 1 ? '' : 's'} checked. Facts from the validator, not a verdict.`]
  for (const r of rows) {
    lines.push(r.ok ? `  ${r.name}${r.version ? ` ${r.version}` : ''}: ${reachWords(r.reach).map(w => w.word).join(', ')}${r.isNew ? ' (new)' : r.isChanged ? ' (changed)' : ''}` : `  ${r.name}: could not check (${r.reason})`)
  }
  return lines.join('\n')
}
