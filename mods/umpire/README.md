<img src="../../brand/pixel-icons/svg/umpire.svg" width="64" height="64" alt="">

# Umpire

Runs your tests after Claude edits code and makes the call: passed and failed counts above the prompt, a toast when it flips. Off by default.

```
umpire: 142 passed · 2 failed · auth.test.ts, user.test.ts · 8.3 s
```

## Install

```
/plugin install umpire --marketplace modmyclaude/claude-code-mods
```

## Use it

Type `/umpire on`. From then on, at the end of every turn in which Claude changed files with its own tools (Edit, Write, NotebookEdit), umpire runs your project's tests once, and:

- **A line above the prompt** makes the call: passed and failed counts, the first three failing tests or files (`+2 more` past that) and how long it took, in the error colour when something fails. While the tests run it says so.
- **A toast** only when the call flips: the tests started failing, or they pass again. Never on every run.
- **The status line** keeps the count: `tests 142/144`.
- **`/umpire show`** opens the last run: the call, a mark per run for the last ten, the failing names, and the end of the output. **tell Claude** puts the failing names and the output's last 30 lines in your prompt box, after anything you typed, with anything that looks like a secret redacted. You decide whether to send it.

It finds the test command once per session: your setting, else the one you set for this project with `/umpire command`, else `package.json`'s test script (through pnpm, yarn, bun or npm, by lockfile), pytest, `go test ./...` or `cargo test`. It understands the summaries of Jest, Vitest, pytest, go test and cargo test; for anything else, the exit code makes the call.

| Command | What it does |
| --- | --- |
| `/umpire on` | Run the tests after each turn that changes files (only when you type it) |
| `/umpire off` | Stop |
| `/umpire run` | Run them now (only when you type it) |
| `/umpire show` | The last run, in a pane |
| `/umpire command <cmd>` | Set this project's test command, as you would type it (only when you type it) |
| `/umpire tell` | Put the failures in your prompt box (only when you type it) |

"Only when you type it" means typed by you in the terminal, the desktop app or Remote Control. A program you run that drives Claude Code through its SDK counts as you too, since the desktop app sends that way; another mod, a peer session or Claude running the command is refused.

## Settings

- **On from the start:** run in every session without `/umpire on`. Off by default.
- **Test command:** the command to run, as you would type it. Empty: found from the project.
- **Time limit (seconds):** 120 by default; a longer run is stopped and called timed out.

## What it can touch

- **Runs:** the one test command, in the project root, with `CI=1` and colour off so test runners do not wait in watch mode, stopped at the time limit. A command you typed (the setting or `/umpire command`) runs through `sh` as you wrote it. Nothing else.
- **Reads:** the project's `package.json` and `pyproject.toml`, and whether a lockfile, `pytest.ini`, `tests/`, `go.mod` or `Cargo.toml` exists, to find the command.
- **Keeps:** the last ten runs' output, a million characters at most, in the mod's memory only. The command you set per project in its own store, keyed by a hash of the project's path.
- **Writes:** its session state (on or off, the runs' calls), the line, the status line, toasts, and your prompt box when you press tell Claude, never sent.
- **Network, model calls:** none of its own. Your tests may do anything your tests do.

## Limits

- Changes a shell command made (a formatter, a codegen script) do not trigger a run; only Claude's own file tools do. `/umpire run` covers the rest.
- One run at a time: a turn that ends during a run queues exactly one more, run when the first is done.
- Counts come from the test runner's summary line; go test without `-v` names failing tests but counts no passes.
- The run's output is shown as the runner printed it, without colour. Long output keeps its end.
- The line, the pane and the presses are checked through the engine's test kit on the terminal and desktop surfaces, with the test runner stood in for.

## Built from a prompt

This mod was built from [the Umpire prompt](../../prompts/umpire.md).

More mods: [the full catalogue](../../README.md#the-mods).
