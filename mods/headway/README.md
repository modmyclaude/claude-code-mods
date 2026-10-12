<img src="../../brand/pixel-icons/svg/headway.svg" width="64" height="64" alt="">

# Headway

See how far along Claude is, and when it will land.

```
Build · Wire the routes (2/6) ▰▰▱▱▱▱ ~3m left
```

## Install

```
/plugin install headway --marketplace modmyclaude/claude-code-mods
```

## Use it

Nothing to set up. Headway reads the plan Claude already keeps and draws one line above your prompt while that plan is in progress:

- **Where the plan comes from:** Claude's own todo list (TodoWrite), its task tools (TaskCreate, TaskUpdate, TaskList) and the plan you approve in plan mode (ExitPlanMode). Plan-mode headings become stages; a flat todo list is one stage. A todo list that follows an approved plan is placed into the plan's stages by matching step titles.
- **The line:** stage, current step, steps done out of total, a bar, and time left.
- **Time left** appears once two steps have finished. It is the median time per step this session, blended with this project's pace from earlier sessions, times the steps left. When step times vary too much to be honest it says `estimating...` instead.
- **Running long:** a step past three times its estimate turns amber and says how long it has run (`7m 12s on this step`).
- **Plans that change:** when Claude rewrites its list, reworded steps that were done stay done, and the line flashes `plan revised +2 −1` for a few seconds.
- **Done:** the bar turns green for a few seconds, then a toast gives the receipt (`Plan done in 4m 12s, 18s ahead of estimate. Build 2m 1s · Verify 2m 11s`) and the line leaves.
- **Subagents:** while any run, a small `3 agents` chip sits at the end of the line. No agent details.
- **Other mods:** Headway adds its line beneath what other mods draw above the prompt and passes theirs through, so when the band runs out of rows it is Headway's line that gets cut, never another mod's buttons. A mod that takes the whole band hides Headway's line until that mod is done. Headway steps aside while a survey holds that space.

| Command | What it does |
| --- | --- |
| `/headway` | Opens a pane with every step, its status (`[x]` done, `[>]` current, `[ ]` to do) and its time, plus a button to hide or show the line. Works mid-turn. |
| `/headway hide` | Hides the line for this session. |
| `/headway show` | Shows it again. |

### For other mods: the "plan done" moment

Each time a plan finishes, Headway writes the `$.state` value `headway.done`: `{ seq, at, totalMs, steps, stageMs, estimateMs }` (counts and durations, never titles). Its type is in [`types/index.d.ts`](types/index.d.ts) as `HeadwayDone`; list `headway` under `dependencies` in your `plugin.json` to get it typed. Then either:

- read it while drawing, `await $.state.get({ plugin: 'headway', key: 'done' })`, and your render hook redraws whenever a plan finishes, or
- react the moment it is written:

```ts
on('state.set', { plugin: 'headway', key: 'done' }, async ($, e, next) => {
  if (e.value) $.ui.toast(`${e.value.steps} steps done`)
  return next(e)
})
```

## Settings

None.

## What it can touch

- **Files:** none directly. Per-project pace history goes in the mod's own store (`$.store`, a JSON file Claude Code keeps for the mod): step durations, plan counts and when each project was last updated (to keep the most recent), never step titles. Projects are keyed by a hash of the project root, not the path. Capped at the last 40 step times for each of the 30 most recent projects.
- **Processes, network, model calls:** none. No tokens where Claude Code has its own plan tools: it adds nothing to the prompt or the system prompt. Where Headway lends its plan tool, that tool's short description sits in Claude's tool list, and Claude's calls to it cost what a todo update does. It never refuses a tool call and never holds up the end of a turn. `/headway` answers with no text for the model; the pane and toasts never reach it.
- **Timer:** one, once a second, only while a plan is in progress and Claude (or a subagent) is working, on a surface that draws the band (the terminal or the desktop app). It also runs for the moment a finished plan's green bar shows (3 seconds) or "plan revised" shows (4 seconds), even while Claude is idle. It stops when Claude is idle, when you hide the line, when the plan is done and when nothing draws the band.
- **Sounds:** none.

## Limits

- In the desktop app, a `/headway` sent as the very first prompt of a new session may show "/headway isn't a command here." The app checks the command before mods have registered theirs; the command still runs, and later ones show no such line.
- Time counts only while Claude or a subagent is working, so a pause between turns never makes a step look slow. A step's time is the span since the previous step finished; steps finished together share it.
- Time left hides (`estimating...`) while the sample coefficient of variation of the last 8 step times is above 1.0, roughly when one step took six times another. One long step (a full test run among quick edits) stops hiding it once eight newer steps have finished; the per-step median still uses the whole session.
- A plan-mode plan with no todo or task list after it has no progress to read. Headway shows `Plan approved · 2 stages, 6 steps` until that turn ends, then clears it.
- A plan Claude stops updating (you interrupted, changed topic, or the last items were never marked done) leaves on its own once two of Claude's turns pass with no update to it: no receipt and no history for it. An approved plan-mode outline no list followed expires the same way. A `/clear` or resuming another conversation clears the plan at once.
- Plan-mode parsing is a heuristic: the shallowest heading level used at least twice is the stage level, top-level list items are steps, and sections such as Context, Risks or Files to change are left out.
- Matching a reworded step is fuzzy (letter-pair overlap of 75% or word overlap of 60%). Very different wording reads as one step removed and one added. A done step keeps its done only while the new wording keeps 60% of its words, so a sibling such as "Write tests for the UI" never inherits the done of "Write tests for the API".
- Todo lists and plans kept by subagents are not shown; only the main conversation's plan is. Task updates from subagents do count for tasks Headway already knows.
- The agents chip counts subagents from start to finish. Teammates are left out, since they idle between turns.
- The "plan done" signal is a `$.state` value, not a telemetry mark: marks feed Claude Code's own analytics, which a display-only mod should not touch.
- After a plugin reload the countdown resumes at Claude's next tool call or turn.
- Drawn on the terminal and the desktop app, the two surfaces with a band above the prompt. The `/headway` pane opens on any surface that places panes.
- Where Claude has no todo or task tool (the desktop app, and terminal builds without todo tools), Headway lends it a small plan tool, `plan`, shaped like TodoWrite and listed with Claude's other tools, so the line still follows Claude's plan. Claude decides whether to use it: a turn where it plans only in prose shows nothing. Where Claude Code has its own plan tools, Headway lends none.
- Titles are drawn without escape sequences, control characters or invisible marks (bidi overrides, zero-width characters), and the line is laid out in terminal cells, so wide (CJK) titles and emoji are cut to fit rather than wrapping.

## Built from a prompt

[`prompts/headway.md`](../../prompts/headway.md)

More mods: [the full catalogue](../../README.md#the-mods).
