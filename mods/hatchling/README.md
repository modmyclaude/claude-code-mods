<img src="../../brand/pixel-icons/svg/hatchling.svg" width="64" height="64" alt="">

# Hatchling

A collectible pixel pet that hatches, reacts and evolves while you code.

## Install

```
/plugin install hatchling --marketplace modmyclaude/claude-code-mods
```

## Use it

An egg appears in a small band above your prompt: Bolt's egg, in the modmyclaude mascot's lime with
its antenna light on. It wobbles while Claude works, cracks as it nears hatching and hatches after
25 tool calls into one of 8 original species:

| Species | Rarity | Odds |
| --- | --- | --- |
| Pebblet (a mossy river stone), Fluffle (lop-eared fluff), Coilsnail (snail with a thread-spool shell) | common | 36 in 64 (56%) |
| Nimbit (a pocket raincloud), Lampwing (a moth with a glowing belly) | uncommon | 18 in 64 (28%) |
| Foldling (a folded paper bird), Geobug (a beetle with a geode shell) | rare | 8 in 64 (12.5%) |
| Starwhelp (a teacup-sized star dragon) | legendary | 2 in 64 (3%) |

Any pet has a 1 in 64 chance to be shiny (another palette). The roll happens once, at hatch time, and
is saved: restarting never rerolls. The egg carries its own random seed, so two sessions that hatch it
at the same moment hatch the same pet.

What it does while you work:

- **Bounces** when a tool call succeeds, **sweats** when one fails, **cheers** when a Bash command
  prints a passing test run (jest, vitest, pytest, go test, cargo test and nextest, node:test, mocha,
  rspec, bun, deno, phpunit, unittest, dotnet test, Playwright).
- **Falls asleep** after 5 minutes with nothing happening, and wakes on the next prompt or tool call.
- **Grows**: 1 XP per tool call (including those Claude's subagents make), 5 per finished turn of
  your own, 5 more for a passing test run. It becomes a teen at 200 XP and an adult at 800 XP, each
  with a short celebration and a toast.

Commands:

| Command | What it does |
| --- | --- |
| `/pet` | Stat card: name, species, rarity, shiny or not, stage, XP to the next stage, days together |
| `/pet name <name>` | Rename it (up to 16 letters, numbers, spaces, `-` `'` `.` `_`). Works on the egg too. Answers with a toast. |
| `/pet hide` / `/pet show` | Hide or bring back the band (remembered across sessions). Answers with a toast. |
| `/pet card` | A ~30 x 12 plain-text card with a **Copy card** button, for sharing |

The pet is one pet for you, across every session and project. It shares the band with other mods:
theirs is drawn first and the pet below it, so it never pushes their buttons out of view.

## Settings

None.

## What it can touch

- **Files**: none directly. The pet is saved in the mod's own store (a JSON file Claude Code keeps
  for each plugin under your config directory).
- **Processes, network, model calls**: none. Everything is deterministic except the one hatch roll,
  which uses the platform's crypto random source.
- **What the model sees**: the text of `/pet` and `/pet card` (a few short lines), like any command's
  output. `/pet name`, `hide`, `show` and help answer with a toast the model never reads. Tool calls
  are only observed, never changed or refused.
- **Clipboard**: only when you press Copy card.

## Limits

- The band draws in the terminal and the desktop app's Code tab. VS Code and mobile have no band
  above the prompt; `/pet` and `/pet card` still work there as text.
- The desktop app draws the sprite as text cells too. How crisp it looks depends on the app's font and
  line spacing: generous line spacing can show thin seams between rows of pixels.
- "Tests passed" is read from the runner's summary in the Bash output. A runner with an unusual
  summary is not recognised (no cheer, no harm). Commands that only show a log (`cat`, `grep`,
  `gh run view`, `docker logs`, `kubectl logs`, also after a `cd` or wrapped in `sudo`, `env`, a
  subshell or `bash -c`) do not count. Test runs started in
  the background, very long outputs whose summary is cut, and PowerShell are not read.
- Animation runs on a timer only while something happens (a reaction, Claude working, the doze-off);
  when idle, asleep or hidden no timer runs.
- Two sessions open at once share the one pet. Each change re-reads the saved pet first, so progress
  from both sessions adds up, and a pet that has hatched is never rolled again. Two writes in the same
  instant can still lose one tool call's XP. Another session's progress shows in this band at this
  session's next event.
- When hidden, the pet still counts tool calls and turns, and still toasts when it hatches or evolves.

## Built from a prompt

This mod was built from [this prompt](../../prompts/hatchling.md).

More mods: [the full catalogue](../../README.md#the-mods).
