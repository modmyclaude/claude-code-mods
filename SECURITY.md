# Security

Mods run inside Claude Code with your permissions. They can see your prompts and tool calls, and depending on what they call, read or write files, run commands, call a model or use the network. The catalogue's "Can reach" column is generated from `claude plugin validate` so you can see this before installing.

## How mods here are checked

- Every mod is reviewed by a second maintainer against its prompt before it is listed.
- CI runs `claude plugin validate --strict`, a strict type check and the mod's tests on every commit, on a pinned and on the latest Claude Code, and installs every mod from the marketplace into a throwaway config.
- Installs come from this repository's commits, so a listed mod cannot change without a reviewed commit.
- CI runs with read-only repository permissions, and its actions are pinned to exact commits.

## Supported versions

Fixes land on `main` and reach you with `claude plugin marketplace update modmyclaude` followed by `claude plugin update <mod>@modmyclaude`. Only the latest commit is supported.

## What counts

- A mod reaching something its "Can reach" badges and README do not disclose.
- A guard that lets an action through when it says it holds it (for example a destructive command Last Look should hold).
- A mod leaking prompts, files, secrets or tokens off your machine.
- Anything in this repository's scripts or CI that could run untrusted code.

Mods are a safety net, not a sandbox. A bypass of Claude Code itself belongs with Anthropic, not here.

## Reporting

Please report a vulnerability privately through GitHub: **Security > Report a vulnerability** on this repository. Do not open a public issue for security problems. We aim to respond within 72 hours and will credit you unless you prefer otherwise.
