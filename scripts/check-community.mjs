#!/usr/bin/env node
// One command that runs this repository's static checks on a mod someone else published,
// without loading or running it:
//
//   node scripts/check-community.mjs <git url | owner/repo | local folder> [--mod <subfolder>] [--ref <branch or tag>] [--json] [--keep]
//
// The repository is cloned shallowly into a temporary folder (a local folder is read in
// place), every plugin folder in it (one holding .claude-plugin/plugin.json) is found, and
// each is checked three ways:
//   validate    `claude plugin validate --json`: what Claude Code would refuse, and
//               what the mod hooks, calls on $ and reads from the environment
//   directory   scripts/check-directory.mjs on the folder (the plugin directory's source
//               rules: secret-shaped strings, invisible characters, refused events, ...), the
//               directory's repository rules on the clone (links, submodules, OS metadata
//               files, .gitattributes, file sizes) and the README and licence it requires
//   reach       what the mod can touch, read from the validator's report (files, network,
//               processes, environment, model calls, prompts it sends, messages to other
//               sessions, settings, sounds) and the gates it holds (tool calls, prompts,
//               permission answers, other mods), set against the README's own words: reach
//               the README never mentions is a finding, listed for a person to judge
// Nothing here loads the mod or runs its tests: the tool reads files and prints what it
// finds. Exit 0: pass. Exit 1: findings. Exit 2: the check itself could not run.
// CLAUDE_BIN names the Claude Code binary (2.1.287 or newer); otherwise `claude` on PATH.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CC = process.env.CLAUDE_BIN || 'claude'
const MIN_ENGINE = '2.1.287'
const USAGE = 'usage: node scripts/check-community.mjs <git url | owner/repo | local folder> [--mod <subfolder>] [--ref <branch or tag>] [--json] [--keep]'

const args = process.argv.slice(2)
const takeFlag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true }
const takeValue = name => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v }
const asJson = takeFlag('--json')
const keep = takeFlag('--keep')
const only = takeValue('--mod')
const ref = takeValue('--ref')
const source = args[0]
if (!source || args.length !== 1) stop(USAGE)

function stop(message) {
  console.error(`check-community: ${message}`)
  process.exit(2)
}

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

function fetchSource(src) {
  if (existsSync(src) && statSync(src).isDirectory()) return { root: resolve(src), url: null, temp: null }
  const url = /^[\w.-]+\/[\w.-]+$/.test(src) ? `https://github.com/${src}` : src
  const temp = mkdtempSync(join(tmpdir(), 'check-community-'))
  const root = join(temp, 'repo')
  const r = spawnSync('git', ['clone', '--depth', '1', '--quiet', ...(ref ? ['--branch', ref] : []), '--', url, root], {
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes' },
  })
  if (r.status !== 0) {
    rmSync(temp, { recursive: true, force: true })
    stop(`could not clone ${url}: ${(r.stderr || '').trim().split('\n').pop() || 'git failed'}`)
  }
  return { root, url, temp }
}

function git(root, ...a) {
  const r = spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout : null
}

function pluginFolders(root) {
  const out = []
  const walk = (dir, depth) => {
    if (depth > 4) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    if (existsSync(join(dir, '.claude-plugin', 'plugin.json'))) out.push(dir)
    for (const d of entries) {
      if (!d.isDirectory() || d.isSymbolicLink()) continue
      if (d.name === 'node_modules' || d.name === '.git' || d.name === '.claude-plugin') continue
      walk(join(dir, d.name), depth + 1)
    }
  }
  walk(root, 0)
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
  const uniq = xs => [...new Set(xs)]
  return {
    events: uniq(after(' hooks: ')),
    calls: uniq(after(' calls: ')),
    envReads: uniq(after(' env reads: ')),
    envWrites: uniq(after(' env writes: ')),
    gates: uniq(v.gates),
  }
}

// What a call on $ lets the mod reach, and the words a README uses when it says so.
const REACH = [
  { id: 'files written', call: /^\$\.fs\.write\b/, words: /\b(writes?|written|writing|saves?|saved|saving|creates?|stores?|appends?|rewrit(es|ten)|keeps?)\b.{0,30}\b(files?|folders?|director(y|ies)|disk|notes?|logs?|json|\.md)\b/ },
  { id: 'files read', call: /^\$\.fs\.(read|list|stat|exists|ancestors)\b/, words: /\b(reads?|reading|lists?|scans?|watch(es)?|looks? at|opens?)\b.{0,30}\b(files?|folders?|director(y|ies)|transcripts?|project|repo|tree|disk|notes?|logs?|json|\.env|\.md)\b|\bfiles? (it )?reads?\b/ },
  { id: 'network', call: /^\$\.(http\.fetch|mcp\.(call|connect))\b/, words: /\b(network|fetch(es|ed)?|https?|urls?|api|requests?|downloads?|uploads?|servers?|endpoints?|webhooks?|internet|online|cloud|sends? .{0,30}\bto\b|mcp)\b/ },
  { id: 'processes', call: /^\$\.process\.(run|spawn)\b/, words: /\b(runs?|running|ran|launch(es)?|starts?|spawns?|executes?|invokes?|shells? out|calls?)\b.{0,40}\b(commands?|scripts?|shell|programs?|process(es)?|binary|binaries|cli|validator|compiler|linter|formatter|test suite|tests|browser|chrome|chromium|git|npm|npx|node|python|bash|curl|docker|make)\b|\b(child )?process(es)?\b|\bsubprocess(es)?\b|\bshell commands?\b|\bruns:/ },
  { id: 'environment', call: /^\$\.env\.(get|set)\b/, words: /\b(environment|env(ironment)? variables?|env|api keys?)\b/, raw: /\$[A-Z][A-Z0-9_]{2,}\b|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b[A-Z][A-Z0-9_]{3,}=/ },
  { id: 'model calls', call: /^\$\.model\.(complete|classify|fork)\b/, words: /\b(model|llm|haiku|sonnet|opus|tokens?|costs?|spend|completions?|asks? claude|calls? (the )?(model|api))\b/ },
  { id: 'prompts sent as you', call: /^\$\.prompt\.submit\b/, words: /\b(submits?|sends?|starts?|re-?submits?|re-?sends?)\b.{0,40}\b(prompt|turn|message|request|words|it|them)\b|\b(prompt|turn|message)s?\b.{0,24}\b(goes? out|went out|sent|submitted)\b|on your behalf|\bas you\b|\bfor you\b|by itself|auto(matic(ally)?|-?submit|-?send|-?resume)/ },
  { id: 'messages to other sessions', call: /^\$\.session\.(send|authorize)\b/, words: /\b(other sessions?|another session|messages?|teammates?|agents?)\b/ },
  { id: 'settings changed', call: /^\$\.config\.set\b/, words: /\b(changes?|changing|sets?|setting|writes?|updates?|edits?|switch(es)?|flips?|applies?|turns? (on|off))\b.{0,30}\b(settings?|config(uration)?|theme|preferences?|options?|permission mode|model)\b|\bsettings? (it )?(changes?|sets?|writes?)|\bpermission mode\b|\/config\b/ },
  { id: 'sounds', call: /^\$\.audio\.(play|speak)\b/, words: /\b(sounds?|audio|speaks?|spoken|voice|chimes?|beeps?|plays? (a |the )?(sound|chime|tone|clip|note))\b/ },
]

// A hook that can answer for Claude Code, and the words a README uses when it says so.
const GATES = [
  { id: 'can hold, deny or answer tool calls', hook: /^tool\.(call|check)\b/, words: /\b(approv|allow|den(y|ies|ied)|block|holds?|refus|permission|guard|gate|intercept|stops?|rewrit)/ },
  { id: 'can change or drop a prompt', hook: /^prompt\.(submit|edit)\b/, words: /\b(prompts?|rewrit|drops?|edits?|changes? what)/ },
  { id: 'answers permission prompts', hook: /^classic\.PermissionRequest\b/, words: /\b(permission|approv|allow|den(y|ies))/ },
  { id: 'can refuse other mods or change what they get', hook: /^(plugin\.register|engine\.create)\b/, words: /\b(mods?|plugins?)\b/ },
  { id: 'changes what Claude reads (system prompt, context, reminders, skills)', hook: /^(prompt\.(compose|section|context|attachment)|skill\.prompt)\b/, words: /\b(system prompt|context|instructions?|reminders?|skills?|what claude (reads|sees|gets))/ },
  { id: 'rewrites transcript rows', hook: /^session\.append\b/, words: /\b(transcript|history|records?|rows?)\b/ },
  { id: 'reads or answers messages between sessions', hook: /^session\.(receive|send)\b/, words: /\b(sessions?|messages?|teammates?|agents?)\b/ },
  { id: 'sees telemetry records', hook: /^telemetry\./, words: /\btelemetry\b/ },
  { id: 'chooses or refuses subagents', hook: /^agent\.(spawn|offer)\b/, words: /\b(subagents?|agents?|teammates?)\b/ },
]

// ---------- the directory's rules ----------

function directoryRules(root, dir) {
  const r = spawnSync(process.execPath, [join(HERE, 'check-directory.mjs'), dir], { encoding: 'utf8', timeout: 300_000 })
  const here = at => { const [file, line] = at.split(/:(?=\d+$)/); const abs = resolve(HERE, '..', file); return `${relative(root, abs) || file}${line ? `:${line}` : ''}` }
  const findings = []
  let inMod = false
  for (const line of (r.stdout || '').split('\n')) {
    if (/^\d+ mods?: /.test(line)) break
    if (/^(ok|!!)\s+repository:/.test(line)) { inMod = false; continue }
    if (/^(ok|!!)\s+/.test(line)) { inMod = line.includes(dir); continue }
    const m = /^\s+(BLOCK|warn)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line)
    if (inMod && m) findings.push({ blocking: m[1] === 'BLOCK', kind: m[2], at: here(m[3]), text: m[4] })
  }
  if (!r.stdout) findings.push({ blocking: true, kind: 'TOOL', at: 'check-directory.mjs', text: `did not run: ${(r.stderr || '').trim().split('\n')[0] || `exit ${r.status}`}` })
  return findings
}

const OS_METADATA = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)(\/|$)/
const IMAGE_OR_FONT = /\.(png|jpe?g|gif|webp|svg|woff2?|ttf|otf)$/i

function repositoryRules(root, dir) {
  const out = []
  const listing = git(root, 'ls-files', '-s', '--', '.')
  if (listing === null) { out.push({ blocking: false, kind: 'REPO', at: root, text: 'not a git checkout, so links, submodules and the committed file list were not checked' }); return out }
  const inPlugin = rel => resolve(root, rel).startsWith(dir + '/') || resolve(root, rel) === dir
  let pluginFiles = 0
  for (const line of listing.split('\n').filter(Boolean)) {
    const m = /^(\d{6}) \S+ \d+\t(.*)$/.exec(line)
    if (!m) continue
    const [, mode, rel] = m
    if (mode === '120000') out.push({ blocking: true, kind: 'REPO', at: rel, text: 'a symbolic link in the commit; the directory refuses one that leaves the repository' })
    else if (mode === '160000') out.push({ blocking: true, kind: 'REPO', at: rel, text: 'a submodule; the directory refuses the commit when it cannot reach it' })
    if (OS_METADATA.test(rel)) out.push({ blocking: true, kind: 'REPO', at: rel, text: 'an OS metadata file in the commit; the directory refuses the whole commit' })
    if (/(^|\/)\.gitattributes$/.test(rel)) out.push({ blocking: true, kind: 'REPO', at: rel, text: 'a .gitattributes in the commit; the directory has stopped fetching on one' })
    if (inPlugin(rel)) {
      pluginFiles++
      let size = 0
      try { size = statSync(join(root, rel)).size } catch { size = 0 }
      if (size > 5 * 1024 * 1024) out.push({ blocking: true, kind: 'REPO', at: rel, text: `${Math.round(size / 1024 / 1024)} MiB; the directory stops at 5 MiB a file` })
      else if (size > 256 * 1024 && !IMAGE_OR_FONT.test(rel)) out.push({ blocking: false, kind: 'REPO', at: rel, text: `${Math.round(size / 1024)} KiB; the directory holds a text file over 256 KiB for a reviewer` })
    }
  }
  if (pluginFiles > 512) out.push({ blocking: false, kind: 'REPO', at: relative(root, dir) || '.', text: `${pluginFiles} files in the plugin folder; the directory holds more than 512 for a reviewer` })
  return out
}

// ---------- the README and the licence ----------

function readmeOf(dir, root) {
  for (const d of [dir, root]) {
    for (const name of ['README.md', 'readme.md', 'README', 'README.txt']) {
      const p = join(d, name)
      if (existsSync(p)) return { path: relative(root, p) || name, text: readFileSync(p, 'utf8') }
    }
  }
  return null
}

function wordsOutsideCode(md) {
  return md.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ').split(/\s+/).filter(Boolean).length
}

function licenceOf(dir, root, manifest) {
  if (manifest.license) return `license field: ${manifest.license}`
  for (const d of [dir, root]) {
    const hit = (existsSync(d) ? readdirSync(d) : []).find(n => /^(LICENSE|LICENCE|COPYING)(\.|$)/i.test(n))
    if (hit) return relative(root, join(d, hit)) || hit
  }
  return null
}

// ---------- one plugin folder ----------

function checkPlugin(root, dir) {
  const rel = relative(root, dir) || '.'
  let manifest = {}
  try { manifest = JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')) } catch { manifest = {} }
  const v = validate(dir)
  const reach = reachOf(v)
  const directory = directoryRules(root, dir)
  const repo = repositoryRules(root, dir)
  const readme = readmeOf(dir, root)
  const licence = licenceOf(dir, root, manifest)
  const saidRaw = `${readme?.text ?? ''}\n${manifest.description ?? ''}`
  const said = saidRaw.toLowerCase()
  // HOME and USERPROFILE are named by `~/` or "home folder" as well as by name.
  const names = n => saidRaw.includes(n) || ((n === 'HOME' || n === 'USERPROFILE') && /~\/|home (folder|directory)/i.test(saidRaw))

  const findings = []
  const warnings = []
  for (const e of v.errors) findings.push(`validate: ${e}`)
  for (const w of v.warnings) warnings.push(`validate: ${w}`)
  for (const f of [...directory, ...repo]) (f.blocking ? findings : warnings).push(`${f.kind} ${f.at}: ${f.text}`)
  if (!readme) findings.push('README: none in the plugin folder or the repository; the directory requires one of at least 40 words')
  else if (wordsOutsideCode(readme.text) < 40) findings.push(`README (${readme.path}): under 40 words outside code blocks; the directory requires at least 40`)
  if (!licence) findings.push('licence: no LICENSE file and no license field in plugin.json; the directory requires one')

  const reachRows = []
  for (const r of REACH) {
    const calls = reach.calls.filter(c => r.call.test(c))
    if (!calls.length) continue
    const declared = r.words.test(said) || (r.raw?.test(saidRaw) ?? false) || (r.id === 'environment' && reach.envReads.some(names))
    reachRows.push({ id: r.id, calls, declared })
    if (!declared) findings.push(`reach not in the README: ${r.id} (${calls.join(', ')})`)
  }
  const gateRows = []
  const hooked = [...reach.gates, ...reach.events]
  for (const g of GATES) {
    const hooks = [...new Set(hooked.filter(h => g.hook.test(h)))]
    if (!hooks.length) continue
    const declared = g.words.test(said)
    gateRows.push({ id: g.id, hooks, declared })
    if (!declared) findings.push(`gate not in the README: ${g.id} (${hooks.join(', ')})`)
  }
  const unnamed = reach.envReads.filter(n => !names(n))
  if (unnamed.length) warnings.push(`environment variables read but not named in the README: ${unnamed.join(', ')}`)

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
    reach: reachRows,
    gateRows,
    readme: readme ? { path: readme.path, words: wordsOutsideCode(readme.text) } : null,
    licence,
    directory,
    repository: repo,
    findings,
    warnings,
    verdict: findings.length ? 'FINDINGS' : 'PASS',
  }
}

// ---------- main ----------

const engine = engineVersion()
if (!engine) stop(`${CC} is not a Claude Code binary; set CLAUDE_BIN`)
if (olderThan(engine, MIN_ENGINE)) stop(`${CC} is Claude Code ${engine}; mods need ${MIN_ENGINE} or newer`)
if (!existsSync(join(HERE, 'check-directory.mjs'))) stop(`check-directory.mjs is not beside this script in ${HERE}`)

const { root, url, temp } = fetchSource(source)
const commit = git(root, 'rev-parse', '--short', 'HEAD')?.trim() ?? null
let folders = pluginFolders(root)
if (only) {
  const want = resolve(root, only)
  folders = folders.filter(d => d === want || basename(d) === only || relative(root, d) === only.replace(/\/$/, ''))
  if (!folders.length) { if (temp && !keep) rmSync(temp, { recursive: true, force: true }); stop(`no plugin folder named ${only} under ${url ?? root}`) }
}
if (!folders.length) { if (temp && !keep) rmSync(temp, { recursive: true, force: true }); stop(`no plugin folder (.claude-plugin/plugin.json) under ${url ?? root}`) }

const results = folders.map(dir => checkPlugin(root, dir))
const report = { source, url, commit, engine, checkedAt: new Date().toISOString(), clone: keep && temp ? root : null, plugins: results }
const exitCode = results.some(r => r.findings.length) ? 1 : 0

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
  console.log(`check-community: ${source}${url ? ` (${url})` : ''}${commit ? ` at ${commit}` : ''}, Claude Code ${engine}`)
  for (const r of results) {
    console.log(`\n${r.verdict === 'PASS' ? 'ok' : '!!'}  ${r.name}${r.version ? ` ${r.version}` : ''}  (${r.folder})${r.description ? `: ${r.description}` : ''}`)
    console.log(`    validate: ${r.validate.ok ? 'ok' : 'FAILED'}`)
    if (r.events.length) console.log(`    hooks: ${r.events.join(', ')}`)
    if (r.calls.length) console.log(`    calls: ${r.calls.join(', ')}`)
    if (r.env.reads.length) console.log(`    env reads: ${r.env.reads.join(', ')}`)
    if (r.env.writes.length) console.log(`    env writes: ${r.env.writes.join(', ')}`)
    for (const row of r.reach) console.log(`    reach: ${row.id} (${row.calls.join(', ')}) ${row.declared ? 'said in the README' : 'NOT in the README'}`)
    for (const row of r.gateRows) console.log(`    gate: ${row.id} (${row.hooks.join(', ')}) ${row.declared ? 'said in the README' : 'NOT in the README'}`)
    console.log(`    README: ${r.readme ? `${r.readme.path}, ${plural(r.readme.words, 'word')}` : 'none'}; licence: ${r.licence ?? 'none'}`)
    console.log(`    directory rules: ${r.directory.filter(f => f.blocking).length} blocking, ${plural(r.directory.filter(f => !f.blocking).length, 'warning')}; repository: ${r.repository.filter(f => f.blocking).length} blocking`)
    for (const f of r.findings) console.log(`    FINDING  ${f}`)
    for (const w of r.warnings) console.log(`    warning  ${w}`)
  }
  const bad = results.filter(r => r.findings.length)
  console.log(`\nverdict: ${bad.length ? `FINDINGS in ${plural(bad.length, 'plugin')} of ${results.length}` : `PASS (${plural(results.length, 'plugin')})`}${keep && temp ? `; clone kept at ${root}` : ''}`)
}

if (temp && !keep) rmSync(temp, { recursive: true, force: true })
process.exitCode = exitCode
