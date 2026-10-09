// The pet's rules, kept pure so they can be tested on their own: hatching,
// the one-time roll, experience and evolution, the test-run detector, names,
// and the text of the stat card and the share card.

import type { HatchlingPet, HatchlingRarity, HatchlingSpecies, HatchlingStage } from '../types'
import { drawFrame, monoLines, speciesArt } from './art'
import { SPECIES } from './sprites'

export const HATCH_AT = 25
export const TEEN_XP = 200
export const ADULT_XP = 800
export const XP = { tool: 1, turn: 5, tests: 5 } as const
export const DAY_MS = 86_400_000

/** Rarity odds out of 64, so the top 6 bits of one random u32 pick exactly. */
export const RARITY_ODDS: readonly (readonly [HatchlingRarity, number])[] = [
  ['common', 36],
  ['uncommon', 18],
  ['rare', 8],
  ['legendary', 2],
]

/** Names a pet can hatch with when you have not chosen one. */
export const NAMES: readonly string[] = [
  'Pip', 'Mochi', 'Bean', 'Nib', 'Tofu', 'Fig', 'Nori', 'Juniper', 'Biscuit', 'Clover',
  'Sprout', 'Waffle', 'Ziggy', 'Momo', 'Dot', 'Kiwi', 'Bao', 'Puck', 'Tuffet', 'Quill',
  'Sable', 'Echo', 'Maple', 'Pocket',
]

export type Change = {
  pet: HatchlingPet
  isHatched: boolean
  evolved?: { from: HatchlingStage; to: HatchlingStage }
}

export function freshPet(now: number): HatchlingPet {
  return { v: 1, bornAt: now, eggCalls: 0, xp: 0, hidden: false, toolCalls: 0, turns: 0, testsPassed: 0 }
}

/**
 * Reads whatever the store held into a valid pet, field by field, so a
 * damaged or older record keeps everything that still makes sense. A valid
 * hatch is always kept: a pet is never rolled twice.
 */
export function normalizePet(raw: unknown, now: number): HatchlingPet {
  const pet = freshPet(now)
  if (raw === null || typeof raw !== 'object') return pet
  const r = raw as Record<string, unknown>
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
  if (typeof r.bornAt === 'number' && Number.isFinite(r.bornAt) && r.bornAt <= now) pet.bornAt = r.bornAt
  pet.eggCalls = Math.min(HATCH_AT, count(r.eggCalls))
  pet.xp = count(r.xp)
  pet.toolCalls = count(r.toolCalls)
  pet.turns = count(r.turns)
  pet.testsPassed = count(r.testsPassed)
  pet.hidden = r.hidden === true
  if (typeof r.name === 'string') {
    const name = cleanName(r.name)
    if ('name' in name) pet.name = name.name
  }
  const hatch = r.hatch as Record<string, unknown> | undefined
  if (hatch !== null && typeof hatch === 'object' && SPECIES.some(one => one.id === hatch.species)) {
    pet.hatch = {
      species: hatch.species as HatchlingSpecies,
      shiny: hatch.shiny === true,
      at: typeof hatch.at === 'number' && Number.isFinite(hatch.at) ? hatch.at : now,
    }
    pet.eggCalls = HATCH_AT
  }
  return pet
}

export function stageOf(pet: HatchlingPet): HatchlingStage {
  if (pet.hatch === undefined) return 'egg'
  return pet.xp >= ADULT_XP ? 'adult' : pet.xp >= TEEN_XP ? 'teen' : 'baby'
}

export function rarityOf(species: HatchlingSpecies): HatchlingRarity {
  return speciesArt(species).rarity
}

/**
 * The hatch roll. `u32` returns uniform 32-bit integers (crypto in the mod,
 * a fixed list in tests). Rarity first (top 6 bits, out of 64), then a
 * species of that rarity, then shiny at 1 in 64, then a name.
 */
export function rollHatch(u32: () => number): { species: HatchlingSpecies; shiny: boolean; name: string } {
  const pick = u32() >>> 26
  let rarity: HatchlingRarity = 'common'
  let floor = 0
  for (const [one, odds] of RARITY_ODDS) {
    if (pick < floor + odds) {
      rarity = one
      break
    }
    floor += odds
  }
  const pool = SPECIES.filter(one => one.rarity === rarity)
  const species = pool[Math.floor(((u32() >>> 0) / 2 ** 32) * pool.length)] ?? pool[0] ?? SPECIES[0]
  const shiny = u32() >>> 26 === 0
  const name = NAMES[Math.floor(((u32() >>> 0) / 2 ** 32) * NAMES.length)] ?? 'Pip'
  return { species: (species ?? SPECIES[0])!.id, shiny, name }
}

/** One uniform 32-bit integer from the platform's crypto source. */
export function cryptoU32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
}

/** One finished tool call: the egg counts toward hatching, a pet gains XP. */
export function applyToolCall(
  pet: HatchlingPet,
  outcome: { hasPassedTests: boolean },
  now: number,
  u32: () => number,
): Change {
  const before = stageOf(pet)
  const next: HatchlingPet = {
    ...pet,
    toolCalls: pet.toolCalls + 1,
    testsPassed: pet.testsPassed + (outcome.hasPassedTests ? 1 : 0),
  }
  if (pet.hatch === undefined) {
    next.eggCalls = Math.min(HATCH_AT, pet.eggCalls + 1)
    if (next.eggCalls < HATCH_AT) return { pet: next, isHatched: false }
    const roll = rollHatch(u32)
    next.hatch = { species: roll.species, shiny: roll.shiny, at: now }
    next.name = pet.name ?? roll.name
    return { pet: next, isHatched: true }
  }
  next.xp = pet.xp + XP.tool + (outcome.hasPassedTests ? XP.tests : 0)
  return withEvolution(before, next)
}

/** One finished turn of the main conversation. */
export function applyTurn(pet: HatchlingPet): Change {
  const before = stageOf(pet)
  const next: HatchlingPet = { ...pet, turns: pet.turns + 1 }
  if (pet.hatch === undefined) return { pet: next, isHatched: false }
  next.xp = pet.xp + XP.turn
  return withEvolution(before, next)
}

function withEvolution(before: HatchlingStage, pet: HatchlingPet): Change {
  const after = stageOf(pet)
  return after === before ? { pet, isHatched: false } : { pet, isHatched: false, evolved: { from: before, to: after } }
}

// ---------------------------------------------------------------- test runs

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

// Commands that only show text (a log, a file): their output is not a run.
const VIEWER = /^\s*(cat|bat|head|tail|less|more|grep|rg|ag|echo|printf|sed|awk|jq|wc|ls|find|git\s+(log|show|diff|blame))\b/

const FAILED: readonly RegExp[] = [
  /\b[1-9]\d* (failed|failing|failures?|errors?)\b/i,
  /\b(failed|failures|errors)[:=]?\s+[1-9]\d*/i,
  /^(?:#|ℹ)\s*fail\s+[1-9]\d*/m,
  /^\s*[1-9]\d* fail\s*$/m,
  /^FAIL\b/m,
  /--- FAIL\b/,
  /\bFAILED\b/,
]

const PASSED: readonly RegExp[] = [
  /^\s*Tests?:?\s+(?:\d+ \w+(?:, | \| ))*[1-9]\d* passed\b/m, // jest, vitest
  /^\s*Test Files\s+[1-9]\d* passed\b/m, // vitest
  /\b[1-9]\d* passed\b[^\n]*\bin [\d.]+s\b/, // pytest
  /^ok\s+\S+\s+(?:\(cached\)|[\d.]+s)/m, // go test
  /^PASS\s*$/m, // go test -v
  /test result: ok\. [1-9]\d* passed; 0 failed/, // cargo test
  /^(?:#|ℹ)\s*pass\s+[1-9]\d*/m, // node:test
  /^\s*[1-9]\d* passing\b/m, // mocha
  /\b[1-9]\d* (?:examples?|tests?|runs?), 0 failures\b/, // rspec, minitest, ExUnit
  /^\s*[1-9]\d* pass\s*$/m, // bun test
  /^ok \| [1-9]\d* passed \| 0 failed/m, // deno test
  /^OK \([1-9]\d* tests?, /m, // phpunit
  /^Ran [1-9]\d* tests? in [\d.]+s\s+OK\b/m, // python unittest
  /Passed!\s+-\s+Failed:\s+0, Passed:\s+[1-9]\d*/, // dotnet test
]

/**
 * True when a Bash command's output reads as a test run that passed: a
 * runner's summary with at least one pass and no failures anywhere.
 */
export function detectTestPass(command: string, output: string): boolean {
  if (VIEWER.test(command)) return false
  const text = output.replace(ANSI, '')
  if (FAILED.some(pattern => pattern.test(text))) return false
  return PASSED.some(pattern => pattern.test(text))
}

// ---------------------------------------------------------------- names

/** Checks a name typed after /pet name. */
export function cleanName(raw: string): { name: string } | { error: string } {
  const name = raw
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim()
  if (name === '') return { error: 'Give it a name, for example: /pet name Pip' }
  if ([...name].length > 16) return { error: 'Names are up to 16 characters.' }
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '._-]*$/u.test(name)) {
    return { error: "Names use letters, numbers, spaces and - ' . _" }
  }
  return { name }
}

// ---------------------------------------------------------------- text

export function daysTogether(pet: HatchlingPet, now: number): number {
  return Math.max(1, Math.floor((now - pet.bornAt) / DAY_MS) + 1)
}

export function nameOf(pet: HatchlingPet): string {
  return pet.name ?? (pet.hatch === undefined ? 'Egg' : 'Pip')
}

export function speciesName(pet: HatchlingPet): string {
  return pet.hatch === undefined ? 'egg' : speciesArt(pet.hatch.species).name
}

/** "Pip the Foldling" (or "Egg the egg" before a name is chosen). */
export function titleLine(pet: HatchlingPet): string {
  return pet.hatch === undefined && pet.name === undefined ? 'An egg' : `${nameOf(pet)} the ${speciesName(pet)}`
}

/** "rare - teen - shiny": the line the card renderer reads back. */
export function tagLine(pet: HatchlingPet, isLong = false): string {
  if (pet.hatch === undefined) return `egg - ${pet.eggCalls}/${HATCH_AT} to hatch`
  const shiny = pet.hatch.shiny ? ' - shiny' : isLong ? ' - not shiny' : ''
  return `${rarityOf(pet.hatch.species)} - ${stageOf(pet)}${shiny}`
}

export function xpLine(pet: HatchlingPet): string {
  if (pet.hatch === undefined) return `${pet.eggCalls} of ${HATCH_AT} tool calls - ${HATCH_AT - pet.eggCalls} more to hatch`
  const stage = stageOf(pet)
  if (stage === 'adult') return `XP ${pet.xp} - fully grown`
  const goal = stage === 'baby' ? TEEN_XP : ADULT_XP
  return `XP ${pet.xp} - ${goal - pet.xp} more to ${stage === 'baby' ? 'teen' : 'adult'}`
}

/** Progress toward the next stage, 0 to 1. */
export function progressOf(pet: HatchlingPet): number {
  if (pet.hatch === undefined) return pet.eggCalls / HATCH_AT
  const stage = stageOf(pet)
  if (stage === 'adult') return 1
  return stage === 'baby' ? pet.xp / TEEN_XP : (pet.xp - TEEN_XP) / (ADULT_XP - TEEN_XP)
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** The /pet stat card, as plain text (what the model also reads). */
export function statText(pet: HatchlingPet, now: number): string {
  return [
    titleLine(pet),
    tagLine(pet, true),
    xpLine(pet),
    `${plural(daysTogether(pet, now), 'day')} together - ${plural(pet.toolCalls, 'tool call')} - ${plural(pet.testsPassed, 'test run')} cheered`,
  ].join('\n')
}

const CARD_W = 30

/** The /pet card share card: about 30 x 12 plain characters, no colour. */
export function cardText(pet: HatchlingPet, now: number): string {
  const inner = CARD_W - 2
  const pad = (text: string) => {
    const chars = [...text].slice(0, inner - 2)
    return `│ ${chars.join('')}${' '.repeat(inner - 2 - chars.length)} │`
  }
  const center = (text: string) => {
    const chars = [...text]
    const left = Math.max(0, Math.floor((inner - chars.length) / 2))
    return `│${' '.repeat(left)}${chars.join('')}${' '.repeat(Math.max(0, inner - left - chars.length))}│`
  }
  const view = { stage: stageOf(pet), species: pet.hatch?.species, shiny: pet.hatch?.shiny ?? false, eggCalls: pet.eggCalls }
  // The canvas keeps headroom for jumps; a card has no use for blank rows.
  const sprite = monoLines(drawFrame(view, 'idle', 0, false))
    .map(line => line.replace(/\s+$/, ''))
    .filter(line => line !== '')
  const width = Math.max(...sprite.map(line => [...line].length))
  const label = ' hatchling '
  const rule = '─'.repeat(inner - label.length - 2)
  // A long name takes two lines: "Bartholomew" then "the Starwhelp".
  const title = titleLine(pet)
  const titles =
    [...title].length <= inner - 2 || pet.hatch === undefined ? [title] : [nameOf(pet), `the ${speciesName(pet)}`]
  return [
    `┌${'─'.repeat(inner)}┐`,
    ...sprite.map(line => center(line + ' '.repeat(width - [...line].length))),
    ...titles.map(pad),
    pad(tagLine(pet)),
    pad(`${plural(daysTogether(pet, now), 'day')} - ${plural(pet.toolCalls, 'tool call')}`),
    `└${rule}${label}──┘`,
  ].join('\n')
}

export type CardInfo = { stage: HatchlingStage; species?: HatchlingSpecies; shiny: boolean; eggCalls: number }

/**
 * Reads the pet's look back out of a /pet or /pet card text, so a transcript
 * row redraws the pet as it was when the command ran, not as it is now.
 */
export function parseCard(text: string): CardInfo | undefined {
  const lines = text.split('\n').map(line => line.replace(/^│\s?|\s*│$/g, '').trim())
  const tagAt = lines.findIndex(line => /^(egg - \d+\/\d+ to hatch|(common|uncommon|rare|legendary) - (baby|teen|adult)( - (shiny|not shiny))?)$/.test(line))
  const tag = lines[tagAt]
  if (tag === undefined) return undefined
  const egg = /^egg - (\d+)\//.exec(tag)
  if (egg !== null) return { stage: 'egg', shiny: false, eggCalls: Number(egg[1]) }
  const above = lines.slice(0, tagAt)
  const species = SPECIES.find(one => above.some(line => line === `the ${one.name}` || line.endsWith(` the ${one.name}`)))
  const stage = /- (baby|teen|adult)\b/.exec(tag)?.[1] as HatchlingStage | undefined
  if (species === undefined || stage === undefined) return undefined
  return { stage, species: species.id, shiny: / - shiny$/.test(tag), eggCalls: HATCH_AT }
}

/** "mcp__server__tool" reads as "tool"; long names are cut. */
export function toolLabel(tool: string): string {
  const short = tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool
  return short.length > 20 ? `${short.slice(0, 19)}.` : short
}
