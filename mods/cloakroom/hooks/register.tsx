// cloakroom: check your secrets at the door. Claude gets a ticket; the real
// value only comes back where you allow it.
//
// The doors (each one scrubs before the text is stored or sent):
//   tool.call          tool results, every tool; tickets restored in the inputs
//                      of Write, Edit, NotebookEdit and Bash only; Bash held
//                      when it would carry a value off the machine
//   prompt.submit      what you type or paste
//   prompt.attachment  reminders, hook output, nested CLAUDE.md, mentioned files
//   prompt.context     CLAUDE.md and the first message's context blocks
//   prompt.compose     the system prompt's sections, plus one line on tickets
//   skill.prompt       skill text
//   session.append     every row the conversation keeps (the transcript)
//   session.send       messages to other agents and sessions
//   session.receive    deliveries from them
//   telemetry.log      records bound for an OpenTelemetry collector
// Every gating hook fails closed: when the scrub throws or overruns, the text
// is withheld or the call refused, never passed on unscanned.

import type { EngineInterface, FsEntry, PromptComposeSection, Register, Timer, ToolCallResult } from 'claude-code'

import { auditTranscript, findingLines, newAudit, type AuditState } from './audit'
import { clean } from './clean'
import { isEnvFileName, isSecretName, isWorthHiding, parseDotenv, SKIP_DIRS } from './dotenv'
import { classifyEgress, leaksValue, localProof } from './egress'
import { labels, restoreDeep, scrubBlocks, scrubDeep, WITHHELD, withheldBlocks } from './scrub'
import { Vault, type Entry } from './vault'

type Dollar = EngineInterface

/** Tools that run on this machine, where a ticket becomes the real value again. */
const RESTORE = new Set(['Write', 'Edit', 'NotebookEdit', 'Bash'])
/** Local lookups whose inputs are paths and patterns: left as written. */
const LOCAL_READS = new Set(['Read', 'Glob', 'Grep', 'LSP', 'ToolSearch'])

// The switch (`enabled`, which /config and the modmyclaude hub flip): off, cloakroom hides
// nothing, restores nothing, holds nothing and reads no file; every door passes what the
// engine sends as it is. The engine reloads the mod with the new value; the config.set hook
// below is the same switch at once.
let isOn = true
const OFF_TEXT = 'Cloakroom is off. /mods or /config turns it on.'

const PERMIT_MS = 10 * 60_000
const REVEAL_MS = 30_000
const AUDIT_MS = 6_000
const AUDIT_BYTES = 96 * 1024 * 1024
const FS_READ_MAX = 4 * 1024 * 1024
const MAX_HOLDS = 5
const AUDIT_PANE = 'cloakroom-audit'

const LINE: PromptComposeSection = {
  id: 'cloakroom:tickets',
  scope: 'session',
  text:
    'Secrets in this session are hidden as [secret:NAME#id] tickets, which turn back into the real value only inside Write, Edit, NotebookEdit and Bash; prefer environment variables such as $STRIPE_SECRET_KEY in commands over literal values.',
}

const USAGE =
  '/cloakroom lists tickets; /cloakroom show <ticket> shows a value to you alone; ' +
  '/cloakroom forget <ticket> stops hiding it; /cloakroom audit checks past transcripts.'

/** Where a conversation row came in, as /cloakroom names a ticket's source. */
const SOURCES: Record<string, string> = {
  prompt: 'your prompt',
  command: 'a command',
  response: "Claude's reply",
  'tool-result': 'tool output',
  'tool-message': 'tool output',
  delivery: 'a delivery',
  attachment: 'an attachment',
  'hook-context': 'hook output',
  note: 'a plugin note',
  compaction: 'a compaction summary',
  notice: 'a notice',
}

/** Runs typed by the person: the terminal, Remote Control, and the desktop app (which arrives as sdk). */
const PERSON_ORIGINS = new Set(['composer', 'bridge', 'sdk'])
/** Subcommands that reveal, read transcripts, or lower the protection. */
const PERSON_ONLY = new Set(['show', 'audit', 'forget'])

/** A held Bash command: what it carries and, as a clause after the labels, why it waits. */
type Hold = { command: string; labels: string; count: number; reason: string }

/** What one load of the mod holds, in its own memory only (never $.state or $.store). */
type Room = {
  vault: Vault
  /** Bash commands waiting on the person, oldest first. */
  holds: Hold[]
  /** Commands the person allowed once, by the text Claude sent, until when. */
  permits: Map<string, number>
  reveal: Entry | undefined
  revealTimer: Timer | undefined
  audit: AuditState
  /** The last audit's lines, drawn in its pane only: command text is a transcript row Claude reads. */
  auditView: string[] | undefined
  /** The project whose .env files are still to be read: the session started with cloakroom off. */
  unseeded: string | undefined
}

const trimEnd = (path: string) => path.replace(/[\\/]+$/, '')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`


/** Prompt parts the engine caches are asked again once the vault learns a value. */
function rescanCached($: Dollar, room: Room): void {
  if (!room.vault.takeGrown()) return
  try {
    $.ui.invalidate('prompt.attachment')
    $.ui.invalidate('prompt.context')
  } catch {
    // a re-entered call cannot reach $: the next growth asks again
  }
}

/** Switched on: prompt parts the engine cached while cloakroom was off are asked again, to be checked. */
function rescanAll($: Dollar): void {
  try {
    $.ui.invalidate('prompt.attachment')
    $.ui.invalidate('prompt.context')
  } catch {
    // nothing cached
  }
}

function redraw($: Dollar): void {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // nothing drawing
  }
}

// ------------------------------------------------------- session start

async function listDir($: Dollar, dir: string): Promise<FsEntry[]> {
  return $.fs.list(dir).catch(() => [])
}

/** How far below the project root .env files are looked for (`apps/web/.env`), and in how many folders. */
const SEED_DEPTH = 2
const SEED_DIRS = 120

/** Learns secret-named values from the project's .env files, down to apps/web/.env. */
async function seed($: Dollar, room: Room, cwd: string): Promise<void> {
  const root = trimEnd(cwd)
  const files: string[] = []
  let level = [root]
  let listed = 0
  for (let depth = 0; depth <= SEED_DEPTH && level.length > 0; depth++) {
    const deeper: string[] = []
    for (const dir of level) {
      if (listed++ >= SEED_DIRS) break
      for (const f of await listDir($, dir)) {
        if (f.kind !== 'dir' && isEnvFileName(f.name)) files.push(`${dir}/${f.name}`)
        else if (f.kind === 'dir' && !f.name.startsWith('.') && !SKIP_DIRS.has(f.name)) deeper.push(`${dir}/${f.name}`)
      }
    }
    level = deeper
  }
  for (const path of files) {
    const text = await $.fs.read(path).catch(() => undefined) // missing or unreadable: skip it
    if (text === undefined) continue
    const shown = path.slice(root.length + 1)
    for (const { name, value } of parseDotenv(text)) {
      if (isSecretName(name) && isWorthHiding(name, value)) room.vault.seed(value, name, shown)
    }
  }
  room.vault.takeGrown()
}

// ------------------------------------------------------- tool calls

/**
 * Holds a Bash command that carries a real value unless the command is proven
 * local (every program on cloakroom's local-only list) and nothing on it points
 * at the network. A hold needs a positive reason to pass, never the absence of
 * a known threat: `sh -c`, `eval`, an interpreter, a package
 * runner or a variable as the program is held too, and Allow once lets the
 * person run that exact command one time. Returns the deny text, or undefined.
 */
async function holdIfLeaving($: Dollar, room: Room, sent: string, restored: string): Promise<string | undefined> {
  const found = room.vault.find(restored, 'a Bash command')
  if (found.length === 0) return undefined
  const egress = classifyEgress(restored, found)
  const proof = localProof(restored)
  if (!egress && proof.ok) return undefined
  const now = await $.clock.now()
  const until = room.permits.get(sent)
  if (until !== undefined) {
    room.permits.delete(sent)
    if (until > now) return undefined // the person pressed Allow once: this one run passes
  }
  // The program and the host come from Claude's command: drawn only once cleaned, never a value.
  const names = clean(labels(found.map(f => f.entry)))
  const count = new Set(found.map(f => f.entry.label)).size
  const values = found.map(f => restored.slice(f.start, f.end))
  let reason: string
  let toClaude: string
  if (egress) {
    const via = clean(egress.via)
    const to = clean(egress.to)
    reason = `${count === 1 ? 'was' : 'were'} about to leave via ${via} to ${to}`
    toClaude = `${names} would leave this machine via ${via} to ${to}.`
  } else {
    // Here proof.ok is false (a proven, non-leaving command returned above); the fallback only narrows the type.
    const word = proof.ok ? 'a program' : proof.program
    const program = leaksValue(word, values) ? 'a program in the command' : clean(word)
    const feature = proof.ok || proof.feature === undefined ? undefined : clean(proof.feature)
    reason = `${count === 1 ? 'is' : 'are'} in a command cloakroom cannot vouch for: ${feature ?? `${program} is not on its local-only list`}`
    toClaude =
      `${names} ${count === 1 ? 'is' : 'are'} in it and ${feature ?? `${program} is not on cloakroom's local-only list`} ` +
      '(a real value goes only into echo, printf, cat and other local file tools). ' +
      'Prefer the environment variable instead of the value.'
  }
  const same = room.holds.findIndex(hold => hold.command === sent)
  if (same >= 0) room.holds.splice(same, 1)
  room.holds.push({ command: sent, labels: names, count, reason })
  if (room.holds.length > MAX_HOLDS) room.holds.shift()
  redraw($)
  $.ui.toast(`cloakroom held a command: ${names} ${reason}`)
  return (
    `cloakroom held this command: ${toClaude} ` +
    'The person decides in the red band above the prompt (Allow once or Deny); wait for them before running it again.'
  )
}

/** Whether `text` is one of the strings inside `value` (a few levels down). */
function holdsString(value: unknown, text: string, depth = 0): boolean {
  if (value === text) return true
  if (depth > 4 || value === null || typeof value !== 'object') return false
  return Object.values(value).some(item => holdsString(item, text, depth + 1))
}

/** The result as the model will read it: the same object when clean, a fresh one when anything was hidden. */
function scrubResult(vault: Vault, ran: ToolCallResult, tool: string): ToolCallResult {
  const source = `${tool} output`
  if (ran.deny !== undefined) {
    const s = vault.scrub(ran.deny, source)
    return s.changed ? { deny: s.text } : ran
  }
  if (ran.isError) {
    const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : JSON.stringify(ran.result ?? ''))
    const s = vault.scrub(text, source)
    const r = scrubDeep(vault, ran.result, source)
    // An error has no result shape to keep: the model reads the scrubbed text as the error.
    return s.changed || r.changed ? { deny: s.text } : ran
  }
  const r = scrubDeep(vault, ran.result, source)
  // core's `text` is mapped from the result; scan it too only when the result
  // looked clean and the text is not one of the strings just scanned (Bash's
  // stdout usually is), to catch a value that reached the model's text alone.
  const isTextDirty =
    !r.changed && ran.text !== undefined && !holdsString(ran.result, ran.text) && vault.scrub(ran.text, source).changed
  if (!r.changed && !isTextDirty) return ran
  // Never `ran` itself, nor its `ref`: core would reuse its own unscrubbed
  // messages. A fresh `{ result }` is mapped for the model from what we hand it.
  // Context a hook beneath attached must be kept word for word (the engine
  // refuses an answer that changes it); it reaches the model as an attachment,
  // which prompt.attachment and session.append scrub.
  return { result: r.value, ...(ran.context ? { context: ran.context } : {}) }
}

// ------------------------------------------------------- /cloakroom

function listText(room: Room): string {
  const entries = room.vault.entries()
  if (entries.length === 0) {
    return `cloakroom: no tickets yet this session. Secrets that reach Claude are swapped for [secret:NAME#id] tickets.\n${USAGE}`
  }
  const lines = entries.slice(0, 100).map(entry => {
    const used = `hidden ${entry.hidden}x, restored ${entry.restored}x`
    return `- ${entry.label}: ${entry.kind}, from ${entry.source}; ${used}`
  })
  if (entries.length > 100) lines.push(`- ...and ${entries.length - 100} more`)
  return `cloakroom: ${plural(entries.length, 'ticket')} this session (values are held in memory only, never shown here):\n${lines.join('\n')}\n${USAGE}`
}

async function show($: Dollar, room: Room, arg: string): Promise<string> {
  const entry = arg ? room.vault.lookup(arg) : undefined
  if (!entry) return `cloakroom: no ticket ${arg || '(none given)'} this session. /cloakroom lists them.`
  const surfaces = await $.session.surfaces()
  if (!surfaces.some(s => s === 'terminal' || s === 'desktop')) {
    return 'cloakroom: show draws the value in the band above the prompt, which only the terminal and the desktop app have.'
  }
  room.reveal = entry
  room.revealTimer?.cancel()
  room.revealTimer = $.clock.after(REVEAL_MS, () => {
    if (room.reveal === entry) room.reveal = undefined
    redraw($)
  })
  redraw($)
  return `cloakroom: showing ${entry.label} in the band above the prompt for ${REVEAL_MS / 1000} seconds. It is drawn on your screen only; Claude is not sent the value.`
}

function forget(room: Room, arg: string): string {
  const entry = arg ? room.vault.lookup(arg) : undefined
  if (!entry) return `cloakroom: no ticket ${arg || '(none given)'} this session. /cloakroom lists them.`
  room.vault.forget(entry)
  if (room.reveal === entry) room.reveal = undefined
  return `cloakroom: forgot ${entry.label}. Its value is no longer hidden this session, and the ticket no longer works in tools.`
}

type Transcript = { path: string; size: number; mtimeMs: number }

/** projects/<project>/<session>.jsonl, and subagents under <session>/subagents/. */
async function listTranscripts($: Dollar, projects: string): Promise<Transcript[]> {
  const files: Transcript[] = []
  for (const project of (await listDir($, projects)).filter(d => d.kind === 'dir').slice(0, 2000)) {
    const dir = `${projects}/${project.name}`
    for (const entry of await listDir($, dir)) {
      if (entry.kind === 'file' && entry.name.endsWith('.jsonl')) {
        files.push({ path: `${dir}/${entry.name}`, size: entry.size, mtimeMs: entry.mtimeMs })
      } else if (entry.kind === 'dir') {
        for (const sub of await listDir($, `${dir}/${entry.name}/subagents`)) {
          if (sub.kind === 'file' && sub.name.endsWith('.jsonl')) {
            files.push({ path: `${dir}/${entry.name}/subagents/${sub.name}`, size: sub.size, mtimeMs: sub.mtimeMs })
          }
        }
      }
    }
    if (files.length >= 20_000) break
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** Reads past transcripts, newest first, within a time and size budget; read-only. */
async function runAudit($: Dollar, room: Room): Promise<string[]> {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  const base = config ? trimEnd(config) : home ? `${trimEnd(home)}/.claude` : undefined
  if (!base) return ['cloakroom audit: cannot find your Claude Code folder (HOME is not set).']
  const shownBase = home && base.startsWith(trimEnd(home)) ? `~${base.slice(trimEnd(home).length)}` : base
  const files = await listTranscripts($, `${base}/projects`)
  if (files.length === 0) return [`cloakroom audit: no transcripts found in ${shownBase}/projects.`]

  const { audit: tally } = room
  const started = performance.now()
  let bytes = 0
  let read = 0
  let isCut = false
  for (const file of files) {
    if (tally.done.has(file.path)) continue
    if (performance.now() - started > AUDIT_MS || bytes > AUDIT_BYTES) {
      isCut = true
      break
    }
    tally.done.add(file.path)
    if (file.size > FS_READ_MAX) {
      tally.tooBig++
      continue
    }
    const text = await $.fs.read(file.path).catch(() => undefined)
    if (text === undefined) {
      tally.unreadable++
      continue
    }
    auditTranscript(tally, room.vault, text, file.path, new Date(file.mtimeMs).toISOString().slice(0, 10))
    bytes += text.length
    read++
  }
  const covered = files.filter(f => tally.done.has(f.path)).length
  const lines = [
    `cloakroom audit (read-only): ${covered} of ${plural(files.length, 'transcript')} in ${shownBase}/projects checked, newest first (${read} read just now).`,
  ]
  if (tally.tooBig > 0 || tally.unreadable > 0) {
    lines.push(`Not checked: ${tally.tooBig} over 4 MiB (the most one file read can take) and ${tally.unreadable} unreadable.`)
  }
  const found = findingLines(tally)
  if (found.length === 0) {
    lines.push('No exposed secrets found in what was checked.')
  } else {
    lines.push('Rotate these: they were already written into past transcripts on this machine (previews only, never the value):')
    lines.push(...found)
  }
  if (isCut) lines.push('Run /cloakroom audit again to check older transcripts.')
  return lines
}

/**
 * The audit's findings go to a pane on the person's screen, never into the command's text:
 * that is a transcript row Claude reads, and even a masked preview is a key's fingerprint.
 */
async function audit($: Dollar, room: Room): Promise<string> {
  const surfaces = await $.session.surfaces()
  if (!surfaces.some(s => s === 'terminal' || s === 'desktop')) {
    return 'cloakroom audit: the results draw in a pane, which only the terminal and the desktop app have.'
  }
  room.auditView = await runAudit($, room)
  const opened = await $.ui.open({ id: AUDIT_PANE, title: 'Cloakroom audit', focus: true, closeOnEscape: true })
  redraw($)
  return opened.isPlaced
    ? 'cloakroom audit: the results are in the Cloakroom audit pane, on your screen only. Claude is not sent them.'
    : 'cloakroom audit: the results are ready, but the pane could not be drawn here. Run it again in a wider window.'
}

/** The command's output: file names, previews and echoed arguments are cleaned by the caller. */
async function answer($: Dollar, room: Room, args: string, origin: string): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const action = verb.toLowerCase()
  const arg = rest.join(' ')
  // show reveals a value, audit reads transcripts, forget stops hiding one:
  // only for the person typing, never another plugin, a peer, a relay or
  // a prompt-injected model running the command.
  if (PERSON_ONLY.has(action) && !PERSON_ORIGINS.has(origin)) {
    return `cloakroom: /cloakroom ${action} runs only when you type it yourself; this run came from ${origin}.`
  }
  switch (action) {
    case '':
    case 'list':
      return listText(room)
    case 'show':
      return show($, room, arg)
    case 'forget':
      return forget(room, arg)
    case 'audit':
      return audit($, room)
    default:
      return `cloakroom: unknown command "${verb}". ${USAGE}`
  }
}

// ------------------------------------------------------- the hooks

export const register: Register = (on, options) => {
  isOn = options.enabled !== false
  const room: Room = {
    vault: new Vault(),
    holds: [],
    permits: new Map(),
    reveal: undefined,
    revealTimer: undefined,
    audit: newAudit(),
    auditView: undefined,
    unseeded: undefined,
  }
  const { vault } = room

  // Off at once: holds, Allow once permits and a shown value are dropped, so none comes
  // back stale; what was hidden stays hidden (nothing is asked again to undo it). A ticket
  // Claude uses while off stays the ticket's text: restoring it with no check on the way
  // out would be the leak this mod is for. On at once: .env files are read if the session
  // started off, and the prompt parts cached while off are asked again.
  on('config.set', { key: 'cloakroom.enabled' }, async ($, e, next) => {
    // Off only by the person in the menu or the hub on their press. Not another mod (one that
    // lets Claude change settings must not be a way around the cloakroom), and not a /config
    // over Remote Control, which the engine says is not attestably the person's hand.
    const isPersons = e.origin.kind === 'composer' || (e.origin.kind === 'plugin' && e.origin.name === 'modmyclaude-hub')
    if (e.value === false && !isPersons) {
      return { deny: 'cloakroom stays on: you switch it off in the /config menu on this machine, or in the modmyclaude hub' }
    }
    const set = await next(e)
    if (set.deny === undefined && typeof set.value === 'boolean') {
      if (set.value) {
        const cwd = room.unseeded
        room.unseeded = undefined
        // Read before the doors open; a value that cannot be learned is still caught by its shape.
        if (cwd !== undefined) await seed($, room, cwd).catch(() => undefined)
        isOn = true
        rescanAll($)
      } else {
        isOn = false
        room.holds.length = 0
        room.permits.clear()
        room.reveal = undefined
        room.revealTimer?.cancel()
        room.revealTimer = undefined
      }
      redraw($)
    }
    return set
  })

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'cloakroom',
        description: "List this session's secret tickets, or show, forget or audit",
        argumentHint: '[show <ticket> | forget <ticket> | audit]',
        immediate: true,
      })
    } catch {
      // a host that takes no commands: the doors still work
    }
    // Off, no file is read: the .env files wait until it is switched on.
    if (isOn) await seed($, room, e.cwd)
    else room.unseeded = e.cwd
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (!isOn) return next(e)
    const tool = String(e.tool)
    const { tool: _tool, tool_use_id: _id, agentId: _agent, consent: _consent, ...args } = e as Record<string, unknown>
    let call = e
    if (RESTORE.has(tool)) {
      // Bash: the command alone (its description is drawn on screen as written).
      const target: Record<string, unknown> = tool === 'Bash' ? { command: args.command } : args
      const r = restoreDeep(vault, target)
      if (r.unknown.length > 0) {
        return {
          deny:
            `cloakroom does not know ${[...new Set(r.unknown)].join(', ')} (tickets do not survive a restart or reload), ` +
            'so nothing was run or written. Ask the person to paste the value again, or use its environment variable.',
        }
      }
      if (tool === 'Bash' && typeof r.value.command === 'string' && typeof args.command === 'string') {
        const held = await holdIfLeaving($, room, args.command, r.value.command)
        if (held !== undefined) return { deny: held }
      }
      if (r.changed) call = { ...e, ...r.value } as typeof e
    } else if (!LOCAL_READS.has(tool)) {
      // Web fetches, MCP tools, subagents, messages, questions: a raw value
      // that reached Claude some other way leaves only as its ticket.
      const s = scrubDeep(vault, args, `${tool} input`)
      if (s.changed) call = { ...e, ...s.value } as typeof e
    }
    const ran = await next(call)
    const out = scrubResult(vault, ran, tool)
    rescanCached($, room)
    return out
  }).catch(($, e, next) =>
    // Off, a failure beneath is the engine's, passed on as if cloakroom were not here.
    !isOn ? next(e) : next.called ? { deny: WITHHELD } : { deny: 'cloakroom: the secret check failed, so this call did not run.' },
  )

  on('prompt.submit', async ($, e, next) => {
    if (!isOn) return next(e)
    const s = vault.scrub(e.text, 'your prompt')
    const context = e.context?.map(c => vault.scrub(c, 'prompt context'))
    if (!s.changed && !context?.some(c => c.changed)) return next(e)
    if (s.changed) $.ui.toast(clean(`cloakroom hid ${labels(s.entries)} in your prompt; Claude sees the ticket.`))
    rescanCached($, room)
    return next({ ...e, text: s.text, ...(context ? { context: context.map(c => c.text) } : {}) })
  }).catch(($, e, next) =>
    next.called ? next(e) : { drop: 'cloakroom could not check this prompt for secrets, so it was not sent.' },
  )

  on('prompt.attachment', async ($, e, next) => {
    if (!isOn) return next(e)
    const r = await next(e)
    if (r.text === null) return r
    // A file the person @-mentioned, or one Claude Code shows edited, keeps its line count, so a
    // `#L10-20` reference in the prompt still names the lines it did.
    const isFile = e.type === 'file' || e.type === 'edited_text_file'
    const s = vault.scrub(r.text, `${e.type} attachment`, { keepLines: isFile })
    return s.changed ? { text: s.text } : r
  }).catch(($, e, next) => (!isOn ? next(e) : { text: WITHHELD }))

  on('prompt.context', async ($, e, next) => {
    if (!isOn) return next(e)
    const r = await next(e)
    let changed = false
    const blocks = r.blocks.map(b => {
      const s = vault.scrub(b.text, `${b.name} context`)
      if (!s.changed) return b
      changed = true
      return { ...b, text: s.text }
    })
    // A rewritten claudeMd text stands for the files behind it, which the
    // engine then treats as unknown to the hooks above: their contents are
    // not passed on.
    return changed ? { blocks } : r
  }).catch(async ($, e, next) => {
    if (!isOn) return next(e)
    // Withhold every block but the date rather than send one unscanned.
    const r = await next(e).catch(() => ({ blocks: [] }))
    return { blocks: r.blocks.map(b => (b.name === 'currentDate' ? b : { ...b, text: WITHHELD })) }
  })

  on('prompt.compose', async ($, e, next) => {
    if (!isOn) return next(e)
    const r = await next(e)
    const sections = r.sections.map(section => {
      if (section.id === LINE.id) return section
      const s = vault.scrub(section.text, `${section.id} section`)
      return s.changed ? { ...section, text: s.text } : section
    })
    if (!sections.some(section => section.id === LINE.id)) sections.push(LINE)
    return { sections }
  }).catch(async ($, e, next) => {
    if (!isOn) return next(e)
    const r = await next(e).catch(() => ({ sections: [] }))
    return { sections: [...r.sections.filter(s => s.scope === 'shared'), LINE] }
  })

  on('skill.prompt', async ($, e, next) => {
    if (!isOn) return next(e)
    const r = await next(e)
    const s = vault.scrub(r.text, `${e.skill} skill`)
    return s.changed ? { text: s.text } : r
  }).catch(($, e, next) => (!isOn ? next(e) : { text: WITHHELD }))

  on('session.append', async ($, e, next) => {
    if (!isOn) return next(e)
    const r = scrubBlocks(vault, e.message.content, SOURCES[e.door] ?? 'the conversation')
    if (!r.changed) return next(e)
    return next({ ...e, message: { ...e.message, content: r.value } })
  }).catch(($, e, next) =>
    next.called ? next(e) : next({ ...e, message: { ...e.message, content: withheldBlocks(e.message.content) } }),
  )

  on('session.send', async ($, e, next) => {
    if (!isOn) return next(e)
    const s = vault.scrub(e.text, 'an outgoing message')
    return next(s.changed ? { ...e, text: s.text } : e)
  }).catch(($, e, next) =>
    next.called ? next(e) : { isDelivered: false, reason: 'cloakroom could not check this message for secrets, so it was not sent.' },
  )

  on('session.receive', async ($, e, next) => {
    if (!isOn) return next(e)
    const s = vault.scrub(e.text, 'a delivery')
    return next(s.changed ? { ...e, text: s.text } : e)
  }).catch(($, e, next) => (next.called ? next(e) : { consumed: 'cloakroom could not check this delivery for secrets' }))

  on('telemetry.log', { to: 'collector' }, async ($, e, next) => {
    if (!isOn) return next(e)
    let changed = false
    const attributes: Record<string, string | number | boolean | readonly string[]> = {}
    for (const [key, value] of Object.entries(e.attributes)) {
      const r = scrubDeep(vault, value, 'telemetry')
      if (r.changed) changed = true
      attributes[key] = r.value
    }
    return next(changed ? { ...e, attributes } : e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'cloakroom could not check this record for secrets' }))

  // The band: a held command (red), or a value the person asked to see, drawn
  // above whatever the other mods and the engine put there. It never takes the
  // keyboard on its own. Once the person focuses it, the ring starts on Deny;
  // Allow once has no hotkey, so no stray key can press it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isOn || e.props.hasSurvey) return next(e)
    const hold = room.holds[0]
    const shown = room.reveal
    if (!hold && !shown) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    // A pending hold renders alone: what another mod draws beneath could
    // make the engine refuse the whole band and take Deny and Allow once with it.
    const below = hold ? null : await next(e)

    // Each button acts on the hold it was drawn for, even if the queue moved since.
    const decide = (isAllowed: boolean) => async () => {
      if (!isOn) return // a press drawn before the switch went off
      for (let i = room.holds.length - 1; i >= 0; i--) {
        if (room.holds[i]!.command === hold!.command) room.holds.splice(i, 1)
      }
      redraw($)
      if (!isAllowed) return
      room.permits.set(hold!.command, (await $.clock.now()) + PERMIT_MS)
      await $.prompt.submit({
        text:
          `cloakroom: the person pressed Allow once for the held command (${hold!.labels} ${hold!.reason}). ` +
          'Run that exact command again; it will pass one time.',
      })
    }

    const mine = hold ? (
      <Box key="cloakroom" flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
        <Text color="error" bold>
          held: {hold.labels} {hold.reason}
        </Text>
        <Text dimColor>
          Claude was told to wait. Allow once lets this exact command run one time
          {room.holds.length > 1 ? ` (${room.holds.length - 1} more held after this one)` : ''}.
        </Text>
        <Box gap={2}>
          <Button key="deny" label="Deny" hotkey="d" autoFocus onPress={decide(false)} />
          <Button key="allow" label="Allow once" onPress={decide(true)} />
        </Box>
      </Box>
    ) : (
      <Box key="cloakroom" flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
        <Text bold>
          {clean(shown!.label)} ({clean(shown!.kind)}) - on this screen only, never sent to Claude
        </Text>
        <Text color="warning">{clean(shown!.value, { keepNewlines: true })}</Text>
        <Button
          key="hide"
          label="Hide"
          autoFocus
          onPress={() => {
            room.reveal = undefined
            room.revealTimer?.cancel()
            redraw($)
          }}
        />
      </Box>
    )
    return (
      <Box flexDirection="column">
        {mine}
        {below}
      </Box>
    )
  })

  // The audit's findings, on the person's screen only. File names and previews are untrusted: clean() each line.
  on('ui.render', { component: 'Pane', requestId: AUDIT_PANE }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    if (!isOn) {
      return (
        <Box flexDirection="column">
          <Text key="off" dimColor>
            {OFF_TEXT}
          </Text>
        </Box>
      )
    }
    const lines = room.auditView ?? ['Run /cloakroom audit to check your past transcripts.']
    return (
      <Box flexDirection="column" paddingX={1}>
        {lines.map((line, i) => (
          <Text key={`line-${i}`}>{clean(line)}</Text>
        ))}
      </Box>
    )
  })

  // Every word of the output passes clean(): file names, previews and echoed arguments are untrusted.
  on('command.run', { command: 'cloakroom' }, async ($, e) => {
    if (!isOn) {
      $.ui.toast(OFF_TEXT)
      return {}
    }
    return { text: clean(await answer($, room, e.args, e.origin.kind), { keepNewlines: true }) }
  }).catch(() => ({ text: 'cloakroom: that command failed, and nothing was shown.' }))
}
