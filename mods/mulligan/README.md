# Mulligan

A do-over for shell commands: it saves your project's files before a destructive command, and `/mulligan` puts them back.

```
mulligan: saved a do-over before "rm -rf dist" (dist) · /mulligan restore 3

3 do-overs for this project
#3  rm -rf dist                                   [Restore] [Diff]
    dist · 4.2 MB · just now
#2  git reset --hard                              [Restore] [Diff]
    tracked changes · 2h ago
```

## Install

```
/plugin install mulligan --marketplace modmyclaude/claude-code-mods
```

## Use it

Nothing to set up. Claude Code's `/rewind` puts back the files Claude edited with its own tools; it does not undo what a shell command did. Mulligan covers that:

- **Before a destructive Bash command runs**, it saves what that command can destroy:
  - `rm -r`, `find ... -delete`, `xargs rm` and a redirect over a file (`> notes.md`): the paths they name.
  - `git reset --hard`, `git checkout` or `git restore` over changes: your tracked files as they are, as a git commit object (`git stash create`, which moves no branch and leaves the stash list alone).
  - `git clean`: the untracked files git lists (not the ignored ones).
  - A target only known as it runs (`rm -rf "$OUT"`, `rm -rf **`): the whole project, without `.git` and `node_modules`.
- **Once the command ran**, a dim line says a do-over exists for a few seconds. A command that another mod held or refused leaves no snapshot.
- **`/mulligan`** lists this project's snapshots, newest first, with what each holds and when.
- **Restore** asks first: **Yes, restore** writes the saved files back over what is there now, and deletes nothing newer. Claude is then told the files changed under it and to re-read any file before editing it.
- **Diff** shows what differs now from a snapshot: files deleted since, and files changed.

The same commands last-look holds take a snapshot, and nothing else: a listing, a test run, a single-file `rm`, a push or a branch delete never does.

| Command | What it does |
| --- | --- |
| `/mulligan` | The list, in a pane |
| `/mulligan restore <n>` | Snapshot `n`, waiting on your confirm press |
| `/mulligan diff <n>` | What differs now from snapshot `n` |
| `/mulligan drop <n>` | Forget snapshot `n` and empty its archive (only when you type it) |

## Settings

- **Always save before commands matching:** a pattern (a regular expression, case-insensitive; `|` between several) for commands that should save the whole project first, such as `prisma migrate|npm uninstall`.
- **Never save before commands matching:** a pattern for commands that never take a snapshot, such as `rm -rf (dist|build)`.
- **Largest snapshot (MB):** default 200. A bigger one is skipped, and the line says the command ran without a do-over.

## What it can touch

- **Writes:** archives and a small index under `~/.claude/mulligan/<project key>/` (or under `CLAUDE_CONFIG_DIR` when set): ten slots per project, reused in turn, never more. The key is a hash of the project's path. Each archive holds copies of your project's files, so anything in them (a `.env` among them) sits there too, in your home folder only.
- **Runs:** `git rev-parse`, `git stash create`, `git ls-files`, `git diff` and, on a restore you confirmed, `git restore --overlay`, all with git's optional locks off, so it never takes the index lock under Claude. `tar` to make, list and unpack archives, and `mkdir` and `mv` inside its own folder. It never runs `rm`, never moves a branch, never touches `.git` beyond the objects `git stash create` adds.
- **Reads:** each Bash command's text (to see whether it destroys files), the shell's current folder, your project's files when it saves them.
- **Tells Claude:** after a restore, one note that the files changed and to re-read before editing. Nothing else: `/mulligan` answers in a pane and toasts.
- **Network, model calls:** none.

## Limits

- **Files in this project only.** A database, a remote, a package registry or anything outside the project folder is not covered, and it says so when a command reaches outside.
- Ignored files are not saved by `git clean -x`; the line says so.
- A restore puts back what the snapshot holds. A file the command created is not removed, and edits made since to a restored file are written over (Diff shows them first).
- Restoring tracked changes needs git 2.23 or newer (`git restore`).
- Saving reads the files it copies before the command runs; a large tree can add up to 20 seconds to that command, and a tree over the size limit is skipped.
- Snapshots of tracked changes are git objects no branch points to. git keeps them for two weeks by default before a cleanup may remove them.
- The pane, the line and the restore are checked through the engine's test kit on the terminal and desktop surfaces, with git and tar stood in for; a real restore on a scratch project is part of the overnight check.

## Built from a prompt

This mod was built from [the Mulligan prompt](../../prompts/mulligan.md).

More mods: [the full catalogue](../../README.md#the-mods).
