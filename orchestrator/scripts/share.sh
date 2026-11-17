#!/usr/bin/env bash
# Open Forsa from your phone or anywhere through a free Cloudflare tunnel.
#
#   cd orchestrator && ./scripts/share.sh
#
# Quick tunnel (default): no account needed; a new https://….trycloudflare.com
# address each time; live progress streams fall back to polling.
# Named tunnel: set FORSA_TUNNEL_NAME (free Cloudflare account + your domain)
# for a stable address with live updates.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${FORSA_SHARE_PORT:-3005}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is missing. Install it with: brew install cloudflared" >&2
  exit 1
fi

if lsof -nP -iTCP:3001 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Forsa's dev server (npm run dev) is running. Stop it first so two servers don't share one database." >&2
  exit 1
fi

echo "Checking that no account uses an easy password..."
npx tsx scripts/check-weak-passwords.ts

echo "Updating the database and building the web app..."
npx tsx src/server/db/migrate.ts >/dev/null
npm run build:client >/dev/null

echo "Starting Forsa on http://localhost:${PORT} ..."
NODE_ENV=production PORT="${PORT}" npx tsx src/server/index.ts &
SERVER_PID=$!
trap 'kill "${SERVER_PID}" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:${PORT}/health" >/dev/null 2>&1; then break; fi
  sleep 1
done

if [[ -n "${FORSA_TUNNEL_NAME:-}" ]]; then
  cloudflared tunnel run --url "http://localhost:${PORT}" "${FORSA_TUNNEL_NAME}"
else
  echo "Opening a quick tunnel: open the https://...trycloudflare.com address printed below."
  cloudflared tunnel --url "http://localhost:${PORT}"
fi
