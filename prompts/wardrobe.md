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
- /wear <theme> switches theme instantly. /wear with no argument lists the themes with a one-line preview of each.
- Restyle what a mod is allowed to draw: tool rows (an icon per tool, plus timing), tool results, diff cards, the spinner and the turn duration.
- Themes: noir, paper (light), tokyo-night, dracula, catppuccin, solarized, nord.

What is new here
- Two accessibility themes: "high-contrast" (WCAG AAA text contrast) and "colorblind" (diffs in blue and orange instead of red and green, tool icons that differ by shape, not only colour). Check every theme for diff contrast.
- auto mode: a light theme by day and a dark theme by night, with the switch times as settings.
- /wear pin saves the current theme for this project only; other projects keep the global theme.

Guardrails
- Display only: no files touched except the mod's own store, no processes, no network.
- If a theme cannot draw something, fall back to Claude Code's own drawing instead of breaking the screen.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
