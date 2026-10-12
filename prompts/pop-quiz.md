---
mod: pop-quiz
title: Pop Quiz
tagline: A learning mode, off by default - after a turn that changed code, two short questions about the change, each answer one press away.
category: insight
surfaces: [terminal, desktop]
model_calls: one small-model call per quiz (opt-in)
draft: true
---

# Pop Quiz

A learning mode, off by default: after a turn that changed code, two short questions about the change, each answer one press away.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "pop-quiz": a learning mode that is off by default.

When it is on and a turn changed files with Claude's own tools (Edit, MultiEdit, Write, NotebookEdit, counted once each call ran), at the end of every third such turn make one small-model call (haiku, low effort, capped tokens and time) for two short questions that a reader could answer from the change alone, each with a one-line answer, as JSON followed by an END line. Send only the changed files' names and a short diff (at most 2,000 characters, each file with its share), with secrets redacted and .env or key files sent by name only. Retry once on a reply that does not parse, then stay silent. Never call when no terminal or desktop app is there to show it.

Draw the two questions above the prompt, under other mods' bands, each with a "show answer" press, plus "skip". Clear the quiz when I send my next prompt; drop a quiz still being written for an older turn. No grading.

Give me /pop-quiz on, off, every <n>, ask (quiz the last change now) and score (asked, shown, skipped, this session and all time, plus what the calls cost at list prices). on, every and ask run only when I type them. Answer every command in a toast, never as text Claude reads. Settings: on from the start, and every n. Say in the README what a quiz costs, always as "about".

Tests: an Edit turn makes one call with the file list and the diff; read-only turns make none; off by default; every 3 quizzes the 3rd, 6th and 9th changed turns; the request's caps and redaction; retry then silence; the band's show answer and skip on both surfaces; the next prompt clears it; the score and the store.
