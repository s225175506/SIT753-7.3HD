#!/usr/bin/env bash
# Seed TaskFlow with demo traffic so Grafana panels and Alertmanager drills have data.
# Usage:
#   ./scripts/seed-demo-traffic.sh [--url URL] [--spike] [--rounds N]
# Defaults: production http://127.0.0.1:3002, 12 steady rounds, no bad-login spike.

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3002}"
ROUNDS=12
SPIKE=0
API_KEY="tf_demo_key_change_me"
USER="demo"
PASS="demopass"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) BASE_URL="$2"; shift 2 ;;
    --rounds) ROUNDS="$2"; shift 2 ;;
    --spike) SPIKE=1; shift ;;
    -h|--help)
      echo "Usage: $0 [--url URL] [--rounds N] [--spike]"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

BASE_URL="${BASE_URL%/}"
echo "=== Seed demo traffic against ${BASE_URL} (rounds=${ROUNDS}, spike=${SPIKE}) ==="

if ! curl -sf --max-time 5 "${BASE_URL}/health" >/dev/null; then
  echo "ERROR: ${BASE_URL}/health is not reachable" >&2
  exit 1
fi

echo "-- successful logins"
for i in $(seq 1 4); do
  curl -sS --max-time 5 -o /tmp/taskflow-login.json -w "login_ok_${i}:%{http_code}\n" \
    -X POST "${BASE_URL}/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"${USER}\",\"password\":\"${PASS}\"}"
done

# Warm up the failure series so Prometheus increase() has ≥2 scrapes before any spike drill
echo "-- warmup failed login (creates failure series for Alertmanager)"
curl -sS --max-time 5 -o /dev/null -w "login_warmup_fail:%{http_code}\n" \
  -X POST "${BASE_URL}/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"warmup-not-real"}' || true

# Prefer API key returned by login when present
if command -v python3 >/dev/null 2>&1 && [[ -f /tmp/taskflow-login.json ]]; then
  KEY_FROM_LOGIN=$(python3 -c "import json; print(json.load(open('/tmp/taskflow-login.json')).get('apiKey',''))" 2>/dev/null || true)
  if [[ -n "${KEY_FROM_LOGIN}" ]]; then
    API_KEY="${KEY_FROM_LOGIN}"
  fi
fi

echo "-- create / update / list tasks"
TASK_IDS=()
for title in "Demo: pipeline review" "Demo: Grafana seed" "Demo: release checklist"; do
  RESP=$(curl -sS --max-time 5 -X POST "${BASE_URL}/api/tasks" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${API_KEY}" \
    -d "{\"title\":\"${title}\",\"description\":\"seeded for monitoring demo\",\"status\":\"todo\"}")
  echo "create: ${RESP}"
  if command -v python3 >/dev/null 2>&1; then
    TID=$(printf '%s' "${RESP}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
    [[ -n "${TID}" ]] && TASK_IDS+=("${TID}")
  fi
done

if [[ ${#TASK_IDS[@]} -gt 0 ]]; then
  curl -sS --max-time 5 -o /dev/null -w "patch:%{http_code}\n" \
    -X PATCH "${BASE_URL}/api/tasks/${TASK_IDS[0]}" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${API_KEY}" \
    -d '{"status":"in_progress","description":"updated by seed script"}'
  if [[ ${#TASK_IDS[@]} -gt 1 ]]; then
    curl -sS --max-time 5 -o /dev/null -w "patch2:%{http_code}\n" \
      -X PATCH "${BASE_URL}/api/tasks/${TASK_IDS[1]}" \
      -H "Content-Type: application/json" \
      -H "X-API-Key: ${API_KEY}" \
      -d '{"status":"done"}'
  fi
fi

curl -sS --max-time 5 -o /dev/null -w "list:%{http_code}\n" \
  -H "X-API-Key: ${API_KEY}" \
  "${BASE_URL}/api/tasks"

echo "-- steady HTTP traffic (${ROUNDS} rounds)"
for i in $(seq 1 "${ROUNDS}"); do
  curl -sS --max-time 3 -o /dev/null "${BASE_URL}/health" || true
  curl -sS --max-time 3 -o /dev/null -H "X-API-Key: ${API_KEY}" "${BASE_URL}/api/tasks" || true
  curl -sS --max-time 3 -o /dev/null -X POST "${BASE_URL}/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"${USER}\",\"password\":\"${PASS}\"}" || true
  # small pause so Prometheus 5s scrapes see a rising rate
  sleep 0.4
done

if [[ "${SPIKE}" -eq 1 ]]; then
  echo "-- invalid login spike (8 failures for TaskFlowInvalidLoginSpike)"
  for i in $(seq 1 8); do
    curl -sS --max-time 3 -o /dev/null -w "login_fail_${i}:%{http_code}\n" \
      -X POST "${BASE_URL}/auth/login" \
      -H 'Content-Type: application/json' \
      -d '{"username":"demo","password":"not-the-real-password"}' || true
  done
fi

echo "-- /metrics sample (taskflow_*)"
curl -sf --max-time 5 "${BASE_URL}/metrics" | grep -E '^taskflow_(login|http_requests|tasks_)' | head -n 40 || true
echo "=== Seed complete ==="
