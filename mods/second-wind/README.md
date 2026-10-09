# Second Wind

A breath, an eye rest or a stretch while Claude works, sized to the wait.

## Install

```
/plugin install second-wind --marketplace ORG_TBD/REPO_TBD
```

## Use it

Just work. When a turn has run for 3 seconds, a small band appears above your prompt. Quick turns never show it.

```
Breathe in 4  physiological sigh
──────────▐████████████████████▌──────────
```

- It opens with one **physiological sigh**: a deep inhale, a short top-up sip, a long slow exhale (15 seconds).
- If the turn keeps going, it moves into **slow paced breathing** (5.5 seconds in, 5.5 seconds out), or **box breathing** (4-4-4-4) if you pick it.
- On turns over 60 seconds it swaps in a **20-20-20 eye rest** ("Look at something 20 feet away" for 20 seconds) or a one-line **stretch** at the end of a breath, then goes back to breathing. Another comes every couple of minutes after that.
- The words read the phase (`Breathe in 4`, `Sip in 2`, `Hold 4`, `Out 6`). In the terminal the bar fills from the middle outward and empties with the breath. In the desktop app it is a circle that grows and shrinks.
- When Claude answers, the breath is not cut off: an exhale already under way runs out its own time, and an inhale turns into a closing exhale. Then the band folds into one line, dims and clears:

  ```
  4 breaths while Claude worked · 37 today · 6-day streak
  ```

- While you type your next prompt, the band shrinks to one quiet line. It also uses that one line when the space above the prompt is short, and it sizes itself to the width it is given (narrower beside a docked pane), drawing above anything other mods put in the band rather than over it.
- The spinner's verb follows the breath (`Breathing in…`), but only when Claude Code is not showing a status of its own there.
- It only follows the main conversation. Subagents starting and finishing never restart or stutter the breath.

### Commands

| Command | What it does |
| --- | --- |
| `/breathe` | Today's breaths, eye rests and stretches, your streak, all-time breaths and the current settings |
| `/breathe off` | Hides the band now and on every later turn |
| `/breathe on` | Brings it back |
| `/breathe snooze` | Off for the rest of today, back tomorrow |
| `/breathe card` | Copies a small text card of your stats to the clipboard to share |
| `/breathe help` | What it does, and the safety line |

`/breathe` runs at once, even mid-turn.

### Movement card (off by default)

Turn on `movementCard` and every fifth long turn offers a card above the prompt, "Stand up and stretch" or "10 squats", with **Did it** and **Skip** buttons (click one, or Tab to it and press Enter; there are no letter keys, so they never clash with other mods' buttons). It never blocks the prompt: keep typing and answer it whenever you like. It goes away when you press a button or start your next turn. **Did it** counts a move for today.

Breathe gently and never strain. If you feel lightheaded, stop and breathe normally.

## Settings

Change them in `/config`.

| Setting | Default | What it does |
| --- | --- | --- |
| `pattern` | `slow` | What follows the opening sigh: `slow` (slow paced breathing) or `box` (box breathing) |
| `motion` | `full` | `full` animates the shape; `gentle` moves it less and redraws twice a second; `still` shows the words only, for reduced motion |
| `delaySeconds` | `3` | How long a turn runs before the band appears (0 to 600) |
| `eyeRest` | on | Offer the 20-20-20 eye rest on turns over 60 seconds |
| `stretch` | on | Offer a one-line stretch on turns over 60 seconds |
| `movementCard` | off | Offer the movement card every fifth long turn |

## What it can touch

- **Store:** its own store keeps counts and dates only: breaths, eye rests, stretches and moves for today and in all, the day they belong to, the streak and its last day, how many long turns there were, and whether you turned it off or snoozed it (and which day).
- **Session state:** the breath in progress, the time it was last drawn, whether you are typing, and an offered card. Nothing of your prompt is kept: typing is read only as "the box is empty or not".
- **Clipboard:** only when you run `/breathe card`.
- **Commands:** `/breathe` writes its answer as a dim transcript note for you. Claude never reads it, so it costs no tokens.
- **Status line:** on mobile and in VS Code only, the current cue (see Limits).
- **Timers:** one, and only while a turn runs and something can show the band: 8 redraws a second for `full`, 2 for `gentle`, 1 for `still`. While the fold line shows it waits without ticking. Between turns no timer runs, and a run whose turn ended unseen stops at the band's next draw. In a plain `-p` run, or with no window or phone attached, it does nothing at all and counts nothing.
- **Files, processes, network, model calls:** none.

## Limits

- **Surfaces:** the band and the spinner are drawn by Claude Code in the terminal and the desktop app only. On mobile and in VS Code mods get neither, so there Second Wind puts the current cue in its status line instead, and only when no terminal or desktop window is attached to the session.
- **The desktop circle** is an SVG picture, which cannot use theme keys. It is a soft blue at partial opacity that follows the app's light or dark mode. Everything else uses your theme's colours. The circle animates each step of the breath by itself, so if the band first appears mid-step, that one step plays from its start; the next step is back in time.
- **Days** are your computer's local calendar days. Flying west so the date goes back never breaks a streak.
- **Typing:** the band shrinks while the prompt box holds a draft and grows back when it is emptied or sent, in the terminal and the desktop app alike. It reads this from the hint line under the prompt, so it follows a beat after that line redraws.
- **Counts:** breaths count only for the turn that showed them. If a turn's end never reaches the mod (another mod held it, or a reload landed at that moment), that turn's breaths are dropped rather than added to the next turn. In the terminal and the desktop app its clock stops at once; on mobile or in VS Code alone it runs on until your next turn starts.
- **Reloads:** changing a setting reloads the mod. A breath already running keeps its old settings until the turn ends, and its animation resumes on the band's next draw.

## Built from a prompt

This mod was built from [`prompts/second-wind.md`](../../prompts/second-wind.md).
