<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/logo-on-dark.svg">
  <img alt="modmyclaude" src="brand/logo-on-light.svg" width="440">
</picture>

**Curated, tested Claude Code mods. Every mod ships with the prompt that built it.**

<!-- hero: a 6-10 second clip of Last Look holding an rm -rf goes here -->

```
/plugin install last-look --marketplace modmyclaude/claude-code-mods
```

<!-- count -->14<!-- /count --> mods · validated and tested on every commit · terminal and desktop app · MIT

</div>

## Why this collection

- **Tested, not scraped.** Every mod passes `claude plugin validate`, strict TypeScript and its own behaviour tests on both the terminal and the desktop app before it is listed, and again on every commit.
- **You can see what each mod can reach.** The badges in the catalogue are generated from Claude Code's own validator report of what the mod hooks and calls. Not from our description.
- **Every mod ships its prompt.** Install a mod as it is, or paste its prompt into Claude Code and build your own version in a minute.

## Install

Mods need **Claude Code 2.1.287 or newer** (`claude update`). Type the install line in Claude Code running in a terminal:

```
/plugin install <mod> --marketplace modmyclaude/claude-code-mods
```

Answer `y` to add the marketplace and pick a scope. After the first install, others are just `/plugin install <mod>@modmyclaude`. Mods installed at user scope also load in the desktop app's Code tab. The VS Code extension does not draw mods yet.

On older versions, add the marketplace first:

```
/plugin marketplace add modmyclaude/claude-code-mods
/plugin install <mod>@modmyclaude
```

## The mods

<!-- catalogue:start -->
### Safety

| Mod | What it does | Can reach | Install |
|---|---|---|---|
| [**Last Look**](mods/last-look) | Holds destructive commands and shows exactly what they would destroy. [Prompt](prompts/last-look.md) | `reads files` `runs commands` `hooks tool calls` | `last-look@modmyclaude` |

### Cost and limits

| Mod | What it does | Can reach | Install |
|---|---|---|---|
| [**Redline**](mods/redline) | Context fill, session cost and pace on one line, with a warning before the red line. [Prompt](prompts/redline.md) | `display only` | `redline@modmyclaude` |
| [**Thermostat**](mods/thermostat) | Shows when your prompt cache goes cold, and stops the expensive send. [Prompt](prompts/thermostat.md) | `calls a model` `hooks prompts` | `thermostat@modmyclaude` |

### See what Claude is doing

| Mod | What it does | Can reach | Install |
|---|---|---|---|
| [**Ant Farm**](mods/ant-farm) | Watch your subagents work, and what they cost, live. [Prompt](prompts/ant-farm.md) | `display only` | `ant-farm@modmyclaude` |
| [**Footprints**](mods/footprints) | A live file tree beside the chat that shows where Claude has been. [Prompt](prompts/footprints.md) | `reads files` `runs commands` `hooks tool calls` | `footprints@modmyclaude` |
| [**Headway**](mods/headway) | See how far along Claude is, and when it will land. Zero tokens. [Prompt](prompts/headway.md) | `hooks tool calls` | `headway@modmyclaude` |

### Review changes

| Mod | What it does | Can reach | Install |
|---|---|---|---|
| [**Play-by-Play**](mods/play-by-play) | Replays every change Claude made in a turn, shell edits included. [Prompt](prompts/play-by-play.md) | `runs commands` `hooks tool calls` | `play-by-play@modmyclaude` |

### Catch what you would miss

| Mod | What it does | Can reach | Install |
|---|---|---|---|
| [**Fine Print**](mods/fine-print) | A second reader that flags what you would miss in a wall of text. [Prompt](prompts/fine-print.md) | `calls a model` | `fine-print@modmyclaude` |

### Memory

| Mod | What it does | Can reach | Install |
|---|---|---|---|
| [**Noted**](mods/noted) | Turns your corrections into permanent rules, without duplicates. [Prompt](prompts/noted.md) | `writes files` `reads files` `calls a model` `hooks prompts` | `noted@modmyclaude` |

### Workflow

| Mod | What it does | Can reach | Install |
|---|---|---|---|
| [**Crossroads**](mods/crossroads) | Three ways forward after every turn, risky ones marked. About $0.0002 a turn. [Prompt](prompts/crossroads.md) | `calls a model` `hooks prompts` | `crossroads@modmyclaude` |
| [**Porthole**](mods/porthole) | A live preview of the app you are building, right beside the chat. [Prompt](prompts/porthole.md) | `reads files` `runs commands` `hooks tool calls` | `porthole@modmyclaude` |

### Alerts

| Mod | What it does | Can reach | Install |
|---|---|---|---|
| [**Pager**](mods/pager) | Plays a sound when Claude finishes, needs you or hits an error. [Prompt](prompts/pager.md) | `network` `plays sound` | `pager@modmyclaude` |

### Looks

| Mod | What it does | Can reach | Install |
|---|---|---|---|
| [**Wardrobe**](mods/wardrobe) | Restyle Claude Code live, including colourblind-safe and high-contrast themes. [Prompt](prompts/wardrobe.md) | `hooks tool calls` | `wardrobe@modmyclaude` |

### Fun

| Mod | What it does | Can reach | Install |
|---|---|---|---|
| [**Hatchling**](mods/hatchling) | A collectible pixel pet that hatches, reacts and evolves while you code. [Prompt](prompts/hatchling.md) | `hooks tool calls` | `hatchling@modmyclaude` |
<!-- catalogue:end -->

## Build your own

- **[Mod Maker](prompts/starters/mod-maker.md)**: describe the feature you wish Claude Code had, get a tested, installable mod.
- **[Mod Matchmaker](prompts/starters/mod-matchmaker.md)**: Claude checks your setup and picks the mods worth installing, in order.

Every mod here started as a prompt in [prompts/](prompts). Fork one, change a line, paste it into Claude Code.

## Safety

Mods are not sandboxed: a mod runs with your permissions and can see your prompts and tool calls. That is why this collection is small and checked:

- Each mod is reviewed by a second maintainer against its prompt before it is listed.
- The "Can reach" column comes from `claude plugin validate`, so a mod that reads files, runs commands, calls a model or uses the network says so.
- Mods that call a model say so and have a hard cap on how often.
- Guards that can stop an action fail safe: if the mod itself breaks, it does not silently let the action through.

Found a problem? See [SECURITY.md](SECURITY.md).

## Contributing

Ideas and new mods are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the quality bar every mod meets.

---

Not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC. [MIT License](LICENSE).
