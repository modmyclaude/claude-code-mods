#!/usr/bin/env node
// Every mod that changed between two commits carries a new version, so `/plugin update` delivers
// the change: Claude Code fetches a mod only when its version moved. A change to a mod's README or
// tests alone needs no bump, and a draft mod (draft: true in its prompt) is not in the marketplace
// yet. A bumped mod also has its line in CHANGELOG.md.
// Usage: node scripts/check-versions.mjs <base> [head]   (an all-zero base, a branch's first push, checks nothing)
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [base, head = 'HEAD'] = process.argv.slice(2)
if (!base) {
  console.error('usage: node scripts/check-versions.mjs <base> [head]')
  process.exit(2)
}
if (/^0+$/.test(base)) {
  console.log('no base commit: nothing to check')
  process.exit(0)
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const ROOT = git('rev-parse', '--show-toplevel').trim()
const NOT_SHIPPED = [/^mods\/[^/]+\/README\.md$/, /^mods\/[^/]+\/tests\//]

const changed = git('diff', '--name-only', base, head, '--', 'mods').split('\n').filter(Boolean)
const shipped = changed.filter(path => !NOT_SHIPPED.some(re => re.test(path)))
const mods = [...new Set(shipped.map(path => path.split('/')[1]))].filter(Boolean).sort()

/** The mod's version at a commit; undefined when it had no manifest there (a new mod), null when the manifest has none. */
function versionAt(ref, mod) {
  try {
    const manifest = JSON.parse(git('show', `${ref}:mods/${mod}/.claude-plugin/plugin.json`))
    return typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    return undefined
  }
}

function isDraft(mod) {
  const prompt = join(ROOT, 'prompts', `${mod}.md`)
  if (!existsSync(prompt)) return false
  const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(prompt, 'utf8'))
  return front !== null && /^draft:\s*true\s*$/m.test(front[1])
}

const changelog = existsSync(join(ROOT, 'CHANGELOG.md')) ? readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8') : ''
let problems = 0
for (const mod of mods) {
  const before = versionAt(base, mod)
  const after = versionAt(head, mod)
  if (before === undefined) {
    console.log(`ok  ${mod}: new at ${after ?? 'no version'}`)
    continue
  }
  if (isDraft(mod)) {
    console.log(`ok  ${mod}: a draft, not in the marketplace yet`)
    continue
  }
  if (after === undefined || after === null) {
    console.log(`!!  ${mod}: no version in mods/${mod}/.claude-plugin/plugin.json`)
    problems++
    continue
  }
  if (before === after) {
    console.log(`!!  ${mod}: changed since ${base.slice(0, 7)} but still ${after}; bump the version in mods/${mod}/.claude-plugin/plugin.json and add a line to CHANGELOG.md`)
    problems++
    continue
  }
  if (!changelog.includes(`${mod} ${after}`)) {
    console.log(`!!  ${mod}: ${before} -> ${after}, but CHANGELOG.md has no line for ${mod} ${after}`)
    problems++
    continue
  }
  console.log(`ok  ${mod}: ${before} -> ${after}`)
}
if (mods.length === 0) console.log('no shipped mod file changed')
process.exit(problems > 0 ? 1 : 0)
