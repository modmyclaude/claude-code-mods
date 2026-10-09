// porthole: a live screenshot of the app you are building, in a pane beside the chat.
//
// /porthole [url] [mobile|desktop] opens the pane; headless Chrome takes the picture
// with a throwaway profile; the terminal draws it as an Image (kitty graphics).
// Bash output that names a local dev server raises a toast, and edits refresh the
// open pane at most once every 2 seconds.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { PortholeImages, PortholeMode, PortholeShot, PortholeView } from '../types'
import {
  chromeArgv,
  fitBox,
  isRemovable,
  isRunDir,
  lastLine,
  MAC_CHROMES,
  PATH_CHROMES,
  runTemplate,
  shotSize,
  tempRoot,
  VIEWPORT_WIDTH,
  WRITTEN,
  type Room,
} from './shot'
import { checkTypedUrl, clean, displayUrl, findLocalAddresses, isLocalHost, parseArgs } from './url'

type Engine = EngineInterface

const PANE = 'porthole'
/** Edits within this window share one refresh, so refreshes are at least this far apart. */
const REFRESH_MS = 2000
/** How long after a new picture to ask whether the terminal really drew it. */
const PROBE_MS = 300
/** Hard stop for a Chrome that never says it wrote the file and never exits. */
const CHROME_DEADLINE_MS = 30_000
/** How a blit refusal reads when the Image is showing its alt text instead of pixels. */
const DRAWS_ALT = /\balt\b|placeholder|cannot read|can't read/i

/**
 * The command origins that are the person typing: Enter at the terminal, or Remote
 * Control. Only these may open a site other than localhost (spec: "unless I pass a
 * full URL myself"). A peer session, channel, notification, schedule, SDK script or
 * another plugin running /porthole gets localhost only.
 */
const PERSON_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge'])
const NOT_TYPED = 'Porthole opens a site other than localhost only when you type /porthole <url> yourself.'

const NO_IMAGES =
  "This terminal cannot draw images here. The desktop app's built-in browser pane can preview the page."

const INITIAL_VIEW: PortholeView = { url: null, mode: 'desktop', phase: 'idle', shot: null, error: null }
const view = atom({ plugin: 'porthole', key: 'view' } as const, INITIAL_VIEW)
const lastSeen = atom({ plugin: 'porthole', key: 'lastSeen' } as const, null)
const toasted = atom({ plugin: 'porthole', key: 'toasted' } as const, [])
const images = atom({ plugin: 'porthole', key: 'images' } as const, 'unknown')

type Outcome = { ok: true; shot: PortholeShot } | { ok: false; error: string }
type ChromeEnd = { kind: 'written' | 'exited' | 'timeout' | 'failed'; detail: string }

// Module memory: lost on a hot reload, which is fine (the engine drops timers then too).
// What the pane draws lives in $.state above, so it survives a reload.
let chromeOption = ''
let chromeFound: string | undefined
let refreshTimer: Timer | null = null
let isScheduling = false
let running: Promise<void> | null = null
let runAgain = false
let room: Room | undefined

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The one line every surface without an Image element draws (desktop, VS Code, mobile). */
function elsewhereLine(url: string | null): string {
  const page = url === null ? 'your page' : clean(url)
  return `Porthole draws its preview in a terminal. In the desktop app, open ${page} in the built-in browser pane instead.`
}

const exists = ($: Engine, path: string): Promise<boolean> => $.fs.exists(path).catch(() => false)

async function hasTerminal($: Engine): Promise<boolean> {
  return (await $.session.surfaces()).includes('terminal')
}

async function onPath($: Engine, names: readonly string[]): Promise<string | undefined> {
  const dirs = ((await $.env.get('PATH')) ?? '').split(':').filter(dir => dir.startsWith('/'))
  for (const name of names) {
    for (const dir of dirs) {
      const path = `${dir.replace(/\/+$/, '')}/${name}`
      if (await exists($, path)) return path
    }
  }
  return undefined
}

/** The chromePath setting when given, else the usual install places. Only a hit is cached. */
async function findChrome($: Engine): Promise<string | undefined> {
  if (chromeFound !== undefined) return chromeFound
  let found: string | undefined
  if (chromeOption !== '') {
    found = chromeOption.includes('/')
      ? (await exists($, chromeOption)) ? chromeOption : undefined
      : await onPath($, [chromeOption])
  } else {
    for (const path of MAC_CHROMES) {
      if (await exists($, path)) {
        found = path
        break
      }
    }
    found ??= await onPath($, PATH_CHROMES)
  }
  chromeFound = found
  return found
}

function chromeMissing(): string {
  return chromeOption === ''
    ? 'No Chrome or Chromium found. Install one, or set the chromePath setting in /config.'
    : `Chrome was not found at "${chromeOption}" (the chromePath setting).`
}

/** rm -rf, but only ever on a run folder (or its profile) under the temp root. */
async function remove($: Engine, path: string): Promise<void> {
  const root = tempRoot(await $.env.get('TMPDIR'))
  if (!isRemovable(path, root)) return
  await $.process.run(['rm', '-rf', path]).catch(() => undefined)
}

/**
 * Runs Chrome and returns as soon as it says the PNG is written. Headless Chrome can
 * stay alive after its screenshot (seen on macOS with Chrome 154), so the stream is
 * closed, which ends the child, rather than waiting for an exit that may not come.
 */
async function runChrome($: Engine, argv: string[]): Promise<ChromeEnd> {
  const child = $.process.spawn({ argv })
  const ended = { code: null, signal: null }
  let expire = (): void => undefined
  const deadline = new Promise<'deadline'>(resolve => {
    expire = () => resolve('deadline')
  })
  const timer = $.clock.after(CHROME_DEADLINE_MS, () => expire())
  let tail = ''
  try {
    for (;;) {
      const pulled = child.next()
      pulled.catch(() => undefined)
      const step = await Promise.race([pulled, deadline])
      if (step === 'deadline') {
        void child.return(ended).catch(() => undefined)
        return { kind: 'timeout', detail: '' }
      }
      if (step.done === true) return { kind: 'exited', detail: lastLine(tail) }
      tail = (tail + step.value.text).slice(-4000)
      if (WRITTEN.test(tail)) {
        await child.return(ended).catch(() => undefined)
        return { kind: 'written', detail: '' }
      }
    }
  } catch (error) {
    return { kind: 'failed', detail: message(error) }
  } finally {
    timer.cancel()
  }
}

/** One screenshot into a fresh run folder; the profile inside it is deleted straight after. */
async function shoot($: Engine, url: string, mode: PortholeMode, seq: number): Promise<Outcome> {
  const chrome = await findChrome($)
  if (chrome === undefined) return { ok: false, error: chromeMissing() }
  const root = tempRoot(await $.env.get('TMPDIR'))
  const made = await $.process.run(['mktemp', '-d', runTemplate(root)])
  const dir = made.stdout.trim()
  if (made.exitCode !== 0 || !isRunDir(dir, root)) {
    return { ok: false, error: `Could not make a temp folder: ${lastLine(made.stderr) || dir}` }
  }
  const size = shotSize(mode, room)
  const ended = await runChrome($, chromeArgv(chrome, { dir, size, url }))
  await remove($, `${dir}/profile`)
  const file = `${dir}/shot.png`
  if (await exists($, file)) {
    return { ok: true, shot: { file, dir, width: size.width, height: size.height, url, mode, seq } }
  }
  await remove($, dir)
  if (ended.kind === 'timeout') return { ok: false, error: 'Chrome did not finish within 30 seconds.' }
  return { ok: false, error: `Chrome did not write a screenshot${ended.detail === '' ? '.' : `: ${ended.detail}`}` }
}

/** After a new picture: one blit of it tells whether the terminal draws pixels or alt text. */
async function probe($: Engine, shot: PortholeShot): Promise<void> {
  if ((await read($, images)) !== 'unknown') return
  if ((await read($, view)).shot?.file !== shot.file) return
  const answer = await $.ui.blit({ requestId: PANE, key: 'shot', source: { file: shot.file, format: 'png' } }).catch(() => undefined)
  if (answer === undefined) return
  if (answer.deny === undefined) {
    await update($, images, (): PortholeImages => 'yes')
  } else {
    $.ui.log(`porthole: blit refused: ${answer.deny}`, { to: 'debug' }) // confirms the regex on a live terminal
  }
  if (answer.deny !== undefined && DRAWS_ALT.test(answer.deny)) {
    let isFirst = false
    await update($, images, (was): PortholeImages => {
      isFirst = was !== 'no'
      return 'no'
    })
    if (isFirst) $.ui.toast(`porthole: ${NO_IMAGES}`, { timeoutMs: 8000 })
  }
}

async function captureOnce($: Engine): Promise<void> {
  const before = await read($, view)
  if (before.url === null || before.phase === 'idle') return
  if (!(await hasTerminal($))) return
  const { url, mode } = before
  await update($, view, (v): PortholeView => ({ ...v, phase: 'loading', error: null }))
  const outcome = await shoot($, url, mode, (before.shot?.seq ?? 0) + 1).catch(
    (error): Outcome => ({ ok: false, error: `Screenshot failed: ${message(error)}` }),
  )
  const now = await read($, view)
  if (now.phase === 'idle' || now.url !== url || now.mode !== mode) {
    // Closed, or the person moved on while Chrome ran: drop this picture.
    if (outcome.ok) await remove($, outcome.shot.dir)
    if (now.phase !== 'idle') runAgain = true
    return
  }
  if (!outcome.ok) {
    await update($, view, (v): PortholeView => ({ ...v, phase: 'error', error: outcome.error }))
    return
  }
  await update($, view, (v): PortholeView => ({ ...v, phase: 'ready', error: null, shot: outcome.shot }))
  if (now.shot !== null && now.shot.dir !== outcome.shot.dir) await remove($, now.shot.dir)
  if ((await read($, images)) === 'unknown') {
    $.clock.after(PROBE_MS, () => void probe($, outcome.shot).catch(() => undefined))
  }
}

/** One capture at a time; a request during a capture runs once more after it. */
function refresh($: Engine): Promise<void> {
  if (running !== null) {
    runAgain = true
    return running
  }
  running = (async () => {
    try {
      do {
        runAgain = false
        await captureOnce($)
      } while (runAgain)
    } finally {
      running = null
    }
  })()
  return running
}

/** After an edit: one refresh REFRESH_MS later, every edit until then riding along. */
async function scheduleRefresh($: Engine): Promise<void> {
  if (refreshTimer !== null || isScheduling) return
  isScheduling = true
  try {
    const current = await read($, view)
    // A local edit cannot change a remote page, so only local pages refresh.
    if (current.url === null || current.phase === 'idle' || !isLocalHost(current.url)) return
    if ((await read($, images)) === 'no') return
    if (!(await $.ui.panes()).some(pane => pane.id === PANE)) return
    refreshTimer = $.clock.after(REFRESH_MS, () => {
      refreshTimer = null
      void refresh($).catch(() => undefined)
    })
  } finally {
    isScheduling = false
  }
}

/** Pane gone: stop refreshing and delete the picture on disk. */
async function shutDown($: Engine): Promise<void> {
  refreshTimer?.cancel()
  refreshTimer = null
  const current = await read($, view)
  await update($, view, (v): PortholeView => ({ ...v, phase: 'idle', shot: null, error: null }))
  if (current.shot !== null) await remove($, current.shot.dir)
}

/** Spots local addresses in Bash output; offers each new one once. */
async function noticeAddresses($: Engine, output: string): Promise<void> {
  const found = findLocalAddresses(output)
  if (found.length === 0) return
  let fresh: string[] = []
  await update($, toasted, list => {
    fresh = found.filter(address => !list.includes(address))
    return fresh.length === 0 ? list : [...list, ...fresh].slice(-50)
  })
  const address = fresh[0] ?? found[0]
  if (address === undefined) return
  await update($, lastSeen, () => address)
  if (fresh[0] === undefined || !(await hasTerminal($))) return
  const current = await read($, view)
  const isShowing =
    current.phase !== 'idle' && current.url !== null && new URL(current.url).origin === new URL(address).origin
  if (!isShowing) $.ui.toast(clean(`Open in porthole: ${address} - type /porthole`), { timeoutMs: 8000 })
}

async function runCommand($: Engine, args: string, isPerson: boolean): Promise<string> {
  const parsed = parseArgs(args)
  if ('error' in parsed) return parsed.error
  const current = await read($, view)
  let url: string | null
  if (parsed.target !== undefined) {
    const verdict = checkTypedUrl(parsed.target)
    if (!verdict.ok) return verdict.reason
    url = verdict.url
  } else if (parsed.mode !== undefined) {
    url = current.url ?? (await read($, lastSeen)) // a viewport switch keeps the page
  } else {
    url = (await read($, lastSeen)) ?? current.url // bare /porthole: the last dev server seen
  }
  if (url !== null && !isPerson && !isLocalHost(url)) return NOT_TYPED
  const mode = parsed.mode ?? current.mode
  const width = VIEWPORT_WIDTH[mode]
  if (url === null) {
    if (parsed.mode === undefined) {
      return 'No dev server address seen yet. Open one with /porthole <url>, for example /porthole http://localhost:3000'
    }
    await update($, view, (v): PortholeView => ({ ...v, mode }))
    return `Viewport set to ${mode} (${width} px wide). Open a page with /porthole <url>.`
  }
  const isTerminal = await hasTerminal($)
  if (isTerminal && (await findChrome($)) === undefined) return chromeMissing()
  const keepsShot = current.url === url && current.mode === mode
  if (!keepsShot && current.shot !== null) await remove($, current.shot.dir)
  await update($, view, (v): PortholeView => ({
    url,
    mode,
    phase: 'loading',
    error: null,
    shot: keepsShot ? v.shot : null,
  }))
  const opened = await $.ui.open({ id: PANE, title: 'Porthole' }).catch(async (error: unknown) => {
    await update($, view, (v): PortholeView => ({ ...v, phase: 'idle' })) // no pane, so nothing to refresh
    throw error
  })
  if (!isTerminal) return elsewhereLine(url)
  void refresh($).catch(() => undefined)
  const waits = opened.isPlaced ? '' : ` The pane is waiting: ${opened.reason}`
  return `Porthole: ${url} at ${width} px (${mode}).${waits}`
}

export const register: Register = (on, options) => {
  chromeOption = typeof options.chromePath === 'string' ? options.chromePath.trim() : ''
  chromeFound = undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'porthole',
      description: 'Preview a local web page in a side pane (headless Chrome screenshot)',
      argumentHint: '[url] [mobile|desktop]',
    })
    return next(e)
  })

  on('command.run', { command: 'porthole' }, async ($, e) => {
    try {
      return { text: clean(await runCommand($, e.args, PERSON_ORIGINS.has(e.origin.kind))) }
    } catch (error) {
      return { text: clean(`porthole: ${message(error)}`) }
    }
  })

  // Dev-server detection. An observer: it never changes or refuses the call.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && typeof ran.text === 'string') {
      await noticeAddresses($, ran.text).catch(() => undefined)
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Auto refresh after Claude edits a file (MultiEdit is matched for builds that have it).
  on('tool.call', { tool: /^(Edit|Write|MultiEdit|NotebookEdit)$/ }, async ($, e, next) => {
    const ran = await next(e)
    const result: unknown = ran.result
    const isStaged = typeof result === 'object' && result !== null && 'staged' in result && result.staged === true
    if (ran.deny === undefined && ran.isError !== true && !isStaged) {
      await scheduleRefresh($).catch(() => undefined)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    await shutDown($).catch(() => undefined)
    return closed
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear') {
      const shot = (await read($, view)).shot
      if (shot !== null) await remove($, shot.dir).catch(() => undefined)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const current = await read($, view)
    if (e.surface !== 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box key="elsewhere">
          <Text>{elsewhereLine(current.url)}</Text>
        </Box>
      )
    }

    const { Box, Button, Image, Text } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const bodyRows = e.props.scroll.bodyRows
    room = { columns, rows: Math.max(1, bodyRows - 1) } // the next shot's shape follows the pane

    if (current.url === null) {
      return (
        <Box key="status">
          <Text dimColor>No page yet. Type /porthole followed by an address.</Text>
        </Box>
      )
    }
    const imageSupport = await read($, images)
    const shot = current.shot
    const status = [
      clean(displayUrl(current.url)),
      `${current.mode} ${VIEWPORT_WIDTH[current.mode]}px`,
      ...(current.phase === 'loading' ? ['refreshing...'] : shot !== null ? [`shot ${shot.seq}`] : []),
    ].join(' - ')
    const extraRows = (imageSupport === 'no' ? 1 : 0) + (current.phase === 'error' ? 1 : 0)
    const box = shot === null ? null : fitBox(shot, { columns, rows: bodyRows - 1 - extraRows })

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Box key="status" flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end" dimColor>
              {status}
            </Text>
          </Box>
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
          <Button
            key="mode"
            label={current.mode === 'desktop' ? 'Mobile' : 'Desktop'}
            onPress={() => toggleMode($)}
          />
        </Box>
        {imageSupport === 'no' && (
          <Box key="no-images">
            <Text color="warning">{NO_IMAGES}</Text>
          </Box>
        )}
        {current.phase === 'error' && current.error !== null && (
          <Box key="error">
            <Text color="error">{clean(current.error)}</Text>
          </Box>
        )}
        {shot === null || box === null ? (
          current.phase === 'loading' && (
            <Box key="loading">
              <Text dimColor>Taking a screenshot of {clean(current.url)} ...</Text>
            </Box>
          )
        ) : (
          <Image
            key="shot"
            source={{ file: shot.file, format: 'png' }}
            columns={box.columns}
            rows={box.rows}
            alt={clean(`Screenshot of ${shot.url}. ${NO_IMAGES}`)}
          />
        )}
      </Box>
    )
  })
}

/** The pane's Mobile/Desktop button: flip the viewport, then shoot again. */
async function toggleMode($: Engine): Promise<void> {
  await update($, view, (v): PortholeView => ({ ...v, mode: v.mode === 'desktop' ? 'mobile' : 'desktop' }))
  await refresh($)
}
