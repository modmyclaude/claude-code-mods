---
mod: swear-jar
title: Swear jar
tagline: A jar that counts the model's verbal tics, "You're absolutely right" and friends, in a line above the prompt and a scoreboard.
category: fun
surfaces: [terminal, desktop]
model_calls: none
draft: true
---

# Swear jar

A jar that counts the model's verbal tics, "You're absolutely right" and friends, in a line above the prompt and a scoreboard.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "swear-jar": a counter for the model's verbal tics.

Count every reply Claude writes against a list of phrases I can edit in the settings, starting with "You're absolutely right", "Great question", "I apologize", "Certainly!", "As an AI", "It's worth noting", "I hope this helps", "delve", and every em dash. Count the text of each response as Claude Code receives it from the model, once per response, whole phrases, any case; skip subagents. Never rewrite Claude's words, never hold a tool call, never read files.

Show the top three counts for this session in one dim line above the prompt, drawn under whatever other mods draw there, nothing when every count is zero, and nothing at all while another mod's safety hold is waiting for me. Offer the status line as an alternative in the settings.

Give me a /swear-jar pane with the scoreboard for this session and all time, the worst offender, and the last reply's hits shown in their sentences with the tic in bold. /swear-jar reset empties this session; /swear-jar reset all empties the jar for good. The command answers with no output, so nothing of the scoreboard reaches the model.

Add an opt-in nudge, off by default and remembered, that adds one short line to the system prompt asking for plain words and no praise openers; say in the README what it costs in tokens.

Works on the terminal and the desktop app. Tests on both surfaces: counting, the band under other mods and never over a hold, the status line, the pane, the commands, the nudge on and off.
```
