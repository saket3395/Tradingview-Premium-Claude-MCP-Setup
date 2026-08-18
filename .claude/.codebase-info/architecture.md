# Architecture

*Last Updated: 2026-08-18*

## Overview

A local, single-user, analysis-only trading dashboard. One Node process serves a static SPA and a
JSON API. The API is a thin router over a set of mostly-pure engine modules in `lib/`. There is no
database, no auth, no build step, and no dependency install — the whole thing runs on Node built-ins.

```
                          ┌───────────────────────────────────────────────┐
  Browser (SPA)           │  server/server.mjs  (node:http / :https)       │
  public/index.html  ───► │  - serves public/*                             │
  public/app.js      ◄───►│  - routes table → lib/ engines (JSON API)      │
                          └───────────────┬───────────────────────────────┘
                                          │ imports (pure/near-pure engines)
        ┌─────────────┬──────────────┬────┴────────┬──────────────┬─────────────┐
        ▼             ▼              ▼             ▼              ▼             ▼
   lib/tv.mjs   lib/tpo.mjs   lib/history.mjs  lib/patterns   lib/minervini  lib/elliott
   (CDP bridge)  (scanner)     (OHLC cache)     lib/breakouts  (VCP/SEPA)    (wave count)
   lib/signals   lib/upstox    lib/ratelimit    lib/journal    lib/backtest  lib/analytics
        │             │              │             │              │             │
        ▼             ▼              ▼             ▼              ▼             ▼
  TradingView    TradingView    Upstox +       data/journal   Upstox 1-min   NIFTY daily
  Desktop (CDP   scanner.tv     Alpaca REST    .json (local)  candles        (Upstox) +
  :9222)         .com/scan      (history)                                    Monte Carlo/HMM
```

## Components

| Component | Where | Responsibility |
|---|---|---|
| HTTP server + API router | `server/server.mjs` | `.env` load, optional TLS, static file serving, `routes` table, error → 500 JSON |
| SPA | `public/index.html`, `app.js`, `style.css` | Tab UI (default view = "Start Here" onboarding), 7s poll of `/api/snapshot`, on-demand tab fetches |
| CDP bridge | `lib/tv.mjs` | Talk to TradingView Desktop over CDP: read chart/legend/watchlist, switch symbol, Pine (CLI) |
| Signal parser | `lib/signals.mjs` | Pure: chart legend rows → intraday decision metrics |
| TPO scanner | `lib/tpo.mjs` | Full-universe scan via TradingView scanner; fixed entries, freeze, state machine, circuit clamp |
| Circuit lookup | `lib/upstox.mjs` | Real NSE upper/lower circuit at Confirm (Upstox market-quote) |
| History provider | `lib/history.mjs` | Multi-TF OHLC (Upstox NSE / Alpaca US), disk+memory cache, symbol search |
| Rate limiter | `lib/ratelimit.mjs` | ONE process-wide throttle + circuit breaker per provider |
| Analysis engines | `lib/patterns.mjs`, `lib/minervini.mjs`, `lib/elliott.mjs`, `lib/breakouts.mjs` | Rule-based structural analysis over real OHLC |
| Forward-test journal | `lib/journal.mjs`, `lib/backtest.mjs`, `lib/analytics.mjs` | Record frozen plans, resolve outcomes, backtest, Monte Carlo/HMM |
| Shared primitives | `lib/indicators.mjs`, `lib/rs.mjs` | SMA/ATR/pivots/ZigZag/RSI; percentile RS Rating |

## Boundaries

- **Analysis only.** No order/trade endpoints exist anywhere. All credentials in play are
  *data* credentials (Upstox read, Alpaca market-data, TradingView session cookie).
- **Never fabricate.** A missing provider/timeframe returns `{ ok:false, error }` and the UI
  reports "no data" rather than guessing. This is a load-bearing convention (see `patterns.md`).
- **Engines are pure where possible.** `signals`, `indicators`, `patterns`, `minervini`,
  `elliott` operate on data passed in; only `tv`, `history`, `upstox`, `tpo`, `rs`, `analytics`,
  `backtest` do I/O.

## The four external data sources

1. **TradingView Desktop via CDP** (`http://127.0.0.1:9222`) — live chart symbol/interval/legend,
   watchlist, best-effort symbol switch, session cookie, Pine editor (CLI only). `lib/tv.mjs`.
2. **TradingView scanner** (`scanner.tradingview.com/<region>/scan`) — full-universe day-level
   fundamentals/technicals for the TPO scanner, breakout Stage-1 screen, and RS universe.
   `lib/tpo.mjs`, `lib/breakouts.mjs`, `lib/rs.mjs`. Symbol autocomplete uses
   `symbol-search.tradingview.com`.
3. **Upstox** (`api.upstox.com`, `assets.upstox.com`) — NSE historical candles, 1-min backtest
   candles, NIFTY daily for the HMM, and real per-stock circuit at Confirm. `lib/history.mjs`,
   `lib/backtest.mjs`, `lib/analytics.mjs`, `lib/upstox.mjs`. Needs a token (Analytics token
   recommended). Behind Cloudflare — hence the shared limiter.
4. **Alpaca** (`data.alpaca.markets`) — US equity bars for Pattern/VCP/Elliott/Breakout tabs.
   `lib/history.mjs`. Market-data only; free IEX feed by default.

## Key request flows

- **Start Here (onboarding):** `GET /api/setup` → `cdpStatus()` + env-presence checks → `{ cdp,
  nse, us, port }` (booleans only, no secrets). Rendered once on load as setup-status tiles; the
  default view.
- **Dashboard poll:** `GET /api/snapshot` → `attachVisibleChart()` → `readChart`/`readIndicators`/
  `readWatchlist` (CDP) → `parseSignals` → JSON. Every 7s while a chart tab is active.
- **TPO scan:** `GET /api/tpo/scan[/usa]` → `scanTPO(cfg, region)` → TradingView scanner → score,
  freeze plan per symbol/day, compute State, clamp to assumed circuit → JSON. Plans recorded to
  the journal.
- **TPO Confirm:** `POST /api/tpo/confirm` → `getCircuit()` (Upstox, India) re-clamps plan +
  `setSymbol` on the live chart → read live OHLC + profile legend rows.
- **Pattern / VCP / Elliott:** `GET /api/{patterns,vcp,elliott}?symbol=` → `getSeries(symbol)`
  (cached OHLC) → the matching engine builder. Shared cache means switching tabs on one symbol is free.
- **Breakouts:** `GET /api/breakouts` → `scanBreakouts()` → scanner Stage-1 screen → run the chosen
  engine (patterns|vcp|elliott) on a rate-limit-bounded shortlist. 10-min result cache per filter.
- **Testing/Analytics:** `GET /api/test/summary`, `POST /api/test/backtest`, `GET /api/analytics`
  read `data/journal.json` outcomes; backtest replays journaled India plans against Upstox 1-min bars.

See [communication.md](communication.md) for the full route table and [modules.md](modules.md) for
per-engine detail.
