# Crossroads

Three ways forward after every turn, risky ones marked. About $0.0002 a turn.

```
1: run the auth tests · 2: add the same guard to signup.ts · 3: push to main (pushes) · 0: dismiss
```

## Install

```
/plugin install crossroads --marketplace ORG_TBD/REPO_TBD
```

## Use it

- When Claude finishes a turn with an answer, a small band appears above your prompt with three specific next prompts. A dim row shows while they are being made.
- In an empty prompt, press **1**, **2** or **3** to put that suggestion in your prompt as an editable draft. It is never sent for you. Press **0** to dismiss the list. Each item is also a button you can click.
- If Claude Code is already showing its own guess (the dim ghost text you take with Tab), that guess is option 1, so you never see two different "next" ideas. Only the other two are generated.
- Risky suggestions (push, deploy, publish, release, merge, delete, `rm`, drop, force, send, open a PR) get an amber note such as `(deploys)`. They are never option 1 and never become the ghost text: a risky guess from Claude Code is kept out of the prompt box and shown in the list instead.
- If Claude's reply ends with numbered options, the digit keys are left alone for that turn so typing a number answers Claude. The items stay clickable.
- The list clears the moment you submit anything. It waits for background subagents to finish before suggesting.
- **Desktop app:** the desktop prompt box cannot be filled by a mod, so clicking an item copies it to your clipboard and shows a clearly labelled **Send this prompt now** button. Send is never the default and has no hotkey.

Commands:

| Command | What it does |
|---|---|
| `/crossroads` | Today's calls and estimated cost, this project's counts, back-off state |
| `/crossroads off` / `on` | Turn the mod off or back on (off also stops judging Claude Code's own guess) |
| `/crossroads forget` | Wipe what it counted for this project |

## Settings

None. Use the commands above.

## What it can touch

- **Model calls:** at most one small-model call (`haiku`, low effort, capped at 1,200 output tokens and 20 seconds) per finished main-loop turn. Skipped on trivial turns (under four words, or no tool use and no question), on subagent turns, and while backing off. Typical cost about $0.0002 at Claude Haiku 5.5 list prices; `/crossroads` shows today's estimate.
- **What is sent:** a compact digest, never the transcript: your first prompt (the goal), your last prompt, the names of files Claude edited or read (no paths, no contents), the first line of each command it ran with passed or failed, Claude's closing question, the names of this session's slash commands, your top three suggestion kinds, and Claude Code's own guess when there is one. Anything that looks like a secret (AWS, GitHub, Anthropic, OpenAI, Stripe, Slack and Google keys, JWTs, private key blocks, `password=` style assignments, bearer tokens, passwords in URLs) is replaced with `[REDACTED]` first.
- **Reads:** the session's transcript in memory, the slash command list, the `/config` rows (to see whether Claude Code's own suggestion is on), the subagent list, and two environment variables (`ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`) used only if the `haiku` alias is refused. No files, no processes, no network.
- **Writes:** your prompt box (only when you press an item), your clipboard (desktop fallback), and the plugin's own store: an on/off flag, today's call count and token totals, and per project (keyed by a hash of the project path) counts of the kinds of suggestion you took, edited or ignored. Never your prompts or the suggestions themselves.
- **Sends a prompt** only when you press Send in the desktop fallback. It goes in as your own words (`asUser`); the transcript still records that Crossroads submitted it.

## Limits

- The model's reply must be strict JSON followed by an `END` line. A reply that is cut off or malformed shows nothing rather than half a list.
- Claude Code's own guess only exists in the terminal, and only when its prompt suggestions are on. Crossroads waits up to 4 seconds for it, then writes all three itself. A safe guess that arrives later becomes option 1 (the last suggestion drops off), so the ghost text and option 1 still agree.
- Button labels keep the surface's own button style (the API gives buttons no colour), so the risk note beside a risky item is what is amber.
- Back-off: after 3 lists in a row are ignored or dismissed, a list comes every 2nd, then 4th, then 8th eligible turn, until you take or edit one.
- Numbered-option detection is a heuristic. A reply ending in a short numbered list of steps may also turn the digit keys off for that turn (the items stay clickable).
- If the `haiku` alias is refused and no provider model id is set in the environment, Crossroads says so once and makes no calls for the rest of the session.
- On the desktop app the copy may not reach your clipboard: this release of the mods API says remote surfaces have no clipboard path yet. The band then says it could not copy and shows the suggestion, and Send still works.
- The VS Code and mobile surfaces do not draw the band above the prompt, so Crossroads shows nothing there.

## Built from a prompt

This mod was built from [prompts/crossroads.md](../../prompts/crossroads.md).
