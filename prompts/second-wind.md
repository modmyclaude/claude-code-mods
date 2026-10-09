---
mod: second-wind
title: Second Wind
tagline: A breath, an eye rest or a stretch while Claude works, sized to the wait.
category: wellness
surfaces: [terminal, desktop]
model_calls: none
---

# Second Wind

A breath, an eye rest or a stretch while Claude works, sized to the wait.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "second-wind": while Claude works, a calm animation above my prompt guides me through a breath, an eye rest or a stretch, sized to how long I am waiting.

What it does
- When a turn has run for 3 seconds, a small band appears above my prompt. Quick turns never show it.
- It escalates instead of guessing how long the turn will be:
  - Opens with one physiological sigh (a deep inhale, a short top-up sip, a long slow exhale; about 15 seconds).
  - If the turn keeps going, moves into slow paced breathing (about 5.5 seconds in, 5.5 seconds out). Box breathing (4-4-4-4) is a setting.
  - On long turns (over 60 seconds), swaps in a 20-20-20 eye rest ("look at something 20 feet away for 20 seconds") or a one-line stretch, then returns to breathing.
- The text reads the phase: "Breathe in 4", "Hold 2", "Out 6". The animation is a shape that fills and empties with the breath.
- When Claude answers mid-breath, let the current exhale finish, then fold the band into one line: "4 breaths while Claude worked · 37 today · 6-day streak". It fades after a few seconds.

Get these details right
- Follow only the main conversation's turn. Subagents starting and finishing must never restart or stutter the breath.
- Pace from the wall clock, not by counting animation frames, so the timing never drifts.
- While I am typing my next prompt, shrink to a single quiet line. Never slow down my typing.
- Fit the space actually available (respect docked panes) and leave room for other mods that draw above the prompt.
- Only replace the spinner text when Claude Code is not already showing its own status there.
- Use the current theme's colours, not a fixed colour.

Commands and settings
- /breathe shows today's stats and the current settings. /breathe off, /breathe on, /breathe snooze (off for the rest of today).
- Settings: pattern (slow, box), motion (full, gentle, still for reduced motion), delaySeconds (default 3), eyeRest (on), stretch (on), movementCard (off).
- /breathe card copies a small text card of my stats to the clipboard to share.

Optional movement card (off by default)
- If movementCard is on, every 5th long turn offers a card: "Stand up and stretch" or "10 squats", with Did it and Skip buttons. It never blocks the prompt.

Desktop app
- On the desktop app, draw the breath as a smooth circle that grows and shrinks. In the terminal, use text cells. Mobile and VS Code: spinner text only.

Safety copy
- The help text says: "Breathe gently and never strain. If you feel lightheaded, stop and breathe normally." No health claims.
- Use plain names for the patterns (slow paced breathing, box breathing, physiological sigh), not trademarked method names.

Guardrails
- No files, processes, network or model calls. Stats (counts and dates only) live in the mod's own store.
- Animate only while the band is visible. Stop all timers when idle.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
