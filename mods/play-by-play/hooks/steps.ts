// Pure step logic: turning a tool call or a before/after pair into a step,
// the turn's scoreboard, and moving through steps. No `$` here.

import type { PlayByPlayKind, PlayByPlayStep, PlayByPlayTurn, PlayByPlayView } from '../types'
import { countHunks, diffLines, hunksText, isBinary, splitLines, toHunks } from './diff'

/** Diff lines kept per step for drawing; counts always cover the whole change. */
export const MAX_STEP_LINES = 400
/** Diff text kept per turn; later steps keep their counts and drop the lines. */
export const MAX_TURN_CHARS = 300_000
/** Steps kept per turn; past it they are counted in `dropped`. */
export const MAX_TURN_STEPS = 500
/** Turns kept for /replay <n>. */
export const MAX_TURNS = 10

/** A step from the text a file had before and after (null: it did not exist). */
export function stepFromTexts(
  file: string,
  before: string | null,
  after: string | null,
  options: { via: 'tool' | 'shell'; kind?: PlayByPlayKind; from?: string; note?: string },
): PlayByPlayStep | null {
  const kind =
    options.kind ?? (before === null ? 'create' : after === null ? 'delete' : 'edit')
  if (isBinary(before ?? '') || isBinary(after ?? '')) {
    // Never diff bytes as lines: they decode to control characters.
    if (before === after) return null
    const bytes = new TextEncoder().encode(after ?? before ?? '').length
    const step = bareStep(file, kind === 'edit' || kind === 'write' ? 'change' : kind, options.via, binaryNote(bytes))
    return options.from !== undefined ? { ...step, from: options.from } : step
  }
  const ops = diffLines(splitLines(before ?? ''), splitLines(after ?? ''))
  const hunks = toHunks(ops)
  // A step that changes nothing (a no-op write, a final newline alone) is
  // only worth keeping when it says something: a rename, or a new empty file.
  if (hunks.length === 0 && kind !== 'rename' && kind !== 'create' && kind !== 'delete') return null
  const { added, removed } = countHunks(hunks)
  const { text, shown, total } = hunksText(hunks, MAX_STEP_LINES)
  const cut = shown < total ? `showing ${shown} of ${total} diff lines` : undefined
  const note = [options.note, cut].filter(Boolean).join('; ') || undefined
  return {
    file,
    ...(options.from !== undefined ? { from: options.from } : {}),
    kind,
    via: options.via,
    added,
    removed,
    hunks: text,
    ...(note ? { note } : {}),
  }
}

/** The note a binary step shows: `binary file changed (1234 bytes)`. */
export function binaryNote(bytes?: number | null): string {
  return bytes === undefined || bytes === null ? 'binary file changed' : `binary file changed (${bytes} bytes)`
}

/** A step with no line detail (binary, or no earlier copy to compare). */
export function bareStep(
  file: string,
  kind: PlayByPlayKind,
  via: 'tool' | 'shell',
  note: string,
  counts: { added?: number; removed?: number } = {},
): PlayByPlayStep {
  return { file, kind, via, added: counts.added ?? 0, removed: counts.removed ?? 0, hunks: '', note }
}

/** Reads a string field off a value of unknown shape. */
export function field(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const found = (value as Record<string, unknown>)[key]
  return typeof found === 'string' ? found : undefined
}

function flag(value: unknown, key: string): boolean {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>)[key] === true
}

/** Replaces `oldString` with `newString` once, or everywhere, as Edit does. */
export function applyEdit(text: string, oldString: string, newString: string, all: boolean): string {
  if (oldString === '') return newString
  if (all) return text.split(oldString).join(newString)
  const at = text.indexOf(oldString)
  return at < 0 ? text : text.slice(0, at) + newString + text.slice(at + oldString.length)
}

/** What an Edit call did, from its record when it has one, else from its input. */
export function editStep(
  file: string,
  input: { old_string: string; new_string: string; replace_all?: boolean },
  result: unknown,
): { step: PlayByPlayStep | null; after?: string } {
  if (flag(result, 'staged')) return { step: null }
  // The record says what was applied, the person's own changes included.
  const oldString = field(result, 'oldString') ?? input.old_string
  const newString = field(result, 'newString') ?? input.new_string
  const all =
    typeof result === 'object' && result !== null && 'replaceAll' in result
      ? flag(result, 'replaceAll')
      : input.replace_all === true
  if (typeof result === 'object' && result !== null && 'originalFile' in result) {
    const original = field(result, 'originalFile')
    if (original === undefined) {
      // originalFile null: Edit made a new file from an empty old_string.
      return { step: stepFromTexts(file, null, newString, { via: 'tool', kind: 'create' }), after: newString }
    }
    const after = applyEdit(original, oldString, newString, all)
    return { step: stepFromTexts(file, original, after, { via: 'tool', kind: 'edit' }), after }
  }
  // No record of the file (a hook above answered for the tool): show the
  // replaced text alone, numbered from 1.
  return {
    step: stepFromTexts(file, oldString, newString, {
      via: 'tool',
      kind: 'edit',
      note: 'line numbers are relative to the edit',
    }),
  }
}

/** What a Write call did. */
export function writeStep(
  file: string,
  input: { content: string },
  result: unknown,
): { step: PlayByPlayStep | null; after?: string } {
  if (flag(result, 'staged')) return { step: null }
  const content = field(result, 'content') ?? input.content
  const type = field(result, 'type')
  const original = field(result, 'originalFile')
  if (type === 'create') {
    return { step: stepFromTexts(file, null, content, { via: 'tool', kind: 'create' }), after: content }
  }
  if (original !== undefined) {
    return { step: stepFromTexts(file, original, content, { via: 'tool', kind: 'write' }), after: content }
  }
  const lines = splitLines(content).length
  return {
    step: bareStep(file, 'write', 'tool', 'rewritten whole; the earlier copy was too large to compare', {
      added: lines,
    }),
    after: content,
  }
}

/** What a NotebookEdit call did to its cell. */
export function cellStep(
  file: string,
  input: { new_source: string; edit_mode?: string; cell_id?: string },
  result: unknown,
): PlayByPlayStep | null {
  if (field(result, 'error')) return null
  const mode = field(result, 'edit_mode') ?? input.edit_mode ?? 'replace'
  const before = mode === 'insert' ? null : (field(result, 'old_source') ?? '')
  const after = mode === 'delete' ? null : (field(result, 'new_source') ?? input.new_source)
  const cell = field(result, 'cell_id') ?? input.cell_id
  const note = `${mode} cell${cell ? ` ${cell}` : ''}`
  return stepFromTexts(file, before, after, { via: 'tool', kind: 'cell', note })
}

/** A path relative to `cwd` when it lies inside it. */
export function relPath(path: string, cwd: string): string {
  const root = cwd.endsWith('/') ? cwd : `${cwd}/`
  return path.startsWith(root) ? path.slice(root.length) : path
}

/** Adds steps to a turn, keeping the per-turn caps. */
export function addSteps(turn: PlayByPlayTurn, steps: readonly PlayByPlayStep[]): PlayByPlayTurn {
  let chars = turn.steps.reduce((sum, step) => sum + step.hunks.length, 0)
  const kept = [...turn.steps]
  let dropped = turn.dropped
  for (const step of steps) {
    if (kept.length >= MAX_TURN_STEPS) {
      dropped++
      continue
    }
    if (chars + step.hunks.length > MAX_TURN_CHARS && step.hunks !== '') {
      const note = [step.note, 'lines dropped: this turn changed too much to keep them all']
        .filter(Boolean)
        .join('; ')
      kept.push({ ...step, hunks: '', note })
      continue
    }
    chars += step.hunks.length
    kept.push(step)
  }
  return { ...turn, steps: kept, dropped }
}

/** The files a turn touched, in order of first change, with that step's index. */
export function jumpList(turn: PlayByPlayTurn): { file: string; step: number }[] {
  const seen = new Map<string, number>()
  turn.steps.forEach((step, index) => {
    if (step.kind !== 'more' && !seen.has(step.file)) seen.set(step.file, index)
  })
  return [...seen].map(([file, step]) => ({ file, step }))
}

export type Score = {
  edits: number
  files: number
  added: number
  removed: number
  /** The file with the most lines changed, ties to the first touched. */
  biggest: { file: string; added: number; removed: number } | null
}

/** The scoreboard for a turn. */
export function score(turn: PlayByPlayTurn): Score {
  const perFile = new Map<string, { added: number; removed: number }>()
  let added = 0
  let removed = 0
  let edits = 0
  for (const step of turn.steps) {
    if (step.kind === 'more') continue
    edits++
    added += step.added
    removed += step.removed
    const total = perFile.get(step.file) ?? { added: 0, removed: 0 }
    perFile.set(step.file, { added: total.added + step.added, removed: total.removed + step.removed })
  }
  let biggest: Score['biggest'] = null
  for (const [file, total] of perFile) {
    if (biggest === null || total.added + total.removed > biggest.added + biggest.removed) {
      biggest = { file, ...total }
    }
  }
  return { edits: edits + turn.dropped, files: perFile.size, added, removed, biggest }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** `+38 −12`, with a real minus sign. */
export function plusMinus(added: number, removed: number): string {
  return `+${added} −${removed}`
}

/** `4 edits · 3 files · +38 −12`. */
export function summaryLine(turn: PlayByPlayTurn): string {
  const { edits, files, added, removed } = score(turn)
  return `${plural(edits, 'edit')} · ${plural(files, 'file')} · ${plusMinus(added, removed)}`
}

/** A movement through a turn's steps. */
export type Nav =
  | { go: 'next' }
  | { go: 'prev' }
  | { go: 'first' }
  | { go: 'last' }
  | { go: 'jump'; file: number }
  | { go: 'close' }

/** The step a movement lands on, kept inside the turn. */
export function navigate(view: PlayByPlayView, nav: Nav, turn: PlayByPlayTurn): PlayByPlayView {
  const last = Math.max(0, turn.steps.length - 1)
  const clamp = (step: number) => Math.min(last, Math.max(0, step))
  switch (nav.go) {
    case 'next':
      return { ...view, step: clamp(view.step + 1) }
    case 'prev':
      return { ...view, step: clamp(view.step - 1) }
    case 'first':
      return { ...view, step: 0 }
    case 'last':
      return { ...view, step: last }
    case 'jump': {
      const target = jumpList(turn)[nav.file - 1]
      return target === undefined ? view : { ...view, step: target.step }
    }
    case 'close':
      return view
  }
}

/** What a key does in the replay pane, or null for a key it ignores. */
export function keyAction(key: string): Nav | null {
  switch (key) {
    case 'right':
    case 'down':
    case 'n':
      return { go: 'next' }
    case 'left':
    case 'up':
    case 'p':
      return { go: 'prev' }
    case 'home':
      return { go: 'first' }
    case 'end':
      return { go: 'last' }
    case 'q':
      return { go: 'close' }
  }
  return /^[1-9]$/.test(key) ? { go: 'jump', file: Number(key) } : null
}

/** Parses `/replay [n]`: which kept turn, 1 being the latest. */
export function parseBack(args: string): number | null {
  const text = args.trim()
  if (text === '') return 1
  if (!/^\d+$/.test(text)) return null
  const back = Number(text)
  return back >= 1 && back <= MAX_TURNS ? back : null
}

/** The first `max` characters of a prompt, on one line. */
export function excerpt(text: string, max = 80): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** `src/a.ts`, `old.ts -> new.ts` for a rename. */
export function stepTitle(step: PlayByPlayStep): string {
  return step.from !== undefined ? `${step.from} -> ${step.file}` : step.file
}
