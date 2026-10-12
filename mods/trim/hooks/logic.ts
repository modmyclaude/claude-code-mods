// The pure part of trim: when a shell output is long enough to fold, what stays,
// how repeats fold, the footer Claude reads, and the words the person sees.
//
// What stays: the first lines, the last lines, every line that reads like an
// error or a warning, and every line the person's own pattern names. A run of
// lines that differ only in their numbers (a progress bar, a counter) folds to
// one line with a count, and a warning repeated through the output is kept once
// with how many times it came. stderr is never touched: it is not in here.

/** Lines always kept from the top and the bottom. */
export const HEAD = 15
export const TAIL = 40
/** A line kept longer than this is cut in its middle (a minified file, a huge JSON line). */
export const MAX_LINE = 2_000
/** Error-like lines kept from the middle, at most; the rest fold with a count. */
export const MAX_MIDDLE = 150
/** A run of this many like lines or more folds to one. */
export const RUN = 4
/** Folding has to save at least this share of the output to be worth a footer. */
export const MIN_SAVING = 0.25
/** Characters per token, for an estimate that always says "about". */
export const CHARS_PER_TOKEN = 4

export type Settings = {
  /** Fold only past this many lines, or `chars` characters. */
  lines: number
  chars: number
  /** Lines matching this are always kept; undefined when unset or not a valid pattern. */
  keep: RegExp | undefined
}

export const DEFAULTS: Settings = { lines: 120, chars: 6_000, keep: undefined }

/**
 * What marks a line worth keeping wherever it is: error, failure and warning words, and the marks
 * test runners print on a failed test (Jest's ✕ and ● headers, Vitest's ×, others' ✗ and ✘), which a
 * passing exit code (a pipe into tee, `|| true`) would otherwise fold away.
 */
export const ERROR_LINE =
  /\b(?:err(?:or)?s?|fail(?:s|ed|ure|ures|ing)?|exception|traceback|warn(?:ing|ings)?|panic(?:ked)?|fatal|denied|refused|not found|cannot|can't|unable to|abort(?:ed)?|segmentation fault)\b|ERR!|[✗✘✕×●]/i

export type Trimmed = {
  /** What Claude reads in place of stdout, footer included. */
  text: string
  linesIn: number
  /** Lines not shown as themselves: dropped, or folded into a like line's count. */
  folded: number
  charsIn: number
  /** Characters saved, footer counted against it. */
  saved: number
}

/** The person's settings, each clamped to a sane range; a pattern that does not compile is left out. */
export function readSettings(options: Record<string, unknown>): Settings {
  const num = (v: unknown, fallback: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback
  let keep: RegExp | undefined
  const raw = options.keep
  if (typeof raw === 'string' && raw.trim() !== '' && raw.length <= 500) {
    try {
      keep = new RegExp(raw, 'i')
    } catch {
      keep = undefined
    }
  }
  return { lines: num(options.lines, DEFAULTS.lines, 40, 100_000), chars: num(options.chars, DEFAULTS.chars, 1_000, 10_000_000), keep }
}

/**
 * A line with its percentages and counters made alike, so `42%` and `43%` (or `12/300` and
 * `13/300`) read as the same line. Other numbers stay: `line 1` and `line 2` are two lines.
 */
export function likeness(line: string): string {
  return line
    .replace(/\d+(?:[.,]\d+)?\s*%/g, '#%')
    .replace(/\d+\s*\/\s*\d+/g, '#/#')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A kept line too long to read whole: its head and tail, with how much was cut. */
export function clip(line: string): string {
  if (line.length <= MAX_LINE) return line
  const head = 1_400
  const tail = 500
  return `${line.slice(0, head)} [... ${grouped(line.length - head - tail)} characters folded ...] ${line.slice(-tail)}`
}

/** 12345 as "12,345". */
export function grouped(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** A rough token count from characters, rounded so it never reads as exact: "about 11,000". */
export function aboutTokens(chars: number): string {
  const tokens = chars / CHARS_PER_TOKEN
  if (tokens < 1_000) return `about ${grouped(Math.max(10, Math.round(tokens / 10) * 10))}`
  return `about ${grouped(Math.round(tokens / 100) * 100)}`
}

/** The short form for tight places: "~11k", "~800". */
export function shortTokens(chars: number): string {
  const tokens = chars / CHARS_PER_TOKEN
  if (tokens >= 1_000) return `~${tokens >= 10_000 ? Math.round(tokens / 1_000) : Math.round(tokens / 100) / 10}k`
  return `~${Math.max(10, Math.round(tokens / 10) * 10)}`
}

/**
 * The line Claude reads last, so it never takes the folded output for the whole of it. A re-run is
 * offered only for a command that is safe to repeat: an install, a migration or a deploy must not
 * run twice to read its log, and the person can see the whole output under the call.
 */
export function footer(folded: number, linesIn: number, saved: number): string {
  return (
    `[trim: ${grouped(folded)} of ${grouped(linesIn)} lines folded, ${aboutTokens(saved)} tokens saved. ` +
    'The folded lines were not sent. If the command only reads (a test run, a build, a listing), run it again ' +
    'through grep, sed -n or tail to read a part; never repeat one that changes anything (an install, a migration, ' +
    'a deploy): ask the person, who can see the whole output.]'
  )
}

/**
 * Folds `stdout` when it is past the line or character limit, else null (left
 * as it is). Also null when folding would save too little to be worth it.
 */
export function trimOutput(stdout: string, settings: Settings): Trimmed | null {
  const endsWithNewline = stdout.endsWith('\n')
  const lines = (endsWithNewline ? stdout.slice(0, -1) : stdout).split('\n')
  const n = lines.length
  if (n <= settings.lines && stdout.length <= settings.chars) return null

  const isKept = (line: string, i: number) =>
    i < HEAD || i >= n - TAIL || ERROR_LINE.test(line.slice(0, MAX_LINE)) || (settings.keep?.test(line.slice(0, MAX_LINE)) ?? false)

  // The middle's error-like lines, each kept once with how often it came word for word (never by
  // likeness: two errors at different line numbers are two errors); past MAX_MIDDLE they fold.
  const seen = new Map<string, number>()
  for (let i = HEAD; i < n - TAIL; i++) {
    const line = lines[i]!
    if (isKept(line, i)) seen.set(line, (seen.get(line) ?? 0) + 1)
  }

  const out: string[] = []
  let run = 0 // folded lines since the last kept one
  let middleKept = 0
  const emitted = new Set<string>()
  const flush = () => {
    if (run > 0) out.push(`[... ${grouped(run)} line${run === 1 ? '' : 's'} folded ...]`)
    run = 0
  }
  for (let i = 0; i < n; i++) {
    const line = lines[i]!
    const isMiddle = i >= HEAD && i < n - TAIL
    if (!isKept(line, i)) {
      run++
      continue
    }
    if (isMiddle) {
      if (emitted.has(line) || middleKept >= MAX_MIDDLE) {
        run++
        continue
      }
      emitted.add(line)
      middleKept++
      flush()
      const times = seen.get(line) ?? 1
      out.push(times > 1 ? `${clip(line)} [${grouped(times)} times]` : clip(line))
      continue
    }
    flush()
    out.push(clip(line))
  }
  flush()

  const body = foldRuns(out)
  const draft = body.join('\n')
  // Every original line not shown as itself is folded: a marker stands for many, a run's line for one.
  const shown = body.filter(line => !isMarker(line)).length
  const charsIn = stdout.length
  const withFooter = (saved: number) => `${draft}\n${footer(n - shown, n, saved)}${endsWithNewline ? '\n' : ''}`
  // The footer counts against the saving: word it with the figure before it, then measure what stands.
  const text = withFooter(charsIn - withFooter(charsIn - draft.length).length)
  const saved = charsIn - text.length
  if (saved < Math.max(1_000, charsIn * MIN_SAVING)) return null
  return { text, linesIn: n, folded: n - shown, charsIn, saved }
}

/** The line that stands for a run of folded lines. */
export function isMarker(line: string): boolean {
  return /^\[\.\.\. [\d,]+ lines? folded \.\.\.\]$/.test(line)
}

/**
 * A run of RUN or more like lines (a progress bar, a counter) becomes its first line with a count.
 * Error-like lines never fold this way: each keeps its own file and line number.
 */
export function foldRuns(lines: readonly string[]): string[] {
  const out: string[] = []
  const isFoldable = (line: string) => !isMarker(line) && !ERROR_LINE.test(line.slice(0, MAX_LINE))
  for (let i = 0; i < lines.length; ) {
    const like = likeness(lines[i]!)
    let j = i + 1
    while (j < lines.length && likeness(lines[j]!) === like && isFoldable(lines[j]!)) j++
    const count = j - i
    if (count >= RUN && isFoldable(lines[i]!)) out.push(`${lines[i]} [and ${grouped(count - 1)} more like it]`)
    else out.push(...lines.slice(i, j))
    i = j
  }
  return out
}

/** One line for a drawing: whitespace runs as one space, at most `max` characters. */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** Control characters and escape sequences out of anything drawn: shell output is full of them. */
export function clean(text: string): string {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\t/g, '  ')
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '�')
}

/** The savings line under a trimmed row. */
export function rowLine(call: { folded: number; saved: number }): string {
  return `trim: ${grouped(call.folded)} lines folded · ${shortTokens(call.saved)} tokens saved`
}

/** The status line once anything was saved this session. */
export function statusLine(saved: number): string {
  return `trim ${shortTokens(saved)} saved`
}
