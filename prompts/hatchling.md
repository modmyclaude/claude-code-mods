---
mod: hatchling
title: Hatchling
tagline: A collectible pixel pet that hatches, reacts and evolves while you code.
category: fun
surfaces: [terminal, desktop]
model_calls: none
---

# Hatchling

A collectible pixel pet that hatches, reacts and evolves while you code.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "hatchling": a collectible pixel pet that lives above my prompt and grows as I work.

What it does
- On first run an egg appears in a small band above my prompt. It wobbles as Claude works and hatches after 25 tool calls.
- It hatches into one of 8 original species (design them yourself: no existing game characters, no mascots of real companies), each with a rarity (common, uncommon, rare, legendary) and a 1 in 64 chance of a shiny colour variant.
- It reacts to what Claude does: bounces on successful tool calls, sweats when a tool call fails, cheers when a test run passes (Bash output that looks like a passing test run), and falls asleep after 5 minutes idle.
- It gains XP from tool calls and finished turns and evolves twice (baby, teen, adult) with a short celebration and a toast.
- The pet persists across sessions and projects.

Commands
- /pet shows a stat card: name, species, rarity, shiny or not, stage, XP to next stage, days together.
- /pet name <name> renames it. /pet hide and /pet show toggle the band.
- /pet card prints a small text card I can copy and share.

How it works
- Draw the pet with text cells (block characters) so it works in the terminal and the desktop app. 2 to 3 animation frames per mood, animated with a timer only while something is happening.
- All randomness (species, rarity, shiny) is decided once at hatch time and saved, so restarting never rerolls.
- Deterministic, no model calls, no files outside the mod's own store.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
