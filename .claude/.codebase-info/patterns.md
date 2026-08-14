# Patterns & Conventions

*Last Updated: 2026-08-14*

Conventions here are load-bearing — several are enforced by comments rather than tooling. Preserve
them when editing.

## 1. Never fabricate data
The single strongest rule. Any missing credential, provider failure, or empty timeframe returns
`{ ok:false, error|reason }` and the UI reports "no data" / "no history source" — it **never**
guesses or synthesises prices. Applies across `history`, `backtest`, `analytics`, `upstox`, and the
analysis engines. When adding a source or timeframe, follow this: fail honestly, don't interpolate.

## 2. Analysis only — no execution
There are no order/trade endpoints or broker write calls anywhere, deliberately. Every credential is
a *data* credential (Upstox read, Alpaca market-data, TradingView session). Do not add trading code.

## 3. Frozen plans + signal state machine (`lib/tpo.mjs`)
A TPO signal anchors its entry to a **fixed** session level (today's open / prior close) and the
whole plan is **frozen per symbol per session-date** — it does not drift with each LTP tick. A plan's
`State` (`computeState()`) classifies where price is: **ARMED** (waiting) → **VALID** (in entry zone)
→ **EXTENDED** (>0.5R past entry, don't chase) → **TARGET**/**INVALID**/**EXPIRED**. This state is
also what gates journal accounting (see #7).

## 4. Circuit-awareness (India), assumed → real
Stage-1 clamps targets/stops to an **assumed** circuit band (`tpo.india.circuitBandPct`, default
10%) via `clampToCircuit()`. Confirm replaces it with the **real** per-stock Upstox circuit and
re-clamps + recomputes R:R. The same `clampToCircuit()` is reused for both — generic over long/short.

## 5. ONE shared rate limiter + circuit breaker per provider (`lib/ratelimit.mjs`)
`api.upstox.com` is behind Cloudflare, whose `error code: 1015` is an **IP-level, total-rate** block
(minutes long), not a per-endpoint quota. Therefore all four Upstox callers (`history`, `backtest`,
`analytics`, `upstox`) funnel through one limiter (concurrency + min-gap + rolling per-minute ceiling)
and one breaker. A 429 **never retries in place** — it trips the breaker; while open, calls fail
instantly with the remaining wait and send zero traffic (sending nothing is what lets the block
expire). Limits resolve **lazily** from env because `.env` loads after module imports. Never add a
provider call that bypasses `limitedFetch`.

## 6. Layered caching, matched to how often data changes (`lib/history.mjs`)
- Symbol-level cache (5 min) for snappy tab flips.
- Per-window `_bars` cache with `ttlFor()`: weekly/monthly fetched **once** (rebuilt from daily);
  while the market is shut everything is held until the next NSE open; intraday short-lived.
- Settled windows persisted to `data/history_cache.json` (debounced, `unref`'d timer, capped ~200
  entries) so a restart doesn't trigger a refetch storm into the Cloudflare block.
- The debounced disk writer must **defer, not drop** a write (a past bug dropped writes inside the
  window) — keep that invariant if you touch it.

## 7. Journal counts only real fills (`lib/journal.mjs`)
A frozen plan counts toward PF/win-rate **only once its state actually reached VALID** (price traded
into the entry zone — a real trader could have filled). Plans that skip straight to TARGET/INVALID/
EXPIRED are **MISSED** (a fill-rate stat), not trades. WIN = T1 hit (R = planned R:R), LOSS = stop
(R = −1), SCRATCH = expired mark-to-last. No hindsight, no mock outcomes.

## 8. Error handling
- Provider/health probes (`cdpStatus`, `getSessionCookie`) **never throw** — they degrade.
- Engines return result objects, not exceptions, across the API boundary.
- The router has one top-level `try/catch` → HTTP 500 `{ error: e.message }` for anything that does throw.

## 9. Config over constants
Thresholds live in `config/markets.json` (`tpo.*`, `breakouts.*`, `testing.gates`, `pollSeconds`);
env in `.env`. Prefer adding a config key over hardcoding a number.

## 10. Zero dependencies + heavy "why" comments
No npm packages, no build. Match the existing style: terse code, but generous top-of-file block
comments explaining the *reasoning* (rate limits, caching TTLs, fabrication policy, past bugs). Those
comments are the project's design record — update them when the behaviour changes.

## Testing
There is **no automated test suite / runner**. Verification is manual against a live TradingView
session (`npm run tv -- status`, the dashboard, the CLI). The `pine/example-broken.pine` fixture
exists to exercise `pine:compile` failure handling. "Testing" in the UI means the **forward-test
journal + backtest**, not unit tests.
