# Chapters

A readable review of a diff: `/chapters` asks the model for ordered chapters with risk marks, and a pane walks you through them beside the hunks.

```
uncommitted changes · 1 of 3 read
! 1. Retry on 429                      read
~ 2. Config loader
· 3. Docs

Chapter 2 of 3: Config loader
What: settings now load from .apprc before the environment.
Why it matters: a stale .apprc overrides a fresh variable.
~ low risk: the order changed for every setting
Check: should the environment still win?

src/config.ts
@@ -12,4 +12,6 @@
[prev] [next] [mark read] [ask Claude]
```

## Install

```
/plugin install chapters --marketplace modmyclaude/claude-code-mods
```

## Use it

Type `/chapters` when you want to read what changed before you commit or push. One model call (two for a big diff) turns the diff into short chapters, most important first. Each has:

- what changed, and why it matters,
- a risk mark (`!` high, `~` low, `·` none seen) with one reason,
- one question worth checking,
- and the matching hunks, drawn as a diff beside it.

**prev** and **next** move between chapters, **mark read** ticks one and moves on, and the header counts how many you have read. **ask Claude** puts the chapter's question in your prompt box ("About chapter 2, Config loader: should the environment still win?") after anything you have typed; you decide whether to send it. While a review waits unread and its pane is closed, one dim line above the prompt says so.

| Command | What it reviews |
| --- | --- |
| `/chapters` | Your uncommitted changes against the last commit, new files included (outside git: the last turn's edits) |
| `/chapters staged` | What is staged for the next commit |
| `/chapters branch [base]` | This branch against `main` (or the base you name, or the one in settings) |
| `/chapters last` | The edits Claude made in the last turn, from its own tools |

With a review on screen, `/chapters` alone opens it again. A new review runs only when you type the command yourself.

## Settings

- **Model:** `haiku` by default. Any alias or id Claude Code takes (`sonnet`, say) writes a deeper review at that model's price.
- **Branch to compare against:** `main` by default, for `/chapters branch`.

## What it can touch

- **Runs:** read-only git plumbing in your project: `git rev-parse`, `git diff-index`, `git diff-tree`, `git merge-base`, `git ls-files`, all with git's optional locks off, so it never touches the index under Claude. Never `git diff`, never anything that writes.
- **Reads:** the new files git does not track yet (each up to 60,000 characters, the first 30), to show them as additions. The inputs of Claude's Edit, Write and NotebookEdit calls, for `/chapters last` and projects outside git.
- **Model calls:** one per review, two for a diff past about 12,000 tokens (the rest is left out, and the pane says how many files). It is sent the diff and its file paths, nothing else: not the transcript, not your prompts. A reply that does not read is asked once more. About $0.0013 per review of 500 changed lines at small-model list prices.
- **Writes:** its own session state (the review, which chapters are read). The prompt box, only when you press **ask Claude**, and never sent.
- **Network, files written:** none beyond the model call. It never applies, reverts or edits a change.

## Limits

- It reads and explains only. Accepting or reverting a hunk from the pane is not in this version.
- The model's chapters can be wrong or miss something; the hunks beside them are the truth.
- A diff past the cap is split in two calls, then cut; the pane names how many files were not reviewed.
- Outside git, an edit's place in its file is not known, so its hunk starts at line 1.
- The review lives as long as the session (or until the mod reloads).
- The pane and the band are checked through the engine's test kit on the terminal and desktop surfaces, with git and the model stood in for.

## Built from a prompt

This mod was built from [the Chapters prompt](../../prompts/chapters.md).

More mods: [the full catalogue](../../README.md#the-mods).
