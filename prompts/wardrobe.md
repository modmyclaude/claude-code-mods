---
mod: wardrobe
title: Wardrobe
tagline: Restyle Claude Code live, including colourblind-safe and high-contrast themes.
category: looks
surfaces: [terminal, desktop]
model_calls: none
---

# Wardrobe

Restyle Claude Code live, including colourblind-safe and high-contrast themes.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "wardrobe" that restyles how Claude Code draws its work, switchable live.

What it does
- /wear <theme> switches theme instantly, and shows a themed band above the prompt for a few seconds so the switch is unmistakable: the theme's background colour, its mark, "wearing <theme>", its tool icons, and the mascot in that theme's costume.
- /wear with no argument opens a gallery: a card per theme with a sample tool row drawn in that theme, its diff chips, the mascot in costume, and a "wear" button.
- Restyle what a mod is allowed to draw: tool rows (a one-cell accent stripe, an icon per tool, plus timing), tool results, diff cards, the spinner and the turn duration.
- Themes: noir, paper (light), tokyo-night, dracula, catppuccin, solarized, nord.
- Seasonal packs with their own palettes, marks and icons: halloween, christmas, spring (light), summer, autumn. /wear season picks one by the date (Oct 15 to Nov 1 halloween; Dec 1 to Jan 6 christmas; Mar to May spring; Jun to Aug summer; Sep to Nov autumn; the rest of winter nord) and re-checks the calendar daily.

What is new here
- Two accessibility themes: "high-contrast" (WCAG AAA text contrast) and "colorblind" (diffs in blue and orange instead of red and green, tool icons that differ by shape, not only colour). Check every theme, the seasonal packs included, for diff contrast.
- The mascot in costume: an accessory per theme (a witch hat, a santa hat, a flower crown, sunglasses, a cape and fangs, cat ears ...) drawn over the sprite, never a change to it; the antenna light stays clear and the costume uses at most three colours from the theme's palette.
- auto mode: a light theme by day and a dark theme by night, with the switch times as settings.
- /wear pin saves the current theme for this project only; other projects keep the global theme.

Guardrails
- Display only: no files touched except the mod's own store, no processes, no network.
- If a theme cannot draw something, fall back to Claude Code's own drawing instead of breaking the screen.
- The band draws under any other mod's band, never while a survey holds the band, and never over a safety hold. No emoji anywhere, no flashing.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
