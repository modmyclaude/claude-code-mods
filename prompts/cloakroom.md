---
mod: cloakroom
title: Cloakroom
tagline: Check your secrets at the door. Claude gets a ticket; the real value only comes back where you allow it.
category: safety
surfaces: [terminal, desktop]
model_calls: none
---

# Cloakroom

Check your secrets at the door. Claude gets a ticket; the real value only comes back where you allow it.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "cloakroom" that keeps my secrets (API keys, tokens, passwords, private keys) out of what Claude reads and out of my saved transcripts, while still letting local tools use the real values.

How it works
- When a secret would reach Claude (a tool result such as `cat .env`, a pasted prompt, an @-mentioned file, project instructions, any row added to the conversation), swap it for a ticket like [secret:STRIPE_SECRET_KEY#1]. Tickets are random per session: they must not be derivable from the value, and the same value gets the same ticket within a session.
- Keep the ticket-to-value map in memory only. Never write real values to disk, settings or the mod's store.
- At session start, learn the values of secret-named variables in the project's .env files (e.g. .env, .env.local; names containing KEY, TOKEN, SECRET, PASSWORD, PASS, PWD, CREDENTIAL, DSN, PRIVATE), so even short or unusual passwords are caught.
- Once a value is known, hide it everywhere it appears later, exactly, including its base64, URL-encoded and JSON-escaped forms. This catches `echo` and `printenv` repeats that pattern matching misses.

Detection
- Known vendor key formats (AWS access keys and secret keys including ones that contain "/", GitHub, Anthropic, OpenAI, Stripe, Slack, Google, Twilio, Resend, SendGrid and similar), private key blocks, JWTs, Bearer and Basic auth headers, passwords inside connection URLs (including redis://:pw@), and long high-entropy strings next to a secret-like name.
- Do NOT hide: git SHAs, UUIDs, lockfile integrity hashes, git@host remotes, image names like logo@2x.png, version numbers, MAC addresses. Ship a test corpus of things to hide and things to keep.
- All patterns must run in linear time so hostile text cannot stall a check.

Where real values come back (the most important rule)
- Tickets turn back into real values only inside local tools: Write, Edit, NotebookEdit, and Bash when the command is proven local. Never in web fetches, MCP tools, subagent prompts, messages to other sessions or questions shown to me.
- A Bash command gets the real value only for a positive reason: every program on the line is on a short local-only list of text and file tools (echo, printf, cat, tee, cp, mkdir, grep and kin; heredoc bodies are data), and nothing on the line points at the network. Anything else is held with a red band and Allow once / Deny buttons, Deny focused: a network program (curl, wget, nc, ssh, scp, git push, bash's /dev/tcp, a remote URL beside the value) shows "held: STRIPE_SECRET_KEY#1 was about to leave via curl to paste.example"; a wrapper, interpreter, runner, script or variable as the program (sh -c, eval, node, python, npm, make, find, xargs to a shell) shows "held: STRIPE_SECRET_KEY#1 is in a command cloakroom cannot vouch for: sh is not on its local-only list". Never pass a command because no threat was recognised in it. Allow once lets that exact command run one time.
- If a tool input contains a ticket the mod no longer knows (for example after a restart), refuse the call with a clear message instead of writing the literal ticket into a file.
- Add one short line to Claude's instructions: hidden values appear as [secret:...] tickets; prefer referencing environment variables such as $STRIPE_SECRET_KEY in commands instead of literal values.

Fail closed
- If redaction throws or runs out of time, withhold the result and say so. Never let unscanned text through.
- Always hand back a fresh result object so the redacted text is what Claude actually reads.

Commands
- /cloakroom lists this session's tickets: name, kind, where it came from, how often used. Never the value.
- /cloakroom show <ticket> displays the value to me only (never to Claude). /cloakroom forget <ticket>.
- /cloakroom audit scans my past Claude Code transcripts on this machine (read-only) for keys that were already exposed, and lists which ones to rotate, by kind and date, without printing the full values. The list is drawn in a pane on my screen, never in the command's output, which Claude reads.

Be honest in the README
- Lead with what it can and cannot do. It CAN keep secrets out of the model request, transcripts, screen shares and exports at every door it hooks, and hold commands that would carry a known secret off the machine. It CANNOT stop a malicious mod installed alongside it, settings hooks, a command like `printenv | curl` whose value never enters the conversation (it can only hold the command if it sees it), images, or exposure that already happened. Never claim it "prevents exfiltration".
- Permission dialogs may show a restored value in a Bash command; say so, and that preferring $VAR references avoids it.

Guardrails
- No network, no processes, no model calls. File reads only for .env files at start, @-mentions it scrubs, and transcripts during /cloakroom audit.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
