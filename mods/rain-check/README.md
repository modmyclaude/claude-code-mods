# Rain Check

Hit your usage limit? Send your prompt anyway: it goes out when the limit resets.

```
Sends 2:01pm · in 3h 12m   [Send now] [Cancel]
"run the tests, then update the changelog"
```

## Install

```
/plugin install rain-check --marketplace modmyclaude/claude-code-mods
```

## Use it

Nothing to set up. It stays out of the way until Claude Code refuses a turn because a usage limit (your 5-hour or weekly window) has run out. Then:

- **A line above your prompt** says when the limit resets: `Usage limit reached · resets 2pm · in 5h`. **Continue then** picks the cut-off turn up at the reset. **Dismiss** stops waiting, so what you send goes straight out again.
- **Anything you send now waits.** Instead of failing, your prompt is held, and the line shows when it goes out and the first words of it. It goes out by itself one minute after the reset, so it lands in the new window. Send a second prompt and it joins the first; they go out together.
- **Send now** sends it at once (if the limit lifted early, or you have extra usage). If the limit still refuses it, it simply waits again.
- **Cancel** drops what waits.

Slash commands and `!` shell lines are never held: they do not use your model limit.

| Command | What it does |
| --- | --- |
| `/rain-check` | What waits, and when it goes out |
| `/rain-check now` | Send what waits at once |
| `/rain-check cancel` | Drop what waits |

## Settings

None.

## What it can touch

- **Reads:** the usage windows Claude Code reports after each response (kind, percent used, reset time), the kind of error that ends a turn (only to see a `rate_limit`), and each prompt you send while a limit has refused you (to hold it). Before any refusal it reads your prompts only to let them pass.
- **Writes:** its own session state (the limit, the waiting prompt, the countdown's clock, and the last prompt it sent), the line above the prompt, and toasts. Nothing is kept across sessions, and nothing goes on disk.
- **Sends:** at the reset, the prompt you wrote, or "Continue where you left off. Your usage limit has reset." if you pressed Continue then. It sends nothing you did not write or ask for.
- **Processes and network:** none. **Model calls:** none of its own.

## Limits

- It starts holding only after a real refusal in this session. A window that reads 100% is not enough on its own, because extra usage can still let requests through. So the first prompt at the limit fails as usual, and what follows waits.
- It waits only while the session is open. Quit Claude Code and the waiting prompt is gone; it is not saved to disk.
- The waiting prompt is text only: files you attached are not kept, and the hold says so.
- If the computer sleeps through the reset, the prompt goes out within a minute of waking.
- A turn refused for a passing reason (a short-lived rate limit, or an API key with no usage windows) holds nothing: Claude Code retries those itself.
- `/clear` drops a waiting "Continue then" (the old conversation is gone) but keeps a prompt you wrote.
- The line is checked through the engine's test kit on the terminal and desktop surfaces.

## Built from a prompt

This mod was built from [the Rain Check prompt](../../prompts/rain-check.md).

More mods: [the full catalogue](../../README.md#the-mods).
