# Cloakroom

Check your secrets at the door. Claude gets a ticket; the real value only comes back where you allow it.

## What it can and cannot do

Read this first. Cloakroom lowers the chance that a secret ends up somewhere it should not. It does not make that impossible, and it never claims to prevent exfiltration.

**It CAN:**

- Keep secrets out of the model request, the saved transcript, screen shares and exports, at every door it hooks: tool results (every tool, MCP included), your prompt and pastes, `@`-mentioned files, CLAUDE.md and the first message's context, the system prompt's sections, reminders and settings-hook output, skill text, every row the conversation stores, messages to and from other agents and sessions, and records sent to your own OpenTelemetry collector. A secret becomes a ticket such as `[secret:STRIPE_SECRET_KEY#k3x9qa]`.
- Learn the secret-named values in your project's `.env` files when the session starts, then hide them wherever they show up later, including their base64, URL-encoded and JSON-escaped forms. That catches an `echo` or `printenv` that no pattern would.
- Turn tickets back into real values only inside Write, Edit, NotebookEdit and Bash, so Claude can still write your `.env` or run your script. Web fetches, MCP tools, subagent prompts, messages to other sessions and questions shown to you keep the ticket.
- Hold a Bash command that would carry a known secret off the machine (curl, wget, nc, ssh, scp, rsync to a remote, git push, bash's /dev/tcp, or any remote URL beside the value) until you press **Allow once**.
- Find secrets already written into your past Claude Code transcripts (`/cloakroom audit`), so you know what to rotate.

**It CANNOT:**

- Stop a malicious mod installed beside it. A mod whose hooks run before cloakroom's sees values before they are hidden; one whose tool hooks run after it sees restored values.
- See into your settings hooks (`hooks` in settings.json). They receive tool inputs and outputs on their own path.
- Stop a secret that never enters the conversation. `printenv | curl ...`, a `$STRIPE_SECRET_KEY` reference, or a script that reads `.env` itself all pass: cloakroom only holds a command when it can see the value in it.
- Read images, PDFs or other media. A key in a screenshot reaches Claude.
- Undo exposure that already happened. Rotate anything `/cloakroom audit` finds.
- Keep a restored value off your screen when Claude Code asks permission. The permission dialog shows a Bash command or file content after the ticket was swapped back. In auto mode, the permission classifier reads it too, and that is a model request. Writing `$STRIPE_SECRET_KEY` in commands instead of the value avoids both. Cloakroom tells Claude to prefer that.
- Remember anything across a restart. Tickets live in the mod's memory only, so a ticket from before a restart or reload is refused in tools rather than written as text. Paste the value again, or use its environment variable.

What the validator sees it reach (`claude plugin validate --strict`):

```
hooks: session.start, tool.call, prompt.submit, prompt.mention, prompt.attachment, prompt.context, prompt.compose, skill.prompt, session.append, session.send, session.receive, telemetry.log{to=collector}, ui.render{component=AbovePrompt}, command.run{command=cloakroom}
answers its own command: command.run{command=cloakroom}
gating hook with .catch: tool.call, prompt.submit, prompt.mention, session.append, session.send, session.receive, telemetry.log{to=collector}
calls: $.clock.after (via show), $.clock.now, $.command.register, $.env.get, $.fs.exists, $.fs.list (via listDir), $.fs.read, $.fs.write, $.prompt.submit, $.session.surfaces (via show), $.ui.invalidate (via redraw, rescanCached), $.ui.resolve, $.ui.toast
env writes: nothing
env reads: CLAUDE_CONFIG_DIR, HOME, TEMP, TMP, TMPDIR, USERPROFILE
hooks telemetry for: collector
```

## Install

```
/plugin install cloakroom --marketplace ORG_TBD/REPO_TBD
```

## Use it

There is nothing to turn on. From the next session, a secret that would reach Claude arrives as a ticket instead:

```
STRIPE_SECRET_KEY=[secret:STRIPE_SECRET_KEY#k3x9qa]
```

The same value keeps the same ticket for the whole session. The random part is drawn fresh each session and never computed from the value. When you paste a key into a prompt, a short notice says it was swapped. Claude reads one added line in its instructions: tickets turn back into real values only in Write, Edit, NotebookEdit and Bash, and it should prefer environment variables in commands.

**The red band.** When a Bash command would carry a secret off the machine, Claude is told the call was held, and a band appears above the prompt:

```
held: STRIPE_SECRET_KEY#k3x9qa was about to leave via curl to paste.example
Claude was told to wait. Allow once lets this exact command run one time.
[ Deny ]  [ Allow once ]
```

The band never takes the keyboard by itself. Click it, or press ctrl+x tab, and the focus starts on **Deny** (`d` also denies). **Allow once** has no key, so a stray keystroke cannot press it; click it or move to it on purpose. Allow once lets that exact command run one time within 10 minutes and tells Claude it may run it again. Deny leaves it refused. Other mods' bands stay drawn beneath this one.

**Commands:**

- `/cloakroom` lists this session's tickets: the name, the kind, where it was found, and how often it was hidden and restored. It never prints a value.
- `/cloakroom show <ticket>` draws the value in the band above the prompt for 30 seconds, with a Hide button. It goes to your screen only, never into the transcript or to Claude. Control characters in a value show as U+FFFD.
- `/cloakroom forget <ticket>` stops hiding that value for the rest of the session (for a false positive). Its ticket stops working in tools.
- `/cloakroom audit` checks your past transcripts and lists each exposed secret by kind and date, with a preview such as `sk_live_...9f2`. Values under 16 characters show only their length. Run it again to continue past the time budget.

`show`, `forget` and `audit` run only when you type them (in the terminal, the desktop app or Remote Control). Another plugin, a peer session, a channel or a prompt-injected Claude running them is refused. The plain list runs from anywhere.

## Settings

None.

## What it can touch

- **Files read:** your project's `.env` and `.env.*` files at session start, at the root and up to two folder levels down (`apps/web/.env`), skipping `node_modules`, `.git`, build output and hidden folders, at most 120 folders. A file you `@`-mention, so it can be checked first. Your transcripts under `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`), only when you run `/cloakroom audit`, newest first, at most 4 MiB per file and about 6 seconds and 96 MB per run.
- **Files written:** a copy of an `@`-mentioned file that held a secret, with tickets in place of the values, under `$TMPDIR/cloakroom-<id>/`. Claude reads that copy and is told the real path. Nothing else is written: no store, no settings, no plugin state. A real value is never written to disk by cloakroom.
- **Memory:** the ticket-to-value map, in the mod's own memory, gone when the session ends or the mod reloads.
- **Environment:** reads `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE` (to find transcripts) and `TMPDIR`, `TEMP` and `TMP` (for mention copies). Writes none.
- **Prompts sent:** one, only after you press Allow once, telling Claude it may run the held command again.
- **Telemetry:** rewrites records bound for your own OpenTelemetry collector when one is configured. It never touches Anthropic's own analytics.
- **Network, processes, model calls:** none.

## Limits

- Detection is pattern-based: known key formats (AWS, GitHub, Anthropic, OpenAI, Stripe, Slack, Google, Twilio, Resend, SendGrid, Mailgun, npm, PyPI, GitLab, Hugging Face and more), private key blocks, JWTs, Bearer and Basic headers, passwords in connection URLs, and values written next to a secret-like name. A secret in an unknown format with no telling name can be missed. Stripe publishable keys (`pk_`) and documentation examples are left alone on purpose.
- Every pattern runs in linear time. A test feeds 5 MB of text built to stall pattern matchers through a real tool call and holds the check to half a hook's 10-second budget (alone, it measured about 0.6 seconds on a laptop). Text over 16 MB, text whose check overruns 4 seconds, or a value nested too deep to walk is withheld rather than passed on unchecked.
- If a check fails, the text is withheld, not sent. A tool result becomes `[cloakroom: result withheld, redaction failed]`, a prompt is not sent (it says why), an `@`-file is not attached, and a call that could not be checked does not run.
- The band (holds and `show`) draws in the terminal and the desktop app. In VS Code and on mobile there is no band: a held command stays refused (run it yourself), and `show` says it needs one of the other two.
- Some things are written by Claude Code itself, outside the doors cloakroom hooks: a large tool output it saves to its tool-results folder, and its own prompt history (what the up arrow recalls), which may keep a pasted key as you typed it.
- A row may flash on screen, or reach an SDK stream or Remote Control, just before cloakroom rewrites it. Neither the model nor the transcript file reads that form. Tool results are rewritten before they are drawn.
- Context another mod attaches to a tool result cannot be changed at that point (Claude Code requires it word for word). It is scrubbed when it reaches Claude, as an attachment and as a stored row.
- An `@`-mentioned file is read twice, once by cloakroom to check it and once by Claude Code, so a file changed in that instant could slip past the first check. The attachment is still scrubbed when it reaches Claude.
- `show` puts the value in the band. Another mod that draws around the band can read it there.

## Built from a prompt

This mod was built from [`prompts/cloakroom.md`](../../prompts/cloakroom.md).
