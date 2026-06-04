#!/usr/bin/env bash
# Double-click launcher (macOS). Ensures TradingView CDP, starts the dashboard,
# opens it in your browser. Close this Terminal window (or Ctrl-C) to stop the server.
cd "$(dirname "$0")/.." || exit 1

# Port from .env (digits only), default 4178.
PORT="$(sed -n 's/^[[:space:]]*PORT[[:space:]]*=[[:space:]]*\([0-9][0-9]*\).*/\1/p' .env 2>/dev/null | tail -1)"
PORT="${PORT:-4178}"
URL="http://localhost:$PORT"

echo "▶ Ensuring TradingView CDP (:9222)…"
bash scripts/tv-debug.sh || true
echo

# Already running? Just open it.
if curl -s --max-time 2 "$URL/api/status" >/dev/null 2>&1; then
  echo "✓ Dashboard already running — opening $URL"
  open "$URL"
  echo "  (a server is already up; you can close this window)"
  exit 0
fi

echo "▶ Starting dashboard on $URL"
( sleep 2; open "$URL" ) &
echo "  Close this window to stop the server."
echo
exec node server/server.mjs
