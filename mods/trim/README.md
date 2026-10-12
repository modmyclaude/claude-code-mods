<img src="../../brand/pixel-icons/svg/trim.svg" width="64" height="64" alt="">

# Trim

Long shell output, folded before Claude reads it. Errors, the start and the end stay; the rest folds, and you see about how many tokens that saved.

```
✓ src/app.test.ts (14 tests)
...
[... 1,840 lines folded ...]
src/api.ts(41,7): error TS2345: Argument of type 'string' is not assignable
...
Tests  2 failed | 312 passed (314)
[trim: 1,892 of 2,000 lines folded, about 11,000 tokens saved. The folded lines were not sent; ...]

trim: 1,892 lines folded · ~11k tokens saved   [expand]
```

## Install

```
/plugin install trim --marketplace modmyclaude/claude-code-mods
```

## Use it

Nothing to set up. When a Bash command prints more than 120 lines or 6,000 characters, Claude reads a folded copy:

- **What stays:** the first 15 lines, the last 40, every line that reads like an error or a warning (error, failed, exception, traceback, warning, panic, fatal, not found, cannot and the like, and the marks test runners print on a failed test: `✕`, `×`, `●`, `✗`, `✘`), and every line your own pattern names. A failed test stays even when the command itself exits cleanly (piped into `tee`, or after `|| true`).
- **What folds:** everything else, as one `[... N lines folded ...]` line per gap. An error line repeated word for word is kept once with how many times it came (`warning: slow test [3 times]`); two errors at different places are always two lines. A run of lines that differ only in a percentage or a counter (a progress bar) folds to its first line with a count.
- **The footer** tells Claude what was folded and about how many tokens it saved. If Claude needs a folded part of a command that only reads (a test run, a build, a listing), it can run it again through `grep`, `sed -n` or `tail`; for one that changes anything (an install, a migration, a deploy) it is told never to repeat it, and to ask you instead, since you can see the whole output. Claude never mistakes the folded copy for the whole output.
- **Never touched:** short output, stderr, a command that failed (its output reaches Claude whole: the errors are what Claude needs), images, background jobs, output Claude Code already saved to a file, and every tool but Bash.
- **Folding that saves little** (under a quarter of the output, or under 1,000 characters) is skipped.

You still see everything:

- **Under each folded call** a dim line says what was saved, with **expand**, which draws the full output in that row. It changes the drawing only: Claude's copy stays folded.
- **The status line** keeps the session's total: `trim ~34k saved`.

| Command | What it does |
| --- | --- |
| `/trim` | A pane with every folded call this session (newest first), its lines and savings, and a total |
| `/trim show <n>` | The full output of call `n` in a pane of its own |
| `/trim off` | Pause it for this session (only when you type it) |
| `/trim on` | Resume it |

Every token figure is an estimate (about four characters per token) and says "about" or `~`.

## Settings

- **Fold past this many lines** (default 120, from 40 to 100,000) and **Fold past this many characters** (default 6,000): output past either is folded.
- **Always keep lines matching:** a pattern (a regular expression, case-insensitive; `|` between several, such as `deploy id|migrated`) whose lines never fold. A pattern that does not compile is ignored.

## What it can touch

- **Reads:** the result of every Bash call (stdout and its record), only to fold it. Nothing else of the conversation.
- **Rewrites:** what Claude reads of a long Bash output, in memory, before Claude reads it. The transcript stores the folded copy, as Claude saw it.
- **Keeps:** the full output of the last 20 folded calls (two million characters at most), in the mod's own memory only, to show you; gone when the session ends or the mod reloads. Session state holds each folded call's command (its first line, 80 characters), line counts and savings, the session's totals, and whether it is paused.
- **Shows:** the line under a folded call, the status line, toasts and the `/trim` panes. The panes and the expand never reach Claude; `/trim` answers with no text for the model.
- **Files, processes, network, model calls:** none.

## Limits

- A failed command is never folded, however long: Claude Code reports it as an error, and its errors are what Claude needs.
- The error words are English and pattern-based. An error worded otherwise can fold; name it in the keep setting.
- Lines past 2,000 characters are cut in their middle (a minified file, a long JSON line); the cut says how many characters went.
- In the middle of an output, at most 150 different error-like lines are kept; past that they fold.
- Claude can still run the command again to read a folded part, which costs a call; the footer suggests a filter so that read stays small.
- After a reload, full outputs are gone: a folded row keeps its savings line, without expand. A call older than the last 20 shows only the folded copy, as Claude read it.
- The row, the panes and the status line are checked through the engine's test kit on the terminal and desktop surfaces. That Claude reads the folded copy was checked live in a headless session.

## Built from a prompt

This mod was built from [the Trim prompt](../../prompts/trim.md).

More mods: [the full catalogue](../../README.md#the-mods).
