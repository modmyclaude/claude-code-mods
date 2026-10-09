---
mod: ant-farm
title: Ant Farm
tagline: Watch your subagents work, and what they cost, live.
category: visibility
surfaces: [terminal, desktop]
model_calls: none
---

# Ant Farm

Watch your subagents work, and what they cost, live.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "ant-farm" that makes subagent work visible.

What it does
- While a turn runs, a slim band above my prompt shows elapsed time, subagents running vs done, and the estimated spend so far.
- /antfarm opens a side pane listing every subagent this session: its task, model, a progress bar, tokens used, estimated cost, elapsed time and status (running, done, failed). Running ones on top, finished ones collapsed below.
- Each subagent gets a small pixel-art ant that walks while it works and stops when it is done. One ant colour per model.
- Header totals: total cost, total tokens, wall time.

What is new here
- Budget alarm: a budgetUsd setting (default 2.00). When the session estimate crosses it, show a toast and turn the status line amber; past 2x the budget, red.
- ETA: once a running subagent has made 3 model requests, estimate its time left from its pace so far ("~1m left").
- Narrow terminals: if the pane cannot open (under 144 columns), show a compact list inside the band instead of nothing.

How it works
- Track subagents through the agent spawn and turn step events and count tokens per model request.
- Estimate cost from a small built-in price table per model and mark every cost as an estimate (≈).
- Deterministic only: no model calls of its own.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
