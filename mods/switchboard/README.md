<img src="../../brand/pixel-icons/svg/switchboard.svg" width="64" height="64" alt="">

# Switchboard

Every Claude Code session on your machine in one pane, and which one needs you.

```
2 of 5 need you
site                    needs you   now
tests                   error        5m
docs                    working      2m    ≈$0.49
api-server (this one)   idle        now
web                     idle        12m    ≈$4.10
```

## Install

```
/plugin install switchboard --marketplace modmyclaude/claude-code-mods
```

Install it in every session you run (a user-scope install does that): each session shows up once Switchboard runs in it.

## Use it

- **`/switchboard`** opens the pane: one row per session, with its name (the session's title, else its folder), its state, how long it has been in that state, and what it has cost so far when Claude Code keeps that figure. This session is marked "(this one)".
- **States:** `needs you` (Claude Code is waiting on a permission, a question or a plan to approve), `error` (the turn ended on an error), `working`, `idle`, and `gone` (the session closed, crashed or the computer slept; gone sessions drop off after an hour).
- **A line above your prompt** while another session needs you: `docs needs you`, with **Show** to open the pane. Nothing is drawn when nothing needs you, and never for this session's own dialog, which is already in front of you.
- **A toast** the moment another session starts needing you, once per change: `docs needs you.`

It only watches. It never switches to, answers or types into another session.

## Settings

None.

## What it can touch

- **Writes:** one small file for this session, `~/.claude/switchboard/<session id>.json` (or under `CLAUDE_CONFIG_DIR` when that is set), rewritten when the session's state changes and once a minute. It holds the session's name, state, two times and cost figure. Never your prompts, Claude's replies, file names or any other text.
- **Reads:** the other files in that folder, every 5 seconds while you are looking at this session (a terminal or the desktop app attached), the newest 40 at most. Its own session's events: turns starting and ending, Claude Code's own "waiting on you" notice, the session title, and the cost figure.
- **Session state:** the rows as last read. Nothing else is kept.
- **Processes, network, model calls:** none.

## Limits

- A session shows up only once Switchboard runs in it. Sessions started before you installed it appear after their next restart.
- A dialog shows as `needs you` about six seconds after it opens, when Claude Code raises its own notice; after you answer it, the row says `working` again once the tool it asked about has run.
- `gone` is inferred: a session that has not rewritten its file for three minutes is treated as gone, so a computer waking from sleep shows its sessions as gone for up to a minute.
- Files of old sessions stay in the folder (a few hundred bytes each). They are never read once older than an hour, and are safe to delete.
- Two sessions with the same name get the first characters of their ids to tell them apart.
- The pane and the line are checked through the engine's test kit on the terminal and desktop surfaces.

## Built from a prompt

This mod was built from [the Switchboard prompt](../../prompts/switchboard.md).

More mods: [the full catalogue](../../README.md#the-mods).
