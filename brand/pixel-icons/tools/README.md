# Pixel icon and share card tools

Everything here regenerates assets in `brand/` from data. Run from the repo root.

| Script | What it does |
| --- | --- |
| `design.py` | The icon drawings (16 x 16 rows) and palette. Edit icons here. |
| `build.py` | Validates every icon (grid, palette, margin, colour count, centring) and writes `../icons.json` and `../svg/`. |
| `render.sh` | Runs `build.py`, then renders `../contact-sheet.png` and `../before-after.png`. |
| `og_cards.py` | Writes one 1200 x 630 share card per mod as HTML, from `site/mods.json` and `../icons.json`. |
| `shot.sh` | Headless Chrome screenshot helper used by the two above. |

Needs: Python 3 with Pillow (for `render.sh`), Google Chrome at the default macOS path (for `shot.sh`), and Space Grotesk Bold
(OFL) for `og_cards.py`.

Share cards:

```
python3 brand/pixel-icons/tools/og_cards.py site/mods.json brand/pixel-icons/icons.json /path/to/SpaceGrotesk-Bold.ttf /tmp/og-html
for f in /tmp/og-html/*.html; do VTB=4000 brand/pixel-icons/tools/shot.sh "brand/og-cards/$(basename "$f" .html).png" 1200 630 "file://$f"; done
```

Mods in `HOLD` inside `og_cards.py` get no card while a safety fix is unverified.
