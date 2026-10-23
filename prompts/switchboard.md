---
mod: switchboard
title: Switchboard
tagline: Every Claude Code session on your machine in one pane, and which one needs you.
category: visibility
surfaces: [terminal, desktop]
model_calls: none
---

# Switchboard

Every Claude Code session on your machine in one pane, and which one needs you.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "switchboard": a pane that lists every Claude Code session on this machine and tells me which one is waiting on me.

How sessions find each other: each session running the mod writes one small JSON file about itself to ~/.claude/switchboard/<session id>.json (under CLAUDE_CONFIG_DIR when set): its name, its state, where it runs (terminal, desktop or nothing attached), what a dialog waits on, when that state began, when it last had a turn, a heartbeat time, and its cost so far when Claude Code reports one. Never any message text. It rewrites the file when its state changes and every 30 seconds; a file not rewritten for 90 seconds means the session is closed.

The name: the title in the desktop sidebar (a custom-title line in the session's transcript), else the one Claude Code writes (ai-title), else the folder. Read it with `tail -c 262144` on the session's own transcript when it starts and at most every two minutes at a turn's end, keeping only the title lines.

States, from the session's own events: working (a turn started), needs you (Claude Code's own "waiting on you" notification; say what for: "a permission for Bash" from the tool the turn last called, "a question", "a plan to approve"), error (the turn ended on an error), idle (the turn ended), closed (inferred from a stale file). After a dialog is answered and its tool runs, it is working again. A /clear marks the old conversation gone and carries on under the new id.

What I see
- /switchboard opens a pane: "N need you" in amber (or "Nothing needs you" in green), then "You are here: <name> (<where>)", then one row per session, who needs me first: a mark and a colour per state (! waiting, ✕ error, ● working, ○ idle, - closed, never colour alone), the name, the state in words ("waiting on a permission for Bash · 2m", "idle for 9m", "closed 2m ago"), where it runs, and the cost when it is a cent or more.
- Idle sessions with no turn in the last hour fold into one line ("26 quiet sessions") with a Show button. Closed ones sit dimmed at the bottom.
- While another session needs me: one line above my prompt saying which and where, with Show, and a count in the footer ("1 needs you"). Never for this session's own dialog.
- A toast the moment another session starts needing me, once per change, never on the first read, saying where it is.

Rules
- Read the other files every 5 seconds only while I am looking at this session, the newest 60 at most, and only the files that changed; redraw only when what is on screen changed.
- Watch only: never focus, answer or type into another session. No network, no model calls; the only command it runs is that tail.
- Clean every name to one line with no control characters. Skip half-written or unknown files.
- Terminal and desktop app. Other mods' lines above the prompt come first.

Tests: this session's own record through its events, the title from a transcript tail, the pane, band and footer from fake sessions in every state, the quiet fold, exactly one toast per change, no redraw on unchanged reads, and every file touched inside the switchboard folder.
```
