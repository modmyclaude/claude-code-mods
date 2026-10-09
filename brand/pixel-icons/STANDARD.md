# modmyclaude pixel icon standard (v1.0.0)

Every mod and every category on modmyclaude.com gets an 8-bit icon that shows what it is about.
Bolt is the mascot; icons are the objects. The source of truth is `icons.json` in this folder.

## Grid

- **16 x 16 cells.** The outer ring (row 0, row 15, column 0, column 15) stays empty, so the drawing lives
  in the inner **14 x 14**. The cells (1,1), (14,1), (1,14) and (14,14) sit on the tile's curve: leave them
  empty unless the shape has to reach the edge.
- **Why 16:** one cell is one pixel at favicon size, so every use below is a whole-number scale with no
  half pixels. It matches Bolt's 16-wide grid, so icons and mascot share a pixel size. 14 x 14 drawable
  cells is enough for one object plus one prop, and too few for clutter.

## Sizes

Integer multiples only. Never 20, 24 or 40.

| Size | Scale | Use |
| --- | --- | --- |
| 16 | 1x | favicons, inline with text |
| 32 | 2x | list rows (the main target) |
| 48 | 3x | inspector |
| 64 | 4x | mod page header |
| 128+ | 8x and up | marketing |

Always `shape-rendering="crispEdges"` (SVG) or `image-rendering: pixelated` (bitmaps).

## Tile

Every icon sits on a rounded square the size of the full grid, radius 22% (3.52 of 16).
Fill **#101114** in the light theme and **#1D1F24** in the dark theme. The art is identical in both;
only the tile changes. Never place icon art straight on the page.

## Palette (closed: 6 keys)

| Key | Hex | Role |
| --- | --- | --- |
| `L` | `#C8F53C` | Lime. The primary mass. Every icon has some. |
| `S` | `#9BC21A` | Lime shade. Bottom and right edges of lime shapes; recessed lime parts. |
| `P` | `#F5F6F1` | Paper. Paper, glass, light objects; 1-2 cell highlights. |
| `G` | `#8E95A3` | Grey. Metal, poles, handles, glass tint, the shade of paper shapes, "not yet" parts. |
| `D` | `#3A3F4A` | Dark detail. Lines and marks inside `P` or `L` shapes only. |
| `K` | `#101114` | Ink. Holes and cut-outs fully inside a shape (pupils, slots, keyholes, sprockets). |

Why this set:
- `L` and `S` are Bolt's own ramp, so icons look like they belong next to the mascot.
- `P` and `G` form a second, neutral ramp for the things that are not lime.
- `G` scores 6.3:1 on the light tile and 5.5:1 on the dark tile, so secondary parts read in both themes.
- `D` scores 9.7:1 on paper but only 1.8:1 on the tile, which is why it must stay inside light shapes.
- `K` equals the light tile, so a cut-out reads as a true hole.
- Left out on purpose: signal pink and blush (Bolt only, per BRAND.md), deep lime `#4F7A00` (a text
  colour that turns to mud on the dark tile), and any red or amber (one accent per surface: lime).

## Style rules

1. **Light from the top left.** Lime shapes take one step of `S` on their bottom and right edges. Paper
   shapes may take `G` the same way. An optional `P` highlight goes at the top left of a lime mass.
2. No anti-aliasing, no dithering, no gradients, no glows.
3. No ink outlines: the tile is already dark. Separate parts with a 1-cell gap of tile.
4. **At most 3 fill colours** (from `L S P G`) per icon, plus `D` and `K` details. A colour on 1-2 cells
   counts as a detail.
5. Chunky lines: 1 cell or thicker, always connected. No stray single pixels, except deliberate
   highlights, rivets or toes.
6. Front or side view, simple silhouette, centred: the bounding box centre sits within half a cell of the
   tile centre (7.5, 7.5).
7. `D` and `K` never touch the tile. A `K` on the silhouette edge is just a notch, so write `.` instead.
8. Every icon must be recognisable as a flat silhouette at 16 px.

## Semantics

- **One clear real-world object per icon.** Add one secondary prop only when it removes ambiguity
  (notepad + pencil, eye + trash can).
- Prefer the object in the mod's name when it can be drawn (footprints, thermostat, porthole); otherwise
  draw the tool of the action (fine-print = magnifier over small print).
- **Category icons** (`cat-<category>`) are simpler: one shape, 2-3 colours, no prop. They never reuse an
  object that a mod icon uses.
- **Banned:** Anthropic or Claude marks and terracotta; anything Clawd-like; Bolt, or a face on any object
  (it competes with the mascot, so watch for spots and slots that read as eyes and teeth); trademarked
  game characters and their shapes (no wedge-mouthed circles, no famous coins, blocks or plumbers);
  sparkles and 4-point stars; letters, digits and words (one symbol only if unavoidable, such as the tick
  on `cat-review`); pink.

Objects already taken: notepad, pencil, eye, trash can, ant, t-shirt, hanger, page, magnifier,
footprints, thermometer, porthole, film strip, egg, pager, dial gauge, whistle, signpost, flag on a track,
wind, ticket with keyhole, shield, coin, binoculars, clipboard, light bulb, floppy disk, flowchart, bell,
paint roller, game controller, heart.

## Data format

`icons.json`:

```json
{
  "version": "1.0.0",
  "grid": 16,
  "palette": { "L": "#C8F53C", "S": "#9BC21A", "P": "#F5F6F1", "G": "#8E95A3", "D": "#3A3F4A", "K": "#101114" },
  "tile": { "light": "#101114", "dark": "#1D1F24", "radiusPct": 22 },
  "icons": [
    { "name": "noted", "kind": "mod", "meaning": "One sentence: object, then why it fits.", "rows": ["16 strings", "of 16 chars"] }
  ]
}
```

- `rows`: exactly 16 strings of exactly 16 characters. `.` is empty (the tile shows), letters are palette
  keys. Same row-string format as Bolt's pixel map.
- `kind` is `mod` or `category`. Mod icons are named after the mod; category icons are `cat-<category>`.
- `meaning` doubles as the accessible label.

## Rendering

For each row, merge each run of one key into a single `<rect x y width="run" height="1" fill="hex">`, then
wrap:

```html
<svg viewBox="0 0 16 16" width="32" height="32" shape-rendering="crispEdges" role="img" aria-label="name - meaning">
  <title>name - meaning</title>
  <rect width="16" height="16" rx="3.52" fill="#101114"/>  <!-- the tile -->
  ...runs...
</svg>
```

`svg/<name>.svg` are pre-rendered at 16 x 16 with the light tile. On the site, prefer rendering inline from
`icons.json` with the tile fill taken from a theme variable, so one art set follows the theme.

## How to make a new icon

1. **Meaning first.** Read the mod's title, tagline and prompt. Write the `meaning` as "object: why it
   fits". If you cannot name one drawable object, draw the tool of the action. Check the taken list above.
2. **Silhouette.** Block the shape in the 14 x 14 area with one letter. Render it flat at 16 and 32 px:
   a developer must name the object within 2 seconds at 32 px. If it reads as a face, redraw.
3. **Colour.** `L` for the mass, `S` on bottom and right edges, `P`/`G` for paper, glass or metal, `D`/`K`
   for details. Stay within 3 fills.
4. **Validate.** 16 rows x 16 chars, keys from the palette only, outer ring empty, `D`/`K` not touching
   the tile, no stray pixels, centred within half a cell.
5. **Both-tile test.** Render on `#101114` and `#1D1F24` at 16, 32 and 64 px. Anything that disappears on
   one tile is wrong.
6. **Distinctness test.** Put it in the contact sheet beside every existing icon. It must not share an
   object with another icon, and its silhouette must not be confusable with one at 32 px.
7. **Ship.** Add it to `icons.json`, regenerate `svg/` and `contact-sheet.png`, and look at the sheet
   before you call it done.
