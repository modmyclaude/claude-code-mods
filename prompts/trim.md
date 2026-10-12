---
mod: trim
title: Trim
tagline: Long shell output, folded before Claude reads it. Errors, the start and the end stay; you see about how many tokens that saved.
category: cost
surfaces: [terminal, desktop]
model_calls: none
draft: true
---

# Trim

Long shell output, folded before Claude reads it. Errors, the start and the end stay; you see about how many tokens that saved.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "trim": it makes long shell output cheaper for Claude to read.

When a Bash command prints more than about 120 lines or 6,000 characters, fold what Claude reads: keep the first 15 lines, the last 40, every line that looks like an error or a warning, and every line my own pattern names. Each gap becomes one "[... N lines folded ...]" line. Keep an error repeated word for word once, with how many times it came, but never merge two errors at different places. A run of lines that differ only in a percentage or a counter (a progress bar) folds to its first line with a count. Cut a kept line past 2,000 characters in its middle.

Append one footer line that says how many lines were folded, about how many tokens that saved, and that Claude can run the command again through grep, sed -n or tail to read a folded part. Skip folding when it would save less than a quarter of the output.

Never touch: short output, stderr, a command that failed (its output goes to Claude whole), images, background jobs, output Claude Code already saved to a file, or any tool but Bash.

Do it in a tool.call hook: await the tool, then answer with a fresh { result } whose stdout is the folded text, so Claude reads that. Under each folded call's row, draw one dim line with the savings and an expand button that draws the full output in the row without changing what Claude read. Keep a status line with the session total ("trim ~34k saved").

/trim opens a pane listing every folded call this session with its lines and savings and a total; /trim show <n> opens the full output of call n in a pane of its own; /trim off pauses it for the session and /trim on resumes it, only when I type them. Answer every command in a pane or a toast, never as text Claude reads. Keep full outputs in memory only, the last 20 calls and two million characters at most.

Settings: the line and character limits, and a pattern of lines to always keep. Terminal and desktop app. Every token figure is an estimate (characters divided by four) and says "about" or "~".

Tests: a 2,000-line output folded with its head, tail, error lines and footer; short output, stderr, a failed command and other tools untouched; the keep pattern; repeats and progress bars; the row's expand on both surfaces; the panes; the memory caps.
```
