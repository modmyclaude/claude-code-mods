# Pager

Plays a sound when Claude finishes, needs you or hits an error.

Look away while Claude works. Pager plays one short sound, with a toast naming the session, when:

- **done** - a turn finished and it ran at least `minDuration` seconds (quick back-and-forth stays quiet),
- **needs you** - Claude is waiting on a permission prompt, a question, a plan approval or an MCP input request,
- **error** - a turn ended on an API error or a refusal.

## Install

```
/plugin install pager --marketplace modmyclaude/claude-code-mods
```

## Use it

| Command | What it does |
|---|---|
| `/pager` | Shows the pack, whether sounds are on, and your settings. |
| `/pager pack <classic\|arcade\|zen>` | Switches the sound pack. `/pager pack` alone lists them. |
| `/pager test` | Plays all three sounds of the current pack, one after another (even while muted). |
| `/pager mute <duration>` | Silences sounds and phone pushes for `30m`, `2h`, `1h30m`, `45s` or `1d` (up to 7 days; a bare number is minutes; no duration means 1 hour). |
| `/pager unmute` | Ends a mute early. |

`/pager` runs at once, even while a turn is running, so you can mute mid-turn.

The three packs, all synthesized for this mod:

- **classic** - soft bell tones
- **arcade** - 8-bit blips
- **zen** - gentle chimes

Guardrails: one sound per event at most, and never more than one sound every 5 seconds. Alerts inside that gap, while muted, or in quiet hours still show their toast; only the sound and the phone push are skipped.

## Settings

Set them in `/config` (or when you enable the plugin).

| Field | Default | Meaning |
|---|---|---|
| `minDuration` | `20` | Seconds a turn must run before its done sound plays. Errors and needs-you always page. |
| `quietHours` | empty (off) | A local time window with no sound or push, such as `22:00-07:00`. It may wrap midnight. |
| `ntfyTopic` | empty (off) | An [ntfy.sh](https://ntfy.sh) topic for phone pushes. Stored as a secret. A pasted `https://ntfy.sh/<topic>` works too. |

The pack and a mute are kept in the plugin's store, so they last across sessions and apply to every session at once.

## What it can touch

- **Sound:** plays its own nine WAV files from `sounds/` through Claude Code's audio player.
- **Files:** reads nothing and writes nothing outside the plugin. The pack and mute end time live in the plugin's own store.
- **Processes:** none of its own (Claude Code runs `afplay` to play a clip on macOS).
- **Network:** only when you set `ntfyTopic`. Each alert that makes a sound also sends one HTTPS POST to `https://ntfy.sh/<topic>` with a fixed title (`Pager: done`, `Pager: needs you`, `Pager: error`) and a short fixed text (for done, the turn's length, such as "A turn finished after 2m 5s."). It never sends your prompts, Claude's answers, the session title or the project name. This is the only network call Pager makes. Anyone who knows an ntfy.sh topic can read it, so pick a long, unguessable one.
- **Model calls:** none.

## How "needs you" is detected

Pager listens for Claude Code's own Notification event and pages on the types that mean a dialog is waiting on you: `permission_prompt`, `worker_permission_prompt`, `elicitation_dialog`, `elicitation_url_dialog` and `agent_needs_input`. Claude Code raises these once a dialog has waited about 6 seconds without a keypress, so a prompt you answer right away makes no sound. `idle_prompt` is left out because it follows a finished turn, which already paged.

## Limits

- **Sound plays on macOS only.** Claude Code plays clips with `afplay`; on Linux and Windows it has no player, so `$.audio.play` is silent there. Toasts and phone pushes still work. `/pager test` says so.
- An interrupted turn (Esc, or a plugin cutting the turn for you) makes no sound: you were there.
- Subagent turns never page on their own; the main turn that ran them does.
- `minDuration` counts the whole turn, including time a permission prompt waited on you.
- Quiet hours use the clock of the machine running Claude Code.
- A hot reload of the plugin forgets the 5 second gap and the session title until the next prompt (at most one early sound, or a toast showing the folder name).
- If ntfy.sh is down or offline, the push is dropped (noted in the debug log); the sound still plays.

## The sounds are original

Every clip is computed from sine and pulse waves by [`tools/synth.py`](tools/synth.py), using only the Python standard library. Regenerate them, byte for byte, with:

```
python3 -I mods/pager/tools/synth.py
```

## Built from a prompt

This mod was built from [`../../prompts/pager.md`](../../prompts/pager.md).
