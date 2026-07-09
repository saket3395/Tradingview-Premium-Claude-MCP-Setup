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
  circuit from Upstox**.
- **No live trade execution.** No order endpoints exist in this codebase.

Zero npm dependencies (Node built-ins only). Reuses the verified CDP bridge from the
previous setup (`lib/tv.mjs`).

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
| India TPO Scanner | Full-NSE-universe profile-informed scan with **fixed entries, State, SL, circuit-capped targets, R:R**, on-chart **Confirm** (+ real Upstox circuit) and a *How to Trade This Signal* guide | `GET /api/tpo/scan`, `POST /api/tpo/confirm` |
| USA TPO Scanner | Same engine for NASDAQ/NYSE/AMEX (no circuit clamp) | `GET /api/tpo/scan/usa` |

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
  `refreshSeconds`, `noNewEntryBeforeCloseMin`, and per-market thresholds
  (`minScore`/`minRR`/`minRVol`/…). `tpo.india.circuitBandPct` is the **assumed** Stage-1 circuit
  band (default 10%); Confirm replaces it with the real Upstox circuit.
- `.env` — `PORT`, `TV_CDP`, `TV_NO_ACTIVATE`, and `UPSTOX_TOKEN_FILE` (path to a JSON
  `{"access_token":"…","minted":"…"}`; used only for real NSE circuit at Confirm; **expires daily
  03:30 IST** — refresh it, or Confirm falls back to the assumed band and says so).

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
- **Real NSE circuit** needs a fresh Upstox token; without one, Stage-1's assumed band applies and
  Confirm labels it honestly. NSE's own API is Akamai/bot-blocked server-side, hence Upstox.

## Project layout
```
lib/tv.mjs          reused CDP bridge (importable module + CLI; Pine fns kept for the CLI)
lib/signals.mjs     pure legend -> signals + intraday decision metrics
lib/tpo.mjs         TPO scanner engine (India+USA): scoring, fixed entries, freeze, state, circuit
lib/upstox.mjs      real NSE circuit at Confirm (instrument map + market-quote)
server/server.mjs   zero-dep HTTP server + JSON API
public/             index.html, app.js, style.css  (the dashboard)
config/markets.json India-intraday config + tpo thresholds
scripts/tv-debug.sh launch TradingView with CDP
pine/               example Pine scripts (CLI only)
.mcp.json           chrome-devtools-mcp wiring for Claude Code
```

Analysis only. Not financial advice.
