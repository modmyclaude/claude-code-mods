---
mod: last-look
title: Last Look
tagline: Holds destructive commands until you approve, and shows what they would destroy.
category: safety
surfaces: [terminal, desktop]
model_calls: none
---

# Last Look

Holds destructive commands until you approve, and shows what they would destroy.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "last-look" that holds destructive commands until I approve them and shows what they would destroy.

What it catches (Bash tool calls)
- rm -r / rm -rf, find ... -delete, git clean -fd(x), git reset --hard, git checkout -- . and git restore ., git push --force (even with --force-with-lease alongside), git branch -D, git worktree remove --force, and redirects that overwrite an existing file (> file). Parse `--` (end of options) in every git rule.

What it shows
- A side pane (a band above the prompt on narrow terminals) with the command, what it would affect (each file to be deleted and the total size, or the commits or branch to be lost) and two buttons, Proceed and Cancel. Cancel is the default and Enter cancels. Proceed has no hotkey and the pane never takes the keyboard, so nothing I type can approve a command. While a hold is pending, draw it alone.

What is new here
- Git-aware: highlight files with uncommitted changes, because git cannot bring those back ("3 files have unsaved work you would lose").
- Handles compound commands such as cd some/path && rm -rf build by measuring relative to the cd target.
- An alwaysAllow setting for paths that are fine to delete without asking, e.g. dist, build, .next, coverage: only for rm with plain literal paths whose real path is inside an allowed folder, never for find or anything that follows links.
- The classifier decides whether to hold; measuring only fills in the details. If it cannot measure a command (globs, braces, variables, odd find options), it still holds it and says "could not measure: review it yourself". Skip a hold only on positive proof covering the whole command (e.g. a single redirect to a plain path that does not exist yet).

Guardrails
- A safety net, not a permission system: say so in the pane footer. Measure with read-only commands only (ls, du, find without -delete or any write or exec option, git status, git log). Strip control characters from anything drawn.
- If the mod itself errors, deny the command instead of letting it run.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
