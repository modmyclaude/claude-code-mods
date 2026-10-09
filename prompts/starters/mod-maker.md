---
starter: mod-maker
title: Mod Maker
tagline: Describe the feature you wish Claude Code had. Get a tested, installable mod.
---

# Mod Maker

Describe the feature you wish Claude Code had. Swap the part in square brackets and paste the whole prompt into Claude Code.

```text
Build me a Claude Code mod: [what you want to see or change, e.g. "a pomodoro timer in the status line that chimes when 25 minutes are up and asks if I want a break"].

How to build it
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Pick the right shape and tell me in one line which and why: a band above the prompt, a side pane, a status line entry, a toast, a sound, a slash command, or a hook on tool calls or prompts.
- Keep it small: only draw and do what I asked. No network calls, no model calls and no reading files it does not need, unless I ask for them.
- If it can block or change anything (a tool call, a prompt), make it fail safe: when the mod itself breaks, it should say so, not silently let things through or silently block me.

Prove it works
- Write tests for the main behaviour, including the UI on both the terminal and the desktop app if it draws anything.
- Run `claude plugin validate` and `claude plugin test` until both pass.

Then
- Load it in this session so I can try it, and take my changes in plain words.
- When I say it is good: copy it to a folder I keep, install it so it loads in every session, and tell me where it lives and how to turn it off.
- Finally, add a marketplace file so I can share it, and give me the one-line install command to send a friend.
```
