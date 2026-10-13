<img src="../../brand/pixel-icons/svg/pop-quiz.svg" width="64" height="64" alt="">

# Pop Quiz

A learning mode, off by default: after a turn that changed code, two short questions about the change, each answer one press away.

```
pop quiz on the last change
1. Why does the migration add an index on user_id?     [show answer]
2. What does retry() now do on a 429?                   [show answer]
[skip]  No grading. It clears when you send your next prompt.
```

## Install

```
/plugin install pop-quiz --marketplace modmyclaude/claude-code-mods
```

## Use it

Type `/pop-quiz on`. From then on, every third turn in which Claude changed files with its own tools (Edit, Write, NotebookEdit), a small model writes two questions you could answer from the change alone, and they wait above your prompt:

- **show answer** swaps a question for its one-line answer.
- **skip** clears the quiz. Sending your next prompt clears it too.
- There is no grading. It only helps you keep up with code you did not type.

| Command | What it does |
| --- | --- |
| `/pop-quiz on` | Start quizzing in this session (only when you type it) |
| `/pop-quiz off` | Stop |
| `/pop-quiz every <n>` | Quiz every n-th changed turn, 1 to 20 (default 3) |
| `/pop-quiz ask` | Quiz the last changed turn now (only when you type it) |
| `/pop-quiz score` | Asked, shown and skipped, this session and all time, and what this session's quizzes cost |

"Only when you type it" means typed by you in the terminal, the desktop app or Remote Control. A program you run that drives Claude Code through its SDK counts as you too, since the desktop app sends that way; another mod, a peer session or Claude running the command is refused.

## Settings

- **On:** on by default. Off, Pop Quiz asks and draws nothing, and every `/pop-quiz` command says it is off; switched on again, `/pop-quiz on` (or the setting below) decides, as before. `/config` or the modmyclaude hub flips it, live. A quiz costs money, so another mod cannot switch it on; anyone can switch it off.
- **On from the start:** quiz in every session without `/pop-quiz on`. Off by default.
- **Quiz every n changed turns:** 3 by default.

## What it can touch

- **Model calls:** one small-model call (`haiku`, low effort, at most 800 output tokens and 20 seconds) per quiz, only while it is on, only on the turns it quizzes, and only when the terminal or the desktop app is there to show it. A reply that does not parse is asked once more; then nothing shows. If your setup refuses the `haiku` alias, it tries the small model your environment names (`ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`) instead. About $0.0004 a quiz at small-model list prices; `/pop-quiz score` shows the session's estimate.
- **What is sent:** the names of the changed files and a short diff of the change (at most 2,000 characters, each file with its share), never the transcript, your prompts or any other file. Anything that looks like a secret is replaced with `[REDACTED]` first (the same rules crossroads uses), and some files are sent by name only, never their contents: env files, keys and keystores, SSH keys, credentials files, registry and database logins (`.npmrc`, `.netrc`, `.pgpass`, `.pypirc`), Terraform values (`.tfvars`) and `secrets.*` files. A source file named that way (`secrets.ts`, `credentials.py`) goes by name only too: the safe side.
- **Reads:** the inputs of Claude's Edit, Write and NotebookEdit calls, once they ran, to know what changed.
- **Writes:** its own session state (the quiz, on or off, the pace, the score, the cost) and the all-time score in its own store. The band and toasts. `/pop-quiz` answers with no text for Claude.
- **Files, processes, network:** none beyond the model call.

## Limits

- Changes a shell command made (a formatter, a codegen script, `sed -i`) are not seen: only Claude's own file tools count.
- The questions are as good as the small model and the 2,000 characters it sees; a large change is quizzed on its first part of each file.
- The quiz shows in the terminal and the desktop app; elsewhere no call is made.
- The band and the presses are checked through the engine's test kit on the terminal and desktop surfaces, with the model stood in for.

## Built from a prompt

This mod was built from [the Pop Quiz prompt](../../prompts/pop-quiz.md).

More mods: [the full catalogue](../../README.md#the-mods).
