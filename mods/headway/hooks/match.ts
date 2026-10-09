// Fuzzy step matching: tells a renamed step from a new one when Claude
// rewrites its plan. Pure functions, no engine calls.

/** Letter-pair (Dice) overlap at or above this counts as the same step. */
export const LETTERS_MIN = 0.75
/** Word (Jaccard) overlap at or above this counts as the same step. */
export const WORDS_MIN = 0.6

const STOPWORDS = new Set(['a', 'an', 'the', 'to', 'for', 'of', 'and', 'in', 'on', 'with', 'into', 'from', 'by', 'at', 'it', 'its', 'up'])

/** Lower case, punctuation to spaces, one space between words. */
export function normalize(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The words that carry meaning: no stopwords, a plural `s` dropped. */
export function words(title: string): string[] {
  return normalize(title)
    .split(' ')
    .filter(word => word !== '' && !STOPWORDS.has(word))
    .map(word => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word))
}

function pairs(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (let i = 0; i < text.length - 1; i += 1) {
    const pair = text.slice(i, i + 2)
    counts.set(pair, (counts.get(pair) ?? 0) + 1)
  }
  return counts
}

/** Dice coefficient over letter pairs of the normalized titles, 0 to 1. */
export function letterOverlap(a: string, b: string): number {
  const left = normalize(a)
  const right = normalize(b)
  if (left === right) return left === '' ? 0 : 1
  if (left.length < 2 || right.length < 2) return 0
  const leftPairs = pairs(left)
  const rightPairs = pairs(right)
  let shared = 0
  for (const [pair, count] of leftPairs) shared += Math.min(count, rightPairs.get(pair) ?? 0)
  return (2 * shared) / (left.length - 1 + (right.length - 1))
}

/** Jaccard overlap of the meaningful words, 0 to 1. */
export function wordOverlap(a: string, b: string): number {
  const left = new Set(words(a))
  const right = new Set(words(b))
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const word of left) if (right.has(word)) shared += 1
  return shared / (left.size + right.size - shared)
}

/** How alike two titles are; 1 or more means "the same step". */
export function sameness(a: string, b: string): number {
  return Math.max(letterOverlap(a, b) / LETTERS_MIN, wordOverlap(a, b) / WORDS_MIN)
}

export function isSameStep(a: string, b: string): boolean {
  return sameness(a, b) >= 1
}

export type Pairing = {
  /** Each new index's old index, or -1 for a step that is new. */
  oldOf: number[]
  /** Whether the pair matched on the exact (normalized) title. */
  isExact: boolean[]
  added: number
  removed: number
  matched: number
}

/**
 * Pairs a plan's old step titles with its new ones, one to one: exact
 * (normalized) titles first, in order, then the most alike pairs above the
 * threshold. What is left is added (new side) or removed (old side).
 */
export function pairTitles(oldTitles: readonly string[], newTitles: readonly string[]): Pairing {
  const oldOf = newTitles.map(() => -1)
  const isExact = newTitles.map(() => false)
  const taken = oldTitles.map(() => false)

  const oldNorm = oldTitles.map(normalize)
  newTitles.forEach((title, j) => {
    const norm = normalize(title)
    const i = oldNorm.findIndex((candidate, k) => !taken[k] && candidate === norm && norm !== '')
    if (i >= 0) {
      taken[i] = true
      oldOf[j] = i
      isExact[j] = true
    }
  })

  const candidates: { i: number; j: number; score: number }[] = []
  newTitles.forEach((title, j) => {
    if (oldOf[j] !== -1) return
    oldTitles.forEach((old, i) => {
      if (taken[i]) return
      const score = sameness(old, title)
      if (score >= 1) candidates.push({ i, j, score })
    })
  })
  candidates.sort((x, y) => y.score - x.score || x.j - y.j || x.i - y.i)
  for (const { i, j } of candidates) {
    if (taken[i] || oldOf[j] !== -1) continue
    taken[i] = true
    oldOf[j] = i
  }

  const matched = oldOf.filter(i => i !== -1).length
  return { oldOf, isExact, added: newTitles.length - matched, removed: oldTitles.length - matched, matched }
}

/** Pairs by exact identity (task ids): no fuzziness needed. */
export function pairKeys(oldKeys: readonly string[], newKeys: readonly string[]): Pairing {
  const oldOf = newKeys.map(key => oldKeys.indexOf(key))
  const matched = oldOf.filter(i => i !== -1).length
  return {
    oldOf,
    isExact: newKeys.map(() => true),
    added: newKeys.length - matched,
    removed: oldKeys.length - matched,
    matched,
  }
}
