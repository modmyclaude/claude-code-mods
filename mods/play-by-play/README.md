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
  up to 10 turns that changed files are kept.
- The pane shows, top to bottom:
  - a scoreboard: files touched, lines added and removed, edit count, and the file with the biggest change;
  - a jump list of the files, numbered 1-9 in the order they were first changed;
  - **Prev**, **Next** and **Close**, and "Step 2 of 5";
  - the step: file name, what happened (edit, write, create, delete, rename, cell), `+/−` counts,
    **via shell** when a command made it, and the diff with removed lines red and added lines green.
- Keys while the pane has the keyboard (it takes it when `/replay` opens it):

  | Key | Does |
  | --- | --- |
  | `n` / down arrow | next step |
  | `p` / up arrow | previous step |
  | `1`-`9` | first change of that file |
  | `q`, Esc | close |
  | left / right arrow | previous / next, after a click on the pane's "Keys" line |

  The mouse wheel and Page Up / Page Down still scroll a long diff.

## Settings

None.

## What it can touch

- **Reads**: the records the Edit, Write and NotebookEdit tools return (the text before and after).
  It never opens a file itself.
- **Runs**: around each Bash call, read-only git commands in the session's folder: `git rev-parse`,
  `git diff`, `git ls-files --others`, `git hash-object` (without `-w`), `git show <HEAD>:<path>`.
  Each has a 5 second limit. Nothing is staged, stashed, committed or written.
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
- If one command's git snapshots take over 2 seconds (a very large repository), shell tracking turns off
  for the rest of the session and the transcript says so once. File tools are still tracked.
- Up to 25 changed files are compared per command; the rest are counted in one "more files" step.
  A step draws at most 400 diff lines; a turn keeps at most 300,000 characters of diff and 500 steps.
  Counts always cover the whole change.
- Up and down step through changes only when the terminal sends them as scroll keys to the focused pane,
  and left and right need a click on the "Keys" line first. VS Code and the mobile app have no key line:
  use the buttons there. The band shows on the terminal and the desktop app only.
- `r` in the prompt box types an `r`; it presses Replay only once the band has the keyboard.

## Built from a prompt

This mod was built from [prompts/play-by-play.md](../../prompts/play-by-play.md).
