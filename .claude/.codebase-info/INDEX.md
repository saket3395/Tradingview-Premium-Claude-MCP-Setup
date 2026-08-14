# Codebase Map — Tradingview-Premium-Claude-MCP-Setup

*Last Updated: 2026-08-14*

Analysis-only **intraday** trading dashboard for **TradingView Premium Desktop**, driven via
Claude Code + MCP over the Chrome DevTools Protocol (CDP). Reads your own logged-in TradingView
session locally; **no order-execution code exists by design**. Zero npm dependencies — Node ≥20
built-ins only (`http`/`https`, `fetch`, `WebSocket`).

- **Stack:** Node.js ES modules (`.mjs`), vanilla HTML/CSS/JS frontend, zero-dep HTTP server.
- **Shape:** one HTTP server (`server/server.mjs`) exposing a JSON API over ~15 pure/near-pure
  engine modules in `lib/`, plus a single-page dashboard in `public/`, plus a CLI (`lib/tv.mjs`).
- **Data:** live via TradingView CDP + TradingView scanner; historical OHLC via Upstox (NSE) and
  Alpaca (US); real NSE circuit limits via Upstox. Nothing is ever synthesised.

## Documents
- [architecture.md](architecture.md) — components, boundaries, data flow, the four external sources
- [tech-landscape.md](tech-landscape.md) — languages, runtime, tooling, source-of-truth files
- [directory-structure.md](directory-structure.md) — annotated tree
- [entry-points.md](entry-points.md) — server routes, CLI commands, launch scripts, MCP wiring
- [modules.md](modules.md) — every `lib/` engine: purpose, exports, deps
- [communication.md](communication.md) — JSON API + external HTTP integrations (CDP, scanner, Upstox, Alpaca)
- [patterns.md](patterns.md) — recurring patterns: never-fabricate, frozen plans, shared rate limit, caching
- [onboarding.md](onboarding.md) — quick start + common tasks

## How to use this map
Start here for orientation, then open the specific doc you need. Paths are concrete and verified —
follow them into the code. `modules.md` + `communication.md` together explain almost any request
flow (dashboard tab → API route → `lib/` engine → external source).

## How to maintain this map
When code changes, update the affected doc(s) and bump their `Last Updated` line. Add a new doc
only for a genuinely new major aspect; delete one whose subject is gone. Re-run the state writer
after edits (see `onboarding.md`). **Never edit `CLAUDE.md`** — the plugin's SessionStart hook
injects this `INDEX.md` automatically.
