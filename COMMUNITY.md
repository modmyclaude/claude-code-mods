# Community mods

Mods for Claude Code made by other people, listed here once they pass our checks. They are not ours: we did not build them and we do not maintain them. Each entry links to the author's repository at the exact commit we checked.

Two marks keep this clear everywhere we show mods: **Built by modmyclaude** (our own mods, tested as [CONTRIBUTING.md](CONTRIBUTING.md) describes) and **Community, checked by modmyclaude** (someone else's mod, checked as described below).

Scope: mods, meaning plugins with a hooks module that Claude Code's validator can read. Status-line commands, classic-hook plugins and installers are out of scope for now.

The list is also machine-readable: [community/mods.json](community/mods.json).

## The list

<!-- community:start -->
| Mod | What it does | What it can reach | Status |
|---|---|---|---|
| [**Context Bar**](https://github.com/hamzafer/claude-code-mods/tree/afdf834da210b082bb6446a03315df3d4ca28018/mods/context-bar)<br>by [hamzafer](https://github.com/hamzafer) | One bar above the prompt, split by what fills the context window. | reads env; reads files (the session transcript); draws a band | candidate, 2026-10-23 on Claude Code 2.1.309, tests 23 of 23 |
| [**Image View**](https://github.com/jarrodwatts/claude-image-view/tree/370b8e7bc0708bebe9762e63534f7ca18bc3e802)<br>by [jarrodwatts](https://github.com/jarrodwatts) | Thumbnails of pasted images above the prompt, made on your machine. | reads env and files; runs programs (sips, id); reads the prompt; writes one thumbnail file | candidate, 2026-10-23 on Claude Code 2.1.309, tests 19 of 19 |
| [**Filetree**](https://github.com/data-goblin/claude-code-filetree/tree/2489b4e4e7ffc3f5fac39aff108071380cae1f09)<br>by [data-goblin](https://github.com/data-goblin) | An IDE-style file tree pane with git status, Quick Look and open-in-editor. The README does not yet name osascript, which it uses to bring Quick Look forward. | runs programs (git, gh, find, du, tmux, herdr, qlmanage, osascript); writes and removes temp marker files; sees every tool call and prompt | candidate, 2026-10-23 on Claude Code 2.1.309, tests 93 of 93 |
| [**Flightdeck**](https://github.com/scasella/claude-flightdeck/tree/6150b9f40b0a36e42c22d39f03ddb81aaefe1844)<br>by [scasella](https://github.com/scasella) | An agent dashboard pane: tool calls, subagents and compaction as they happen. | state and drawing only; sees tool calls, subagents and compaction | candidate, 2026-10-23 on Claude Code 2.1.309, tests 28 of 28 |
| [**HAL Grammar Check**](https://github.com/vinta/hal-9000/tree/a7d05e966e7c5eaa13bf520cabc9a6bbe47f7436/plugins/hal-grammar-check)<br>by [vinta](https://github.com/vinta) | A grammar check of your prompt as you type, through Claude Haiku on your own account or a local Ollama. Tests are thin: two. | model calls (Claude Haiku on your account, or a local Ollama); runs curl to the local Ollama; sees your prompt as you type | candidate, 2026-10-23 on Claude Code 2.1.309, tests 2 of 2 |
| [**Prismantis**](https://github.com/NahumLitvin/prismantis/tree/86492531383be01074ac066b2e3c9734e6837918)<br>by [NahumLitvin](https://github.com/NahumLitvin) | Themeable rendering of Claude's replies, with optional LaTeX and a clipboard helper. | changes its own settings; reads env, files and the transcript; runs programs (RaTeX, clipboard helper) when you ask; sees tool calls and prompts | candidate, 2026-10-23 on Claude Code 2.1.309, tests 877 of 877 |
| [**After**](https://github.com/midudev/after-for-claude-code/tree/57aa28511c8d66b68d26460985c5ef5996902600/plugins/after)<br>by [midudev](https://github.com/midudev) | A prompt queue: the next task goes in when a turn ends; plain-language edits to the queue are read by Haiku. | model calls (Haiku); submits prompts for you; stores the queue | candidate, 2026-10-23 on Claude Code 2.1.309, tests 20 of 20 |
| [**Token Meter**](https://github.com/midudev/after-for-claude-code/tree/57aa28511c8d66b68d26460985c5ef5996902600/plugins/token-meter)<br>by [midudev](https://github.com/midudev) | A token meter in the prompt hint. | state and drawing only | candidate, 2026-10-23 on Claude Code 2.1.309, tests 4 of 4 |
| [**Think Hard**](https://github.com/midudev/after-for-claude-code/tree/57aa28511c8d66b68d26460985c5ef5996902600/plugins/think-hard)<br>by [midudev](https://github.com/midudev) | Start a prompt with + and that turn runs at max effort; the + is removed first. Max effort uses more of your limits. | rewrites the prompt (drops the +); sets max effort for that turn | candidate, 2026-10-23 on Claude Code 2.1.309, tests 3 of 3 |
| [**Prayer Times**](https://github.com/hamzafer/claude-code-mods/tree/afdf834da210b082bb6446a03315df3d4ca28018/mods/prayer-times)<br>by [hamzafer](https://github.com/hamzafer) | Prayer times for the coordinates you set, computed on your computer. One test assumes a London clock and fails in other time zones; the mod itself is fine. | reads env and files (the band order file); draws a band; no network, no programs | candidate, 2026-10-26 on Claude Code 2.1.310, tests 18 of 19 |
| [**Open Paths**](https://github.com/kiankhooban/open-paths/tree/dad28e23010500d228a70ad1e048e0888d402a17)<br>by [kiankhooban](https://github.com/kiankhooban) | Clickable file paths in replies that open in your editor or default app. Opening an .html or .svg runs its scripts in your browser, as the README warns. | runs programs (uname, open or xdg-open, your editor) on a click; reads file metadata; stores up to 500 paths; sees Read, Write and Edit tool calls; redraws reply rows | candidate, 2026-10-26 on Claude Code 2.1.310, tests 76 of 76 |
| [**Mdview**](https://github.com/xuanji86/claude-mdview/tree/d3050cd6046470e644106d0811ea247b3d2fde22)<br>by [xuanji86](https://github.com/xuanji86) | Renders Markdown files named in the conversation in a pane, with an edit bar. | reads env and files; runs sips, open and rm (its own temp file); submits a prompt when you press Enter in its edit bar; changes its own settings; adds a show tool for Claude; sees every tool call; redraws reply rows; opens a pane | candidate, 2026-10-26 on Claude Code 2.1.310, tests 38 of 38 |
| [**Now Playing**](https://github.com/hamzafer/claude-code-mods/tree/afdf834da210b082bb6446a03315df3d4ca28018/mods/now-playing)<br>by [hamzafer](https://github.com/hamzafer) | What Spotify is playing, in a band, with lyrics from LRCLIB that you can switch off. macOS only. | network (lrclib.net only); runs uname, pgrep and osascript; reads env and files; draws a band | candidate, 2026-10-26 on Claude Code 2.1.310, tests 9 of 9 |
| [**GFM Render**](https://github.com/briangtn/claude-gfm-render/tree/a209ad5a0ec35c0813d2d80ab62b596140b0c807)<br>by [briangtn](https://github.com/briangtn) | GitHub-flavoured Markdown in replies: alerts, task lists and diagrams. Vendors beautiful-mermaid and elkjs (EPL-2.0) with their licence files. | adds a short formatting note to Claude's context at startup (switchable off); runs node for diagrams on the desktop; draws over reply rows | candidate, 2026-10-26 on Claude Code 2.1.310, tests 11 of 11 |
| [**Glance**](https://github.com/hamzafer/claude-code-mods/tree/afdf834da210b082bb6446a03315df3d4ca28018/mods/glance)<br>by [hamzafer](https://github.com/hamzafer) | A band of what needs you across GitHub, Google Calendar, Linear and Slack, refreshed every 5 minutes. | runs gh api; calls the claude.ai Google Calendar, Linear and Slack connectors; reads env and files; polls every 5 minutes; draws a band | candidate, 2026-10-26 on Claude Code 2.1.310, tests 18 of 18 |

15 mods, list updated 2026-10-26.
<!-- community:end -->

Status **candidate** means every recorded check passed except the install check on a real terminal and desktop app, which is still to run. Status **checked** means all six passed on the date shown.

## What "checked" means

A listed mod passed these six checks on the date shown, on the Claude Code version shown, at the commit shown. A new revision of a listed mod is unchecked until we run the checks again.

1. **It says what it can touch.** The README states plainly what the mod reaches: files, programs it runs, network hosts, model calls, your prompts or transcript, settings. Where it touches none of these it says so; silence does not count. We compare that statement with Claude Code's own validator report of the mod's hooks and calls. Anything the validator sees that the README does not say fails the check.
2. **No undeclared network or model calls.** Every host the mod reaches is named, with what is sent, and install or update traffic is told apart from what runs while you work, defaults from options. Every model call says what it sends and roughly what it costs. A call through a connector still reaches that service, even when it uses no model tokens, and counts. A mod that sends your prompts, code or project name anywhere must say so on the first screen of its README.
3. **No secret-shaped strings.** The source carries no API keys, tokens or passwords, and no shared key for a third-party service. A mod that needs a key takes it from the person, in a secret settings field, and never prints it.
4. **Tests present and passing.** The repository has tests that run with `claude plugin test` on the current Claude Code, and they pass.
5. **Installs on the current Claude Code, and removes cleanly.** We install it the way its README says, in a fresh config, on the terminal and in the desktop app. It loads, and its command or drawing works. Removing it leaves nothing behind and nothing running.
6. **A licence that allows linking and use.** An open-source licence file in the repository (MIT, Apache-2.0, BSD, Unlicense or similar). No licence, or custom terms, does not qualify. A vendored library under another open-source licence is fine when its notice is kept.

Also required: pushed within the last 90 days, not a copy of another listed mod or of Anthropic's samples, and a one-line description that matches what the mod does.

### How we check

In a sealed environment: a pinned, read-only copy, the validator and the tests run with no network and no access to the machine, and the install check in a throwaway config. The record names the commit, the date, the Claude Code version and what could not be exercised.

### What the check is not

- **Not a security audit.** We read the validator's report and the README; we do not review every line. Plugins run with your permissions, so take the same care as with any plugin.
- **Not an endorsement, and not an endorsement by Anthropic.** Listing says the six checks passed on a date, at a commit. It says nothing about quality, upkeep or support.
- **Not permanent.** We re-check listed mods monthly and after any Claude Code release that changes the plugin API. A mod that fails a check is delisted until it passes again.

## Submit a mod

Open a [Submit a community mod](https://github.com/modmyclaude/claude-code-mods/issues/new?template=submit-community-mod.yml) issue with the repository link, the mod's name, its one-line description and its "what it can touch" paragraph. We run the six checks and answer on the issue. A listed mod's author can ask for removal at any time.

Before you submit, make sure a reviewer can tick every line:

- **Say what it does.** The README starts with one plain sentence on what changes in Claude Code, names the surfaces (terminal, desktop app) and versions it supports, and gives install and removal steps.
- **Show its full reach.** What it reads, writes, runs and changes in prompts or tool calls. For network and model calls: the destination, what is sent, when, why and what it may cost, with install or update traffic apart from runtime traffic and defaults apart from options. Write "none" where that is true; silence does not count.
- **Match the disclosure.** What the mod does must match the README. An undeclared network or model call fails review. An optional call needs a clear choice from the person before it runs.
- **Keep secrets out.** No real secrets or secret-shaped strings in source, tests, examples or shipped files; placeholders must be unmistakably fake.
- **Have tests that pass.** `claude plugin test` runs them on the current Claude Code, and they pass on the submitted commit.
- **Install and remove cleanly.** The submitted commit loads on the current Claude Code release on every claimed surface, and removing it leaves nothing behind. A terminal pass does not establish desktop support.
- **Make the licence clear.** A readable open-source licence file; a vendored library keeps its own notice. An unresolved licence stays on hold.
- **State the limits honestly.** Say what the mod does not handle. We quote that on the listing.

## Automated checks

`node scripts/community-list.mjs` validates `community/mods.json` and renders the table above from it. With `--check` it fails when the table is out of date, and with `--repos` it asks GitHub whether every listed repository still exists, is not archived, carries a licence GitHub can read, and still holds the checked commit. CI runs both on every push and once a day.

---

Not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC.
