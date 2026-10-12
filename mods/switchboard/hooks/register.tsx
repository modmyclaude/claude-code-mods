// Switchboard: every Claude Code session on this machine in one pane, and which
// one needs you. Each session running Switchboard writes a small record about
// itself (a name, a state, two times and a cost; never message text) to
// ~/.claude/switchboard/<session id>.json, from its own events: a turn starting
// or ending, and Claude Code's own "a dialog is waiting on you" notification.
// A session someone is looking at reads the others every few seconds. A record
// that stops being rewritten is a session that is gone.
//
// Watch only: it never focuses, answers or types into another session.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode, Timer } from 'claude-code'

import type { SwitchboardState } from '../types'
import {
  HEARTBEAT_MS, MAX_SESSIONS, POLL_MS, SHOWN_GONE_MS, STALE_MS, STATE_WORDS, ageWords, bandLine, costWords, drawnKey,
  folderName, heroLine, newlyNeeding, oneLine, parseRecord, rowsOf, seenOf, toastLine,
} from './board'
import type { SessionRecord } from './board'
import { BOLT_COLUMNS, boltSprite } from './bolt-draw'

const PANE = 'switchboard'
const rows = atom({ plugin: 'switchboard', key: 'rows' } as const, [])
const readAt = atom({ plugin: 'switchboard', key: 'readAt' } as const, 0)

/** Claude Code's own notifications that a dialog is waiting on the person (as pager reads them). */
const WAITING = new Set(['permission_prompt', 'worker_permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input'])

const TONE: Record<SwitchboardState, { color?: string; dimColor?: boolean }> = {
  'needs-you': { color: 'warning' },
  error: { color: 'error' },
  working: {},
  idle: { dimColor: true },
  gone: { dimColor: true },
}

/** This session as it reports itself. */
type Me = {
  id: string
  folder: string
  title?: string
  state: SessionRecord['state']
  since: number
  costUsd?: number
  writtenAt: number
}

// This copy of the module: this session's own record, where records live, the
// timer, and what the last read saw (so each toast fires once per change).
let me: Me | null = null
let dir: string | undefined
let timer: Timer | null = null
let seen: Map<string, string> | undefined
let lastKey = ''
let isReading = false
/** Each file's last parsed record by its mtime: a file that did not change is not read again. */
const cache = new Map<string, { mtimeMs: number; record: SessionRecord }>()
/** The id a /clear or resume just ended: never written again, even by a heartbeat before the new id arrives. */
let endedId: string | null = null

async function safely($: EngineInterface, work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch (error) {
    $.ui.log(`switchboard: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  }
}

/** ~/.claude/switchboard, or CLAUDE_CONFIG_DIR's, as Claude Code finds its own folder. */
async function folderFor($: EngineInterface): Promise<string | undefined> {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  const base = config ? config.replace(/[\\/]+$/, '') : home ? `${home.replace(/[\\/]+$/, '')}/.claude` : undefined
  return base === undefined ? undefined : `${base}/switchboard`
}

function recordOf(mine: Me, now: number): SessionRecord {
  return {
    v: 1,
    id: mine.id,
    name: oneLine(mine.title ?? mine.folder, 40) || 'session',
    state: mine.state,
    since: mine.since,
    updatedAt: now,
    ...(mine.costUsd === undefined ? {} : { costUsd: mine.costUsd }),
  }
}

/** Rewrites this session's record: on every change, and as a heartbeat. */
async function writeMine($: EngineInterface): Promise<void> {
  if (me === null || dir === undefined) return
  if (me.id === endedId) {
    // Between a /clear and its new id: nothing is written under the ended one; the new one
    // is taken as soon as Claude Code answers it (until then the id it answers is the same).
    return becomeSession($, await $.session.id())
  }
  const now = await $.clock.now()
  await $.fs.write(`${dir}/${me.id}.json`, JSON.stringify(recordOf(me, now)))
  me.writtenAt = now
}

async function setState($: EngineInterface, state: SessionRecord['state']): Promise<void> {
  if (me === null || me.state === state) return
  me.state = state
  me.since = await $.clock.now()
  await writeMine($)
  await readOthers($)
}

/** Reads every recent record (this session's from memory), raises a toast per new "needs you", and redraws only on a change. */
async function readOthers($: EngineInterface): Promise<void> {
  if (me === null || dir === undefined || isReading) return
  isReading = true
  try {
    const now = await $.clock.now()
    let entries: Awaited<ReturnType<typeof $.fs.list>> = []
    try {
      entries = await $.fs.list(dir)
    } catch {
      entries = [] // no folder yet: nobody else has written
    }
    const recent = entries
      .filter(entry => entry.kind === 'file' && entry.name.endsWith('.json') && now - entry.mtimeMs <= SHOWN_GONE_MS + STALE_MS)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_SESSIONS)
    const records: SessionRecord[] = [recordOf(me, now)]
    for (const entry of recent) {
      if (entry.name === `${me.id}.json`) continue
      const hit = cache.get(entry.name)
      if (hit !== undefined && hit.mtimeMs === entry.mtimeMs) {
        records.push(hit.record)
        continue
      }
      try {
        const record = parseRecord(await $.fs.read(`${dir}/${entry.name}`))
        // A half-written or unknown file is not kept: the next read tries it again.
        if (record !== null) {
          cache.set(entry.name, { mtimeMs: entry.mtimeMs, record })
          records.push(record)
        }
      } catch {
        // Gone between the list and the read: the next read has it.
      }
    }
    const listed = new Set(recent.map(entry => entry.name))
    for (const name of cache.keys()) if (!listed.has(name)) cache.delete(name)
    const next = rowsOf(records, me.id, now)
    for (const row of newlyNeeding(next, seen)) $.ui.toast(toastLine(row))
    seen = seenOf(next)
    const key = drawnKey(next, now)
    if (key !== lastKey) {
      lastKey = key
      await update($, rows, () => next)
      await update($, readAt, () => now)
    }
  } finally {
    isReading = false
  }
}

/** Every few seconds: the heartbeat when it is due, and a read while someone is looking. */
async function tick($: EngineInterface): Promise<void> {
  if (me === null) return
  const now = await $.clock.now()
  if (now - me.writtenAt >= HEARTBEAT_MS) await writeMine($)
  if ((await $.session.surfaces()).length > 0) await readOthers($)
}

/** This session under a new id (a /clear or a resume): it starts idle, with no title yet. */
async function becomeSession($: EngineInterface, id: string): Promise<void> {
  if (me === null || me.id === id) return
  me = { ...me, id, title: undefined, state: 'idle', since: await $.clock.now(), writtenAt: 0 }
  await writeMine($)
  await readOthers($)
}

async function setTitle($: EngineInterface, title: string | undefined): Promise<void> {
  const clean = title?.trim() ? title.trim() : undefined
  if (me === null || me.title === clean) return
  me.title = clean
  await writeMine($)
  await readOthers($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'switchboard',
      description: 'Every Claude Code session on this machine, and which one needs you',
      immediate: true,
    })
    const started = await next(e)
    await safely($, async () => {
      dir = await folderFor($)
      me = { id: await $.session.id(), folder: folderName(await $.session.root()), state: 'idle', since: await $.clock.now(), writtenAt: 0 }
      await writeMine($)
      timer ??= $.clock.every(POLL_MS, () => void safely($, () => tick($)))
      await readOthers($)
    })
    return started
  })

  // The session's title and id ride on these settings-hook events; read them, change nothing.
  on('classic.SessionStart', async ($, e, next) => {
    await safely($, async () => {
      if (e.session_id) await becomeSession($, e.session_id)
      await setTitle($, e.session_title)
    })
    return next(e)
  })
  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (e.session_title?.trim()) await safely($, () => setTitle($, e.session_title))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await safely($, () => setState($, 'working'))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await safely($, () => setState($, e.reason === 'error' || e.reason === 'refusal' ? 'error' : 'idle'))
    return next(e)
  })

  // Claude Code's own "a dialog is waiting on you": a permission, a question, a plan to approve.
  on('classic.Notification', async ($, e, next) => {
    if (WAITING.has(e.notification_type)) await safely($, () => setState($, 'needs-you'))
    return next(e)
  })

  // A dialog answered: the tool it asked about ran, so the session is working again.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (me?.state === 'needs-you') await safely($, () => setState($, 'working'))
    return ran
  })

  on('session.measure', ($, e, next) => {
    if (me !== null && e.cost !== undefined) me.costUsd = e.cost.usd
    return next(e)
  })

  // The conversation ends. On a /clear or a resume the process goes on under a new id
  // (classic.SessionStart brings it); any other end is this session closing.
  on('session.end', async ($, e, next) => {
    await safely($, async () => {
      if (me === null || dir === undefined) return
      const now = await $.clock.now()
      // The ended conversation's record says gone, whichever id this copy has moved to.
      const ended = e.sessionId || me.id
      await $.fs.write(`${dir}/${ended}.json`, JSON.stringify({ ...recordOf(me, now), id: ended, state: 'gone', since: now }))
      if (e.reason === 'clear' || e.reason === 'resume') {
        endedId = ended
      } else {
        me.state = 'gone'
        me.since = now
        timer?.cancel()
        timer = null
      }
    })
    return next(e)
  })

  // A surface came to look: read at once rather than at the next tick.
  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    await safely($, () => readOthers($))
    return attached
  })

  on('command.run', { command: 'switchboard' }, async ($, e) => {
    const opened = await $.ui.open({ id: PANE, title: 'Switchboard', focus: true, closeOnEscape: true })
    if (!opened.isPlaced) {
      const list = await read($, rows)
      $.ui.toast(bandLine(list) ?? heroLine(list).text)
    }
    return {}
  }).catch($ => {
    $.ui.toast('/switchboard could not open.')
    return {}
  })

  // The band: one line, beneath other mods' lines, only while another session needs you.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const line = bandLine(await read($, rows))
    if (line === null) return next(e)
    const rest = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box key="switchboard-wrap" flexDirection="column">
        {rest}
        <Box key="switchboard" flexDirection="row" gap={1}>
          <Text color="warning" wrap="truncate-end">{line}</Text>
          <Button key="switchboard-show" label="Show" onPress={() => $.ui.open({ id: PANE, title: 'Switchboard', focus: true, closeOnEscape: true })} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, rows)
    const now = (await read($, readAt)) || (await $.clock.now())
    const columns = e.props.bodyColumns
    const hero = heroLine(list)
    const others = list.filter(row => !row.isMine)
    const body: RenderNode[] = [
      <Box key="hero">
        <Text bold color={hero.tone === 'subtle' ? 'subtle' : hero.tone}>{hero.text}</Text>
      </Box>,
    ]
    if (others.length === 0) {
      body.push(
        <Box key="empty" flexDirection="row" gap={2} alignItems="center">
          {columns >= BOLT_COLUMNS.small + 24 ? boltSprite($.ui.resolve(e), e.surface, { size: 'small', pose: 'idle' }) : null}
          <Text dimColor>No other sessions yet. Each one running Switchboard shows up here.</Text>
        </Box>,
      )
    }
    for (const row of list) {
      body.push(
        <Box key={`row-${row.id}`} flexDirection="row">
          <Box key="name" flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end" bold={row.isMine}>{row.isMine ? `${row.name} (this one)` : row.name}</Text>
          </Box>
          <Box key="state" width={10} flexShrink={0}>
            <Text {...TONE[row.state]}>{STATE_WORDS[row.state]}</Text>
          </Box>
          <Box key="age" width={5} flexShrink={0} justifyContent="flex-end">
            <Text color="subtle">{ageWords(now - row.since)}</Text>
          </Box>
          {columns >= 50 ? (
            <Box key="cost" width={9} flexShrink={0} justifyContent="flex-end">
              <Text color="subtle">{costWords(row.costUsd)}</Text>
            </Box>
          ) : null}
        </Box>,
      )
    }
    body.push(
      <Box key="foot" marginTop={1}>
        <Text color="subtle" wrap="wrap">Sessions show up once Switchboard runs in them. Times are since the last change.</Text>
      </Box>,
    )
    return (
      <Box key="switchboard-pane" flexDirection="column">
        {body}
      </Box>
    )
  })
}
