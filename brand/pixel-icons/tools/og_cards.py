"""og_cards.py <mods.json> <icons.json> <SpaceGrotesk ttf> <out html dir>
Writes one 1200x630 Open Graph card per mod as HTML (rendered to PNG by shot.sh)."""
import html, json, os, sys

mods_path, icons_path, font_path, out = sys.argv[1:5]
mods = json.load(open(mods_path))["mods"]
icons = json.load(open(icons_path))
pal, by_name = icons["palette"], {i["name"]: i for i in icons["icons"]}
labels = {"safety": "Safety", "cost": "Cost and limits", "visibility": "See what Claude is doing", "review": "Review changes",
          "insight": "Catch what you would miss", "memory": "Memory", "workflow": "Workflow", "alerts": "Alerts",
          "looks": "Looks", "fun": "Fun", "wellness": "Wellness"}
os.makedirs(out, exist_ok=True)
HOLD: set = set()  # mods with no share card while a safety fix is unverified (none at launch, 2026-10-11)


def icon_svg(name, size, tile):
    rows = by_name[name]["rows"]
    rects = []
    for y, row in enumerate(rows):
        x = 0
        while x < 16:
            c = row[x]
            if c == ".":
                x += 1
                continue
            w = 1
            while x + w < 16 and row[x + w] == c:
                w += 1
            rects.append(f'<rect x="{x}" y="{y}" width="{w}" height="1" fill="{pal[c]}"/>')
            x += w
    rx = 16 * icons["tile"]["radiusPct"] / 100
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 16 16" shape-rendering="crispEdges">'
            f'<rect width="16" height="16" rx="{rx}" fill="{tile}" shape-rendering="geometricPrecision"/>{"".join(rects)}</svg>')


BOLT = """.......OO.......|.......OO.......|.......AA.......|...BBBBBBBBBB...|..BBBBBBBBBBBB..|.BBBBBBBBBBBBBB.|.BBBWEBBBBWEBBB.|.BBBEEBBBBEEBBB.|.BBBEEBBBBEEBBB.|.BKKBBMBBMBBKKB.|.BBBBBBMMBBBBBB.|..BBBBBBBBBBBB..|...SSSSSSSSSS...|....FF....FF....""".split("|")
BC = {"B": "#C8F53C", "S": "#9BC21A", "F": "#9BC21A", "A": "#9BC21A", "O": "#FF5C8A", "E": "#101114", "M": "#101114", "W": "#FBFBF8", "K": "#FF8FB1"}
bolt = "".join(f'<rect x="{x}" y="{y}" width="1" height="1" fill="{BC[c]}"/>' for y, r in enumerate(BOLT) for x, c in enumerate(r) if c != ".")
bolt_svg = f'<svg width="48" height="42" viewBox="0 0 16 14" shape-rendering="crispEdges">{bolt}</svg>'

for m in mods:
    if m["name"] not in by_name or m["name"] in HOLD:
        continue
    tagline = html.escape(m["tagline"].replace("\u2014", " - "))
    title = html.escape(m["title"])
    tests = m.get("tests", {}).get("count")
    chips = [labels.get(m["category"], m["category"])]
    chips.append("Terminal + Desktop")
    chip_html = "".join(f"<span>{html.escape(c)}</span>" for c in chips)
    doc = f"""<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500&family=Geist+Mono:wght@400;500&display=block" rel="stylesheet">
<style>
@font-face {{ font-family: 'SG'; src: url('file://{font_path}'); font-weight: 700; }}
* {{ margin: 0; box-sizing: border-box; }}
html, body {{ width: 1200px; height: 630px; background: #101114; overflow: hidden; }}
.card {{ position: relative; width: 1200px; height: 630px; padding: 72px 80px; display: grid; grid-template-columns: 256px 1fr; column-gap: 64px; align-items: center; }}
.grid {{ position: absolute; inset: 0; background-image: linear-gradient(#1A1C21 1px, transparent 1px), linear-gradient(90deg, #1A1C21 1px, transparent 1px); background-size: 32px 32px; opacity: .55; }}
.icon, .text {{ position: relative; }}
.word {{ position: absolute; top: 56px; left: 80px; font: 700 30px 'SG'; letter-spacing: -0.02em; color: #F5F6F1; display: flex; gap: 14px; align-items: center; }}
.word b {{ color: #C8F53C; font-weight: 700; }}
.url {{ position: absolute; bottom: 52px; right: 80px; font: 500 22px 'Geist Mono'; color: #8E95A3; }}
h1 {{ font: 700 92px/0.98 'SG'; letter-spacing: -0.035em; color: #F5F6F1; }}
p {{ margin-top: 22px; font: 400 32px/1.3 'Geist'; color: #C9CCD3; max-width: 700px; }}
.chips {{ margin-top: 30px; display: flex; gap: 10px; flex-wrap: wrap; }}
.chips span {{ font: 500 20px 'Geist Mono'; color: #C8F53C; border: 1.5px solid #3A3F4A; border-radius: 999px; padding: 7px 16px; }}
.install {{ position: absolute; bottom: 52px; left: 80px; font: 500 22px 'Geist Mono'; color: #F5F6F1; }}
.install i {{ color: #8E95A3; font-style: normal; }}
</style></head><body><div class="card"><div class="grid"></div>
<div class="word">{bolt_svg}<span><b>mod</b>myclaude</span></div>
<div class="icon">{icon_svg(m["name"], 256, "#1D1F24")}</div>
<div class="text"><h1>{title}</h1><p>{tagline}</p><div class="chips">{chip_html}</div></div>
<div class="install"><i>/plugin install</i> {html.escape(m["name"])}@modmyclaude</div>
<div class="url">modmyclaude.com</div>
</div></body></html>"""
    open(os.path.join(out, f'{m["name"]}.html'), "w").write(doc)
    print(m["name"])
