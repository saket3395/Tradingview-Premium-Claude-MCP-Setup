# Security Policy

## Supported versions

Only the latest commit on `main` is supported.

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/saket3395/Tradingview-Premium-Claude-MCP-Setup/security/advisories/new)
rather than opening a public issue. You can expect an initial response within a week.

## Scope notes for this project

- The dashboard server binds to localhost and is intended for local, single-user use.
  Do not expose it to the internet.
- The CDP endpoint (`:9222`) gives full control of the TradingView Desktop session.
  It is opened by `npm run tv:debug` on localhost only — never forward or expose it.
- Broker tokens (Upstox) are read from a local file referenced in `.env`. The project
  never transmits tokens anywhere except to the broker's own API over HTTPS.
- This codebase contains no order-execution endpoints by design; a report that live
  trading is somehow reachable would be treated as a critical vulnerability.
