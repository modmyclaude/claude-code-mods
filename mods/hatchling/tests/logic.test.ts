// Pure rules: the roll, hatching, XP and evolution, the test-run detector,
// names, the cards, and the art data itself.

import { describe, expect, test } from 'claude-code/testing'

import type { HatchlingPet } from '../types'
import { drawFrame, monoLines, moodArt, rasterCells, rasterText, toCells } from '../hooks/art'
import {
  ADULT_XP,
  applyToolCall,
  applyTurn,
  cardText,
  cleanName,
  detectTestPass,
  freshPet,
  HATCH_AT,
  normalizePet,
  parseCard,
  rarityOf,
  rollHatch,
  stageOf,
  statText,
  TEEN_XP,
} from '../hooks/pet'
import { CANVAS, MOODS, SPECIES } from '../hooks/sprites'

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

/** A random source that must never be asked: proves no roll happens. */
function forbidden(): number {
  throw new Error('rolled again')
}

function hatched(xp: number, species = SPECIES[0]!.id, shiny = false): HatchlingPet {
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

  test('the same random values give the same pet', () => {
    const values = [0x9e3779b9, 0x7f4a7c15, 0x00000001, 0x12345678]
    expect(rollHatch(replay(values))).toEqual(rollHatch(replay(values)))
  })
})

describe('hatching and growing', () => {
  test('the egg hatches on exactly the 25th tool call', () => {
    let pet = freshPet(T0)
    for (let call = 1; call < HATCH_AT; call += 1) {
      const change = applyToolCall(pet, { hasPassedTests: false }, T0, forbidden)
      expect(change.isHatched).toBe(false)
      pet = change.pet
    }
    expect(pet.eggCalls).toBe(24)
    expect(pet.hatch).toBeUndefined()
    const change = applyToolCall(pet, { hasPassedTests: false }, T0 + 5, replay([0, 0, 0xffffffff, 0]))
    expect(change.isHatched).toBe(true)
    expect(change.pet.hatch).toEqual({ species: 'pebblet', shiny: false, at: T0 + 5 })
    expect(change.pet.xp).toBe(0)
  })

  test('a hatched pet never rolls again, however many calls follow', () => {
    let pet = hatched(0, 'geobug', true)
    for (let call = 0; call < 1000; call += 1) pet = applyToolCall(pet, { hasPassedTests: false }, T0, forbidden).pet
    expect(pet.hatch).toEqual({ species: 'geobug', shiny: true, at: T0 })
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
      'Pip the Foldling\nrare - teen - not shiny\nXP 320 - 480 more to adult\n2 days together - 512 tool calls - 4 test runs cheered',
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

  test('the egg cracks as it nears hatching', () => {
    const egg = (calls: number) => JSON.stringify(drawFrame({ stage: 'egg', shiny: false, eggCalls: calls }, 'idle', 0, false))
    expect(egg(0)).toBe(egg(14))
    expect(egg(15)).not.toBe(egg(14))
    expect(egg(21)).not.toBe(egg(15))
  })
})
