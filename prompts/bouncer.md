---
mod: bouncer
title: Bouncer
tagline: Checks each mod at the door and lists what it can reach, from Claude Code's own validator.
category: safety
surfaces: [terminal, desktop]
model_calls: none
---

# Bouncer

Checks every installed mod at the door, what each can reach, from Claude Code's own validator.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "bouncer": it checks every installed mod at the door.

When a session starts, run Claude Code's own plugin validator on each loaded mod and read what it reports: whether the mod can touch files, run programs, reach the network or call the model, whether it can type for me, and which tool calls or prompts it hooks with a hook that can refuse or rewrite them. Find the plugin folders from the plugin registry files under my Claude Code folder and from the mods the engine names as they join; never read a mod's source yourself.

Show one line above the prompt only when a mod is new to me or its report changed, naming the mod and the notable reach, with a Show button; draw it under other mods' lines and never over a safety hold. Remember what I have seen in your store as mod name and a short hash of the reach, so the line fires on first sight and on change only.

Give me a /bouncer pane with one row per mod: name, version, new or changed, loaded when the engine named it, and the reach in plain words with the warning colour on runs programs, reaches the network, can type for you and can change tool calls; a details press unfolds the validator's own lines for that mod. /bouncer check runs it again; /bouncer ok clears the line. Say plainly that these are facts from the validator, not a verdict, and that nothing leaves the machine. Never block, unload or change a mod, never claim a mod is safe. The command answers nothing the model reads.

Terminal and desktop app. Say in the README exactly which files are read and which command is run.
```
