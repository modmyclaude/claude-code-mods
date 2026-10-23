---
mod: umpire
title: Umpire
tagline: Runs your tests after Claude edits code and makes the call. Off by default.
category: workflow
surfaces: [terminal, desktop]
model_calls: none
---

# Umpire

Runs your tests after Claude edits code and makes the call: counts above the prompt, a toast when it flips. Off by default.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "umpire": it runs my tests after Claude edits code and shows the call. It is off until I say /umpire on.

Find the test command once per session: my setting first, else one I set for this project with /umpire command (kept per project in the mod's store), else package.json's test script (through pnpm, yarn, bun or npm by lockfile, never npm's "no test specified" placeholder), pytest, go test ./... or cargo test. Run it at the end of any main turn in which Claude's Edit, Write or NotebookEdit changed a file: one run at a time in the project root with CI=1 and colour off, a time limit I can set, started off the turn's clock (never inside a hook's wait); a turn that ends during a run queues exactly one more.

Read the result from Jest, Vitest, pytest, go test and cargo test summaries (passed, failed, the failing names), else from the exit code. Show one line above the prompt with the counts, the first three failing names (+N more) and the run time, in the error colour when failing; a toast only when the result flips; a status-line entry with the counts. /umpire show opens a pane with the call, a history mark per run, the failing names and the output's end. "tell Claude" fills my prompt box with the failing names and the last 30 lines, secrets redacted, after anything I typed; never send anything yourself. on, run, command and tell run only when I type them.

Never change files, never run anything but the test command, never run outside the project. Keep the last ten runs' output in memory only. Terminal and desktop app, under other mods' lines.
```
