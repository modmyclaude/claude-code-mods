// Play-by-Play: records every file change of a turn (file tools and shell
// commands alike) and replays them one step at a time in a pane.
//
// Read-only by design: it never writes, reverts or stages anything. Shell
// changes come from read-only git commands run before and after each Bash
// call; file-tool changes come from the tool's own record.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PlayByPlayStep, PlayByPlayTurn } from '../types'
import { clean } from './diff'
import { shellSteps, snapshot, type Run } from './shell'
import {
  addSteps,
  cellStep,
  editStep,
  excerpt,
  jumpList,
  keyAction,
  MAX_TURNS,
  navigate,
  parseBack,
  plusMinus,
  relPath,
  score,
  stepTitle,
  summaryLine,
  writeStep,
  type Nav,
} from './steps'

const PANE = 'play-by-play'
const TITLE = 'Play-by-Play'
/** Each git call's limit; a slow repository skips the shell step, never the command. */
const GIT_TIMEOUT_MS = 5_000
/** Snapshots slower than this around one command turn shell tracking off for the session. */
const SLOW_MS = 2_000

const current = atom({ plugin: 'play-by-play', key: 'current' } as const, null)
const turns = atom({ plugin: 'play-by-play', key: 'turns' } as const, [])
const hint = atom({ plugin: 'play-by-play', key: 'hint' } as const, false)
const view = atom({ plugin: 'play-by-play', key: 'view' } as const, { back: 1, step: 0 })

type $ = EngineInterface

/** A line for the debug log; logging must never break the hook it reports from. */
function debug($: $, text: string) {
  try {
    $.ui.log(`play-by-play: ${text}`, { to: 'debug' })
  } catch {
    // nothing to do: the log is best effort
  }
}

// The last text a file tool gave each file, so a later shell change to an
// untracked file can still be diffed. Memory only, small, oldest out first.
const known = new Map<string, string>()
function remember(file: string, text: string | undefined) {
  if (text === undefined || text.length > 512_000) return
  known.delete(file)
  known.set(file, text)
  if (known.size > 64) known.delete(known.keys().next().value ?? '')
}

// Which files a file tool changed, by a running count, so a shell snapshot
// that spans a concurrent tool edit does not record that edit twice.
let seq = 0
const toolEdited = new Map<string, number>()

// Set once git proves too slow here, so every later command runs unwatched.
let shellOff = false

/** Turns shell tracking off for the session, saying so once in the transcript. */
function slowGit($: $, spent: number) {
  if (shellOff) return
  shellOff = true
  try {
    $.ui.log(
      `play-by-play: git took ${(spent / 1000).toFixed(1)} s around one command here, so shell changes are not tracked for the rest of this session (file tools still are).`,
    )
  } catch {
    // best effort, as with debug()
  }
}

async function record($: $, steps: readonly PlayByPlayStep[]) {
  if (steps.length === 0) return
  await update($, current, turn =>
    addSteps(turn ?? { id: 'between-turns', prompt: 'changes made between turns', steps: [], dropped: 0 }, steps),
  )
}

/** Moves a finished turn into the kept list and raises the hint. */
async function finishTurn($: $) {
  const taken: { turn: PlayByPlayTurn | null } = { turn: null }
  await update($, current, turn => {
    taken.turn = turn
    return null
  })
  const turn = taken.turn
  if (turn === null || turn.steps.length + turn.dropped === 0) return
  await update($, turns, list => [...list, turn].slice(-MAX_TURNS))
  await update($, hint, () => true)
}

async function go($: $, nav: Nav) {
  if (nav.go === 'close') return $.ui.close({ id: PANE })
  const list = await read($, turns)
  await update($, view, at => {
    const turn = list[list.length - at.back]
    return turn === undefined ? at : navigate(at, nav, turn)
  })
}

/** Opens the pane on a kept turn; the answer is the command's output line. */
async function openReplay($: $, back: number): Promise<string> {
  const list = await read($, turns)
  const turn = list[list.length - back]
  if (turn === undefined) {
    return list.length === 0
      ? 'Nothing to replay yet: no turn has changed files.'
      : `Only ${list.length} turn${list.length === 1 ? '' : 's'} with changes kept; try /replay 1 to ${list.length}.`
  }
  await update($, view, () => ({ back, step: 0 }))
  const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
  const which = back === 1 ? 'the latest turn' : `turn ${back} back`
  if (opened.isPlaced) {
    return `Replaying ${which}: ${summaryLine(turn)}. n/p or the arrows step, 1-9 jump to a file, q closes.`
  }
  // No surface places a pane here (a headless run): list the steps instead.
  const lines = turn.steps.map(
    (step, index) =>
      `${index + 1}. ${stepTitle(step)} (${step.kind}) ${plusMinus(step.added, step.removed)}${step.via === 'shell' ? ' via shell' : ''}`,
  )
  return [`${which}: ${summaryLine(turn)}`, ...lines].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'replay',
        description: 'Step through the file changes of a turn, shell edits included',
        argumentHint: '[n]',
      })
    } catch (error) {
      debug($, `could not register /replay: ${String(error)}`)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // Turn boundaries are the main loop's alone. The types say a subagent's
    // run raises no turn.start; should one carry an agentId anyway, it must
    // not split the person's turn (its edits still land in the main turn).
    if ('agentId' in e && e.agentId !== undefined) return next(e)
    await finishTurn($) // a turn whose end was missed is kept, not lost
    await update($, current, () => ({ id: e.turnId, prompt: excerpt(e.text), steps: [], dropped: 0 }))
    await update($, hint, () => false)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's run ends inside the main turn; only the main loop closes it.
    if (e.agentId === undefined) await finishTurn($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Bash') {
      if (shellOff) return next(e)
      // Snapshot before the command; outside a git repository, or if git
      // fails, the command just runs.
      const run: Run = (argv, init) => $.process.run(argv, { timeoutMs: GIT_TIMEOUT_MS, ...init })
      const startedAt = performance.now()
      const before = await snapshot(run).catch(error => {
        debug($, `no snapshot before Bash: ${String(error)}`)
        return null
      })
      let spent = performance.now() - startedAt
      const mark = seq
      const ran = await next(e)
      // A denied command ran nothing. A failed one may still have changed files.
      if (before === null || ran.deny !== undefined) {
        if (spent > SLOW_MS) slowGit($, spent)
        return ran
      }
      const resumedAt = performance.now()
      try {
        const after = await snapshot(run, before)
        if (after !== null) {
          // Shown relative to the session's folder, as file-tool steps are.
          const display = (path: string) => {
            if (before.prefix === '') return path
            return path.startsWith(before.prefix) ? path.slice(before.prefix.length) : `${before.root}/${path}`
          }
          const steps = await shellSteps(run, before, after, { display, known: file => known.get(file) })
          const editedMeanwhile = (file: string | undefined) =>
            file !== undefined && (toolEdited.get(file) ?? -1) > mark
          await record($, steps.filter(step => !editedMeanwhile(step.file) && !editedMeanwhile(step.from)))
        }
      } catch (error) {
        debug($, `could not read what Bash changed: ${String(error)}`)
      }
      spent += performance.now() - resumedAt
      if (spent > SLOW_MS) slowGit($, spent)
      return ran
    }

    if (e.tool !== 'Edit' && e.tool !== 'Write' && e.tool !== 'NotebookEdit') return next(e)
    const ran = await next(e)
    // Denied, failed or held for review: the file did not change.
    if (ran.deny !== undefined || ran.isError === true) return ran
    try {
      const cwd = await $.session.cwd()
      let step: PlayByPlayStep | null
      let file: string
      if (e.tool === 'Edit') {
        file = relPath(e.file_path, cwd)
        const made = editStep(file, e, ran.result)
        step = made.step
        remember(file, made.after)
      } else if (e.tool === 'Write') {
        file = relPath(e.file_path, cwd)
        const made = writeStep(file, e, ran.result)
        step = made.step
        remember(file, made.after)
      } else {
        file = relPath(e.notebook_path, cwd)
        step = cellStep(file, e, ran.result)
      }
      if (step !== null) {
        toolEdited.set(file, ++seq)
        await record($, [step])
      }
    } catch (error) {
      debug($, `could not record ${e.tool}: ${String(error)}`)
    }
    return ran
  }).catch(($, e, next) => next(e)) // an observer: whatever fails here, the tool runs untouched

  on('command.run', { command: 'replay' }, async ($, e) => {
    const back = parseBack(e.args)
    if (back === null) return { text: `Usage: /replay [n], where n is 1 (the latest turn) to ${MAX_TURNS}.` }
    return { text: await openReplay($, back) }
  })

  // The hint above the prompt after a turn that changed files, drawn above
  // whatever other mods draw in the band (never in place of it).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isWorking || !(await read($, hint))) return next(e)
    const list = await read($, turns)
    const turn = list[list.length - 1]
    if (turn === undefined) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const below = await next(e)
    return (
      <Box flexDirection="column">
        <Box key="play-by-play" flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text>{summaryLine(turn)} {'\u00b7'} press r or /replay</Text>
          <Button key="replay" hotkey="r" label="Replay" onPress={() => void openReplay($, 1)} />
          <Button key="hide" hotkey="x" label="Hide" role="dismiss" dimColor onPress={() => void update($, hint, () => false)} />
        </Box>
        {below}
      </Box>
    )
  })

  // The replay pane.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Code, Text } = $.ui.resolve(e)
    const close = (
      <Button key="close" hotkey="q" label="Close" role="dismiss" onPress={() => void $.ui.close({ id: PANE })} />
    )
    const list = await read($, turns)
    const at = await read($, view)
    const turn = list[list.length - at.back]
    if (turn === undefined || turn.steps.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Nothing to replay yet: no turn has changed files.</Text>
          {close}
        </Box>
      )
    }

    const last = turn.steps.length - 1
    const index = Math.min(Math.max(0, at.step), last)
    const step = turn.steps[index] ?? turn.steps[0]
    if (step === undefined) return close
    const board = score(turn)
    const files = jumpList(turn)
    const width = Math.max(24, e.props.bodyColumns)
    const short = (path: string, max: number) => (path.length > max ? `…${path.slice(-(max - 1))}` : path)

    // Arrow keys reach a Client region; surfaces without one get buttons alone.
    const keys =
      e.surface === 'terminal' || e.surface === 'desktop' ? (
        (() => {
          const { Client } = $.ui.resolve(e)
          return (
            <Client
              key="keys"
              module="./keys.ts"
              props={{ hint: 'Keys: n/p or up/down step, 1-9 jump to a file, q closes; click this line for left/right too' }}
            />
          )
        })()
      ) : (
        <Text dimColor>Arrow keys need the terminal or the desktop app here; use the buttons.</Text>
      )

    const where = list.length > 1 ? `Turn ${at.back} of ${list.length}, newest first` : 'Latest turn'
    const biggest = board.biggest
      ? ` · biggest: ${short(board.biggest.file, Math.floor(width / 2))} ${plusMinus(board.biggest.added, board.biggest.removed)}`
      : ''
    const dropped = turn.dropped > 0 ? ` · ${turn.dropped} more not kept` : ''

    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">
          {where}
          {turn.prompt ? ` · "${clean(turn.prompt)}"` : ''}
        </Text>
        <Text bold wrap="truncate-end">
          {`${board.files} file${board.files === 1 ? '' : 's'} · ${plusMinus(board.added, board.removed)} · ${board.edits} edit${board.edits === 1 ? '' : 's'}${biggest}${dropped}`}
        </Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {files.slice(0, 9).map((entry, i) => (
            <Button
              key={`file-${i + 1}`}
              hotkey={String(i + 1)}
              plain
              label={clean(short(entry.file, Math.max(12, Math.floor(width / 3))))}
              dimColor={entry.file !== step.file}
              onPress={() => void go($, { go: 'jump', file: i + 1 })}
            />
          ))}
          {files.length > 9 ? <Text dimColor>+{files.length - 9} more files</Text> : null}
        </Box>
        <Box flexDirection="row" columnGap={1}>
          <Button key="prev" hotkey="p" label="Prev" dimColor={index === 0} onPress={() => void go($, { go: 'prev' })} />
          <Button
            key="next"
            hotkey="n"
            label="Next"
            variant="primary"
            dimColor={index === last}
            onPress={() => void go($, { go: 'next' })}
          />
          {close}
          <Text>
            Step {index + 1} of {turn.steps.length}
          </Text>
        </Box>
        {keys}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text bold wrap="truncate-start">
            {clean(stepTitle(step))}
          </Text>
          <Text dimColor>
            {step.kind} {'·'} {plusMinus(step.added, step.removed)}
          </Text>
          {step.via === 'shell' ? <Text color="warning">{'·'} via shell</Text> : null}
        </Box>
        {step.note ? <Text dimColor>{clean(step.note)}</Text> : null}
        {step.hunks !== '' ? (
          <Code source={step.hunks} format="diff" path={step.file} />
        ) : (
          <Text dimColor>No line detail for this step.</Text>
        )}
      </Box>
    )
  })

  // Arrow keys while the pane holds the keyboard: an arrow moves the window
  // one row and carries no pointer (the wheel always does). Up and down step
  // through the changes; the wheel and the page keys still scroll a long diff.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person' || e.pointer !== undefined || Math.abs(e.by) !== 1) return next(e)
    await go($, e.by > 0 ? { go: 'next' } : { go: 'prev' })
    return next({ ...e, offset: 0 })
  }).catch(($, e, next) => next(e)) // on failure the window scrolls as usual

  // Keys from the pane's Client line.
  on('ui.message', { requestId: PANE }, async ($, e) => {
    const data = e.data
    const key =
      typeof data === 'object' && data !== null && typeof (data as { key?: unknown }).key === 'string'
        ? (data as { key: string }).key
        : null
    const nav = key === null ? null : keyAction(key)
    if (nav !== null) await go($, nav)
    return {}
  })
}
