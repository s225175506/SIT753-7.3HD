#!/usr/bin/env bash
# Start Prometheus / Alertmanager / Grafana using ~/.taskflow-monitoring mounts.
# Colima often cannot bind-mount files from /Users/Shared — copy configs first.
set -euo pipefail

export DOCKER_HOST="${DOCKER_HOST:-unix://${HOME}/.colima/default/docker.sock}"
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MON_SRC="${ROOT}/monitoring"
MON_DST="${HOME}/.taskflow-monitoring"
NET="${TASKFLOW_NETWORK:-taskflow-net}"

echo "=== Sync monitoring configs → ${MON_DST} ==="
mkdir -p "${MON_DST}/grafana/provisioning" "${MON_DST}/grafana/dashboards"
cp -f "${MON_SRC}/prometheus.yml" "${MON_DST}/prometheus.yml"
cp -f "${MON_SRC}/alert-rules.yml" "${MON_DST}/alert-rules.yml"
cp -f "${MON_SRC}/alertmanager.yml" "${MON_DST}/alertmanager.yml"
cp -R "${MON_SRC}/grafana/provisioning/." "${MON_DST}/grafana/provisioning/"
cp -R "${MON_SRC}/grafana/dashboards/." "${MON_DST}/grafana/dashboards/"

echo "=== Recreate monitoring containers ==="
docker rm -f taskflow-prometheus taskflow-alertmanager taskflow-grafana 2>/dev/null || true
# free host ports if something else holds them
docker ps -q --filter publish=9090 | while read -r id; do docker rm -f "$id"; done
docker ps -q --filter publish=9093 | while read -r id; do docker rm -f "$id"; done
docker ps -q --filter publish=3003 | while read -r id; do docker rm -f "$id"; done

docker network create "${NET}" 2>/dev/null || true

docker run -d --name taskflow-alertmanager --network "${NET}" \
  --network-alias alertmanager \
  --network-alias taskflow-alertmanager \
  -p 9093:9093 \
  -v "${MON_DST}/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro" \
  prom/alertmanager:v0.27.0

docker run -d --name taskflow-prometheus --network "${NET}" \
  --network-alias taskflow-prometheus \
  -p 9090:9090 \
  --add-host=host.docker.internal:host-gateway \
  -v "${MON_DST}/prometheus.yml:/etc/prometheus/prometheus.yml:ro" \
  -v "${MON_DST}/alert-rules.yml:/etc/prometheus/alert-rules.yml:ro" \
  prom/prometheus:v2.54.1 \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/prometheus \
  --web.enable-lifecycle

docker run -d --name taskflow-grafana --network "${NET}" \
  -p 3003:3000 \
  -e GF_SECURITY_ADMIN_USER=admin \
  -e GF_SECURITY_ADMIN_PASSWORD=taskflow \
  -e GF_USERS_ALLOW_SIGN_UP=false \
  -e GF_AUTH_ANONYMOUS_ENABLED=true \
  -e GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer \
  -e GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH=/var/lib/grafana/dashboards/taskflow-overview.json \
  -v "${MON_DST}/grafana/provisioning:/etc/grafana/provisioning:ro" \
  -v "${MON_DST}/grafana/dashboards:/var/lib/grafana/dashboards:ro" \
  grafana/grafana:11.2.0

echo "Waiting for Prometheus + Grafana..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf --max-time 2 http://127.0.0.1:9090/-/ready >/dev/null \
    && curl -sf --max-time 2 http://127.0.0.1:3003/api/health >/dev/null; then
    echo "Monitoring stack is up."
    exit 0
  fi
  sleep 2
done
echo "WARNING: stack started but health not confirmed yet" >&2
docker ps --filter name=taskflow --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
exit 0
