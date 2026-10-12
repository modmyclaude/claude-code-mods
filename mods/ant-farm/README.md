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
- **The pane is a mission control.** `/antfarm` opens it (mid-turn too, and it
  adds nothing to the conversation). At the top: Bolt, the mission's state in
  one line (`Working · 3 running`, `Waiting · 1 held`, `All done · 4 agents`,
  `2 failed · 1 done`), the mission clock (`T+12:04`), the counts, the
  subagents' total (price-table estimate), the session's spend against your
  budget (Claude Code's estimate where it keeps one) and a budget bar. With no
  subagents yet, Bolt naps here. From 84 columns a heat strip sits beside the
  hero line: one column per subagent, one row per ten seconds of the last
  minute, each cell shaded by how much that subagent did in that window, in
  its colour, with the mission numbers underneath.
- **The cards.** One bordered card per running subagent, one to three across
  depending on the pane's width. Each shows its number and task, its ant,
  model and elapsed time, a status line (`WORKING · Bash npm test · 4s`,
  `THINKING · 12s`, `WAITING · permission for Bash`), a sparkline of tokens
  per request, requests and tokens, a progress bar, its estimated cost and
  ETA, and on a wide card how many tools it called, files it edited and calls
  that failed. The border takes the model's colour, green for a moment when it
  finishes, red when it fails, then rests dim. The pointer lights a card, and
  resting on it shows a hover card over the card's art: the full task and the
  subagent's last rows. Nothing moves and nothing is redrawn for it.
- **The status is read, never guessed.** `THINKING` while a thinking block
  streams in its own model request, `WORKING` while it writes or runs a tool
  (the status line names the tool and what it touches: `Bash npm test`,
  `Edit auth.ts`), `WAITING` while Claude Code asks you for a permission on
  its tool, or its agent list says it is held, `DONE` and `FAILED` at its end.
  A held subagent counts as waiting, not as running too.
- **The activity timeline.** Under the cards, the last 80 things the subagents
  did, newest first on the mission clock: starts and handoffs (`from #1`),
  tool calls, edits, endings with their duration, tools that failed or were
  refused, responses that hit a limit, the budget alarm. 12 rows by default,
  `+N more` shows 40, `hide` folds it.
- **The inspector.** `open` on a card (or its number) opens a panel with the
  subagent's task, type, model, start, where it came from, its live state, its
  numbers, a longer sparkline and its own last rows; `previous`, `next` and
  `close` move between subagents.
- **Keys.** While the pane holds the keyboard (ctrl+x tab, or a click into it)
  a subagent's number 1 to 9 opens it, `n` and `p` move, `x` closes the
  inspector, `f` expands or collapses the finished list, `t` folds the
  timeline; a `Keys` line shows then. Esc hands the keyboard back.
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
  **Hide** button). `/antfarm` opens it any time, and asks the dock for room
  for two cards across.
- **Narrow panes.** Under 40 columns the pane draws one line per subagent, no
  borders or art, and a shorter timeline, so nothing is lost.
- **Two estimates.** The session's spend (the band, the pane's budget line,
  the footer mark, the status line and the alarm) is Claude Code's own
  estimate, the figure `/cost` shows, labelled "Claude Code's estimate". It is
  summed at list prices, so it is not your bill (a subscription does not pay
  it). Where Claude Code gives none, the price-table estimate stands in. Each
  subagent's cost is always the price-table estimate: Claude Code does not
  total cost per subagent. Every figure is marked `≈`.
- **Budget alarm.** Off until you set `budgetUsd` in `/config`. Then the
  mod's status line under the prompt shows the session's spend against it. When it reaches the budget you get a
  toast and the budget mark beside the prompt footer turns amber; at twice the
  budget, another toast and red. Each crossing toasts once, and lands on the
  timeline.
- `/clear` (or another session taking this one's place) starts the farm over,
  as it does `/cost`.

## Settings

Every setting has a default, so the notice at install about options not yet set is expected; change them in `/config`.

| Setting | Default | What it does |
| --- | --- | --- |
| `budgetUsd` | `0` (off) | Session budget in US dollars for the alarm, compared against Claude Code's own cost estimate (else the price-table estimate). Off until you set one; the pane says so. It only warns, it never stops Claude. |

## What it can touch

- **Files:** none. **Processes:** none. **Network:** none.
- **Model calls:** none. Everything is counted from the usage the engine
  reports for each model request; nothing is sent anywhere.
- **Engine calls:** reads Claude Code's cost estimate for the session (after each
  model request and turn end), reads the session's agent list (to pick up a
  subagent that started before the mod loaded, to settle one that ended
  without saying so, and to see one the engine holds), opens and lists its own
  pane, sets its status line, shows toasts.
- **What it watches, without changing it:** the chunks of each subagent's
  model requests (which kind streams: thinking, text, a tool named), each
  subagent's tool calls (the tool and what it names: a file's name, a
  command's first line, a pattern) and the permission verdict on them. The
  stream, the call and the verdict pass through as the engine made them; the
  main loop's own tool calls are not recorded. Anything shaped like a
  credential in those words (a token, a `password=` value, a key in a URL) is
  replaced with `[REDACTED]` before the pane keeps or shows it.
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
  unaffected). The timeline keeps the last 80 rows; the long form shows 40.
- The live status is what the engine said last. A subagent the mod only found
  mid-run reads `WORKING` until its next request says more; after a code reload
  every running one does. A permission ask is seen when Claude Code asks you,
  not when a subagent merely plans a tool.
- Hotkeys act only while the pane holds the keyboard, as Claude Code keys every
  pane; from the prompt, click a card's `inspect` instead.
- **The hover card draws where the surface tracks the pointer:** the desktop
  app, and a terminal with mouse tracking. Elsewhere the cards are as before.
- **A click on the desktop app can be dropped while the pane is live.** The app
  presses a button by the handle it was drawn with, and Claude Code hands out
  new handles on every redraw; a click that lands just after a redraw does
  nothing. The pane's own buttons are redrawn on every tick so this is rare
  (about one click in a minute of a busy run); click again, or use the keys.
  The terminal is not affected.
- Task descriptions, agent types and model names are drawn with escape
  sequences removed and other control characters shown as U+FFFD.
- Whether the pane may open on its own follows the surface that drew last;
  with a main-screen terminal and the desktop app both attached, that can be
  either.

## Built from a prompt

This mod was built from [the ant-farm prompt](../../prompts/ant-farm.md).

More mods: [the full catalogue](../../README.md#the-mods).
