# Onboarding

*Last Updated: 2026-08-14*

## Prerequisites
- macOS, **Node ≥ 20** (built-in `WebSocket`/`fetch`; verified on Node 22).
- **TradingView Desktop** installed (`/Applications/TradingView.app`), logged in.
- Optional: Upstox token (Analytics token recommended) for real NSE circuit + NSE history;
  Alpaca market-data keys for US history.

## Quick start
```bash
cp .env.example .env       # optional — defaults work
npm run tv:debug           # quit + relaunch TradingView with CDP on :9222
npm start                  # dashboard at http://localhost:4178
```
No `npm install` — the project has **zero dependencies**. Then open http://localhost:4178 and keep a
TradingView **chart tab active** (ideally on a second monitor) — the dashboard reads the active tab.

Easiest alternative: double-click `scripts/start.command` in Finder (ensures CDP, starts server,
opens browser). Closing its Terminal window stops the server.

## CLI (no server needed)
```bash
npm run tv -- status        # CDP health
npm run tv -- chart         # active symbol + interval
npm run tv -- indicators    # raw legend rows
npm run tv -- pine:read
npm run tv -- pine:write pine/example-ema.pine
npm run tv -- pine:compile
```

## Where to look for common tasks
| Task | Start at |
|---|---|
| Add/modify an API route | `server/server.mjs` `routes` (`:67`) → the relevant `lib/` engine |
| Change a scanner threshold / gate | `config/markets.json` (`tpo.*`, `breakouts.*`, `testing.gates`) |
| Change env/ports/tokens/pacing | `.env` (see `.env.example`); pacing keys read in `lib/ratelimit.mjs` |
| Touch live-chart reads | `lib/tv.mjs` (CDP bridge) + `lib/signals.mjs` (legend parse) |
| TPO scoring / entries / state | `lib/tpo.mjs` (`scanTPO`, `computeState`, `clampToCircuit`) |
| OHLC fetching / caching | `lib/history.mjs` + `lib/ratelimit.mjs` |
| Pattern / VCP / Elliott logic | `lib/patterns.mjs` / `lib/minervini.mjs` / `lib/elliott.mjs` |
| Forward-test accounting | `lib/journal.mjs`; replay `lib/backtest.mjs`; stats `lib/analytics.mjs` |
| Frontend/tab behaviour | `public/app.js` (tab controllers at bottom), `public/index.html` |

## Gotchas
- **Chart tab must be active** — TradingView suspends hidden tabs' DOM; CDP reads return nothing otherwise.
- **Symbol switch is best-effort** and timeframe chips are labels (no auto-switch). Confirm guards
  against reporting the wrong symbol's data if a switch didn't take.
- **Upstox is behind Cloudflare** — respect the shared limiter (`lib/ratelimit.mjs`); never bypass
  `limitedFetch`. A 429 trips the breaker; don't add retry-in-place.
- **Never fabricate data** — missing source ⇒ `{ ok:false }`, UI says "no data". Keep it that way.
- **No tests / no linter** — verify manually against a live session.

## Maintaining this map
This map lives in `.claude/.codebase-info/`. After changing code, update the affected doc(s) + their
`Last Updated` line, then re-run the state writer:
```bash
node "/Users/saket/.claude/plugins/cache/eigenwise-toolshed/codebase-mapper/2.15.3/scripts/write-map-state.js" --project .
```
**Never edit `CLAUDE.md`** — the plugin's SessionStart hook injects `INDEX.md` automatically.

> `.gitignore` ignores `.claude/`. To commit this map, add negations in the same commit:
> `!.claude/.codebase-info/` and `!.claude/.codebase-info/**`, then `git add` the map **and**
> `.map-state.json`.
