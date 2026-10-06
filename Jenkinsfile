pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '15'))
    }

    environment {
        APP_NAME = 'taskflow-api'
        APP_VERSION = '1.0.0'
        IMAGE_NAME = 'taskflow-api'
        STAGING_URL = 'http://127.0.0.1:3001'
        PRODUCTION_URL = 'http://127.0.0.1:3002'
        PROMETHEUS_URL = 'http://127.0.0.1:9090'
        ALERTMANAGER_URL = 'http://127.0.0.1:9093'
        GRAFANA_URL = 'http://127.0.0.1:3003'
        REPORTS_DIR = 'reports'
        DOCKER_HOST = "unix://${HOME}/.colima/default/docker.sock"
        PATH = "/opt/homebrew/bin:/usr/local/bin:${env.PATH}"
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                sh '''
                    mkdir -p "$REPORTS_DIR" dist artefacts
                    echo "Checked out TaskFlow for build ${BUILD_NUMBER}"
                '''
            }
        }

        stage('Build') {
            steps {
                sh '''
                    set -e
                    echo "=== Build: install deps, compile artefact, build Docker image ==="
                    npm ci
                    export BUILD_NUMBER="${BUILD_NUMBER}"
                    export APP_VERSION="${APP_VERSION}"
                    npm run build
                    IMAGE_TAG="build-${BUILD_NUMBER}"
                    docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" -t "${IMAGE_NAME}:staging" .
                    docker save "${IMAGE_NAME}:${IMAGE_TAG}" | gzip > "artefacts/${IMAGE_NAME}-${IMAGE_TAG}.tar.gz"
                    echo "${IMAGE_TAG}" > artefacts/IMAGE_TAG.txt
                    cp dist/build-manifest.json "$REPORTS_DIR"/build-manifest.json
                    echo "Build artefact: artefacts/${IMAGE_NAME}-${IMAGE_TAG}.tar.gz"
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'dist/**,artefacts/**', fingerprint: true, allowEmptyArchive: true
                }
            }
        }

        stage('Test') {
            steps {
                sh '''
                    set -e
                    echo "=== Test: Jest unit + API integration tests ==="
                    npm test
                    if [ -d coverage ]; then
                      cp -R coverage "$REPORTS_DIR"/coverage || true
                    fi
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/coverage/**,coverage/**', allowEmptyArchive: true
                }
            }
        }

        stage('Code Quality') {
            steps {
                sh '''
                    set -e
                    echo "=== Code Quality: ESLint + quality gate report ==="
                    npm run quality
                    echo "Quality stage focuses on style, duplication signals, and maintainability — not CVE scanning."
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/code-quality.*', allowEmptyArchive: true
                }
            }
        }

        stage('Security') {
            steps {
                sh '''
                    set -e
                    echo "=== Security: npm audit (dependencies) + Trivy image scan ==="
                    mkdir -p "$REPORTS_DIR"
                    set +e
                    npm audit --json > "$REPORTS_DIR"/npm-audit.json
                    AUDIT_EXIT=$?
                    set -e
                    node scripts/security-report.js "$REPORTS_DIR"/npm-audit.json "$REPORTS_DIR"/security-summary.md

                    IMAGE_TAG=$(cat artefacts/IMAGE_TAG.txt)
                    if command -v trivy >/dev/null 2>&1; then
                      trivy image --severity HIGH,CRITICAL --format table --output "$REPORTS_DIR"/trivy.txt "${IMAGE_NAME}:${IMAGE_TAG}" || true
                      trivy image --severity HIGH,CRITICAL --exit-code 0 --format json --output "$REPORTS_DIR"/trivy.json "${IMAGE_NAME}:${IMAGE_TAG}" || true
                    else
                      echo "Trivy CLI not found — running npm audit only. Install: brew install trivy" | tee "$REPORTS_DIR"/trivy.txt
                    fi
                    echo "Security reports written under reports/"
                    # Fail only on critical direct dependency issues if security-report says FAIL
                    if grep -q "GATE: FAIL" "$REPORTS_DIR"/security-summary.md; then
                      echo "Critical vulnerabilities remain unresolved — see security-summary.md"
                      exit 1
                    fi
                    exit 0
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/npm-audit.json,reports/security-summary.md,reports/trivy.*', allowEmptyArchive: true
                }
            }
        }

        stage('Deploy') {
            steps {
                sh '''
                    set -e
                    echo "=== Deploy: push image to staging ==="
                    IMAGE_TAG=$(cat artefacts/IMAGE_TAG.txt)
                    docker tag "${IMAGE_NAME}:${IMAGE_TAG}" "${IMAGE_NAME}:staging"
                    docker rm -f taskflow-staging 2>/dev/null || true
                    if docker compose version >/dev/null 2>&1; then
                      IMAGE_TAG=staging APP_VERSION="$APP_VERSION" docker compose up -d --no-deps --force-recreate taskflow-staging
                    elif command -v docker-compose >/dev/null 2>&1; then
                      IMAGE_TAG=staging APP_VERSION="$APP_VERSION" docker-compose up -d --no-deps --force-recreate taskflow-staging
                    else
                      docker network create taskflow-net 2>/dev/null || true
                      docker run -d --name taskflow-staging --network taskflow-net \
                        -p 3001:3000 -e NODE_ENV=staging -e APP_VERSION="$APP_VERSION" -e PORT=3000 \
                        "${IMAGE_NAME}:staging"
                    fi
                    echo "Waiting for staging health..."
                    for i in 1 2 3 4 5 6 7 8 9 10; do
                      if curl -sf "${STAGING_URL}/health" >/dev/null; then
                        curl -sf "${STAGING_URL}/health" | tee "$REPORTS_DIR"/staging-health.json
                        echo
                        exit 0
                      fi
                      sleep 3
                    done
                    echo "Staging health check failed"
                    docker logs taskflow-staging 2>&1 | tail -n 80 || true
                    exit 1
                '''
            }
        }

        stage('Release') {
            steps {
                sh '''
                    set -e
                    echo "=== Release: promote same artefact to production ==="
                    IMAGE_TAG=$(cat artefacts/IMAGE_TAG.txt)
                    RELEASE_TAG="v${APP_VERSION}.${BUILD_NUMBER}"
                    docker tag "${IMAGE_NAME}:${IMAGE_TAG}" "${IMAGE_NAME}:production"
                    docker tag "${IMAGE_NAME}:${IMAGE_TAG}" "${IMAGE_NAME}:${RELEASE_TAG}"
                    docker rm -f taskflow-production 2>/dev/null || true
                    if docker compose version >/dev/null 2>&1; then
                      IMAGE_TAG=production APP_VERSION="$APP_VERSION" docker compose --profile production up -d --no-deps --force-recreate taskflow-production
                    elif command -v docker-compose >/dev/null 2>&1; then
                      IMAGE_TAG=production APP_VERSION="$APP_VERSION" docker-compose --profile production up -d --no-deps --force-recreate taskflow-production
                    else
                      docker network create taskflow-net 2>/dev/null || true
                      docker run -d --name taskflow-production --network taskflow-net \
                        -p 3002:3000 -e NODE_ENV=production -e APP_VERSION="$APP_VERSION" -e PORT=3000 \
                        "${IMAGE_NAME}:production"
                    fi
                    echo "${RELEASE_TAG}" > artefacts/RELEASE_TAG.txt
                    echo "Waiting for production health..."
                    for i in 1 2 3 4 5 6 7 8 9 10; do
                      if curl -sf "${PRODUCTION_URL}/health" >/dev/null; then
                        curl -sf "${PRODUCTION_URL}/health" | tee "$REPORTS_DIR"/production-health.json
                        echo
                        echo "Released ${RELEASE_TAG}"
                        exit 0
                      fi
                      sleep 3
                    done
                    echo "Production health check failed"
                    docker logs taskflow-production 2>&1 | tail -n 80 || true
                    exit 1
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'artefacts/RELEASE_TAG.txt,reports/production-health.json', allowEmptyArchive: true
                }
            }
        }

        stage('Monitoring') {
            steps {
                sh '''
                    set -e
                    echo "=== Monitoring: Prometheus + Alertmanager + Grafana + alert drills ==="
                    chmod +x scripts/start-monitoring.sh scripts/seed-demo-traffic.sh
                    # Prefer ~/.taskflow-monitoring mounts (Colima often cannot bind /Users/Shared)
                    ./scripts/start-monitoring.sh
                    sleep 5

                    echo "Production /metrics sample:"
                    curl -sf "${PRODUCTION_URL}/metrics" | head -n 60 | tee "$REPORTS_DIR"/metrics-sample.txt

                    echo "Prometheus targets:"
                    curl -sf "${PROMETHEUS_URL}/api/v1/targets" | tee "$REPORTS_DIR"/prometheus-targets.json || true
                    echo

                    echo "=== Seed demo traffic (Grafana analytics before drills) ==="
                    ./scripts/seed-demo-traffic.sh --url "${PRODUCTION_URL}" --rounds 20 | tee "$REPORTS_DIR"/seed-demo-traffic.txt
                    # Give Prometheus a couple of scrapes so rate/latency panels populate
                    sleep 12

                    : > "$REPORTS_DIR"/incident-simulation.txt

                    echo "=== Drill 1: brief production outage (TaskFlowDown) then recover ==="
                    docker stop taskflow-production || true
                    sleep 35
                    curl -sf "${PRODUCTION_URL}/health" && echo "unexpectedly healthy" || echo "Production unreachable as expected during outage drill" | tee -a "$REPORTS_DIR"/incident-simulation.txt
                    curl -sf "${ALERTMANAGER_URL}/api/v2/alerts" | tee "$REPORTS_DIR"/alertmanager-alerts-outage.json || true
                    echo
                    docker start taskflow-production
                    sleep 5
                    curl -sf "${PRODUCTION_URL}/health" | tee -a "$REPORTS_DIR"/incident-simulation.txt
                    echo
                    # Restart resets in-memory counters; warm the failure series before the spike
                    curl -s -o /dev/null -w "login_warmup_fail:%{http_code}\\n" \
                      -X POST "${PRODUCTION_URL}/auth/login" \
                      -H 'Content-Type: application/json' \
                      -d '{"username":"demo","password":"warmup-not-real"}' \
                      | tee -a "$REPORTS_DIR"/incident-simulation.txt || true
                    sleep 8

                    echo "=== Drill 2 (LAST): invalid login spike — leave TaskFlowInvalidLoginSpike firing ==="
                    for i in 1 2 3 4 5 6 7 8; do
                      curl -s -o /dev/null -w "login_fail_${i}:%{http_code}\\n" \
                        -X POST "${PRODUCTION_URL}/auth/login" \
                        -H 'Content-Type: application/json' \
                        -d '{"username":"demo","password":"not-the-real-password"}' \
                        | tee -a "$REPORTS_DIR"/incident-simulation.txt
                    done
                    # Poll until Alertmanager shows the spike; do NOT wait for it to clear (~2m window)
                    SPIKE_SEEN=0
                    for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
                      ALERTS=$(curl -sf "${ALERTMANAGER_URL}/api/v2/alerts" || true)
                      printf '%s\n' "${ALERTS}" > "$REPORTS_DIR"/alertmanager-alerts.json
                      if printf '%s' "${ALERTS}" | grep -q 'TaskFlowInvalidLoginSpike'; then
                        SPIKE_SEEN=1
                        echo "TaskFlowInvalidLoginSpike active in Alertmanager (attempt ${attempt})" | tee -a "$REPORTS_DIR"/incident-simulation.txt
                        break
                      fi
                      sleep 2
                    done
                    if [ "${SPIKE_SEEN}" -ne 1 ]; then
                      echo "WARNING: TaskFlowInvalidLoginSpike not seen within poll window" | tee -a "$REPORTS_DIR"/incident-simulation.txt
                    fi
                    echo "Alertmanager at end of Monitoring (spike left firing for demo):" | tee -a "$REPORTS_DIR"/incident-simulation.txt
                    cat "$REPORTS_DIR"/alertmanager-alerts.json | tee -a "$REPORTS_DIR"/incident-simulation.txt || true
                    echo | tee -a "$REPORTS_DIR"/incident-simulation.txt

                    curl -sf -o /dev/null -w "grafana_http:%{http_code}\\n" "${GRAFANA_URL}/api/health" | tee -a "$REPORTS_DIR"/incident-simulation.txt || true

                    echo "Grafana UI:      ${GRAFANA_URL}  (TaskFlow Operations dashboard)"
                    echo "Prometheus UI:   ${PROMETHEUS_URL}"
                    echo "Alertmanager UI: ${ALERTMANAGER_URL}"
                    cat > "$REPORTS_DIR"/monitoring-notes.md << 'EOF'
# Monitoring notes
- Stack: Prometheus (scrapes host.docker.internal:3001/:3002), Alertmanager (:9093), Grafana (:3003).
- Configs are synced to ~/.taskflow-monitoring before start (Colima-safe mounts).
- Pipeline seeds successful logins, task CRUD, and steady HTTP traffic *before* alert drills so Grafana is never empty after Monitoring.
- Alert rules:
  - TaskFlowInvalidLoginSpike — ≥5 failed logins in 2 minutes
  - TaskFlowDown — scrape target down for 15s
  - TaskFlowHighErrorRate — >20% 5xx
- Incident drill order: (1) brief production stop/restart for TaskFlowDown, (2) LAST invalid-login spike.
- Stage ends while TaskFlowInvalidLoginSpike is still firing (~2m increase window) so Alertmanager is populated at pipeline SUCCESS; production remains up.
- After outage restart, a single warmup failed login recreates the failure series (counters reset on container restart).
EOF
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/metrics-sample.txt,reports/prometheus-targets.json,reports/seed-demo-traffic.txt,reports/incident-simulation.txt,reports/alertmanager-alerts.json,reports/alertmanager-alerts-outage.json,reports/monitoring-notes.md', allowEmptyArchive: true
                }
            }
        }
    }

    post {
        success {
            echo "Pipeline finished SUCCESS — all seven stages completed for build ${BUILD_NUMBER}"
        }
        failure {
            echo "Pipeline FAILED — check the stage console output and archived reports/"
        }
        always {
            sh 'docker ps --filter name=taskflow --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}" || true'
        }
    }
}
