---
mod: rain-check
title: Rain Check
tagline: Hit your usage limit? Your prompt waits and goes out when the limit resets.
category: workflow
surfaces: [terminal, desktop]
model_calls: none
draft: true
---

# Rain Check

Hit your usage limit? Your prompt waits and goes out when the limit resets.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "rain-check" for when I hit my usage limit.

Background: on a subscription, Claude Code has a 5-hour and a weekly usage window. When one runs out, every prompt fails until it resets, and I have to come back at the right moment and send it again.

What it does
- Once Claude Code refuses a turn because a usage limit ran out, show one line above my prompt: "Usage limit reached · resets 2pm · in 5h", with "Continue then" (pick the cut-off turn up at the reset) and "Dismiss".
- While the limit holds, a prompt I send waits instead of failing. The line shows when it goes out ("Sends 2:01pm · in 3h 12m") and its first words, with "Send now" and "Cancel". A second prompt joins the first.
- One minute after the reset, send what waits as a normal prompt, and say so in a toast. If the limit refuses it again, it waits for the next reset.
- /rain-check shows what waits; /rain-check now sends it; /rain-check cancel drops it. Commands answer in toasts, never as text the model reads.

Rules
- Hold only after a real refusal (the turn's error is rate_limit), never on a 100% reading alone: extra usage can still let requests through. A refusal with no window near full is a passing one: hold nothing.
- Never send anything I did not write or ask for. Never hold slash commands, ! shell lines, prompts from other plugins or prompts queued mid-turn.
- If anything in the mod fails, my prompt goes through as normal.
- Times as Claude Code writes them (2pm, 2:01pm, Tue 8am), time left rounded up and never "0m".
- Terminal and desktop app. Other mods' lines above the prompt come first.

Tests: the full flow on both surfaces with a mocked clock, every way out, and what it never holds.
```
