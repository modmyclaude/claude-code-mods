// Reading and editing the "## House rules" section of a CLAUDE.md file.
// Every edit is an insertion, a one-line replacement or a one-line removal
// at an exact offset, so the rest of the file comes back byte-for-byte.

export const HEADING = '## House rules'

/** A rule can be at most this long, so the file stays a list of one-liners. */
export const MAX_RULE_CHARS = 240

type Line = { start: number; end: number; next: number; text: string }

/** Lines with their offsets: `end` before the line break, `next` after it. */
function splitLines(s: string): Line[] {
  const out: Line[] = []
  let i = 0
  while (i < s.length) {
    const nl = s.indexOf('\n', i)
    const next = nl === -1 ? s.length : nl + 1
    const end = nl === -1 ? s.length : nl > i && s[nl - 1] === '\r' ? nl - 1 : nl
    out.push({ start: i, end, next, text: s.slice(i, end) })
    i = next
  }
  return out
}

const FENCE = /^ {0,3}(```|~~~)/
const ANY_HEADING = /^ {0,3}(#{1,6})(?:[ \t]|$)/
const HOUSE_HEADING = /^ {0,3}(#{1,6})[ \t]+house rules[ \t]*#*[ \t]*$/i
const BULLET = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)(.*\S)[ \t]*$/

/** A House rules section: its heading, every line under it, its list items. */
type Section = { heading: Line; body: Line[]; items: RuleLine[] }
type RuleLine = { rule: string; line: Line; prefix: string }

/** Every House rules section, headings and bullets inside code fences ignored. */
function sections(content: string): Section[] {
  const found: Section[] = []
  let current: Section | null = null
  let level = 0
  let fence: string | null = null
  for (const line of splitLines(content)) {
    const marker = FENCE.exec(line.text)?.[1]
    const isFenceLine = marker !== undefined && (fence === null || fence === marker)
    const isCode = fence !== null || isFenceLine
    if (isFenceLine) fence = fence === null ? (marker ?? null) : null

    if (!isCode) {
      const house = HOUSE_HEADING.exec(line.text)
      if (house) {
        current = { heading: line, body: [], items: [] }
        level = house[1]?.length ?? 2
        found.push(current)
        continue
      }
      const heading = ANY_HEADING.exec(line.text)
      if (heading && current && (heading[1]?.length ?? 1) <= level) current = null
    }
    if (!current) continue
    current.body.push(line)
    const bullet = isCode ? null : BULLET.exec(line.text)
    if (bullet) current.items.push({ rule: bullet[2] ?? '', line, prefix: bullet[1] ?? '- ' })
  }
  return found
}

function ruleLines(content: string): RuleLine[] {
  return sections(content).flatMap(s => s.items)
}

/** The rules listed under every House rules heading, in file order. */
export function houseRules(content: string): string[] {
  return ruleLines(content).map(r => r.rule)
}

/**
 * A rule's comparable form: case, punctuation, markdown marks and
 * "do not" / "don't" spelling folded, so near-identical rules compare equal.
 */
export function normalizeRule(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\bdo not\b/g, "don't")
    .replace(/\bplease\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when two rules say the same thing in near-identical words. */
export function sameRule(a: string, b: string): boolean {
  const na = normalizeRule(a)
  return na !== '' && na === normalizeRule(b)
}

/**
 * A rule (the model's or the person's) made safe to write as one list item:
 * one line, no leading bullet or wrapping quotes. '' when nothing is left.
 */
export function cleanRule(rule: string): string {
  return rule
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^["'`\u201c]+|["'`\u201d]+$/g, '')
    .trim()
}

function eolOf(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * The file with `rule` added after the last line of the first House rules
 * section, or with the heading and the rule appended when there is none.
 * Nothing that was in the file moves or changes.
 */
export function appendRule(content: string, rule: string): string {
  const eol = eolOf(content)
  const first = sections(content)[0]
  if (first) {
    const filled = first.body.filter(l => l.text.trim() !== '')
    const last = filled.at(-1) ?? first.heading
    // A heading with nothing under it yet gets a blank line before the list.
    const gap = last === first.heading ? eol + eol : eol
    return content.slice(0, last.end) + `${gap}- ${rule}` + content.slice(last.end)
  }
  const block = `${HEADING}${eol}${eol}- ${rule}${eol}`
  if (content === '') return block
  const gap = content.endsWith(eol + eol) ? '' : content.endsWith(eol) ? eol : eol + eol
  return content + gap + block
}

/** The file with the first House rule equal to `oldRule` reworded, or null. */
export function replaceRule(content: string, oldRule: string, newRule: string): string | null {
  const hit = ruleLines(content).find(r => sameRule(r.rule, oldRule))
  if (!hit) return null
  return content.slice(0, hit.line.start) + hit.prefix + newRule + content.slice(hit.line.end)
}

/** The file with the first House rule equal to `rule` removed, or null. */
export function removeRule(content: string, rule: string): string | null {
  const hit = ruleLines(content).find(r => sameRule(r.rule, rule))
  if (!hit) return null
  const { start, end, next } = hit.line
  // The file's last line, with no break after it, takes the break before it.
  if (next === end && start > 0) {
    return content.slice(0, content[start - 2] === '\r' ? start - 2 : start - 1)
  }
  return content.slice(0, start) + content.slice(next)
}
