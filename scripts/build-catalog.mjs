#!/usr/bin/env node
// Builds every generated artifact from one source of truth:
//   prompts/<mod>.md frontmatter  +  mods/<mod>/.claude-plugin/plugin.json  +  `claude plugin validate --json`
// and writes:
//   .claude-plugin/marketplace.json   (what `/plugin install <mod> --marketplace modmyclaude/claude-code-mods` reads)
//   README.md                          (only the part between the catalogue markers)
//   site/mods.json                     (the gallery's data)
//
// Reach badges come from the validator's report of what each mod hooks and calls,
// never from hand-written claims. Run with CLAUDE_BIN pointing at Claude Code 2.1.287+.
// `--check` exits 1 if any generated file is out of date (for CI); `--counts` re-runs every
// mod's tests to refresh the published test counts (slow).

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, openSync, closeSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORG = 'modmyclaude'
const REPO = 'claude-code-mods'
const CC = process.env.CLAUDE_BIN || 'claude'
const CHECK = process.argv.includes('--check')

// Display order and headings for the catalogue.
const CATEGORIES = [
  ['safety', 'Safety'],
  ['cost', 'Cost and limits'],
  ['visibility', 'See what Claude is doing'],
  ['review', 'Review changes'],
  ['insight', 'Catch what you would miss'],
  ['memory', 'Memory'],
  ['workflow', 'Workflow'],
  ['alerts', 'Alerts'],
  ['looks', 'Looks'],
  ['fun', 'Fun'],
  ['wellness', 'Wellness'],
]

// Minimal frontmatter reader: `key: value` and `key: [a, b]` lines between the first two `---`.
function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return null
  const out = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/)
    if (!kv) continue
    const [, k, v] = kv
    out[k] = v.startsWith('[') ? v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean) : v.trim()
  }
  return out
}

// The copy-paste prompt is the first ```text block.
const promptText = text => (text.match(/```text\n([\s\S]*?)\n```/) || [])[1] || ''

// Map what the validator says a mod calls/hooks to plain-language reach badges.
const REACH_RULES = [
  [/\$\.fs\.write|fs\.write/, 'writes files'],
  [/\$\.fs\.(read|list|stat|exists|ancestors)|fs\.(read|list|stat|exists|ancestors)/, 'reads files'],
  [/process\.(run|spawn)/, 'runs commands'],
  [/http\.fetch/, 'network'],
  [/model\.(complete|classify|fork)/, 'calls a model'],
  [/session\.send/, 'sends messages'],
  [/mcp\.(call|connect)/, 'uses MCP'],
  [/audio\.(play|speak)/, 'plays sound'],
]

// Split a validator "hooks:" list on top-level ", " (matchers can hold commas inside braces).
function splitTop(list) {
  const out = []; let depth = 0; let cur = ''
  for (let i = 0; i < list.length; i++) {
    const ch = list[i]
    if (ch === '{') depth++
    if (ch === '}') depth--
    if (depth === 0 && list.startsWith(', ', i)) { out.push(cur); cur = ''; i++; continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

// "tool.call{tool=Bash}" -> "tool.call Bash", "command.run{command=rules}" -> "command.run /rules"
function eventLabel(raw) {
  const m = raw.match(/^([a-zA-Z.]+)(?:\{(.*)\})?$/)
  if (!m) return raw
  const [, name, matcher] = m
  if (!matcher) return name
  const first = matcher.match(/^(\w+)=([^,}\s]+)/)
  if (!first) return name
  return first[1] === 'command' ? `${name} /${first[2]}` : `${name} ${first[2]}`
}

// Slash commands as the mod registers them: $.command.register({ name, description }).
function commandsOf(modDir) {
  const hooks = join(modDir, 'hooks')
  const out = []
  for (const f of readdirSync(hooks).filter(f => /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/.test(f))) {
    const src = readFileSync(join(hooks, f), 'utf8')
    for (const m of src.matchAll(/command\.register\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      const name = m[1].match(/name:\s*(['"`])([^'"`]+)\1/)?.[2]
      const description = m[1].match(/description:\s*(['"`])((?:(?!\1)[\s\S])*)\1/)?.[2]?.replace(/\s+/g, ' ').trim()
      if (name && !out.some(c => c.name === name)) out.push({ name, description: description ?? '' })
    }
  }
  return out
}

const settingsOf = manifest => Object.entries(manifest.userConfig ?? {}).map(([key, f]) => ({
  key, type: f.type ?? 'string', default: f.sensitive ? undefined : f.default, description: f.description ?? f.title ?? '',
}))

// Test counts take a full test run per mod, so they refresh only with --counts;
// otherwise the count already published in site/mods.json is kept.
const COUNTS = process.argv.includes('--counts')
const PUBLISHED = (() => {
  try { return Object.fromEntries(JSON.parse(readFileSync(join(ROOT, 'site', 'mods.json'), 'utf8')).mods.map(m => [m.name, m.tests?.count ?? null])) } catch { return {} }
})()

function testsOf(modDir, name) {
  const dir = join(modDir, 'tests')
  const files = existsSync(dir) ? readdirSync(dir).filter(f => /\.test\.tsx?$/.test(f)) : []
  const text = files.map(f => readFileSync(join(dir, f), 'utf8')).join('\n')
  const surfaces = ['terminal', 'desktop', 'vscode', 'mobile'].filter(s => text.includes(`'${s}'`) || text.includes(`"${s}"`))
  let count = PUBLISHED[name] ?? null
  if (COUNTS || count === null) try {
    // Write to a file, not a pipe: the CLI can exit before a pipe drains and cut its output
    // (and the summary line) off at about 32 KB. Trust only a clean exit.
    const dir = mkdtempSync(join(tmpdir(), 'catalog-test-'))
    const logPath = join(dir, 'out.log')
    const fd = openSync(logPath, 'w')
    let run
    try { run = spawnSync(CC, ['plugin', 'test', modDir], { stdio: ['ignore', fd, fd] }) } finally { closeSync(fd) }
    const out = readFileSync(logPath, 'utf8')
    rmSync(dir, { recursive: true, force: true })
    if (run.status !== 0) throw new Error(`plugin test exited ${run.status}`)
    // Only a positive count replaces the published one, so a flaky or killed run never blanks it.
    const ran = Number(out.match(/(\d+) pass/)?.[1] ?? NaN)
    if (ran > 0) count = ran
  } catch {}
  return { count, surfaces }
}

const git = (...args) => { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return '' } }
const gitInfo = rel => ({
  added: git('log', '--diff-filter=A', '--format=%cs', '--', rel).split('\n').pop() || null,
  updated: git('log', '-1', '--format=%cs', '--', rel) || null,
  commit: git('log', '-1', '--format=%h', '--', rel) || null,
})
// Fields that legitimately differ after a squash merge or rebase; `--check` ignores them.
const VOLATILE = ['added', 'updated', 'commit']

function reachOf(modDir) {
  let report
  try {
    report = JSON.parse(execFileSync(CC, ['plugin', 'validate', '--json', modDir], { encoding: 'utf8' }))
  } catch (err) {
    return { ok: false, badges: ['unverified'], gates: [], notes: [String(err.message).split('\n')[0]], touches: null, events: [] }
  }
  const notes = report.contents.flatMap(c => c.notes || [])
  const calls = notes.filter(n => / calls: /.test(n)).join(' ')
  const badges = REACH_RULES.filter(([re]) => re.test(calls)).map(([, label]) => label)
  const gates = report.contents.flatMap(c => c.gatingHooks || []).map(g => g.hook)
  if (gates.some(g => g.startsWith('tool.call'))) badges.push('hooks tool calls')
  if (gates.some(g => g.startsWith('prompt.submit'))) badges.push('hooks prompts')
  const touches = {
    files: /fs\.write/.test(calls) ? 'read-write' : /fs\.(read|list|stat|exists|ancestors)/.test(calls) ? 'read' : 'none',
    commands: /process\.(run|spawn)/.test(calls),
    network: /http\.fetch/.test(calls),
    model: /model\.(complete|classify|fork)/.test(calls),
    sound: /audio\.(play|speak)/.test(calls),
    hooks: [...new Set(gates.map(g => g.split('{')[0]))],
  }
  const events = [...new Set(notes.filter(n => / hooks: /.test(n)).flatMap(n => splitTop(n.split(' hooks: ')[1])).map(eventLabel))]
  return { ok: report.success, badges: badges.length ? badges : ['display only'], gates, notes, touches, events }
}

// A mod is listed only once it is committed, so work in progress in a shared tree
// never shows up as installable. Outside a git checkout, everything on disk counts.
function isTracked(rel) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: ROOT, stdio: 'ignore' })
    return true
  } catch {
    try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd: ROOT, stdio: 'ignore' }); return false } catch { return true }
  }
}

function collect() {
  const mods = []
  for (const file of readdirSync(join(ROOT, 'prompts')).filter(f => f.endsWith('.md')).sort()) {
    const text = readFileSync(join(ROOT, 'prompts', file), 'utf8')
    const fm = frontmatter(text)
    if (!fm?.mod || fm.draft === 'true') continue
    const manifestPath = join(ROOT, 'mods', fm.mod, '.claude-plugin', 'plugin.json')
    if (!existsSync(manifestPath)) continue // prompt exists, mod not built yet: not listed
    if (!isTracked(`mods/${fm.mod}/.claude-plugin/plugin.json`)) continue // built but not committed yet
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.name !== fm.mod) throw new Error(`${file}: mod "${fm.mod}" but plugin.json name "${manifest.name}"`)
    mods.push({
      name: fm.mod,
      title: fm.title,
      tagline: fm.tagline,
      category: fm.category,
      surfaces: fm.surfaces || [],
      modelCalls: fm.model_calls || 'none',
      version: manifest.version,
      keywords: manifest.keywords || [],
      prompt: promptText(text),
      media: ['gif', 'png', 'webp'].map(ext => `${fm.mod}.${ext}`).find(f => existsSync(join(ROOT, 'site', 'media', f))) ?? null,
      readme: existsSync(join(ROOT, 'mods', fm.mod, 'README.md')) ? readFileSync(join(ROOT, 'mods', fm.mod, 'README.md'), 'utf8') : '',
      reach: reachOf(join(ROOT, 'mods', fm.mod)),
      commands: commandsOf(join(ROOT, 'mods', fm.mod)),
      settings: settingsOf(manifest),
      tests: testsOf(join(ROOT, 'mods', fm.mod), fm.mod),
      license: manifest.license ?? null,
      ...gitInfo(`mods/${fm.mod}`),
    })
  }
  return mods
}

function marketplace(mods) {
  return {
    name: ORG,
    owner: { name: ORG, url: `https://github.com/${ORG}` },
    metadata: { description: 'Curated, tested Claude Code mods. Every mod ships with the prompt that built it.' },
    plugins: mods.map(m => ({
      name: m.name,
      source: `./mods/${m.name}`,
      description: m.tagline,
      version: m.version,
      category: m.category,
      keywords: m.keywords,
    })),
  }
}

function catalogue(mods) {
  const lines = []
  for (const [cat, heading] of CATEGORIES) {
    const group = mods.filter(m => m.category === cat)
    if (!group.length) continue
    lines.push(`### ${heading}`, '', '| Mod | What it does | Can reach | Install |', '|---|---|---|---|')
    for (const m of group) {
      const reach = m.reach.badges.map(b => `\`${b}\``).join(' ')
      lines.push(`| [**${m.title}**](mods/${m.name}) | ${m.tagline} [Prompt](prompts/${m.name}.md) | ${reach} | \`${m.name}@${ORG}\` |`)
    }
    lines.push('')
  }
  const unknown = mods.filter(m => !CATEGORIES.some(([c]) => c === m.category))
  if (unknown.length) throw new Error(`unknown category: ${unknown.map(m => `${m.name}=${m.category}`).join(', ')}`)
  return lines.join('\n').trimEnd()
}

function replaceBetween(text, start, end, body) {
  const i = text.indexOf(start)
  const j = text.indexOf(end)
  if (i < 0 || j < i) return null
  return text.slice(0, i + start.length) + '\n' + body + '\n' + text.slice(j)
}

const mods = collect()
const outputs = new Map()
outputs.set('.claude-plugin/marketplace.json', JSON.stringify(marketplace(mods), null, 2) + '\n')
const starterDir = join(ROOT, 'prompts', 'starters')
const starters = existsSync(starterDir)
  ? readdirSync(starterDir).filter(f => f.endsWith('.md')).sort().map(f => {
      const text = readFileSync(join(starterDir, f), 'utf8')
      const fm = frontmatter(text) || {}
      return { name: fm.starter, title: fm.title, tagline: fm.tagline, prompt: promptText(text).replaceAll('ORG_TBD/REPO_TBD', `${ORG}/${REPO}`) }
    })
  : []
const site = { org: ORG, repo: REPO, generated: 'by scripts/build-catalog.mjs', mods: mods.map(({ reach, ...m }) => ({ ...m, reach: reach.badges, touches: reach.touches, events: reach.events })), starters }
outputs.set('site/mods.json', JSON.stringify(site, null, 2) + '\n')
const readmePath = join(ROOT, 'README.md')
if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, 'utf8')
  const next = replaceBetween(readme, '<!-- catalogue:start -->', '<!-- catalogue:end -->', catalogue(mods))
    ?.replace(/<!-- count -->\d*<!-- \/count -->/g, `<!-- count -->${mods.length}<!-- /count -->`)
  if (next) outputs.set('README.md', next)
}

function stripVolatile(json) {
  const data = JSON.parse(json)
  for (const m of data.mods ?? []) {
    for (const k of VOLATILE) delete m[k]
    if (m.tests) delete m.tests.count // counts move with every new test; refreshed with --counts
    // README and prompt text change with routine docs edits; the next regen picks them up.
    // Structure (names, taglines, categories, reach, events, commands, settings) stays strict.
    delete m.readme
    delete m.prompt
  }
  return JSON.stringify(data)
}

let stale = false
for (const [rel, content] of outputs) {
  const path = join(ROOT, rel)
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (current === content) continue
  if (CHECK && rel === 'site/mods.json' && current !== null && stripVolatile(current) === stripVolatile(content)) continue
  if (CHECK) { console.error(`out of date: ${rel}`); stale = true; continue }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  console.log(`wrote ${rel}`)
}
const failed = mods.filter(m => !m.reach.ok)
for (const m of failed) console.error(`validate failed: ${m.name}: ${m.reach.notes.join(' | ')}`)
const testTotal = mods.reduce((n, m) => n + (m.tests?.count ?? 0), 0)
console.log(`${mods.length} mods catalogued, ${testTotal} tests${failed.length ? `, ${failed.length} failed validation` : ''}`)
process.exit(stale || failed.length ? 1 : 0)
