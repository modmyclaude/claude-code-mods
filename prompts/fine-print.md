---
mod: fine-print
title: Fine Print
tagline: A second reader that flags what you would miss in a wall of text.
category: insight
surfaces: [terminal, desktop]
model_calls: one small-model check per long turn, capped
---

# Fine Print

A second reader that flags what you would miss in a wall of text.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "fine-print": a second reader that flags what I might miss in long replies.

What it does
- After a turn with a long reply (over about 150 words), ask a small, cheap model to read the reply and a summary of that turn's tool calls, and decide whether there is anything I must know: hidden costs, security or privacy risk, data loss, irreversible actions, impact on customers, or assumptions Claude made without asking.
- If there is, show a note above my prompt: a bold one-line headline and up to 4 bullets, with buttons Got it, Explain more (sends a follow-up question into the chat) and Dismiss.
- If there is nothing important, stay silent. Silence is the default.

What is new here
- A watchFor setting to choose the topics: cost, security, data-loss, irreversible, customers, assumptions. Default: all.
- A spend cap: maxChecksPerSession (default 30). When it is reached, stop and say so once in the status line.
- /fineprint lists every note flagged this session, newest first, so nothing is lost after a dismiss.
- Use the cheapest model available and send only the reply plus tool summaries, never whole files.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
