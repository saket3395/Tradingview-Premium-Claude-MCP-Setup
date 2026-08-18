# Entry Points

*Last Updated: 2026-08-18*

## 1. Dashboard server — `server/server.mjs`
- Started by `npm start` / `npm run dev`. Bootstraps: `loadEnv('.env')` → optional TLS from
  `certs/` → `mkdir data/` → `server.listen(PORT)` (default **4178**).
- The `routes` object (`server/server.mjs:67`) maps `"METHOD /path"` strings to async handlers.
  Unmatched paths fall through to static file serving from `public/` (with a `startsWith(PUBLIC)`
  path-traversal guard). See [communication.md](communication.md) for the full route table.

## 2. SPA — `public/index.html` + `public/app.js`
- Loaded at `/` (served as `index.html`). `app.js` is the client entry: on load it fetches
  `/api/config`, then polls `/api/snapshot` every ~7s (`config.pollSeconds`) while driving each
  tab's on-demand fetch. Tab controllers are wired at the bottom of `app.js`
  (`makeTPO('tpo','/api/tpo/scan')`, etc.).
- The **default view is the "Start Here" onboarding tab** (`data-view="start"`, first in the nav;
  `#view-dashboard` starts hidden). Its `makeStart()` controller fetches `GET /api/setup` once on
  load (and on tab re-open) to render live setup-status tiles — CDP up/down plus whether the
  optional NSE/US data tokens are configured. It reads the response's `nse`/`us` keys.

## 3. CLI — `lib/tv.mjs` (via `npm run tv -- <cmd>`)
The CDP bridge is runnable directly. Subcommands (from the file header + README):
| Command | Action |
|---|---|
| `npm run tv -- status` | CDP health probe |
| `npm run tv -- chart` | Active symbol + interval |
| `npm run tv -- indicators` | Raw indicator legend rows |
| `npm run tv -- watchlist` | Read watchlist |
| `npm run tv -- pine:read` | Read the open Pine script |
| `npm run tv -- pine:write <file>` | Write a Pine file into the editor |
| `npm run tv -- pine:compile` | Trigger compile |
| `npm run tv -- eval <js>` | Evaluate JS in the chart page |

Env for the CLI: `TV_CDP` (default `http://127.0.0.1:9222`), `TV_NO_ACTIVATE=1` to skip bringing
TradingView frontmost. The dashboard server never activates TradingView.

## 4. Launch scripts — `scripts/`
- `scripts/tv-debug.sh` (`npm run tv:debug`): quits any running TradingView and relaunches
  `/Applications/TradingView.app` with `--remote-debugging-port=9222`, waiting out the auto-updater.
  **Required** — TradingView only exposes CDP when launched this way.
- `scripts/start.command`: Finder double-click flow — ensures CDP, starts the dashboard, opens the
  browser. Closing its Terminal window stops the server.

## 5. MCP bridge — `.mcp.json`
Wires Google's `chrome-devtools-mcp@latest` to `http://127.0.0.1:9222`, so Claude Code can read the
chart / run JS / read console live against the same TradingView session. This is a *consumer* of the
CDP endpoint, parallel to the dashboard — not a server the app runs.

## Prerequisites for any live read
A TradingView **chart tab must be active/frontmost** — TradingView suspends hidden tabs' DOM, so
CDP reads of a background tab return nothing. Best with TradingView on a second monitor.
