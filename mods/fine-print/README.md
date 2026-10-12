<img src="../../brand/pixel-icons/svg/fine-print.svg" width="64" height="64" alt="">

# Fine Print

A second reader that flags what you would miss in a wall of text.

After a long reply, a small, cheap model reads it with a summary of the tool calls behind it. If there is something you must know (a hidden cost, a security or privacy risk, data loss, an action that cannot be undone, an effect on customers, or an assumption made without asking), a short note appears above your prompt. Otherwise it stays silent.

## Install

```
/plugin install fine-print --marketplace modmyclaude/claude-code-mods
```

## Use it

There is nothing to run. After any reply over 150 words, Fine Print checks it in the background, after the turn has ended.

When it finds something, a band appears above the prompt:

- a bold one-line headline and up to 4 bullets
- **Got it** (`g`): you read it; the band closes
- **Explain more** (click it, or Tab to it and Enter; it has no letter key, so a stray keystroke never sends a message): sends a follow-up question into the chat, so Claude explains the note in plain words. The question is sent as the Fine Print plugin's message, not as yours: the transcript and the model both see that the plugin wrote it, at your press. Claude's answer to it is not checked again.
- **Dismiss** (`d`): closes the band without marking it read

The letter keys (`g`, `d`) work once the band has focus (a click, or ctrl+x tab). A newer note replaces the one on screen; the band then says how many older notes are still open.

`/fineprint` opens a pane (also while Claude is working; Esc closes it) listing every note flagged this session, newest first, with what you did with it (open, got it, dismissed, asked to explain), how long ago, its topics, and how many checks were used.

## Settings

Every setting has a default, so the notice at install about options not yet set is expected. Change them in `/config` (or on the install screen).

| Setting | Default | What it does |
| --- | --- | --- |
| `watchFor` | `cost, security, data-loss, irreversible, customers, assumptions` | The topics to flag. A list; `all` means every topic, `none` turns checks off. Names that match no topic are ignored, and if none are left every topic is watched, so a typo never switches the reader off. |
| `maxChecksPerSession` | `30` | The spend cap: model checks allowed per session (0 to 1000). When it is reached, checks stop and the status line says so once. `0` turns checks off. |

## What it can touch

- **Model calls:** one completion on the `haiku` model per reply over 150 words, at low effort, with at most 1,024 output tokens and a 30 second time limit, and never more than `maxChecksPerSession` per session. It goes through your session's own client and provider. A failed call counts toward the cap. Nothing is spent in a run where nothing draws (`claude -p`).
- **What is sent:** the reply as written (whole up to 12,000 characters, beyond that its first 8,000 and last 4,000), including anything it quotes, and up to 40 lines naming this turn's tool calls and their targets: the first line of each command (up to 160 characters), a file or notebook path, a URL, a search pattern or query, a skill name, a subagent type, a tool call's description, and, for messaging tools, the recipient, the subject and the channel name (the `to`, `subject` and `channel` inputs). Nothing else from a tool's input. Before they are sent, secret-shaped strings in those commands and targets (bearer tokens, `PASSWORD=` or `api_key=` values, common API key formats, long hex or base64 strings) are replaced with `[hidden]`; this is best effort, and the reply itself is not masked. All of it is already in your conversation with the same provider. Never tool output, written file contents or edit text.
- **Reads:** the session transcript, through Claude Code, to find this turn's tool calls. No files, no processes, no network of its own.
- **Writes:** nothing on disk. Notes and the check count live in the session and end with it.
- **Explain more** starts one turn of your main model, at its normal cost, and only when you press it.
- `/fineprint` shows its list in a pane, not in the conversation, so the model never reads it. Where no surface can show a pane, the list is a transcript line, which the model does not read either.

## Limits

- A small model's judgment: it can miss things and can flag noise. It is a second reader, not a guarantee.
- Only main-conversation replies that finished normally are checked: not subagents, not interrupted or failed turns.
- "This turn's tool calls" are the calls since your last prompt. A row Claude Code adds that looks like a prompt can shorten that list.
- The band draws in the terminal and the desktop app. In other surfaces (VS Code, mobile) a note arrives as a toast instead, and `/fineprint` has the details.
- The note appears a few seconds after the turn ends, while the small model reads.
- If the model cannot be reached (for example, an organization policy blocks `haiku`), Fine Print shows one toast per session and otherwise stays quiet.
- The status line about the cap stays up for the rest of the session, unless you raise the cap or run `/clear`.
- `/clear` starts fresh: the notes, the band and the check count are reset with the conversation.
- Only the final message of a turn is read. A caveat in an earlier message of the same turn, followed by a short closing summary, is not seen.

## Built from a prompt

This mod was built from [prompts/fine-print.md](../../prompts/fine-print.md).

More mods: [the full catalogue](../../README.md#the-mods).
