#!/usr/bin/env bash
# Render's free plan: one web service runs the API, the worker and the web app together
# (docs/deploy-render.md). Only the web app listens publicly, on Render's PORT; the API stays on
# loopback. If any process exits, the container exits so Render restarts it.
set -euo pipefail
trap 'kill $(jobs -p) 2>/dev/null || true' EXIT TERM INT

pnpm db:migrate

# Heap caps keep the three processes inside the free instance's 512 MB.
API_HOST=127.0.0.1 API_PORT=3001 node --max-old-space-size=160 apps/api/dist/main.js &
node --max-old-space-size=160 apps/worker/dist/main.js &
API_INTERNAL_URL=http://127.0.0.1:3001 HOSTNAME=0.0.0.0 PORT="${PORT:-10000}" \
  node --max-old-space-size=128 apps/web/.next/standalone/apps/web/server.js &

wait -n
exit 1
