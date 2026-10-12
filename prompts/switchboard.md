---
mod: switchboard
title: Switchboard
tagline: Every Claude Code session on your machine in one pane, and which one needs you.
category: visibility
surfaces: [terminal, desktop]
model_calls: none
draft: true
---

# Switchboard

Every Claude Code session on your machine in one pane, and which one needs you.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "switchboard": a pane that lists every Claude Code session on this machine and tells me which one is waiting on me.

How sessions find each other: each session running the mod writes one small JSON file about itself to ~/.claude/switchboard/<session id>.json (under CLAUDE_CONFIG_DIR when set): its name (the session title, else the folder name), its state, when that state began, a heartbeat time, and its cost so far when Claude Code reports one. Never any message text. It rewrites the file when its state changes and once a minute; a file not rewritten for three minutes means the session is gone.

States, from the session's own events: working (a turn started), needs you (Claude Code's own "waiting on you" notification: a permission, a question, a plan to approve), error (the turn ended on an error), idle (the turn ended), gone (inferred from a stale file). After a dialog is answered and its tool runs, it is working again. A /clear marks the old conversation gone and carries on under the new id.

What I see
- /switchboard opens a pane: a line saying how many need me, then one row per session (who needs me first, then working, idle and recently gone), each with its name, state, time in that state and cost. Mark this session's own row.
- One line above my prompt, only while another session needs me, with a Show button. Never for this session's own dialog.
- A toast the moment another session starts needing me, once per change, never on the first read.

Rules
- Read the other files every 5 seconds only while I am looking at this session, the newest 40 at most; redraw only when what is on screen changed.
- Watch only: never focus, answer or type into another session. No network, no model calls.
- Clean every name to one line with no control characters. Skip half-written or unknown files.
- Terminal and desktop app. Other mods' lines above the prompt come first.

Tests: this session's own record through its events, the pane and band from four fake sessions in every state, exactly one toast per change, no redraw on unchanged reads, and every file touched inside the switchboard folder.
```
