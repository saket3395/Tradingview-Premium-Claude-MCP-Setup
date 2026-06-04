# Tradingview-Premium-Claude-MCP-Setup

Analysis-only trading **dashboard** for **TradingView Premium Desktop**, driven through
Claude Code + MCP over the Chrome DevTools Protocol (CDP).

- 🇮🇳 **India intraday** section + 🇺🇸 **USA swing / options-buying** section
- One central dashboard: signal summary, fast-scan panels, trade checklists, Pine
  workspace, alert/journal manager, and an MCP/CDP health panel
- Reads chart, timeframe, indicators, watchlist, Pine source/logs; writes/compiles/debugs Pine
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
| Panel | What it does | Source |
|---|---|---|
| MCP / CDP health | CDP up/down, app version, chart-tab count | `GET /api/status` |
| Signal summary | Active symbol, timeframe, close/Δ, RSI/EMA/SMA/BoP + heuristic bias | parsed chart legend |
| India intraday | Configured timeframes, **fast scan** of NSE/BSE watchlist, trade checklist | watchlist + `config/markets.json` |
| USA swing/options | Configured timeframes, **fast scan** of US watchlist, trade checklist | watchlist + config |
| Pine workspace | Read ↔ edit ↔ Write ↔ Compile (with error + line:col) | `lib/tv.mjs` Pine fns |
| Alert / journal | Log trades/setups locally, export CSV | `data/journal.json` |

- **Fast scan**: your TradingView watchlist split by market (exchange prefix). Click a symbol
  to load it on the active chart (best-effort switch).
- **Checklists**: defined in `config/markets.json`; tick-state saved in the browser.
- **Journal**: stored locally in `data/journal.json` (gitignored). Export via the CSV button.

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
- `config/markets.json` — market labels, exchange filters, timeframes, sessions, checklists, poll interval.
- `.env` — `PORT`, `TV_CDP`, `TV_NO_ACTIVATE`.

## Use with Claude Code (MCP)
`.mcp.json` wires Google's `chrome-devtools-mcp` to the same CDP endpoint, so Claude can read
the chart / run JS / read console live. For Pine writes, prefer the dashboard or
`npm run tv -- pine:*` (robust Monaco handling). Open the chart page with
`select_page { pageId, bringToFront: true }` before `evaluate_script` (TradingView suspends
hidden tabs' DOM).

## Limits / honest notes
- **Reads need the chart tab active** in TradingView (hidden tabs are suspended). Best with TV
  on a second monitor while you watch the dashboard.
- **Chart symbol switch** is best-effort (drives the symbol-search dialog); if it misfires,
  switch in TradingView directly. **Timeframe chips are reference labels** (no auto-switch yet).
- **Drawings** and **reading TradingView's alerts panel** are not wired yet (selectors not
  validated) — the journal manager covers manual alert/trade logging.
- Indicator parsing is heuristic from the on-chart legend; it reads what you already have on
  the chart, it does not compute new studies.

## Project layout
```
lib/tv.mjs          reused CDP bridge (importable module + CLI)
lib/signals.mjs     pure legend -> signals parser
server/server.mjs   zero-dep HTTP server + JSON API
public/             index.html, app.js, style.css  (the dashboard)
config/markets.json India + USA config & checklists
scripts/tv-debug.sh launch TradingView with CDP
pine/               example Pine scripts
.mcp.json           chrome-devtools-mcp wiring for Claude Code
```

Analysis only. Not financial advice.
