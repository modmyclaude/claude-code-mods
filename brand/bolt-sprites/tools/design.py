"""Bolt sprite designs: the source drawings for brand/bolt-sprites/bolt-sprites.json.

Each sprite is a list of equal-length rows. "." is empty; every other letter is a palette key.
Rows pair up into half-block text cells (2 pixel rows per cell row), so heights are even.
"""

PALETTE = {
    "B": "#C8F53C",  # lime body
    "S": "#9BC21A",  # lime shade: feet, antenna stem, under-body, arms, a light that is off
    "O": "#FF5C8A",  # signal pink: the antenna light ONLY
    "K": "#FF8FB1",  # blush: the cheeks ONLY
    "E": "#101114",  # ink: eyes, mouth, cracks (always inside a lime shape)
    "W": "#FBFBF8",  # eye shine
    "G": "#8E95A3",  # grey: the sleep z glyph only
}

# Glyphs drawn over a whole cell: (cell_row, cell_col, character, palette key).
GLYPHS = {
    ("small", "sleep"): [(0, 8, "z", "G")],
}

SIZES = {
    "small": {"w": 10, "h": 10, "use": "panes, empty and first-run states, result lines"},
    "tiny": {"w": 3, "h": 4, "use": "game runners and inline status"},
}

SPRITES = {
    "small": {
        "idle": [
            "....OO....",
            "....SS....",
            "..BBBBBB..",
            ".BBBBBBBB.",
            "BBWEBBWEBB",
            "BBEEBBEEBB",
            "BKKBBBBKKB",
            "BBBBEEBBBB",
            ".SSSSSSSS.",
            "..SS..SS..",
        ],
        "run1": [
            "...OO.....",
            "....SS....",
            "..BBBBBB..",
            ".BBBBBBBB.",
            "BBBWEBBWEB",
            "BBBEEBBEEB",
            "BKKBBBBBKB",
            "BBBBBEEBBB",
            ".SSSSSSSS.",
            "SS......SS",
        ],
        "run2": [
            "....OO....",
            "....SS....",
            "..BBBBBB..",
            ".BBBBBBBB.",
            "BBBWEBBWEB",
            "BBBEEBBEEB",
            "BKKBBBBBKB",
            "BBBBBEEBBB",
            ".SSSSSSSS.",
            "...SSSS...",
        ],
        "jump": [
            "....OO....",
            "....SS....",
            "..BBBBBB..",
            ".BBBBBBBB.",
            "BBWEBBWEBB",
            "BBEEBBEEBB",
            "BKKBBBBKKB",
            "BBBBEEBBBB",
            ".SSSSSSSS.",
            "...S..S...",
        ],
        "crash": [
            "......OO..",
            ".....S....",
            "..BBBBBB..",
            ".BBBBBBBB.",
            "BEBEBBEBEB",
            "BBEBBBBEBB",
            "BEBEBBEBEB",
            "BBBBEEBBBB",
            ".SSSSSSSS.",
            "SS......SS",
        ],
        "cheer": [
            "S...OO...S",
            "S...SS...S",
            "SBBBBBBBBS",
            ".BBBBBBBB.",
            "BBWEBBWEBB",
            "BBEEBBEEBB",
            "BKKBBBBKKB",
            "BBBEEEEBBB",
            ".SSSSSSSS.",
            "..SS..SS..",
        ],
        "sleep": [
            "....SS....",
            "....SS....",
            "..BBBBBB..",
            ".BBBBBBBB.",
            "BBBBBBBBBB",
            "BBEEBBEEBB",
            "BKKBBBBKKB",
            "BBBBBBBBBB",
            ".SSSSSSSS.",
            "..SS..SS..",
        ],
        "think": [
            "....OO....",
            "....SS....",
            "..BBBBBB..",
            ".BBWEBWEB.",
            "BBBEEBEEBB",
            "BBBBBBBBBB",
            "BKKBBBBKKB",
            "BBBBBEBBBB",
            ".SSSSSSSS.",
            "..SS..SS..",
        ],
        "egg": [
            "....OO....",
            "....SS....",
            "...BBBB...",
            "..BWBBBB..",
            ".BWBBBBBB.",
            ".BBBBBSBB.",
            ".BBSBBBBB.",
            ".BBBBBBBS.",
            "..BBBBBS..",
            "...SSSS...",
        ],
        "egg-crack": [
            "....OO....",
            "....SS....",
            "...BBBB...",
            "..BWBBBB..",
            ".BWBBBBBB.",
            ".BEBEBEBB.",
            ".BBEBEBEB.",
            ".BBBBBBBS.",
            "..BBBBBS..",
            "...SSSS...",
        ],
    },
    "tiny": {
        "idle": [".O.", "BEB", "BBB", "S.S"],
        "run1": [".O.", "BEB", "BBB", "S.S"],
        "run2": [".O.", "BEB", "BBB", ".S."],
        "jump": [".O.", "BEB", "BBB", ".S."],
        "crash": ["...", ".SO", "BEB", "SSS"],
        "cheer": ["SOS", "BEB", "BBB", "S.S"],
        "sleep": [".S.", "BSB", "BBB", "S.S"],
    },
}
