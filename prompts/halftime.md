---
mod: halftime
title: Halftime
tagline: Claude works, you play. The whistle blows the moment it needs you.
category: fun
surfaces: [terminal, desktop]
model_calls: none
---

# Halftime

Claude works, you play. The whistle blows the moment it needs you.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "halftime": small games I can play above my prompt while Claude works, that hand the keyboard straight back the moment Claude needs me.

The games (design all of them yourself: original names, art and colours; nothing that copies a famous game's name, pieces or look)
- "dash": a one-button runner. Jump over obstacles; speed rises slowly.
- "slither": a snake on a wide, short field that fits the band.
- "merge": a 4x4 sliding tile board where equal tiles combine. Turn-based.
- "sweep": a small mine field. Turn-based.

How it starts
- /halftime opens a picker. /halftime <game> starts one. /halftime auto offers a game when a turn has run for 10 seconds (an offer I click, never a game that grabs my keyboard by itself). Remember my choice across sessions.
- A game gets my keys only after I click it or start it. Esc always returns the keyboard to the prompt.
- Controls never use Enter, y, n or digits, so a stray key can never answer a prompt from Claude Code.

The whistle (the main feature)
- Whenever Claude needs me (a permission prompt, a question for me, an input request from a tool, or the turn ending), freeze the game instantly, close the board so my keyboard goes back to the prompt, and show "whistle: Claude needs you".
- When Claude starts working again, show a 3-2-1 and resume the same run where I left it.
- Only the main conversation counts: subagents starting and finishing must not pause or resume anything.

Fits any screen
- Size every board to the space the band actually has (not the whole terminal), and reflow on resize without losing the run.
- Works in the terminal and the desktop app. Where games cannot be drawn (VS Code, mobile), show a one-line scorecard instead.

Daily and sharing
- Each game has a daily board: the same seed for everyone that day.
- After a run, a one-line result I can copy: "halftime daily 10-09 · dash 412 · played 3m of a 7m turn".
- Personal bests per game, safe when two sessions are open (re-read before saving so a lower score never overwrites a higher one). Also track total minutes played while waiting.

Performance
- Timers run only while a game is being played. When paused or closed, nothing ticks and nothing redraws. Score from real time, not frame counts.

Guardrails
- No files, processes, network or model calls. Bests and stats live in the mod's own store.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
