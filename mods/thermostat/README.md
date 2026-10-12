<img src="../../brand/pixel-icons/svg/thermostat.svg" width="64" height="64" alt="">

# Thermostat

Shows when your prompt cache goes cold, and stops the expensive send.

Claude Code keeps your conversation in a prompt cache. After a stretch of quiet (about an hour on a subscription, 5 minutes on an API key) the cache lapses, and the next message re-reads the whole conversation at the full cache-write price. Thermostat shows you that clock, holds the surprise send once, and can keep the cache warm while you are away when that is actually cheaper.

## Install

```
/plugin install thermostat --marketplace modmyclaude/claude-code-mods
```

## Use it

**The countdown.** At the end of the prompt footer, beside the mode labels:

- `cache warm · 41m left` - quiet while there is time
- `cache warm · 8m left` - amber in the last 10 minutes (the last 2 of a 5-minute window)
- `cache cold · 182k to re-read` - once it has lapsed
- `· warming 1h12m` is added while `/warm` runs

This draws on the terminal and the desktop app. Where no footer draws (VS Code, mobile, or a footer that is hidden) the same text appears on the plain status line under the prompt, without colour. Nothing shows until the conversation has something cached.

**The guard.** When you send a prompt on a cold cache, it is held once and you see what it costs:

> Cache went cold 23m ago: this send re-reads 150k tokens (~$1.20 vs ~$0.03 warm, Opus 5.5 API list prices).
> Send again to go ahead, or /clear to start fresh.

Send it again to go ahead (the words are put back in the prompt box if it is empty), or `/clear` to start a fresh conversation instead. It only holds prompts you type yourself (at the terminal, in the desktop app, or through Remote Control; never a headless `claude -p` run, where nobody would see the hold), only when the re-read is at least 20k tokens, never a prompt typed while a turn is running, and a hold counts as seen for 10 minutes.

**Keep-warm.** `/warm 90m` (or `2h`, `1h30m`, `45`) sends a tiny ping just before the cache would go cold, for as long as you asked. Before every ping it compares what the remaining pings will cost with what one cold re-read would add; if pinging costs more, it stops and says so in the transcript. It also refuses up front when the whole window would not pay. `/warm` on its own shows where it stands, `/warm off` stops it. Only a `/warm` you type starts or stops it; another plugin's command cannot. Confirmations appear as a toast; when it will not start, the reason stays in the transcript as a dim note. A window can run up to 24 hours.

How a ping works: it re-sends the conversation's last request (same model, system prompt, tools and messages) with one line asking for the word "ok", tools denied. That reads the conversation's own cache entry, which restarts its timer. Nothing is added to your transcript. Every ping's usage is checked: if it did not read the conversation back from the cache, keep-warm stops rather than keep paying for pings that are not helping.

**The receipt.** `/thermostat` opens a pane (a transcript note where no pane can be drawn, as in `claude -p`) laid out to the collection's UI standard: the cache right now as one line in its colour (`Warm · 41m left`, `Cold · 98k to re-read`), the window's bar and the next send's price beneath, Bolt beside them (asleep while the cache is cold or empty); then a row each, the figure at the right edge and the detail dim beneath, for cold sends paid (and how much more than warm they cost), prompts held (and how many you answered with `/clear`), keep-warm pings (what they cost, and the sends that arrived warm because of them), money saved, Claude Code's own estimate of the session's total cost (what `/cost` sums at list or managed prices, not your bill), and the guard; a figure still at zero draws no row. One footnote says what the dollars are.

## Settings

| Field | Default | What it does |
| --- | --- | --- |
| `guard` | `hold` | `hold` stops the first cold send once and shows the cost. `warn` shows the cost in a toast and sends. `off` does nothing. |
| `cacheMinutes` | `0` | The cache window in minutes, used until Claude Code reports its own. `0` works it out from your login. |

The window is worked out in this order: what Claude Code itself reports (its cache TTL on a model switch, or whether a resumed cache has expired), then `cacheMinutes`, then your login (60 minutes on a subscription, 5 on an API key), and 5 minutes when none of these is known.

Prices come from a small table of API list prices per model family (October 2026), with cache writes at 1.25x input for the 5-minute window and 2x for the hour. When Claude Code prices a re-cache itself (on a resume or a model switch, including an organisation's managed pricing), its rate is used instead. On a subscription the dollars measure how much of your plan a send uses, not a bill.

## What it can touch

- **Reads:** each prompt as you submit it (to decide whether to hold it; the text is not kept), the token counts of each main-conversation model request, what Claude Code reports on a resume or model switch, the prompt box (only to check it is empty before putting a held prompt back), which kind of login the session uses (the kind only: the credential stays with Claude Code, and this mod makes no network requests that could use it), and Claude Code's estimate of the session's cost.
- **Writes:** its own session state, the prompt box (a held prompt's words, only into an empty box), the footer label and status line, the receipt pane, toasts, and short dim notes in the transcript. None of these is sent to the model: `/warm` and `/thermostat` answer with no command output when you type them, so they cost no tokens. The only command text is a one-line notice when `/warm` is run by something other than you (keep-warm changes only with a `/warm` you type) and a one-line error notice if either command fails; neither carries any of your data. No files, no settings, nothing kept across sessions.
- **Processes and network:** none.
- **Model calls:** only keep-warm pings, only after you run `/warm`, at most one per cache window (about every 58 minutes on a subscription, every 4 minutes on a 5-minute window). Each costs roughly one cache read of the conversation plus a few tokens; the smart rule stops them as soon as they would cost more than they save, a window ends after 24 hours at most, and three failed pings in a row end it too.

## Limits

- The window is a model of the cache, not a reading of it. Claude Code only states its cache TTL on a model switch (and implies it on a resume), so until then it comes from your login or `cacheMinutes`. Other things can make a send cold early (tools or instructions changing, the cache being evicted); the receipt still books those from the real token counts.
- The countdown starts with the first model request after the mod loads, or with a resume. Installed in the middle of a conversation, it shows nothing until your next message.
- After a model switch the new model starts with nothing cached, so that first send is neither held nor counted as a cold send.
- A ping can make the model think, which is billed as output; the measured cost of each ping feeds the next decision. Pings cannot go out while the computer sleeps; if it sleeps past the expiry, keep-warm stops and says so.
- In the desktop app the held prompt may not go back into the prompt box (the app can refuse that); send it again from your history. The desktop app is recognised by its prompts arriving as an SDK host's with a desktop surface attached; prompts from the VS Code extension are not held.
- The guard puts a held prompt's words back into the prompt box (only when the box is empty); attached files are not put back.
- The footer label is checked through the engine's test kit on the terminal and desktop surfaces; how each terminal paints it has not been checked by hand.
- Prices are list prices unless Claude Code priced a re-cache itself. Amazon Bedrock and Google Vertex AI bill separately.

## Built from a prompt

This mod was built from [the Thermostat prompt](../../prompts/thermostat.md).

More mods: [the full catalogue](../../README.md#the-mods).
