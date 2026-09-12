#!/usr/bin/env bash
# Replays the provider's August webhooks against the running app.
#
#   npm run replay              full scenario
#   npm run replay -- --limit 50
#   npm run replay -- --no-signature   (needs WEBHOOK_VERIFY_SIGNATURE=false on the app)
#
# The simulator never retries and times out at 10 s, so the app is warmed up
# first: /api/health opens the database, and one unsigned POST compiles the
# webhook route (it is rejected before touching any state).
set -euo pipefail

URL="${APP_URL:-http://localhost:3000}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for _ in $(seq 1 30); do
  if curl -fsS "$URL/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! curl -fsS "$URL/api/health" >/dev/null 2>&1; then
  echo "app not reachable at $URL — start it with: npm run dev" >&2
  exit 1
fi
curl -sS -o /dev/null -X POST -H 'content-type: application/json' -d '{}' "$URL/webhooks/deposits" || true

exec python3 "$HERE/../simulator/simulate_provider.py" --url "$URL" --stop-on-error "$@"
