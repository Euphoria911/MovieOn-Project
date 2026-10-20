#!/usr/bin/env bash
# Starts the MovieOn server in the background each time the codespace boots.
set -euo pipefail

cd "$(dirname "$0")/.."
WORKSPACE="$(pwd)"

if [ ! -f "$WORKSPACE/server/.env" ]; then
  echo "server/.env missing — running setup.sh"
  bash "$WORKSPACE/.devcontainer/setup.sh"
fi

mkdir -p "$WORKSPACE/data"
cd "$WORKSPACE/server"

# Kill any previous instance (handles manual restarts without stale PIDs).
pkill -f 'node .*src/index.js' 2>/dev/null || true

nohup node --env-file=.env src/index.js \
  > "$WORKSPACE/data/server.log" 2>&1 &

echo "MovieOn started (PID $!). Tail logs: tail -f data/server.log"
