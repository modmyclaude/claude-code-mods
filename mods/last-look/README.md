# Last Look

Holds destructive commands and shows exactly what they would destroy.

## Install

```
/plugin install last-look --marketplace modmyclaude/claude-code-mods
```

## Use it

There is nothing to run. When a Bash command Claude is about to run would destroy work, Last Look holds it before it runs, measures what it would destroy, and asks you.

- **Where it asks.** A pane when the terminal has room for one (Claude Code places a pane nobody asked for from 144 columns: docked beside the transcript in fullscreen, inline above the prompt otherwise). On narrower terminals, a band directly above the prompt. The desktop app works the same way.
- **What it shows.** The command, and for each destructive part of it: every file it would delete with the total size (cut to the room there is, then "and N more"), files with unsaved work highlighted first ("3 files have unsaved work you would lose"), and the commits or branch that would be lost. If it cannot measure something it still holds it and says "could not measure: review it yourself".
- **Deciding.** Cancel has the focus, so Enter cancels. `c` cancels and `p` proceeds while the pane or band holds the keyboard. In the pane, Esc closes it and cancels. In the band, press ctrl+x tab first (or click a button). There are no digit hotkeys, so typing an answer to a numbered question never presses Proceed.
- **After.** Cancel tells Claude the command did not run and not to work around it. Proceed lets the command go on to Claude Code's usual permission check and run. A dim line in the transcript records each decision, and the status line says when a command is waiting.

Compound commands are understood: `cd web && rm -rf build` is measured inside `web`, and so are subshells, `bash -c '...'`, `$(...)`, `sudo`, `env`, quoted paths, `~`, `$HOME` and globs.

### What it holds

| Command | Measured with |
| --- | --- |
| `rm -r`, `rm -rf`, `rm -fr`, `rm --recursive` (any flag order) | the files and total size, git status of each |
| `find ... -delete`, `find ... -exec rm` | the same `find` re-run as a listing (`-delete` becomes `-print0`) |
| `... \| xargs rm` | held as "could not measure" (its targets come from the previous command) |
| `git clean -f`, `-fd`, `-fdx` | `git clean -n`, the same clean as a dry run |
| `git reset --hard [ref]` | uncommitted changes discarded, commits dropped from the branch |
| `git checkout -- <paths>`, `git checkout .`, `git checkout <file>`, `git checkout -f`, `git restore <paths>`, `git switch --discard-changes` | uncommitted changes in those paths |
| `git push --force`, `-f`, `+refspec`, `--mirror` (not `--force-with-lease`) | commits on the remote branch that yours lacks, as of your last fetch |
| `git branch -D`, `git branch --delete --force` | commits that exist only on that branch |
| `> file`, `2> file`, `&> file`, `>\| file` onto an existing file (not `>>`, not `/dev/null`) | the file's size and git status |

A held kind that would destroy nothing passes untouched: `rm -rf build` when there is no `build`, `> new.txt` for a new file, `git reset --hard` on a clean tree, `git checkout main` (a branch switch). A force push and `git branch -D` on an existing branch are always held.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `alwaysAllow` | `dist,build,.next,coverage,node_modules/.cache` | Folders that are fine to delete or overwrite without asking. A relative entry matches that run of folder names anywhere beneath the project root (`dist` matches `packages/web/dist`, not `distro`, and never the root itself); an absolute entry matches by prefix. A command passes only when **every** path it touches is inside an allowed folder, by its spelling and by where its links lead. Git history commands are never allowed this way. Leave it empty to hold everything. |

## What it can touch

- **Reads:** file metadata only (stat, and directory listings to expand globs) for the paths a destructive command names. Never file contents.
- **Runs** (by argv, no shell, read-only): `find` (never with `-delete` or `-exec`), `du -sk`, and `git rev-parse`, `status`, `ls-files`, `diff --numstat`, `rev-list`, `log` and `clean -n` (a dry run). Git runs with `GIT_OPTIONAL_LOCKS=0` and fsmonitor off, so even `git status` writes nothing. While a command is held it keeps one `sleep 1` running at a time (PowerShell `Start-Sleep` on Windows): Claude Code pauses a hook's time limit only while a host call is in flight.
- **Environment:** reads `HOME`.
- **Network:** none. Git never fetches, so force-push numbers are as of your last fetch.
- **Model calls:** none.
- **Writes:** nothing outside its own session state.

## Limits

- A safety net, not a permission system. It reads the command's text, so it does not see: commands inside scripts (`./clean.sh`, `npm run clean`, `make clean`), shell and git aliases, flags hidden in variables (`rm $FLAGS dir`), or other ways to destroy files (`mv` or `cp` over a file, `sed -i`, `tee`, `truncate`, `dd`, `git stash drop`, `git push --delete`, database commands). `rm` without `-r` (a single file) is left alone on purpose.
- Only the Bash tool is held. The Edit and Write tools are not.
- Proceed does not skip Claude Code's own permission prompt: in the default mode you may be asked again.
- Force-push measurements use your remote-tracking branches, which may be out of date.
- Sizes are disk usage from `du`. Up to 8 destructive parts of one command are measured; any past that are held as unmeasured. Each `find` or `du` gets 8 seconds.
- Your home folder, `/` and top-level system folders are never walked: they are held with a plain warning instead.
- With nobody to ask (a `claude -p` run) a destructive command is denied. In a session drawn only on mobile or VS Code where the pane cannot be placed, it is denied too, and the reason says so.
- The band gives way while a Claude Code survey holds it; the pane does not.
- macOS and Linux. On Windows, `find` and `du` are usually missing, so commands are held as "could not measure".
- A held command waits as long as you do. Interrupting the turn (Esc at the prompt) stops it.

## Built from a prompt

This mod was built from [prompts/last-look.md](../../prompts/last-look.md).
