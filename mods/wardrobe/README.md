# Wardrobe

Restyle Claude Code live, including colourblind-safe and high-contrast themes.

## Install

```
/plugin install wardrobe --marketplace modmyclaude/claude-code-mods
```

## Use it

| Command | What it does |
| --- | --- |
| `/wear` | Lists every theme with a one-line preview in its own colours (tool icons, an added and a removed diff chip) and marks the one you wear. |
| `/wear <theme>` | Switches now. Rows still live on screen redraw in the new look. |
| `/wear auto` | A day theme by day and a night theme by night (see Settings). |
| `/wear pin` | This project keeps what it wears now; other projects keep the global choice. While pinned, `/wear <theme>` changes this project's pin. |
| `/wear unpin` | This project follows the global choice again. |
| `/wear default` | Back to Claude Code's own drawing. |

Themes: `noir`, `paper` (light), `tokyo-night`, `dracula`, `catppuccin`, `solarized`, `nord`, `high-contrast`, `colorblind`. Short forms work too: `drac`, `hc`, `colourblind`, `tokyo night`.

What changes, on the terminal and in the desktop app:

| Where | What wardrobe draws |
| --- | --- |
| Tool rows | The theme's icon for the kind of tool (shell, read, edit, write, search, web, agent, todo, MCP), Claude Code's own row, then a status glyph and, for a finished call, the time since Claude asked for it (any wait for your approval included). |
| Folded tool groups | One icon per call before the count line; a failed call in the error colour. |
| Diff cards (Edit, Write) | Numbered lines in the theme's add and remove colours, with a `+N -N` summary. |
| Small shell output | A themed card; stderr lines are marked `!`, not only coloured. |
| Spinner | The theme's suffix after the word (never over Claude Code's own status message); on a terminal 60 columns or wider, a chip saying what the turn is doing (thinking, writing, using tools). |
| Turn duration | A themed `Baked for 3s` line (the terminal draws this line; the desktop has its own footer). |

### Accessibility

- `high-contrast`: every colour pair wardrobe paints is at least 7:1 (WCAG AAA).
- `colorblind`: added lines are blue and removed lines orange, never red and green; tool icons differ by shape (triangle, disc, diamond, square, cross, bars).
- Every other theme: at least 4.5:1 (WCAG AA). `tests/themes.test.ts` checks every pair of every theme.
- Every theme gives each tool kind and each status its own glyph, so colour is never the only cue.
- Every coloured span is painted on the theme's own background, so the contrast holds whatever your terminal's background is.

## Settings

Set these in `/config`. A time wardrobe cannot read falls back to its default, and `/wear` names it.

| Setting | Default | Meaning |
| --- | --- | --- |
| `dayTheme` | `paper` | What `/wear auto` wears by day. |
| `nightTheme` | `tokyo-night` | What `/wear auto` wears by night. |
| `dayStarts` | `07:00` | When the day starts, 24-hour local time. |
| `nightStarts` | `19:00` | When the night starts. A day that crosses midnight (`20:00` to `06:00`) works. |

## What it can touch

- Its own store: the global choice and the per-project pins, keyed by the path of the folder the session started in.
- For the session, in memory: each tool call's start and end time, for its row.
- Reads the project root, the attached surfaces and the clock.
- No files, no processes, no network, no model calls. It never refuses or changes a tool call: its tool hook only notes when a call starts and ends.

## Limits

- It restyles what Claude Code lets a mod draw. What Claude Code still draws itself (the tool's own row inside wardrobe's icon and status, Read and Grep results, the prompt, dialogs) keeps the colours of Claude Code's own `/theme`; pick a matching one there for the same reading everywhere.
- Tool rows wrap Claude Code's own row instead of replacing it, so expanding a row and its output keep working.
- Claude Code draws these itself: errors, diffs over 120 lines or 8,000 characters, binary diffs, edits held for review, and shell output over 8 lines or holding a control character other than a colour code (a progress bar's carriage return, a bell, NUL).
- Untrusted text it draws (paths, diff lines, shell output, settings) is cleaned first: colour codes are dropped and any other control character shows as U+FFFD, since Claude Code refuses a drawing that holds one.
- Where another mod draws its own tool result or turn line, wardrobe steps aside and that drawing stands. Tool rows, tool groups and the spinner wrap whatever is beneath them.
- A pin belongs to the folder the session started in: a subfolder or a worktree of the same repo is pinned separately.
- On the terminal's main screen, rows already printed keep their look; new rows, and everything in the fullscreen view, follow `/wear`.
- VS Code and the mobile app are not restyled; `/wear` says so when one is attached.
- Auto mode checks the clock once a minute, so a switch can land up to a minute late. A choice made in another session reaches this one the same way.
- Tool calls made before wardrobe loaded show no time, and a refused or failed call shows its status but no time.
- Not verified: the paint itself in a real terminal and in the desktop app. The tests check the drawn trees against each surface's rules, not pixels.

## Built from a prompt

This mod was built from [prompts/wardrobe.md](../../prompts/wardrobe.md).
