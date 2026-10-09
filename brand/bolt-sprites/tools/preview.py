"""preview.py <out.html>: every Bolt pose as real half-block text cells, on a dark and a light terminal background."""
import html
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from design import GLYPHS, PALETTE, SPRITES  # noqa: E402

UPPER, LOWER, FULL = "▀", "▄", "█"


def cells(size, pose):
    rows = SPRITES[size][pose]
    out = []
    for r in range(0, len(rows), 2):
        line = []
        for c in range(len(rows[0])):
            top, bottom = rows[r][c], rows[r + 1][c]
            t = PALETTE.get(top) if top != "." else None
            b = PALETTE.get(bottom) if bottom != "." else None
            if t is None and b is None:
                line.append((" ", None, None))
            elif b is None:
                line.append((UPPER, t, None))
            elif t is None:
                line.append((LOWER, b, None))
            elif t == b:
                line.append((FULL, t, None))
            else:
                line.append((UPPER, t, b))
        out.append(line)
    for (cr, cc, ch, key) in GLYPHS.get((size, pose), []):
        out[cr][cc] = (ch, PALETTE[key], None)
    return out


def block(size, pose, px):
    lines = []
    for line in cells(size, pose):
        spans = []
        for ch, fg, bg in line:
            style = (f"color:{fg};" if fg else "") + (f"background:{bg};" if bg else "")
            spans.append(f'<span style="{style}">{html.escape(ch)}</span>')
        lines.append("".join(spans))
    return f'<pre style="font-size:{px}px">' + "\n".join(lines) + "</pre>"


out = sys.argv[1]
parts = []
for theme, bg, fg in (("dark terminal", "#101114", "#C9CCD3"), ("light terminal", "#F5F6F1", "#3A3F4A")):
    parts.append(f'<section style="background:{bg};color:{fg}"><h2>{theme}</h2>')
    for size in ("small", "tiny"):
        parts.append(f'<div class="row"><b>{size}</b>')
        for pose in SPRITES[size]:
            big = 22 if size == "small" else 30
            parts.append(f'<figure>{block(size, pose, big)}{block(size, pose, 13)}<figcaption>{pose}</figcaption></figure>')
        parts.append("</div>")
    parts.append("</section>")

doc = """<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:Menlo,monospace}
section{padding:18px 24px}
h2{font:600 14px Menlo,monospace;margin:0 0 10px}
.row{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end;margin-bottom:16px}
.row b{width:48px;font:12px Menlo,monospace}
figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px}
pre{margin:0;line-height:1;font-family:Menlo,monospace;letter-spacing:0}
figcaption{font:11px Menlo,monospace;opacity:.8}
</style></head><body>""" + "".join(parts) + "</body></html>"
open(out, "w").write(doc)
print("wrote", out)
