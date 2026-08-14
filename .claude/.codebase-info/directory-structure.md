# Directory Structure

*Last Updated: 2026-08-14*

Organized by **layer/role**: `server/` (HTTP+API), `lib/` (engines), `public/` (SPA),
`config/` + `.env` (config), `data/` (runtime state), `scripts/` (launch), `pine/` (examples).

```
Tradingview-Premium-Claude-MCP-Setup/
├── server/
│   └── server.mjs           Zero-dep HTTP/HTTPS server + JSON API router (routes table → lib/)
├── lib/                     Engine modules (mostly pure; I/O isolated to providers)
│   ├── tv.mjs               CDP bridge to TradingView Desktop (module + CLI); Pine fns
│   ├── signals.mjs          Pure: chart legend rows → intraday decision metrics
│   ├── indicators.mjs       Shared primitives: SMA/ATR/pivots/lineFit/ZigZag/RSI/volRatio
│   ├── tpo.mjs              TPO scanner: scanner fetch, scoring, fixed entries, freeze, State, circuit clamp
│   ├── upstox.mjs           Real NSE circuit at Confirm (instrument map + market-quote)
│   ├── history.mjs          Multi-TF OHLC (Upstox NSE / Alpaca US), disk+mem cache, symbol search, cost estimate
│   ├── ratelimit.mjs        ONE process-wide throttle + circuit breaker per provider (Upstox/Alpaca)
│   ├── patterns.mjs         Weinstein stage + rule-based chart-pattern detection; top-down report
│   ├── minervini.mjs        SEPA/VCP: Trend Template, contractions, pivot/stop trade plan
│   ├── rs.mjs               Percentile RS Rating from the TradingView universe scanner
│   ├── elliott.mjs          Elliott Wave counting: impulse + simple corrections, alternates, invalidation
│   ├── breakouts.mjs        "closest to breakout": Stage-1 screen, then patterns/vcp/elliott on shortlist
│   ├── journal.mjs          Forward-test journal: record frozen plans, resolve WIN/LOSS/SCRATCH/MISSED
│   ├── backtest.mjs         India 1-minute Upstox replay of journaled plans
│   └── analytics.mjs        Monte Carlo bootstrap + Gaussian HMM regime + robustness (from real outcomes)
├── public/                 Single-page dashboard (no framework)
│   ├── index.html           Tab layout + How-to-Use guides
│   ├── app.js               Tab controllers, 7s snapshot poll, on-demand tab fetches
│   └── style.css            Styling
├── config/
│   └── markets.json         India-intraday config; tpo/breakouts thresholds; testing gates
├── scripts/
│   ├── tv-debug.sh          Quit + relaunch TradingView with --remote-debugging-port :9222
│   └── start.command        Finder double-click: ensure CDP → start server → open browser
├── pine/
│   ├── example-ema.pine     Sample Pine (CLI pine:write target)
│   └── example-broken.pine  Sample Pine that fails compile (for pine:compile testing)
├── data/                   Runtime state (gitignored except .gitkeep)
│   └── .gitkeep
├── .env.example            All env tunables (copy to .env)
├── .mcp.json               chrome-devtools-mcp → CDP wiring for Claude Code
├── package.json            Scripts + Node≥20; zero dependencies
├── README.md               Extensive user-facing docs (tab-by-tab)
├── .github/                Issue/PR templates
├── CONTRIBUTING.md · CODE_OF_CONDUCT.md · SECURITY.md · LICENSE (MIT)
└── .claude/.codebase-info/ This map (gitignored by default — see tech-landscape.md)
```

## Notes
- `lib/` is flat — no sub-packages. Module coupling is by direct import; see `modules.md` for the
  dependency edges.
- `data/` files listed in `.gitignore` (`journal.json`, `upstox_token.json`,
  `upstox_instruments.json`, `history_cache.json`, backups) are created at runtime.
- `certs/` is not committed; if you add mkcert certs there the server auto-upgrades to HTTPS.
