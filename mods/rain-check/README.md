<img src="../../brand/pixel-icons/svg/rain-check.svg" width="64" height="64" alt="">

# Rain Check

Hit your usage limit? Your prompt waits and goes out when the limit resets.

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
- **Cancel** drops what waits and puts your words back in the prompt box, after anything you have typed since.

Slash commands and `!` shell lines are never held: they do not use your model limit.

| Command | What it does |
| --- | --- |
| `/rain-check` | What waits, and when it goes out |
| `/rain-check now` | Send what waits at once |
| `/rain-check cancel` | Drop what waits; your words go back in the prompt box |

## Settings

- **On:** on by default. Off, Rain Check holds nothing, draws nothing and sends nothing, and forgets the limit it saw; a prompt already waiting goes back to the prompt box (or the transcript, where no box takes it), never out. `/rain-check` says it is off. `/config` or the modmyclaude hub flips it, live.

## What it can touch

- **Reads:** the usage windows Claude Code reports after each response (kind, percent used, reset time), the kind of error that ends a turn (only to see a `rate_limit`), and each prompt you send while a limit has refused you (to hold it). Before any refusal it reads your prompts only to let them pass. When it gives your words back, it reads what is already in the prompt box, so they go after your draft.
- **Writes:** its own session state (the limit, the waiting prompt, the countdown's clock, and the last prompt it sent), the line above the prompt, and toasts. Nothing is kept across sessions.
- **On disk:** nothing, with one exception. When your words come back (you cancel, the send is blocked, or you switch Rain Check off) and the prompt box cannot take them, they are shown in full in one dim line in the transcript, so they are not lost. Claude is not sent that line, but Claude Code's debug log (a file, when debug logging is on) keeps a copy.
- **Sends:** at the reset, the prompt you wrote, or "Continue where you left off. Your usage limit has reset." if you pressed Continue then. It sends nothing you did not write or ask for.
- **Processes and network:** none. **Model calls:** none of its own.

## Limits

- It starts holding only after a real refusal in this session, and checks your usage again at that moment. Near a cap but not at it (95% to 99%), one refusal may be a passing one, so it holds only after a second within 10 minutes. A window that reads 100% is not enough on its own, because extra usage can still let requests through. So the first prompt at the limit fails as usual, and what follows waits.
- It waits only while the session is open. Quit Claude Code and the waiting prompt is gone; it is not saved to disk.
- The waiting prompt is text only: files you attached are not kept, and the hold says so.
- If another hook or a settings rule blocks the send at the reset, your words come back to the prompt box with the reason; nothing is sent later behind your back.
- If the computer sleeps through the reset, the prompt goes out within a minute of waking.
- A turn refused for a passing reason (a short-lived rate limit, or an API key with no usage windows) holds nothing: Claude Code retries those itself.
- `/clear` drops a waiting "Continue then" (the old conversation is gone) but keeps a prompt you wrote.
- The line is checked through the engine's test kit on the terminal and desktop surfaces.

## Built from a prompt

This mod was built from [the Rain Check prompt](../../prompts/rain-check.md).

More mods: [the full catalogue](../../README.md#the-mods).
