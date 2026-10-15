#!/usr/bin/env node
// Checks every relative link and image in the repo's tracked Markdown: the file must exist, and a
// `#heading` link into a Markdown file must match one of its headings. Web links are not fetched.
// Exits 1 and lists each broken link.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const files = execFileSync('git', ['ls-files', '*.md'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)

// GitHub's heading anchors: lower case, drop punctuation but hyphens and spaces, spaces to hyphens,
// numbered when a heading repeats.
function anchorsOf(file) {
  const seen = new Map()
  const out = new Set()
  const text = readFileSync(join(ROOT, file), 'utf8').replace(/```[\s\S]*?```/g, '')
  for (const [, heading] of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = heading
      .replace(/<[^>]+>/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*_]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s/g, '-')
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    out.add(n ? `${base}-${n}` : base)
  }
  return out
}

const broken = []
for (const file of files) {
  const text = readFileSync(join(ROOT, file), 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  const targets = [
    ...[...text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map(m => m[1]),
    ...[...text.matchAll(/\b(?:src|srcset|href)="([^"]+)"/g)].map(m => m[1]),
  ]
  for (const target of targets) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue // web, mailto and other schemes
    const [pathPart, anchor] = target.split('#')
    const path = decodeURIComponent(pathPart.split('?')[0])
    const resolved = path ? normalize(join(dirname(file), path)) : file
    if (resolved.startsWith('..')) { broken.push(`${file}: ${target} (points outside the repo)`); continue }
    if (!existsSync(join(ROOT, resolved))) { broken.push(`${file}: ${target} (no such file)`); continue }
    if (anchor && resolved.endsWith('.md') && statSync(join(ROOT, resolved)).isFile() && !anchorsOf(resolved).has(anchor.toLowerCase())) {
      broken.push(`${file}: ${target} (no heading #${anchor} in ${relative('.', resolved)})`)
    }
  }
}

for (const line of broken) console.error(`broken link: ${line}`)
console.log(`checked links in ${files.length} Markdown file(s), ${broken.length ? `${broken.length} broken` : 'all good'}`)
process.exit(broken.length ? 1 : 0)
