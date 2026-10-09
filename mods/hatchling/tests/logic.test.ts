// Pure rules: the roll, hatching, XP and evolution, the test-run detector,
// names, the cards, and the art data itself.

import { describe, expect, test } from 'claude-code/testing'

import type { HatchlingKind, HatchlingPet } from '../types'
import { drawFrame, monoLines, moodArt, rasterCells, rasterText, toCells } from '../hooks/art'
import { BOLT_PALETTE, boltCells } from '../hooks/bolt'
import {
  ADULT_XP,
  applyToolCall,
  applyTurn,
  BOLT_ODDS,
  cardText,
  cleanName,
  detectTestPass,
  freshPet,
  HATCH_AT,
  normalizePet,
  parseCard,
  rarityOf,
  rollHatch,
  safeText,
  stageOf,
  statText,
  TEEN_XP,
} from '../hooks/pet'
import { BOLT_MOODS, CANVAS, MOODS, SPECIES } from '../hooks/sprites'

const T0 = Date.UTC(2026, 9, 1)
const STAGES = ['baby', 'teen', 'adult'] as const

/** A random source that replays a fixed list of u32 values. */
function replay(values: readonly number[]): () => number {
  let at = 0
  return () => {
    const value = values[at % values.length] ?? 0
    at += 1
    return value >>> 0
  }
}

/** mulberry32: a small deterministic generator, so the statistical tests never flake. */
function seeded(start: number): () => number {
  let state = start >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
}

/** A first seed number whose low 26 bits land in their top hundredth: the secret Bolt. */
const BOLT_FIRST = 0x3ffffff

/** A random source that must never be asked: proves no roll happens. */
function forbidden(): number {
  throw new Error('rolled again')
}

function hatched(xp: number, species: HatchlingKind = SPECIES[0]!.id, shiny = false): HatchlingPet {
  return { ...freshPet(T0), eggCalls: HATCH_AT, hatch: { species, shiny, at: T0 }, name: 'Pip', xp }
}

describe('the hatch roll', () => {
  test('rarity follows 36/18/8/2 out of 64 exactly', () => {
    const counts: Record<string, number> = { common: 0, uncommon: 0, rare: 0, legendary: 0 }
    for (let top = 0; top < 64; top += 1) {
      // The first u32 decides rarity by its top 6 bits.
      const roll = rollHatch(replay([top << 26, 0, 0xffffffff, 0]))
      counts[rarityOf(roll.species)] = (counts[rarityOf(roll.species)] ?? 0) + 1
    }
    expect(counts).toEqual({ common: 36, uncommon: 18, rare: 8, legendary: 2 })
  })

  test('the boundaries land on the right side', () => {
    const rarityAt = (top: number) => rarityOf(rollHatch(replay([top << 26, 0, 0xffffffff, 0])).species)
    expect([rarityAt(0), rarityAt(35), rarityAt(36), rarityAt(53), rarityAt(54), rarityAt(61), rarityAt(62), rarityAt(63)])
      .toEqual(['common', 'common', 'uncommon', 'uncommon', 'rare', 'rare', 'legendary', 'legendary'])
  })

  test('shiny is exactly 1 in 64', () => {
    let shinies = 0
    for (let top = 0; top < 64; top += 1) {
      if (rollHatch(replay([0, 0, top << 26, 0])).shiny) shinies += 1
    }
    expect(shinies).toBe(1)
  })

  test('every species can hatch, each at its own rarity', () => {
    const seen = new Set<string>()
    for (let top = 0; top < 64; top += 1) {
      for (const pick of [0, 0x55555555, 0xaaaaaaaa, 0xffffffff]) {
        const roll = rollHatch(replay([top << 26, pick, 0xffffffff, 0]))
        seen.add(roll.species)
        expect(SPECIES.find(one => one.id === roll.species)?.rarity).toBe(rarityOf(roll.species))
      }
    }
    expect(seen.size).toBe(8)
    expect(SPECIES.map(one => one.rarity)).toEqual(['common', 'common', 'common', 'uncommon', 'uncommon', 'rare', 'rare', 'legendary'])
  })

  test('with ordinary random numbers the odds come out right (seeded, 256,000 rolls)', () => {
    const next = seeded(0x2545f491)
    const n = 256_000
    const rarity: Record<string, number> = { common: 0, uncommon: 0, rare: 0, legendary: 0, secret: 0 }
    let shiny = 0
    for (let i = 0; i < n; i += 1) {
      const roll = rollHatch(next)
      rarity[rarityOf(roll.species)] = (rarity[rarityOf(roll.species)] ?? 0) + 1
      if (roll.shiny) shiny += 1
    }
    // Within 5 standard deviations: Bolt 1 in 100; the species odds (36/18/8/2 in 64)
    // and shiny (1 in 64) apply to the other 99 eggs in 100.
    const near = (count: number, p: number, of = n) => Math.abs(count - of * p) < 5 * Math.sqrt(of * p * (1 - p))
    const species = n - (rarity.secret ?? 0)
    expect(near(rarity.secret ?? 0, 1 / BOLT_ODDS), `bolt ${rarity.secret}`).toBe(true)
    expect(near(shiny, 1 / 64, species), `shiny ${shiny}`).toBe(true)
    expect(near(rarity.common ?? 0, 36 / 64, species) && near(rarity.uncommon ?? 0, 18 / 64, species)).toBe(true)
    expect(near(rarity.rare ?? 0, 8 / 64, species) && near(rarity.legendary ?? 0, 2 / 64, species)).toBe(true)
  })

  test('1 egg in 100 hatches the secret Bolt, read from its seed: the same every time, saved, never shiny', () => {
    const hatch = (seed: number[], u32: () => number = forbidden) =>
      applyToolCall({ ...freshPet(T0), eggCalls: 24, seed }, { hasPassedTests: false }, T0, u32).pet
    // The seed decides, whatever else is random: the same egg hatches the same way in every session.
    const bolt = hatch([BOLT_FIRST, 0, 0xffffffff, 0])
    expect(bolt.hatch).toEqual({ species: 'bolt', shiny: false, at: T0 })
    expect(bolt.name).toBe('Pip')
    expect(hatch([BOLT_FIRST, 7, 99, 5], () => 0).hatch?.species).toBe('bolt')
    expect(hatch([BOLT_FIRST - 671_088, 0, 0xffffffff, 0]).hatch?.species).toBe('pebblet')
    // Saved, it loads as Bolt and never rolls again.
    let pet = normalizePet(JSON.parse(JSON.stringify(bolt)), T0)
    for (let call = 0; call < 300; call += 1) pet = applyToolCall(pet, { hasPassedTests: false }, T0, forbidden).pet
    expect(pet.hatch).toEqual({ species: 'bolt', shiny: false, at: T0 })
    // Never shiny: not when the seed's shiny draw hits, not when a store says so.
    expect(hatch([BOLT_FIRST, 0, 0, 0]).hatch?.shiny).toBe(false)
    expect(hatch([0, 0, 0, 0]).hatch).toEqual({ species: 'pebblet', shiny: true, at: T0 })
    expect(normalizePet({ hatch: { species: 'bolt', shiny: true, at: 5 } }, T0).hatch).toEqual({ species: 'bolt', shiny: false, at: 5 })
    // Over many seeds about 1 in 100 (within 5 standard deviations), each the same on a second hatch.
    const next = seeded(0x51ed270b)
    const n = 20_000
    let bolts = 0
    for (let i = 0; i < n; i += 1) {
      const seed = [next(), next(), next(), next()]
      const once = hatch(seed)
      expect(hatch(seed, next).hatch).toEqual(once.hatch)
      if (once.hatch?.species === 'bolt') {
        bolts += 1
        expect(once.hatch.shiny).toBe(false)
      }
    }
    expect(Math.abs(bolts - n / BOLT_ODDS), `bolts ${bolts}`).toBeLessThan(5 * Math.sqrt((n / BOLT_ODDS) * (1 - 1 / BOLT_ODDS)))
  })

  test('an egg with a seed always hatches the same pet, whatever else is random', () => {
    const egg = { ...freshPet(T0), eggCalls: 24, seed: [1 << 30, 7, 123456, 99] }
    const a = applyToolCall(egg, { hasPassedTests: false }, T0, () => 0)
    const b = applyToolCall(egg, { hasPassedTests: false }, T0, () => 0xffffffff)
    expect(a.pet.hatch).toEqual(b.pet.hatch)
    expect(a.pet.name).toBe(b.pet.name)
    expect(normalizePet({ seed: [1, 2, 3] }, T0).seed).toBeUndefined()
    expect(normalizePet({ seed: [1, 2, 3, 2 ** 32] }, T0).seed).toBeUndefined()
    expect(normalizePet({ seed: [1, 2, 3, 4] }, T0).seed).toEqual([1, 2, 3, 4])
  })

  test('the same random values give the same pet', () => {
    const values = [0x9e3779b9, 0x7f4a7c15, 0x00000001, 0x12345678]
    expect(rollHatch(replay(values))).toEqual(rollHatch(replay(values)))
  })
})

describe('hatching and growing', () => {
  test('the egg hatches on exactly the 25th tool call', () => {
    // The first call lays the egg's seed; every later call, the hatch
    // included, reads it and asks for no more randomness.
    let pet = applyToolCall(freshPet(T0), { hasPassedTests: false }, T0, replay([0, 0, 0xffffffff, 0])).pet
    expect(pet.seed).toEqual([0, 0, 0xffffffff, 0])
    for (let call = 2; call < HATCH_AT; call += 1) {
      const change = applyToolCall(pet, { hasPassedTests: false }, T0, forbidden)
      expect(change.isHatched).toBe(false)
      pet = change.pet
    }
    expect(pet.eggCalls).toBe(24)
    expect(pet.hatch).toBeUndefined()
    const change = applyToolCall(pet, { hasPassedTests: false }, T0 + 5, forbidden)
    expect(change.isHatched).toBe(true)
    expect(change.pet.hatch).toEqual({ species: 'pebblet', shiny: false, at: T0 + 5 })
    expect(change.pet.name).toBe('Pip')
    expect(change.pet.xp).toBe(0)
  })

  test('a hatched pet never rolls again, however many calls follow', () => {
    let pet = hatched(0, 'geobug', true)
    for (let call = 0; call < 1000; call += 1) pet = applyToolCall(pet, { hasPassedTests: false }, T0, forbidden).pet
    expect(pet.hatch).toEqual({ species: 'geobug', shiny: true, at: T0 })
  })

  test('an egg saved without a seed gets one on its next call, and keeps it', () => {
    const old = { ...freshPet(T0), eggCalls: 10 }
    const once = applyToolCall(old, { hasPassedTests: false }, T0, replay([5, 6, 7, 8])).pet
    expect(once.seed).toEqual([5, 6, 7, 8])
    expect(applyToolCall(once, { hasPassedTests: false }, T0, forbidden).pet.seed).toEqual([5, 6, 7, 8])
  })

  test('a name chosen before hatching is kept', () => {
    const pet = { ...freshPet(T0), eggCalls: 24, name: 'Mochi' }
    expect(applyToolCall(pet, { hasPassedTests: false }, T0, replay([0])).pet.name).toBe('Mochi')
  })

  test('stages follow XP at 200 and 800', () => {
    const table: [number, string][] = [[0, 'baby'], [199, 'baby'], [200, 'teen'], [799, 'teen'], [800, 'adult'], [5000, 'adult']]
    for (const [xp, stage] of table) expect(stageOf(hatched(xp))).toBe(stage)
    expect(stageOf(freshPet(T0))).toBe('egg')
    expect([TEEN_XP, ADULT_XP]).toEqual([200, 800])
  })

  test('XP: 1 per tool call, 5 more for passing tests, 5 per turn; an egg earns none', () => {
    expect(applyToolCall(hatched(10), { hasPassedTests: false }, T0, forbidden).pet.xp).toBe(11)
    expect(applyToolCall(hatched(10), { hasPassedTests: true }, T0, forbidden).pet.xp).toBe(16)
    expect(applyTurn(hatched(10)).pet.xp).toBe(15)
    expect(applyTurn(freshPet(T0)).pet.xp).toBe(0)
    expect(applyTurn(freshPet(T0)).pet.turns).toBe(1)
  })

  test('crossing a threshold reports the evolution once', () => {
    expect(applyToolCall(hatched(199), { hasPassedTests: false }, T0, forbidden).evolved).toEqual({ from: 'baby', to: 'teen' })
    expect(applyTurn(hatched(797)).evolved).toEqual({ from: 'teen', to: 'adult' })
    expect(applyToolCall(hatched(200), { hasPassedTests: false }, T0, forbidden).evolved).toBeUndefined()
    expect(applyTurn(hatched(900)).evolved).toBeUndefined()
  })
})

describe('reading a saved pet', () => {
  test('nothing saved: a fresh egg', () => {
    expect(normalizePet(undefined, T0)).toEqual(freshPet(T0))
    expect(normalizePet('junk', T0)).toEqual(freshPet(T0))
  })

  test('a damaged record keeps its hatch and repairs the rest', () => {
    const pet = normalizePet({ hatch: { species: 'nimbit', shiny: true, at: 5 }, xp: -4, eggCalls: 'x', name: '\u0007' }, T0)
    expect(pet.hatch).toEqual({ species: 'nimbit', shiny: true, at: 5 })
    expect(pet.xp).toBe(0)
    expect(pet.eggCalls).toBe(HATCH_AT)
    expect(pet.name).toBeUndefined()
  })

  test('an unknown species is not a hatch', () => {
    expect(normalizePet({ hatch: { species: 'dragonite' }, eggCalls: 3 }, T0).hatch).toBeUndefined()
  })
})

describe('the test-run detector', () => {
  const passes: [string, string, string][] = [
    ['jest', 'npx jest', 'Test Suites: 3 passed, 3 total\nTests:       12 passed, 12 total\nTime: 1.2 s'],
    ['jest with skips', 'npm test', 'Tests:       1 skipped, 40 passed, 41 total'],
    ['vitest', 'npx vitest run', ' Test Files  4 passed (4)\n      Tests  31 passed (31)\n   Duration  2.1s'],
    ['pytest', 'pytest', '============ 12 passed in 0.34s ============'],
    ['pytest -q with warnings', 'python -m pytest -q', '12 passed, 1 warning in 0.50s'],
    ['go test', 'go test ./...', 'ok  \tgithub.com/acme/app\t0.012s\nok  \tgithub.com/acme/app/db\t(cached)'],
    ['go test -v', 'go test -v', '=== RUN   TestX\n--- PASS: TestX (0.00s)\nPASS\nok  \tacme\t0.1s'],
    ['cargo test', 'cargo test', 'running 7 tests\ntest result: ok. 7 passed; 0 failed; 0 ignored; 0 measured'],
    ['node:test tap', 'node --test', '# tests 9\n# pass 9\n# fail 0\n# cancelled 0'],
    ['node:test spec', 'node --test', 'ℹ tests 9\nℹ pass 9\nℹ fail 0'],
    ['mocha', 'npx mocha', '  14 passing (45ms)'],
    ['rspec', 'bundle exec rspec', 'Finished in 0.5 seconds\n22 examples, 0 failures'],
    ['bun', 'bun test', ' 12 pass\n 0 fail\n 30 expect() calls'],
    ['deno', 'deno test', 'ok | 5 passed | 0 failed (34ms)'],
    ['phpunit', 'vendor/bin/phpunit', 'OK (12 tests, 30 assertions)'],
    ['unittest', 'python -m unittest', 'Ran 12 tests in 0.003s\n\nOK'],
    ['dotnet', 'dotnet test', 'Passed!  - Failed:     0, Passed:    12, Skipped:     0, Total:    12'],
    ['coloured jest', 'npm test', '\u001b[1mTests:\u001b[22m       \u001b[1m\u001b[32m5 passed\u001b[39m\u001b[22m, 5 total'],
    ['playwright', 'npx playwright test', 'Running 12 tests using 4 workers\n  12 passed (3.2s)'],
    ['cargo nextest', 'cargo nextest run', '     Summary [   1.204s] 31 tests run: 31 passed, 0 skipped'],
    ['after a cd', 'cd app && npm test', 'Tests:       12 passed, 12 total'],
    ['after an echo', 'echo start && npm test', 'Tests:       12 passed, 12 total'],
    ['piped to tail', 'npm test 2>&1 | tail -5', 'Tests:       12 passed, 12 total'],
    ['a log, then a run on the next line', 'cat ci.log\nnpm test', 'Tests:       12 passed, 12 total'],
    ['with an env prefix', 'CI=1 npm test', 'Tests:       12 passed, 12 total'],
    ['in a subshell', '(cd app && npm test)', 'Tests:       12 passed, 12 total'],
    ['through bash -c', "bash -c 'npm test'", 'Tests:       12 passed, 12 total'],
  ]
  const fails: [string, string, string][] = [
    ['jest failure', 'npx jest', 'Tests:       1 failed, 11 passed, 12 total'],
    ['vitest failure', 'npx vitest run', '      Tests  1 failed | 30 passed (31)'],
    ['pytest failure', 'pytest', '====== 1 failed, 11 passed in 0.40s ======'],
    ['pytest error', 'pytest', '====== 11 passed, 1 error in 0.40s ======'],
    ['go failure', 'go test ./...', '--- FAIL: TestX (0.00s)\nFAIL\tacme\t0.1s\nok  \tacme/db\t0.1s'],
    ['cargo failure', 'cargo test', 'test result: FAILED. 6 passed; 1 failed; 0 ignored'],
    ['node:test failure', 'node --test', '# pass 8\n# fail 1'],
    ['mocha failure', 'npx mocha', '  13 passing (45ms)\n  1 failing'],
    ['rspec failure', 'rspec', '22 examples, 2 failures'],
    ['bun failure', 'bun test', ' 11 pass\n 1 fail'],
    ['no tests ran', 'npm test', 'Tests:       0 passed, 0 total'],
    ['not a test run', 'ls', 'src  tests  package.json'],
    ['a build', 'npm run build', 'built in 1.2s'],
    ['reading a log', 'cat ci.log', 'Tests:       12 passed, 12 total'],
    ['grepping a log', 'grep passed ci.log', '============ 12 passed in 0.34s ============'],
    ['a log after a cd', 'cd app && cat ci.log', 'Tests:       12 passed, 12 total'],
    ['a CI log', 'gh run view 123 --log', 'Tests:       12 passed, 12 total'],
    ['container logs', 'docker logs api', '============ 12 passed in 0.34s ============'],
    ['compose logs', 'docker compose logs web', 'Tests:       12 passed, 12 total'],
    ['kubectl logs', 'kubectl logs pod/api', 'test result: ok. 7 passed; 0 failed'],
    ['a log piped along', 'cat ci.log | grep Tests', 'Tests:       12 passed, 12 total'],
    ['a log in a subshell', '(cd app && cat ci.log)', 'Tests:       12 passed, 12 total'],
    ['a log with an env prefix', 'FOO=1 cat ci.log', 'Tests:       12 passed, 12 total'],
    ['a log with sudo', 'sudo cat ci.log', 'Tests:       12 passed, 12 total'],
    ['a log through bash -c', "bash -c 'cat ci.log'", 'Tests:       12 passed, 12 total'],
    ['a log through env and sh -c', 'env sh -c "tail -n 50 ci.log"', 'Tests:       12 passed, 12 total'],
    ['nextest failure', 'cargo nextest run', 'Summary [ 1.2s] 10 tests run: 9 passed, 1 failed'],
  ]
  for (const [name, command, output] of passes) {
    test(`passes: ${name}`, () => expect(detectTestPass(command, output), name).toBe(true))
  }
  for (const [name, command, output] of fails) {
    test(`does not cheer: ${name}`, () => expect(detectTestPass(command, output), name).toBe(false))
  }
})

describe('names', () => {
  const table: [string, string | undefined][] = [
    ['Pip', 'Pip'],
    ['  Sir   Fluff  ', 'Sir Fluff'],
    ["D'Artagnan", "D'Artagnan"],
    ['Zoe-2', 'Zoe-2'],
    ['Éclair', 'Éclair'],
    ['', undefined],
    ['   ', undefined],
    ['abcdefghijklmnopq', undefined],
    ['<script>', undefined],
    ['-dash', undefined],
    ['tab\there', 'tab here'],
  ]
  for (const [raw, want] of table) {
    test(`name ${JSON.stringify(raw)}`, () => {
      const result = cleanName(raw)
      expect('name' in result ? result.name : undefined).toBe(want)
    })
  }
})

describe('drawing outside text safely', () => {
  const table: [string, string][] = [
    ['plain', 'plain'],
    ['\u001b[31mred\u001b[0m', 'red'],
    ['title\u001b]0;hi\u0007done', 'titledone'],
    ['bell\u0007', 'bell\ufffd'],
    ['nul\u0000del\u007f', 'nul\ufffddel\ufffd'],
    ['next line\u0085csi\u009b', 'next line\ufffdcsi\ufffd'],
    ['tab\there', 'tab\ufffdhere'],
  ]
  for (const [raw, want] of table) {
    test(`safeText ${JSON.stringify(raw)}`, () => expect(safeText(raw)).toBe(want))
  }
  test('safeText caps the length', () => {
    expect(safeText('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}.`)
  })
  test('a name keeps its letters when escapes are pasted in', () => {
    expect(cleanName('\u001b[1mPip\u001b[0m\u0007')).toEqual({ name: 'Pip' })
  })
})

describe('cards', () => {
  test('every species, stage and shiny reads back from both texts', () => {
    for (const art of SPECIES) {
      for (const [stage, xp] of [['baby', 0], ['teen', 300], ['adult', 900]] as const) {
        for (const shiny of [false, true]) {
          const pet = { ...hatched(xp, art.id, shiny), name: 'Bartholomew-Jr' }
          const want = { stage, species: art.id, shiny, eggCalls: HATCH_AT }
          expect(parseCard(statText(pet, T0)), `${art.id} ${stage} stat`).toEqual(want)
          expect(parseCard(cardText(pet, T0)), `${art.id} ${stage} card`).toEqual(want)
        }
      }
    }
    expect(parseCard(statText({ ...freshPet(T0), eggCalls: 7 }, T0))).toEqual({ stage: 'egg', shiny: false, eggCalls: 7 })
    expect(parseCard('Your pet is now called Pip.')).toBeUndefined()
  })

  test('the secret Bolt has its own cards: rarity "secret", never shiny, the stage still grows', () => {
    for (const [stage, xp] of [['baby', 0], ['teen', 300], ['adult', 900]] as const) {
      const pet = hatched(xp, 'bolt')
      const want = { stage, species: 'bolt', shiny: false, eggCalls: HATCH_AT }
      expect(parseCard(statText(pet, T0)), stage).toEqual(want)
      expect(parseCard(cardText(pet, T0)), stage).toEqual(want)
      for (const line of cardText(pet, T0).split('\n')) expect([...line].length).toBe(30)
    }
    expect(statText(hatched(320, 'bolt'), T0)).toBe(
      "Pip the Bolt\nsecret - teen - not shiny\nXP 320 - 480 more to adult\n1 day together - 0 tool calls - 0 test runs cheered\nIt was Bolt's egg all along.",
    )
  })

  test('the share card fits about 30 x 12 and is plain characters', () => {
    for (const art of SPECIES) {
      for (const pet of [hatched(0, art.id), hatched(900, art.id, true), { ...hatched(900, art.id), name: 'Sixteen Letters!'.slice(0, 16) }]) {
        const lines = cardText(pet, T0 + 3 * 86_400_000).split('\n')
        expect(lines.length).toBeLessThanOrEqual(12)
        for (const line of lines) expect([...line].length).toBe(30)
        expect(lines.join('')).not.toMatch(/\u001b/)
      }
    }
    expect(cardText(hatched(0), T0 + 2 * 86_400_000)).toContain('3 days - 0 tool calls')
  })

  test('the stat card says everything /pet promises', () => {
    const text = statText({ ...hatched(320, 'foldling', false), toolCalls: 512, testsPassed: 4 }, T0 + 86_400_000)
    expect(text).toBe(
      'Pip the Foldling\nrare - teen - not shiny\nXP 320 - 480 more to adult\n2 days together - 512 tool calls - 4 test runs cheered\n' +
        "Folded from a page of someone else's notes.",
    )
  })
})

describe('the art', () => {
  test('every sprite is rectangular, fits its stage and uses known letters', () => {
    const max = { baby: [8, 8], teen: [10, 8], adult: [14, 10] } as const
    for (const art of SPECIES) {
      for (const stage of STAGES) {
        const rows = art[stage]
        const width = rows[0]?.length ?? 0
        expect(rows.every(row => row.length === width), `${art.id} ${stage} rows`).toBe(true)
        expect(width <= max[stage][0] && rows.length <= max[stage][1], `${art.id} ${stage} size`).toBe(true)
        const letters = new Set(rows.join(''))
        for (const letter of letters) {
          expect('.Eemh'.includes(letter) || letter in art.palette, `${art.id} ${stage} letter ${letter}`).toBe(true)
          expect('.Eemh'.includes(letter) || letter in art.shiny, `${art.id} ${stage} shiny ${letter}`).toBe(true)
        }
        expect(letters.has('E') && letters.has('e'), `${art.id} ${stage} eyes`).toBe(true)
      }
    }
  })

  test('every species reads clean at every stage: eyes inside the body, no stray pixels, a top-left highlight', () => {
    for (const art of SPECIES) {
      for (const stage of STAGES) {
        const rows = art[stage]
        const at = (x: number, y: number) => rows[y]?.[x] ?? '.'
        const drawn = (x: number, y: number) => at(x, y) !== '.'
        rows.forEach((row, y) => [...row].forEach((letter, x) => {
          const label = `${art.id} ${stage} ${letter} at ${x},${y}`
          if (letter === '.') return
          // No pixel stands alone: each touches another, at least on a corner.
          const around = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
          expect(around.some(([dx, dy]) => drawn(x + dx!, y + dy!)), label).toBe(true)
          // An eye is two pixels, upper over lower, with body on every side.
          if (letter === 'E') expect(at(x, y + 1), label).toBe('e')
          if (letter === 'E' || letter === 'e') {
            expect([[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => drawn(x + dx!, y + dy!)), label).toBe(true)
          }
        }))
        // The 1-2 px highlight (c or w) sits in the upper left of the drawing.
        const lit = rows.flatMap((row, y) => [...row].flatMap((letter, x) => ('cw'.includes(letter) ? [[x, y]] : [])))
        const width = rows[0]?.length ?? 0
        expect(lit.some(([x, y]) => x! < width / 2 && y! < rows.length / 2), `${art.id} ${stage} highlight`).toBe(true)
      }
    }
  })

  test('the secret Bolt is drawn in its own poses, the same at every stage and never in another palette', () => {
    const bolt = (stage: 'baby' | 'teen' | 'adult', mood: Parameters<typeof drawFrame>[1], tick = 0, isWorking = false, shiny = false) =>
      toCells(drawFrame({ stage, species: 'bolt', shiny, eggCalls: HATCH_AT }, mood, tick, isWorking))
    // Teen and adult canvases are wider and taller: the same Bolt, framed in blank cells.
    const trimmed = (cells: ReturnType<typeof toCells>) => {
      const used = cells.filter(line => line.some(cell => cell.ch !== ' '))
      const cols = [...Array(used[0]?.length ?? 0).keys()].filter(c => used.some(line => line[c]?.ch !== ' '))
      return used.map(line => line.slice(cols[0], (cols[cols.length - 1] ?? 0) + 1))
    }
    const moods: [Parameters<typeof drawFrame>[1], boolean, number, 'idle' | 'jump' | 'sweat' | 'cheer' | 'sleep'][] = [
      ['idle', false, 0, 'idle'], // at rest
      ['idle', true, 3, 'idle'], // watching Claude work
      ['happy', false, 0, 'jump'], // the bounce on a good tool call
      ['happy', false, 1, 'idle'],
      ['sweat', false, 0, 'sweat'], // a failed tool call
      ['sweat', false, 2, 'sweat'],
      ['cheer', false, 0, 'cheer'], // passing tests
      ['evolve', false, 0, 'cheer'], // a stage-up
      ['sleep', false, 0, 'sleep'], // 5 quiet minutes
      ['sleep', false, 3, 'sleep'],
    ]
    for (const [mood, isWorking, tick, pose] of moods) {
      for (const stage of STAGES) {
        const want = boltCells('small', pose)
        const got = bolt(stage, mood, tick, isWorking)
        expect(stage === 'baby' ? got : trimmed(got), `${stage} ${mood} ${tick}`).toEqual(want)
        expect(bolt(stage, mood, tick, isWorking, true), `${stage} ${mood} shiny`).toEqual(got)
      }
    }
    // Every pose Bolt's moods use is one of those five.
    for (const art of Object.values(BOLT_MOODS)) {
      for (const pose of art.frames) expect(['idle', 'jump', 'sweat', 'cheer', 'sleep']).toContain(pose)
    }
    // Hatching: the egg, the lid lifting, then Bolt cheering among its shell.
    const hatching = (tick: number) => toCells(drawFrame({ stage: 'baby', species: 'bolt', shiny: false, eggCalls: HATCH_AT }, 'hatch', tick, false))
    expect(hatching(0)).toEqual(boltCells('small', 'egg-crack-3'))
    expect(hatching(4)).toEqual(boltCells('small', 'egg-hatch'))
    const hatched = hatching(6)
    expect(hatched.map(line => line.slice(2, 8))).toEqual(boltCells('small', 'cheer').map(line => line.slice(2, 8)))
    expect(hatched[4]?.[0]?.fg).toBe(BOLT_PALETTE.B)
  })

  test('each mood has 2 or 3 frames, and the frames really differ', () => {
    for (const mood of ['working', 'happy', 'sweat', 'cheer', 'sleep'] as const) {
      expect(MOODS[mood].frames.length >= 2 && MOODS[mood].frames.length <= 3, mood).toBe(true)
    }
    for (const art of SPECIES) {
      for (const stage of STAGES) {
        for (const [mood, isWorking] of [['idle', true], ['happy', false], ['sweat', false], ['cheer', false], ['sleep', false]] as const) {
          const view = { stage, species: art.id, shiny: false, eggCalls: HATCH_AT }
          const hold = moodArt(mood, isWorking, stage).hold
          const a = JSON.stringify(drawFrame(view, mood, 0, isWorking))
          const b = JSON.stringify(drawFrame(view, mood, hold, isWorking))
          expect(a !== b, `${art.id} ${stage} ${mood}`).toBe(true)
        }
      }
    }
  })

  test('shiny is the same shape in another palette', () => {
    for (const art of SPECIES) {
      const view = { stage: 'adult' as const, species: art.id, eggCalls: HATCH_AT }
      const plain = drawFrame({ ...view, shiny: false }, 'idle', 0, false)
      const shiny = drawFrame({ ...view, shiny: true }, 'idle', 0, false)
      expect(shiny.px.map(row => row.map(px => px !== null))).toEqual(plain.px.map(row => row.map(px => px !== null)))
      expect(JSON.stringify(shiny.px)).not.toBe(JSON.stringify(plain.px))
    }
  })

  test('cells pack two pixels each, and the raster round-trips', () => {
    const frame = drawFrame({ stage: 'adult', species: 'starwhelp', shiny: false, eggCalls: HATCH_AT }, 'idle', 0, false)
    const cells = toCells(frame)
    expect(cells.length).toBe(CANVAS.adult.h / 2)
    expect(cells.every(line => line.length === CANVAS.adult.w)).toBe(true)
    expect(rasterText(rasterCells(cells), CANVAS.adult.w)).toEqual(cells.map(line => line.map(cell => cell.ch).join('')))
    expect(monoLines(frame).every(line => line.length === CANVAS.adult.w)).toBe(true)
  })

  test("the egg is Bolt's egg: it leans with the wobble, cracks at 25, 50 and 75%, and lifts its lid to hatch", () => {
    const egg = (calls: number, isWorking = false, tick = 0) =>
      toCells(drawFrame({ stage: 'egg', shiny: false, eggCalls: calls }, 'idle', tick, isWorking))
    // Each crack from its fraction of the 25 calls: 7 (25%), 13 (50%) and 19 (75%).
    const stages: [number, 'egg' | 'egg-crack-1' | 'egg-crack-2' | 'egg-crack-3'][] = [
      [0, 'egg'], [6, 'egg'], [7, 'egg-crack-1'], [12, 'egg-crack-1'],
      [13, 'egg-crack-2'], [18, 'egg-crack-2'], [19, 'egg-crack-3'], [24, 'egg-crack-3'],
    ]
    for (const [calls, pose] of stages) expect(egg(calls), `${calls} calls`).toEqual(boltCells('small', pose))
    expect(HATCH_AT).toBe(25)
    // The wobble keeps its frames and cadence (2 ticks each): upright, lean left, upright, lean right.
    const wobble = ['egg', 'egg', 'egg-wobble-l', 'egg-wobble-l', 'egg', 'egg', 'egg-wobble-r', 'egg-wobble-r'] as const
    wobble.forEach((pose, tick) => expect(egg(3, true, tick), `tick ${tick}`).toEqual(boltCells('small', pose)))
    // Bolt has no cracked lean: a cracked egg keeps its crack on every frame.
    for (const [calls, pose] of [[7, 'egg-crack-1'], [13, 'egg-crack-2'], [19, 'egg-crack-3']] as const) {
      for (let tick = 0; tick < 8; tick += 1) expect(egg(calls, true, tick), `${calls} calls, tick ${tick}`).toEqual(boltCells('small', pose))
    }
    // Hatching: the last crack for two frames, the lid lifting off, then the pet.
    const hatching = (tick: number) => toCells(drawFrame({ stage: 'baby', species: 'geobug', shiny: false, eggCalls: HATCH_AT }, 'hatch', tick, false))
    const hatch = ['egg-crack-3', 'egg-crack-3', 'egg-crack-3', 'egg-crack-3', 'egg-hatch', 'egg-hatch'] as const
    hatch.forEach((pose, tick) => expect(hatching(tick), `tick ${tick}`).toEqual(boltCells('small', pose)))
    expect(hatching(6)).not.toEqual(boltCells('small', 'egg-hatch'))
    // The shell left around the new pet is Bolt's lime egg's.
    const shell = drawFrame({ stage: 'baby', species: 'geobug', shiny: false, eggCalls: HATCH_AT }, 'hatch', 6, false)
    expect([shell.px[9]?.[0], shell.px[9]?.[1], shell.px[9]?.[9]]).toEqual([BOLT_PALETTE.B, BOLT_PALETTE.S, BOLT_PALETTE.B])
    // Asleep, the z sits in a cell Bolt leaves empty; every one of Bolt's cells is as drawn.
    for (const [tick, z, row] of [[0, 'z', 1], [2, 'Z', 0]] as const) {
      const asleep = toCells(drawFrame({ stage: 'egg', shiny: false, eggCalls: 3 }, 'sleep', tick, false))
      expect(asleep[row]?.[9]?.ch).toBe(z)
      expect(boltCells('small', 'egg')[row]?.[9]).toEqual({ ch: ' ' })
      expect(asleep.map(line => line.map(cell => (cell.ch === z ? { ch: ' ' } : cell)))).toEqual(boltCells('small', 'egg'))
    }
  })
})
