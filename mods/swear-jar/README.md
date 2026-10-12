<img src="../../brand/pixel-icons/svg/swear-jar.svg" width="64" height="64" alt="">

# Swear jar

A jar that counts the model's verbal tics ("You're absolutely right", "Great question", the em dash) in one dim line above the prompt and a scoreboard. It never rewrites a reply.

```
swear-jar: absolutely right 3 · great question 1 · em dashes 12
```

```
Swear jar
This session: 16
  em dashes            12
  absolutely right      3
  great question        1
All time: 140
  em dashes            98
  absolutely right     31
  i apologize          11
Worst offender: em dashes (98)
Last reply
  You're absolutely right, the cache key was wrong.
Plain-words nudge off (/swear-jar nudge on|off).
```

## Install

```
/plugin install swear-jar --marketplace modmyclaude/claude-code-mods
```

## Use it

- **The band**: one dim line above the prompt with this session's top three tics, drawn under whatever other mods draw there. Nothing is drawn while every count is zero, and nothing at all while another mod's safety hold waits for your answer.
- **`/swear-jar`** opens the scoreboard: this session, all time, the worst offender, and the last reply's hits in their sentences with the tic in bold.
- **`/swear-jar reset`** empties this session's jar; **`/swear-jar reset all`** empties it for good.
- **`/swear-jar nudge on`** adds one short line to the system prompt asking for plain words and no praise openers; **`nudge off`** removes it. Off by default; the switch is remembered.

Counting is per response: every time Claude Code receives a reply from the model in the main conversation, the reply's text is searched for the tics, whole phrases, case aside. "You're absolutely right" and "You are absolutely right" share one jar. Every em dash counts.

## Settings

Change them in `/config` (or on the install screen).

| Setting | Default | What it does |
| --- | --- | --- |
| `tics` | you're absolutely right, you are absolutely right, great question, excellent question, i apologize, certainly!, absolutely!, as an ai, it's worth noting, i hope this helps, let me know if, delve, em dash | The phrases to count, whole and regardless of case. The words `em dash` mean the character. Your list replaces the built-in one; an empty list brings it back. |
| `show` | `band` | Where the running count shows: `band` (the line above the prompt), `status` (the status line, as `swear-jar 16`), `both`, or `off`. The scoreboard pane works whatever you pick. |

## What it can touch

- **Reads:** the text of each main-conversation response as Claude Code receives it from the model, counted once and kept in memory; its two settings; its own store. Not subagents' responses, not the transcript file, never your prompts.
- **Writes:** two small values in its own store (the all-time counts, the nudge switch), the band, the status line, the pane, toasts, and a transcript row where no pane can be placed (the model does not read it).
- **Model calls:** none of its own. With the nudge on, one line of about 30 tokens joins every request's system prompt, on the session side of the cache; with it off, nothing. `/swear-jar` answers with no command output, so the model never reads the scoreboard.
- **No files, no processes, no network.** It never changes a reply's text and never holds a tool call.

## Limits

- Whole phrases in English, case aside: "You're absolutely, completely right" is not caught, and neither is a tic split across lines.
- A reply that only called tools has no text and counts nothing. A reply cut short counts what came back.
- Counts are a mirror, not a judgment: some "I apologize" are earned.
- The band, the pane and the status line are checked through the engine's test kit on the terminal and desktop surfaces.

## Built from a prompt

This mod was built from [the Swear jar prompt](../../prompts/swear-jar.md).

More mods: [the full catalogue](../../README.md#the-mods).
