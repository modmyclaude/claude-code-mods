---
mod: pager
title: Pager
tagline: Plays a sound when Claude finishes, needs you or hits an error.
category: alerts
surfaces: [terminal, desktop]
model_calls: none
---

# Pager

Plays a sound when Claude finishes, needs you or hits an error.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "pager" that tells me with sound when Claude needs my attention, so I can look away while it works.

What it does
- Three events, three sounds: done (a turn finished), needs you (Claude is waiting on a permission or a question for me) and error (a turn ended on a failure).
- A toast with the session name accompanies each sound.
- Only page me when it matters: skip the done sound for turns shorter than a minDuration setting (default 20 seconds), so quick back-and-forth stays quiet.

Sounds
- Ship three original sound packs, synthesized by you as small audio files (no samples from games, films or other products): "classic" (soft bell tones), "arcade" (8-bit blips) and "zen" (gentle chimes). /pager pack <name> switches; /pager test plays all three sounds of the current pack.
- Add two spoken packs, "butler" and "coach", each with one short original line for done, needs you and error, in a generated voice, under two seconds, at the same loudness as the other packs. They switch with the same /pager pack command and obey every existing rule: one sound per event, the gap between sounds, mute and quiet hours.
- /pager mute <duration> (e.g. /pager mute 30m) and /pager unmute. Respect a quietHours setting (e.g. "22:00-07:00").

Optional phone push
- If and only if I set an ntfyTopic setting, also send the same alert to that ntfy.sh topic with a single HTTPS POST (title + short text, never conversation content). Off by default. Document this as the only network call.

Guardrails
- No model calls. No files outside the mod. Never more than one sound per event, and at most one sound every 5 seconds.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
