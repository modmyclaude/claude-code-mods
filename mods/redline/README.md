# Redline

Context fill, session cost and pace on one line, with a warning before the red line.

```
ctx 82% ████████░░ RED · $4.12 · 3.9k tok/min · full in ~7m · 5h 46% · 7d 13%
```

## Install

```
/plugin install redline --marketplace modmyclaude/claude-code-mods
```

## Use it

- **Status line** (under the prompt), updated on every model request:
  - context fill as a percentage with a 10-cell bar, and the level as a word: nothing under 60%, `AMBER` from 60%, `RED` from 80% (the status line has no colour, so the word carries it);
  - the session cost so far: Claude Code's own figure (what `/cost` shows) where it keeps one, shown plain; otherwise an estimate from the price table, marked `≈`;
  - new tokens per minute over the last 10 minutes;
  - the pace: when the context hits 100% at the rate it grew over the last 10 minutes (`full in ~25m`);
  - your plan's 5-hour and weekly windows (`5h 46%`, `7d 13%`), with `out in ~40m` added when a window will run dry before it resets.
- **Toast at 80%**: one toast suggesting `/compact` or a fresh session (`/clear`), once per crossing. It re-arms only after the context drops under 75% (a compaction, a fresh session), so it never nags on every redraw.
- **`/redline`** opens the detail view in a pane: context used against the window, the pace and its rate, input / output / cache read / cache write tokens, the cost (Claude Code's own ledger, plus a per-category estimate from the price table), time in session, each plan window with its reset time and run-out estimate, and the five busiest turns. Buttons: show or hide the band, close. Where no surface places the pane, the same view is printed as the command's output.
- **`/redline band`** toggles a band above the prompt with the same gauge, in colour (green, amber, red), for people who hide the status line. Its `Hide` button turns it off. The choice is remembered across sessions. It shares the band: whatever other mods draw there stays, drawn first, with the gauge on the line after it. It steps aside while a survey holds that space.

## Settings

None. The thresholds (60%, 80%, re-arm under 75%) and the 10-minute window are fixed.

## What it can touch

- Reads: what Claude Code reports about the session (`$.session.usage()`, the `session.measure` event), each model request's token counts (`turn.step`), each turn's prompt text (`turn.start`, shown only in the busiest-turns list), and compactions, `/clear` and an in-session `/resume` (each starts the gauge over). Model ids, plan window names and prompt text are cleaned of control characters before anything is drawn.
- Writes: one remembered value in the plugin's own store (whether the band is on). No files.
- No processes, no network, no model calls. It costs nothing to run.

## Where the numbers come from

- **Context window**: Claude Code reports it for the model in use, so a 1M-token model reads correctly. No table is involved.
- **Context fill**: Claude Code's own figures (`context.tokens` and `context.percent`, the status line's used percentage) whenever it has measured the latest request. Between its measurements the gauge counts the main conversation's last request itself, input side (uncached + cache read + cache write), the same way, so it moves on every request. Subagent requests count toward tokens and cost, never toward the session's context.
- **Session cost**: Claude Code's own total (`cost.usd`, what `/cost` shows), shown without `≈` since it is not redline's estimate. Where Claude Code keeps no ledger, redline's built-in price table prices the requests it counted (marked `≈`), and a model the table does not know shows tokens only, never a guessed price.
- **Price table** (`hooks/prices.ts`): list prices per model family as of 2026-10-08, used for the per-category and per-turn estimates. It leaves out long-context premiums, fast mode, 1-hour cache writes, batch and regional pricing, so every figure from it is marked `≈`.
- **Plan run-out**: the average pace a window has been used at since it opened (its reset time less its length). Shown for the 5-hour and weekly windows; a gateway's spend limit is shown with no estimate.

## Limits

- Plan windows appear only on a Claude subscription, after the first reply of a session; with an API key there are none, and the detail view says so.
- Token counts (and the price-table estimate) start when redline loads; the ledger cost and context fill cover the whole session.
- The pace needs a minute of growing context inside the last 10 minutes. Flat or shrinking context gives no estimate. Right after a compaction the fill is Claude Code's own estimate of the compacted size until the next reply measures it.
- The status line and band update on model requests and measurements, not on a timer. The one exception: 10 minutes after the last reading the status line repaints once, so an idle session stops showing a pace and rate. The session time in the detail view refreshes with readings.
- Terminal and desktop are supported and tested. VS Code and mobile draw the pane through the same hooks but are not tested.

## Built from a prompt

This mod was built from [its prompt](../../prompts/redline.md).
