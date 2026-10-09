# Footprints

A live file tree beside the chat that shows where Claude has been.

## Install

```
/plugin install footprints --marketplace modmyclaude/claude-code-mods
```

## Use it

- `/footprints` opens a pane with the project's file tree: docked beside the transcript in fullscreen, above the prompt otherwise. Because you asked, it opens at any terminal width, and it works while Claude is mid-turn. It adds nothing to the transcript (the model never reads it); the pane, or a toast, is the answer.
- As Claude works, names change color:
  - **blue** - read (Read, an @-mention; a folder Glob or Grep searched)
  - **amber** - edited; it shimmers while the edit is still running (only while the pane is on screen)
  - **green** - edited, then committed with `git commit`
  - **new** - created this session
  - ~~struck through~~ - deleted (a file created this session and then deleted leaves no trace)
  - **(shell)** - changed by a Bash command rather than an edit tool
- The header counts it up: `read 12 · edited 4 · new 1`, plus `deleted` and `committed` once there are any. New, deleted and committed files are counted in edited too.
- **Touched only**: press `t` while the pane has the keys (click it, or ctrl+x tab), or type `/footprints touched`. Every folder Claude did not touch collapses, and untouched files fold into one `+ N untouched files` line.
- **Status line**: `edited 4` under the prompt, so you see activity with the pane closed.
- Untouched folders with more than 40 files start collapsed, showing their file count. Files Claude touched outside the project are listed under `outside <folder>`.
- `/clear` starts a clean trail.

## Settings

None.

## What it can touch

- **Reads**: file names and modification times only, never contents. Names come from `git ls-files` (or a folder listing outside git). Around a Bash call it also reads the modification time of each file git reports as changed (up to 400, the ones the call moved first). It also reads the project folder's real path, and for a Glob or Grep target, whether it is a folder.
- **Runs** (all read-only, no index lock):
  - `git rev-parse --show-toplevel --show-prefix` to find the repo
  - `git ls-files -z --cached --others --exclude-standard -- . ':(exclude,glob)**/node_modules/**'` when you open the pane, and after a commit or checkout while it is open
  - `git --no-optional-locks status --porcelain=v2 ... -- ':/' ':(top,exclude,glob)**/node_modules/**'` before and after each Bash call, pane open or not (the "after" is skipped when the call was read-only). That is two runs per Bash call: tens of milliseconds in most repos, about 0.3 s together in a 100,000-file one. If one run takes over 2 seconds or times out, shell tracking pauses and the transcript says so once: `Footprints: shell tracking paused, git status is slow in this repo`. Read and edit tracking keep working, and running `/footprints` again turns shell tracking back on.
- **Writes**: nothing on disk; its marks live in the session's state.
- **Network**: none. **Model calls**: none.

## Limits

- In a repo where `git status` is slow (over 2 s), shell tracking pauses for the session.
- `node_modules` is always skipped, even where `.gitignore` does not list it, so files Claude reads or writes there show only when touched by an edit tool or Read.
- Shell changes need git. Outside a git repo the tree still works (a walk that skips `node_modules`, `.git` and a few cache folders, without `.gitignore`), but Bash changes are not marked.
- Shell attribution compares `git status` before and after the call plus file times, so: a branch switch that leaves git clean on both sides is not marked; a file you save in your own editor while a Bash command runs can be counted as changed by the shell; changes made by a background Bash command are not marked. With more than 400 files dirty, a file that was already dirty and is changed again may be missed.
- Green needs a Bash command that runs `git commit` and moves HEAD. Commits you make in your own terminal are not seen.
- Files read through the shell (`cat`, `rg`) do not turn blue; only Read, Glob, Grep and @-mentions count. Native macOS and Linux builds of Claude Code have no Glob or Grep tools, so folder marks mostly come from builds that do.
- `t` works only while the pane holds the keyboard; from the prompt, use `/footprints touched`.
- Subagents' tool calls count too.
- Big repos: it keeps up to 20,000 file names and draws up to 400 rows (the rest is one "more" line).
- An edit still running when the mod reloads is not recorded.
- A name holding control characters is drawn with color codes dropped and each other control character shown as `�` (git's file lists are read NUL-separated, so its path quoting never applies).
- Tested with POSIX paths (macOS, Linux). Colors follow your theme's `suggestion`, `warning` and `success`.
- The pane opens only when you ask. If a surface cannot place panes, or something refuses the pane, a one-line toast says so.
- Not done yet: the tree is built in one go, not lazily, and a collapsed folder cannot be expanded by hand.

## Built from a prompt

[prompts/footprints.md](../../prompts/footprints.md)
