<img src="../../brand/pixel-icons/svg/redline.svg" width="64" height="64" alt="">

# Redline

Context fill, session cost and pace on one line, with a warning before the red line.

```
context ████████░░ 82% RED, full in ≈7m · 5h █░░░░ 11% · week ████░ 83% AMBER, out in ≈21h · ≈$4.12 · 3.9k tokens/min
```

## Install

```
/plugin install redline --marketplace modmyclaude/claude-code-mods
```

## Use it

- **Status line** (under the prompt), updated on every model request. Each figure is a label, a bar and a readout (filled is used), in reading order, and anything that follows a comma belongs to the figure before it:
  - `context ████████░░ 82%`: how full the conversation's context window is, as Claude Code measures it, with the level as a word from 60% (`AMBER`) and 80% (`RED`), since the status line has no colour. While the context grows, its pace follows: `, full in ≈7m` is when it would hit 100% at the rate of the last 10 minutes.
  - `5h █░░░░ 11%` and `week ████░ 83%`: your plan's 5-hour and weekly windows, as `/usage` reports them. A window that will run dry before it resets says so, in amber: `week ████░ 83% AMBER, out in ≈21h`. A spent window says when it comes back: `5h OUT, resets in 48m`, or `week OUT, resets Sat 10am` once that is ten hours or more away; `5h reset` after that time has passed, until the next reply brings a new figure.
  - `≈$4.12`: the session so far at API list prices, Claude Code's own estimate (what `/cost` shows) where it keeps one, otherwise redline's price table. On a plan nobody pays it, so it comes after the windows; with an API key it is the limit and comes right after the context.
  - `3.9k tokens/min`: new tokens over the last 10 minutes, shown only while tokens flow. An idle session shows no rate and no pace, never a `0`.
- **Toast at 80%**: one toast suggesting `/compact` or a fresh session (`/clear`), once per crossing. It re-arms only after the context drops under 75% (a compaction, a fresh session), so it never nags on every redraw.
- **`/redline`** opens the detail view in a pane, laid out to the collection's UI standard. One line on top names the limit closest to its wall, in its colour (`Week runs out in ≈2h 44m`, `5-hour ran out · resets in 48m`), or says `Within limits`. Under it, the context, the 5-hour window and the week as aligned 10-cell bars, each with its percentage and when it matters (`full in ≈30m`, `resets in 48m`, `out in ≈2h 44m, resets Tue 9am`), coloured by the band's rule. Then when the session started (`Wed 2pm`) and its cost: Claude Code's own estimate (what `/cost` shows) when it keeps one, else the price table's, marked `≈`. One footnote. Bolt keeps watch beside the bars when the pane is 60 columns or wider; he sleeps until the first reading and while a 5-hour or weekly window is used up. Before anything is spent, the session rows are not drawn. Buttons: Spending (where the money went), show or hide the band, close. Where no surface places the pane, the same view goes to the transcript as dim rows of its own, which the model does not read.
- **`/redline spend`**, or the pane's Spending button, shows where the money went in the same pane. On top, what redline counted (`≈$2.36 in 9 requests`, plus `since 1:47pm` when redline started after the session). Below that, the cost by the kind of work each request carried (prompt, reading, editing, shell, search, planning, subagents, answering, other tools, an MCP server by its name), with a share bar, the dollars and the share. Four rows at most: the rest fold into one. Then by model, when more than one model answered, and the costliest turns. A request is charged to what it sent Claude: the results of the previous reply's tool calls, split evenly across their kinds. A turn's first request is the prompt, and a subagent's requests are subagents. A model the price table does not know shows `--`, never a guess. Every figure is a list-price estimate, marked `≈`. Nothing new is stored, and the band does not change. Back returns to the limits.
- **`/redline band`** toggles a band above the prompt with the same gauge, in colour, for people who hide the status line: each figure in its own colour (green, amber, red, by its own level), the dollars dim on a plan. Under 80 columns the context bar halves and the windows read in words (`week 83% used`). Its `Hide` button turns it off. The choice is remembered across sessions. It shares the band: whatever other mods draw there stays, drawn first, with the gauge on the line after it. It steps aside while a survey holds that space.

## Settings

None. The thresholds (60%, 80%, re-arm under 75%) and the 10-minute window are fixed.

## What it can touch

- Reads: what Claude Code reports about the session (`$.session.usage()`, the `session.measure` event), each model request's token counts (`turn.step`), each turn's prompt text (`turn.start`, shown only in the spend view's costliest turns), and compactions, `/clear` and an in-session `/resume` (each starts the gauge over). Model ids, plan window names and prompt text are cleaned of control characters before anything is drawn.
- Writes: one remembered value in the plugin's own store (whether the band is on). No files.
- No processes, no network, no model calls. No tokens: nothing it draws reaches the model.

## Where the numbers come from

- **Context window**: Claude Code reports it for the model in use, so a 1M-token model reads correctly. No table is involved.
- **Context fill**: Claude Code's own figures (`context.tokens` and `context.percent`, the status line's used percentage) whenever it has measured the latest request. Between its measurements the gauge counts the main conversation's last request itself, input side (uncached + cache read + cache write), the same way, so it moves on every request. Subagent requests count toward tokens and cost, never toward the session's context.
- **Session cost**: Claude Code's own total (`cost.usd`, what `/cost` shows), labelled as its estimate and marked `≈`: it is summed at list prices over the session's responses, not a bill (on a subscription nobody pays it). Where Claude Code keeps no ledger, redline's built-in price table prices the requests it counted, and a model the table does not know shows tokens only, never a guessed price.
- **Price table** (`hooks/prices.ts`): list prices per model family as of 2026-10-08, used for the spend view's estimates (by kind, by model, per turn). It leaves out long-context premiums, fast mode, 1-hour cache writes, batch and regional pricing, so every figure from it is marked `≈`.
- **Plan run-out**: the window's current rate, how far it moved over the last 15 minutes of readings, so a late burst warns even when the average looks calm. When it has not moved in that time, the average pace since the window opened (its reset time less its length) stands in. The detail view marks every such estimate with `≈`, and its footnote says it assumes your pace holds. A gateway's spend limit gets an estimate only from its recent rate. A window's colour follows this, never its percentage alone: amber when it is set to run out before it resets, red when spent. Spans of ten hours or more round to the hour (`≈21h`), and a reset that far off reads as clock time in your machine's zone.

## Limits

- Plan windows appear only on a Claude subscription, after the first reply of a session; with an API key there are none, and the detail view says so.
- Token counts (and the price-table estimate) start when redline loads; Claude Code's cost estimate and the context fill cover the whole session. The main view shows only whole-session figures; the spend view says since when it counts. A plan window's recent rate needs readings from this session, so right after start the average stands in.
- The pace needs a minute of growing context inside the last 10 minutes. Flat or shrinking context gives no estimate. Right after a compaction the fill is Claude Code's own estimate of the compacted size until the next reply measures it.
- The status line, band and pane update on model requests and measurements, not on a timer. Two one-shot repaints are the exception: 10 minutes after the last reading (so an idle session stops showing a pace and rate) and just after each plan window resets (so a spent window flips to `reset` while you wait). Countdowns in the detail view (`resets in 48m`) refresh with readings, like the band's.
- Terminal and desktop are supported and tested. VS Code and mobile draw the pane through the same hooks but are not tested.

## Built from a prompt

This mod was built from [its prompt](../../prompts/redline.md).

More mods: [the full catalogue](../../README.md#the-mods).
