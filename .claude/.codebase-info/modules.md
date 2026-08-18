# Modules (`lib/`)

*Last Updated: 2026-08-18*

Every module is an ES module exporting named functions. I/O is isolated to the provider modules
(`tv`, `history`, `upstox`, `tpo`, `rs`, `backtest`, `analytics`); the rest are pure over data
passed in. Line numbers are anchors, not contracts.

## CDP / live-chart layer

### `lib/tv.mjs` — TradingView Desktop CDP bridge (also a CLI)
Talks to TradingView over CDP at `BASE = TV_CDP || http://127.0.0.1:9222` using a raw built-in
`WebSocket`. Key exports: `cdpStatus()` (health, never throws), `attachVisibleChart()`,
`readChart(cl)`, `readIndicators(cl)`, `readWatchlist(cl)`, `setSymbol(cl, symbol)` (best-effort
symbol switch via the search dialog), `getSessionCookie()` (cached ~60s, degrades to `''`),
Pine helpers `readPine`/`writePine`/`compilePine`, `ev(cl, expr)` (evaluate in page), `activateTV()`.
Used by: `server/server.mjs`. Depends on: Node built-ins only.

### `lib/signals.mjs` — legend → decision metrics (pure)
`parseSignals(rows, chart)` turns chart-legend rows + chart meta into the Signal-Summary object
(bias, long/short, strength, trend, volume confirm, risk, best setup, entry readiness, VWAP
location, session phase…). `sessionPhase(symbol, now)` classifies intraday phase. No I/O.

## Scanner / TPO layer

### `lib/tpo.mjs` — full-universe TPO scanner engine
`scanTPO(cfg, marketKey)` posts to `scanner.tradingview.com/<region>/scan`, scores each name
(profile-*informed*, not letter-by-letter TPO), and for qualifying names **freezes a plan per
symbol per session-date** (entry anchored to a fixed level — today's open / prior close — so it
does not drift with LTP). `computeState()` is the **signal state machine**: ARMED / VALID /
EXTENDED / INVALID / TARGET / EXPIRED. `clampToCircuit(plan, upper, lower, source)` caps
targets/stops to a circuit band and recomputes R:R (reused by Confirm with the real circuit).
`post(region, body, cookie)` is the scanner POST helper. Records frozen plans into the journal.
Depends on: `lib/journal.mjs`, `lib/indicators.mjs`, `lib/tv.mjs` (cookie).

### `lib/upstox.mjs` — real NSE circuit (Confirm)
`instrumentKeyFor(symbol)` maps an NSE symbol to an Upstox instrument key (via the cached
`assets.upstox.com` NSE instrument dump). `getCircuit(symbol)` calls Upstox market-quote to return
`{ ok, upper, lower, ltp }` or `{ ok:false, reason }` if the token is missing/stale. India-only.
Depends on: `lib/ratelimit.mjs`.

### `lib/rs.mjs` — percentile RS Rating
`rsTable(marketKey)` ranks a market's universe (NSE vs NSE, US vs US) via the TradingView scanner
behind a market-cap + turnover floor; `rsFor(symbol, marketKey)` returns a symbol's percentile.
Used by `lib/minervini.mjs`. Depends on: `lib/tpo.mjs` `post()` / scanner.

## History / analysis layer

### `lib/history.mjs` — multi-timeframe OHLC + cache + search
`getSeries(symbol)` is the workhorse: returns `{ ok, tfs: {4H,1D,1W,1M}, ... }` from **Upstox**
(NSE: day/week/month native, 4H aggregated from 30-min anchored to 09:15 IST) or **Alpaca** (US
native 4Hour/1Day/1Week/1Month). Two-level cache: 5-min symbol cache + per-window `_bars` cache
with `ttlFor()` lifetimes (weekly/monthly fetched once; everything held until next NSE open while
shut), persisted to `data/history_cache.json` (debounced). `searchSymbols(q)` proxies
`symbol-search.tradingview.com` filtered to NSE/NASDAQ/NYSE/AMEX. `cacheStatus()` / `estimateCost()`
answer the Cached-Data tab ("will analysing this symbol fetch?") without hitting a provider.
Depends on: `lib/upstox.mjs` (instrument key), `lib/ratelimit.mjs`.

### `lib/ratelimit.mjs` — shared throttle + circuit breaker
`limitedFetch(url, opts, provider)` funnels every provider call through ONE per-provider limiter
(concurrency + min gap + rolling per-minute ceiling) and a shared circuit breaker. Critical because
`api.upstox.com` is behind Cloudflare, whose IP-level `error code: 1015` block is triggered by
*total* machine request rate — so `history`, `backtest`, `analytics`, and `upstox` must share one
limiter. A 429 **never retries in place**: it trips the breaker (`breakerState`, `resetBreaker`),
and while open every call fails instantly with the remaining wait, sending no traffic. Limits are
resolved lazily from env (`NSE_CONCURRENCY/MIN_GAP_MS/MAX_PER_MIN`, with the legacy
`UPSTOX_CONCURRENCY/MIN_GAP_MS/MAX_PER_MIN` still honored) because `.env` loads after imports. The
internal per-provider keys stay `Upstox`/`Alpaca`; `providerStatus()` maps them to neutral display
labels (`NSE data`/`US data`) and surfaces live pacing/breaker state to the Cached-Data tab.

### `lib/indicators.mjs` — shared primitives (pure)
`sma`, `atr`, `pivots`, `lineFit`, `zigzag`, `rsi`, `slopePct`, `volRatio`, `r2`, `clamp`,
`evidence`. Used by every analysis engine.

### `lib/patterns.mjs` — Weinstein stage + chart patterns (pure)
`stageOf(bars, A)` = Weinstein stage; `analyzeTF(bars, tf)` detects rectangle/triangles/wedges/
channels/flags/pennant/cup&handle/VCP/double top-bottom/H&S+inverse/breakout/breakdown/retest/
continuation-reversal, each with Status · Confidence% · Score/10 (adjusted for higher-TF alignment);
`buildReport(series)` assembles the top-down Monthly→Weekly→Daily→4H report + S/R confluence.
Depends on: `lib/indicators.mjs`.

### `lib/minervini.mjs` — SEPA / VCP (near-pure; RS does I/O)
`buildVCP(series)` runs the 8-criterion Trend Template (≥7/8), a true percentile RS Rating
(`lib/rs.mjs`), volatility-contraction base detection (2–6 contractions, ≥5 weeks, ≤35% deep,
volume dry-up), and the trade plan (pivot, low-cheat entry, stop at tighter of final-contraction
low or −7%, 2R/3R, sizing). Verdict: BUY-READY / SETUP FORMING / EXTENDED / WATCH / FAIL.
Depends on: `lib/indicators.mjs`, `lib/rs.mjs`.

### `lib/elliott.mjs` — Elliott Wave counting (pure)
`countTF(bars, tf)` counts impulse + simple corrections at one degree; `buildElliott(series)`
counts across all four degrees, generates alternates by re-running swing detection at four ATR
thresholds, and returns an explicit invalidation price. Confidence capped at 75%. Scope:
zigzag/flat/contracting triangle only. Depends on: `lib/indicators.mjs`.

### `lib/breakouts.mjs` — "closest to breakout" scanner
`scanBreakouts({ engine, market, tf, patternType, candidates, cfg })` runs a Stage-1 universe
screen (uptrend filters via scanner) then runs the chosen engine — `patterns` | `vcp` | `elliott`
— on a rate-limit-bounded shortlist (`candidates`, default 10), listing only pivots within ~5%
above price. Exports `TIMEFRAMES`, `PATTERN_TYPES`. Result cached ~10 min per filter combo.
Depends on: `lib/patterns.mjs`, `lib/minervini.mjs`, `lib/elliott.mjs`, `lib/history.mjs`, scanner.

## Forward-test / analytics layer

### `lib/journal.mjs` — forward-test journal
Records every frozen plan (`recordPlan`) and resolves outcomes from later scans (`observePlan`):
a plan **counts as a trade only once it reached VALID** (real fill); never-filled plans are MISSED.
WIN = T1 hit (R = planned R:R), LOSS = stop (R = −1), SCRATCH = expired-mark-to-last. `stats()`,
`gates(s, g)`, `summary(gateCfg)`, `allTrades()`, `attachBacktest()`, `sweepStale()`. Persisted to
`data/journal.json` (debounced). No mock data, no hindsight.

### `lib/backtest.mjs` — India 1-minute replay
`runBacktest(gateCfg, limit)` replays journaled India plans against real Upstox 1-minute candles
(one request per plan — the heaviest Upstox caller; goes through the shared limiter).
Depends on: `lib/journal.mjs`, `lib/upstox.mjs`, `lib/ratelimit.mjs`.

### `lib/analytics.mjs` — Monte Carlo + HMM + robustness
`buildAnalytics({ riskPct })` from real journal outcomes: `monteCarlo(rs, …)` bootstrap (equity
bands, max-DD, risk-of-ruin), `fitHMM(obs, k, iters)` Gaussian HMM market regime on real NIFTY
daily returns (`niftyDailyReturns()` via Upstox) with per-regime PF/WR, and `robustness(trades)`
(expectancy ±SE, SQN, threshold sensitivity, rolling PF). Depends on: `lib/journal.mjs`,
`lib/ratelimit.mjs`.

## Dependency edges (who imports whom)
```
server.mjs → tv, signals, tpo, upstox, journal, backtest, analytics, history, ratelimit,
             patterns, minervini, elliott, breakouts
tpo        → journal, indicators, tv(cookie)         history → upstox, ratelimit
breakouts  → patterns, minervini, elliott, history   minervini → indicators, rs
backtest   → journal, upstox, ratelimit              analytics → journal, ratelimit
patterns/elliott/signals → indicators                rs → tpo(scanner)/scanner
upstox → ratelimit                                   indicators → (leaf)
```
