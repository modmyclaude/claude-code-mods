---
mod: headway
title: Headway
tagline: See how far along Claude is, and when it will land. Zero tokens in the terminal.
category: visibility
surfaces: [terminal, desktop]
model_calls: none
---

# Headway

See how far along Claude is, and when it will land. Zero tokens in the terminal.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "headway": a progress bar for the plan Claude is working through, with an honest estimate of when it will finish.

Where the plan comes from
- Read the plan Claude already keeps: watch its own todo and task tool calls (TodoWrite, TaskCreate, TaskUpdate, TaskList) and the plan it gets approved in plan mode (ExitPlanMode), at zero extra tokens. Only where Claude has none of those tools (the desktop app), lend it one small plan tool in TodoWrite's shape, and nothing else.
- Never refuse a tool call, never block the end of a turn, never add anything to the system prompt. If no plan exists, show nothing.
- Plan mode plans with headings become stages; flat todo lists are one stage.

What it shows
- One line above my prompt while a plan is active: the stage, the current step's title, steps done out of total, a bar, and time left, e.g. "Build · Wire the routes (2/6) ▰▰▱▱▱▱ ~3m left".
- Time left appears only after 2 steps have finished. Estimate it from the median time per step this session, blended with this project's history from earlier sessions. Hide the estimate (show "estimating...") when step times vary too much to be honest.
- A step running past 3x its estimate turns amber and says how long it has run.
- When the plan finishes: the bar turns green for a few seconds, then a toast with a receipt: total time, time per stage, and how close the first estimate was ("done in 4m 12s, 18s ahead of estimate"). Then the line disappears.

Plans that change
- When Claude rewrites its plan mid-run, keep finished steps finished even if their wording changed slightly (fuzzy match on titles), and flash "plan revised +2 −1" instead of letting the bar jump backwards without a reason.

Commands
- /headway shows the full plan with each step's status and time taken.
- /headway hide and /headway show toggle the line.

Plays well with others
- If subagents are running, show only a small "3 agents" chip; do not draw agent details.
- Play no sounds. Publish a "plan done" moment other mods can react to, if the API offers a way, and say in the README how.

Guardrails
- Display only: no files, no processes, no network, no model calls. Keep per-project pace history in the mod's own store (step counts and durations only, never step titles).
- One timer, running only while a plan is active and visible. Stop it when idle.
- Stay one line and pass through to other mods that draw above the prompt.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
