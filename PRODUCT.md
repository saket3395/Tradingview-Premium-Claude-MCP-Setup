# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two co-equal audiences:

1. **The author, as a solo intraday/swing trader** — using the dashboard as a personal cockpit for their own daily trading of NSE India and US equities.
2. **Open-source self-hosters** — traders comfortable running Node + TradingView Desktop locally who clone the repository and run it themselves.

**Situation & job (shared):** at a desk on macOS, TradingView Premium Desktop open with a chart tab active (a second monitor is ideal), during or around the NSE India and US market sessions. The job is to *read the current market* for a symbol or the whole universe and get a **stable, non-drifting trade plan** (entry / stop / target / state) to make a discretionary decision — not to automate or place trades.

## Product Purpose

Turns the user's **own logged-in TradingView Desktop session** plus public market data into intraday signals, top-down structural analysis (chart patterns, Minervini VCP/SEPA, Elliott Wave), and "closest-to-breakout" idea scans for **NSE India and US equities** — all locally, with **no order execution**. Success is the user making a better-informed discretionary decision, anchored to a stable per-session plan and honest data, trusting that an empty result means "no data," never a bug.

## Positioning

The differentiated mechanism is the **stable entry**: every signal anchors its entry to a *fixed session level* (today's open / prior close) and **freezes the whole plan per symbol per day** — the entry does not drift with each tick — governed by a **State machine** (ARMED / VALID / EXTENDED / INVALID / EXPIRED) that says *when, or whether, to act*. It is **circuit-aware for India** (targets/stops validated against the real NSE upper/lower circuit at Confirm), reads the user's **own logged-in TradingView session locally over CDP** (no broker API keys, no cloud), and **never fabricates**. That combination — profile-informed full-universe scanning, fixed frozen plans, local-session reading, and honest degradation to "no data" — is what a neighboring tool could not truthfully copy.

## Operating Context

- **macOS**; TradingView Premium Desktop launched with `--remote-debugging-port` (CDP on `:9222`) and a **chart tab active** (TradingView suspends hidden tabs' DOM, so live reads need a fronted chart).
- Dashboard served locally at `http://localhost:4178`; no build step, no install (zero dependencies).
- **Optional data-provider tokens** unlock deeper features: an NSE data token (real circuit at Confirm, NSE history, 1-minute backtest, market-regime model) and US market-data keys (US price history). Absent → those panels honestly report "no data."
- Third-party market data sits behind Cloudflare and is **rate-limited** (one shared limiter + circuit breaker per provider).
- **Claude Code + MCP** (`chrome-devtools-mcp` via `.mcp.json`) can drive the same CDP session for live chart reads and Pine editing.

## Capabilities and Constraints

- **Surfaces (12 tabs):** Start Here (onboarding), Dashboard/Signal Summary (live chart read), India TPO Scanner, USA TPO Scanner, Pattern Analysis, VCP Analysis, Elliott Wave, Breakout-Patterns, VCP/Elliott-Breakout, Cached Data, Testing (forward-test journal + gates + India 1-minute backtest), Analytics (Monte Carlo / HMM regime / robustness).
- **Technical constraints:** zero npm dependencies; Node ≥ 20 built-ins only; a vanilla HTML/CSS/JS single-page frontend served by a zero-dependency HTTP server; **no build step**; **no database** (persistence is two local JSON files, `data/journal.json` and `data/history_cache.json`).
- **Analysis-only:** no order or trade endpoints exist anywhere in the codebase.
- **Never-fabricate:** a missing provider/timeframe returns `{ ok:false }` and the UI reports "no data" rather than guessing — a load-bearing convention.
- **Live reads** require an active TradingView chart tab; symbol switching is best-effort; indicator parsing is heuristic from the on-chart legend.
- **Terminology** the user will meet (defined in the app glossary): TPO, Signal State, VCP/SEPA, Weinstein stage, Elliott Wave, EQ (Entry Quality), R:R.
- **Config:** data-source credentials are read from generic environment variables (`NSE_DATA_TOKEN_FILE`, `US_DATA_KEY_ID`/`SECRET_KEY`/`FEED`, `NSE_*` pacing) with legacy vendor-named variables still honored as fallbacks.

## Brand Commitments

- **Name:** *Tradingview-Premium-Claude-MCP-Setup* (in-app: "TV × Claude Intraday MCP").
- **Voice:** honest, plain-language, no hype. Data sources are described generically ("NSE data provider," "US data") rather than by vendor brand in the user-facing product; jargon is explained for newcomers while advanced depth is retained.
- **License / ownership:** MIT, © Saket Tulsan.
- **Affiliation disclaimer (binding):** not affiliated with, endorsed by, or sponsored by TradingView, its data providers, or Anthropic.
- The existing dark dashboard UI is incumbent visual *evidence*, not a binding commitment — any visual-world decision belongs to later design work, not to this record.

## Evidence on Hand

- Real, working functionality across all 12 tabs; a real forward-test **journal** (`data/journal.json`) with pass/fail gates and an India 1-minute backtest against real candles; Monte Carlo, HMM market-regime, and robustness analytics computed **only from real journal outcomes**.
- Repository docs: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE`, and a committed codebase map (`.claude/.codebase-info/`).
- Public GitHub repository: `saket3395/Tradingview-Premium-Claude-MCP-Setup`.
- **Absences future work must not fabricate:** there is **no published track record or performance claim**, **no testimonials**, **no user/customer counts**, and **no benchmarks**. The forward-test methodology is a *feature*, never to be presented as a proven trading edge.

## Product Principles

1. **Analysis, not execution.** Help the user decide; never place, automate, or imply placing trades.
2. **Never fabricate.** An honest "no data" always beats an invented number — an empty result is a valid, truthful answer.
3. **Local and private by default.** Read the user's own session on their own machine; no accounts, no cloud, nothing leaves the device.
4. **Honest by construction.** No performance claims, testimonials, or advice; show the methodology *and* its caveats, promise no results. Nothing here is financial advice.
5. **Legible to a newcomer, deep for a pro.** Plain-language onboarding and per-feature explanations, without dumbing down the advanced analysis underneath.
