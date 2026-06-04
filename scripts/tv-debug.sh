#!/usr/bin/env bash
# tv-debug.sh — (re)launch TradingView Desktop with Chrome DevTools Protocol enabled.
# Idempotent: if CDP is already up on the port, does nothing.
set -euo pipefail

PORT="${1:-9222}"
APP="TradingView"

if curl -s --max-time 2 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
  echo "CDP already up on :${PORT}"
  curl -s "http://127.0.0.1:${PORT}/json/version" | grep -o 'TVDesktop/[0-9.]*' || true
  exit 0
fi

# Quit any running instance (it was launched without the debug flag).
if pgrep -f "${APP}.app/Contents/MacOS/${APP}" >/dev/null; then
  echo "Quitting running ${APP} (no debug port)…"
  osascript -e "tell application \"${APP}\" to quit" || true
  for _ in $(seq 1 20); do
    pgrep -f "${APP}.app/Contents/MacOS/${APP}" >/dev/null || break
    sleep 1
  done
fi

# Wait out the Squirrel auto-updater if it is mid-update (don't corrupt the install).
if pgrep -f ShipIt >/dev/null; then
  echo "Auto-updater (ShipIt) running; waiting…"
  for _ in $(seq 1 60); do pgrep -f ShipIt >/dev/null || break; sleep 2; done
fi

echo "Launching ${APP} with --remote-debugging-port=${PORT}…"
open -a "${APP}" --args --remote-debugging-port="${PORT}" --remote-allow-origins='*'

for _ in $(seq 1 40); do
  if curl -s --max-time 2 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
    echo "CDP up on :${PORT}"
    curl -s "http://127.0.0.1:${PORT}/json/version" | grep -o 'TVDesktop/[0-9.]*' || true
    exit 0
  fi
  sleep 1
done

echo "ERROR: CDP did not come up on :${PORT}." >&2
exit 1
