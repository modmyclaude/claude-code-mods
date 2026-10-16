<img src="../../brand/pixel-icons/svg/redline.svg" width="64" height="64" alt="">

# Redline

Context fill, session cost and pace on one line, with a warning before the red line.

```
context ████████░░ 82% RED, full in ~7m · 5h █░░░░ 11% · week ████░ 83% AMBER, out in ~21h · ≈$4.12 · 3.9k tokens/min
```

## Install

```
/plugin install redline --marketplace modmyclaude/claude-code-mods
```

## Use it

- **Status line** (under the prompt), updated on every model request. Each figure is a label, a bar and a readout (filled is used), in reading order, and anything that follows a comma belongs to the figure before it:
  - `context ████████░░ 82%`: how full the conversation's context window is, as Claude Code measures it, with the level as a word from 60% (`AMBER`) and 80% (`RED`), since the status line has no colour. While the context grows, its pace follows: `, full in ~7m` is when it would hit 100% at the rate of the last 10 minutes.
  - `5h █░░░░ 11%` and `week ████░ 83%`: your plan's 5-hour and weekly windows, as `/usage` reports them. A window that will run dry before it resets says so, in amber: `week ████░ 83% AMBER, out in ~21h`. A spent window says when it comes back: `5h OUT, resets in 48m`, or `week OUT, resets Sat 10am` once that is ten hours or more away; `5h reset` after that time has passed, until the next reply brings a new figure.
  - `≈$4.12`: the session so far at API list prices, Claude Code's own estimate (what `/cost` shows) where it keeps one, otherwise redline's price table. On a plan nobody pays it, so it comes after the windows; with an API key it is the limit and comes right after the context.
  - `3.9k tokens/min`: new tokens over the last 10 minutes, shown only while tokens flow. An idle session shows no rate and no pace, never a `0`.
- **Toast at 80%**: one toast suggesting `/compact` or a fresh session (`/clear`), once per crossing. It re-arms only after the context drops under 75% (a compaction, a fresh session), so it never nags on every redraw.
- **`/redline`** opens the detail view in a pane, laid out to the collection's UI standard: a hero line with the context fill in its colour and the bar beneath; label and value rows (pace, throughput, tokens, cost, session, requests) with the figures at the right edge and the breakdowns dim beneath them; each plan window as a bar with its reset time and run-out; the five busiest turns; and one footnote for the caveats. The cost headline is Claude Code's own estimate (what `/cost` shows) when it keeps one, else the price table's, both marked `≈`. Rows that would read zero before the first request are not drawn. Buttons: show or hide the band, close. Where no surface places the pane, the same view goes to the transcript as dim rows of its own, which the model does not read.
- **`/redline spend`** opens the same pane for its **Where the money went** section: this session's cost split by the kind of work each model request carried, one row per kind (prompt, reading, editing, shell, search, planning, subagents, answering, an MCP server's tools by its name) with a share bar, the request count and the cache share, then the same by model. The rule, stated under the rows: a request is charged to the kinds of the tool results it carried (the previous reply's tool calls), split evenly when it carried several; a turn's first request is the prompt; a subagent's requests are subagents. Every figure is a list-price estimate, marked `≈`; nothing new is stored, and the band does not change.
- **`/redline band`** toggles a band above the prompt with the same gauge, in colour, for people who hide the status line: each figure in its own colour (green, amber, red, by its own level), the dollars dim on a plan. Under 80 columns the context bar halves and the windows read in words (`week 83% used`). Its `Hide` button turns it off. The choice is remembered across sessions. It shares the band: whatever other mods draw there stays, drawn first, with the gauge on the line after it. It steps aside while a survey holds that space.

## Settings

None. The thresholds (60%, 80%, re-arm under 75%) and the 10-minute window are fixed.

## What it can touch

- Reads: what Claude Code reports about the session (`$.session.usage()`, the `session.measure` event), each model request's token counts (`turn.step`), each turn's prompt text (`turn.start`, shown only in the busiest-turns list), and compactions, `/clear` and an in-session `/resume` (each starts the gauge over). Model ids, plan window names and prompt text are cleaned of control characters before anything is drawn.
- Writes: one remembered value in the plugin's own store (whether the band is on). No files.
- No processes, no network, no model calls. No tokens: nothing it draws reaches the model.

## Where the numbers come from

- **Context window**: Claude Code reports it for the model in use, so a 1M-token model reads correctly. No table is involved.
- **Context fill**: Claude Code's own figures (`context.tokens` and `context.percent`, the status line's used percentage) whenever it has measured the latest request. Between its measurements the gauge counts the main conversation's last request itself, input side (uncached + cache read + cache write), the same way, so it moves on every request. Subagent requests count toward tokens and cost, never toward the session's context.
- **Session cost**: Claude Code's own total (`cost.usd`, what `/cost` shows), labelled as its estimate and marked `≈`: it is summed at list prices over the session's responses, not a bill (on a subscription nobody pays it). Where Claude Code keeps no ledger, redline's built-in price table prices the requests it counted, and a model the table does not know shows tokens only, never a guessed price.
- **Price table** (`hooks/prices.ts`): list prices per model family as of 2026-10-08, used for the per-category and per-turn estimates. It leaves out long-context premiums, fast mode, 1-hour cache writes, batch and regional pricing, so every figure from it is marked `≈`.
- **Plan run-out**: the window's current rate, how far it moved over the last 15 minutes of readings, so a late burst warns even when the average looks calm. When it has not moved in that time, the average pace since the window opened (its reset time less its length) stands in; the detail view says which of the two it used. A gateway's spend limit gets an estimate only from its recent rate. A window's colour follows this, never its percentage alone: amber when it is set to run out before it resets, red when spent. Spans of ten hours or more round to the hour (`~21h`), and a reset that far off reads as clock time in your machine's zone.

## Limits

- Plan windows appear only on a Claude subscription, after the first reply of a session; with an API key there are none, and the detail view says so.
- Token counts (and the price-table estimate) start when redline loads; Claude Code's cost estimate and the context fill cover the whole session. A plan window's recent rate needs readings from this session, so right after start the average stands in.
- The pace needs a minute of growing context inside the last 10 minutes. Flat or shrinking context gives no estimate. Right after a compaction the fill is Claude Code's own estimate of the compacted size until the next reply measures it.
- The status line, band and pane update on model requests and measurements, not on a timer. Two one-shot repaints are the exception: 10 minutes after the last reading (so an idle session stops showing a pace and rate) and just after each plan window resets (so a spent window flips to `reset` while you wait). The session time in the detail view refreshes with readings.
- Terminal and desktop are supported and tested. VS Code and mobile draw the pane through the same hooks but are not tested.

## Built from a prompt

This mod was built from [its prompt](../../prompts/redline.md).

More mods: [the full catalogue](../../README.md#the-mods).
