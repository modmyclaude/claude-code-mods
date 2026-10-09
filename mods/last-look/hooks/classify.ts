// Pure: given a Bash command string, which parts of it can destroy work?
//
// No `$`, no I/O: the hook measures what this finds. The rule of thumb is to
// catch what the spec names in every spelling a model actually writes (flag
// order, sudo and env prefixes, quoted paths, `cd x && ...`, subshells,
// `bash -c`, `$(...)`), and to leave look-alikes alone (`echo "rm -rf"`,
// `grep -r`, a single-file `rm`).

import { literal, parse } from './shell'
import type { Item, Part, RawWord, Redir, Seq } from './shell'

/** A word as the shell would hand it to the program, when that can be known. */
export type Word = {
  text: string
  /** False when it holds an expansion nobody can know ahead (`$X`, `$(...)`). */
  known: boolean
  /** True when unquoted `*`, `?` or `[` make it a pattern the shell expands. */
  glob: boolean
  /** As written in the command. */
  raw: string
  /**
   * A literal path as written: no glob, brace, `$VAR`, `~`, `$(...)` or
   * backticks. Only such paths may be skipped by alwaysAllow, and only they
   * can be reported "not found" with confidence.
   */
  plain: boolean
}

/** One `cd` on the way to where a command runs. */
export type CdStep = {
  dir: Word
  /**
   * True when the command runs even if this `cd` fails (`cd x; rm ...`),
   * so it then runs where the shell already was.
   */
  soft: boolean
}

export type Kind =
  | 'rm'
  | 'find-delete'
  | 'xargs-rm'
  | 'git-clean'
  | 'git-reset-hard'
  | 'git-discard'
  | 'git-push-force'
  | 'git-branch-delete'
  | 'git-worktree-remove'
  | 'redirect'

export type GitInfo =
  /** `forces`: 2 for `-ff`, which also removes nested git repositories. */
  | { sub: 'clean'; flags: string[]; forces: number; excludes: string[]; paths: Word[] }
  | { sub: 'reset'; ref?: Word }
  | {
      sub: 'discard'
      /** `all`: every uncommitted change; `maybe-ref`: `git checkout x`, a branch or a path. */
      mode: 'all' | 'paths' | 'maybe-ref'
      source?: Word
      /** True when the files come back from the index, so staged work survives. */
      fromIndex: boolean
      paths: Word[]
    }
  | { sub: 'push'; remote?: Word; refspecs: Word[]; isWholeRepo: boolean }
  | { sub: 'branch'; names: Word[] }
  | { sub: 'worktree'; paths: Word[] }

export type Finding = {
  kind: Kind
  /** The command's own text, for the person to read. */
  label: string
  /** The `cd`s between the session's directory and where it runs. */
  cd: CdStep[]
  /** What it acts on: rm operands, find start points, the redirect's file. */
  targets: Word[]
  isSudo: boolean
  git?: GitInfo
  /** For find: a read-only argv that lists what it would delete. */
  findListing?: string[]
  /** Why it cannot be measured, when that is plain from the text alone. */
  unknown?: string
  /**
   * The whole command is this one simple command and this redirect is all it
   * does that we see: no `&&`, `||`, `;`, `|`, `&`, newline, subshell,
   * `$(...)` or unquoted here-doc. Only then can "the target does not exist"
   * be judged before anything runs.
   */
  isSole?: boolean
}

export type ClassifyEnv = { home?: string }

/** How deep `$(...)`, `bash -c` and `eval` may nest before we stop looking. */
const MAX_DEPTH = 6

export function classify(command: string, env: ClassifyEnv = {}): Finding[] {
  const out: Finding[] = []
  const seq = parse(command)
  walk(seq, command, [], new Map(), env, out, 0)
  const only = out[0]
  if (out.length === 1 && only?.kind === 'redirect' && isSoleCommand(seq)) only.isSole = true
  return out
}

/** One simple command, nothing before or after it, nothing running inside it. */
function isSoleCommand(seq: Seq): boolean {
  const item = seq[0]
  if (seq.length !== 1 || !item || item.kind !== 'simple' || (item.op !== '' && item.op !== ';')) return false
  const words = [...item.words, ...item.redirs.flatMap(r => (r.target ? [r.target] : []))]
  if (words.some(w => w.parts.some(p => p.t === 'sub'))) return false
  if (item.redirs.some(r => (r.op === '<<' || r.op === '<<-') && !r.isQuotedDoc)) return false
  return item.redirs.filter(r => r.op === '>' || r.op === '>|' || r.op === '&>' || r.op === '>&').length === 1
}

type Vars = Map<string, string | undefined>

function walk(seq: Seq, src: string, cd: CdStep[], vars: Vars, env: ClassifyEnv, out: Finding[], depth: number): CdStep[] {
  let steps = cd
  seq.forEach((item, index) => {
    const before = seq[index - 1]?.op ?? ''
    // A pipeline part and a `&` command run in a subshell: their `cd` stays there.
    const isPiped = item.op === '|' || item.op === '|&' || item.op === '&' || before === '|' || before === '|&'
    if (item.kind === 'group') {
      const after = walk(item.body, src, steps, vars, env, out, depth)
      redirects(item.redirs, item, src, steps, vars, env, out, depth)
      if (!item.subshell && !isPiped) steps = after
      return
    }
    const next = simple(item, src, steps, vars, env, out, depth)
    if (!isPiped) steps = next
  })
  return steps
}

const RESERVED = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'esac', '!', 'time', '{', '}'])
const HEADERS = new Set(['for', 'select', 'case', 'function'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])

/** Classifies one simple command; returns the `cd` steps after it. */
function simple(item: Item & { kind: 'simple' }, src: string, cd: CdStep[], vars: Vars, env: ClassifyEnv, out: Finding[], depth: number): CdStep[] {
  const label = src.slice(item.start, item.end).trim()
  const words = item.words.flatMap(w => resolveAll(w, src, vars, env))
  // Commands inside the words run first, wherever the shell is now.
  for (const w of item.words) subs(w, cd, vars, env, out, depth)
  // Inside `[[ ... ]]` a `>` compares two strings; it writes no file.
  const isTest = words[0]?.known === true && words[0].text === '[['
  if (!isTest) redirects(item.redirs, item, src, cd, vars, env, out, depth)

  let argv = words
  while (argv[0] && RESERVED.has(argv[0].text) && argv[0].known) argv = argv.slice(1)
  // `function f { body }`: the body is a command like any other.
  if (argv[0]?.known && argv[0].text === 'function') {
    argv = argv.slice(2)
    while (argv[0]?.known && (argv[0].text === '{' || argv[0].text === '()')) argv = argv.slice(1)
  }
  const head = argv[0]
  if (!head || !head.known) return cd
  if (HEADERS.has(head.text)) return cd

  // Assignments alone set shell variables; before a command they are its env.
  const firstCommand = argv.findIndex(w => !isAssignment(w))
  if (firstCommand === -1 || ['export', 'local', 'declare', 'readonly', 'typeset'].includes(head.text)) {
    for (const w of argv) {
      if (!isAssignment(w)) continue
      const name = w.raw.slice(0, w.raw.indexOf('='))
      vars.set(name, w.known ? w.text.slice(w.text.indexOf('=') + 1) : undefined)
    }
    return cd
  }
  argv = argv.slice(firstCommand)

  const peeled = peel(argv)
  argv = peeled.argv
  const program = argv[0]
  if (!program || !program.known) return cd
  const name = base(program.text)
  const steps = [...cd, ...peeled.cd]
  const finding = (kind: Kind, rest: Partial<Finding>): void => {
    out.push({ kind, label, cd: steps, targets: [], isSudo: peeled.isSudo, ...rest })
  }

  if (name === 'cd' || name === 'pushd') {
    const operand = argv.slice(1).find(w => !(w.known && /^(-[LPe@]+|--)$/.test(w.text)))
    const dir = operand ?? { text: env.home ?? '', known: env.home !== undefined, glob: false, raw: '~', plain: false }
    if (dir.known && dir.text === '-') return [...cd, { dir: { ...dir, known: false }, soft: false }]
    return [...cd, { dir, soft: item.op !== '&&' }]
  }
  if (name === 'popd') return [...cd, { dir: { text: '', known: false, glob: false, raw: 'popd', plain: false }, soft: false }]

  if (peeled.viaXargs && name === 'rm') {
    finding('xargs-rm', { unknown: 'it deletes whatever the command before it prints' })
    return cd
  }
  if (SHELLS.has(name) && depth < MAX_DEPTH) {
    const script = shellScript(argv)
    if (script?.known) walk(parse(script.text), script.text, steps, new Map(vars), env, out, depth + 1)
    return cd
  }
  if (name === 'eval' && depth < MAX_DEPTH) {
    const text = argv.slice(1).map(w => w.text).join(' ')
    if (argv.slice(1).every(w => w.known)) walk(parse(text), text, steps, new Map(vars), env, out, depth + 1)
    return cd
  }
  if (name === 'rm') {
    const rm = parseRm(argv)
    if (rm.isRecursive && rm.operands.length > 0) finding('rm', { targets: rm.operands })
  } else if (name === 'find') {
    const found = parseFind(argv)
    if (found) finding('find-delete', found)
  } else if (name === 'git') {
    const git = parseGit(argv, peeled.viaXargs)
    if (git) {
      const unknown = peeled.viaXargs ? 'more arguments come from the command before it' : git.finding.unknown
      out.push({ label, cd: [...steps, ...git.cd], targets: [], isSudo: peeled.isSudo, ...git.finding, ...(unknown ? { unknown } : {}) })
    }
  }
  return cd
}

function redirects(redirs: Redir[], item: Item, src: string, cd: CdStep[], vars: Vars, env: ClassifyEnv, out: Finding[], depth: number): void {
  for (const r of redirs) {
    if (!r.target || r.target.parts.length === 0) continue
    subs(r.target, cd, vars, env, out, depth)
    const overwrites = r.op === '>' || r.op === '>|' || r.op === '&>' || r.op === '>&'
    if (!overwrites) continue
    const target = resolve(r.target, src, vars, env)
    if (target.known && (target.text.startsWith('/dev/') || target.text === '')) continue
    out.push({
      kind: 'redirect',
      label: src.slice(item.start, item.end).trim(),
      cd,
      targets: [target],
      isSudo: false,
      ...(target.known ? {} : { unknown: `it writes to ${target.raw}, which is only known when it runs` }),
    })
  }
}

/** Walks the commands a word runs inside it (`$(...)`, backticks). */
function subs(w: RawWord, cd: CdStep[], vars: Vars, env: ClassifyEnv, out: Finding[], depth: number): void {
  if (depth >= MAX_DEPTH) return
  for (const p of w.parts) {
    if (p.t === 'sub') walk(parse(p.src), p.src, cd, new Map(vars), env, out, depth + 1)
  }
}

// ---------------------------------------------------------------- words

function resolve(w: RawWord, src: string, vars: Vars, env: ClassifyEnv): Word {
  let text = ''
  let known = true
  let glob = false
  let plain = true
  w.parts.forEach((p: Part, index) => {
    if (p.t === 'lit') {
      let s = p.s
      if (index === 0 && !p.quoted && s.startsWith('~')) {
        plain = false
        const user = /^~([^/]*)/.exec(s)?.[1] ?? ''
        if (user === '' && env.home !== undefined) s = env.home + s.slice(1)
        else known = false
      }
      if (!p.quoted && /[*?[]/.test(s)) glob = true
      // An unquoted brace may expand (or be refused) by the shell: not a plain path.
      if (!p.quoted && /[{}]/.test(s)) plain = false
      text += s
    } else if (p.t === 'var') {
      plain = false
      const value = vars.has(p.name) ? vars.get(p.name) : p.name === 'HOME' ? env.home : undefined
      // Unquoted, bash splits the value on spaces and globs it: one word no more.
      if (value === undefined || (!p.quoted && /[\s*?[]/.test(value))) known = false
      else text += value
    } else {
      plain = false
      known = false
    }
  })
  return { text, known, glob, raw: src.slice(w.start, w.end), plain: plain && !glob }
}

export function literalWord(text: string): Word {
  return { text, known: true, glob: false, raw: text, plain: true }
}

/** Resolves a word, expanding braces (`{a,b}`, `{1..3}`) the way the shell would first. */
function resolveAll(w: RawWord, src: string, vars: Vars, env: ClassifyEnv): Word[] {
  const only = w.parts.length === 1 ? w.parts[0] : undefined
  // Bash does not brace-expand an assignment (`X={a,b}`), so neither do we.
  const isBraced = only?.t === 'lit' && !only.quoted && /\{[^{}]*(,|\.\.)[^{}]*\}/.test(only.s) && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(only.s)
  if (!isBraced || only?.t !== 'lit') return [resolve(w, src, vars, env)]
  const expanded = braces(only.s)
  const raw = src.slice(w.start, w.end)
  // Past the cap the word is unknown, so it is held, never cut short.
  if (!expanded) return [{ text: only.s, known: false, glob: false, raw, plain: false }]
  return expanded.map(s => ({ ...resolve({ ...w, parts: [{ t: 'lit', s, quoted: false }] }, src, vars, env), plain: false }))
}

/** Most words one brace expression may become, and most nested groups, before it counts as unknown. */
const BRACE_CAP = 256
const BRACE_GROUPS = 8

/**
 * Brace expansion with bounded work: comma lists and `{1..9}` / `{a..e}`
 * ranges, generated one at a time; undefined once past the cap.
 */
export function braces(s: string): string[] | undefined {
  const out: string[] = []
  const expand = (text: string, depth: number): boolean => {
    if (depth > BRACE_GROUPS) return false
    const group = braceGroup(text)
    if (!group) {
      out.push(text)
      return out.length <= BRACE_CAP
    }
    if (group.alternatives === undefined) return false
    for (const alternative of group.alternatives) {
      if (!expand(group.head + alternative + group.tail, depth + 1)) return false
    }
    return true
  }
  return expand(s, 0) ? out : undefined
}

/** The first `{...}` that expands: its alternatives (undefined: too many), and what is around it. */
function braceGroup(s: string): { head: string; tail: string; alternatives: string[] | undefined } | undefined {
  for (let open = s.indexOf('{'); open !== -1; open = s.indexOf('{', open + 1)) {
    let depth = 0
    const commas: number[] = []
    for (let j = open; j < s.length; j++) {
      if (s[j] === '{') depth++
      else if (s[j] === '}') depth--
      else if (s[j] === ',' && depth === 1) commas.push(j)
      if (depth !== 0) continue
      const head = s.slice(0, open)
      const tail = s.slice(j + 1)
      const body = s.slice(open + 1, j)
      if (commas.length > 0) {
        const cuts = [open, ...commas, j]
        return { head, tail, alternatives: cuts.slice(1).map((cut, k) => s.slice((cuts[k] ?? open) + 1, cut)) }
      }
      const range = /^(-?\d+|[a-zA-Z])\.\.(-?\d+|[a-zA-Z])$/.exec(body)
      if (range) return { head, tail, alternatives: sequence(range[1] ?? '', range[2] ?? '') }
      break
    }
  }
  return undefined
}

function sequence(from: string, to: string): string[] | undefined {
  const isNumber = /\d/.test(from)
  if (isNumber !== /\d/.test(to)) return undefined
  const a = isNumber ? Number(from) : from.charCodeAt(0)
  const b = isNumber ? Number(to) : to.charCodeAt(0)
  if (Math.abs(b - a) >= BRACE_CAP) return undefined
  const step = a <= b ? 1 : -1
  const out: string[] = []
  for (let n = a; step > 0 ? n <= b : n >= b; n += step) out.push(isNumber ? String(n) : String.fromCharCode(n))
  return out
}

function isAssignment(w: Word): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(w.raw)
}

export function base(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

// ---------------------------------------------------------------- prefixes

type Peeled = { argv: Word[]; cd: CdStep[]; isSudo: boolean; viaXargs: boolean }

/** Options of each prefix command that take a value of their own. */
const VALUED: Record<string, readonly string[]> = {
  sudo: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-T', '-U', '--user', '--group', '--chdir'],
  doas: ['-u', '-C'],
  env: ['-u', '-C', '-S', '-P', '--unset', '--chdir', '--split-string'],
  nice: ['-n', '--adjustment'],
  ionice: ['-c', '-n', '-p', '-P', '-u', '--class', '--classdata'],
  stdbuf: ['-i', '-o', '-e', '--input', '--output', '--error'],
  timeout: ['-s', '-k', '--signal', '--kill-after'],
  exec: ['-a'],
  xargs: ['-E', '-I', '-L', '-n', '-P', '-s', '-d', '-a', '--arg-file', '--delimiter', '--max-args', '--max-procs', '--max-chars', '--max-lines', '--replace', '--eof'],
}
const PREFIXES = new Set([...Object.keys(VALUED), 'nohup', 'time', 'command', 'builtin', 'chronic', 'caffeinate', 'unbuffer'])

/** Strips `sudo`, `env X=1`, `nohup`, `xargs` and kin down to the real program. */
function peel(words: Word[]): Peeled {
  let argv = words
  const cd: CdStep[] = []
  let isSudo = false
  let viaXargs = false
  for (let guard = 0; guard < 8; guard++) {
    const head = argv[0]
    if (!head?.known) break
    const name = base(head.text)
    if (!PREFIXES.has(name)) break
    if (name === 'command' && argv.slice(1).some(w => w.text === '-v' || w.text === '-V')) return { argv: [], cd, isSudo, viaXargs }
    if (name === 'sudo' || name === 'doas') isSudo = true
    if (name === 'xargs') viaXargs = true
    const valued = VALUED[name] ?? []
    let k = 1
    while (k < argv.length) {
      const w = argv[k]
      if (!w?.known) break
      if (w.text === '--') {
        k++
        break
      }
      if (name === 'env' && isAssignment(w)) {
        k++
        continue
      }
      if (!w.text.startsWith('-') || w.text === '-') break
      const flag = w.text.split('=')[0] ?? ''
      const takesValue = valued.includes(flag) && !w.text.includes('=')
      const value = takesValue ? argv[k + 1] : w.text.includes('=') ? { ...w, text: w.text.slice(w.text.indexOf('=') + 1) } : undefined
      if ((name === 'env' && (flag === '-C' || flag === '--chdir')) || (name === 'sudo' && (flag === '-D' || flag === '--chdir'))) {
        if (value) cd.push({ dir: value, soft: false })
      }
      k += takesValue ? 2 : 1
    }
    // `timeout 10 cmd`: the duration comes before the command.
    if (name === 'timeout' && argv[k]?.known && /^[\d.]+[smhd]?$/.test(argv[k]?.text ?? '')) k++
    argv = argv.slice(k)
    // `sudo FOO=1 rm ...`: variables set for the command, not the command.
    while (argv[0] && isAssignment(argv[0])) argv = argv.slice(1)
  }
  return { argv, cd, isSudo, viaXargs }
}

/** `bash -c 'script'`: the script, or undefined when there is no `-c`. */
function shellScript(argv: Word[]): Word | undefined {
  let hasC = false
  for (let k = 1; k < argv.length; k++) {
    const w = argv[k]
    if (!w) break
    if (w.known && /^-[a-zA-Z]+$/.test(w.text)) {
      if (w.text.includes('c')) hasC = true
      if (w.text === '-o' || w.text === '-O') k++
      continue
    }
    if (w.known && w.text.startsWith('--')) continue
    return hasC ? w : undefined
  }
  return undefined
}

// ---------------------------------------------------------------- rm

export function parseRm(argv: Word[]): { isRecursive: boolean; operands: Word[] } {
  let isRecursive = false
  let isEnd = false
  const operands: Word[] = []
  for (const w of argv.slice(1)) {
    const t = w.text
    if (!isEnd && w.known && t === '--') isEnd = true
    else if (!isEnd && w.known && t.startsWith('--')) {
      // GNU takes any unique prefix of a long option: --rec, --recur.
      if (t.length >= 3 && '--recursive'.startsWith(t)) isRecursive = true
    } else if (!isEnd && w.known && t.startsWith('-') && t.length > 1) {
      if (/[rR]/.test(t)) isRecursive = true
    } else operands.push(w)
  }
  return { isRecursive, operands }
}

// ---------------------------------------------------------------- find

const FIND_LEADING = new Set(['-H', '-L', '-P', '-E', '-X', '-s', '-x', '-d'])
const FIND_VALUED = new Set([
  '-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename', '-regex', '-iregex', '-lname', '-ilname',
  '-type', '-xtype', '-size', '-perm', '-user', '-group', '-uid', '-gid', '-maxdepth', '-mindepth', '-mtime',
  '-atime', '-ctime', '-mmin', '-amin', '-cmin', '-newer', '-anewer', '-cnewer', '-samefile', '-inum', '-links',
  '-fstype', '-used', '-context', '-printf', '-fprint', '-fprint0', '-fls', '-regextype', '-newermt', '-newerct',
  '-newerat', '-newerBt',
])
const FIND_EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir'])
/**
 * Predicates that write files or run commands. Never copied into a measuring
 * command: a find holding one is held unmeasured (GNU find opens -fprint
 * files for writing while it parses, before it runs anything).
 */
export const FIND_WRITES = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls'])
/** Tests whose meaning differs between the system find and the shell's own (bfs, GNU). */
const FIND_UNPORTABLE = new Set(['-regex', '-iregex', '-regextype', '-readable', '-writable', '-executable'])
/** Actions that write or print on their own: a listing re-run would not be clean. */
const FIND_SIDE_EFFECTS = new Set(['-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls', '-delete', '-print', '-print0', '-printf', '-ls'])

export function parseFind(argv: Word[]): Partial<Finding> | undefined {
  const args = argv.slice(1)
  let k = 0
  const leading: string[] = []
  while (k < args.length) {
    const t = args[k]?.text ?? ''
    if (FIND_LEADING.has(t) || /^-O\d$/.test(t)) {
      leading.push(t)
      k++
    } else if (t === '-D' || t === '-f') {
      leading.push(t, args[k + 1]?.text ?? '')
      k += 2
    } else break
  }
  const starts: Word[] = []
  while (k < args.length) {
    const t = args[k]?.text ?? ''
    if (args[k]?.known && (t.startsWith('-') || t === '(' || t === '!' || t === ')' || t === ',')) break
    const w = args[k]
    if (w) starts.push(w)
    k++
  }
  const expr = args.slice(k)

  // Scan the expression, skipping the values of tests that take one.
  let deletes = false
  let usesDelete = false
  const listing: string[] = []
  const isKnown = expr.every(w => w.known) && starts.every(w => w.known && !w.glob)
  let isListable = true
  let isPortable = true
  for (let j = 0; j < expr.length; j++) {
    const t = expr[j]?.text ?? ''
    // Writers first: -fprint takes a value, but must never reach the listing.
    if (t === '-fprint' || t === '-fprint0' || t === '-fprintf' || t === '-fls') {
      isListable = false
      j += t === '-fprintf' ? 2 : 1
      continue
    }
    if (FIND_UNPORTABLE.has(t)) isPortable = false
    if (FIND_VALUED.has(t)) {
      listing.push(t, expr[j + 1]?.text ?? '')
      j++
      continue
    }
    if (t === '-delete') {
      deletes = true
      usesDelete = true
      listing.push('-print0')
      continue
    }
    if (FIND_EXEC.has(t)) {
      let end = j + 1
      while (end < expr.length && expr[end]?.text !== ';' && expr[end]?.text !== '+') end++
      // `-exec sudo rm`, `-exec env rm`: peel the same prefixes as a command line.
      const command = peel(expr.slice(j + 1, end)).argv
      const program = command[0]?.known ? base(command[0].text) : ''
      if (program === 'rm') {
        deletes = true
        listing.push('-print0')
      } else if (SHELLS.has(program) || program === 'eval' || program === 'xargs' || !command[0]?.known) {
        // A shell or a run-time program could delete anything: held unmeasured.
        deletes = true
        isListable = false
      } else {
        isListable = false
      }
      j = end
      continue
    }
    if (FIND_SIDE_EFFECTS.has(t)) isListable = false
    listing.push(t)
  }
  if (!deletes) return undefined
  const from = starts.length > 0 ? starts : [{ text: '.', known: true, glob: false, raw: '.', plain: true }]
  if (!isKnown) return { targets: from, unknown: 'it names paths that are only known when it runs' }
  if (!isListable) return { targets: from, unknown: 'its find expression does more than delete, so it was not re-run to look' }
  if (!isPortable) return { targets: from, unknown: 'it uses a find test the system find reads differently from the shell' }
  // -delete turns on -depth, which also switches -prune off: list the same way.
  return { targets: from, findListing: [...leading, ...from.map(w => w.text), ...(usesDelete ? ['-depth'] : []), ...listing] }
}

// ---------------------------------------------------------------- git

/** Options of a branch switch that cannot discard anything. */
const SWITCH_FLAGS = new Set(['-q', '--quiet', '-t', '--track', '--no-track', '--detach', '--progress', '--no-progress', '--guess', '--no-guess'])

type GitParsed = { cd: CdStep[]; finding: Pick<Finding, 'kind' | 'git' | 'unknown'> }

function shortFlags(t: string): string {
  return /^-[A-Za-z]+$/.test(t) ? t.slice(1) : ''
}

export function parseGit(argv: Word[], viaXargs = false): GitParsed | undefined {
  const cd: CdStep[] = []
  let k = 1
  let unknown: string | undefined
  while (k < argv.length) {
    const w = argv[k]
    if (!w?.known || !w.text.startsWith('-')) break
    if (w.text === '-C') {
      const dir = argv[k + 1]
      if (dir) cd.push({ dir, soft: false })
      k += 2
    } else if (w.text === '-c' || w.text === '--git-dir' || w.text === '--work-tree' || w.text === '--namespace') {
      if (w.text !== '-c') unknown = 'it points git at another repository'
      k += 2
    } else {
      if (w.text.startsWith('--git-dir=') || w.text.startsWith('--work-tree=')) unknown = 'it points git at another repository'
      k++
    }
  }
  const sub = argv[k]
  if (!sub?.known) return undefined
  const rest = argv.slice(k + 1)
  const parsed = gitSub(sub.text, rest, viaXargs)
  if (!parsed) return undefined
  return { cd, finding: unknown ? { ...parsed, unknown } : parsed }
}

function gitSub(sub: string, rest: Word[], viaXargs: boolean): Pick<Finding, 'kind' | 'git'> | undefined {
  const positionals: Word[] = []
  const after: Word[] = []
  let isEnd = false
  const flags: string[] = []
  for (let j = 0; j < rest.length; j++) {
    const w = rest[j]
    if (!w) continue
    if (isEnd) after.push(w)
    else if (w.known && w.text === '--') isEnd = true
    else if (w.known && w.text.startsWith('-') && w.text !== '-') {
      flags.push(w.text)
      // Options whose value is a separate word.
      const valued: Record<string, readonly string[]> = {
        clean: ['-e', '--exclude'],
        checkout: ['-b', '-B', '-c', '-C', '--orphan', '--conflict'],
        restore: ['-s', '--source'],
        push: ['-o', '--push-option', '--repo', '--receive-pack', '--exec'],
        branch: ['-u', '--set-upstream-to', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--format', '--sort'],
      }
      if ((valued[sub] ?? []).includes(w.text)) {
        const value = rest[j + 1]
        if (value) flags.push(value.text)
        j++
      }
    } else positionals.push(w)
  }
  const has = (...names: string[]) => flags.some(f => names.includes(f))
  const hasShort = (ch: string) => flags.some(f => shortFlags(f).includes(ch))

  if (sub === 'clean') {
    const forces = flags.reduce((n, f) => n + (f === '--force' ? 1 : (shortFlags(f).match(/f/g) ?? []).length), 0)
    if (forces === 0 || hasShort('n') || has('--dry-run')) return undefined
    const keep = ['d', 'x', 'X'].filter(hasShort)
    const excludes: string[] = []
    flags.forEach((f, j) => {
      if (f === '-e' || f === '--exclude') excludes.push(flags[j + 1] ?? '')
      else if (f.startsWith('--exclude=')) excludes.push(f.slice('--exclude='.length))
    })
    return { kind: 'git-clean', git: { sub: 'clean', flags: keep, forces, excludes, paths: [...positionals, ...after] } }
  }
  if (sub === 'worktree') {
    // `git worktree remove --force` deletes the worktree folder, uncommitted work and all.
    const [action, ...targets] = [...positionals, ...after]
    if (action?.text !== 'remove' || !(has('--force') || hasShort('f'))) return undefined
    return { kind: 'git-worktree-remove', git: { sub: 'worktree', paths: targets } }
  }
  if (sub === 'reset') {
    if (!has('--hard')) return undefined
    const ref = positionals[0]
    return { kind: 'git-reset-hard', git: ref ? { sub: 'reset', ref } : { sub: 'reset' } }
  }
  if (sub === 'checkout') {
    const isForced = has('-f', '--force')
    if (has('-p', '--patch')) return undefined
    if (!isForced && has('-b', '-B', '-c', '-C', '--orphan')) return undefined
    const discard = (mode: 'all' | 'paths' | 'maybe-ref', paths: Word[], source?: Word): Pick<Finding, 'kind' | 'git'> => ({
      kind: 'git-discard',
      git: { sub: 'discard', mode, paths, fromIndex: source === undefined, ...(source ? { source } : {}) },
    })
    if (isEnd) {
      if (after.length > 0) return discard('paths', after, positionals[0])
      return isForced ? discard('all', []) : undefined
    }
    if (isForced) return discard('all', [])
    const [first, ...others] = positionals
    if (!first || (first.known && first.text === '-')) return undefined
    if (others.length > 0) return discard('paths', others, first)
    // Only a bare `git checkout <plain name>` may turn out to be a branch switch
    // (the measurer asks git). Any other option, or a name that is not a plain
    // token, is taken as paths and held.
    const isBare = flags.every(f => SWITCH_FLAGS.has(f.split('=')[0] ?? ''))
    const isPath = !isBare || !first.plain || first.text === '.' || first.text.startsWith('./') || first.text.startsWith(':/')
    return discard(isPath ? 'paths' : 'maybe-ref', [first])
  }
  if (sub === 'restore') {
    const staged = hasShort('S') || has('--staged')
    const worktree = hasShort('W') || has('--worktree')
    if ((staged && !worktree) || hasShort('p') || has('--patch')) return undefined
    const paths = [...positionals, ...after]
    if (paths.length === 0) return undefined
    const sourceAt = flags.findIndex(f => f === '-s' || f === '--source')
    const sourceText = sourceAt >= 0 ? flags[sourceAt + 1] : flags.find(f => f.startsWith('--source='))?.slice('--source='.length)
    const source = sourceText !== undefined ? literalWord(sourceText) : staged ? literalWord('HEAD') : undefined
    return { kind: 'git-discard', git: { sub: 'discard', mode: 'paths', paths, fromIndex: source === undefined, ...(source ? { source } : {}) } }
  }
  if (sub === 'switch') {
    if (!has('--discard-changes', '-f', '--force')) return undefined
    return { kind: 'git-discard', git: { sub: 'discard', mode: 'all', paths: [], fromIndex: false } }
  }
  if (sub === 'push') {
    const name = (f: string) => f.split('=')[0] ?? ''
    // git takes a unique prefix of a long option: --force-with is the lease.
    const isMirror = flags.some(f => name(f) === '--mirror')
    const isForced = has('--force') || hasShort('f') || isMirror || [...positionals, ...after].slice(1).some(w => w.text.startsWith('+'))
    // A lease guards only a push that is not also forced: `--force` (or -f,
    // a `+refspec`, --mirror) switches the lease off, so it is held.
    if (!isForced || has('--dry-run') || hasShort('n')) return undefined
    const isWholeRepo = isMirror || has('--all', '--branches', '--tags')
    const [remote, ...refspecs] = [...positionals, ...after]
    return { kind: 'git-push-force', git: { sub: 'push', refspecs, isWholeRepo, ...(remote ? { remote } : {}) } }
  }
  if (sub === 'branch') {
    const isDelete = hasShort('d') || hasShort('D') || has('--delete')
    const isForced = hasShort('D') || hasShort('f') || has('--force')
    if (!isDelete || !isForced || hasShort('r') || has('--remotes')) return undefined
    // Names after `--` are names too: `git branch -D -- feature`.
    const names = [...positionals, ...after]
    return names.length > 0 || viaXargs ? { kind: 'git-branch-delete', git: { sub: 'branch', names } } : undefined
  }
  return undefined
}

export { literal }
