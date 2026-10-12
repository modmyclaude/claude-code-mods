<img src="../../brand/pixel-icons/svg/bouncer.svg" width="64" height="64" alt="">

# Bouncer

Checks every installed mod at the door. When a session starts, Bouncer runs Claude Code's own plugin validator on each plugin folder it can name and reads what the report says the mod can reach: files, programs, the network, the model, your prompts, tool calls. One line above the prompt when a mod is new to you or its report changed; a `/bouncer` pane with a row per mod. Facts from the validator, never a verdict.

```
bouncer: 1 new mod: switchboard (runs programs)   [Show]
```

```
Bouncer
Checked 19 mods at 09:12. Facts from the validator, not a verdict; nothing leaves the machine.

switchboard  0.1.0  new  loaded  reads and writes files, runs programs, reads the conversation   [details]
cloakroom    0.1.0       loaded  reads files, can change tool calls, can hold your prompts
pager        0.1.0       loaded  reaches the network, plays sound, reads environment variables
headway      0.1.0       loaded  adds a tool for Claude
wardrobe     0.1.0       loaded  reads settings, changes your settings
zen          0.3.0               nothing declared
```

## Install

```
/plugin install bouncer --marketplace modmyclaude/claude-code-mods
```

## Use it

- **At session start** the validator runs once per plugin folder, in the background. Nothing is drawn while every mod is already known and its report unchanged.
- **The line above the prompt** appears when a mod is new to you or its report changed, naming the mod and what is notable (runs programs, runs tools, reaches the network, calls MCP tools, calls the API as you, starts subagents, can type for you, can change tool calls, messages other sessions, changes your settings). **Show** opens the pane; `/bouncer ok` clears the line. Either way the line is gone for good once you have looked, until a mod is new or changed again.
- **`/bouncer`** opens the pane: one row per mod with its name, version, `new` or `changed`, `loaded` when the engine named it joining this session, and its reach in words. The warning colour marks reach worth a second look. **details** unfolds the validator's own lines for that mod. Two folders with one name (a copy under development beside the installed one) are two rows, each showing its folder.
- **`/bouncer check`** runs the validator again now.

What the words mean, each read off the validator's list of what the mod calls and hooks: *reads files*, *reads and writes files*, *runs programs*, *runs tools* (it can run Claude's own tools, Bash and file writes among them, through the normal permission path), *reaches the network*, *calls MCP tools*, *calls the API as you* (it can spend your login on API calls), *calls the model*, *starts subagents*, *can type for you* (it can start a turn or fill the prompt box), *can change tool calls* (it hooks tool calls with a hook that can refuse or rewrite them), *can hold your prompts*, *changes the system prompt*, *adds a tool for Claude* (a tool or a subagent type Claude can call), *adds to the conversation*, *reads the conversation*, *messages other sessions*, *can stop a turn*, *plays sound*, *reads environment variables*, *sets environment variables*, *reads settings*, *changes your settings*, *writes your clipboard*, and *nothing declared*. Every call that acts outside the mod's own state has a word; a call that only draws, keeps the mod's own state or reads where the session is has none.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `claudeBin` | `claude` | The command the validator runs through: a name on your PATH or an absolute path. |

## What it can touch

- **Runs:** `claude plugin validate --json <plugin folder>` once per plugin folder, at session start and on `/bouncer check`, through the binary the `claudeBin` setting names; nothing else. The validator reads the mod's manifest and source itself; Bouncer reads only its report.
- **Reads:** `~/.claude/plugins/installed_plugins.json` and `~/.claude/plugins/known_marketplaces.json` (under `CLAUDE_CONFIG_DIR` when that is set), the `.claude-plugin/marketplace.json` of each marketplace that lives in a local folder, and each plugin folder's `.claude-plugin/plugin.json` for its name and version. Never a mod's source. The engine also names each mod as it joins the session, and those folders are checked too.
- **Writes:** one value in its own store: for each plugin folder, the mod's name there and a short hash of its reach, so the line fires on first sight and on change only. An update that installs into a new folder is compared with the old folder's hash, and the old entry goes. Nothing else.
- **Session state:** the rows as last checked, the line, which row is unfolded, when the check ran.
- **Network, model calls:** none. Nothing leaves the machine.

It never blocks, unloads or changes a mod, and never claims a mod is safe: a clean row means the validator found no reach to report, not that the mod is harmless.

## Limits

- The validator must be reachable: with no `claude` on the PATH (the desktop app's own binary is not), set `claudeBin` to its path, or every row says `could not check`.
- Folders come from the registry files and from mods the engine names as they join; a mod loaded another way (a `--plugin-dir` folder in a session that does not name it) is not checked. A folder the registry lists is checked whether or not this session loaded it; `loaded` marks the ones the engine confirmed.
- At most 60 folders are checked. Each run of the validator takes about a second; the check runs in the background and the pane says when it is done.
- The reach words are read from the validator's list of calls and hooks. A mod that reaches the world through another mod's tool, or through a settings hook, is not seen here.
- A mod whose first check failed reads as `new` when a later check passes. A mod seen before keeps its last hash through a failed check.
- The band, the pane and the transcript lines are checked through the engine's test kit on the terminal and desktop surfaces.

## Built from a prompt

This mod was built from [the Bouncer prompt](../../prompts/bouncer.md).

More mods: [the full catalogue](../../README.md#the-mods).
