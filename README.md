# Tradingview-Premium-Claude-MCP-Setup

Analysis-only **intraday** trading **dashboard** for **TradingView Premium Desktop**, driven
through Claude Code + MCP over the Chrome DevTools Protocol (CDP).

- **Intraday-only.** 🇮🇳 India + 🇺🇸 USA **TPO scanners** (Market-Profile-informed, full-universe)
  and a 🇮🇳 India-intraday dashboard panel.
- One dashboard: **Signal Summary** with intraday decision metrics (bias, strength, trend,
  volume, risk, entry readiness…), the India-intraday fast-scan + checklist, and MCP/CDP health.
- **Stable entries:** every TPO signal anchors its entry to a *fixed* session level (today's
  Open / prior-day close) and freezes the whole plan per symbol per day — the entry does **not**
  drift with each LTP tick. A signal **State** (ARMED / VALID / EXTENDED / INVALID / EXPIRED) says
  when to act.
- **Circuit-aware (India):** targets never exceed the NSE upper circuit and stops never sit below
  the lower circuit — Stage-1 uses an assumed band, and **Confirm fetches the real per-stock
  circuit from the NSE data provider**.
- **No live trade execution.** No order endpoints exist in this codebase.

Zero npm dependencies (Node built-ins only). Reuses the verified CDP bridge from the
previous setup (`lib/tv.mjs`).

## New here? Start with the **Start Here** tab
The dashboard opens on a **Start Here** tab that, in plain English, explains what every tab does
(grouped into *live signals*, *analysis*, *idea scans* and *journal/stats*), shows your **live setup
status** (what is actually configured on your machine), lists a 5-minute path, and defines the jargon.
If you read nothing else here, read that tab.

### What works without any API keys?
Most of the dashboard runs with **no keys at all** — the two optional tokens only unlock the tabs that
need historical price data or the real NSE circuit.

| Feature | Needs |
|---|---|
| India / USA **TPO Scanners** — intraday setups with fixed entry/SL/target | **No keys** (TradingView's public scanner) |
| **Testing** journal + pass/fail gates | **No keys** (the India 1-minute backtest needs an NSE data token) |
| **Analytics** — Monte Carlo & robustness | **No keys** (the HMM market-regime model needs an NSE data token) |
| **Cached Data** — what's stored, will-this-fetch cost | **No keys** |
| **Dashboard** — live Signal Summary read | **TradingView running** (CDP on :9222) |
| **Pattern / VCP / Elliott / Breakout** — **NSE** symbols | **NSE data token** |
| **Pattern / VCP / Elliott / Breakout** — **US** symbols | **US market-data keys** |
| **Confirm** on India TPO (real NSE circuit) | **NSE data token** (falls back to an assumed band without one) |

### First 5 minutes
1. `npm run tv:debug` — relaunch TradingView so the dashboard can read it.
2. `npm start`, open **http://localhost:4178**, and keep a TradingView **chart tab active**.
3. On **Start Here**, check **Your setup status** — green means ready (the NSE and US data feeds are optional).
4. Open **Dashboard**, type a symbol (e.g. `RELIANCE` or `AAPL`) and press **Load** for a live read.
5. Try the **India TPO Scanner** — auto-found intraday setups, no API keys needed.

## Requirements
- macOS, **Node ≥ 20** (uses the built-in `WebSocket`; verified on Node 22)
- **TradingView Desktop** installed (`/Applications/TradingView.app`), logged in
- Optional: Claude Code, for the MCP bridge (`chrome-devtools-mcp`, wired in `.mcp.json`)

## Setup
```bash
git clone git@github.com:saket3395/Tradingview-Premium-Claude-MCP-Setup.git
cd Tradingview-Premium-Claude-MCP-Setup
cp .env.example .env            # optional; defaults work
```
No `npm install` needed (no dependencies).

## Run
**Easiest:** double-click `scripts/start.command` in Finder — it ensures CDP, starts the
dashboard, and opens it in your browser. Close that Terminal window to stop the server.

**Or from a terminal:**
```bash
npm run tv:debug                # quits + relaunches TradingView with CDP on :9222
npm start                       # dashboard at http://localhost:4178
```
Open **http://localhost:4178**. Keep a TradingView **chart tab active** (ideally on a second
monitor) — the dashboard reads whichever chart tab is currently active.

> **Why `tv:debug`?** TradingView only exposes CDP when launched with
> `--remote-debugging-port`. The script quits any running instance and relaunches with the
> flag (layouts are cloud-synced, so nothing is lost) and waits out the auto-updater.

## Dashboard sections
| Tab / Panel | What it does | Source |
|---|---|---|
| MCP / CDP health | CDP up/down, app version, chart-tab count | `GET /api/status` |
| Signal Summary | Active symbol/timeframe/close, RSI/EMA/SMA/BoP/VWAP **plus intraday decision metrics** (market bias, long/short, strength, confidence, trend, volume confirm, risk, best setup, trade quality, entry readiness, avoid-trade reason) + a *How to Use* guide | parsed chart legend |
| India — Intraday | Timeframes, **fast scan** of NSE/BSE watchlist, intraday trade checklist | watchlist + `config/markets.json` |
| India TPO Scanner | Full-NSE-universe profile-informed scan with **fixed entries, State, SL, circuit-capped targets, R:R**, on-chart **Confirm** (+ real NSE circuit) and a *How to Trade This Signal* guide | `GET /api/tpo/scan`, `POST /api/tpo/confirm` |
| USA TPO Scanner | Same engine for NASDAQ/NYSE/AMEX (no circuit clamp) | `GET /api/tpo/scan/usa` |
| Pattern Analysis | **Symbol autocomplete** (TradingView symbol search, filtered to NSE/NASDAQ/NYSE/AMEX — the exchanges history is actually available for) driving a **top-down multi-timeframe** (Monthly → Weekly → Daily → 4H) structural report for one symbol: **Weinstein stage** per timeframe, rule-based detection of rectangle / triangles / wedges / channels / flags / pennant / cup &amp; handle / VCP / double top-bottom / H&amp;S + inverse / breakout / breakdown / retest / trend continuation-reversal, each with **Status · Confidence % · Technical Score /10** (score adjusted for higher-timeframe alignment), plus multi-timeframe **support/resistance confluence** and a rule-based conclusion. Real OHLC only — the NSE data provider for NSE (4H aggregated from 30m), the US data provider for US; a timeframe with no data is reported missing, never guessed | `GET /api/symbols?q=…`, `GET /api/patterns?symbol=…` |
| VCP Analysis | **Mark Minervini SEPA** screen for one symbol: the **Trend Template** (8 criteria, ≥7/8 to proceed), a **true percentile RS Rating** (universe ranked via the existing TradingView scanner — NSE vs NSE, US vs US, behind a market-cap + turnover floor), **volatility-contraction** base detection (2–6 contractions, ≥5 weeks, ≤35% deep, volume dry-up), and the resulting **trade plan** (pivot, low-cheat entry, stop at the tighter of the final contraction low or −7%, 2R/3R targets, position sizing). Verdict is BUY-READY / SETUP FORMING / EXTENDED / WATCH / FAIL. Technical half of SEPA only — no earnings or sponsorship data | `GET /api/vcp?symbol=…` |
| Elliott Wave | **Impulse + simple correction** counting across all four degrees (Monthly=Primary → 4H=Minute). The three hard rules are absolute — a count breaking any is discarded, not downgraded; Fibonacci proportion, alternation, channelling and volume/momentum personality are guidelines that score it. Always returns **alternate counts** (generated by re-running swing detection at four ATR thresholds) and an explicit **invalidation price**. Confidence is capped at 75% because a wave count is an interpretation, not a measurement. Scope: zigzag/flat/contracting triangle — diagonals, truncations and WXY combinations are deliberately not counted | `GET /api/elliott?symbol=…` |
| Breakout-Patterns | Ranks the stocks **closest to clearing a chart-pattern pivot**. Filters: **timeframe** (4H/1D/1W/1M), **region** (India/USA), **chart pattern type**. Stage 1 screens the whole universe server-side (uptrend: above the 50- and 200-day MA, 6-month performance positive, within 15% of the 52-week high); Stage 2 runs the **same detectors as Pattern Analysis** on real OHLC for a bounded shortlist (`breakouts.candidates`, default 10) and lists only pivots within 5% above price. Long-only by definition — a breakout is the level *above* price | `GET /api/breakouts?region=…&tf=…&pattern=…` |
| VCP/Elliott-Breakout | Same two-stage pipeline, with the pivot measured by a methodology engine. **Type = VCP** runs the full Minervini screen and lists the final contraction's high with its stop and 2R/3R targets (daily by construction — the timeframe filter does not apply); **Type = Elliott Wave** counts at the chosen timeframe's degree and lists only a live up-impulse in wave 3 or 5, where the level to clear is the prior same-direction wave's extreme, with its invalidation price | `GET /api/breakouts?type=vcp\|elliott&region=…&tf=…` |
| Cached Data | Shows what OHLC history is held locally and — the question the rate limit makes worth asking — **whether analysing a given symbol costs upstream requests**. Type a symbol, press *Will this fetch?*: answered entirely from local state, never contacting a provider. Also surfaces each provider's live pacing and circuit-breaker state, so you can confirm what the server is actually using | `GET /api/cache`, `GET /api/cache/cost?symbol=…` |
| Testing | **Forward-test journal** of every frozen plan (a plan only counts toward PF/win-rate once it actually reached VALID — never-filled plans are "missed"), pass/fail **gates (PF ≥1.5 · WR ≥40% · R:R ≥1:2, n≥20)**, breakdowns by market/setup/confidence, and an on-demand **India 1-minute backtest** replaying journaled plans against the NSE data provider's real 1-minute candles | `GET /api/test/summary`, `POST /api/test/backtest`, `data/journal.json` |
| Analytics | **Monte Carlo** bootstrap of realized R-multiples (equity bands, max-DD, risk-of-ruin), **Gaussian HMM market regime** on real NIFTY daily returns (+ per-regime strategy PF/WR), and **robustness** (expectancy ±SE, SQN, threshold sensitivity, rolling PF) — all from real journal outcomes, never simulated prices | `GET /api/analytics` |

### Pre-expansion scanner logic (v2)
Each signal now carries a **Setup archetype** — `OPEN-DRIVE` (early one-sided auction, gap-aligned),
`IB-COIL` (range still compressed vs ATR but price holding the directional third on volume — the
pre-breakout state), `VALUE-EDGE` (opened beyond prior close, pullback being accepted — 80%-rule style),
or `EXPANSION` (move already happened; kept but score-penalized) — plus an **EQ (Entry Quality, 0–100)**
column combining an anti-chase penalty (day range vs ATR), time-of-day decay (post-IB structure fades),
and volume. Extension no longer earns entry points: an extended day proves direction, not entry.
The Signal Summary adds **Conviction, Location vs value (VWAP), Session phase** and a one-line verdict.

- **Fast scan**: your TradingView watchlist split by market (exchange prefix). Click a symbol
  to load it on the active chart (best-effort switch).
- **Checklists**: defined in `config/markets.json`; tick-state saved in the browser.
- **Signal State**: `VALID` = in the entry zone now · `ARMED` = waiting for the level ·
  `EXTENDED` = ran past entry, don't chase · `INVALID` = stop reached · `EXPIRED` = closed /
  late-session cutoff (`tpo.noNewEntryBeforeCloseMin`).

## CLI (same bridge, no server)
```bash
npm run tv -- status            # CDP health
npm run tv -- chart             # active symbol + interval
npm run tv -- indicators        # raw indicator legend rows
npm run tv -- pine:read
npm run tv -- pine:write pine/example-ema.pine
npm run tv -- pine:compile
```

## Configuration
- `config/markets.json` — India-intraday labels/exchanges/timeframes/checklist; `tpo` block:
  `refreshSeconds`, `noNewEntryBeforeCloseMin`, `testing.backtestLimit` (how many recent plans the 1-minute backtest replays — each costs one NSE-provider request), and per-market thresholds
  (`minScore`/`minRR`/`minRVol`/…). `tpo.india.circuitBandPct` is the **assumed** Stage-1 circuit
  band (default 10%); Confirm replaces it with the real NSE circuit.
- `.env` — `PORT`, `TV_CDP`, `TV_NO_ACTIVATE`, and the NSE data token file (path to a JSON
  `{"access_token":"…"}`; used only for the real NSE circuit at Confirm). **Recommended:** a
  read-only, long-lived **analytics token** — **~1-year validity**, supports the market-quote
  endpoint, and needs **no daily refresh**. A normal daily OAuth access token also works but expires
  each day. Absent/expired ⇒ Confirm falls back to the assumed band and says so. The US market-data
  keys (key id / secret / feed, default `iex`) are **market-data only** credentials used solely by
  the Pattern Analysis tab to fetch real 4H/1D/1W/1M bars for US symbols — no trading endpoint is
  ever called. Absent ⇒ US symbols report "no history source" instead of showing invented data.
  See `.env.example` for the exact variable names and provider-specific setup.

## Use with Claude Code (MCP)
`.mcp.json` wires Google's `chrome-devtools-mcp` to the same CDP endpoint, so Claude can read
the chart / run JS / read console live. For Pine writes, use the CLI
`npm run tv -- pine:*` (robust Monaco handling; the dashboard is intraday-only now). Open the chart page with
`select_page { pageId, bringToFront: true }` before `evaluate_script` (TradingView suspends
hidden tabs' DOM).

## Limits / honest notes
- **Reads need the chart tab active** in TradingView (hidden tabs are suspended). Best with TV
  on a second monitor while you watch the dashboard.
- **Chart symbol switch** is best-effort (drives the symbol-search dialog); if it misfires,
  switch in TradingView directly. **Timeframe chips are reference labels** (no auto-switch yet).
- **Indicator parsing is heuristic** from the on-chart legend; it reads what you already have on
  the chart (add EMA9/21, RSI, VWAP, a volume study for full Signal-Summary metrics — missing ones
  show `n/a`), it does not compute new studies.
- **TPO Stage-1 is profile-*informed*** from day-level scanner data (full letter-by-letter TPO
  needs intraday time-at-price). The scanner's "VWAP" field is the pivot `(H+L+C)/3`, used for
  scoring only — never for entry. Use **Confirm** for true on-chart levels.
- **Real NSE circuit** needs a valid NSE data token (a long-lived analytics token lasts ~1 year — no
  daily refresh); without one, Stage-1's assumed band applies and Confirm labels it honestly. NSE's
  own API is Akamai/bot-blocked server-side, hence a third-party data provider.

## Project layout
```
lib/tv.mjs          reused CDP bridge (importable module + CLI; Pine fns kept for the CLI)
lib/signals.mjs     pure legend -> signals + intraday decision metrics
lib/tpo.mjs         TPO scanner engine (India+USA): scoring, fixed entries, freeze, state, circuit
lib/upstox.mjs      real NSE circuit at Confirm (instrument map + market-quote)
lib/history.mjs     multi-timeframe OHLC for Pattern Analysis (NSE / US data feeds)
lib/patterns.mjs    rule-based stage + pattern detection and the top-down report builder
lib/indicators.mjs  shared primitives (SMA/ATR/pivots/line fit/ZigZag/RSI) used by every engine
lib/minervini.mjs   Minervini SEPA: Trend Template, VCP contractions, pivot/stop trade plan
lib/rs.mjs          percentile RS Rating from the reused TradingView universe scanner
lib/ratelimit.mjs   ONE process-wide throttle + circuit breaker per upstream provider
data/history_cache.json  persisted OHLC windows (gitignored) — survives restarts so a
                    symbol analysed yesterday needs no requests the next morning
lib/elliott.mjs     Elliott Wave counting: impulse + simple corrections, alternates, invalidation
lib/breakouts.mjs   "closest to breakout" scanners: full-universe screen, then the real
                    pattern / VCP / Elliott engines on a rate-limit-bounded shortlist
server/server.mjs   zero-dep HTTP server + JSON API
public/             index.html, app.js, style.css  (the dashboard)
config/markets.json India-intraday config + tpo thresholds
scripts/tv-debug.sh launch TradingView with CDP
pine/               example Pine scripts (CLI only)
.mcp.json           chrome-devtools-mcp wiring for Claude Code
```

## Disclaimer

This software is for **analysis and education only**. It is **not financial advice**, and it
contains **no order-execution code by design**. Trading involves substantial risk of loss;
nothing produced by this tool (signals, states, backtests, analytics) is a recommendation to
buy or sell any security. Use entirely at your own risk.

This project is not affiliated with, endorsed by, or sponsored by TradingView, its data
providers, or Anthropic. It reads **your own** logged-in TradingView Desktop session locally via the Chrome
DevTools Protocol — you are responsible for complying with the terms of service of TradingView,
your broker, and your data providers. It does not scrape, store, or redistribute market data.

## License

[MIT](LICENSE) © Saket Tulsan. See also [CONTRIBUTING.md](CONTRIBUTING.md),
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md).
