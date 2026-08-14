# Communication — API & External Integrations

*Last Updated: 2026-08-14*

## Internal JSON API (`server/server.mjs` `routes`)

All responses are JSON with `cache-control: no-store`. Handler errors → HTTP 500 `{ error }`.
Engine-level failures degrade to `{ ok:false, error|reason }` (HTTP 200). Static files under
`public/` serve everything else.

| Method & path | Handler → engine | Purpose | External calls |
|---|---|---|---|
| `GET /api/status` | `cdpStatus()` | CDP up/down, app version, chart-tab count | CDP :9222 |
| `GET /api/config` | reads `config/markets.json` | UI config | — |
| `GET /api/snapshot` | `attachVisibleChart`+`readChart/Indicators/Watchlist`+`parseSignals` | Poll loop: live chart + signals + watchlist | CDP :9222 |
| `POST /api/chart/symbol` | `setSymbol` | Best-effort switch active chart symbol | CDP :9222 |
| `GET /api/tpo/scan` | `scanTPO(cfg.india,'india')` | India TPO Stage-1 scan | TV scanner |
| `GET /api/tpo/scan/usa` | `scanTPO(cfg.usa,'usa')` | USA TPO Stage-1 scan | TV scanner |
| `POST /api/tpo/confirm` | `getCircuit` + `setSymbol`+`readChart/Indicators` | Deep confirm: real NSE circuit re-clamp + live on-chart levels | Upstox + CDP :9222 |
| `GET /api/test/summary` | `journalSummary(gates)` | Forward-test PF/WR/RR + gate pass/fail | — (reads journal.json) |
| `POST /api/test/backtest` | `runBacktest(gates, limit)` | India 1-min replay of journaled plans | Upstox (1/plan) |
| `GET /api/analytics` | `buildAnalytics({riskPct})` | Monte Carlo + HMM regime + robustness | Upstox (NIFTY daily) |
| `GET /api/patterns?symbol=` | `getSeries`→`buildReport` | Top-down multi-TF pattern report | Upstox/Alpaca |
| `GET /api/vcp?symbol=` | `getSeries`→`buildVCP` | Minervini SEPA/VCP screen | Upstox/Alpaca + TV scanner (RS) |
| `GET /api/elliott?symbol=` | `getSeries`→`buildElliott` | Elliott Wave count + alternates | Upstox/Alpaca |
| `GET /api/breakouts?region&tf&pattern&type` | `scanBreakouts(...)` | Closest-to-breakout (patterns\|vcp\|elliott) | TV scanner + Upstox/Alpaca |
| `GET /api/symbols?q=` | `searchSymbols(q)` | Symbol autocomplete (NSE/NASDAQ/NYSE/AMEX) | TV symbol-search |
| `GET /api/cache` | `cacheStatus()`+`providerStatus()` | What OHLC is held locally + provider pacing | — (local only) |
| `GET /api/cache/cost?symbol=` | `estimateCost(symbol)` | "Will analysing this fetch?" | — (local only) |

Route dispatch is an exact `"METHOD /pathname"` match (`server/server.mjs:269`); query params are
parsed inside each handler. There are **no order/trade routes** — by design.

## External integrations

### 1. TradingView Desktop over CDP — `http://127.0.0.1:9222`
Raw WebSocket (`lib/tv.mjs`). Reads active chart symbol/interval, indicator legend, watchlist;
best-effort symbol switch; session cookie (for authenticated scanner reads); Pine editor (CLI).
Requires TradingView launched with `--remote-debugging-port` (`scripts/tv-debug.sh`) **and a chart
tab active** (hidden tabs are DOM-suspended). Also consumed independently by `chrome-devtools-mcp`
via `.mcp.json`.

### 2. TradingView web endpoints (anonymous/cookie'd `fetch`)
- `scanner.tradingview.com/<region>/scan` — full-universe day-level scan. Used by `lib/tpo.mjs`
  (TPO), `lib/breakouts.mjs` (Stage-1 screen), `lib/rs.mjs` (RS universe). Sends
  `origin/referer: tradingview.com` headers; optional session cookie from CDP.
- `symbol-search.tradingview.com/symbol_search/` — autocomplete (`lib/history.mjs:458`),
  filtered server-side to exchanges the app can fetch history for.

### 3. Upstox — `api.upstox.com`, `assets.upstox.com` (behind Cloudflare)
- `assets.upstox.com/.../NSE.json.gz` — NSE instrument dump → instrument keys (`lib/upstox.mjs`).
- `api.upstox.com/v2/historical-candle/...` — NSE OHLC (`lib/history.mjs`), intraday 1-min for
  backtest (`lib/backtest.mjs`), NIFTY daily for HMM (`lib/analytics.mjs`).
- `api.upstox.com/v2/market-quote/quotes` — real per-stock circuit at Confirm (`lib/upstox.mjs`).
- **Auth:** token JSON at `UPSTOX_TOKEN_FILE` (Analytics token recommended — ~1yr, read-only, no
  daily refresh). Absent/stale → circuit falls back to assumed band; history/backtest/analytics
  return `no data` honestly. **All Upstox calls share ONE limiter + breaker** (`lib/ratelimit.mjs`)
  because Cloudflare's `error code: 1015` is an IP-level, total-rate block.

### 4. Alpaca — `data.alpaca.markets/v2/stocks/bars`
US equity 4H/1D/1W/1M bars (`lib/history.mjs:302`). **Market-data only** — no trading endpoint.
Auth via `ALPACA_KEY_ID`/`ALPACA_SECRET_KEY`; `ALPACA_FEED=iex` (free default) or `sip`. Absent →
US symbols report "no history source".

## No events / queues / DB
No message bus, no websocket server of its own, no datastore. "Persistence" is two local JSON files
(`data/journal.json`, `data/history_cache.json`) written debounced from memory. See
[patterns.md](patterns.md).
