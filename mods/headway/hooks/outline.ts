// Turns an approved plan-mode plan (markdown) into stages and steps:
// headings become stages, top-level list items become steps.

import type { HeadwayOutline } from '../types'
import { clean } from './clean'
import { isSameStep, words } from './match'

export const MAX_STAGES = 20
export const MAX_STEPS = 100
export const MAX_TITLE = 120

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const ITEM = /^( *)(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?(.*\S)\s*$/
const FENCE = /^\s*(```|~~~)/

// Sections that describe the plan rather than steps of it.
const NOT_WORK =
  /^(context|background|overview|summary|goals?|non[- ]?goals?|notes?|risks?|open questions|questions|assumptions|references|out of scope|alternatives( considered)?|(critical |key |relevant )?files( to (change|modify|touch|edit))?|dependencies)\b/i

/**
 * Every title and stage name Headway draws passes through here, from every
 * source: controls and escapes go first (clean), then markdown emphasis,
 * code ticks and link targets; the length is capped.
 */
export function cleanText(text: string): string {
  const plain = clean(text)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return [...plain].length > MAX_TITLE ? [...plain].slice(0, MAX_TITLE - 1).join('') + '…' : plain
}

/** A heading as a stage name: "Phase 1: Build the API" reads "Build the API". */
export function stageName(heading: string): string {
  const text = cleanText(heading)
  const bare = text
    .replace(/^(phase|stage|step|part|milestone)\s+[\w.]+\s*[:.)-]\s*/i, '')
    .replace(/^\d+[.):]\s*/, '')
    .replace(/[:.]$/, '')
    .trim()
  return bare === '' ? text : bare
}

/** A list item as a step title: a bold lead-in wins, else the whole item. */
export function stepTitle(item: string): string {
  const lead = /^\*\*(.+?)\*\*/.exec(item) ?? /^__(.+?)__/.exec(item)
  const text = cleanText(lead?.[1] ?? item)
  return text.replace(/[:.]$/, '').trim()
}

/**
 * Reads the plan's outline. The stage level is the shallowest heading level
 * used at least twice; sections such as Context or Risks are left out, and
 * only top-level items count (sub-bullets are detail). Fewer than two stages
 * with steps reads as one flat stage. Null when the plan lists no steps.
 */
export function parseOutline(markdown: string): HeadwayOutline | null {
  const lines = markdown.split(/\r?\n/)
  const isCode: boolean[] = []
  let inFence = false
  for (const line of lines) {
    const isFence = FENCE.test(line)
    isCode.push(inFence || isFence)
    if (isFence) inFence = !inFence
  }

  const levels = new Map<number, number>()
  lines.forEach((line, n) => {
    const heading = isCode[n] ? null : HEADING.exec(line)
    if (heading?.[1]) levels.set(heading[1].length, (levels.get(heading[1].length) ?? 0) + 1)
  })
  const stageLevel = [...levels.entries()]
    .filter(([, count]) => count >= 2)
    .map(([level]) => level)
    .sort((a, b) => a - b)[0]

  const stages: { name: string; steps: string[] }[] = []
  const loose: string[] = []
  let current: { name: string; steps: string[] } | null = null
  // A non-work section hides its items: at the stage level, or as a sub-heading inside a stage.
  let isStageSkipped = false
  let isSubSkipped = false

  lines.forEach((line, n) => {
    if (isCode[n]) return
    const heading = HEADING.exec(line)
    if (heading?.[1] && heading[2] !== undefined) {
      const level = heading[1].length
      const skip = NOT_WORK.test(cleanText(heading[2]))
      if (stageLevel !== undefined && level === stageLevel) {
        current = skip ? null : { name: stageName(heading[2]), steps: [] }
        if (current) stages.push(current)
        isStageSkipped = skip
        isSubSkipped = false
      } else if (stageLevel !== undefined && level < stageLevel) {
        // A heading above the stage level (the plan's title) ends any stage.
        current = null
        isStageSkipped = skip
        isSubSkipped = false
      } else {
        isSubSkipped = skip
      }
      return
    }
    const item = ITEM.exec(line)
    if (!item || item[2] === undefined || (item[1] ?? '').length > 1 || isStageSkipped || isSubSkipped) return
    const title = stepTitle(item[2])
    if (title === '') return
    if (current) current.steps.push(title)
    else loose.push(title)
  })

  const staged = stages.filter(stage => stage.steps.length > 0).slice(0, MAX_STAGES)
  if (staged.length >= 2) {
    const steps = staged.flatMap((stage, index) => stage.steps.map(title => ({ title, stage: index })))
    return { stages: staged.map(stage => stage.name), steps: steps.slice(0, MAX_STEPS) }
  }
  const flat = [...staged.flatMap(stage => stage.steps), ...loose].slice(0, MAX_STEPS)
  return flat.length === 0 ? null : { stages: [''], steps: flat.map(title => ({ title, stage: 0 })) }
}

/**
 * Which outline stage a tracked step belongs to: the stage of the outline
 * step it matches, else a stage whose name's words all appear in it; null
 * when neither.
 */
export function stageOfTitle(title: string, outline: HeadwayOutline): number | null {
  const step = outline.steps.find(candidate => isSameStep(candidate.title, title))
  if (step) return step.stage
  const titleWords = new Set(words(title))
  const index = outline.stages.findIndex(name => {
    const nameWords = words(name)
    return nameWords.length > 0 && nameWords.every(word => titleWords.has(word))
  })
  return index >= 0 ? index : null
}

/**
 * Stages for a tracked list: an outline's stages when at least one step
 * matches them (an unmatched step takes the stage of the step before it),
 * else one flat stage.
 */
export function stageList(titles: readonly string[], outline: HeadwayOutline | null): { stages: string[]; stageOf: number[] } {
  const flat = { stages: [''], stageOf: titles.map(() => 0) }
  if (!outline || outline.stages.length < 2) return flat
  let hits = 0
  let previous = 0
  const stageOf = titles.map(title => {
    const stage = stageOfTitle(title, outline)
    if (stage === null) return previous
    hits += 1
    previous = stage
    return stage
  })
  return hits === 0 ? flat : { stages: outline.stages, stageOf }
}
