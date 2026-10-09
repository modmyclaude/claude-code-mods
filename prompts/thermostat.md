---
mod: thermostat
title: Thermostat
tagline: Shows when your prompt cache goes cold, and stops the expensive send.
category: cost
surfaces: [terminal, desktop]
model_calls: keep-warm pings only when you turn them on
---

# Thermostat

Shows when your prompt cache goes cold, and stops the expensive send.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "thermostat" that prevents cold-cache surprises.

Background: Claude Code keeps the conversation in a prompt cache that goes cold after a stretch of inactivity (about an hour on a subscription, 5 minutes by default on an API key). The first message after that re-reads the whole conversation at full price.

What it does
- The status line shows the cache temperature, e.g. "cache warm · 41m left", amber under 10 minutes and "cold" once it has expired.
- When I submit a prompt while the cache is cold, hold it once and show the estimate: tokens to re-read and the cost of this send cold vs warm. Sending again confirms; /clear starts fresh.
- /warm <duration> (e.g. /warm 90m) keeps the cache warm while I am away with a tiny ping just before it would go cold. /warm off stops it.

What is new here
- Smart keep-warm: before each ping, compare the cost of the remaining pings with the cost of one cold re-read. If pinging would cost more, stop and say so.
- A guard setting: hold (default), warn (show the estimate, do not hold) or off.
- /thermostat shows a session receipt: cold sends paid, pings sent, estimated money saved.
- Work out the cache window from the session model and auth type, overridable in settings.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
