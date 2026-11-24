<img src="../../brand/pixel-icons/svg/scorebug.svg" width="64" height="64" alt="">

# Scorebug

Live scores beside the chat: a card for each game in a side column of the scene in the desktop app, one row above the prompt everywhere else.

## Install

```
/plugin install scorebug --marketplace modmyclaude/claude-code-mods
```

## Use it

- **The cards.** In the desktop app, wear a scene behind the chat (any `wardrobe` look, or another mod's scene) and each game you follow becomes a card at the top of the left side column: what the game is at (`LIVE  P2 12:41`, `END OF P1`, `FINAL`, `STARTS IN 2 MIN`), each team's short code and score, the side ahead in bold, and who is playing where. A game that is on has a lit edge. Live games come first, then games to come, then finished ones, four at most. The cards sit in the open side of the scene, outside the frosted chat column, and the scene keeps moving beneath them.
- **The row.** Everywhere a card cannot show (the terminal, the phone, and the desktop app with no scene behind the chat), the same games sit in one row above the prompt: `scores │ RDG 1 HBR 2 P2 12:41   LKS 54 FDY 61 Q3 4:12`. Games that are on are drawn bright, the rest dim. In the desktop app the row steps aside once the cards are drawn, and comes back within two looks at the feed if the scene goes.
- **Toasts.** A toast when a team you follow scores in a game of goals or runs (`HBR scores: RDG 1, HBR 2`), and one when a game you follow ends (`Final: RDG 1, HBR 2`). A game of points says nothing until the end, so a basketball night does not toast every basket. Turn them off with the `alerts` setting.
- **Your teams.** Put them in the `teams` setting, comma-separated: a short code, a whole name or one word of it. Empty follows every game the feed has.
- **Commands.** `/scores` writes the games and where they show to the transcript. `/scores left` and `/scores right` move the cards for the session (the lasting side is the `side` setting). `/scores off` hides everything and stops looking for the session; `/scores on` brings it back.
- **The pretend feed.** This first version plays two made-up games on the clock, one of goals in three periods and one of points in four quarters, each a fifteen-minute round with a start, breaks and a final, over and over. They let you see the cards, the row and the toasts before a real feed is chosen. They are worked out on your machine and send nothing anywhere.

## Settings

Every setting has a default, so the notice at install about options not yet set is expected; change them in `/config`.

| Setting | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Off draws nothing and runs no timer. |
| `teams` | empty | The teams to follow, comma-separated. Empty follows every game. |
| `source` | `demo` | Where the scores come from. `demo` is the pretend feed. |
| `refresh` | `30` | Seconds between looks at the feed while a followed game is on, 10 to 300. With none on, the feed is read before the next start, at least every fifteen minutes. |
| `side` | `left` | The side column the cards stand in, `left` or `right`. |
| `band` | `auto` | The row above the prompt. `auto`: where no card shows. `on`: always. `off`: never. |
| `alerts` | `true` | Toasts for scores and finals. |

## What it can touch

- **Network:** none. The pretend feed is worked out on your machine.
- **Files:** none. **Processes:** none. **Model calls:** none. **Environment:** none.
- **Memory:** the games, the session's choices and a count of looks live in session state. Nothing is written to disk by the mod.

## Limits

- **The pretend feed only, for now.** Real scores come in a later version, from a feed chosen for what its terms allow. The games, teams and leagues in this version are made up.
- **The cards need a scene behind the chat**, which only the desktop app draws. A mod that draws its scene without letting the mods beneath it draw over it hides the cards; then the row above the prompt shows instead.
- **The cards stand at the top of a side column.** On a narrow window, or with the sidebar open over that column, they can cover part of the scene or sit under the sidebar; `/scores right` moves them.

## Built from a prompt

This mod was built from [the scorebug prompt](../../prompts/scorebug.md).

More mods: [the full catalogue](../../README.md#the-mods).
