---
mod: ant-farm
title: Ant Farm
tagline: Mission control for your subagents: what each one is doing, its activity and its cost, live.
category: visibility
surfaces: [terminal, desktop]
model_calls: none
---

# Ant Farm

Mission control for your subagents: what each one is doing, its activity and its cost, live.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "ant-farm" that makes subagent work visible: a mission control for my subagents.

What it does
- While a turn runs, a slim band above my prompt shows elapsed time, subagents running vs done, and the estimated spend so far.
- /antfarm opens a side pane that is a mission control. A header: the mission's state in one line, a mission clock (T+12:04), counts of running, done and failed, total cost, total tokens, wall time, and a budget bar. Then one bordered card per running subagent, one to three across depending on the pane's width: its number and task, a status pill (WORKING, THINKING, WAITING, DONE, FAILED), its model, elapsed time, what it is doing right now (the tool it runs and what it touches), a sparkline of tokens per request, a progress bar, requests, tokens and estimated cost. Finished ones fold to one line each below.
- The status must be read from real events, never guessed: thinking and writing from the chunks of the subagent's own model requests, the tool from its tool calls, waiting from a permission ask on its tool, done and failed from its turn's end.
- An activity timeline under the cards: the last 80 things the subagents did, newest first, each on the mission clock with the subagent's number: starts, handoffs, tool calls, file edits, endings, tools that failed or were refused, warnings. Twelve rows by default, more on demand, foldable.
- An inspector: pressing inspect on a card (or its digit 1-9 while the pane has the keyboard) opens a panel with that subagent's details, live state, numbers and its own recent rows; n and p move between subagents, x closes.
- Each subagent gets a small pixel-art ant that walks while it works and stops when it is done. One ant colour per model. The card's border takes that colour, turns green for a moment when it finishes, red when it fails, then dims.
- Under 40 columns, draw one plain line per subagent instead of cards so nothing is lost.

What is new here
- Budget alarm: a budgetUsd setting, off (0) by default so a first heavy session never reads as over budget; the pane shows "No budget set - add one in /config". Once set, when the session estimate crosses it, show a toast and turn the budget mark amber; past 2x the budget, red. It only warns, never stops anything.
- ETA: once a running subagent has made 3 model requests, estimate its time left from its pace so far ("~1m left").
- Narrow terminals: if the pane cannot open (under 144 columns), show a compact list inside the band instead of nothing.

How it works
- Track subagents through the agent spawn and turn step events and count tokens per model request; watch their tool calls and permission verdicts without changing any of them, and keep the model stream passing through untouched.
- Estimate cost from a small built-in price table per model and mark every cost as an estimate (≈).
- Deterministic only: no model calls of its own.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
