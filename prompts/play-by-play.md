---
mod: play-by-play
title: Play-by-Play
tagline: Replays every change Claude made in a turn, shell edits included.
category: review
surfaces: [terminal, desktop]
model_calls: none
---

# Play-by-Play

Replays every change Claude made in a turn, shell edits included.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "play-by-play" that replays every change Claude made in a turn, one step at a time.

What it does
- After a turn that changed files, show a hint above my prompt: "4 edits · 3 files · +38 −12 · press r or /replay".
- /replay opens a pane that steps through each change in order: the file name, the diff (removed lines red, added lines green) and Prev, Next and Close buttons. Arrow keys work too.

What is new here
- Shell changes too: snapshot git diff before and after each Bash call, so renames and edits made by commands appear as steps, marked "via shell".
- A scoreboard at the top: files touched, lines added and removed, and the biggest change.
- /replay <n> replays an earlier turn (keep the last 10 turns of the session).
- A jump list: press a number to jump to a file's first change.

Guardrails
- Read-only: it never reverts or edits anything. Deterministic, no model calls.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
