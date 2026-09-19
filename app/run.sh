#!/usr/bin/env bash
# ThermaSight — standalone launcher (macOS / Linux).
#
# Usage:
#   ./run.sh              install, build and serve at http://localhost:3000
#   PORT=8080 ./run.sh    serve on a custom port
#   ./run.sh --dev        development server (hot reload; see README note)
set -e
cd "$(dirname "$0")"

DEV=0
if [ "${1:-}" = "--dev" ]; then DEV=1; fi

PM=""
if command -v bun >/dev/null 2>&1; then
  PM=bun
elif command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  PM=npm
else
  echo "ThermaSight needs Bun or Node.js 20+ (https://bun.sh or https://nodejs.org)."
  exit 1
fi

echo "[ThermaSight] Installing dependencies (first run only)..."
$PM install

if [ "$DEV" = "1" ]; then
  echo "[ThermaSight] Dev server at http://localhost:5173  (Ctrl+C to stop)"
  $PM run dev
else
  echo "[ThermaSight] Building the production bundle..."
  $PM run build
  echo "[ThermaSight] Serving at http://localhost:${PORT:-3000}  (Ctrl+C to stop)"
  PORT="${PORT:-3000}" $PM run start
fi