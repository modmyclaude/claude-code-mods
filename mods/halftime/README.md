<img src="../../brand/pixel-icons/svg/halftime.svg" width="64" height="64" alt="">

# Halftime

Claude works, you play. The whistle blows the moment it needs you.

Four small games live in the band above your prompt. The moment Claude needs
you - a permission prompt, a question, an input request, or the turn ending -
the game freezes, the board closes so your keys go back to the prompt, and a
line says `whistle: Claude needs you`. When Claude gets going again you get a
3-2-1 and the same run, exactly where you left it.

## Install

```
/plugin install halftime --marketplace modmyclaude/claude-code-mods
```

## Use it

| Command | What it does |
|---|---|
| `/halftime` | Opens the picker, with your one-line scorecard. |
| `/halftime cratehop` (or `tailchase`, `merge`, `sweep`) | Puts that game's daily board above the prompt. Add `practice` for a random board. |
| `/halftime auto` | Turns auto on or off (`/halftime auto on`, `/halftime auto off`). |
| `/halftime off` | Closes the band; a run in play is paused, and the picker offers it back. |

The command runs at once even while Claude is mid-turn. In the terminal and the
desktop app its replies are short toasts and nothing is added to the
conversation, so Claude never reads them. VS Code and the mobile app have no
band, so there the reply is the command's row: your one-line scorecard.

**A board takes your keys only when you click it.** Esc hands them back to the
prompt. No game ever uses Enter, `y`, `n` or a digit, and the board never
passes those keys on, so a stray press can never answer one of Claude Code's
prompts.

The games (all original):

- **cratehop** - a courier runs on its own; `space`, `up`, `w` or a click jumps the crates. Speed rises slowly with distance. Score: distance.
- **tailchase** - steer a snake on a wide, short field with the arrows, `wasd` or `hjkl`. The edges wrap; biting yourself ends the run. Score: pips eaten.
- **merge** - slide a 4x4 board of lettered tiers (arrows, `wasd`, `hjkl`); two equal letters make the next one, once per tile per move. Score: points.
- **sweep** - a 16x6 mine field with 14 mines. Arrows move, `space` or `x` opens, `f` flags, or click / right-click a cell. It opens with a safe pocket. Score: seconds to clear (lower is better).

Every game: `p` pauses and resumes, `r` starts again after a run ends.

**Daily boards.** Each game's daily board comes from the date alone, so
everyone gets the same board that day. After a run, the result line reads like
`halftime daily 10-09 · cratehop 412 · played 3m of a 7m turn`, with a `copy` button.

**Auto mode** offers a game (a clickable line) once a turn has run 10 seconds.
It never starts a game or takes your keys by itself.

**The whistle** blows for: a permission prompt (from the main conversation or
a subagent), a question from Claude (AskUserQuestion), an input request from a
tool (MCP elicitation), and the main turn ending. Subagents starting and
finishing never pause or resume anything. The run comes back with a 3-2-1 when
the loop that asked moves on, or when your next turn starts; after a turn ends
you can also press `play on`.

The run also pauses by itself when a survey takes the band, when you start
typing at the prompt, when you open the picker or close the band, and when a
realtime game (cratehop, tailchase) gets no key or click for 20 seconds. A board
that comes back after any of these waits for your click.

## Settings

No settings screen. Auto mode (`/halftime auto`) and your last game are
remembered across sessions; the picker's `daily` / `practice` toggle lasts the
session.

## What it can touch

- **Its own store only** (Claude Code's per-plugin store): personal bests
  (`best:<game>`), today's daily best (`daily:<game>`), totals (play time,
  play time while Claude worked, runs), the auto switch and your last game.
- **The clipboard**, only when you press `copy`.
- **No files, no processes, no network, no model calls.**
- Timers run only while a game is played: the board's frame clock while a
  realtime run is in play and holds your keys, and a 3-second countdown. A
  paused or closed game ticks and redraws nothing. Auto mode sets one 10-second
  timer per turn.

## Limits

- **Terminal and desktop app only.** VS Code and the mobile app have no band
  and no board; there `/halftime` shows a one-line scorecard instead.
- **Starting a game cannot hand it your keys.** Claude Code gives the band the
  keyboard only on your click, so `/halftime cratehop` puts the
  board up and the run starts on your first click.
- **Esc gives no signal to the mod.** A realtime run you leave keeps going
  until you type at the prompt (it pauses then) or, at most, 20 seconds with
  no key or click, when it pauses itself. Those idle seconds never count as
  play. Turn-based games (merge, sweep) never tick, so they need no such pause.
- **After you answer a permission prompt**, play resumes when that step's tools
  finish (the API has no "dialog answered" event), or at your next turn.
- **Two open sessions** share bests safely (each save re-reads the store just
  before writing and repairs a lower write it finds after), but the store has no
  true compare-and-set: two saves in the same instant can still race. Totals are
  added the same way and can, rarely, miss a few seconds.
- Copy works in the terminal; a surface without a clipboard path says so, and
  the line stays on screen to select.
- The daily board follows your machine's calendar day.
- Drawing is verified against the plugin test kit, not a real terminal's paint.

## Built from a prompt

[`prompts/halftime.md`](../../prompts/halftime.md)

More mods: [the full catalogue](../../README.md#the-mods).
