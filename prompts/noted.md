---
mod: noted
title: Noted
tagline: Turns your corrections into permanent rules, without duplicates.
category: memory
surfaces: [terminal, desktop]
model_calls: one small-model call per detected correction
---

# Noted

Turns your corrections into permanent rules, without duplicates.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "noted" that turns my corrections into permanent rules.

What it does
- When my prompt reads like a correction ("no, ...", "don't ...", "always ...", "we use X not Y", "stop doing ...", "I told you ..."), turn it into one short, general rule with a small, cheap model, e.g. "Use pnpm, not npm, in this repo."
- Show a band above my prompt with the proposed rule and buttons: Save to project (./CLAUDE.md), Save globally (~/.claude/CLAUDE.md), Edit, Skip.
- Saving appends the rule under a "## House rules" heading, created if missing.

What is new here
- Cheap by design: a keyword pre-filter decides whether a prompt is a correction, and only those reach the model.
- No duplicates: read the existing house rules first. If the same rule exists, say "already a rule". If it conflicts with one, offer "Replace old rule" instead of adding a contradiction.
- /rules lists the house rules learned so far with when each was added, and lets me remove one.

Guardrails
- Only ever writes to those two CLAUDE.md files, and only after I press a button.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
