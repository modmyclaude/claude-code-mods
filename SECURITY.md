# Security

Mods run inside Claude Code with your permissions. They can see your prompts and tool calls, and depending on what they call, read or write files, run commands, call a model or use the network. The catalogue's "Can reach" column is generated from `claude plugin validate` so you can see this before installing.

## How mods here are checked

- Every mod is reviewed by a second maintainer against its prompt before it is listed.
- CI runs `claude plugin validate --strict` and the mod's tests on every commit, on a pinned and the latest Claude Code.
- Installs come from this repository's commits, so a listed mod cannot change without a reviewed commit.

## Reporting

Please report a vulnerability privately through GitHub: **Security > Report a vulnerability** on this repository. Do not open a public issue for security problems. We aim to respond within 72 hours and will credit you unless you prefer otherwise.
