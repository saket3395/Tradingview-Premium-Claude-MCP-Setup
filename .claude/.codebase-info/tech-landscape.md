# Tech Landscape

*Last Updated: 2026-08-18*

## Languages & runtime
- **JavaScript, ES modules** (`"type": "module"`), all engine/server files are `.mjs`.
- **Node.js ≥ 20** (`engines.node`), verified on Node 22. Relies on Node built-ins only:
  `node:http`, `node:https`, `node:fs`, `node:path`, `node:url`, `node:child_process`, global
  `fetch`, and the built-in `WebSocket` (used by the CDP bridge).
- **Frontend:** plain HTML5 + CSS + vanilla ES-module JS. No framework, no bundler, no transpile.
- **Pine Script** example files under `pine/` (edited via the TradingView Monaco editor through the CLI).

## Zero dependencies
`package.json` has **no `dependencies` and no `devDependencies`**. There is no lockfile, no
`node_modules`, and `npm install` is not required. This is a deliberate project property — keep it.

## Tooling / scripts (`package.json`)
| Script | Command | Purpose |
|---|---|---|
| `npm start` | `node server/server.mjs` | Run the dashboard server (default port 4178) |
| `npm run dev` | `node --watch server/server.mjs` | Same, with file-watch reload |
| `npm run tv:debug` | `bash scripts/tv-debug.sh` | Quit + relaunch TradingView Desktop with CDP on :9222 |
| `npm run tv` | `node lib/tv.mjs` | CLI over the CDP bridge (see entry-points.md) |

No test runner, linter, or formatter config is present — conventions are by example (see below).

## Source-of-truth files
| File | What it defines |
|---|---|
| `package.json` | Scripts, Node engine, module type. No deps. |
| `.mcp.json` | Wires `chrome-devtools-mcp` to CDP `http://127.0.0.1:9222` for Claude Code. |
| `.env.example` | All tunables: `PORT`, `TV_CDP`, `TV_NO_ACTIVATE`, `NSE_DATA_TOKEN_FILE`, `US_DATA_KEY_ID/SECRET_KEY/FEED`, `NSE_MIN_GAP_MS`, `NSE_MAX_PER_MIN` (also `NSE_CONCURRENCY`, read in `lib/ratelimit.mjs`). Each reader falls back to the legacy `UPSTOX_*`/`ALPACA_*` names, so old `.env` files keep working. |
| `config/markets.json` | India-intraday labels/exchanges/timeframes/checklist; `tpo` per-market thresholds; `breakouts` filters; `testing.gates` (PF/WR/RR/minN) and `backtestLimit`; `pollSeconds`. |
| `.gitignore` | Ignores `node_modules/`, `.env`, `data/*` runtime files, `certs/`, and **`.claude/`** (see note). |

## Local state / runtime data (all gitignored)
- `data/journal.json` — forward-test journal (frozen plans + resolved outcomes).
- `data/history_cache.json` — persisted settled OHLC windows (survives restarts).
- `data/nse_data_token.json` — NSE data-provider access-token JSON (path set by `NSE_DATA_TOKEN_FILE`; the legacy default `data/upstox_token.json` / `UPSTOX_TOKEN_FILE` still works). Both paths are gitignored.
- `data/upstox_instruments.json` — cached NSE instrument map.
- `certs/` — optional local mkcert TLS (`localhost+2.pem` / `-key.pem`) → server serves HTTPS if present.

## Coding style (by example — no linter config)
- 2-space indent, semicolons, single quotes, arrow functions, terse one-liners for helpers.
- Heavy top-of-file block comments explaining *why* (rate limits, caching, fabrication policy) —
  match this when editing; the comments are load-bearing documentation.
- Prefer pure functions taking data in; isolate I/O to the provider modules.
- Errors degrade to `{ ok:false, error/reason }`; never throw across the API boundary except to
  the router's 500 catch.

> **Note on `.claude/`:** `.gitignore` ignores `.claude/`, which would swallow this map. The map
> commit must add negations (`!.claude/.codebase-info/`, `!.claude/.codebase-info/**`). See
> `onboarding.md`.
