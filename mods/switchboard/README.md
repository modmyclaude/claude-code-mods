<img src="../../brand/pixel-icons/svg/switchboard.svg" width="64" height="64" alt="">

# Switchboard

Every Claude Code session on your machine in one pane, and which one needs you.

```
2 need you
You are here: api-server (terminal)

! Fix the login   waiting on a permission for Bash · 2m   desktop
✕ tests           stopped on an error 5m ago             terminal
● docs            working for 2m                          terminal   ≈$0.49
○ web             idle for 12m                            terminal
○ 26 quiet sessions: idle, no turn in the last hour       [Show]
– old             closed 2m ago                           terminal
```

## Install

```
/plugin install switchboard --marketplace modmyclaude/claude-code-mods
```

Install it in every session you run (a user-scope install does that): each session shows up once Switchboard runs in it.

## Use it

- **`/switchboard`** opens the pane. The first line says how many sessions need you, and the next one says which session you are in and where.
- **One row per session**, who needs you first: a mark and a colour for its state, its name (the title in the desktop sidebar, or the one Claude Code gives it, else its folder), what it is doing in words, where it runs, and its cost so far when Claude Code keeps that figure.
  - `!` **waiting on** a permission (and for which tool), a subagent's permission, a question, a plan to approve, or an answer
  - `✕` **stopped on an error**
  - `●` **working**
  - `○` **idle**
  - `–` **closed** (it stopped reporting; listed for an hour)
- **Quiet sessions** (idle, with no turn in the last hour) fold into one line. **Show** unfolds them.
- **While another session needs you**, a line above your prompt says which and where (`! Fix the login needs you (desktop)`, with **Show** to open the pane), and the footer counts them (`1 needs you`). Never for this session's own dialog, which is already in front of you.
- **A toast** the moment another session starts needing you, once per change: `Fix the login needs you (desktop).`

It only watches. It never switches to, answers or types into another session: go to that session to answer it.

## Settings

None.

## What it can touch

- **Writes:** one small file for this session, `~/.claude/switchboard/<session id>.json` (or under `CLAUDE_CONFIG_DIR` when that is set), rewritten when its state changes and every 30 seconds. It holds the session's name, state, where it runs, what a dialog waits on (a tool's name, such as `Bash`), two times and its cost figure. The name is the session's title, which Claude Code writes as a short summary of your first prompt (or you set in the desktop sidebar), else the folder's name. Nothing else of your prompts, Claude's replies or your files.
- **Reads:** the other files in that folder, every 5 seconds while you are looking at this session (a terminal or the desktop app attached), only the ones that changed since the last read. Its own session's events: turns starting and ending, the tool a turn calls, Claude Code's own "waiting on you" notice, the session title, and the cost figure.
- **Runs:** `tail` on this session's own transcript (its last 256 KB), when it starts and at most every two minutes at a turn's end, to find the session's title. Only the title lines are kept; the rest is never stored or shown.
- **Session state:** the rows as last read, and whether the quiet ones are unfolded.
- **Network, model calls:** none.

## Limits

- A session shows up only once Switchboard runs in it. Sessions started before you installed it appear after their next restart, or at once where Claude Code hot-loads the mod into them.
- A dialog shows as waiting about six seconds after it opens, when Claude Code raises its own notice; once you answer it, the row says working again after the tool it asked about has run.
- A closed session is inferred: one that has not rewritten its file for 90 seconds is shown as closed. A computer waking from sleep shows its sessions as closed for up to half a minute.
- A brand-new session shows its folder's name until Claude Code titles it, usually after the first prompt. On a host with no `tail` (Windows), the title comes only with your next prompt.
- Files of old sessions stay in the folder (a few hundred bytes each): Claude Code gives mods no way to delete a file. They are never read once older than an hour, and you can delete the folder at any time.
- Two sessions with the same name get the first characters of their ids to tell them apart.
- A session that has not had a turn since Switchboard loaded counts as quiet, so a brand-new one sits in the quiet line until its first prompt.
- The pane, the line and the footer are checked through the engine's test kit on the terminal and desktop surfaces.

## Built from a prompt

This mod was built from [the Switchboard prompt](../../prompts/switchboard.md).

More mods: [the full catalogue](../../README.md#the-mods).
