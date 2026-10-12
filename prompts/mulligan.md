---
mod: mulligan
title: Mulligan
tagline: A do-over for shell commands - it saves your project's files before a destructive command, and /mulligan puts them back.
category: safety
surfaces: [terminal, desktop]
model_calls: none
draft: true
---

# Mulligan

A do-over for shell commands: it saves your project's files before a destructive command, and /mulligan puts them back.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "mulligan": a do-over for shell commands, covering what /rewind skips.

Before Claude runs a Bash command that destroys files (rm -r, find -delete, xargs rm, git clean, git reset --hard, git checkout or restore over changes, git worktree remove, a redirect over a file), save what that command can destroy, in a tool.call hook before next(e). Use a positive list of these shapes, parsed from the command (quotes, cd, subshells, bash -c), never "everything else is safe".

What to save: the paths the command names, resolved from the shell's current folder; for git reset or checkout, the tracked files through git stash create (HEAD when nothing changed), which moves no ref; for git clean, the untracked files git ls-files --others --exclude-standard lists; when a target is only known as it runs, the whole project without .git and node_modules. Nothing outside the project folder: say so when a command reaches outside. Copy files with tar into a pending archive under ~/.claude/mulligan/<hash of the project path>/, and keep it only once the command ran: a command another mod held or refused leaves no snapshot. Keep ten per project in slots reused in turn, never delete anything with rm, and skip with a clear note when a snapshot is over a size limit (200 MB by default). Run git with GIT_OPTIONAL_LOCKS=0.

After a snapshot, one dim line above the prompt for a few seconds: what was saved and /mulligan restore <n>. Give me /mulligan to list the snapshots in a pane, restore <n> that waits on a Yes button and writes the saved files back over what is there (git restore --overlay, tar -xf) without deleting anything newer, diff <n> to show deleted and changed files, and drop <n> only when I type it. After a restore, append one note for Claude: the files changed under it, re-read before editing. Answer every command in the pane or a toast, never as text Claude reads.

Settings: a pattern of commands to always save before (the whole project), a pattern to never save before, and the size limit. Terminal and desktop app. Never claim it covers a database, a remote or anything outside the folder.

Tests: a battery of destructive and look-alike commands; each kind's snapshot; a held command leaving none; the size limit; the ten slots; restore only after the press, with the note; diff; every path written under ~/.claude/mulligan; git never taking the index lock.
