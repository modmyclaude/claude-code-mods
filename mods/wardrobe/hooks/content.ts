// Pure readers of tool results: they decide whether wardrobe can draw a result
// itself, and return null whenever it cannot, so the engine draws its own.

export type DiffLine = {
  kind: 'add' | 'remove' | 'context' | 'gap'
  text: string
  /** The line's number in the new file (old file for a removal); null for a gap. */
  no: number | null
}

export type DiffCard = {
  path: string
  verb: 'Updated' | 'Wrote'
  added: number
  removed: number
  userModified: boolean
  lines: DiffLine[]
}

/** Past this many lines, or characters, the engine's own card (which can fold and expand) draws instead. */
export const DIFF_LINE_CAP = 120
export const DIFF_CHAR_CAP = 8000

/** A shell result is drawn by wardrobe only while it is this small. */
export const SHELL_LINE_CAP = 8
export const SHELL_CHAR_CAP = 1500

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Untrusted text (file contents, shell output, paths, typed words) reaches a
// drawn tree only through clean(): the engine refuses a whole tree holding a
// C0 or C1 control character, so one stray byte would cost the drawing.

// ANSI escape sequences, 7-bit and 8-bit: CSI (`ESC [`, U+009B), OSC (`ESC ]`,
// U+009D) up to its terminator, and the two-character escapes (`ESC 7`, `ESC c`).
const ANSI =
  /\u001b\[[0-?]*[ -/]*[@-~]|\u009b[0-?]*[ -/]*[@-~]|(?:\u001b\]|\u009d)[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c)|\u001b[ -/]*[0-~]/g

/** Every C0 control but tab and newline, DEL, and every C1 control (U+0080 to U+009F). */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/

/** Text without its ANSI escape sequences. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

/** Whether text still holds a control character a Text cannot take (tab and newline aside). */
export function hasControl(text: string): boolean {
  return CONTROL.test(text)
}

/** One drawable line: ANSI sequences gone, tabs as spaces, any other control character as U+FFFD. */
export function clean(text: string): string {
  return stripAnsi(text)
    .replace(/\t/g, '  ')
    .replace(/\r/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '�')
}

/**
 * An edit's result (Edit, Write over a file, any tool answering `filePath` and
 * `structuredPatch`) as a diff card; null for anything else or anything odd.
 */
export function diffCard(tool: string, output: unknown): DiffCard | null {
  if (!isRecord(output)) return null
  const { filePath, structuredPatch } = output
  if (typeof filePath !== 'string' || !Array.isArray(structuredPatch) || structuredPatch.length === 0) return null
  if (output.staged === true) return null // held for review: the engine says so in its own words
  const lines: DiffLine[] = []
  let added = 0
  let removed = 0
  for (const [index, hunk] of structuredPatch.entries()) {
    if (!isRecord(hunk) || !Array.isArray(hunk.lines)) return null
    if (typeof hunk.oldStart !== 'number' || typeof hunk.newStart !== 'number') return null
    if (index > 0) lines.push({ kind: 'gap', text: '...', no: null })
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart
    for (const raw of hunk.lines) {
      if (typeof raw !== 'string') return null
      if (raw.includes('\u0000')) return null // binary content: the engine's to draw
      const marker = raw.slice(0, 1)
      const text = clean(raw.slice(1))
      if (marker === '+') {
        lines.push({ kind: 'add', text, no: newNo++ })
        added++
      } else if (marker === '-') {
        lines.push({ kind: 'remove', text, no: oldNo++ })
        removed++
      } else if (marker === ' ' || marker === '') {
        lines.push({ kind: 'context', text, no: newNo++ })
        oldNo++
      } else if (marker !== '\\') {
        return null // not a unified-diff line: leave it to the engine
      }
    }
  }
  if (lines.length > DIFF_LINE_CAP || added + removed === 0) return null
  if (lines.reduce((n, line) => n + line.text.length, 0) > DIFF_CHAR_CAP) return null
  return {
    path: clean(filePath),
    verb: tool === 'Write' ? 'Wrote' : 'Updated',
    added,
    removed,
    userModified: output.userModified === true,
    lines,
  }
}

// The Bash result fields a plain run carries; any other field set means the
// engine has something to say (a background task, a timeout, a saved file).
const PLAIN_SHELL_FIELDS = new Set(['stdout', 'stderr', 'interrupted', 'isImage', 'noOutputExpected', 'dangerouslyDisableSandbox'])

/** A small, plain shell result as lines; null when the engine should draw it. */
export function shellCard(output: unknown): { stdout: string[]; stderr: string[] } | null {
  if (!isRecord(output)) return null
  const { stdout, stderr } = output
  if (typeof stdout !== 'string' || typeof stderr !== 'string') return null
  if (output.interrupted === true || output.isImage === true) return null
  for (const [key, value] of Object.entries(output)) if (value && !PLAIN_SHELL_FIELDS.has(key)) return null
  // Colour codes are dropped (the theme colours the card); anything else that
  // controls the terminal (a carriage return, a bell, NUL, DEL, C1) means the
  // output is not plain text, and the engine draws it.
  const out = stripAnsi(stdout)
  const err = stripAnsi(stderr)
  if (hasControl(out + err)) return null
  if (out.length + err.length > SHELL_CHAR_CAP) return null
  const outLines = splitLines(out)
  const errLines = splitLines(err)
  if (outLines.length + errLines.length > SHELL_LINE_CAP) return null
  return { stdout: outLines.map(clean), stderr: errLines.map(clean) }
}

function splitLines(text: string): string[] {
  const trimmed = text.replace(/\n$/, '')
  return trimmed === '' ? [] : trimmed.split('\n')
}

/** A path shown relative to the project root when it lies under it. */
export function shortPath(path: string, root: string): string {
  const base = root.endsWith('/') ? root : `${root}/`
  return root !== '' && path.startsWith(base) ? path.slice(base.length) : path
}
