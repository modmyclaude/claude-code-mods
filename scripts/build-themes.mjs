#!/usr/bin/env node
// Writes mods/wardrobe/themes/<look>.json, one Claude Code theme file per look,
// from the palettes in mods/wardrobe/hooks/themes.ts, so the files can never
// drift from what the mod draws. `--check` exits 1 when a committed file differs.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MOD = 'mods/wardrobe'
const src = readFileSync(join(MOD, 'hooks/themes.ts'), 'utf8')
const blocks = [...src.matchAll(/\{\s*\n\s+id: '([a-z-]+)',\s*\n\s+tone: '(dark|light)',\s*\n\s+blurb: '([^']*)',\s*\n\s+palette: \{([\s\S]*?)\},\s*\n\s+diff: \{([^}]*)\}/g)]
const NAMES = { noir: 'Noir', paper: 'Paper', 'tokyo-night': 'Tokyo Night', dracula: 'Dracula', catppuccin: 'Catppuccin', solarized: 'Solarized', nord: 'Nord', 'high-contrast': 'High contrast', colorblind: 'Colorblind', halloween: 'Halloween', christmas: 'Christmas', spring: 'Spring', summer: 'Summer', autumn: 'Autumn' }
const colours = text => Object.fromEntries([...text.matchAll(/(\w+): '(#[0-9a-fA-F]{6})'/g)].map(m => [m[1], m[2]]))

const want = new Map()
for (const [, id, tone, , pal, diff] of blocks) {
  const p = colours(pal)
  const d = colours(diff)
  // Keys this build of Claude Code reads from a theme file; every value is a palette colour.
  const overrides = {
    claude: p.accent, claudeShimmer: p.special, text: p.text, subtle: p.muted, inactive: p.muted, suggestion: p.info,
    success: p.ok, error: p.error, warning: p.warn, permission: p.special, promptBorder: p.accent, bashBorder: p.accent,
    userMessageBackground: p.bg, userMessageBackgroundHover: p.bg, diffAdded: d.addBg, diffRemoved: d.removeBg,
  }
  for (const k of Object.keys(overrides)) if (!overrides[k]) delete overrides[k]
  want.set(`${id}.json`, JSON.stringify({ name: `${NAMES[id] ?? id} (wardrobe)`, base: tone, overrides }, null, 2) + '\n')
}
if (want.size === 0) { console.error('no themes found in themes.ts'); process.exit(1) }

const dir = join(MOD, 'themes')
mkdirSync(dir, { recursive: true })
const have = new Set(existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')) : [])
const stale = []
for (const [file, text] of want) {
  const path = join(dir, file)
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) stale.push(file)
  if (!process.argv.includes('--check')) writeFileSync(path, text)
}
for (const file of have) if (!want.has(file)) stale.push(`${file} (no such look)`)
if (process.argv.includes('--check')) {
  if (stale.length) { console.error(`out of date: ${stale.join(', ')} (run: node scripts/build-themes.mjs)`); process.exit(1) }
  console.log(`${want.size} theme files up to date`)
} else console.log(`${want.size} theme files written`)
