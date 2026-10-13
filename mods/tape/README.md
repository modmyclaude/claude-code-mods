# Tape

A ticker tape above the prompt: live stock, index, gold, FX and crypto prices, keyless by default.

## Install

```
/plugin install tape --marketplace modmyclaude/claude-code-mods
```

## Use it

- **The band.** One row above the prompt: `tape · hyperliquid perps │ AAPL 346.16 +0.3%   NVDA 225.55 -1.2%   SP500 7,798 -0.1%   BTC 83,508 +2.1%`. Up in the theme's green, down in its red, unchanged dim; a sign and a colour, nothing else. The lead cell names the source, and adds `· 2m old` when the last fetch failed and the prices shown are the last good ones. The tape runs out under the divider after it, so the cell on its way out is cut there, as on any ticker.
- **Keyless by default.** Prices come from Hyperliquid's public info API: stocks, indices, gold and FX from its `xyz` market (`AAPL`, `NVDA`, `SP500`, `GOLD`, `EUR` and about a hundred more), crypto from its main market (`BTC`, `ETH`, `SOL` and the rest). These are perpetual-contract mid prices, not exchange quotes: close to the market, not the market itself. The band says so in its lead cell. A symbol Hyperliquid does not list draws as `SYM ?`, with one line in the transcript.
- **Your own Alpaca key, if you have one.** Put your Alpaca key id and secret in `/config` and stock symbols come as real-time IEX quotes from Alpaca's market data under your own account (the free plan is enough); crypto stays on Hyperliquid. The lead cell then reads `alpaca iex`. The keys are stored as secrets and never drawn or logged. If Alpaca refuses them, one transcript line says so and stocks go back to Hyperliquid until the keys change.
- **Motion.** `scroll`, the default, is a marquee that moves four cells a second (`speed`, one to ten). Every step redraws the band: on one machine that cost about 5% of a core per session at four cells a second, 1.3% per cell a second, all day, idle or not. `rotate` shows pages of whole symbols that fit the band, flipped every eight seconds, with no redraw in between, and added half a percent. Running many sessions at once, set `motion` to `rotate` in `/config`. `/tape scroll` and `/tape rotate` switch for the session.
- **Commands.** `/tape` writes the list and the source to the transcript. `/tape add NVDA` and `/tape remove NVDA` change the list for this session (the lasting list is the `symbols` setting). `/tape off` hides the band for the session and stops fetching; `/tape on` brings it back.
- **Failures.** The last good prices stay on the band; nothing goes blank. After a failure or a rate limit the wait before the next fetch doubles, up to five minutes, and resets on the next success.
- **The quiet switch.** With `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set, tape makes no request at all and the band reads `tape off: nonessential traffic disabled`.
- While a survey holds the band, tape steps aside; other mods' bands keep drawing above it.

## Settings

Every setting has a default, so the notice at install about options not yet set is expected; change them in `/config`.

| Setting | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Off draws nothing, runs no timer and fetches nothing. |
| `symbols` | `AAPL,NVDA,TSLA,AMZN,SP500,GOLD,BTC,ETH` | The symbols, comma-separated, forty at most. Stocks, indices, gold and FX as Hyperliquid lists them; crypto by name. |
| `refresh` | `10` | Seconds between fetches, at least 5. |
| `motion` | `scroll` | `scroll` or `rotate`, the low-power choice. |
| `speed` | `4` | Cells a second when motion is `scroll`, 1 to 10. |
| `rotateSeconds` | `8` | How long each page shows when motion is `rotate`. |
| `alpacaKey` | empty | Optional. Your Alpaca key id; stored as a secret. |
| `alpacaSecret` | empty | Optional. Your Alpaca secret key; stored as a secret. |

## What it can touch

- **Network:** one host by default, `api.hyperliquid.xyz`, two request kinds, each carrying nothing but the request type and the market name; a second host only when you add Alpaca keys, `data.alpaca.markets`, carrying your symbol list and your key. Never your prompts, code, project name or anything of the session. The mod ships no key of its own and relays nothing.
- **Environment:** reads `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`.
- **Files:** none. **Processes:** none. **Model calls:** none.
- **Memory:** the last good prices and the band's state live in session state; your Alpaca keys live in the engine's secret settings. Nothing is written to disk by the mod.

## Limits

- **Hyperliquid prices are perpetual-contract mids**, the midpoint of a derivatives market that tracks the asset, not the exchange's last trade. They can sit a little off the quote, and outside market hours they can keep moving while the exchange is closed. The choice of source is yours: Alpaca's IEX quotes are exchange prices, under your own account.
- **Hyperliquid's own terms** apply to its API; the mod uses the public, keyless endpoints and sends nothing of yours. Whether the service is available where you are is between you and Hyperliquid.
- **Alpaca's free plan** gives IEX-venue prices in real time and 200 requests a minute; tape makes one request per refresh for all your stock symbols. SIP (full-market) data is not on the free plan.
- **The 24 h change** is read from each source's own earlier price and shows `--` until that has arrived, about a minute after the band first draws.
- **The desktop app draws text in a proportional font**, narrower than the cells the band counts, so there the band packs about a quarter more than the count says. A page can still cut its last price at the right edge when the symbols run long.
- A symbol list is capped at forty, and each symbol at sixteen characters of letters, digits, colon, dot and dash; anything else is dropped before it is drawn.

## Built from a prompt

This mod was built from [the tape prompt](../../prompts/tape.md).

More mods: [the full catalogue](../../README.md#the-mods).
