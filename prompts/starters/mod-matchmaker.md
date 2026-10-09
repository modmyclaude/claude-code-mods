---
starter: mod-matchmaker
title: Mod Matchmaker
tagline: Let Claude check your setup and pick the mods worth installing, in order.
---

# Mod Matchmaker

Paste this into Claude Code. It reads this repo's catalogue, checks your machine, and recommends a starter pack. Nothing gets installed until you say so.

```text
Read the mod catalogue at https://github.com/modmyclaude/claude-code-mods (the README and the prompts folder), then help me pick the mods worth installing.

Check my setup yourself first
- My OS, my Claude Code version (mods need 2.1.287 or newer), whether I am in a terminal or the desktop app, my terminal width, and whether my terminal can show images. Ask me only about what you cannot check.

Then ask me three quick questions
- Do I use subagents? Do I run long sessions or step away mid-session? Do I share my screen or record demos?

Recommend
- A table: mod, yes / maybe / skip, and one line on why for my setup. Flag anything that will not run here.
- Group the yeses into packs: Safety, Cost, Visibility, Looks. Order them by what I would feel first.
- Give the exact install line for each pick.
- Suggest one custom mod idea tailored to how I work, and offer to build it with the Mod Maker prompt.

Rules
- Do not install anything until I say yes to each one. Mods run with my permissions.
```
