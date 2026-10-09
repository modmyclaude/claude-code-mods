#!/usr/bin/env python3
"""Validate the icon designs, write icons.json + svg/, and build preview HTML pages.

usage: python3 build.py            # validate + write everything
"""
import html, json, os, sys
from itertools import combinations

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from design import ICONS, PALETTE  # noqa: E402

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILE = {"light": "#101114", "dark": "#1D1F24", "radiusPct": 22}
GRID = 16
FILLS = set("LSPG")
DETAILS = set("DK")
CORNERS = [(1, 1), (14, 1), (1, 14), (14, 14)]


def cells(rows):
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            if c != ".":
                yield x, y, c


def validate(ic):
    errs, warns = [], []
    rows = ic["rows"]
    if len(rows) != GRID:
        errs.append(f"{len(rows)} rows")
    for i, r in enumerate(rows):
        if len(r) != GRID:
            errs.append(f"row {i} has {len(r)} chars")
        bad = set(r) - set(".") - set(PALETTE)
        if bad:
            errs.append(f"row {i} unknown keys {bad}")
    if errs:
        return errs, warns
    for x, y, c in cells(rows):
        if x in (0, 15) or y in (0, 15):
            errs.append(f"margin cell used at ({x},{y})")
        if (x, y) in CORNERS:
            warns.append(f"corner cell ({x},{y}) touches the tile curve")
    counts = {}
    for _, _, c in cells(rows):
        counts[c] = counts.get(c, 0) + 1
    fills = [k for k in FILLS if counts.get(k, 0) > 2]  # 1-2 cells = a highlight, counts as detail
    if len(fills) > 3:
        errs.append(f"{len(fills)} fill colours {sorted(fills)} (max 3)")
    if counts.get("L", 0) == 0:
        errs.append("no lime")
    for x, y, c in cells(rows):
        if c in "DK":
            touch = [(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                     if rows[y + dy][x + dx] == "."]
            if touch:
                errs.append(f"{c} at ({x},{y}) touches the tile: D only inside light shapes, edge K is just '.'")
    grid = {(x, y) for x, y, _ in cells(rows)}
    lonely = [(x, y) for (x, y) in grid
              if not any((x + dx, y + dy) in grid for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy)]
    if lonely:
        warns.append(f"isolated cells {lonely}")
    return errs, warns


def mask(rows):
    return {(x, y) for x, y, _ in cells(rows)}


def similarity(a, b):
    ma, mb = mask(a["rows"]), mask(b["rows"])
    sil = len(ma & mb) / max(1, len(ma | mb))
    ca = {(x, y, c) for x, y, c in cells(a["rows"])}
    cb = {(x, y, c) for x, y, c in cells(b["rows"])}
    col = len(ca & cb) / max(1, len(ca | cb))
    return sil, col


def svg(ic, tile=TILE["light"], size=None, title=True):
    rects = []
    for y, r in enumerate(ic["rows"]):
        x = 0
        while x < GRID:
            c = r[x]
            if c == ".":
                x += 1
                continue
            run = 1
            while x + run < GRID and r[x + run] == c:
                run += 1
            rects.append(f'<rect x="{x}" y="{y}" width="{run}" height="1" fill="{PALETTE[c]}"/>')
            x += run
    rad = round(GRID * TILE["radiusPct"] / 100, 2)
    label = html.escape(f'{ic["name"]} - {ic["meaning"]}')
    wh = f' width="{size}" height="{size}"' if size else ""
    t = f"<title>{label}</title>" if title else ""
    aria = f'role="img" aria-label="{label}"' if title else 'aria-hidden="true"'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"{wh} shape-rendering="crispEdges" {aria}>'
            f'{t}<rect width="16" height="16" rx="{rad}" fill="{tile}"/>' + "".join(rects) + "</svg>")


PAGE_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{background:#8A8C90;font:600 12px/1.2 ui-monospace,Menlo,monospace;color:#101114;padding:18px}
h1{font:700 16px/1 ui-sans-serif,system-ui;margin:0 0 4px}
p.sub{margin:0 0 14px;font-weight:400}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.card{background:#B9BBBE;border-radius:8px;padding:8px}
.name{margin:0 0 6px}
.pair{display:flex;gap:6px}
.panel{display:flex;align-items:flex-end;gap:8px;padding:8px;border-radius:6px}
.panel.light{background:#F5F6F1}.panel.dark{background:#101114}
svg{display:block}
h2{font:700 13px/1 ui-sans-serif,system-ui;margin:16px 0 8px;color:#101114}
"""


def card(ic, sizes):
    def panel(cls, tile):
        return f'<div class="panel {cls}">' + "".join(svg(ic, tile, s, title=False) for s in sizes) + "</div>"
    return (f'<div class="card"><div class="name">{html.escape(ic["name"])}</div><div class="pair">'
            + panel("light", TILE["light"]) + panel("dark", TILE["dark"]) + "</div></div>")


def contact_sheet(sizes=(16, 32, 64), cols=4):
    mods = [i for i in ICONS if i["kind"] == "mod"]
    cats = [i for i in ICONS if i["kind"] == "category"]
    css = PAGE_CSS.replace("repeat(4,1fr)", f"repeat({cols},1fr)")
    body = (f"<h1>modmyclaude pixel icons</h1><p class='sub'>16 x 16 grid at {', '.join(map(str, sizes))} px. "
            "Light panel = paper page with the ink tile #101114. Dark panel = ink page with the #1D1F24 tile.</p>"
            "<h2>Mods</h2><div class='grid'>" + "".join(card(i, sizes) for i in mods) + "</div>"
            "<h2>Categories</h2><div class='grid'>" + "".join(card(i, sizes) for i in cats) + "</div>")
    return f"<!doctype html><html><head><meta charset='utf-8'><style>{css}</style></head><body>{body}</body></html>"


def old_glyph_svg(name, size):
    """Mock of the old 5x5 mirrored hash stamp, same algorithm idea as site/app.js placeholder()."""
    x = 0x811C9DC5
    for ch in name:
        x ^= ord(ch)
        x = (x * 0x01000193) & 0xFFFFFFFF
    seed = x or 1

    def rnd():
        nonlocal seed
        seed ^= (seed << 13) & 0xFFFFFFFF
        seed ^= seed >> 17
        seed ^= (seed << 5) & 0xFFFFFFFF
        seed &= 0xFFFFFFFF
        return seed / 4294967296
    on = set()
    for yy in range(5):
        for xx in range(3):
            if rnd() < 0.52:
                on.add((xx, yy)); on.add((4 - xx, yy))
    for yy in range(1, 4):
        if len(on) < 9:
            on.add((2, yy))
    rects = "".join(f'<rect x="{1.5 + xx * 2.6:.2f}" y="{1.5 + yy * 2.6:.2f}" width="2.3" height="2.3" fill="#C8F53C"/>'
                    for xx, yy in sorted(on))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="{size}" height="{size}" aria-hidden="true">'
            f'<rect width="16" height="16" rx="3.52" fill="#101114"/>{rects}</svg>')


def before_after():
    names = ["noted", "last-look", "ant-farm"]
    by = {i["name"]: i for i in ICONS}
    rows = ""
    for n in names:
        rows += (f"<div class='ba'><div class='lbl'>{n}</div>"
                 f"<div class='col'><div class='cap'>before: hash stamp</div><div class='row'>{old_glyph_svg(n, 32)}{old_glyph_svg(n, 128)}</div></div>"
                 f"<div class='arrow'>-&gt;</div>"
                 f"<div class='col'><div class='cap'>after: pixel icon</div><div class='row'>{svg(by[n], TILE['light'], 32, False)}{svg(by[n], TILE['light'], 128, False)}</div></div>"
                 f"<div class='mean'>{html.escape(by[n]['meaning'])}</div></div>")
    css = """*{box-sizing:border-box;margin:0}body{background:#F5F6F1;color:#101114;font:500 14px/1.35 ui-sans-serif,system-ui;padding:24px}
h1{font:700 20px/1 ui-sans-serif,system-ui;margin-bottom:6px}p{margin-bottom:18px;color:#3A3F4A}
.ba{display:grid;grid-template-columns:110px auto 40px auto 1fr;align-items:center;gap:18px;padding:16px;background:#fff;border-radius:10px;margin-bottom:12px}
.lbl{font:700 14px ui-monospace,Menlo,monospace}.row{display:flex;align-items:flex-end;gap:12px}.cap{font:600 11px ui-monospace,Menlo,monospace;color:#3A3F4A;margin-bottom:6px}
.arrow{font:700 18px ui-monospace,Menlo,monospace;color:#3A3F4A}.mean{color:#3A3F4A;font-size:13px}svg{display:block}"""
    return (f"<!doctype html><html><head><meta charset='utf-8'><style>{css}</style></head><body>"
            "<h1>Before and after</h1><p>The old card art was a random 5 x 5 stamp hashed from the mod name. "
            "The new icons show the thing the mod is about.</p>" + rows + "</body></html>")


def main():
    bad = False
    names = set()
    for ic in ICONS:
        if ic["name"] in names:
            print("DUPLICATE NAME", ic["name"]); bad = True
        names.add(ic["name"])
        errs, warns = validate(ic)
        for e in errs:
            print(f"ERROR {ic['name']}: {e}"); bad = True
        for w in warns:
            print(f"warn  {ic['name']}: {w}")
    pairs = sorted(((similarity(a, b), a["name"], b["name"]) for a, b in combinations(ICONS, 2)), reverse=True)
    print("most similar silhouettes (IoU, colour-IoU):")
    for (sil, col), a, b in pairs[:6]:
        print(f"  {sil:.2f} {col:.2f}  {a} ~ {b}")
    if bad:
        sys.exit(1)

    os.makedirs(os.path.join(OUT, "svg"), exist_ok=True)
    data = {
        "version": "1.0.0",
        "grid": GRID,
        "palette": PALETTE,
        "tile": TILE,
        "icons": [{"name": i["name"], "kind": i["kind"], "meaning": i["meaning"], "rows": i["rows"]} for i in ICONS],
    }
    with open(os.path.join(OUT, "icons.json"), "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    for ic in ICONS:
        with open(os.path.join(OUT, "svg", f"{ic['name']}.svg"), "w") as f:
            f.write(svg(ic, size=16) + "\n")
    with open(os.path.join(HERE, "contact-sheet.html"), "w") as f:
        f.write(contact_sheet())
    with open(os.path.join(HERE, "review-sheet.html"), "w") as f:
        f.write(contact_sheet(sizes=(32, 96), cols=3))
    with open(os.path.join(HERE, "before-after.html"), "w") as f:
        f.write(before_after())
    print(f"wrote {len(ICONS)} icons")


if __name__ == "__main__":
    main()
