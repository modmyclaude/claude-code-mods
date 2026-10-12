# Contributing

Thanks for helping. This collection stays small on purpose, so a mod is listed only when it meets every point below.

## The bar

1. **It comes with its prompt.** `prompts/<mod>.md` holds the prompt that builds the mod, with the frontmatter the catalogue reads (`mod`, `title`, `tagline`, `category`, `surfaces`, `model_calls`). The code in `mods/<mod>/` does what that prompt says.
2. **It passes the gate.** `scripts/check.sh mods/<mod>` is green: `claude plugin validate --strict`, strict `tsc`, and `claude plugin test`.
3. **The tests prove the behaviour.** Tests raise the real events (tool calls, prompts, turns, commands), mount any UI on both the `terminal` and `desktop` surfaces, and would fail if the core logic broke.
4. **It is safe by default.** Guards fail closed, model calls are capped and use the smallest model that works, and nothing touches the network, files or processes unless the prompt says why.
5. **It is yours to give.** Your own code, written from your prompt and the public mods API. No copied code, no licensed assets (sounds, characters, trademarked names), no Anthropic logos or mascot art.
6. **Style.** Plain words, no emoji in UI text, no em dashes.

## Propose a mod

Open an issue with the **[Mod idea](https://github.com/modmyclaude/claude-code-mods/issues/new?template=mod-idea.yml)** form first, so we can check it is not already covered and agree on what it may reach.

## Build it

The fastest start is the [Mod Maker](prompts/starters/mod-maker.md) prompt: paste it into Claude Code and describe your mod to get a working, tested first version. Then put it in this layout, with the prompt you used:

```
prompts/<mod>.md                  the prompt, with catalogue frontmatter
mods/<mod>/.claude-plugin/plugin.json
mods/<mod>/hooks/hooks.json       { "modules": ["./register.tsx"] }
mods/<mod>/hooks/register.tsx     the hooks module
mods/<mod>/tests/*.test.ts(x)     behaviour tests, terminal and desktop
mods/<mod>/README.md              install, use, settings, what it can touch, limits
```

Plugin names cannot start with `claude-`.

## Try it locally

Load your folder straight into a session:

```bash
claude --plugin-dir mods/<mod>
```

Or install every mod from your clone, the way users install from GitHub. Sessions then read your folder directly, so `/reload-plugins` picks up each edit:

```bash
claude plugin marketplace add "$PWD"
claude plugin install <mod>@modmyclaude
```

## Check it

You need Node 20+ and Claude Code 2.1.287+.

```bash
npm ci
npm run check -- mods/<mod>    # validate --strict, tsc and tests for one mod (no argument: every mod)
npm run smoke                  # installs every mod into a throwaway config, as a user would
npm run links                  # every relative link and image in the Markdown resolves
npm run catalog                # regenerates marketplace.json, the README catalogue and site/mods.json
```

Set `CLAUDE_BIN` if your `claude` on the PATH is older than 2.1.287.

Never hand-edit `.claude-plugin/marketplace.json`, `site/mods.json` or the README between the catalogue and badge markers: they are generated. Setting `draft: true` in a prompt's frontmatter keeps its mod out of the catalogue while it is in progress.

`tsc` needs the mods API types that Claude Code writes into `<mod>/.claude-plugin/types/` the first time it loads your mod from a folder (for example with `claude --plugin-dir mods/<mod>`). Point `CLAUDE_TYPES` at `.claude-plugin/types/claude-code/index.d.ts` if they live elsewhere.

CI runs all of the above on every pull request, on a pinned Claude Code and on the latest release.

## Versions

A mod reaches installed copies through `/plugin update` only when its version moves. So every change to what a mod ships (its `hooks/`, `types/`, sounds and other assets, or `plugin.json` itself) bumps the `version` in `mods/<mod>/.claude-plugin/plugin.json` and adds one line to [CHANGELOG.md](CHANGELOG.md). A change to a mod's README or tests alone needs no bump, and neither does a draft (`draft: true` in its prompt), which is not in the marketplace yet. CI checks it on every push and pull request; run it yourself with `npm run versions -- origin/main` before pushing.

## Pull requests

One mod per pull request, titled `mod(<name>): <what>`. Fill in the checklist in the template. Each listed mod gets a second maintainer's review against its prompt before it is merged.

By contributing you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md) and to license your work under the [MIT License](LICENSE).
