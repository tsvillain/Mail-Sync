#!/bin/sh
set -e

SERVER_PID=0
CLIENT_PID=0

# ── Cleanup: kill both processes on EXIT / INT / TERM ─────────────────────────
cleanup() {
  echo "[entrypoint] Shutting down..."
  [ "$SERVER_PID" -ne 0 ] && kill "$SERVER_PID" 2>/dev/null
  [ "$CLIENT_PID" -ne 0 ] && kill "$CLIENT_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

# ── Start sync server ─────────────────────────────────────────────────────────
echo "[entrypoint] Starting sync server on port 3000..."
node /app/server/src/index.js &
SERVER_PID=$!

# ── Start Next.js client ──────────────────────────────────────────────────────
echo "[entrypoint] Starting Next.js client on port 3001..."
node /app/client/server.js &
CLIENT_PID=$!

echo "[entrypoint] Both services started (server=$SERVER_PID client=$CLIENT_PID)"

# ── Monitor: exit the container if either process dies ────────────────────────
# Docker will then restart the container according to the restart policy.
while true; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[entrypoint] Sync server exited unexpectedly — stopping container"
    exit 1
  fi
  if ! kill -0 "$CLIENT_PID" 2>/dev/null; then
    echo "[entrypoint] Next.js client exited unexpectedly — stopping container"
    exit 1
  fi
  sleep 2
done
