// Switchboard: every Claude Code session on this machine in one pane, and which
// one needs you. Each session running Switchboard writes a small record about
// itself (its title or folder, its state, where it runs, what a dialog waits
// on, times and cost; never message text) to ~/.claude/switchboard/<id>.json,
// from its own events: turns starting and ending, the tool a turn calls, and
// Claude Code's own "a dialog is waiting on you" notice. A session someone is
// looking at reads the others every few seconds; a record that stops being
// rewritten is a session that is gone.
//
// Watch only: it never focuses, answers or types into another session.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode, Timer } from 'claude-code'

import type { SwitchboardRow, SwitchboardWhere } from '../types'
import {
  EMPTY_LINE, HEARTBEAT_MS, MARK, MAX_SESSIONS, POLL_MS, SHOWN_GONE_MS, STALE_MS, WHERE_WORDS, bandLine, costWords, drawnKey,
  folderName, footerLabel, hereLine, heroLine, newlyNeeding, oneLine, parseRecord, quietLine, rowsOf, seenOf, stateWords,
  titleFromTail, toastLine, transcriptPath, waitingWords,
} from './board'
import type { SessionRecord } from './board'
import { BOLT_COLUMNS, boltSprite } from './bolt-draw'

const PANE = 'switchboard'
const rows = atom({ plugin: 'switchboard', key: 'rows' } as const, [])
const readAt = atom({ plugin: 'switchboard', key: 'readAt' } as const, 0)
const showQuiet = atom({ plugin: 'switchboard', key: 'showQuiet' } as const, false)

/** Claude Code's own notifications that a dialog is waiting on the person (as pager reads them). */
const WAITING = new Set(['permission_prompt', 'worker_permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input'])
/** How much of the end of its own transcript a session reads for its title. */
const TITLE_TAIL_BYTES = 262_144
/** The title is looked up again at most this often (at a turn's end). */
const TITLE_EVERY_MS = 2 * 60_000

/** This session as it reports itself. */
type Me = {
  id: string
  folder: string
  cwd: string
  title?: string
  state: SessionRecord['state']
  since: number
  where: SwitchboardWhere
  waitingOn?: string
  lastActiveAt?: number
  /** Opened and not prompted yet. */
  isNew: boolean
  costUsd?: number
  writtenAt: number
  /** The tool the main loop last called: what a permission dialog is about. */
  lastTool?: string
  transcript?: string
  titleCheckedAt: number
}

// This copy of the module: this session's own record, where records live, the
// timer, and what the last read saw (so each toast fires once per change).
let me: Me | null = null
let base: string | undefined
let timer: Timer | null = null
let seen: Map<string, string> | undefined
let lastKey = ''
let isReading = false
/** Each file's last parsed record by its mtime: a file that did not change is not read again. */
const cache = new Map<string, { mtimeMs: number; record: SessionRecord }>()
/** The id a /clear or resume just ended: nothing is written under it again. */
let endedId: string | null = null
/**
 * The transcript Claude Code names on its settings-hook events. It is keyed by the folder the
 * session started in, which the working directory can leave (a cd, a worktree), so it beats the
 * path worked out from the folder; kept even before this copy's record exists.
 */
let transcriptHint: string | undefined

async function safely($: EngineInterface, work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch (error) {
    $.ui.log(`switchboard: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  }
}

const folderOf = () => (base === undefined ? undefined : `${base}/switchboard`)

/** ~/.claude, or CLAUDE_CONFIG_DIR, as Claude Code finds its own folder. */
async function configDir($: EngineInterface): Promise<string | undefined> {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  if (config) return config.replace(/[\\/]+$/, '')
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  return home ? `${home.replace(/[\\/]+$/, '')}/.claude` : undefined
}

/** Where the session can be found: the desktop app, a terminal, or nothing attached. */
async function whereNow($: EngineInterface): Promise<SwitchboardWhere> {
  const surfaces = await $.session.surfaces()
  return surfaces.includes('desktop') ? 'desktop' : surfaces.includes('terminal') ? 'terminal' : 'background'
}

function recordOf(mine: Me, now: number): SessionRecord {
  return {
    v: 1,
    id: mine.id,
    name: oneLine(mine.title ?? mine.folder, 48) || 'session',
    state: mine.state,
    since: mine.since,
    updatedAt: now,
    where: mine.where,
    ...(mine.state === 'needs-you' && mine.waitingOn !== undefined ? { waitingOn: mine.waitingOn } : {}),
    ...(mine.lastActiveAt === undefined ? {} : { lastActiveAt: mine.lastActiveAt }),
    ...(mine.isNew ? { isNew: true } : {}),
    ...(mine.costUsd === undefined ? {} : { costUsd: mine.costUsd }),
  }
}

/** Rewrites this session's record: on every change, and as a heartbeat. */
async function writeMine($: EngineInterface): Promise<void> {
  const dir = folderOf()
  if (me === null || dir === undefined) return
  if (me.id === endedId) {
    // Between a /clear and its new id: nothing is written under the ended one; the new one
    // is taken as soon as Claude Code answers it (until then the id it answers is the same).
    return becomeSession($, await $.session.id())
  }
  const now = await $.clock.now()
  me.where = await whereNow($)
  await $.fs.write(`${dir}/${me.id}.json`, JSON.stringify(recordOf(me, now)))
  me.writtenAt = now
}

async function setState($: EngineInterface, state: SessionRecord['state'], waitingOn?: string): Promise<void> {
  if (me === null || (me.state === state && me.waitingOn === waitingOn)) return
  const now = await $.clock.now()
  if (me.state !== state) me.since = now
  me.state = state
  me.waitingOn = waitingOn
  if (state === 'working' || state === 'needs-you') {
    me.lastActiveAt = now
    me.isNew = false
  }
  await writeMine($)
  await readOthers($)
}

/**
 * This session's title from the end of its own transcript (the sidebar's, else
 * Claude Code's own), at most every two minutes. Only the title lines are read;
 * a host without `tail`, or a transcript not there yet, leaves the name as it is.
 */
async function refreshTitle($: EngineInterface, isDue = false): Promise<void> {
  if (me === null || base === undefined) return
  const now = await $.clock.now()
  if (!isDue && now - me.titleCheckedAt < TITLE_EVERY_MS) return
  me.titleCheckedAt = now
  const path = me.transcript ?? transcriptPath(base, me.cwd, me.id)
  try {
    const { exitCode, stdout } = await $.process.run(['tail', '-c', String(TITLE_TAIL_BYTES), path], { timeoutMs: 5_000 })
    const title = exitCode === 0 ? titleFromTail(stdout) : undefined
    if (title !== undefined) await setTitle($, title)
  } catch {
    // No tail on this host: the title comes from the prompt events instead.
  }
}

/** Reads every recent record (this session's from memory), raises a toast per new "needs you", and redraws only on a change. */
async function readOthers($: EngineInterface): Promise<void> {
  const dir = folderOf()
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

/** This session under a new id (a /clear or a resume): it starts idle, with no title and none of the old conversation's turns. */
async function becomeSession($: EngineInterface, id: string): Promise<void> {
  if (me === null || me.id === id) return
  const isNew = (await $.session.turns().catch(() => 1)) === 0
  me = { ...me, id, title: undefined, state: 'idle', since: await $.clock.now(), waitingOn: undefined, isNew, lastActiveAt: undefined, writtenAt: 0, transcript: undefined, titleCheckedAt: 0 }
  await writeMine($)
  await readOthers($)
}

async function setTitle($: EngineInterface, title: string | undefined): Promise<void> {
  const clean = title?.trim() ? oneLine(title, 48) : undefined
  if (me === null || clean === undefined || me.title === clean) return
  me.title = clean
  await writeMine($)
  await readOthers($)
}

/** Keeps the transcript path a settings-hook event named; true when it is news. */
function noteTranscript(path: string | undefined): boolean {
  if (!path || path === transcriptHint) return false
  transcriptHint = path
  if (me !== null) me.transcript = path
  return true
}

/**
 * Opens the pane. One pane per id: an id Claude Code still holds open only retitles, so a pane the
 * desktop hid (closed or squeezed away without a close reaching the engine) would stay hidden.
 * A held but unshown one is closed first, so this open draws it fresh.
 */
async function openPane($: EngineInterface) {
  try {
    const held = (await $.ui.panes()).find(pane => pane.id === PANE)
    if (held !== undefined && !held.isShown) await $.ui.close({ id: PANE })
  } catch {
    // No pane list on this host: open as asked.
  }
  return $.ui.open({ id: PANE, title: 'Switchboard', focus: true, closeOnEscape: true })
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
      base = await configDir($)
      const cwd = await $.session.root()
      const now = await $.clock.now()
      // Folded again on every start: the quiet list opens only when asked, in this session.
      await update($, showQuiet, () => false)
      const isNew = (await $.session.turns().catch(() => 1)) === 0
      me = { id: await $.session.id(), folder: folderName(cwd), cwd, state: 'idle', since: now, where: await whereNow($), isNew, writtenAt: 0, transcript: transcriptHint, titleCheckedAt: 0 }
      await refreshTitle($, true)
      await writeMine($)
      timer ??= $.clock.every(POLL_MS, () => void safely($, () => tick($)))
      await readOthers($)
    })
    return started
  })

  // The session's title, id and transcript ride on these settings-hook events; read them, change nothing.
  on('classic.SessionStart', async ($, e, next) => {
    await safely($, async () => {
      if (e.session_id) await becomeSession($, e.session_id)
      noteTranscript(e.transcript_path)
      if (e.session_title?.trim()) await setTitle($, e.session_title)
      else await refreshTitle($, true)
    })
    return next(e)
  })
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await safely($, async () => {
      const isNewPath = noteTranscript(e.transcript_path)
      if (e.session_title?.trim()) await setTitle($, e.session_title)
      // The first sure path to an untitled session's transcript: look now, not two minutes on.
      else if (isNewPath && me?.title === undefined) await refreshTitle($, true)
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await safely($, () => setState($, 'working'))
    return next(e)
  })

  // A main turn's end: idle, or an error that wants the person; and the title, which Claude Code
  // writes after the first prompt, is looked up again (at most every two minutes).
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await safely($, async () => {
        await setState($, e.reason === 'error' || e.reason === 'refusal' ? 'error' : 'idle')
        // An untitled session looks at every turn end until Claude Code has titled it.
        await refreshTitle($, me?.title === undefined)
      })
    }
    return next(e)
  })

  // Claude Code's own "a dialog is waiting on you": a permission (for the tool the turn just called), a question, a plan.
  on('classic.Notification', async ($, e, next) => {
    if (WAITING.has(e.notification_type)) {
      await safely($, async () => {
        await setState($, 'needs-you', waitingWords(e.notification_type, me?.lastTool))
        // A first turn can ask before any turn has ended: look for the title now too.
        await refreshTitle($, me?.title === undefined)
      })
    }
    return next(e)
  })

  // The tool a dialog asks about; and once it ran, the dialog was answered and the session works again.
  on('tool.call', async ($, e, next) => {
    if (me !== null && e.agentId === undefined) me.lastTool = String(e.tool)
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
      const dir = folderOf()
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

  // A surface came to look (or left): say where this session is now, and read at once.
  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    await safely($, async () => {
      await writeMine($)
      await readOthers($)
    })
    return attached
  })

  on('command.run', { command: 'switchboard' }, async $ => {
    const opened = await openPane($)
    if (!opened.isPlaced) {
      const list = await read($, rows)
      $.ui.toast(bandLine(list) ?? heroLine(list).text)
    }
    return {}
  }).catch($ => {
    $.ui.toast('/switchboard could not open.')
    return {}
  })

  // The footer: a count beside the engine's own labels while another session needs you.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const engine = await next(e)
    const label = footerLabel(await read($, rows))
    if (label === null) return engine
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        {engine}
        {e.props.modes.length > 0 ? <Text dimColor> & </Text> : null}
        <Box key="switchboard">
          <Text color="warning">{label}</Text>
        </Box>
      </Box>
    )
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
          <Text color="warning" wrap="truncate-end">{`! ${line}`}</Text>
          <Button key="switchboard-show" label="Show" onPress={() => openPane($)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const list = await read($, rows)
    const isQuietShown = await read($, showQuiet)
    const now = (await read($, readAt)) || (await $.clock.now())
    const columns = e.props.bodyColumns
    const isWide = columns >= 72
    const hero = heroLine(list)
    const others = list.filter(row => !row.isMine)
    const quiet = others.filter(row => row.isQuiet)
    const gone = others.filter(row => row.state === 'gone')
    const active = others.filter(row => !row.isQuiet && row.state !== 'gone')

    // One row per session. The name gives way first, so what it is doing and where always show;
    // a session waiting on you says what for on a line of its own, never cut by the pane's edge.
    const rowOf = (row: SwitchboardRow, isDim = false) => {
      const mark = MARK[row.state]
      const isWaiting = row.state === 'needs-you'
      const words = <Text color={mark.color === 'success' ? undefined : mark.color} dimColor={mark.dimColor}>{stateWords(row, now)}</Text>
      const line = (
        <Box key="line" flexDirection="row" gap={1}>
          <Box key="mark" width={1} flexShrink={0}>
            <Text color={mark.color} dimColor={mark.dimColor}>{mark.shape}</Text>
          </Box>
          <Box key="name" flexGrow={1} flexShrink={1} minWidth={8}>
            <Text wrap="truncate-end" dimColor={isDim} bold={isWaiting}>{row.name}</Text>
          </Box>
          {isWaiting ? null : (
            <Box key="state" flexShrink={0}>
              {words}
            </Box>
          )}
          {isWide ? (
            <Box key="where" width={10} flexShrink={0} justifyContent="flex-end">
              <Text color="subtle">{WHERE_WORDS[row.where]}</Text>
            </Box>
          ) : null}
          {isWide ? (
            <Box key="cost" width={8} flexShrink={0} justifyContent="flex-end">
              <Text color="subtle">{costWords(row.costUsd)}</Text>
            </Box>
          ) : null}
        </Box>
      )
      return (
        <Box key={`row-${row.id}`} flexDirection="column">
          {line}
          {isWaiting ? (
            <Box key="waiting" paddingLeft={2}>
              <Text color="warning" wrap="wrap">{stateWords(row, now)}</Text>
            </Box>
          ) : null}
        </Box>
      )
    }

    const isRoomy = columns >= BOLT_COLUMNS.tiny + 30
    const body: RenderNode[] = [
      <Box key="hero" flexDirection="row" gap={1} alignItems="center">
        {isRoomy ? boltSprite(elements, e.surface, { size: 'tiny', pose: hero.tone === 'warning' ? 'jump' : 'sleep' }, 'hero-bolt') : null}
        <Box key="hero-text">
          <Text bold color={hero.tone}>{hero.text}</Text>
        </Box>
      </Box>,
    ]
    const here = hereLine(list)
    if (here !== null) {
      body.push(
        <Box key="here">
          <Text color="subtle" wrap="truncate-end">{here}</Text>
        </Box>,
      )
    }
    if (others.length === 0) {
      body.push(
        <Box key="empty" marginTop={1}>
          <Text dimColor wrap="wrap">{EMPTY_LINE}</Text>
        </Box>,
      )
    } else {
      body.push(<Box key="gap" height={1} />)
      for (const row of active) body.push(rowOf(row))
      if (quiet.length > 0) {
        body.push(
          <Box key="quiet" flexDirection="row" gap={1}>
            <Box key="mark" width={1} flexShrink={0}>
              <Text dimColor>{MARK.idle.shape}</Text>
            </Box>
            <Text dimColor wrap="truncate-end">{quietLine(quiet.length)}</Text>
            <Button key="quiet-toggle" label={isQuietShown ? 'Hide' : 'Show'} onPress={() => update($, showQuiet, shown => !shown)} />
          </Box>,
        )
        if (isQuietShown) for (const row of quiet) body.push(rowOf(row, true))
      }
      for (const row of gone) body.push(rowOf(row, true))
    }
    body.push(
      <Box key="foot" marginTop={1}>
        <Text color="subtle" wrap="wrap">It only watches: go to a session to answer it. Sessions show up once Switchboard runs in them.</Text>
      </Box>,
    )
    return (
      <Box key="switchboard-pane" flexDirection="column">
        {body}
      </Box>
    )
  })
}
