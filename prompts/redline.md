---
mod: redline
title: Redline
tagline: Context fill, session cost and pace on one line, with a warning before the red line.
category: cost
surfaces: [terminal, desktop]
model_calls: none
---

# Redline

Context fill, session cost and pace on one line, with a warning before the red line.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "redline": one glanceable gauge for how close I am to my limits.

What it does
- A compact gauge in the status line: context fill as a percentage with a small bar, the session cost so far, and tokens per minute.
- Colours: normal under 60% context, amber from 60%, red from 80%.
- When context crosses 80%, show one toast suggesting /compact or a fresh session, once per crossing (not on every redraw).
- /redline opens a detail view: context used vs window, input / output / cache read / cache write tokens, estimated cost (always marked ≈), time in session, and the busiest turns.

What is new
- Pace: from the last 10 minutes of usage, estimate when the context will hit 100% at the current rate ("full in ~25m").
- If Claude Code exposes plan usage limits (5-hour or weekly windows) to mods, show them with a run-out estimate too. If it does not, leave them out and say so in the detail view, instead of guessing.
- A band above the prompt mode for people who hide the status line: /redline band toggles it.

How it works
- Read usage from the session and the model request events; cost from a small, clearly labelled built-in price table per model family.
- Deterministic, no model calls, no files, no network.

Build rules
Add a "Where the money went" section to the detail pane: this session's cost split by the kind of work each model request carried, read from the tool results in the request (reading, editing, shell, search, planning, subagents, answering, the prompt itself, other tools by name), split evenly when a request carried several kinds, with a share bar, the request count and the cache share per kind, then the same by model. Mark every cost as an estimate at list prices and say the rule in the footer. /redline spend opens it. Nothing new is stored and the band does not change.

- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
