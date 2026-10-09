---
mod: porthole
title: Porthole
tagline: A live preview of the app you are building, right beside the chat.
category: workflow
surfaces: [terminal]
model_calls: none
---

# Porthole

A live preview of the app you are building, right beside the chat.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "porthole": a live preview of the app I am building, drawn beside the chat in my terminal.

What it does
- /porthole <url> opens a side pane with a screenshot of the page, sized to the pane. /porthole with no URL uses the last dev-server address it saw.
- Dev-server detection: when Claude's Bash output contains a local address (localhost or 127.0.0.1 with a port), offer "Open in porthole" as a toast.
- After Claude edits a file, refresh the preview automatically, at most once every 2 seconds.
- /porthole mobile and /porthole desktop switch the viewport (390px or 1280px wide).

How it works
- Screenshots come from the Chrome or Chromium already installed, run headless through a process call. No extra installs, no background server.
- Draw the screenshot with the terminal's image support (kitty graphics: kitty, Ghostty, iTerm2, WezTerm). If the terminal cannot show images, say so once and suggest the desktop app's browser instead.

Guardrails
- Only opens localhost or 127.0.0.1 unless I pass a full URL myself. Always a fresh, throwaway browser profile: no cookies, no logged-in accounts.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
