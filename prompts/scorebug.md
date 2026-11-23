---
mod: scorebug
title: Scorebug
tagline: Live scores beside the chat, in a side column of the scene in the desktop app and one row above the prompt everywhere else.
category: fun
surfaces: [terminal, desktop]
model_calls: none
full_from: 2.1.325
draft: true
---

# Scorebug

Live scores beside the chat, in a side column of the scene in the desktop app and one row above the prompt everywhere else.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build a Claude Code mod called scorebug: live scores for the teams I follow, shown beside the chat.

In the desktop app, when a scene stands behind the chat (any mod's), draw a card for each followed game in a side column of that scene: a `ui.render` hook on `Backdrop`, on the desktop surface only, that calls `next(e)` and lays a column of cards over what comes back, at the top of the left column, three cells in. Every plugin's Backdrop hook is asked in an order no one sets: when `next(e)` comes back empty (the scene's own hook is asked first), answer with the cards alone, so a scene's hook that lays what the hooks beneath it draw over its own scene shows them. Each card: a caption with what the game is at (`LIVE  P2 12:41`, `END OF P1`, `FINAL`, `STARTS IN 2 MIN`), each team's short code and score away first, the side ahead in bold, a footnote with who plays where; a dark card that reads over any scene, its edge lit while the game is on. Live first, then to come, then finished, four at most.

Everywhere else (the terminal, the phone, the desktop app with no scene) draw the same games in one row above the prompt: `scores │ RDG 1 HBR 2 P2 12:41   LKS 54 FDY 61 Q3 4:12`, beneath what other mods draw there, live bright and the rest dim; step aside while a survey holds the band. A drawing hook may not write state, so count the looks in state, note in a module value the count at which the cards were last drawn, and let the row step aside in the desktop app while that count is this one or the one before.

Look at the feed on a timer: every `refresh` seconds (30, 10 to 300) while a followed game is on, else before the next start, at least every fifteen minutes; double the wait after a failure, up to five minutes. Write the games only when they change. Toast when a followed team scores in a game of goals or runs, and when a followed game ends; a game of points toasts only its end; a game seen for the first time says nothing.

The first feed is a pretend one: two made-up games that play on the clock in fifteen-minute rounds (a minute before the start, nine minutes of play cut into periods with short breaks, then the final), one of goals in three periods and one of points in four quarters, scored from a hash of the round number so every engine and every reload sees the same game. No real team or league names anywhere.

Commands: `/scores`, `/scores on`, `/scores off`, `/scores left`, `/scores right`. Settings: `enabled`, `teams` (comma-separated codes or names, empty follows all), `source` (`demo`), `refresh`, `side`, `band` (`auto`, `on`, `off`), `alerts`.
```
