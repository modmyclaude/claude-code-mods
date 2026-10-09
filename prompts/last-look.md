---
mod: last-look
title: Last Look
tagline: Holds destructive commands and shows exactly what they would destroy.
category: safety
surfaces: [terminal, desktop]
model_calls: none
---

# Last Look

Holds destructive commands and shows exactly what they would destroy.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "last-look" that holds destructive commands until I approve them and shows exactly what they would destroy.

What it catches (Bash tool calls)
- rm -r / rm -rf, find ... -delete, git clean -fd(x), git reset --hard, git checkout -- . and git restore ., git push --force without --force-with-lease, git branch -D, and redirects that overwrite an existing file (> file).

What it shows
- A side pane (a band above the prompt on narrow terminals) with the command, what it would affect (each file to be deleted and the total size, or the commits or branch to be lost) and two buttons, Proceed and Cancel. Cancel has focus, so Enter cancels.

What is new here
- Git-aware: highlight files with uncommitted changes, because git cannot bring those back ("3 files have unsaved work you would lose").
- Handles compound commands such as cd some/path && rm -rf build by measuring relative to the cd target.
- An alwaysAllow setting for paths that are fine to delete without asking, e.g. dist, build, .next, coverage.
- If it cannot measure a command, it still holds it and says "could not measure: review it yourself" instead of letting it through.

Guardrails
- A safety net, not a permission system: say so in the pane footer. Measure with read-only commands only (ls, du, find without -delete, git status, git log).
- If the mod itself errors, deny the command instead of letting it run.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
