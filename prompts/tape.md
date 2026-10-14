---
mod: tape
title: Tape
tagline: A ticker tape above the prompt: live stock, index, gold, FX and crypto prices, keyless by default.
category: fun
surfaces: [terminal, desktop]
model_calls: none
draft: true
---

# Tape

A ticker tape above the prompt: live stock, index, gold, FX and crypto prices, keyless by default.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build a Claude Code mod called tape: a band above the prompt that scrolls live prices for the symbols I pick.

Prices come, with no key, from Hyperliquid's public info API: `POST https://api.hyperliquid.xyz/info` with `{"type":"allMids","dex":"xyz"}` for stocks, indices, gold and FX (symbols come back as `xyz:AAPL`, `xyz:SP500`, `xyz:GOLD`) and `{"type":"allMids"}` for crypto (`BTC`, `ETH`); `{"type":"metaAndAssetCtxs"}` on each market gives `prevDayPx` for the day's change. These are perpetual-contract mid prices, so the band's lead cell says `hyperliquid perps`. When I add my own Alpaca key id and secret in secret settings fields, stock symbols come instead from one `GET https://data.alpaca.markets/v2/stocks/snapshots?symbols=...&feed=iex` per refresh with the `APCA-API-KEY-ID` and `APCA-API-SECRET-KEY` headers, crypto stays on Hyperliquid, and the lead cell says `alpaca iex`. The keys are never drawn or logged; a 401 says so once and falls back.

The row: the lead cell, then each symbol, its price (commas from a thousand, two decimals below) and its change with a sign and one decimal, up in the theme's success colour, down in its error colour, unchanged dim. No arrows, no block glyphs. Motion: `scroll` by default, a marquee moving a few cells a second (a `speed` setting, four by default, ten at most), with a divider after the lead cell where the tape runs out; `rotate`, pages of whole symbols flipped every few seconds with one redraw a page, as the low-power choice for someone running many sessions. Both re-lay on a width change. Keep the last good prices in session state so a failed fetch never blanks the band; show `· 2m old` in the lead cell after a failure; double the wait after each failure up to five minutes and reset on success; one fetch timer only, restarted from state after a code reload. With `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set make no request and say so in the band. An `enabled` setting that draws nothing and fetches nothing when off. Yield while a survey holds the band, and keep other mods' bands drawing.

Commands: `/tape` (the list and the source), `/tape add SYM`, `/tape remove SYM`, `/tape on`, `/tape off`, `/tape scroll`, `/tape rotate`. Settings: `symbols` (default AAPL, NVDA, TSLA, AMZN, SP500, GOLD, BTC, ETH), `refresh` (10 s, at least 5), `motion`, `speed`, `rotateSeconds`, `enabled`, `alpacaKey` and `alpacaSecret` as secrets.

Send Hyperliquid nothing but the request type and the market name, never the symbol list; sanitise everything drawn from the network. Write the README's trust line plainly: which hosts, what each request carries, that nothing of the session ever leaves, and that Hyperliquid prices are perp mids, not exchange quotes.
```
