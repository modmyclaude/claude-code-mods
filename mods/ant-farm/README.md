<img src="../../brand/pixel-icons/svg/ant-farm.svg" width="64" height="64" alt="">

# Ant Farm

Watch your subagents work, and what they cost, live.

## Install

```
/plugin install ant-farm --marketplace modmyclaude/claude-code-mods
```

## Use it

- **The band.** While a turn runs, a slim line above the prompt shows the
  elapsed time, how many subagents are running and done, and the session's
  spend so far. It stays while background subagents still run. Other mods'
  band lines keep drawing, above it, so a long ant list never pushes their
  buttons out of view.
- **The pane.** `/antfarm` opens the Ant farm pane (it also works mid-turn,
  and adds nothing to the conversation).
  At the top: the subagents' total (price-table estimate), tokens and wall time,
  then the whole session's spend against your budget (Claude Code's estimate
  where it keeps one). With no subagents yet, Bolt naps here. Below, one card per running
  subagent: its task, model, status, elapsed time, a progress bar, requests,
  tokens and estimated cost. Finished subagents fold into one line each under
  **Finished**; **Expand** shows them as full cards again.
- **The ants.** Every subagent gets a small pixel-art ant, one colour per
  model. It walks while its subagent works, stands still and dims when it is
  done, and lies on its back in the error colour if it failed.
- **ETA.** Once a running subagent has made 3 model requests, its card shows
  an estimate of the time left ("~1m left"). It uses the subagent's own pace
  (time per request so far) and how many requests finished subagents of the
  same type needed this session. With nothing finished yet, it assumes the
  subagent is halfway.
- **Opens itself where it fits, once.** When the first subagent starts on a
  surface that docks panes beside the transcript (the fullscreen terminal, the
  desktop app), the pane opens on its own, at most once a session and never
  after you closed it by hand. Under 144 columns the engine holds such a pane
  back, so the band lists the subagents instead (one line each, with a
  **Hide** button). `/antfarm` opens it any time.
- **Two estimates.** The session's spend (the band, the pane's budget line,
  the footer mark, the status line and the alarm) is Claude Code's own
  estimate, the figure `/cost` shows, labelled "Claude Code's estimate". It is
  summed at list prices, so it is not your bill (a subscription does not pay
  it). Where Claude Code gives none, the price-table estimate stands in. Each
  subagent's cost is always the price-table estimate: Claude Code does not
  total cost per subagent. Every figure is marked `≈`.
- **Budget alarm.** The mod's status line under the prompt shows the
  session's spend against your budget. When it reaches the budget you get a
  toast and the budget mark beside the prompt footer turns amber; at twice the
  budget, another toast and red. Each crossing toasts once.
- `/clear` (or another session taking this one's place) starts the farm over,
  as it does `/cost`.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `budgetUsd` | `2` | Session budget in US dollars for the alarm, compared against Claude Code's own cost estimate (else the price-table estimate). `0` turns the alarm off. |

## What it can touch

- **Files:** none. **Processes:** none. **Network:** none.
- **Model calls:** none. Everything is counted from the usage the engine
  reports for each model request; nothing is sent anywhere.
- **Engine calls:** reads Claude Code's cost estimate for the session (after each
  model request and turn end), reads the session's agent list (to pick up a
  subagent that started before the mod loaded, and to settle one that ended
  without saying so), opens and lists its own pane, sets its status line,
  shows toasts.
- **Memory:** its counts live in session state and are gone when the session
  ends. Nothing is written to disk.

## Limits

- **Per-subagent costs are estimates.** They come from a small built-in table
  of Anthropic's published API list prices (cached 2026-10-06), marked with
  `≈`. The table cannot see fast mode, batch pricing, partner clouds (Bedrock,
  Vertex) or negotiated rates, and it prices every cache write at the 5-minute
  rate. A model missing from the table shows its tokens and a cost of `?`.
  The subagents' sum can therefore differ from Claude Code's estimate.
- **Claude Code's estimate is read after each model request and turn end**, so
  the alarm can trip one request after the real crossing. A resumed session's
  estimate includes its earlier runs, as `/cost` does.
- **The fallback estimate counts only model requests of a turn.** Side
  requests outside a turn (titles, safety checks) do not pass through
  `turn.step`, so when Claude Code gives no estimate the table's misses them.
- **The status line cannot be coloured.** Claude Code's plugin status line
  takes text only, so the amber and red of the alarm are drawn on the budget
  mark beside the prompt footer, the band and the pane header; the status line
  itself says "over budget" or "past 2x the budget".
- **The ETA is a heuristic.** Subagents do not announce how long they will
  take. Treat "~1m left" as a rough guide, most useful once a few subagents
  of the same type have finished.
- **The pane opens unasked only where it would be a sidebar.** On the
  terminal's main screen (no fullscreen layout) use `/antfarm`.
- **The band and the footer mark draw on the terminal and the desktop app**,
  the surfaces that have them. The pane draws wherever panes are placed.
- A subagent that runs in a remote cloud session (`isolation: 'remote'`,
  internal builds only) has no local loop: ant-farm sees it start but none of
  its requests, and cannot tell exactly when it ends.
- A background subagent stopped from outside may never report its end; the
  mod checks the engine's agent list about every 10 seconds and settles it
  from there. A running subagent that makes no request for 10 minutes (with no
  main turn running) stops the animation clock until it is heard from again.
- An interrupted subagent shows as failed (red, on its back): Claude Code
  reports an interrupt as an aborted turn, not a success.
- Caps: the pane lists 50 finished subagents one by one and counts the rest;
  past 200 subagents in a session the oldest finished ones leave the farm,
  and with them the subagents' header totals (Claude Code's session estimate is
  unaffected).
- Task descriptions, agent types and model names are drawn with escape
  sequences removed and other control characters shown as U+FFFD.
- Whether the pane may open on its own follows the surface that drew last;
  with a main-screen terminal and the desktop app both attached, that can be
  either.

## Built from a prompt

This mod was built from [the ant-farm prompt](../../prompts/ant-farm.md).

More mods: [the full catalogue](../../README.md#the-mods).
