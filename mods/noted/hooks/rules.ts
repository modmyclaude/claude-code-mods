// Reading and editing the "## House rules" section of a CLAUDE.md file.
// Every edit is an insertion, a one-line replacement or a one-line removal
// at an exact offset, so the rest of the file comes back byte-for-byte.

import { stripControls } from './text'

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

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const ANY_HEADING = /^ {0,3}(#{1,6})(?:[ \t]|$)/
const HOUSE_HEADING = /^ {0,3}(#{1,6})[ \t]+house rules[ \t]*#*[ \t]*$/i
const BULLET = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)(.*\S)[ \t]*$/

/**
 * A House rules section: its heading, every line under it, the lines before
 * any nested sub-heading (where a new rule goes), and its list items.
 */
type Section = { heading: Line; body: Line[]; lead: Line[]; items: RuleLine[] }
type RuleLine = { rule: string; line: Line; prefix: string }
/** The sections, and where a code fence that never closes opens (or null). */
type Parsed = { sections: Section[]; openFence: number | null }

/** Every House rules section, headings and bullets inside code fences ignored. */
function parse(content: string): Parsed {
  const found: Section[] = []
  let current: Section | null = null
  let level = 0
  let nested = false
  // A fence closes only on the same character, at least as long, with no info string.
  let fence: { char: string; length: number; start: number } | null = null
  for (const line of splitLines(content)) {
    // A byte order mark is not part of the first line's text.
    const text = line.start === 0 ? line.text.replace(/^\ufeff/, '') : line.text
    const marker = FENCE.exec(text)
    let isCode = fence !== null
    if (marker) {
      const run = marker[1] ?? ''
      if (fence === null) {
        fence = { char: run[0] ?? '`', length: run.length, start: line.start }
        isCode = true
      } else if (run[0] === fence.char && run.length >= fence.length && (marker[2] ?? '').trim() === '') {
        fence = null
      }
    }

    if (!isCode) {
      const house = HOUSE_HEADING.exec(text)
      if (house) {
        current = { heading: line, body: [], lead: [], items: [] }
        level = house[1]?.length ?? 2
        nested = false
        found.push(current)
        continue
      }
      const heading = ANY_HEADING.exec(text)
      if (heading && current) {
        if ((heading[1]?.length ?? 1) <= level) current = null
        else nested = true
      }
    }
    if (!current) continue
    current.body.push(line)
    if (!nested) current.lead.push(line)
    const bullet = isCode ? null : BULLET.exec(text)
    if (bullet) current.items.push({ rule: bullet[2] ?? '', line, prefix: bullet[1] ?? '- ' })
  }
  return { sections: found, openFence: fence?.start ?? null }
}

function ruleLines(content: string): RuleLine[] {
  return parse(content).sections.flatMap(s => s.items)
}

/** The rules listed under every House rules heading, in file order. */
export function houseRules(content: string): string[] {
  return ruleLines(content).map(r => r.rule)
}

/**
 * A rule's comparable form: terminal escapes, case, punctuation, markdown
 * marks and "do not" / "don't" spelling folded, so near-identical rules
 * compare equal.
 */
export function normalizeRule(rule: string): string {
  return stripControls(rule)
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
 * one line, no control characters, no leading bullet or wrapping quotes.
 * '' when nothing is left.
 */
export function cleanRule(rule: string): string {
  return stripControls(rule)
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
 * The file with `rule` added at the end of the first House rules section
 * (before any sub-heading in it), or with the heading and the rule appended
 * when there is none. Nothing that was in the file moves or changes.
 * Null when a code fence that never closes would swallow the new line
 * wherever it went (it opens before the section, or there is no section).
 */
export function appendRule(content: string, rule: string): string | null {
  const eol = eolOf(content)
  const { sections, openFence } = parse(content)
  const first = sections[0]
  let at: number
  let text: string
  if (first) {
    // Before a fence that never closes, if one opens inside the section.
    const usable = first.lead.filter(l => l.text.trim() !== '' && (openFence === null || l.start < openFence))
    const last = usable.at(-1) ?? first.heading
    // A heading with nothing under it yet gets a blank line before the list.
    at = last.end
    text = `${last === first.heading ? eol + eol : eol}- ${rule}`
  } else {
    const gap = content === '' || content.endsWith(eol + eol) ? '' : content.endsWith(eol) ? eol : eol + eol
    at = content.length
    text = `${gap}${HEADING}${eol}${eol}- ${rule}${eol}`
  }
  if (openFence !== null && openFence < at) return null
  return content.slice(0, at) + text + content.slice(at)
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
