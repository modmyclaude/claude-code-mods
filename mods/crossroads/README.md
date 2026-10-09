# Crossroads

Three ways forward after every turn, risky ones marked. About $0.0002 a turn.

```
1: run the auth tests · add the same guard to signup.ts · push to main (pushes) · 0: dismiss
```

## Install

```
/plugin install crossroads --marketplace modmyclaude/claude-code-mods
```

## Use it

- When Claude finishes a turn with an answer, a small band appears above your prompt with three specific next prompts. A dim row shows while they are being made.
- Each item is a button: click it to put that suggestion in your prompt as an editable draft. It is never sent for you. Press **0** to dismiss the list.
- **Only clearly safe suggestions get a number key or the top slot.** A suggestion is on the safe set only when it reads, inspects, tests, explains or reviews (run the tests, show, explain, read, check, list, diff, review, add a test, a question) and names no risky target (prod, production, live, main, master, a release; deploy, publish, push, merge; delete, drop, remove, wipe; a migration or database; money; credentials, secrets, tokens, keys; infrastructure such as terraform, kubectl, AWS, DNS; email, Slack, posting or sending to people). Press **1**, **2** or **3** in an empty prompt to draft one of those. Everything else, including ordinary edits such as "fix the login bug", is a plain row: clickable, but with no number key and never above a safe one. When no suggestion is on the safe set, no item has a number key at all.
- Claude Code's own guess (the dim ghost text you take with Tab) stays in your prompt box only when it is on the safe set; then it is option 1, so you never see two different "next" ideas. Any other guess is kept out of the prompt box and shown in the list as a plain row instead.
- Risky suggestions also get an amber note such as `(deploys)`. The small model tags each suggestion it writes as risky or not, with a short reason, and keyword rules back that tag up (risky if either says so). Claude Code's own guess has no tag, so the keywords mark it. Letters dressed up to slip past (lookalikes from other alphabets mixed into a Latin word, fullwidth or styled letters, invisible or control characters) are marked `(unusual letters)`. This flags common risky actions; it is not exhaustive, which is why privilege comes from the safe set and not from the notes. Russian, Ukrainian and Greek text is normal text and is never marked for its alphabet.
- If Claude's reply ends with numbered options, the digit keys are left alone for that turn so typing a number answers Claude. The items stay clickable.
- The list clears the moment you submit anything. It waits for background subagents to finish before suggesting.
- **Desktop app:** the desktop prompt box cannot be filled by a mod, so clicking an item copies it to your clipboard and shows a clearly labelled **Send this prompt now** button. **Close** comes first and is where the focus starts, so a stray Enter closes; Send is never the default and has no hotkey.

Commands:

| Command | What it does |
|---|---|
| `/crossroads` | Today's calls and estimated cost, this project's counts, back-off state (shown as a toast; Claude never reads it) |
| `/crossroads off` / `on` | Turn the mod off or back on (off also stops judging Claude Code's own guess) |
| `/crossroads forget` | Wipe what it counted for this project |

## Settings

None. Use the commands above.

## What it can touch

- **Model calls:** at most one small-model call (`haiku`, low effort, capped at 1,200 output tokens and 20 seconds) per finished main-loop turn. Skipped on trivial turns (under four words, or no tool use and no question), on subagent, error and refusal turns, while backing off, and whenever neither the terminal nor the desktop app is attached to draw the band (a headless `-p` run, an SDK host, VS Code or mobile alone), so nothing is spent on a list nobody would see. Typical cost about $0.0002 at Claude Haiku 5.5 list prices; `/crossroads` shows today's estimate.
- **What is sent:** a compact digest, never the transcript: your first prompt (the goal), your last prompt, the names of files Claude edited or read (no paths, no contents), the first line of each command it ran with passed or failed, Claude's closing question, the names of this session's slash commands, your top three suggestion kinds, and Claude Code's own guess when there is one. Anything that looks like a secret (AWS, GitHub, GitLab, Anthropic, OpenAI, Stripe, Slack, Google, Hugging Face, npm and Twilio keys, JWTs, private key blocks including PGP, Slack and Discord webhook URLs, `password=` style assignments such as `SECRET_KEY_BASE=` or `dbpass=`, secret flags such as `--password X` or `--token X`, `mysql -pX`, `curl -u user:pass`, bearer and `Authorization: token` headers, "my password is X", passwords in URLs) is replaced with `[REDACTED]` first.
- **Reads:** the session's transcript in memory, the slash command list, the `/config` rows (to see whether Claude Code's own suggestion is on), the subagent list, and two environment variables (`ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`) used only if the `haiku` alias is refused. No files, no processes, no network.
- **Writes:** your prompt box (only when you press an item), your clipboard (desktop fallback), toasts (the `/crossroads` answers, which never enter Claude's context), and the plugin's own store: an on/off flag, today's call count and token totals, and per project (keyed by a hash of the project path) counts of the kinds of suggestion you took, edited or ignored. Never your prompts or the suggestions themselves.
- **Sends a prompt** only when you press Send in the desktop fallback. It goes in as your own words (`asUser`); the transcript still records that Crossroads submitted it.

## Limits

- The model's reply must be strict JSON followed by an `END` line. A reply that is cut off or malformed shows nothing rather than half a list.
- Claude Code's own guess only exists in the terminal, and only when its prompt suggestions are on. Crossroads waits up to 4 seconds for it, then writes all three itself. A safe guess that arrives later becomes option 1 (the last suggestion drops off), so the ghost text and option 1 still agree.
- Button labels keep the surface's own button style (the API gives buttons no colour), so the risk note beside a risky item is what is amber.
- Back-off: after 3 lists in a row are ignored or dismissed, a list comes every 2nd, then 4th, then 8th eligible turn, until you take or edit one.
- Numbered-option detection is a heuristic. A reply ending in a short numbered list of steps may also turn the digit keys off for that turn (the items stay clickable).
- If the `haiku` alias is refused and no provider model id is set in the environment, Crossroads says so once and makes no calls for the rest of the session.
- On the desktop app the copy may not reach your clipboard: this release of the mods API says remote surfaces have no clipboard path yet. The band then says it could not copy and shows the suggestion, and Send still works.
- The VS Code and mobile surfaces do not draw the band above the prompt, so Crossroads shows nothing there and makes no model call for them.
- Secret hiding works on shapes, not meaning: a secret with no recognisable prefix or name around it (a bare password repeated in Claude's closing question, say) can still pass through.
- The amber note flags common risky actions; it is not exhaustive. A risky suggestion the model does not tag and no keyword knows is shown with no note, but it is still a plain row: no number key, never the top slot, never the ghost text. That guarantee holds for anything not on the safe set.
- The safe set is narrow on purpose and English first (plus run, show, explain and check in Russian, Ukrainian and Greek). A harmless suggestion it does not recognise, such as "fix the failing test", gets no number key, and Claude Code's own ghost text is hidden for it.

## Built from a prompt

This mod was built from [prompts/crossroads.md](../../prompts/crossroads.md).
