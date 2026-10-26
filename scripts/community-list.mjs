#!/usr/bin/env node
// Validates community/mods.json and renders its table into COMMUNITY.md between the community markers.
//   node scripts/community-list.mjs           write the table
//   node scripts/community-list.mjs --check   fail if the table is out of date (CI)
//   node scripts/community-list.mjs --repos   ask GitHub that every listed repository still exists, is not archived,
//                                             has a licence GitHub can read, and still holds the checked commit
// GITHUB_TOKEN, when set, raises the API rate limit; the checks read repository metadata only, never code.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const REPOS = process.argv.includes('--repos')
const START = '<!-- community:start -->'
const END = '<!-- community:end -->'
const STATUS = new Set(['candidate', 'checked'])
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const SHA = /^[0-9a-f]{40}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

const problems = []
const problem = (s) => problems.push(s)

const list = JSON.parse(readFileSync(join(ROOT, 'community', 'mods.json'), 'utf8'))
if (list.schema !== 1) problem('schema must be 1')
if (!DATE.test(list.updated ?? '')) problem('updated must be a date (YYYY-MM-DD)')
if (!Array.isArray(list.mods)) problem('mods must be an array')
const names = new Set()
for (const m of list.mods ?? []) {
  const at = `mods.${m?.name ?? '?'}`
  for (const k of ['name', 'title', 'summary', 'author', 'repo', 'path', 'commit', 'kind', 'license', 'says', 'status']) {
    if (typeof m?.[k] !== 'string' || m[k].length === 0) problem(`${at}: ${k} must be a non-empty string`)
  }
  if (names.has(m?.name)) problem(`${at}: name listed twice`)
  names.add(m?.name)
  if (!REPO.test(m?.repo ?? '')) problem(`${at}: repo must be owner/name`)
  if (!SHA.test(m?.commit ?? '')) problem(`${at}: commit must be the full 40-character sha`)
  if (!STATUS.has(m?.status)) problem(`${at}: status must be candidate or checked`)
  if (!Array.isArray(m?.reach) || m.reach.length === 0 || m.reach.some(r => typeof r !== 'string')) problem(`${at}: reach must list at least one string`)
  const c = m?.checked
  if (!c || !DATE.test(c.date ?? '') || typeof c.claudeCode !== 'string' || !Array.isArray(c.passed)) problem(`${at}: checked needs date, claudeCode and passed[]`)
  if (m?.status === 'checked' && Array.isArray(c?.pending) && c.pending.length > 0) problem(`${at}: a checked mod has no pending checks`)
  if (m?.status === 'candidate' && !(Array.isArray(c?.pending) && c.pending.length > 0)) problem(`${at}: a candidate names what is still pending`)
}

function link(m) {
  const tree = m.path === '.' ? '' : `/tree/${m.commit}/${m.path}`
  return `https://github.com/${m.repo}${tree || `/tree/${m.commit}`}`
}
function row(m) {
  const notes = m.notes ? ` ${m.notes}` : ''
  const status = m.status === 'checked' ? 'checked' : 'candidate'
  return `| [**${m.title}**](${link(m)})<br>by [${m.author}](https://github.com/${m.author}) | ${m.summary}${notes} | ${m.reach.join('; ')} | ${status}, ${m.checked.date} on Claude Code ${m.checked.claudeCode}, tests ${m.checked.tests ?? 'n/a'} |`
}
const table = [
  '| Mod | What it does | What it can reach | Status |',
  '|---|---|---|---|',
  ...(list.mods ?? []).map(row),
  '',
  `${(list.mods ?? []).length} mods, list updated ${list.updated}.`,
].join('\n')

const mdPath = join(ROOT, 'COMMUNITY.md')
const md = readFileSync(mdPath, 'utf8')
const a = md.indexOf(START), b = md.indexOf(END)
if (a < 0 || b < 0 || b < a) problem('COMMUNITY.md is missing the community markers')
const next = a >= 0 && b > a ? md.slice(0, a + START.length) + '\n' + table + '\n' + md.slice(b) : md

if (problems.length === 0) {
  if (next !== md) {
    if (CHECK) problem('COMMUNITY.md table is out of date: run node scripts/community-list.mjs')
    else { writeFileSync(mdPath, next); console.log('wrote the table in COMMUNITY.md') }
  } else console.log('COMMUNITY.md table is up to date')
}

if (REPOS && problems.length === 0) {
  const headers = { 'User-Agent': 'modmyclaude-community-list', Accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const get = async (path) => {
    const res = await fetch(`https://api.github.com${path}`, { headers })
    return { status: res.status, body: res.ok ? await res.json() : null }
  }
  const repos = new Map()
  for (const m of list.mods) {
    const r = repos.get(m.repo) ?? { commits: new Set(), names: [] }
    r.commits.add(m.commit); r.names.push(m.name); repos.set(m.repo, r)
  }
  for (const [repo, r] of repos) {
    const info = await get(`/repos/${repo}`)
    if (info.status === 404) { problem(`${repo} (${r.names.join(', ')}): repository not found`); continue }
    if (info.status !== 200) { problem(`${repo}: GitHub answered ${info.status}`); continue }
    if (info.body.archived) problem(`${repo}: repository is archived`)
    const spdx = info.body.license?.spdx_id
    if (!spdx || spdx === 'NOASSERTION') problem(`${repo}: GitHub cannot read a licence (${spdx ?? 'none'})`)
    for (const sha of r.commits) {
      const c = await get(`/repos/${repo}/commits/${sha}`)
      if (c.status !== 200) problem(`${repo}: checked commit ${sha.slice(0, 12)} answered ${c.status}`)
    }
    if (problems.length === 0) console.log(`ok  ${repo}: ${spdx}, ${r.commits.size} checked commit(s) present`)
  }
}

for (const p of problems) console.error(`!!  ${p}`)
process.exit(problems.length ? 1 : 0)
