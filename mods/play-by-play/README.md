# Play-by-Play

Replays every change Claude made in a turn, shell edits included.

## Install

```
/plugin install play-by-play --marketplace modmyclaude/claude-code-mods
```

## Use it

- After a turn that changed files, a hint shows above the prompt:
  `4 edits · 3 files · +38 −12 · press r or /replay`, with a **Replay** and a **Hide** button.
  `r` and `x` press them once the band has the keyboard (click it, or ctrl+x tab).
- `/replay` opens a pane on the latest turn. `/replay <n>` opens an earlier one: 1 is the latest,
  up to 10 turns that changed files are kept. It runs at once, even while Claude is working, and shows
  only finished turns: a turn still running is never shown half done (the pane says one is in progress),
  and an open pane stays on its turn when the running one ends. The command answers the model nothing;
  its messages are toasts. A headless run, with no pane, gets the steps as text.
- The pane shows, top to bottom:
  - a scoreboard: files touched, lines added and removed, edit count, and the file with the biggest change;
  - a jump list of the files, numbered 1-9 in the order they were first changed;
  - **Prev**, **Next** and **Close**, and "Step 2 of 5";
  - the step: file name, what happened (edit, write, create, delete, rename, cell), `+/−` counts,
    **via shell** when a command made it, and the diff with removed lines red and added lines green.
    A binary file shows as "binary file changed (N bytes)", never as a diff.
- Keys while the pane has the keyboard (it takes it when `/replay` opens it):

  | Key | Does |
  | --- | --- |
  | `n` | next step |
  | `p` | previous step |
  | `1`-`9` | first change of that file |
  | `q`, Esc | close |
  | arrow keys | after a click on the pane's "Keys" line: left/up previous, right/down next |
  | up / down | without that click, only on a step taller than the pane |

  The mouse wheel and Page Up / Page Down still scroll a long diff.

## Settings

None.

## What it can touch

- **Reads**: the records the Edit, Write and NotebookEdit tools return (the text before and after).
  It never opens a file itself.
- **Runs**: around every Bash command, read-only or not, read-only git plumbing in the session's folder,
  each with `--no-optional-locks`: `git rev-parse`, `git diff-index -p`, `git ls-files --others`,
  `git hash-object` (without `-w`), and for changed files `git show <HEAD>:<path>`,
  `git cat-file --batch-check` and `git diff --no-index` (an untracked file). Porcelain `git diff` is not used,
  because it rewrites `.git/index`. Nothing is staged, stashed, committed or written, and `.git/index` is
  never touched.
- **Cost**: 3 or 4 git calls before each command and 2 or 3 after it (none after one Claude Code marks
  read-only, such as `ls`), plus one or two per changed file. Each diffs the whole uncommitted tree against
  HEAD, and `hash-object` reads every untracked, unignored file. In a 100,000-file repository that is about
  half a second per command; see the pause below.
- **Writes**: nothing. It never reverts or edits a file. What it records lives in the session's memory
  and is gone when the session ends.
- **Network**: none. **Model calls**: none.

## Limits

- Shell changes need a git repository at the session's folder. Elsewhere commands run unwatched.
- Files git ignores (`node_modules`, build output) are not tracked, by design.
- An untracked file a command changes or deletes shows as a step without lines, since git kept no
  earlier copy, unless a file tool wrote that file earlier in the session.
- A file you save in your editor while a command runs shows as a change "via shell".
- A command run in the background is compared when it starts running in the background, not when it ends.
- Shell tracking pauses for the rest of the session, saying so once in the transcript, when a git snapshot
  takes over 2 seconds, when git does not answer within 3 seconds, or when the uncommitted changes are over
  4 MiB. File tools are still tracked.
- Up to 25 changed files are compared per command; the rest are counted in one "more files" step.
  A step draws at most 400 diff lines; a turn keeps at most 300,000 characters of diff and 500 steps.
  Counts always cover the whole change.
- Arrow keys need a click on the "Keys" line first; without it, up and down step only on a step taller than
  the pane (the engine sends them as scroll keys only then). VS Code and the mobile app have no key line:
  use the buttons there. The band shows on the terminal and the desktop app only.
- File names with control characters are drawn with them replaced (ANSI sequences dropped, others shown as
  U+FFFD).
- A binary file's size is shown when git keeps the earlier copy (a delete or move); a new or changed binary
  in the working tree shows without it.
- `r` in the prompt box types an `r`; it presses Replay only once the band has the keyboard.

## Built from a prompt

This mod was built from [prompts/play-by-play.md](../../prompts/play-by-play.md).
