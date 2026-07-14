# Contributing

Thanks for your interest in improving this project!

## Getting started

1. Fork the repo and clone your fork.
2. Requirements: macOS, Node ≥ 20, TradingView Desktop installed and logged in.
3. `cp .env.example .env` (defaults work), then `npm run tv:debug` and `npm start`.
4. There are no npm dependencies — the project uses Node built-ins only. Please keep it that way unless a dependency is clearly justified.

## What contributions are welcome

- Bug fixes (CDP bridge, scanners, dashboard)
- Support for other platforms (Windows/Linux TradingView Desktop, other CDP launch flows)
- Additional broker adapters for circuit/quote lookups (analysis-only — see below)
- Docs, setup guides, and troubleshooting notes
- Tests

## Hard constraints

- **No live order execution.** This project is analysis-only by design. PRs that add order placement, order modification, or any live trade routing will not be merged.
- **No scraped or redistributed market data.** The project reads the user's own TradingView Desktop session locally via CDP. Do not add code that redistributes TradingView data, bypasses authentication, or circumvents TradingView's terms of service.
- **No secrets in code.** Tokens and credentials live in `.env` / `data/` (both gitignored). Never commit real tokens, even in tests or fixtures.

## Pull requests

- Keep PRs focused — one change per PR.
- Describe what you tested manually (this project is driven against a live TradingView session, so note your OS, Node version, and TradingView Desktop version).
- Match the existing code style (ES modules, no dependencies, small focused libs under `lib/`).

## Reporting bugs

Open an issue with: OS + Node + TradingView Desktop versions, what you did, what you expected, what happened, and relevant server log output. Redact any tokens or account details before posting.
