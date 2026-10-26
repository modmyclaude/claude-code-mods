# Community mods

Mods for Claude Code made by other people, listed here once they pass our checks. They are not ours: we did not build them and we do not maintain them. Each entry links to the author's repository at the exact commit we checked.

Two marks keep this clear everywhere we show mods: **Built by modmyclaude** (our own mods, tested as [CONTRIBUTING.md](CONTRIBUTING.md) describes) and **Community, checked by modmyclaude** (someone else's mod, checked as described below).

Scope: mods, meaning plugins with a hooks module that Claude Code's validator can read. Status-line commands, classic-hook plugins and installers are out of scope for now.

The list is also machine-readable: [community/mods.json](community/mods.json). That file also carries candidates, mods that passed five of the six checks and wait on the install check; a candidate is not listed, marked or endorsed until it passes.

## The list

<!-- community:start -->
No mod has passed all six checks yet.

0 listed, list updated 2026-10-26. 15 more mods are in community/mods.json as candidates: five of the six checks passed, and the install check on a real terminal and desktop app is still to run. A candidate is not listed or marked until it passes.
<!-- community:end -->

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
