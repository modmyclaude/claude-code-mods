---
mod: footprints
title: Footprints
tagline: A live file tree beside the chat that shows where Claude has been.
category: visibility
surfaces: [terminal, desktop]
model_calls: none
---

# Footprints

A live file tree beside the chat that shows where Claude has been.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "footprints": a live file tree beside the chat that shows where Claude has been.

What it does
- /footprints opens a side pane with the project's file tree. Respect .gitignore and skip node_modules and .git.
- As Claude works: files it reads glow blue, files it is editing shimmer amber, files with committed changes turn green, new files get a "new" mark and deleted files are struck through.
- A header line: "read 12 · edited 4 · new 1".

What is new here
- A touched-only toggle (press t, or /footprints touched) that collapses every folder Claude did not touch, so a big repo shrinks to the files that matter.
- Opens at any terminal width when I ask for it, with no fullscreen step. If it cannot fit, it says so in one line instead of failing silently.
- A status line count of edited files, so I see activity with the pane closed.
- Shell changes count too: after each Bash call, check git status and mark the files that changed.

Guardrails
- Reads file names and modification times only, never file contents. Deterministic, no model calls.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
