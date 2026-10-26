#!/usr/bin/env node
// check-community: the six community checks on a mod someone else published, without loading or
// running it.
//
//   node scripts/check-community.mjs <git url | owner/repo | local folder> [--mod <subfolder>] [--ref <branch, tag or full commit>] [--readme <file in the repo>] [--test] [--directory] [--json] [--keep]
//
// The repository is cloned shallowly into a temporary folder (hooks, submodules and symlinks off; a
// local folder is read in place), every plugin folder in it (one holding .claude-plugin/plugin.json)
// is found, folders under docs, tests or fixtures are skipped (name one with --mod to check it), and
// each is set against the six checks of COMMUNITY.md:
//   1 says what it touches     the reach the validator reports (files, network, processes,
//                              environment, model calls, prompts it sends, messages to other
//                              sessions, settings, sounds), the gates it holds, each program its
//                              source runs and each host its source names, against the README
//   2 network and model calls  network calls, hosts, network through a program (gh, curl, git push,
//                              ...) and model calls, each in the README, a network call on the
//                              README's first screen (40 lines), a model call with its rough cost
//   3 secret-shaped strings    check-directory's SECRET rule: a finding in source, a note in tests
//   4 tests present            test files the kit can load (none importing node:test, vitest, ...);
//                              --test runs them through the engine CLAUDE_BIN names
//   5 installs and removes     by hand; the record says so
//   6 licence                  an open-source licence file or SPDX field
//   also                       the validator passes, a one-line description, a commit within 90
//                              days, no submodule and no link that leaves the repository, no
//                              hidden text (bidi or zero-width characters) outside a regex class
// The plugin directory's other source rules (names, events, sizes, .gitattributes, ...) bind a
// directory submission and not a community listing, so they are counted as notes; --directory
// lists them and counts the blocking ones as findings.
// The README judged is the plugin folder's; a collection's mod with none is judged by docs/<mod>.md,
// docs/mods.md or the repository README, narrowed to the section whose heading names the mod when
// there is one; --readme names the file to use instead.
// Nothing here loads the mod. --test runs its tests through the engine CLAUDE_BIN names, so cage
// that engine for a stranger's code. Exit 0: pass. Exit 1: findings. Exit 2: the check itself could
// not run. CLAUDE_BIN names the Claude Code binary (2.1.287 or newer); otherwise `claude` on PATH.

import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CC = process.env.CLAUDE_BIN || 'claude'
const MIN_ENGINE = '2.1.287'
const USAGE = 'usage: node scripts/check-community.mjs <git url | owner/repo | local folder> [--mod <subfolder>] [--ref <branch, tag or full commit>] [--readme <file in the repo>] [--test] [--directory] [--json] [--keep]'
const FIRST_SCREEN_LINES = 40
const FRESH_DAYS = 90

const args = process.argv.slice(2)
const takeFlag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true }
const takeValue = name => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v }
const asJson = takeFlag('--json')
const keep = takeFlag('--keep')
const runTests = takeFlag('--test')
const withDirectory = takeFlag('--directory')
const only = takeValue('--mod')
const ref = takeValue('--ref')
const readmeGiven = takeValue('--readme')
const source = args[0]
if (!source || args.length !== 1) stop(USAGE)

function stop(message) {
  console.error(`check-community: ${message}`)
  process.exit(2)
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const uniq = xs => [...new Set(xs)]

// ---------- the source ----------

function engineVersion() {
  const r = spawnSync(CC, ['--version'], { encoding: 'utf8' })
  return /(\d+\.\d+\.\d+)/.exec(r.stdout || '')?.[1] ?? null
}

function olderThan(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]
  return false
}

// git with no hooks, no symlinks, no submodules, no prompts and no local transports.
const GIT_SAFE = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.symlinks=false', '-c', 'transfer.fsckObjects=true', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always', '-c', 'protocol.http.allow=always']
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes', GIT_LFS_SKIP_SMUDGE: '1' }

function fetchSource(src) {
  if (existsSync(src) && statSync(src).isDirectory()) return { root: resolve(src), url: null, temp: null }
  const url = /^[\w.-]+\/[\w.-]+$/.test(src) ? `https://github.com/${src}` : src
  if (ref && /^[0-9a-f]{7,39}$/i.test(ref)) stop(`--ref ${ref} looks like a commit: give its full 40-character sha, or a branch or tag`)
  const temp = mkdtempSync(join(tmpdir(), 'check-community-'))
  const root = join(temp, 'repo')
  const opts = { encoding: 'utf8', timeout: 180_000, env: GIT_ENV }
  const fail = r => { rmSync(temp, { recursive: true, force: true }); stop(`could not clone ${url}: ${(r.stderr || '').trim().split('\n').pop() || 'git failed'}`) }
  if (ref && /^[0-9a-f]{40}$/i.test(ref)) {
    let r = spawnSync('git', [...GIT_SAFE, 'init', '--quiet', root], opts); if (r.status !== 0) fail(r)
    r = spawnSync('git', [...GIT_SAFE, '-C', root, 'fetch', '--depth', '1', '--quiet', '--', url, ref], opts); if (r.status !== 0) fail(r)
    r = spawnSync('git', [...GIT_SAFE, '-C', root, 'checkout', '--quiet', 'FETCH_HEAD'], opts); if (r.status !== 0) fail(r)
  } else {
    const r = spawnSync('git', [...GIT_SAFE, 'clone', '--depth', '1', '--quiet', '--no-recurse-submodules', ...(ref ? ['--branch', ref] : []), '--', url, root], opts)
    if (r.status !== 0) fail(r)
  }
  return { root, url, temp }
}

function git(root, ...a) {
  const r = spawnSync('git', ['-C', root, ...a], { encoding: 'utf8', env: GIT_ENV })
  return r.status === 0 ? r.stdout : null
}

// A folder under one of these is a doc, a test or a fixture, not the mod.
const FIXTURE_SEGMENT = /^(docs?|tests?|__tests__|test-?fixtures?|fixtures?|__fixtures__|__mocks__|mocks?|specs?|probes?|examples?|samples?|scratch|tmp|dist|build|out|coverage|\.github)$/i
const TEST_PATH = /(^|\/)(tests?|__tests__|specs?|test-?fixtures?|fixtures?|__fixtures__|__mocks__|mocks?|docs?|examples?|samples?)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/i
const SOURCE_EXT = /\.[cm]?[jt]sx?$/

function pluginFolders(root) {
  const found = []
  const walk = (dir, depth) => {
    if (depth > 4) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    if (existsSync(join(dir, '.claude-plugin', 'plugin.json'))) found.push(dir)
    for (const d of entries) {
      if (!d.isDirectory() || d.isSymbolicLink()) continue
      if (d.name === 'node_modules' || d.name === '.git' || d.name === '.claude-plugin') continue
      walk(join(dir, d.name), depth + 1)
    }
  }
  walk(root, 0)
  found.sort()
  const rootIsPlugin = found.includes(root)
  const skipped = []
  const kept = found.filter(d => {
    if (d === root) return true
    const rel = relative(root, d)
    const why = rel.split(sep).some(s => FIXTURE_SEGMENT.test(s)) ? 'under a docs, tests or fixtures folder'
      : rootIsPlugin ? 'nested inside the plugin folder, most likely a fixture'
      : null
    if (why) { skipped.push({ folder: rel, why }); return false }
    return true
  })
  return { found, kept, skipped }
}

function filesUnder(dir, root) {
  const out = []
  const walk = d => {
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git' || (e.name === 'types' && basename(d) === '.claude-plugin')) continue
        walk(p)
      } else if (e.isFile()) out.push(relative(root, p))
    }
  }
  walk(dir)
  return out.sort()
}

// ---------- validate ----------

function validate(dir) {
  const r = spawnSync(CC, ['plugin', 'validate', '--json', dir], { encoding: 'utf8', timeout: 180_000 })
  let report = null
  try { report = JSON.parse(r.stdout) } catch { report = null }
  if (!report) {
    const line = (r.stderr || r.stdout || '').trim().split('\n')[0] || `exit ${r.status}`
    return { ok: false, errors: [`validate gave no report: ${line}`], warnings: [], notes: [], gates: [] }
  }
  const text = x => (typeof x === 'string' ? x : `${x.path ? `${x.path}: ` : ''}${x.message ?? JSON.stringify(x)}`)
  const parts = [report.manifest, ...(report.contents || [])].filter(Boolean)
  return {
    ok: report.success === true,
    errors: parts.flatMap(p => (p.errors || []).map(text)),
    warnings: parts.flatMap(p => (p.warnings || []).map(text)),
    notes: parts.flatMap(p => p.notes || []),
    gates: parts.flatMap(p => (p.gatingHooks || []).map(g => (typeof g === 'string' ? g : g.hook ?? JSON.stringify(g)))),
  }
}

// Splits a validator list on the commas outside braces: `tool.call{tool=A|B}, ui.render{component=Pane, requestId=x}`.
function splitTop(s) {
  const out = []
  let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '{') depth++
    if (ch === '}') depth--
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(x => x && x !== 'nothing')
}

function reachOf(v) {
  const after = tag => v.notes.filter(n => n.includes(tag)).flatMap(n => splitTop(n.split(tag)[1] || ''))
  return {
    events: uniq(after(' hooks: ')),
    calls: uniq(after(' calls: ')),
    envReads: uniq(after(' env reads: ')),
    envWrites: uniq(after(' env writes: ')),
    gates: uniq(v.gates),
  }
}

// What a call on $ lets the mod reach, and the words a README uses when it says so. `words` is tested
// on the lower-cased README, `raw` on it as written. A word list is a verb near its object, never a
// bare common word: calibrated on this repository's own READMEs.
const REACH = [
  { id: 'files written', check: 1, call: /^\$\.fs\.write\b/, words: /\b(writes?|written|writing|saves?|saved|saving|creates?|stores?|appends?|rewrit(es|ten)|keeps?)\b.{0,30}\b(files?|folders?|director(y|ies)|disk|notes?|logs?|json|\.md)\b/ },
  { id: 'files read', check: 1, call: /^\$\.fs\.(read|list|stat|exists|ancestors)\b/, words: /\b(reads?|reading|lists?|scans?|watch(es)?|looks? at|opens?)\b.{0,30}\b(files?|folders?|director(y|ies)|transcripts?|project|repo|tree|disk|notes?|logs?|json|\.env|\.md)\b|\bfiles? (it )?reads?\b/ },
  { id: 'network', check: 2, firstScreen: true, call: /^\$\.(http\.fetch|mcp\.(call|connect))\b/, words: /\b(network|fetch(es|ed)?|https?|urls?|api|requests?|downloads?|uploads?|servers?|endpoints?|webhooks?|internet|online|cloud|sends? .{0,30}\bto\b|mcp)\b/ },
  { id: 'processes', check: 1, call: /^\$\.process\.(run|spawn)\b/, words: /\b(runs?|running|ran|launch(es)?|starts?|spawns?|executes?|invokes?|shells? out|calls?)\b.{0,40}\b(commands?|scripts?|shell|programs?|process(es)?|binary|binaries|cli|validator|compiler|linter|formatter|test suite|tests|browser|chrome|chromium|git|npm|npx|node|python|bash|curl|docker|make)\b|\b(child )?process(es)?\b|\bsubprocess(es)?\b|\bshell commands?\b|\bruns:/ },
  { id: 'environment', check: 1, call: /^\$\.env\.(get|set)\b/, words: /\b(environment|env(ironment)? variables?|env|api keys?)\b/, raw: /\$[A-Z][A-Z0-9_]{2,}\b|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b[A-Z][A-Z0-9_]{3,}=/ },
  { id: 'model calls', check: 2, call: /^\$\.model\.(complete|classify|fork)\b/, words: /\b(model|llm|haiku|sonnet|opus|tokens?|costs?|spend|completions?|asks? claude|calls? (the )?(model|api))\b/ },
  { id: 'prompts sent as you', check: 1, call: /^\$\.prompt\.submit\b/, words: /\b(submits?|sends?|starts?|re-?submits?|re-?sends?)\b.{0,40}\b(prompt|turn|message|request|words|it|them)\b|\b(prompt|turn|message)s?\b.{0,24}\b(goes? out|went out|sent|submitted)\b|on your behalf|\bas you\b|\bfor you\b|by itself|auto(matic(ally)?|-?submit|-?send|-?resume)/ },
  { id: 'messages to other sessions', check: 1, call: /^\$\.session\.(send|authorize)\b/, words: /\b(other sessions?|another session|messages?|teammates?|agents?)\b/ },
  { id: 'settings changed', check: 1, call: /^\$\.config\.set\b/, words: /\b(changes?|changing|sets?|setting|writes?|updates?|edits?|switch(es)?|flips?|applies?|turns? (on|off))\b.{0,30}\b(settings?|config(uration)?|theme|preferences?|options?|permission mode|model)\b|\bsettings? (it )?(changes?|sets?|writes?)|\bpermission mode\b|\/config\b/ },
  { id: "Claude's tools run as the session (Bash, file edits, web)", check: 1, call: /^\$\.tool\.call\b/, words: /\b(tool calls?|runs? (a |the |its )?(bash|shell|tool)|through (claude'?s? )?tools?|bash tool|as (the session|claude)|calls? (a |the )?tool)\b/ },
  { id: 'sounds', check: 1, call: /^\$\.audio\.(play|speak)\b/, words: /\b(sounds?|audio|speaks?|spoken|voice|chimes?|beeps?|plays? (a |the )?(sound|chime|tone|clip|note))\b/ },
]

// A hook that can answer for Claude Code, and the words a README uses when it says so.
const GATES = [
  { id: 'can hold, deny or answer tool calls', hook: /^tool\.(call|check)\b/, words: /\b(approv|allow|den(y|ies|ied)|block|holds?|refus|permission|guard|gate|intercept|stops?|rewrit|tool calls?|each tool|every tool|bash calls?|watch(es)? (claude'?s? )?(tools?|bash)|(sees?|reads?|notices?) (each |every |the )?(tool|bash) (call|use|command))/ },
  { id: 'can change or drop a prompt', hook: /^prompt\.(submit|edit)\b/, words: /\b(prompts?|rewrit|drops?|edits?|changes? what)/ },
  { id: 'answers permission prompts', hook: /^classic\.PermissionRequest\b/, words: /\b(permission|approv|allow|den(y|ies))/ },
  { id: 'can refuse other mods or change what they get', hook: /^(plugin\.register|engine\.create)\b/, words: /\b(mods?|plugins?)\b/ },
  { id: 'changes what Claude reads (system prompt, context, reminders, skills)', hook: /^(prompt\.(compose|section|context|attachment)|skill\.prompt)\b/, words: /\b(system prompt|context|instructions?|reminders?|skills?|what claude (reads|sees|gets))/ },
  { id: 'rewrites transcript rows', hook: /^session\.append\b/, words: /\b(transcript|history|records?|rows?)\b/ },
  { id: 'reads or answers messages between sessions', hook: /^session\.(receive|send)\b/, words: /\b(sessions?|messages?|teammates?|agents?)\b/ },
  { id: 'sees telemetry records', hook: /^telemetry\./, words: /\btelemetry\b/ },
  { id: 'chooses or refuses subagents', hook: /^agent\.(spawn|offer)\b/, words: /\b(subagents?|agents?|teammates?)\b/ },
]

const COST_WORDS = /\bcosts?\b|\$\s?\d*\.\d+|\bcents?\b|\btokens?\b|\bper (turn|call|review|run|check)\b|\ba (turn|call)\b|\bfree\b|\bno cost\b|\bown account\b/

// ---------- the source, read as text ----------

// Comments out, strings and newlines kept, so a URL in a string survives and line numbers hold.
function stripComments(src) {
  let out = '', i = 0
  const n = src.length
  while (i < n) {
    const c = src[i], d = src[i + 1]
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2)
      const end = e < 0 ? n : e + 2
      out += src.slice(i, end).replace(/[^\n]/g, ' ')
      i = end
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      out += c; i++
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue }
        if (q !== '`' && src[i] === '\n') break
        out += src[i]; i++
      }
      if (i < n) { out += src[i]; i++ }
      continue
    }
    if (c === '\\') { out += c + (d ?? ''); i += 2; continue }
    out += c; i++
  }
  return out
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length

// Reads a string literal at text[i] (a quote): its value, whether it is a template with holes, and the index after it.
function readString(text, i) {
  const q = text[i]
  let j = i + 1, value = '', dynamic = false
  while (j < text.length && text[j] !== q) {
    if (text[j] === '\\') { value += text[j + 1] ?? ''; j += 2; continue }
    if (q === '`' && text[j] === '$' && text[j + 1] === '{') {
      dynamic = true
      let depth = 0
      while (j < text.length) { if (text[j] === '{') depth++; if (text[j] === '}') { depth--; if (depth === 0) { j++; break } } j++ }
      value += '${...}'
      continue
    }
    if (q !== '`' && text[j] === '\n') break
    value += text[j]; j++
  }
  return { value, dynamic, end: j + 1 }
}

// Reads an array literal at text[i] (a `[`, or a `(` with close ')'): its items as { str, dynamic } or { expr }, and the index after it.
function readArray(text, i, close = ']') {
  const items = []
  let j = i + 1
  while (j < text.length) {
    while (j < text.length && /\s/.test(text[j])) j++
    if (j >= text.length) break
    if (text[j] === close) return { items, end: j + 1 }
    if (text[j] === ',') { j++; continue }
    if (text[j] === '"' || text[j] === "'" || text[j] === '`') {
      const s = readString(text, j)
      items.push({ str: s.value, dynamic: s.dynamic })
      j = s.end
      continue
    }
    if (text[j] === '[') {
      const inner = readArray(text, j)
      items.push({ items: inner.items, expr: '[...]' })
      j = inner.end
      continue
    }
    let depth = 0
    const start = j
    while (j < text.length) {
      const ch = text[j]
      if (ch === '(' || ch === '[' || ch === '{') depth++
      if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth-- }
      if (ch === ',' && depth === 0) break
      j++
    }
    if (j === start) { j++; continue } // a closer that is not ours: step past it
    items.push({ expr: text.slice(start, j).trim() })
  }
  return { items, end: j }
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The array an identifier was last given in this file, when it is a literal.
function arrayNamed(text, id) {
  const re = new RegExp(`(?:const|let|var)\\s+${esc(id)}\\b[^=;\\n]*=\\s*\\[`, 'g')
  let m, last = null
  while ((m = re.exec(text))) last = m
  return last ? readArray(text, last.index + last[0].length - 1).items : null
}

function stringNamed(text, id) {
  const re = new RegExp(`(?:const|let|var)\\s+${esc(id)}\\b[^=;\\n]*=\\s*(['"\`])`, 'g')
  let m, last = null
  while ((m = re.exec(text))) last = m
  if (last) return readString(text, last.index + last[0].length - 1)
  // `const id = a ?? 'x'`, `const id = flag ? 'a' : 'b'`: the last plausible literal on the declaration line
  const line = new RegExp(`(?:const|let|var)\\s+${esc(id)}\\b[^=;\\n]*=([^\\n;]*)`).exec(text)
  if (!line) return null
  const found = []
  let i = 0
  while (i < line[1].length) {
    const q = /['"\`]/.exec(line[1].slice(i))
    if (!q) break
    const str = readString(line[1], i + q.index)
    if (str.value && !NON_PROGRAM.test(str.value)) found.push(str)
    i = Math.max(str.end, i + q.index + 1)
  }
  return found.length ? found[found.length - 1] : null
}

// Programs known by name: one of these as a literal in a function that runs a program named at run
// time is taken as a program it probably runs, and the README has to name it.
const KNOWN_PROGRAMS = /^(lsof|ps|pgrep|pkill|kill|killall|top|who|last|netstat|ss|ifconfig|ip|ping|dig|nslookup|host|traceroute|arp|launchctl|systemctl|service|crontab|say|afplay|aplay|paplay|mpv|ffmpeg|ffplay|ffprobe|sox|pbcopy|pbpaste|xclip|xsel|wl-copy|wl-paste|osascript|defaults|mdfind|mdls|qlmanage|sips|screencapture|imagesnap|tmux|screen|code|cursor|subl|vim|nvim|emacs|nano|git|gh|glab|hub|svn|hg|docker|podman|kubectl|helm|terraform|aws|gcloud|az|make|cmake|gcc|clang|cargo|go|rustc|javac|mvn|gradle|dotnet|swift|xcodebuild|xcrun|simctl|adb|flutter|brew|apt|apt-get|dnf|yum|pacman|snap|pip|pip3|pipx|uv|uvx|poetry|conda|npm|npx|pnpm|yarn|bun|bunx|node|deno|tsx|ts-node|python|python3|ruby|perl|php|lua|Rscript|java|ollama|claude|codex|gemini|aider|chrome|chromium|google-chrome|google-chrome-stable|firefox|safari|open|xdg-open|start|explorer|powershell|pwsh|cmd|wsl|wslpath|sudo|doas|nc|ncat|socat|curl|wget|ssh|scp|sftp|rsync|tail|head|cat|grep|rg|fd|find|sed|awk|jq|yq|tar|zip|unzip|gzip|mktemp|mkdir|rm|cp|mv|ln|chmod|chown|touch|date|uname|sw_vers|hostname|whoami|id|env|printenv|which|where|type|sleep|timeout|nohup|caffeinate|pmset|networksetup|scutil|security|pytest|jest|vitest|mocha|tsc|eslint|prettier|black|ruff|flake8|mypy|sh|bash|zsh|dash|fish)$/

// Literals that name a type, a platform or an option, never a program.
const NON_PROGRAM = /^(string|number|boolean|object|function|undefined|symbol|bigint|darwin|win32|linux|freebsd|aix|sunos|openbsd|android|cygwin|netbsd|true|false|null|utf-?8|ascii|base64|hex|binary|ignore|pipe|inherit|\s*)$/i

// Every array literal on an identifier's declaration line (a ternary of commands gives two), or the
// elements it iterates in `for (const id of [...])`, each as its own argv.
function arraysNamed(text, id) {
  const loop = new RegExp(`for\\s*\\(\\s*(?:const|let|var)\\s+${esc(id)}\\s+of\\s+(\\[|[A-Za-z_$][\\w$]*)`).exec(text)
  if (loop) {
    const items = loop[1] === '[' ? readArray(text, loop.index + loop[0].length - 1).items : (arrayNamed(text, loop[1]) ?? [])
    return items.filter(it => it.str !== undefined && !it.dynamic).map(it => [it])
  }
  const line = new RegExp(`(?:const|let|var)\\s+${esc(id)}\\b[^=;\\n]*=([^\\n;]*)`).exec(text)
  if (!line) return []
  const out = []
  let i = 0
  while ((i = line[1].indexOf('[', i)) >= 0) { const arr = readArray(line[1], i); if (arr.items.length) out.push(arr.items); i = arr.end }
  return out
}

const SHELLS = /^(sh|bash|zsh|dash|fish|ksh|cmd(\.exe)?|powershell(\.exe)?|pwsh)$/i
const NET_PROGRAMS = /^(gh|curl|wget|aria2c|http|https|httpie|xh|ssh|scp|sftp|rsync|nc|ncat|netcat|socat|telnet|ftp|lftp)$/i
const NET_SUBCOMMANDS = [
  { program: /^git$/i, sub: /^(push|fetch|pull|clone|remote|ls-remote|submodule|request-pull|svn|send-email)$/i },
  { program: /^(npm|pnpm|yarn|bun|pip|pip3|pipx|uv|uvx|brew|apt|apt-get|yum|dnf|cargo|go|gem|composer|conda|poetry)$/i, sub: /^(i|install|add|update|upgrade|get|download|publish|x|exec|dlx|create|sync|run)$/i },
  { program: /^(npx|pipx|uvx|bunx)$/i, sub: /./ },
  { program: /^(docker|podman)$/i, sub: /^(pull|push|run|build|login)$/i },
]
// Programs whose code this check does not read: what they run is in another file or language.
const INTERPRETERS = /^(node|deno|bun|python|python3|uv|uvx|pipx|ruby|perl|php|Rscript|java|dotnet|swift|osascript|powershell|pwsh|lua|tclsh|npx|bunx|tsx|ts-node)$/i
const OPENERS = /^(open|xdg-open|start|explorer(\.exe)?)$/i
const SEND_FLAGS = { curl: /^(-d|--data(-\w+)?|-F|--form|-T|--upload-file|--json|-X|--request)$/, gh: /^(-f|-F|--field|--raw-field|--input|-X|--method)$/, wget: /^--post-(data|file)$/ }
// Programs that only ask the machine about itself, or move the mod's own files: unnamed, a note rather than a finding.
const PROBE = /^(uname|sw_vers|hostname|whoami|id|date|tty|stty|tput|which|command|type|test|\[|true|false|echo|printf|uptime|arch|nproc|sysctl|getconf|locale|wslpath|env|printenv|pwd|sleep|defaults)$/
const FILE_UTILS = /^(rm|mkdir|mktemp|cp|mv|ls|cat|head|tail|touch|chmod|chown|find|grep|egrep|rg|sed|awk|sort|uniq|wc|tee|tar|unzip|zip|gzip|gunzip|cut|tr|xargs|basename|dirname|realpath|readlink|stat|du|df|diff|cmp|file|less|more|install|kill|pkill|killall|wait|jobs|trap)$/
const SHELL_WORDS = /^(if|then|else|elif|fi|for|in|do|done|while|until|case|esac|function|return|exit|export|set|unset|local|readonly|shift|cd|eval|source|\.|trap|wait|break|continue|\{|\}|\(|\)|!|\[\[|\]\]|time|nohup|exec|command|builtin|env|sudo|doas|nice|timeout|then|:)$/
// A README names some programs by another word.
const ALIASES = { osascript: /applescript|apple ?script|osascript/i, pgrep: /\bpgrep\b|\bps\b|process list|running process|is running|processes? running/i, ps: /\bps\b|process list|running process|is running/i }

// The first word of each command in a shell string, past assignments, wrappers and flags.
function shellPrograms(text) {
  const out = []
  const defined = new Set()
  for (const m of text.matchAll(/(?:^|[;\n{(]|\s)(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{|\bfunction\s+([A-Za-z_][\w-]*)/g)) defined.add(m[1] ?? m[2])
  for (const piece of text.split(/\s*(?:\|\||&&|[|;]|\$\(|`|\n)\s*/)) {
    const toks = piece.trim().split(/\s+/).filter(Boolean)
    while (toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0]) || /^(exec|command|nohup|time|env|sudo|doas|nice|builtin)$/.test(toks[0]) || /^-/.test(toks[0]) || /^\d+[smh]?$/.test(toks[0]))) toks.shift()
    const t = toks[0]
    if (!t || SHELL_WORDS.test(t) || defined.has(t) || /[${}()<>"'\\]/.test(t) || !/^[A-Za-z0-9_./-]+$/.test(t)) continue
    out.push(basename(t))
  }
  return uniq(out)
}

function programOf(argv) {
  const first = argv[0]
  if (!first || first.expr || first.dynamic) return null
  return basename(first.str.trim().split(/\s+/)[0] || '')
}

// What running argv reaches: a network program, a package manager fetching, an interpreter, a browser opened, a shell with a command string.
function classify(argv) {
  const program = programOf(argv)
  const words = argv.map(a => (a.str ?? a.expr ?? '').trim())
  const out = { program, shellText: null, shellPrograms: [], network: null, sends: false, opensUrl: false, interpreter: false }
  if (!program) return out
  if (SHELLS.test(program)) {
    const at = words.findIndex(w => /^(-c|\/c|-Command|-lc|-ic|-lic|-e)$/i.test(w))
    const cmd = argv[at + 1]
    out.shellText = at >= 0 ? (cmd?.str ?? (cmd?.expr ? `<${cmd.expr}>` : null)) : null
    if (out.shellText && !out.shellText.startsWith('<')) {
      out.shellPrograms = shellPrograms(out.shellText)
      for (const piece of out.shellText.split(/\s*(?:\|\||&&|[|;]|\$\(|`|\n)\s*/)) {
        const toks = piece.trim().split(/\s+/).filter(Boolean)
        while (toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0]) || /^(exec|command|nohup|time|env|sudo|doas|nice|builtin|timeout)$/.test(toks[0]) || /^\d+[smh]?$/.test(toks[0]))) toks.shift()
        if (!toks.length) continue
        const sub = classify(toks.map(t => ({ str: t })))
        if (sub.network) { out.network = out.network ? `${out.network}, ${sub.network}` : sub.network; out.sends ||= sub.sends }
        if (sub.opensUrl) out.opensUrl = true
        if (sub.interpreter) out.interpreter = true
      }
    }
    return out
  }
  const lower = program.toLowerCase()
  if (NET_PROGRAMS.test(lower)) {
    out.network = lower
    const flags = SEND_FLAGS[lower]
    if (flags && words.some(w => flags.test(w))) out.sends = true
    if (/^(scp|sftp|rsync|ftp|lftp|nc|ncat|netcat|socat)$/.test(lower)) out.sends = true
    if (lower === 'gh') {
      const sub = words.slice(1).find(w => /^(api|release|pr|issue|gist|repo|auth|run|workflow)$/.test(w))
      if (sub) out.network = `gh ${sub}`
      if (words.some(w => /^(create|edit|upload|comment|close|merge|delete|login)$/.test(w))) out.sends = true
    }
  }
  for (const rule of NET_SUBCOMMANDS) {
    const sub = words.slice(1).find(w => rule.sub.test(w))
    if (rule.program.test(lower) && sub) out.network = `${lower} ${sub}`
  }
  if (INTERPRETERS.test(lower)) out.interpreter = true
  if (OPENERS.test(lower) && words.some(w => /^https?:\/\//i.test(w))) out.opensUrl = true
  return out
}

const HOST_RE = /https?:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(?::\d+)?/gi
const PRIVATE_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.[\dx]+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|.*\.local|.*\.localhost|.*\.test|.*\.internal|.*\.invalid|example\.(com|org|net)|.*\.example(\.(com|org|net))?|(www\.)?w3\.org|json-schema\.org|schemas\..*|spdx\.org|opensource\.org|choosealicense\.com|creativecommons\.org|unlicense\.org|.*\.x)$/i
const TEXT_EXT = /\.(py|pyi|rb|go|rs|sh|bash|zsh|json|toml|ya?ml|ini|cfg|conf|txt|html?|css|svg|sql|swift|kt|java|cs|c|cc|cpp|h|m|mm|lua|pl|php)$/i
const HASH_COMMENTS = /\.(py|pyi|rb|sh|bash|zsh|toml|ya?ml|ini|cfg|conf|pl)$/i
const META_FILE = /(^|\/)(package(-lock)?\.json|marketplace\.json|pyproject\.toml|Cargo\.(toml|lock)|go\.(mod|sum)|tsconfig[^/]*\.json|[^/]*\.lock|yarn\.lock|pnpm-lock\.yaml|deno\.jsonc?|bun\.lockb?|\.editorconfig|LICENSE[^/]*|CHANGELOG[^/]*)$/i
const TOOLING = /(^|\/)(\.github|\.changeset|\.husky|\.vscode|\.idea|\.circleci|\.gitlab|scripts?|tools?|ci|benchmarks?|bench)(\/|$)/i
const VENDORED = /(^|\/)(vendor|vendored|third[-_]party|bundle|bundles|dist|build|lib|libs|renderer|external|generated)(\/|$)|\.min\.[cm]?js$|\.bundle\.[cm]?js$|generated-/i
const JS_SEND = /\.http\.fetch\s*\(([\s\S]{0,600}?)\)\s*[;\n]/g
const OTHER_SEND = /\b(requests|httpx|session|client|urllib3|http)\.(post|put|patch)\s*\(|method\s*=\s*['"](POST|PUT|PATCH)['"]|urlopen\([^)]*\bdata\s*=|\bfetch\([^)]*method\s*:\s*['"`](POST|PUT|PATCH)/i

// String constants across the mod's source, to resolve a program or a shell string given by name.
function constantsIn(root, files) {
  const map = new Map()
  for (const rel of files) {
    let text
    try { text = stripComments(readFileSync(join(root, rel), 'utf8')) } catch { continue }
    const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(['"`])/g
    let m
    while ((m = re.exec(text))) { const str = readString(text, m.index + m[0].length - 1); if (!map.has(m[1])) map.set(m[1], str) }
  }
  return map
}

// The function a call sits in, as `function name(` or `const name = (...) =>` or `name(...) {`, and its parameter names.
function enclosingFunction(text, index) {
  const before = text.slice(0, index)
  const re = /(?:function\s+([A-Za-z_$][\w$]*)\s*(\([^)]*\))|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=>|([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(\([^)]*\))\s*(?::\s*[^=]+)?=>|(?:async\s+)?([A-Za-z_$][\w$]*)\s*(\([^()]*\))\s*(?::\s*[^{;=]+)?\{)/g
  let m, found = null
  while ((m = re.exec(before))) {
    const name = m[1] ?? m[3] ?? m[5] ?? m[7]
    if (/^(if|for|while|switch|catch|return|function|else|do|with)$/.test(name)) continue
    const params = (m[2] ?? m[4] ?? m[6] ?? m[8] ?? '').replace(/^\(|\)$/g, '').split(',').map(x => x.trim().replace(/[?:=].*$/s, '').replace(/^\.\.\./, '')).filter(Boolean)
    found = { name, params, index: m.index }
  }
  return found
}

// Reads a call's arguments at text[i] (a `(`): items like readArray's.
function readArgs(text, i) {
  return readArray(text, i, ')').items
}

// The k-th argument, as a literal, of every call to `name` across the mod's source.
function callerArgs(texts, name, k, consts) {
  const out = []
  const re = new RegExp(`(^|[^.\\w$])${esc(name)}\\s*\\(`, 'g')
  for (const text of texts) {
    let m
    while ((m = re.exec(text))) {
      const args = readArgs(text, m.index + m[0].length - 1)
      let a = args[k]
      if (a?.expr && /^[A-Za-z_$][\w$]*$/.test(a.expr) && consts?.get(a.expr)) { const c = consts.get(a.expr); a = { str: c.value, dynamic: c.dynamic } }
      if (a && (a.str !== undefined || a.items)) out.push(a)
    }
  }
  return out
}

// Programs the source runs, hosts it names and sends it makes, read as text with the comments out.
function scanSource(dir, root) {
  const programs = [], hosts = [], notes = [], sends = [], runtime = []
  const folder = relative(root, dir) || '.'
  const inMod = f => (folder === '.' ? f : relative(folder, f))
  const all = filesUnder(dir, root).filter(f => !TEST_PATH.test(inMod(f)))
  const files = all.filter(f => SOURCE_EXT.test(f))
  const consts = constantsIn(root, files)
  const texts = new Map()
  for (const rel of files) { try { texts.set(rel, stripComments(readFileSync(join(root, rel), 'utf8'))) } catch { /* unreadable */ } }
  const resolveItem = (item, text) => {
    if (!item.expr || !/^[A-Za-z_$][\w$]*$/.test(item.expr)) return item
    const str = stringNamed(text, item.expr) ?? consts.get(item.expr)
    return str ? { str: str.value, dynamic: str.dynamic } : item
  }
  // An identifier that is a parameter of the enclosing function: the literals its callers pass.
  const candidatesNear = (text, index) => {
    const fn = enclosingFunction(text, index)
    const body = text.slice(fn ? fn.index : Math.max(0, index - 2000), index)
    const out = []
    for (const m of body.matchAll(/(['"`])([A-Za-z][\w.+-]{1,24})\1/g)) if (!NON_PROGRAM.test(m[2]) && !/^(-|--)/.test(m[2]) && !out.includes(m[2])) out.push(m[2])
    return out.slice(0, 8)
  }
  const viaCallers = (text, index, id) => {
    const fn = enclosingFunction(text, index)
    if (!fn) return null
    const k = fn.params.indexOf(id)
    if (k < 0) { unresolved.set(id, `${id} is not a parameter of ${fn.name}(${fn.params.join(', ')})`); return null }
    const args = callerArgs([...texts.values()], fn.name, k, consts)
    if (!args.length) unresolved.set(id, `${id} is parameter ${k + 1} of ${fn.name}(${fn.params.join(', ')}) and no caller passes a literal`)
    return args.length ? { fn: fn.name, args } : null
  }
  const unresolved = new Map()
  for (const rel of files) {
    const text = texts.get(rel)
    if (text === undefined) continue
    const callRe = /\.process\.(run|spawn)\s*\(\s*/g
    let m
    while ((m = callRe.exec(text))) {
      const at = m.index + m[0].length
      const where = `${rel}:${lineOf(text, m.index)}`
      let argv = null, how = ''
      if (text[at] === '[') argv = readArray(text, at).items
      else if (text[at] === '"' || text[at] === "'" || text[at] === '`') {
        // a command line as one string: its words are the argv
        const str = readString(text, at)
        argv = str.dynamic ? [{ expr: 'a template' }] : str.value.trim().split(/\s+/).map(w => ({ str: w }))
      } else {
        const id = /^[A-Za-z_$][\w$]*/.exec(text.slice(at, at + 80))?.[0]
        const named = id ? arrayNamed(text, id) : null
        const several = !named && id ? arraysNamed(text, id) : []
        const passed = !named && !several.length && id ? viaCallers(text, m.index, id) : null
        if (named) { argv = named; how = ` (${id})` }
        else if (several.length) { for (const items of several) record(items.map(item => resolveItem(item, text)), `${where} (${id})`); continue }
        else if (passed) {
          const argvs = passed.args.filter(a => a.items).map(a => a.items)
          if (!argvs.length) { notes.push(`program named at run time (${id}) at ${where}`); continue }
          for (const items of argvs) record(items.map(item => resolveItem(item, text)), `${where} (${passed.fn} called with it)`)
          continue
        } else { const c = candidatesNear(text, m.index); runtime.push({ at: where, candidates: c }); notes.push(`program named at run time${id ? ` (${id}${unresolved.has(id) ? `: ${unresolved.get(id)}` : ''})` : ''} at ${where}${c.length ? `; literals in that function: ${c.join(', ')}` : ''}`); continue }
      }
      argv = argv.map(item => resolveItem(item, text))
      if (argv[0]?.expr && /^[A-Za-z_$][\w$]*$/.test(argv[0].expr)) {
        const loops = arraysNamed(text, argv[0].expr)
        if (loops.length) { for (const items of loops) record([items[0], ...argv.slice(1)], `${where} (${argv[0].expr}, one of ${loops.length})`); continue }
        const passed = viaCallers(text, m.index, argv[0].expr)
        if (passed) {
          const firsts = passed.args.filter(a => a.str !== undefined && !a.dynamic)
          if (firsts.length) { for (const f of firsts) record([{ str: f.str }, ...argv.slice(1)], `${where} (${passed.fn} called with it)`); continue }
        }
      }
      record(argv, where + how)
      function record(items, at) {
        const c = classify(items)
        if (!c.program) { const id = items[0]?.expr; const near = candidatesNear(text, m.index); runtime.push({ at, candidates: near }); notes.push(`program named at run time (${id ?? 'a template'}${id && unresolved.has(id) ? `: ${unresolved.get(id)}` : ''}) at ${at}${near.length ? `; literals in that function: ${near.join(', ')}` : ''}`); return }
        programs.push({ program: c.program, at, shellText: c.shellText, network: c.network, sends: c.sends, opensUrl: c.opensUrl, interpreter: c.interpreter })
        for (const sp of c.shellPrograms) if (sp !== c.program) programs.push({ program: sp, at: `${at} (in the shell string)`, shellText: null, network: null, sends: false, opensUrl: false, interpreter: INTERPRETERS.test(sp), viaShell: true })
        if (c.shellText && c.shellText.startsWith('<')) notes.push(`shell command text named at run time ${c.shellText} at ${at}`)
      }
    }
    const toolRe = /\.tool\.call\s*\(\s*\{([\s\S]{0,600}?)\}\s*[,)]/g
    while ((m = toolRe.exec(text))) {
      const body = m[1]
      const tool = /\btool\s*:\s*['"`]([\w-]+)['"`]/.exec(body)?.[1] ?? 'a tool named at run time'
      const where = `${rel}:${lineOf(text, m.index)}`
      const cmd = /\bcommand\s*:\s*(['"`])/.exec(body)
      if (tool === 'Bash' && cmd) {
        const str = readString(body, cmd.index + cmd[0].length - 1)
        const c = classify([{ str: 'sh' }, { str: '-c' }, { str: str.value }])
        for (const sp of c.shellPrograms) programs.push({ program: sp, at: `${where} (through Claude's Bash tool)`, shellText: null, network: c.network, sends: c.sends, opensUrl: false, interpreter: INTERPRETERS.test(sp), viaTool: 'Bash' })
        notes.push(`runs a command through Claude's Bash tool at ${where}: ${JSON.stringify(str.value.slice(0, 160))}`)
      } else if (tool === 'Bash') notes.push(`runs a command through Claude's Bash tool at ${where}, the text named at run time`)
      else notes.push(`uses Claude's ${tool} tool at ${where}`)
    }
    while ((m = JS_SEND.exec(text))) {
      const call = m[1]
      if (/method\s*:\s*['"`](POST|PUT|PATCH|DELETE)/i.test(call) || /\bbody\s*:/.test(call)) sends.push({ at: `${rel}:${lineOf(text, m.index)}`, how: /method\s*:\s*['"`](\w+)/i.exec(call)?.[1]?.toUpperCase() ?? 'a body' })
      const target = call.trim()
      if (!/^['"`]https?:\/\//.test(target)) notes.push(`network target named at run time (${target.split(/[,\n]/)[0].trim().slice(0, 40)}) at ${rel}:${lineOf(text, m.index)}`)
    }
  }
  for (const rel of all.filter(f => (SOURCE_EXT.test(f) || TEXT_EXT.test(f)) && !META_FILE.test(f))) {
    let text
    try { text = readFileSync(join(root, rel), 'utf8') } catch { continue }
    if (text.length > 4_000_000) continue
    // plugin.json: only its settings carry reach (a default endpoint); homepage and repository are metadata
    if (/(^|\/)\.claude-plugin\/plugin\.json$/.test(rel)) { try { text = JSON.stringify(JSON.parse(text).userConfig ?? {}) } catch { text = '' } }
    if (SOURCE_EXT.test(rel)) text = stripComments(text)
    else if (HASH_COMMENTS.test(rel)) text = text.replace(/(^|\s)#[^\n]*/g, '$1')
    const where = TOOLING.test(inMod(rel)) ? 'tooling' : VENDORED.test(rel) || text.length > 300_000 ? 'vendored' : 'source'
    let m
    const re = new RegExp(HOST_RE.source, 'gi')
    while ((m = re.exec(text))) {
      const host = m[1].toLowerCase()
      if (PRIVATE_HOST.test(host)) continue
      const seen = hosts.find(h => h.host === host)
      if (!seen) hosts.push({ host, at: `${rel}:${lineOf(text, m.index)}`, where })
      else if (seen.where !== 'source' && where === 'source') { seen.at = `${rel}:${lineOf(text, m.index)}`; seen.where = 'source' }
    }
    if (!SOURCE_EXT.test(rel) && OTHER_SEND.test(text)) sends.push({ at: `${rel}:${lineOf(text, OTHER_SEND.exec(text).index)}`, how: 'a post' })
    const dyn = /https?:\/\/\s*(\$\{|\{|["']\s*\+|["']\s*%|f?["']\s*\.format)/g
    while ((m = dyn.exec(text))) notes.push(`a host built at run time at ${rel}:${lineOf(text, m.index)}`)
  }
  return { programs, hosts, notes, sends, runtime, files: files.length }
}

// ---------- tests ----------

const KIT_FOREIGN = /\b(?:from\s+|require\(\s*|import\(\s*)['"](node:[\w./-]+|vitest|jest|@jest\/globals|mocha|chai|ava|tap|tape|uvu|bun:test|@playwright\/test|@vitest\/[\w-]+|sinon|supertest)['"]/

function testCheck(dir, root) {
  const folder = relative(root, dir) || '.'
  const all = filesUnder(dir, root).map(f => (folder === '.' ? f : relative(folder, f)))
  const kit = all.filter(f => /\.test\.tsx?$/.test(f) && !/(^|\/)node_modules\//.test(f))
  const others = all.filter(f => !kit.includes(f) && (/\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || /(^|\/)(tests?|__tests__|specs?)\/.*\.[cm]?[jt]sx?$/.test(f)))
  const foreign = []
  for (const f of kit) {
    let text = ''
    try { text = readFileSync(join(dir, f), 'utf8') } catch { continue }
    const hit = KIT_FOREIGN.exec(text)
    if (hit) foreign.push({ file: f, imports: hit[1] })
  }
  let run = null
  if (runTests && kit.length) {
    const r = spawnSync(CC, ['plugin', 'test', dir], { encoding: 'utf8', timeout: 600_000 })
    const out = `${r.stdout || ''}\n${r.stderr || ''}`
    const pass = /(\d+) pass\b/.exec(out), fail = /(\d+) fail\b/.exec(out), ran = /Ran (\d+) tests? across (\d+) files?/.exec(out)
    run = {
      exit: r.status,
      pass: pass ? Number(pass[1]) : null,
      fail: fail ? Number(fail[1]) : null,
      tests: ran ? Number(ran[1]) : null,
      files: ran ? Number(ran[2]) : null,
      last: out.trim().split('\n').filter(Boolean).slice(-3),
      ok: r.status === 0 && Boolean(fail) && Number(fail[1]) === 0,
      started: Boolean(ran || pass || fail),
    }
  }
  return { kit, others, foreign, run }
}

// ---------- the directory's rules ----------

function directoryRules(root, dir) {
  const r = spawnSync(process.execPath, [join(HERE, 'check-directory.mjs'), dir], { encoding: 'utf8', timeout: 300_000 })
  const here = at => { const [file, line] = at.split(/:(?=\d+$)/); const abs = resolve(HERE, '..', file); return `${relative(root, abs) || file}${line ? `:${line}` : ''}` }
  const rows = []
  let inMod = false
  for (const line of (r.stdout || '').split('\n')) {
    if (/^\d+ mods?: /.test(line)) break
    if (/^(ok|!!)\s+repository:/.test(line)) { inMod = false; continue }
    if (/^(ok|!!)\s+/.test(line)) { inMod = line.includes(dir); continue }
    const m = /^\s+(BLOCK|warn)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line)
    if (inMod && m) rows.push({ blocking: m[1] === 'BLOCK', kind: m[2], at: here(m[3]), text: m[4] })
  }
  return { rows, ran: Boolean(r.stdout), error: (r.stderr || '').trim().split('\n')[0] || `exit ${r.status}` }
}

const OS_METADATA = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)(\/|$)/
const IMAGE_OR_FONT = /\.(png|jpe?g|gif|webp|svg|woff2?|ttf|otf)$/i

function linkTarget(root, rel) {
  const p = join(root, rel)
  try {
    const st = lstatSync(p)
    if (st.isSymbolicLink()) return readlinkSync(p)
    if (st.isFile() && st.size < 4096) return readFileSync(p, 'utf8').trim()
  } catch { /* unreadable */ }
  return null
}

function repositoryRules(root, dir) {
  const out = []
  const listing = git(root, 'ls-files', '-s', '--', '.')
  if (listing === null) { out.push({ blocking: false, kind: 'REPO', rule: 'unknown', at: '.', text: 'not a git checkout, so links, submodules and the committed file list were not checked' }); return out }
  const inPlugin = rel => resolve(root, rel).startsWith(dir + sep) || resolve(root, rel) === dir
  let pluginFiles = 0
  for (const line of listing.split('\n').filter(Boolean)) {
    const m = /^(\d{6}) \S+ \d+\t(.*)$/.exec(line)
    if (!m) continue
    const [, mode, rel] = m
    if (mode === '120000') {
      const target = linkTarget(root, rel)
      const escapes = target === null || isAbsolute(target) || !resolve(dirname(join(root, rel)), target).startsWith(root + sep)
      out.push({ blocking: true, kind: 'REPO', rule: escapes ? 'link-out' : 'link', at: rel, text: escapes ? `a symbolic link that leaves the repository (${target ?? 'unreadable'})` : `a symbolic link inside the repository (${target}); the directory refuses links` })
    } else if (mode === '160000') out.push({ blocking: true, kind: 'REPO', rule: 'submodule', at: rel, text: 'a submodule, which this check did not fetch or read' })
    if (OS_METADATA.test(rel)) out.push({ blocking: true, kind: 'REPO', rule: 'metadata', at: rel, text: 'an OS metadata file in the commit; the directory refuses the whole commit' })
    if (/(^|\/)\.gitattributes$/.test(rel)) out.push({ blocking: true, kind: 'REPO', rule: 'gitattributes', at: rel, text: 'a .gitattributes in the commit; the directory has stopped fetching on one' })
    if (inPlugin(rel)) {
      pluginFiles++
      let size = 0
      try { size = statSync(join(root, rel)).size } catch { size = 0 }
      if (size > 5 * 1024 * 1024) out.push({ blocking: true, kind: 'REPO', rule: 'size', at: rel, text: `${Math.round(size / 1024 / 1024)} MiB; the directory stops at 5 MiB a file` })
      else if (size > 256 * 1024 && !IMAGE_OR_FONT.test(rel)) out.push({ blocking: false, kind: 'REPO', rule: 'size', at: rel, text: `${Math.round(size / 1024)} KiB; the directory holds a text file over 256 KiB for a reviewer` })
    }
  }
  if (pluginFiles > 512) out.push({ blocking: false, kind: 'REPO', rule: 'count', at: relative(root, dir) || '.', text: `${pluginFiles} files in the plugin folder; the directory holds more than 512 for a reviewer` })
  return out
}

// True when the line at `at` (path:line) holds a regex literal with a character class or a RegExp call.
function lineHasRegexClass(root, at) {
  const [file, line] = at.split(/:(?=\d+$)/)
  if (!line) return false
  try {
    const text = readFileSync(join(root, file), 'utf8').split('\n')[Number(line) - 1] ?? ''
    return /\/[^/\n]*\[[^\]\n]*\][^/\n]*\/[dgimsuvy]*|new RegExp\(/.test(text)
  } catch { return false }
}

// ---------- the README and the licence ----------

const README_NAMES = ['README.md', 'readme.md', 'Readme.md', 'README', 'README.txt']

// The section of a shared document whose heading names the mod, up to the next heading of its level,
// and the document's general text: everything outside the sections at that level (the collection's
// own words, which cover every mod), so another mod's section never speaks for this one.
function sectionFor(text, name) {
  const lines = text.split('\n')
  const head = new RegExp(`^(#{1,6})\\s.*(^|[^a-z0-9_-])${esc(name)}([^a-z0-9_-]|$)`, 'i')
  const start = lines.findIndex(l => head.test(l))
  if (start < 0) return null
  const level = /^(#+)/.exec(lines[start])[1].length
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) { const m = /^(#{1,6})\s/.exec(lines[i]); if (m && m[1].length <= level) { end = i; break } }
  const general = []
  let inside = false
  for (const l of lines) {
    const m = /^(#{1,6})\s/.exec(l)
    if (m) inside = m[1].length === level ? true : m[1].length < level ? false : inside
    if (!inside) general.push(l)
  }
  return { text: lines.slice(start, end).join('\n'), general: general.join('\n'), start: start + 1, end }
}

function readmeOf(dir, root, name, given) {
  const read = p => ({ path: relative(root, p) || basename(p), text: readFileSync(p, 'utf8') })
  const rootReadme = README_NAMES.map(n => join(root, n)).find(p => existsSync(p))
  // For a mod inside a collection, the repository README's words outside any mod's section speak for every mod.
  const alsoRoot = (r, p) => {
    if (dir === root || !rootReadme || rootReadme === p) return r
    const whole = read(rootReadme)
    const sec = sectionFor(whole.text, name)
    return { ...r, also: { path: whole.path, text: sec ? `${sec.text}\n${sec.general}` : whole.text } }
  }
  if (given) {
    const p = resolve(root, given)
    return existsSync(p) ? alsoRoot({ ...read(p), shared: true, given: true }, p) : null
  }
  for (const n of README_NAMES) { const p = join(dir, n); if (existsSync(p)) return { ...read(p), shared: false } }
  if (dir !== root) {
    const own = join(root, 'docs', `${name}.md`)
    if (existsSync(own)) return alsoRoot({ ...read(own), shared: false }, own)
    for (const p of [join(root, 'docs', 'mods.md'), join(root, 'docs', 'plugins.md'), join(root, 'docs', 'README.md')]) {
      if (existsSync(p)) { const r = read(p); if (new RegExp(`(^|[^a-z0-9_-])${esc(name)}([^a-z0-9_-]|$)`, 'i').test(r.text)) return alsoRoot({ ...r, shared: true }, p) }
    }
    if (rootReadme) return { ...read(rootReadme), shared: true }
  }
  return null
}

function wordsOutsideCode(md) {
  return md.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ').split(/\s+/).filter(Boolean).length
}

const SPDX_OPEN = /^(MIT|MIT-0|X11|Apache-2\.0|BSD-[0-3]-Clause(-Clear)?|0BSD|ISC|Unlicense|MPL-2\.0|(L|A)?GPL-[23]\.0(-only|-or-later|\+)?|CC0-1\.0|Zlib|BlueOak-1\.0\.0|Artistic-2\.0|EPL-2\.0|BSL-1\.0|WTFPL|PostgreSQL|Python-2\.0)$/i

function licenceKind(text) {
  const t = text.slice(0, 4000)
  if (/Permission is hereby granted, free of charge/.test(t) || /\bMIT License\b/i.test(t)) return 'MIT'
  if (/Apache License/i.test(t)) return 'Apache-2.0'
  if (/Redistribution and use in source and binary forms/.test(t)) return 'BSD'
  if (/\bISC License\b/i.test(t) || /Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee/.test(t)) return 'ISC'
  if (/This is free and unencumbered software released into the public domain/.test(t)) return 'Unlicense'
  if (/Mozilla Public License/i.test(t)) return 'MPL-2.0'
  if (/GNU (AFFERO |LESSER |LIBRARY )?GENERAL PUBLIC LICENSE/i.test(t)) return 'GPL family'
  if (/CC0 1\.0|Creative Commons Zero|CC0-1\.0/i.test(t)) return 'CC0'
  if (/Blue Oak Model License/i.test(t)) return 'BlueOak-1.0.0'
  if (/Boost Software License/i.test(t)) return 'BSL-1.0'
  if (/DO WHAT THE F/i.test(t)) return 'WTFPL'
  if (/\bzlib License\b|\bzlib\/libpng\b/i.test(t)) return 'Zlib'
  return null
}

function licenceOf(dir, root, manifest) {
  const field = typeof manifest.license === 'string' ? manifest.license.trim() : (manifest.license?.type ?? null)
  for (const d of [dir, root]) {
    const hit = (existsSync(d) ? readdirSync(d) : []).find(n => /^(LICENSE|LICENCE|COPYING|UNLICENSE)(\.|$)/i.test(n))
    if (hit) {
      const where = relative(root, join(d, hit)) || hit
      let kind = null
      try { kind = licenceKind(readFileSync(join(d, hit), 'utf8')) } catch { kind = null }
      const open = Boolean(kind) || Boolean(field && SPDX_OPEN.test(field))
      return { where, kind: kind ?? (open ? field : null), open, field }
    }
  }
  if (field) return { where: 'plugin.json license field', kind: field, open: SPDX_OPEN.test(field), field }
  return null
}

// ---------- one plugin folder ----------

function checkPlugin(root, dir, commitDays) {
  const rel = relative(root, dir) || '.'
  let manifest = {}
  try { manifest = JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')) } catch { manifest = {} }
  const v = validate(dir)
  const reach = reachOf(v)
  const directory = directoryRules(root, dir)
  const repo = repositoryRules(root, dir)
  const whole = readmeOf(dir, root, manifest.name ?? basename(dir), readmeGiven)
  const section = whole?.shared ? sectionFor(whole.text, manifest.name ?? basename(dir)) : null
  const readme = whole ? { ...whole, text: section ? section.text : whole.text, general: section ? section.general : '', offset: section ? section.start - 1 : 0, section: section ? `lines ${section.start}-${section.end}, plus the text outside every mod's section` : null } : null
  const licence = licenceOf(dir, root, manifest)
  const scan = scanSource(dir, root)
  const tests = testCheck(dir, root)

  const saidRaw = `${readme?.text ?? ''}\n${readme?.general ?? ''}\n${readme?.also?.text ?? ''}\n${manifest.description ?? ''}`
  const said = saidRaw.toLowerCase()
  const readmeLines = (readme?.text ?? '').split('\n')
  const firstScreenRaw = readmeLines.slice(0, FIRST_SCREEN_LINES).join('\n')
  const firstScreen = firstScreenRaw.toLowerCase()
  const lineSaying = re => { const i = readmeLines.findIndex(l => re.test(l.toLowerCase())); return i < 0 ? null : i + 1 + (readme?.offset ?? 0) }
  // HOME and USERPROFILE are named by `~/` or "home folder" as well as by name.
  const names = n => saidRaw.includes(n) || ((n === 'HOME' || n === 'USERPROFILE') && /~\/|home (folder|directory)/i.test(saidRaw))
  const nameSaid = name => new RegExp(`(^|[^a-z0-9_.-])${esc(name)}([^a-z0-9_]|$)`, 'i').test(saidRaw)
  const nameLine = name => { const re = new RegExp(`(^|[^a-z0-9_.-])${esc(name)}([^a-z0-9_]|$)`, 'i'); const i = readmeLines.findIndex(l => re.test(l)); if (i >= 0) return `line ${i + 1 + (readme?.offset ?? 0)}`; if (readme?.general && re.test(readme.general)) return 'the general text'; if (readme?.also && re.test(readme.also.text)) return `the repository's ${readme.also.path}`; if (manifest.description && re.test(manifest.description)) return 'the description'; return null }
  const programSaid = name => nameSaid(name) || (ALIASES[name]?.test(saidRaw) ?? false)
  const soft = name => PROBE.test(name) || FILE_UTILS.test(name)
  const hostLabel = host => { const parts = host.split('.'); return parts.length >= 3 && /^(co|com|org|net|gov|ac|edu)$/.test(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[parts.length - 2] ?? host }
  const hostSaid = host => said.includes(host) || nameSaid(hostLabel(host))
  const hostLine = host => { const i = readmeLines.findIndex(l => l.toLowerCase().includes(host) || new RegExp(`(^|[^a-z0-9_.-])${esc(hostLabel(host))}([^a-z0-9_]|$)`, 'i').test(l)); return i < 0 ? null : i + 1 + (readme?.offset ?? 0) }
  const sendsData = scan.sends.length > 0 || scan.programs.some(p => p.sends)
  const netWords = REACH.find(r => r.id === 'network').words

  const findings = [], warnings = [], review = []
  const finding = (check, text) => findings.push({ check, text })
  const warn = (check, text) => warnings.push({ check, text })
  const note = (check, text) => review.push({ check, text })

  // also: it validates, has a description, is fresh
  for (const e of v.errors) finding(0, `validate: ${e}`)
  for (const w of v.warnings) warn(0, `validate: ${w}`)
  if (!manifest.description || !String(manifest.description).trim()) finding(0, 'plugin.json has no description; the listing wants a one-line description that matches what the mod does')
  if (commitDays !== null && commitDays > FRESH_DAYS) finding(0, `last commit ${commitDays} days ago; the listing wants a push within ${FRESH_DAYS} days`)

  // 1 says what it touches
  const reachRows = []
  const literalPrograms = uniq(scan.programs.map(p => p.program))
  const unnamedPrograms = literalPrograms.filter(p => !soft(p) && !programSaid(p))
  const unnamedSoft = literalPrograms.filter(p => soft(p) && !programSaid(p))
  for (const r of REACH) {
    const calls = reach.calls.filter(c => r.call.test(c))
    if (!calls.length) continue
    let declared = r.words.test(said) || (r.raw?.test(saidRaw) ?? false)
    if (r.id === 'environment' && reach.envReads.some(names)) declared = true
    if (r.id === 'processes' && literalPrograms.length && !unnamedPrograms.length) declared = true
    const line = declared ? lineSaying(r.words) : null
    const onFirstScreen = declared && (r.words.test(firstScreen) || (r.raw?.test(firstScreenRaw) ?? false))
    reachRows.push({ id: r.id, check: r.check, calls, declared, line, onFirstScreen })
    if (!declared) finding(r.check, `${r.id} (${calls.join(', ')}) is not in the README`)
    else if (r.firstScreen && !onFirstScreen) finding(r.check, `${r.id} is said only at line ${line} of the README; it belongs on the first screen (the first ${FIRST_SCREEN_LINES} lines${readme?.section ? ' of its section' : ''})`)
  }
  if (!readme) finding(1, 'no README in the plugin folder or the repository, so nothing says what it touches')
  else if (readme.shared && !readme.section && !readme.given) warn(1, `the README judged is ${readme.path}, shared by the repository's plugins, with no heading naming this mod: words may belong to another mod (--readme names the file to use)`)
  if (unnamedPrograms.length) finding(1, `programs the source runs that the README does not name: ${unnamedPrograms.join(', ')} (${scan.programs.filter(p => unnamedPrograms.includes(p.program)).map(p => p.at).slice(0, 4).join(', ')})`)
  if (unnamedSoft.length) warn(1, `probe or file programs the README does not name: ${unnamedSoft.join(', ')}`)
  const probable = []
  for (const r of scan.runtime) for (const c of r.candidates) { const name = basename(c); if (KNOWN_PROGRAMS.test(name) && !soft(name) && !programSaid(name) && !probable.some(x => x.name === name)) probable.push({ name, at: r.at }) }
  if (probable.length) finding(1, `programs probably run (named at run time, the literal sits in the same function) that the README does not name: ${probable.map(x => `${x.name} (${x.at})`).join(', ')}`)
  for (const r of scan.runtime) { const known = r.candidates.map(c => basename(c)).filter(c => KNOWN_PROGRAMS.test(c) && programSaid(c)); if (known.length) note(1, `programs probably run at ${r.at}, each named in the README: ${known.map(c => `${c} (${nameLine(c) ?? 'by another word'})`).join(', ')}`) }
  for (const p of scan.programs) if (p.interpreter) note(1, `runs an interpreter at ${p.at}: ${p.program}; the code it runs is not read by this check`)
  if (reach.calls.some(c => /^\$\.process\.(run|spawn)\b/.test(c)) && !scan.programs.length && !scan.notes.some(n => n.startsWith('program named at run time'))) note(1, 'the validator reports $.process.run but the scan found no call site; read the source for the programs it runs')
  for (const n of scan.notes) note(1, n)
  for (const p of scan.programs) if (p.shellText) note(1, `runs a shell command at ${p.at}: ${p.program} -c ${JSON.stringify(p.shellText.slice(0, 160))}`)
  const gateRows = []
  const hooked = [...reach.gates, ...reach.events]
  for (const g of GATES) {
    const hooks = uniq(hooked.filter(h => g.hook.test(h)))
    if (!hooks.length) continue
    const declared = g.words.test(said)
    gateRows.push({ id: g.id, hooks, declared })
    if (!declared) finding(1, `gate not in the README: ${g.id} (${hooks.join(', ')})`)
  }
  const unnamedEnv = reach.envReads.filter(n => !names(n))
  if (unnamedEnv.length) warn(1, `environment variables read but not named in the README: ${unnamedEnv.join(', ')}`)

  // 2 network and model calls
  for (const p of scan.programs.filter(x => x.network)) {
    note(2, `network through a program at ${p.at}: ${p.network}${p.sends ? ' (sends data)' : ''}`)
    const programsNamed = p.network.split(', ').every(n => nameSaid(n.split(' ')[0]))
    if (!programsNamed || !netWords.test(said)) finding(2, `${p.network} runs at ${p.at} and the README does not say so${programsNamed ? ' as network' : ''}`)
    else if (!netWords.test(firstScreen)) finding(2, `${p.network} (network through a program) is said only at line ${lineSaying(netWords)} of the README; it belongs on the first screen (the first ${FIRST_SCREEN_LINES} lines)`)
  }
  for (const p of scan.programs) if (p.opensUrl) note(2, `opens a URL in the browser at ${p.at}`)
  for (const s of scan.sends) note(2, `sends data over the network at ${s.at} (${s.how})`)
  const LINK_HOSTS = /^(www\.)?(github\.com|gitlab\.com|bitbucket\.org|raw\.githubusercontent\.com|gist\.github\.com|npmjs\.com|pypi\.org|crates\.io|docs\.rs|developer\.apple\.com|developer\.mozilla\.org|learn\.microsoft\.com|stackoverflow\.com|wikipedia\.org|en\.wikipedia\.org|code\.claude\.com|docs\.anthropic\.com|claude\.com|anthropic\.com)$/i
  const unnamedHosts = scan.hosts.filter(h => !hostSaid(h.host) && h.where === 'source' && !LINK_HOSTS.test(h.host))
  const asideHosts = scan.hosts.filter(h => !hostSaid(h.host) && (h.where !== 'source' || LINK_HOSTS.test(h.host)))
  if (unnamedHosts.length) finding(2, `hosts in the source that the README does not name: ${unnamedHosts.map(h => `${h.host} (${h.at})`).join(', ')}`)
  if (asideHosts.length) note(2, `hosts the README does not name, in vendored code, repository tooling or as documentation links: ${asideHosts.map(h => `${h.host} (${h.at}, ${h.where})`).join(', ')}`)
  const firstScreenNames = name => new RegExp(`(^|[^a-z0-9_.-])${esc(name)}([^a-z0-9_]|$)`, 'i').test(firstScreenRaw)
  const unexplainedSends = [...scan.sends.map(x => x.at), ...scan.programs.filter(x => x.sends && !firstScreenNames(x.program)).map(x => x.at)]
  if (unexplainedSends.length && !scan.hosts.some(h => h.where === 'source')) {
    const BADGE_HOSTS = /^(www\.)?(github\.com|githubusercontent\.com|raw\.githubusercontent\.com|shields\.io|img\.shields\.io|badge\.fury\.io|badgen\.net|codecov\.io|coveralls\.io|travis-ci\.(org|com)|circleci\.com|gitlab\.com|bitbucket\.org|npmjs\.(com|org)|pypi\.org|opensource\.org|choosealicense\.com|claude\.com|claude\.ai|anthropic\.com|code\.claude\.com|docs\.anthropic\.com)$/i
    const firstScreenDomains = [...firstScreenRaw.matchAll(/(^|[^\w/.-])((?:[a-z0-9-]+\.)+(?:com|ai|io|dev|org|net|app|co|xyz|cloud|run|me|us|uk|de|fr|ca))(?![\w-])/gi)].map(x => x[2].toLowerCase()).filter(d => !BADGE_HOSTS.test(d))
    const domainOnFirstScreen = firstScreenDomains.length > 0 || /localhost|127\.0\.0\.1/.test(firstScreenRaw)
    if (!domainOnFirstScreen) finding(2, `the mod sends data (${unexplainedSends.slice(0, 3).join(', ')}) and its source names no host; the README's first screen must say where it goes`)
    else note(2, `the mod sends data (${unexplainedSends.slice(0, 3).join(', ')}) to a host named at run time; the README's first screen names ${uniq(firstScreenDomains).join(', ')}: check that this is the destination`)
  }
  if (sendsData) for (const h of scan.hosts.filter(x => hostSaid(x.host))) { const line = hostLine(h.host); if (line !== null && line > FIRST_SCREEN_LINES) finding(2, `the mod sends data and ${h.host} is named only at line ${line} of the README; a send belongs on the first screen (the first ${FIRST_SCREEN_LINES} lines)`) }
  if (reach.calls.some(c => /^\$\.model\./.test(c)) && !COST_WORDS.test(said)) finding(2, 'the mod calls the model and the README does not say roughly what a call costs')

  // 3 secret-shaped strings, and hidden text
  const directoryNotes = []
  for (const row of directory.rows) {
    const file = row.at.split(/:(?=\d+$)/)[0]
    const inTests = TEST_PATH.test(file) || TEST_PATH.test(rel === '.' ? file : relative(rel, file))
    if (row.kind === 'SECRET') {
      const keyLike = (row.text.match(/[A-Za-z0-9_\-+/=]{20,}/g) || []).some(run => (/\d/.test(run) && /[A-Za-z]/.test(run)) || (/[a-z]/.test(run) && /[A-Z]/.test(run)))
      if (inTests) warn(3, `secret-shaped string in a test or doc file, a fixture unless it is live: ${row.at}: ${row.text}`)
      else if (!keyLike) warn(3, `secret-shaped by the rule but no key-like token on the line (a pattern or minified code): ${row.at}: ${row.text}`)
      else finding(3, `${row.at}: ${row.text}`)
    } else if (row.kind === 'INVISIBLE') {
      if (lineHasRegexClass(root, row.at)) warn(0, `hidden text inside a regex class at ${row.at}, benign when the class strips it (\\u escapes would avoid the rule): ${row.text}`)
      else finding(0, `hidden text at ${row.at}: ${row.text}`)
    } else directoryNotes.push({ ...row, inTests })
  }
  if (!directory.ran) finding(3, `check-directory.mjs did not run (${directory.error}), so the secret scan is missing`)
  for (const row of repo) {
    if (row.rule === 'link-out' || row.rule === 'submodule') finding(0, `${row.at}: ${row.text}`)
    else if (row.rule === 'unknown') warn(0, row.text)
    else directoryNotes.push({ ...row, inTests: TEST_PATH.test(row.at) })
  }

  // 4 tests
  if (!tests.kit.length) finding(4, tests.others.length ? `no *.test.ts or *.test.tsx for claude plugin test; the ${plural(tests.others.length, 'test file')} here (${tests.others.slice(0, 3).join(', ')}) are for another runner` : 'no tests (no *.test.ts or *.test.tsx); the listing wants tests that run with claude plugin test')
  else if (tests.foreign.length) finding(4, `${tests.foreign.length} of ${plural(tests.kit.length, 'test file')} import what the kit cannot load (${uniq(tests.foreign.map(f => f.imports)).join(', ')}): ${tests.foreign.slice(0, 3).map(f => f.file).join(', ')}${tests.foreign.length > 3 ? ', ...' : ''}`)
  if (tests.run) {
    if (!tests.run.started) warn(4, `claude plugin test did not start (exit ${tests.run.exit}): ${tests.run.last.join(' | ') || 'no output'}`)
    else if (!tests.run.ok) finding(4, `claude plugin test: ${tests.run.fail ?? '?'} fail, ${tests.run.pass ?? '?'} pass (exit ${tests.run.exit}): ${tests.run.last.join(' | ')}`)
  }

  // 6 licence
  if (!licence) finding(6, 'no LICENSE file and no license field in plugin.json; the listing wants an open-source licence')
  else if (!licence.open) finding(6, `${licence.where} is not a licence this check recognises (${licence.kind ?? 'no SPDX id'}); read it: MIT, Apache-2.0, BSD, ISC, Unlicense, MPL-2.0, GPL or CC0 qualify, custom terms do not`)

  // the directory's own rules
  if (readme && wordsOutsideCode(readme.text) < 40) directoryNotes.push({ blocking: true, kind: 'README', at: readme.path, text: 'under 40 words outside code blocks; the directory wants at least 40', inTests: false })
  const directoryBlocking = directoryNotes.filter(n => n.blocking)
  if (withDirectory) for (const n of directoryBlocking) finding(7, `directory ${n.kind} ${n.at}: ${n.text}`)

  const byCheck = n => findings.filter(f => f.check === n).length
  const checks = {
    1: { title: 'says what it touches', findings: byCheck(1) },
    2: { title: 'network and model calls', findings: byCheck(2) },
    3: { title: 'secret-shaped strings', findings: byCheck(3) },
    4: { title: 'tests present and passing', findings: byCheck(4), ran: Boolean(tests.run?.started) },
    5: { title: 'installs and removes cleanly', manual: true },
    6: { title: 'licence', findings: byCheck(6) },
    0: { title: 'also', findings: byCheck(0) },
  }

  return {
    folder: rel,
    name: manifest.name ?? basename(dir),
    version: manifest.version ?? null,
    description: manifest.description ?? null,
    validate: { ok: v.ok, errors: v.errors, warnings: v.warnings },
    events: reach.events,
    calls: reach.calls,
    env: { reads: reach.envReads, writes: reach.envWrites },
    gates: reach.gates,
    programs: scan.programs.map(p => ({ ...p, said: nameLine(p.program) ?? (ALIASES[p.program]?.test(saidRaw) ? 'by another word' : null) })),
    runtimePrograms: scan.runtime,
    hosts: scan.hosts.map(h => ({ ...h, said: said.includes(h.host) ? nameLine(h.host) ?? 'the general text' : nameLine(hostLabel(h.host)) })),
    sends: scan.sends,
    sourceFiles: scan.files,
    reach: reachRows,
    gateRows,
    readme: readme ? { path: readme.path, section: readme.section, shared: readme.shared, also: readme.also?.path ?? null, words: wordsOutsideCode(readme.text), lines: readmeLines.length } : null,
    licence,
    tests: { files: tests.kit.length, other: tests.others.length, foreign: tests.foreign, run: tests.run },
    lastCommitDays: commitDays,
    checks,
    directory: { notes: directoryNotes, blocking: directoryBlocking.length },
    findings,
    warnings,
    review,
    verdict: findings.length ? 'FINDINGS' : 'PASS',
  }
}

// ---------- main ----------

const engine = engineVersion()
if (!engine) stop(`${CC} is not a Claude Code binary; set CLAUDE_BIN`)
if (olderThan(engine, MIN_ENGINE)) stop(`${CC} is Claude Code ${engine}; mods need ${MIN_ENGINE} or newer`)
if (!existsSync(join(HERE, 'check-directory.mjs'))) stop(`check-directory.mjs is not beside this script in ${HERE}`)

const { root, url, temp } = fetchSource(source)
const cleanup = () => { if (temp && !keep) rmSync(temp, { recursive: true, force: true }) }
const commit = git(root, 'rev-parse', '--short', 'HEAD')?.trim() ?? null
const committedAt = git(root, 'log', '-1', '--format=%cI')?.trim() ?? null
const commitDays = committedAt ? Math.floor((Date.now() - Date.parse(committedAt)) / 86_400_000) : null
const { found, kept, skipped } = pluginFolders(root)
let folders = kept
if (only) {
  const want = resolve(root, only)
  folders = found.filter(d => d === want || basename(d) === only || relative(root, d) === only.replace(/\/$/, ''))
  if (!folders.length) { cleanup(); stop(`no plugin folder named ${only} under ${url ?? root}`) }
}
if (!folders.length) { cleanup(); stop(`no plugin folder (.claude-plugin/plugin.json) under ${url ?? root}${skipped.length ? `, apart from ${skipped.map(s => s.folder).join(', ')} (skipped as docs, tests or fixtures; name one with --mod)` : ''}`) }

const results = folders.map(dir => checkPlugin(root, dir, commitDays))
const report = { source, url, commit, committedAt, engine, checkedAt: new Date().toISOString(), options: { test: runTests, directory: withDirectory }, clone: keep && temp ? root : null, skipped, plugins: results }
const exitCode = results.some(r => r.findings.length) ? 1 : 0

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`check-community: ${source}${url ? ` (${url})` : ''}${commit ? ` at ${commit}` : ''}${committedAt ? ` (committed ${committedAt.slice(0, 10)}, ${plural(commitDays, 'day')} ago)` : ''}, Claude Code ${engine}`)
  if (skipped.length) console.log(`skipped as docs, tests or fixtures (name one with --mod to check it): ${skipped.map(s => s.folder).join(', ')}`)
  for (const r of results) {
    console.log(`\n${r.verdict === 'PASS' ? 'ok' : '!!'}  ${r.name}${r.version ? ` ${r.version}` : ''}  (${r.folder})${r.description ? `: ${r.description}` : ''}`)
    console.log(`    validate: ${r.validate.ok ? 'ok' : 'FAILED'}`)
    if (r.events.length) console.log(`    hooks: ${r.events.join(', ')}`)
    if (r.calls.length) console.log(`    calls: ${r.calls.join(', ')}`)
    if (r.env.reads.length) console.log(`    env reads: ${r.env.reads.join(', ')}`)
    if (r.env.writes.length) console.log(`    env writes: ${r.env.writes.join(', ')}`)
    if (r.programs.length) console.log(`    programs run: ${uniq(r.programs.map(p => `${p.program}${p.viaShell ? ' (in a shell string)' : ''}${p.viaTool ? ` (through Claude's ${p.viaTool} tool)` : ''}${p.network ? ` (${p.network}${p.sends ? ', sends data' : ''})` : ''}${p.said ? ` (README ${p.said})` : ''}`)).join(', ')}`)
    if (r.sends.length) console.log(`    sends: ${r.sends.map(x => `${x.how} at ${x.at}`).join(', ')}`)
    if (r.hosts.length) console.log(`    hosts in the source: ${r.hosts.map(h => `${h.host}${h.where !== 'source' ? ` (${h.where})` : ''}${h.said ? ` (README ${h.said})` : ''}`).join(', ')}`)
    for (const row of r.reach) console.log(`    reach: ${row.id} (${row.calls.join(', ')}) ${row.declared ? `said at README line ${row.line ?? '?'}` : 'NOT in the README'}`)
    for (const row of r.gateRows) console.log(`    gate: ${row.id} (${row.hooks.join(', ')}) ${row.declared ? 'said in the README' : 'NOT in the README'}`)
    console.log(`    README: ${r.readme ? `${r.readme.path}${r.readme.section ? ` (its section, ${r.readme.section})` : ''}${r.readme.also ? ` with ${r.readme.also}'s general text` : ''}, ${plural(r.readme.words, 'word')}, ${plural(r.readme.lines, 'line')}` : 'none'}; licence: ${r.licence ? `${r.licence.kind ?? 'unrecognised'} (${r.licence.where})` : 'none'}; tests: ${plural(r.tests.files, 'kit test file')}${r.tests.other ? ` + ${r.tests.other} for another runner` : ''}${r.tests.run?.started ? `, ran: ${r.tests.run.pass} pass, ${r.tests.run.fail} fail` : ''}`)
    for (const n of [1, 2, 3, 4, 5, 6, 0]) {
      const c = r.checks[n]
      const label = n === 0 ? 'also' : `${n} ${c.title}`
      let state = 'ok'
      if (c.manual) state = 'by hand (the record says what was done)'
      else if (c.findings) state = plural(c.findings, 'finding')
      else if (n === 4 && !c.ran) state = runTests ? 'files ok, tests not run' : 'files ok (not run; --test runs them)'
      console.log(`    ${label}: ${state}`)
    }
    const notes = r.directory.notes
    if (notes.length) {
      const groups = new Map()
      for (const n of notes) { const k = `${n.kind}${n.inTests ? ' in tests or docs' : ''}`; groups.set(k, (groups.get(k) ?? 0) + 1) }
      console.log(`    directory: ${r.directory.blocking ? `would be refused (${plural(r.directory.blocking, 'blocking rule')})` : 'notes only'}: ${[...groups].map(([k, n]) => `${k} x${n}`).join(', ')}${withDirectory ? '' : '; --directory lists them'}`)
      if (withDirectory) for (const n of notes) console.log(`      ${n.blocking ? 'BLOCK' : 'note '}  ${n.kind}  ${n.at}: ${n.text}`)
    }
    for (const f of r.findings) console.log(`    FINDING ${f.check === 0 ? '-' : f.check === 7 ? 'D' : f.check}  ${f.text}`)
    for (const n of r.review) console.log(`    review  ${n.check}  ${n.text}`)
    for (const w of r.warnings) console.log(`    warning ${w.check === 0 ? '-' : w.check}  ${w.text}`)
  }
  const bad = results.filter(r => r.findings.length)
  console.log(`\nverdict: ${bad.length ? `FINDINGS in ${plural(bad.length, 'plugin')} of ${results.length}` : `PASS (${plural(results.length, 'plugin')})`}; check 5 (install and removal) is by hand${keep && temp ? `; clone kept at ${root}` : ''}`)
}

cleanup()
process.exitCode = exitCode
