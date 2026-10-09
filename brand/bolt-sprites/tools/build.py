"""build.py: validates the Bolt sprites in design.py, then writes bolt-sprites.json and bolt.ts.

Run from the repo root: python3 -I brand/bolt-sprites/tools/build.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from design import GLYPHS, PALETTE, SIZES, SPRITES  # noqa: E402

OUT = os.path.dirname(HERE)
UPPER, LOWER, FULL = "▀", "▄", "█"
VERSION = "1.0.0"


def fail(msg):
    sys.exit(f"!! {msg}")


def validate():
    for size, poses in SPRITES.items():
        w, h = SIZES[size]["w"], SIZES[size]["h"]
        if h % 2:
            fail(f"{size}: height {h} must be even (2 pixel rows per cell)")
        for pose, rows in poses.items():
            name = f"{size}/{pose}"
            if len(rows) != h or any(len(r) != w for r in rows):
                fail(f"{name}: must be {w} x {h}")
            for y, row in enumerate(rows):
                for x, ch in enumerate(row):
                    if ch != "." and ch not in PALETTE:
                        fail(f"{name}: unknown key {ch!r} at {x},{y}")
                    # BRAND.md: signal pink is the antenna light only, so it lives in the top rows.
                    if ch == "O" and y > 2:
                        fail(f"{name}: pink light below the antenna at {x},{y}")
                    if ch == "G" and pose != "sweat":
                        fail(f"{name}: grey is for the sleep z and the sweat drop only")
                    # Ink must sit inside a lime shape, or it vanishes on a dark terminal.
                    if ch == "E":
                        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                            nx, ny = x + dx, y + dy
                            if not (0 <= nx < w and 0 <= ny < h) or rows[ny][nx] == ".":
                                fail(f"{name}: ink at {x},{y} touches the outside")
            if not any("O" in r for r in rows) and pose not in ("sleep",):
                fail(f"{name}: every awake pose shows the antenna light")
    for (size, pose), glyphs in GLYPHS.items():
        for (r, c, ch, key) in glyphs:
            if r >= SIZES[size]["h"] // 2 or c >= SIZES[size]["w"] or key not in PALETTE or len(ch) != 1:
                fail(f"{size}/{pose}: bad glyph {ch!r} at cell {r},{c}")


def cells(size, pose):
    rows = SPRITES[size][pose]
    out = []
    for r in range(0, len(rows), 2):
        line = []
        for c in range(len(rows[0])):
            t = PALETTE[rows[r][c]] if rows[r][c] != "." else None
            b = PALETTE[rows[r + 1][c]] if rows[r + 1][c] != "." else None
            if t is None and b is None:
                cell = {"ch": " "}
            elif b is None:
                cell = {"ch": UPPER, "fg": t}
            elif t is None:
                cell = {"ch": LOWER, "fg": b}
            elif t == b:
                cell = {"ch": FULL, "fg": t}
            else:
                cell = {"ch": UPPER, "fg": t, "bg": b}
            line.append(cell)
        out.append(line)
    for (cr, cc, ch, key) in GLYPHS.get((size, pose), []):
        out[cr][cc] = {"ch": ch, "fg": PALETTE[key]}
    return out


def write_json():
    doc = {
        "version": VERSION,
        "note": "Bolt sprites for mods. rows: one letter per pixel ('.' = empty). cells: the same art packed into "
                "half-block text cells, two pixel rows per cell row; a missing fg/bg means the surface's own colour.",
        "palette": PALETTE,
        "sizes": {s: {"w": v["w"], "h": v["h"], "cols": v["w"], "cellRows": v["h"] // 2, "use": v["use"]}
                  for s, v in SIZES.items()},
        "sprites": [
            {"size": size, "pose": pose, "rows": rows,
             "glyphs": [{"row": r, "col": c, "ch": ch, "color": k} for (r, c, ch, k) in GLYPHS.get((size, pose), [])],
             "cells": cells(size, pose)}
            for size, poses in SPRITES.items() for pose, rows in poses.items()
        ],
    }
    path = os.path.join(OUT, "bolt-sprites.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return path


def write_ts():
    sizes = " | ".join(f"'{s}'" for s in SPRITES)
    pose_types = "\n".join(
        f"export type Bolt{size.capitalize()}Pose = " + " | ".join(f"'{p}'" for p in poses)
        for size, poses in SPRITES.items())
    sprite_lines = []
    for size, poses in SPRITES.items():
        sprite_lines.append(f"  {size}: {{")
        for pose, rows in poses.items():
            sprite_lines.append(f"    '{pose}': [" + ", ".join(f"'{r}'" for r in rows) + "],")
        sprite_lines.append("  },")
    glyph_lines = [f"  '{s}/{p}': [" + ", ".join(f"{{ row: {r}, col: {c}, ch: '{ch}', color: '{k}' }}"
                                                 for (r, c, ch, k) in g) + "],"
                   for (s, p), g in GLYPHS.items()]
    palette = "\n".join(f"  {k}: '{v}'," for k, v in PALETTE.items())
    src = f"""// Bolt sprites for mods, v{VERSION}. GENERATED by brand/bolt-sprites/tools/build.py: edit design.py, not this file.
// Copy this file into your mod's hooks/ folder (mods install on their own, so they cannot import from brand/).
// Rules (brand/BRAND.md): pink is the antenna light only, blush the cheeks only. Never recolour, rotate or stretch.
// Never draw Bolt over a safety hold, and never in a toast (toasts are uncoloured text).

export const BOLT_PALETTE = {{
{palette}
}} as const

export type BoltSize = {sizes}
{pose_types}
export type BoltPose = BoltSmallPose | BoltTinyPose

/** One text cell: a character and its colours (absent = the surface's own). */
export type BoltCell = {{ ch: string; fg?: string; bg?: string }}

/** Pixel rows: one palette letter per pixel, '.' empty. Heights are even (two pixel rows per cell). */
export const BOLT_SPRITES = {{
{chr(10).join(sprite_lines)}
}} as const

/** Letters drawn over a whole cell (cell coordinates). */
const GLYPHS: Record<string, readonly {{ row: number; col: number; ch: string; color: keyof typeof BOLT_PALETTE }}[]> = {{
{chr(10).join(glyph_lines)}
}}

/** The two run frames, in order. Swap them about every 120 ms while running. */
export const BOLT_RUN = ['run1', 'run2'] as const

function colour(key: string | undefined): string | undefined {{
  if (key === undefined || key === '.') return undefined
  return (BOLT_PALETTE as Record<string, string>)[key]
}}

/**
 * Packs a pose into half-block text cells: rows / 2 lines of `cols` cells.
 * Terminal: draw with Raster (see hatchling's rasterCells). Desktop: one fixed-width cell per character (see MM-084).
 */
export function boltCells(size: 'small', pose: BoltSmallPose): BoltCell[][]
export function boltCells(size: 'tiny', pose: BoltTinyPose): BoltCell[][]
export function boltCells(size: BoltSize, pose: BoltPose): BoltCell[][] {{
  const rows: readonly string[] = (BOLT_SPRITES[size] as Record<string, readonly string[]>)[pose] ?? []
  const out: BoltCell[][] = []
  for (let r = 0; r + 1 < rows.length; r += 2) {{
    const top = rows[r] ?? ''
    const bottom = rows[r + 1] ?? ''
    const line: BoltCell[] = []
    for (let c = 0; c < top.length; c += 1) {{
      const t = colour(top[c])
      const b = colour(bottom[c])
      if (t === undefined && b === undefined) line.push({{ ch: ' ' }})
      else if (b === undefined) line.push({{ ch: '\\u2580', fg: t }})
      else if (t === undefined) line.push({{ ch: '\\u2584', fg: b }})
      else if (t === b) line.push({{ ch: '\\u2588', fg: t }})
      else line.push({{ ch: '\\u2580', fg: t, bg: b }})
    }}
    out.push(line)
  }}
  for (const glyph of GLYPHS[`${{size}}/${{pose}}`] ?? []) {{
    const line = out[glyph.row]
    if (line !== undefined && glyph.col < line.length) line[glyph.col] = {{ ch: glyph.ch, fg: BOLT_PALETTE[glyph.color] }}
  }}
  return out
}}

/** Merges a row of cells into runs of one style, for coloured Text spans. */
export function boltRuns(line: readonly BoltCell[]): BoltCell[] {{
  const runs: BoltCell[] = []
  for (const cell of line) {{
    const last = runs[runs.length - 1]
    if (last !== undefined && last.fg === cell.fg && last.bg === cell.bg) last.ch += cell.ch
    else runs.push({{ ...cell }})
  }}
  return runs
}}
"""
    path = os.path.join(OUT, "bolt.ts")
    with open(path, "w", encoding="utf-8") as f:
        f.write(src)
    return path


validate()
print("validated", sum(len(p) for p in SPRITES.values()), "sprites")
print("wrote", write_json())
print("wrote", write_ts())
