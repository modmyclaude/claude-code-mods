// Pure text work: a line diff, unified hunks, and a reader for `git diff` output.
// Nothing here touches `$`, so every function is unit-tested on its own.

/** One line of an edit script: kept (' '), removed ('-') or added ('+'). */
export type Op = { type: ' ' | '-' | '+'; text: string }

/** One unified-diff hunk; `lines` carry their ' ', '-', '+' or '\' prefix. */
export type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

/** Above this many LCS cells the changed middle is shown as one block. */
const MAX_CELLS = 4_000_000

/** A text as lines; a final newline does not make an empty last line. */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * The shortest edit script from `a` to `b` by longest common subsequence.
 * Common head and tail are trimmed first (most edits are local), and a middle
 * too large to compare is reported as removed-then-added: counts stay exact
 * for that block, only the pairing is coarser.
 */
export function diffLines(a: readonly string[], b: readonly string[], maxCells = MAX_CELLS): Op[] {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++
  }
  const ops: Op[] = a.slice(0, head).map(text => ({ type: ' ', text }))
  const x = a.slice(head, a.length - tail)
  const y = b.slice(head, b.length - tail)
  const n = x.length
  const m = y.length

  if (n === 0 || m === 0 || (n + 1) * (m + 1) > maxCells) {
    for (const text of x) ops.push({ type: '-', text })
    for (const text of y) ops.push({ type: '+', text })
  } else {
    // dp[i][j] = LCS length of x[i..] and y[j..]; Uint16 holds it since min(n, m) < 2000 here.
    const w = m + 1
    const dp = new Uint16Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] =
          x[i] === y[j]
            ? (dp[(i + 1) * w + j + 1] ?? 0) + 1
            : Math.max(dp[(i + 1) * w + j] ?? 0, dp[i * w + j + 1] ?? 0)
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (x[i] === y[j]) {
        ops.push({ type: ' ', text: x[i] ?? '' })
        i++
        j++
      } else if ((dp[(i + 1) * w + j] ?? 0) >= (dp[i * w + j + 1] ?? 0)) {
        ops.push({ type: '-', text: x[i] ?? '' })
        i++
      } else {
        ops.push({ type: '+', text: y[j] ?? '' })
        j++
      }
    }
    for (; i < n; i++) ops.push({ type: '-', text: x[i] ?? '' })
    for (; j < m; j++) ops.push({ type: '+', text: y[j] ?? '' })
  }
  for (const text of a.slice(a.length - tail)) ops.push({ type: ' ', text })
  return ops
}

/** Groups an edit script into hunks with `context` kept lines around each change. */
export function toHunks(ops: readonly Op[], context = 3): Hunk[] {
  const hunks: Hunk[] = []
  const changed = ops.flatMap((op, index) => (op.type === ' ' ? [] : [index]))
  if (changed.length === 0) return hunks

  // Old and new line counts consumed before each op, for the @@ numbers.
  const oldBefore: number[] = []
  const newBefore: number[] = []
  let o = 0
  let n = 0
  for (const op of ops) {
    oldBefore.push(o)
    newBefore.push(n)
    if (op.type !== '+') o++
    if (op.type !== '-') n++
  }

  let k = 0
  while (k < changed.length) {
    const first = changed[k] ?? 0
    let last = first
    // Merge changes whose context windows touch.
    while (k + 1 < changed.length && (changed[k + 1] ?? 0) - last <= context * 2 + 1) {
      k++
      last = changed[k] ?? last
    }
    k++
    const from = Math.max(0, first - context)
    const to = Math.min(ops.length - 1, last + context)
    const slice = ops.slice(from, to + 1)
    const oldLines = slice.filter(op => op.type !== '+').length
    const newLines = slice.filter(op => op.type !== '-').length
    const oldAt = oldBefore[from] ?? 0
    const newAt = newBefore[from] ?? 0
    hunks.push({
      // Unified diff numbers an empty side by the line before it.
      oldStart: oldLines > 0 ? oldAt + 1 : oldAt,
      oldLines,
      newStart: newLines > 0 ? newAt + 1 : newAt,
      newLines,
      lines: slice.map(op => op.type + op.text),
    })
  }
  return hunks
}

/** Lines added and removed across hunks. */
export function countHunks(hunks: readonly Hunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added++
      else if (line.startsWith('-')) removed++
    }
  }
  return { added, removed }
}

/**
 * The hunks as unified-diff text, at most `maxLines` diff lines. Whole hunks
 * are kept while they fit; a first hunk too long alone is cut and its header
 * recounted, so the text always parses as hunks.
 */
export function hunksText(
  hunks: readonly Hunk[],
  maxLines = Infinity,
): { text: string; shown: number; total: number } {
  const total = hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0)
  const parts: string[] = []
  let shown = 0
  for (const hunk of hunks) {
    if (shown + hunk.lines.length <= maxLines) {
      parts.push(header(hunk), ...hunk.lines)
      shown += hunk.lines.length
      continue
    }
    if (shown === 0) {
      const lines = hunk.lines.slice(0, Math.max(1, maxLines))
      const cut = {
        ...hunk,
        oldLines: lines.filter(line => line[0] === ' ' || line[0] === '-').length,
        newLines: lines.filter(line => line[0] === ' ' || line[0] === '+').length,
        lines,
      }
      parts.push(header(cut), ...lines)
      shown = lines.length
    }
    break
  }
  return { text: parts.map(clean).join('\n'), shown, total }
}

function header(hunk: Hunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
}

/**
 * Text safe to draw: a surface takes tab and newline as its only control
 * characters, so a line's trailing CR goes and any other becomes U+FFFD.
 */
export function clean(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\r$/, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '�')
}

/** One file's section of `git diff` output. */
export type FileDiff = {
  /** Path before the change; null for an added file. */
  oldPath: string | null
  /** Path after the change; null for a deleted file. */
  newPath: string | null
  binary: boolean
  hunks: Hunk[]
  /** The section's text, to tell a changed section from an unchanged one. */
  raw: string
}

/**
 * Reads `git diff` output run with `--src-prefix=a/ --dst-prefix=b/`. Hunk
 * bodies are consumed by their @@ counts, so a content line can never be
 * mistaken for a header.
 */
export function parseGitDiff(text: string): FileDiff[] {
  const files: FileDiff[] = []
  const lines = splitLines(text)
  let file: (FileDiff & { rawLines: string[]; gitHeader: string }) | null = null
  let hunk: Hunk | null = null
  let oldLeft = 0
  let newLeft = 0

  const finish = () => {
    if (file === null) return
    if (file.oldPath === null && file.newPath === null) {
      // No ---/+++ or rename lines (a mode change, an empty new file): the
      // header names the same path twice, `a/<p> b/<p>`.
      const rest = file.gitHeader
      const path = unquote(rest.slice(2, 2 + Math.max(0, (rest.length - 5) / 2)))
      file.oldPath = file.rawLines.some(line => line.startsWith('new file mode')) ? null : path
      file.newPath = file.rawLines.some(line => line.startsWith('deleted file mode')) ? null : path
    }
    const { rawLines, gitHeader, ...section } = file
    files.push({ ...section, raw: rawLines.join('\n') })
    file = null
  }

  for (const line of lines) {
    if (hunk !== null && (oldLeft > 0 || newLeft > 0)) {
      hunk.lines.push(line)
      file?.rawLines.push(line)
      if (line.startsWith(' ')) {
        oldLeft--
        newLeft--
      } else if (line.startsWith('-')) oldLeft--
      else if (line.startsWith('+')) newLeft--
      else if (line === '') {
        // Some tools strip the space of an empty context line.
        hunk.lines[hunk.lines.length - 1] = ' '
        oldLeft--
        newLeft--
      }
      continue
    }
    if (line.startsWith('\\') && hunk !== null) {
      hunk.lines.push(line)
      file?.rawLines.push(line)
      continue
    }
    if (line.startsWith('diff --git ')) {
      finish()
      hunk = null
      file = {
        oldPath: null,
        newPath: null,
        binary: false,
        hunks: [],
        raw: '',
        rawLines: [line],
        gitHeader: line.slice('diff --git '.length),
      }
      continue
    }
    if (file === null) continue
    file.rawLines.push(line)
    const at = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (at) {
      hunk = {
        oldStart: Number(at[1]),
        oldLines: at[2] === undefined ? 1 : Number(at[2]),
        newStart: Number(at[3]),
        newLines: at[4] === undefined ? 1 : Number(at[4]),
        lines: [],
      }
      oldLeft = hunk.oldLines
      newLeft = hunk.newLines
      file.hunks.push(hunk)
    } else if (line.startsWith('rename from ')) file.oldPath = unquote(line.slice(12))
    else if (line.startsWith('rename to ')) file.newPath = unquote(line.slice(10))
    else if (line.startsWith('--- ')) file.oldPath = sidePath(line.slice(4), 'a/')
    else if (line.startsWith('+++ ')) file.newPath = sidePath(line.slice(4), 'b/')
    else if (line.startsWith('Binary files ')) {
      file.binary = true
      const names = /^Binary files (.+) and (.+) differ$/.exec(line)
      if (names) {
        file.oldPath = sidePath(names[1] ?? '', 'a/')
        file.newPath = sidePath(names[2] ?? '', 'b/')
      }
    }
  }
  finish()
  return files
}

/** A `---`/`+++` path: /dev/null is none; the prefix and git's trailing tab go. */
function sidePath(spec: string, prefix: string): string | null {
  const path = unquote(spec.replace(/\t$/, ''))
  if (path === '/dev/null') return null
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

/** Undoes git's C-style quoting of an unusual path (`"a/we\tird"`). */
export function unquote(spec: string): string {
  if (!(spec.length >= 2 && spec.startsWith('"') && spec.endsWith('"'))) return spec
  const body = spec.slice(1, -1)
  const bytes: number[] = []
  const encoder = new TextEncoder()
  const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', a: '\x07', b: '\b', f: '\f', v: '\v' }
  for (let i = 0; i < body.length; i++) {
    const char = body[i] ?? ''
    if (char !== '\\') {
      bytes.push(...encoder.encode(char))
      continue
    }
    const next = body[i + 1] ?? ''
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1))
    if (octal) {
      bytes.push(parseInt(octal[0], 8))
      i += 3
    } else {
      bytes.push(...encoder.encode(simple[next] ?? next))
      i += 1
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/**
 * Applies hunks made against `base` and returns the result. Exact bytes
 * matter only for hashing, so a final newline is tracked from the
 * `\ No newline at end of file` markers.
 */
export function applyHunks(base: string, hunks: readonly Hunk[]): string {
  const from = splitLines(base)
  const out: string[] = []
  let at = 0
  let endsWithNewline = base === '' || base.endsWith('\n')
  for (const hunk of hunks) {
    const start = Math.max(0, hunk.oldLines > 0 ? hunk.oldStart - 1 : hunk.oldStart)
    while (at < start && at < from.length) out.push(from[at++] ?? '')
    let previous = ' '
    for (const line of hunk.lines) {
      const mark = line[0] ?? ' '
      if (mark === '\\') {
        // The marker speaks for the line before it: a new-side line means the
        // result ends without a newline; an old-side one that it now has one.
        endsWithNewline = previous === '-'
        continue
      }
      previous = mark
      if (mark === '+') out.push(line.slice(1))
      else if (mark === '-') at++
      else {
        out.push(line.slice(1))
        at++
      }
    }
  }
  while (at < from.length) out.push(from[at++] ?? '')
  if (out.length === 0) return ''
  return out.join('\n') + (endsWithNewline ? '\n' : '')
}
