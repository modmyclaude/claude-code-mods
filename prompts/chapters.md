---
mod: chapters
title: Chapters
tagline: A diff, told in ordered chapters with risk marks, and a pane that walks you through them.
category: review
surfaces: [terminal, desktop]
model_calls: one per review you ask for (two for a big diff)
draft: true
---

# Chapters

A readable review of a diff: the model writes ordered chapters with risk marks, and a pane walks you through them beside the hunks.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "chapters": a readable review of a diff.

/chapters takes my uncommitted changes against the last commit (new untracked files included), /chapters staged the staged ones, /chapters branch [base] this branch against main, and /chapters last the edits Claude made in the last turn. Read the diff with read-only git plumbing only (diff-index, diff-tree, merge-base, ls-files) with GIT_OPTIONAL_LOCKS=0; outside git, use the last turn's Edit and Write inputs.

Ask one model call (haiku by default, a setting can name another) for an ordered list of short chapters as JSON followed by an END line: each with a title, the files and lines it covers, what changed, why it matters, a risk level (none, low, high) with a reason, and one question I should check. Send only the diff and its paths, with anything that looks like a secret redacted and secrets files (env files, keys, credentials, registry logins, Terraform values) named but never read, sent or drawn, capped at about 12,000 tokens a call; split a bigger diff in two calls at most, then cut it and say how many files were left out. Retry once on a reply that does not parse, then say "no review this time".

Open a pane that walks me through them: the chapter list with risk marks (never colour alone) and read ticks, the open chapter's text, its hunks drawn with the Code element in diff format, prev, next, mark read, and "ask Claude", which fills my prompt box with the chapter's question after anything I typed and never sends it. A progress count in the header. While a review waits unread and the pane is closed, one dim line above the prompt with the chapter count and how many are risky.

It never applies, reverts or edits anything. A new review runs only when I type the command. Say in the README what a review costs at list prices, always as "about". Terminal and desktop app.
```
