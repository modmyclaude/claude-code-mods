# Noted

Turns your corrections into permanent rules, without duplicates.

## Install

```
/plugin install noted --marketplace modmyclaude/claude-code-mods
```

## Use it

Correct Claude the way you normally would: "no, use pnpm", "don't add comments to every line", "we use vitest, not jest", "stop adding emojis", "I told you to use tabs". Your prompt goes through untouched. A moment later a band appears above the prompt with one short, general rule:

```
Noted - save this as a house rule?
Use pnpm, not npm, in this repo.
[ Save to project ] [ Save globally ] [ Edit ] [ Skip ]
```

- **Save to project** appends it to `./CLAUDE.md`, **Save globally** to `~/.claude/CLAUDE.md`, as a list item under a `## House rules` heading (added if missing). Nothing else in the file changes.
- **Edit** turns the rule into a text field. Press Enter to keep your wording, then save.
- **Skip** drops it.
- If the rule is already there (same words, or the same meaning), the band says **already a rule** instead of proposing it again.
- If it contradicts a rule you already have, the band shows the old rule and offers **Replace old rule**, which rewrites that line in place, instead of adding a contradiction.

The band buttons have keys once the band has focus (click it, or ctrl+x tab): `p` project, `g` global, `e` edit, `s` skip, `r` replace, `c` cancel an edit, `o` dismiss a notice, `d` close the `/rules` list.

`/rules` lists the rules noted has learned, with the file and the date each was added, in the transcript and in the band, where each one has a **Remove** button. `/rules remove <number>` removes one by its number, for surfaces without the band. Removing a rule deletes its line from the file.

## Settings

None.

## What it can touch

- **Files read:** `./CLAUDE.md` at the project root and `~/.claude/CLAUDE.md` (or `$CLAUDE_CONFIG_DIR/CLAUDE.md` when that is set), only to find the `## House rules` list. They are read when a correction is detected, when you press a button and when you run `/rules`.
- **Files written:** those two files and nothing else, and only after you press Save, Replace old rule or Remove, or run `/rules remove <number>`. A file that exists but cannot be read is never written.
- **Environment:** `HOME`, `USERPROFILE` and `CLAUDE_CONFIG_DIR`, to find the global file.
- **Transcript:** the last 600 characters of Claude's previous reply, as context for the rule.
- **Model calls:** one per prompt that passes a keyword pre-filter, never for other prompts. It uses the `haiku` alias at low effort and sends the correction (up to 600 characters), that reply tail, and up to 60 existing rules (200 characters each). That is at most about 4,000 input tokens and usually a few hundred. The reply is capped at 600 tokens, room for the model to think first, and the call at 20 seconds. A reply cut short is ignored. The call goes through the session's own client.
- **Store:** noted's own store keeps each saved rule's text, file and date, so `/rules` can show when it was added.
- **Network and processes:** none of its own.

## Limits

- The pre-filter matches English phrasing. Corrections in other languages, and prompts over 800 characters, are not picked up.
- Only prompts you type (terminal, Remote Control, desktop app) are read. Prompts from tools, plugins, peers and schedules are ignored.
- The band draws in the terminal and the desktop app. In VS Code or on mobile, noted says once that corrections there are not captured. `/rules` works everywhere.
- The model call runs after your prompt has entered, alongside Claude's reply, so it never slows the turn. If you interrupt the turn while it runs, that suggestion may be lost.
- If the session cannot use the `haiku` model (some Bedrock, Vertex or gateway setups), noted says so once and proposes nothing.
- "Same meaning" duplicates and conflicts are judged by the model, which sees the first 60 existing rules. Same-words duplicates are caught in every rule, without the model.
- `/rules` lists only rules saved through noted. Rules you write by hand still count for duplicates and conflicts. A rule you delete by hand drops off the list.
- Claude Code reads CLAUDE.md when a session starts, so a saved rule steers Claude from the next session on. The correction you just typed is already in the current conversation.
- A CLAUDE.md that is not valid UTF-8 text is left alone. Line endings are kept. Removing the last rule leaves the heading in place.

## Built from a prompt

This mod was built from [`prompts/noted.md`](../../prompts/noted.md).
