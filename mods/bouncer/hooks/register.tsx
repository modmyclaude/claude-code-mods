// Bouncer: checks every installed mod at the door. At session start it runs
// Claude Code's own plugin validator on each plugin folder it can name (this
// one, the ones the engine names as they join, and the ones the plugin registry
// files list) and reads what each can reach: files, programs, the network, the
// model, your prompts, tool calls. One line above the prompt when a mod is new
// to you or its report changed; a /bouncer pane with a row per mod.
//
// Facts from the validator, never a verdict. It never blocks, unloads or
// changes a mod, never reads a mod's source, never calls the network.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode } from 'claude-code'

import type { BouncerRow } from '../types'
import { BOLT_COLUMNS, boltSprite } from './bolt-draw'
import { bandWords, clean, directoryMarketplaces, doorText, hashOf, installedRoots, manifestOf, marketplaceRoots, movedFrom, parseReport, reachWords, seenOf } from './door'
import type { SeenMod } from './door'

const PANE = 'bouncer'
const SEEN = 'seen'
/** The most plugin folders one check runs the validator on. */
export const MAX_MODS = 60

const rows = atom({ plugin: 'bouncer', key: 'rows' } as const, [] as BouncerRow[])
const news = atom({ plugin: 'bouncer', key: 'news' } as const, null as string | null)
const open = atom({ plugin: 'bouncer', key: 'open' } as const, null as string | null)
const checkedAt = atom({ plugin: 'bouncer', key: 'checkedAt' } as const, 0)
const isChecking = atom({ plugin: 'bouncer', key: 'isChecking' } as const, false)

/** Mods the engine named as they joined this session, by their folder. */
const registered = new Map<string, { name: string; version?: string }>()
/** The last check started, for a test or a caller to wait on. */
let lastCheck: Promise<void> = Promise.resolve()
export const whenChecked = (): Promise<void> => lastCheck

/** The button pairs a safety hold draws; while a pair is beneath, the band is left to the hold alone. */
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

async function safely($: EngineInterface, work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch (error) {
    $.ui.log(`bouncer: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  }
}

/** ~/.claude, or CLAUDE_CONFIG_DIR, as Claude Code finds its own folder. */
async function configDir($: EngineInterface): Promise<string | undefined> {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  if (config) return config.replace(/[\\/]+$/, '')
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  return home ? `${home.replace(/[\\/]+$/, '')}/.claude` : undefined
}

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    const text = await $.fs.read(path)
    return typeof text === 'string' ? text : undefined
  } catch {
    return undefined
  }
}

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  const text = await readText($, path)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const trimSlash = (path: string) => path.replace(/\/+$/, '')

/** Every plugin folder to check: this one, the ones the engine named, and the registry's. */
async function rootsToCheck($: EngineInterface): Promise<Map<string, { name?: string; version?: string; isLoaded: boolean }>> {
  const roots = new Map<string, { name?: string; version?: string; isLoaded: boolean }>()
  roots.set(trimSlash($.plugin.root), { name: $.plugin.name, isLoaded: true })
  for (const [root, who] of registered) roots.set(trimSlash(root), { ...who, isLoaded: true })
  const base = await configDir($)
  if (base !== undefined) {
    for (const root of installedRoots(await readJson($, `${base}/plugins/installed_plugins.json`))) {
      if (!roots.has(trimSlash(root))) roots.set(trimSlash(root), { isLoaded: false })
    }
    for (const location of directoryMarketplaces(await readJson($, `${base}/plugins/known_marketplaces.json`))) {
      for (const root of marketplaceRoots(await readJson($, `${location}/.claude-plugin/marketplace.json`), location)) {
        if (!roots.has(trimSlash(root))) roots.set(trimSlash(root), { isLoaded: false })
      }
    }
  }
  return roots
}

/** One folder through the validator: its reach and hash, or why it could not be checked. `before`: the hash it was last seen with, if any. */
async function checkOne($: EngineInterface, bin: string, root: string, name: string, version: string | undefined, isLoaded: boolean, before: string | undefined): Promise<BouncerRow> {
  try {
    const ran = await $.process.run([bin, 'plugin', 'validate', '--json', root], { timeoutMs: 30_000 })
    if (ran.isStdoutTruncated) return { ok: false, name, version, root, isLoaded, reason: 'the report was too long to read' }
    const parsed = parseReport(ran.stdout)
    if (parsed === null) {
      return { ok: false, name, version, root, isLoaded, reason: ran.exitCode === 0 ? 'the report could not be read' : `the validator exited with ${ran.exitCode}` }
    }
    const hash = hashOf(parsed.reach)
    return { ok: true, name, version, root, isLoaded, reach: parsed.reach, hash, isNew: before === undefined, isChanged: before !== undefined && before !== hash }
  } catch (error) {
    // The engine names the call in the message ($.process.run: ...); the person needs the rest.
    const message = (error instanceof Error ? error.message : String(error)).replace(/^(?:[\w-]+: )?\$\.process\.run: /, '')
    return { ok: false, name, version, root, isLoaded, reason: clean(message, 120) }
  }
}

/** New and changed first, then the ones that could not be checked, then by name. */
function byConcern(a: BouncerRow, b: BouncerRow): number {
  const rank = (r: BouncerRow) => (r.ok ? (r.isNew || r.isChanged ? 0 : 2) : 1)
  return rank(a) - rank(b) || a.name.localeCompare(b.name)
}

/** The whole check: every folder through the validator, the band's line, the seen record. */
async function check($: EngineInterface, bin: string): Promise<void> {
  if (await read($, isChecking)) return
  await update($, isChecking, () => true)
  try {
    const roots = [...(await rootsToCheck($)).entries()].slice(0, MAX_MODS)
    // Seen by plugin folder, so a copy under development beside the installed one is its own row with
    // its own hash. A folder that is new while a folder of the same name is gone (an update installed
    // into a new one) is compared with the old folder's hash, and the old entry goes.
    const seen = seenOf(await $.store.get(SEEN))
    const present = new Set(roots.map(([root]) => root))
    const nowSeen: Record<string, SeenMod> = { ...seen }
    const next: BouncerRow[] = []
    for (const [root, who] of roots) {
      const manifest = who.name !== undefined ? who : manifestOf((await readText($, `${root}/.claude-plugin/plugin.json`)) ?? '')
      const name = clean(manifest.name ?? root.split('/').pop() ?? 'mod', 60)
      const moved = movedFrom(seen, name, root, present)
      const before = seen[root]?.hash ?? (moved === undefined ? undefined : seen[moved]?.hash)
      const row = await checkOne($, bin, root, name, manifest.version, who.isLoaded, before)
      next.push(row)
      if (row.ok) {
        nowSeen[root] = { name: row.name, hash: row.hash }
        if (moved !== undefined) delete nowSeen[moved]
      }
    }
    next.sort(byConcern)
    const now = await $.clock.now()
    await update($, rows, () => next)
    await update($, news, () => bandWords(next))
    await update($, checkedAt, () => now)
    await $.store.set(SEEN, nowSeen)
  } finally {
    await update($, isChecking, () => false)
  }
}

async function openPane($: EngineInterface): Promise<boolean> {
  const opened = await $.ui.open({ id: PANE, title: 'Bouncer', closeOnEscape: true })
  // Looked at: the line has done its job for this session.
  await update($, news, () => null)
  return opened.isPlaced
}

/** The hour and minute of a time, for the pane's "checked at". */
function clockWords(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const register: Register = (on, options) => {
  const settings = (options ?? {}) as Record<string, unknown>
  const bin = typeof settings.claudeBin === 'string' && settings.claudeBin.trim() !== '' ? settings.claudeBin.trim() : 'claude'

  // The engine names each mod as it joins the session: the surest list of what is loaded.
  on('plugin.register', async ($, e, next) => {
    registered.set(trimSlash(e.root), { name: e.name, ...(e.version === undefined ? {} : { version: e.version }) })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await safely($, async () => {
      await $.command.register({
        name: 'bouncer',
        description: 'What every installed mod can reach, from the validator: the pane, check again, ok',
        argumentHint: '[check | ok]',
        immediate: true,
      })
    })
    // Not awaited: the validator runs once per mod, and the session need not wait for it.
    lastCheck = safely($, () => check($, bin))
    return started
  })

  // Every answer is {}: command text is read by the model, and nothing here is for it.
  on('command.run', { command: 'bouncer' }, async ($, e) => {
    const verb = e.args.trim().toLowerCase()
    if (verb === '') {
      if (!(await openPane($))) $.ui.log(doorText(await read($, rows)))
      return {}
    }
    if (verb === 'check') {
      await lastCheck // one in flight finishes first, so this one is not skipped
      lastCheck = safely($, () => check($, bin))
      await lastCheck
      $.ui.toast(`bouncer: ${(await read($, rows)).length} mods checked.`)
      return {}
    }
    if (verb === 'ok') {
      await update($, news, () => null)
      $.ui.toast('bouncer: noted. The line goes until a mod is new or changed again.')
      return {}
    }
    $.ui.toast('/bouncer opens the pane; /bouncer check runs the validator again; /bouncer ok clears the line.')
    return {}
  }).catch($ => {
    $.ui.toast('/bouncer could not finish.')
    return {}
  })

  // The band: one line while a mod is new or changed, under other mods' lines, never over a hold.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const line = await read($, news)
    if (line === null) return next(e)
    const below = await next(e).catch(() => null)
    if (below !== null && holdsBeneath(below)) return below
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box key="bouncer-wrap" flexDirection="column">
        {below}
        <Box key="bouncer" flexDirection="row" gap={1}>
          <Box key="bouncer-line" flexShrink={1}>
            <Text color="warning" wrap="truncate-end">
              {line}
            </Text>
          </Box>
          <Button key="bouncer-show" label="Show" onPress={() => void openPane($)} />
        </Box>
      </Box>
    )
  })

  // The pane: one row per mod, its reach in words, details on request.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const list = await read($, rows)
    const unfolded = await read($, open)
    const at = await read($, checkedAt)
    const checking = await read($, isChecking)
    const columns = e.props.bodyColumns
    const body: RenderNode[] = []
    // Two folders with one name (a copy under development beside the installed one) are two rows: numbered keys, and each shows its folder.
    const twins = new Map<string, number>()
    for (const row of list) twins.set(row.name, (twins.get(row.name) ?? 0) + 1)
    const numbered = new Map<string, number>()
    for (const row of list) {
      const tag = row.ok ? (row.isNew ? 'new' : row.isChanged ? 'changed' : '') : ''
      const nth = (numbered.get(row.name) ?? 0) + 1
      numbered.set(row.name, nth)
      const isTwin = (twins.get(row.name) ?? 0) > 1
      const key = isTwin ? `${row.name}-${nth}` : row.name
      body.push(
        <Box key={`row-${key}`} flexDirection="column">
          <Box key="line" flexDirection="row" gap={1}>
            <Box key="name" flexShrink={0}>
              <Text bold={tag !== ''}>{row.name}</Text>
            </Box>
            {isTwin ? (
              <Box key="folder" flexShrink={1} minWidth={12}>
                <Text dimColor wrap="truncate-start">
                  {row.root}
                </Text>
              </Box>
            ) : null}
            {row.version ? (
              <Box key="version" flexShrink={0}>
                <Text dimColor>{row.version}</Text>
              </Box>
            ) : null}
            {tag !== '' ? (
              <Box key="tag" flexShrink={0}>
                <Text color="warning">{tag}</Text>
              </Box>
            ) : null}
            {row.isLoaded ? (
              <Box key="loaded" flexShrink={0}>
                <Text dimColor>loaded</Text>
              </Box>
            ) : null}
            <Box key="reach" flexDirection="row" flexGrow={1} flexShrink={1} flexWrap="wrap">
              {row.ok ? (
                reachWords(row.reach).map((w, i) => (
                  <Text key={`w-${i}`} color={w.warn ? 'warning' : undefined}>
                    {i === 0 ? w.word : `, ${w.word}`}
                  </Text>
                ))
              ) : (
                <Text color="warning" wrap="truncate-end">{`could not check: ${row.reason}`}</Text>
              )}
            </Box>
            {row.ok ? (
              <Button key={`details-${key}`} label={unfolded === row.root ? 'less' : 'details'} onPress={() => update($, open, was => (was === row.root ? null : row.root))} />
            ) : null}
          </Box>
          {row.ok && unfolded === row.root ? (
            <Box key="details" flexDirection="column" paddingLeft={2}>
              {(row.reach.notes.length === 0 ? ['the validator reported no hooks and no calls'] : row.reach.notes).map((note, i) => (
                <Text key={`note-${i}`} dimColor wrap="wrap">
                  {note}
                </Text>
              ))}
            </Box>
          ) : null}
        </Box>,
      )
    }
    return (
      <Box key="bouncer-pane" flexDirection="column" paddingX={1}>
        <Box key="title" flexDirection="row" gap={1} alignItems="center">
          {columns >= BOLT_COLUMNS.tiny + 37 ? boltSprite(elements, e.surface, { size: 'tiny', pose: 'idle' }, 'title-bolt') : null}
          <Text bold>Bouncer</Text>
        </Box>
        <Box key="sub">
          <Text color="subtle" wrap="wrap">
            {checking ? 'Checking the mods through the validator...' : at === 0 ? 'No check has run yet. /bouncer check runs one.' : `Checked ${list.length} mod${list.length === 1 ? '' : 's'} at ${clockWords(at)}. Facts from the validator, not a verdict; nothing leaves the machine.`}
          </Text>
        </Box>
        <Box key="gap" height={1} />
        {body}
        <Box key="foot" marginTop={1}>
          <Text color="subtle" wrap="wrap">
            In the warning colour: runs programs, runs tools, reaches the network, calls MCP tools, calls the API as you, starts subagents, can type for you, can change tool calls, messages other sessions, changes your settings. Bouncer never blocks, unloads or changes a mod.
          </Text>
        </Box>
      </Box>
    )
  })
}
