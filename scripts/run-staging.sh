#!/usr/bin/env bash
# Local helper when `docker compose` plugin is missing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export DOCKER_HOST="${DOCKER_HOST:-unix://${HOME}/.colima/default/docker.sock}"
IMAGE_TAG="${IMAGE_TAG:-staging}"
APP_VERSION="${APP_VERSION:-1.0.0}"
BUILD_NUMBER="${BUILD_NUMBER:-local}"

docker network create taskflow-net 2>/dev/null || true

docker rm -f taskflow-staging 2>/dev/null || true
docker run -d --name taskflow-staging --network taskflow-net \
  -p 3001:3000 \
  -e NODE_ENV=staging -e APP_VERSION="$APP_VERSION" -e PORT=3000 \
  "taskflow-api:${IMAGE_TAG}"

echo "Staging: http://127.0.0.1:3001/health"
