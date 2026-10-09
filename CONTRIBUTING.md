# Contributing

This collection stays small on purpose. A mod is listed only when it meets every point below.

## The bar

1. **It ships its prompt.** `prompts/<mod>.md` holds the prompt that builds the mod, with the frontmatter the catalogue reads (`mod`, `title`, `tagline`, `category`, `surfaces`, `model_calls`). The code in `mods/<mod>/` does what that prompt says.
2. **It passes the gate.** `scripts/check.sh mods/<mod>` is green: `claude plugin validate --strict`, strict `tsc`, and `claude plugin test`.
3. **The tests prove the behaviour.** Tests raise the real events (tool calls, prompts, turns, commands), mount any UI on both the `terminal` and `desktop` surfaces, and would fail if the core logic broke.
4. **It is safe by default.** Guards fail closed, model calls are capped and use the smallest model that works, and nothing touches the network, files or processes unless the prompt says why.
5. **It is yours to give.** Your own code, written from your prompt and the official mods API. No copied code, no licensed assets (sounds, characters, trademarked names), no Anthropic logos or mascot art.
6. **Style.** Plain words, no emoji in UI text, no em dashes.

## Propose a mod

Open an issue with the **Mod idea** form first, so we can check it is not already covered.

## Build and check locally

```bash
npm ci
CLAUDE_BIN="$(which claude)" scripts/check.sh mods/<mod>     # Claude Code 2.1.287+
CLAUDE_BIN="$(which claude)" node scripts/build-catalog.mjs  # regenerates marketplace.json, the README catalogue and site data
```

Never hand-edit `.claude-plugin/marketplace.json`, `site/mods.json` or the README between the catalogue markers: they are generated.

`tsc` needs the mods API types that Claude Code writes into `<mod>/.claude-plugin/types/` the first time it loads your mod from a folder (for example with `claude --plugin-dir mods/<mod>`). Point `CLAUDE_TYPES` at `.claude-plugin/types/claude-code/index.d.ts` if they live elsewhere.

## Pull requests

One mod per pull request, titled `mod(<name>): <what>`. Each listed mod gets a second maintainer's review against its prompt.
