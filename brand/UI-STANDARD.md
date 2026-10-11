# modmyclaude UI standard

One page for every pane, band, toast and status line in the collection. The ENG bots apply it mod by mod, and Bot 4
checks it in every live test. Engine limits behind these rules are in `_internal/API-GOTCHAS.md` (#25, #35, #36, #39,
#40) and MM-088 and MM-101.

## Three principles
1. **Glance first.** A person should know the state in one second, before reading a word.
2. **Numbers, not sentences.** A value goes in a row with a label, never in the middle of a sentence.
3. **Calm stays calm.** Colour and motion mean something. A quiet mod looks quiet, and a hold looks serious.

## Pane anatomy (top to bottom)
The engine already draws the pane's title bar with the mod's name, so never repeat it inside the pane.

| Part | Rule |
| --- | --- |
| **Hero line** | The state in 2 to 5 words, coloured by meaning (below), plus at most one short qualifier: `Warm · 1m left`. An optional 10-cell bar goes under it. |
| **Rows** | Label on the left in `subtle`, value right-aligned: a row Box with a `flexGrow` label and a fixed-width value Box. At most 7 rows. Hide rows that are zero, or fold them into one dim line ("Nothing paid cold yet"). |
| **Empty state** | Bolt (small) plus one line saying what will appear and how to make it appear: "No subagents yet. They show up here when Claude starts one." |
| **Footnote** | `subtle`, at most 2 lines, once, at the bottom. This is where caveats go ("Dollars are API list prices..."). |
| **Width** | Design for 40 columns. Below that, Bolt steps out and the rows keep every column. |

## Bands
- **One row,** two at most. A band never pushes another mod's band out of view.
- **Exception for games and choice lists** (halftime's board, crossroads' suggestions): up to 8 rows while the person is playing or choosing. They fold back to one row, or nothing, when idle.
- **Compose:** other mods draw first (`next(e)`). A pending safety hold renders alone and composes again once it resolves (#36).
- **No sprite in a band,** except a game board.

## Toasts and hold messages
- **Command answers** (the reply to a `/command` the person just typed, such as `/crossroads status`) may run longer: at most 3 short lines, answer first. Anything longer opens the mod's pane.
- **Plain text,** at most 12 words, leading with the outcome: "Saved as a house rule." / "Cache went cold. Send again to pay it."
- **Never start with the mod's name.** The engine prefixes it, and doubled names were MM-088.
- **A held prompt** shows inside the desktop's "A hook blocked your prompt" frame, so lead with what happened and the one thing to do, in at most 20 words: "Held: this send re-reads 98k tokens cold (≈$0.49). Send again to go ahead." Details live in the pane.
- No emoji, no exclamation marks.

## Status line
- **Plain text only,** because the status line has no colour. Words carry the level instead: `RED`, `AMBER`, `cold`.
- **Short:** 40 characters or fewer per mod, with ` · ` between parts: `cache warm · 1m left`.

## Colour meaning
Use theme keys, never hex for UI text. They follow the person's theme, including wardrobe's.

| Meaning | Key |
| --- | --- |
| Good, warm, done, safe | `success` |
| Soon, attention, near a limit | `warning` |
| Holds and real failures only | `error` |
| Labels, footnotes, idle, cold, "nothing yet" | `subtle` |

Red is never decoration. If nothing is wrong, nothing is red.

## Numbers
| Kind | Format |
| --- | --- |
| Estimates | `≈` before the number, never `~` (#35: Claude Code's cost is an estimate, not a bill) |
| Money | 2 decimals under $100 (`≈$0.49`, `≈$4.12`), whole dollars from $100 (`≈$123`) |
| Tokens | `98k`, `1.2M`. Under 1,000 as is. |
| Time | `45s`, `1m left`, `2h 5m`. Never "0m". |
| Percent | whole numbers: `82%` |

Every number carries its unit. Numbers right-align in rows.

## Words
- Plain words, and second person: "test window: 2 min", never a setting name like `cacheMinutes`.
- Sentence case. No em dashes, no emoji, no hype. Never "official".
- A safety mod is "a safety net", never "prevents", "stops every" or "makes X safe".

## Desktop typography
- Words are drawn in the app's proportional font. Never put block characters (U+2580 to U+259F) in the same Text as words: the whole Text switches to the code font and clips (#40).
- Glyph art (bars, sprites, game boards) is drawn one code-font cell per character (`Box width={1}`, a space run as one `Box width={n}`), in its own element apart from the words. On the terminal, use one Text or one Raster per row.
- Never place the engine's own node under a Box that has a size or position prop (#39).

## Bolt
Sprites come from `brand/bolt-sprites` only, and are never recoloured.

| Use | Pose |
| --- | --- |
| Ready, idle | `idle` |
| Nothing yet, cold, asleep | `sleep` (light off, z) |
| Calm, breathing, resting on purpose | `calm` (eyes closed, light on, soft smile) |
| Working, thinking | `think` |
| Done, success | `cheer` |
| A tool failed (pets) | `sweat` |
| Games only | `run1` / `run2`, `jump`, `crash` |

- **Size:** small (10x5 cells) for any state that matters, because tiny barely reads. Tiny (3x2) is only for game runners, such as the cratehop courier, where the field needs it.
- **Where:** empty and first-run states, a pane's hero row, and games.
- **Never:** in a safety hold (last-look, cloakroom), a toast or the status line.

## Before and after: the thermostat pane

**Before** (seven sentences, numbers buried):
> Cache: warm, 1m left (2m window, from your cacheMinutes setting). 98k tokens at Opus 5.5 prices: ~$0.02 to send warm, ~$0.49 cold. Cold sends paid: 0 (0 tokens re-read, ~$0.00 more than warm). Prompts held: 0, followed by /clear instead: 0 (~$0.00 not spent). ...

**After:**
```
[Bolt idle]  Warm · 1m left                    <- success
             ██████████░░░░░░░░░░  test window 2 min
             Next send ≈$0.02 warm, ≈$0.49 cold <- subtle

Prompts held                        1
Cold sends paid                     0
Saved                          ≈$0.47
Session total                  ≈$0.47

Dollars are API list prices. On a subscription they measure plan usage.   <- subtle
```
When cold, the hero reads `Cold · 98k to re-read` in `subtle`, and Bolt sleeps.

## Live check (Bot 4 adds this to every test)
1. Is the state clear in one second, from the hero line or the band?
2. Are the values in right-aligned rows, with no sentence holding a number?
3. Are zero rows hidden or folded?
4. Does red appear only for holds and failures?
5. Are toasts 12 words or fewer, outcome first, with no doubled mod name?
6. On desktop: is the text in one font, nothing clipped, and the art aligned on the cell grid?
7. Is Bolt from the kit, small, and absent from holds and toasts?
8. Are there zero em dashes, `≈` for every estimate, and units on every number?
