---
mod: crossroads
title: Crossroads
tagline: Three ways forward after every turn, risky ones marked. About $0.0002 a turn.
category: workflow
surfaces: [terminal, desktop]
model_calls: one small-model call per finished turn, skipped on trivial turns and backed off when ignored
---

# Crossroads

Three ways forward after every turn, risky ones marked. About $0.0002 a turn.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "crossroads": after Claude finishes a turn, offer me 3 specific next prompts I can take with one key, and clearly mark any that would do something risky.

What it shows
- When a turn ends with an answer, a small band above my prompt: "1 run the auth tests · add the same guard to signup.ts · push to main (pushes)". A dim loading row while they are being made.
- Every item is a clickable button that puts it in my prompt as an editable draft (never sent automatically). Only clearly safe suggestions get a number key (press it in an empty prompt) or the top slot. Press 0 to dismiss.
- On the desktop app, if the prompt cannot be filled, clicking copies the suggestion instead, with a clearly labelled Send button that is never the default.

Cooperate with Claude Code's own suggestion
- Claude Code may already predict my next prompt (the dim ghost text I accept with Tab). If it does, include its guess at no extra cost, and only generate the other two. When its guess is clearly safe it is option 1 and stays as the ghost text, so I never see two different "next" ideas; otherwise hide the ghost text and list the guess as a plain row.
- If the built-in suggestion is off or does not fire (it does not on desktop), generate all three yourself.

Make them specific and cheap
- Build a compact digest of the turn instead of sending the transcript: my goal, my last prompt, the files Claude touched, the commands it ran with pass or fail, Claude's closing question if any, and this session's slash commands. Replace anything that looks like a secret (API keys, tokens, passwords, private keys) with a placeholder before it leaves the machine.
- Send the digest to the cheapest available model at low effort, asking for strict JSON. If the answer is malformed or cut off, show nothing.
- Skip trivial turns (very short replies, turns with no tool use and no question). Back off after 3 ignored lists in a row, and recover when I accept one.

Only clearly safe suggestions are privileged
- A keyword list cannot cover every risky phrasing, so privilege is an allowlist. Only a suggestion that reads, inspects, tests, explains or reviews (run the tests, show, explain, read, check, list, diff, review, add a test) and names no risky target (prod, production, live, main, a release; deploy, publish, push, merge; delete, drop, remove, wipe; a migration on shared data; money; credentials; infrastructure such as terraform, kubectl or AWS; email, Slack or sending to people) may be option 1, get a number key, or stay as the ghost text.
- Everything else is a plain row: clickable, no number key, never option 1. If no suggestion is safe, no item gets a number key. Test the safe set with a large table of risky and safe phrasings.

Mark risky suggestions
- Have the model tag each suggestion it writes as risky or not, with a short reason ("pushes", "deploys", "deletes data"), and back the tag up with keyword rules: risky if either says so. Show the reason in amber, like "(deploys)". Mark lookalike letters from another alphabet mixed into a Latin word as "(unusual letters)", but treat wholly Russian or Greek text as normal text.
- Say plainly that this flags common risky actions and is not exhaustive.

Do not get in the way
- If Claude's reply ends with numbered options for me to choose from, do not use digit hotkeys that turn; typing a number must answer Claude.
- Clear the suggestions as soon as I submit anything.
- Wait until any background subagents finish before suggesting.

Learns a little
- Per project, count which kinds of suggestion I take, edit or ignore (counts only, never my prompts) and tell the model my top 3 kinds next time. /crossroads forget wipes it. /crossroads off and /crossroads on toggle the mod. /crossroads shows today's calls and estimated cost.

Guardrails
- The only data sent anywhere is the digest above, to the model, once per eligible turn. No files read beyond what is needed for the digest's file names, no processes, no network.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
