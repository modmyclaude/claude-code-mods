// Bolt in costume, held to the brand rules: a costume only covers, it
// never recolours; the antenna stays clear in every pose; the pink and the blush
// are Bolt's alone; three colours at most, every one the theme's own.

import { describe, expect, test } from 'claude-code/testing'

import { BOLT_PALETTE, BOLT_SPRITES, boltCells } from '../hooks/bolt'
import type { BoltPose, BoltSize } from '../hooks/bolt'
import { ANTENNA, BOLT_ONLY, COSTUMES, costumeOf, dressedPixels, MAX_COLOURS, paintOf, wearBolt } from '../hooks/costume'
import { ROLES, THEMES } from '../hooks/themes'

const SIZES: readonly BoltSize[] = ['small', 'tiny']
const posesOf = (size: BoltSize) => Object.keys(BOLT_SPRITES[size]) as BoltPose[]
const palette = BOLT_PALETTE as Record<string, string>

describe('the costumes', () => {
  test('every theme has one (colorblind an empty one), and nothing else does', () => {
    expect(Object.keys(COSTUMES).sort()).toEqual(THEMES.map(theme => theme.id).sort())
    for (const theme of THEMES) expect(costumeOf(theme)).toBe(COSTUMES[theme.id])
    expect(COSTUMES.colorblind).toMatchObject({ name: 'none', small: [], tiny: [] })
    expect(COSTUMES.dracula?.name).toBe('cape and fangs')
    expect(COSTUMES.halloween?.name).toBe('witch hat')
    expect(COSTUMES.christmas?.name).toBe('santa hat')
  })

  for (const theme of THEMES) {
    const costume = COSTUMES[theme.id]!

    test(`${theme.id}: no stitch lands on the antenna light or its stem, so every hat has its notch`, () => {
      for (const size of SIZES) {
        const antenna = new Set(ANTENNA[size].map(([row, col]) => `${row}/${col}`))
        for (const stitch of costume[size]) {
          expect(antenna.has(`${stitch.row}/${stitch.col}`), `${size} ${stitch.row}/${stitch.col}`).toBe(false)
        }
      }
    })

    test(`${theme.id}: dressed, the antenna pixels are Bolt's own in every pose and the sprite is never recoloured`, () => {
      for (const size of SIZES) {
        for (const pose of posesOf(size)) {
          const rows = (BOLT_SPRITES[size] as Record<string, readonly string[]>)[pose]!
          const { grid, touched } = dressedPixels(theme, size, pose)
          for (const [row, col] of ANTENNA[size]) {
            const letter = rows[row]![col]!
            const own = letter === '.' ? undefined : palette[letter]
            expect(grid[row]![col], `${size} ${pose} ${row}/${col}`).toBe(own)
          }
          // The light wherever a pose puts it, and the stem under it, are never covered.
          rows.forEach((line, row) =>
            [...line].forEach((letter, col) => {
              if (letter === 'O' || (letter === 'S' && row <= 1)) expect(touched.has(`${row}/${col}`), `${size} ${pose} ${row}/${col}`).toBe(false)
            }),
          )
          // Every pixel a stitch did not touch is the sprite's own colour.
          rows.forEach((line, row) =>
            [...line].forEach((letter, col) => {
              if (touched.has(`${row}/${col}`)) return
              expect(grid[row]![col], `${size} ${pose} ${row}/${col}`).toBe(letter === '.' ? undefined : palette[letter])
            }),
          )
          // A stitch lands inside the sprite only: never on an empty pixel outside Bolt's outline? It may (a brim is wider
          // than the head); what it may never do is fall outside the grid, which dressedPixels drops.
          for (const key of touched) {
            const [row, col] = key.split('/').map(Number) as [number, number]
            expect(row).toBeLessThan(rows.length)
            expect(col).toBeLessThan(rows[0]!.length)
          }
        }
      }
    })

    test(`${theme.id}: at most ${MAX_COLOURS} colours, every one out of the theme's palette, never Bolt's pink or blush`, () => {
      const keys = Object.keys(costume.paint)
      expect(keys.length).toBeLessThanOrEqual(MAX_COLOURS)
      for (const key of keys) {
        const role = costume.paint[key]!
        expect(role === 'bg' || ROLES.includes(role)).toBe(true)
        const colour = paintOf(theme, costume, key)!
        expect(colour).toBe(role === 'bg' ? theme.palette.bg : theme.palette[role])
        for (const banned of BOLT_ONLY) expect(colour.toLowerCase(), `${key} is ${colour}`).not.toBe(banned.toLowerCase())
      }
      // Every stitch names a letter of the paint: an unpainted stitch would be a silent no-op.
      for (const size of SIZES) for (const stitch of costume[size]) expect(keys, `${size} ${stitch.key}`).toContain(stitch.key)
      // And no dressed cell carries the pink or the blush but where Bolt himself has it.
      for (const size of SIZES) {
        for (const pose of posesOf(size)) {
          const base = boltCells(size as 'small', pose as 'idle')
          const dressed = wearBolt(theme, size, pose)
          dressed.forEach((line, r) =>
            line.forEach((cell, c) => {
              for (const colour of [cell.fg, cell.bg]) {
                if (colour === undefined) continue
                if (BOLT_ONLY.some(b => b.toLowerCase() === colour.toLowerCase())) {
                  const own = base[r]![c]!
                  expect([own.fg, own.bg], `${size} ${pose} cell ${r}/${c}`).toContain(colour)
                }
              }
            }),
          )
        }
      }
    })

    test(`${theme.id}: wearBolt packs the dressed pixels into the sprite's cells, leaving untouched cells as bolt.ts drew them`, () => {
      for (const size of SIZES) {
        for (const pose of posesOf(size)) {
          const base = boltCells(size as 'small', pose as 'idle')
          const dressed = wearBolt(theme, size, pose)
          const { touched } = dressedPixels(theme, size, pose)
          expect(dressed.length).toBe(base.length)
          dressed.forEach((line, r) => {
            expect(line.length).toBe(base[r]!.length)
            line.forEach((cell, c) => {
              const hit = touched.has(`${2 * r}/${c}`) || touched.has(`${2 * r + 1}/${c}`)
              if (!hit) expect(cell, `${size} ${pose} ${r}/${c}`).toEqual(base[r]![c])
              else expect(['▀', '▄', '█', ' ', base[r]![c]!.ch]).toContain(cell.ch) // a glyph (the z) stays
            })
          })
          if (costume[size].length > 0 && pose === 'idle') expect(dressed).not.toEqual(base)
          if (costume[size].length === 0) expect(dressed).toEqual(base)
        }
      }
    })
  }

  test('the sleeping z glyph survives a costume (untouched cells stay as bolt.ts drew them)', () => {
    const nord = THEMES.find(theme => theme.id === 'nord')!
    const dressed = wearBolt(nord, 'small', 'sleep')
    expect(dressed[0]![8]).toEqual({ ch: 'z', fg: BOLT_PALETTE.G })
  })
})
