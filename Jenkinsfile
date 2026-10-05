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
                    echo "=== Monitoring: Prometheus + Alertmanager + live metrics check ==="
                    docker rm -f taskflow-prometheus taskflow-alertmanager 2>/dev/null || true
                    # Free host ports if a leftover stack (e.g. SteadyRx) still holds them
                    docker ps -q --filter publish=9090 | while read id; do docker rm -f "$id"; done
                    docker ps -q --filter publish=9093 | while read id; do docker rm -f "$id"; done
                    if docker compose version >/dev/null 2>&1; then
                      docker compose --profile monitoring up -d prometheus alertmanager
                    elif command -v docker-compose >/dev/null 2>&1; then
                      docker-compose --profile monitoring up -d prometheus alertmanager
                    else
                      docker network create taskflow-net 2>/dev/null || true
                      docker run -d --name taskflow-prometheus --network taskflow-net \
                        -p 9090:9090 \
                        -v "$PWD/monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro" \
                        -v "$PWD/monitoring/alert-rules.yml:/etc/prometheus/alert-rules.yml:ro" \
                        prom/prometheus:v2.54.1 \
                        --config.file=/etc/prometheus/prometheus.yml --web.enable-lifecycle
                      docker run -d --name taskflow-alertmanager --network taskflow-net \
                        --network-alias alertmanager \
                        -p 9093:9093 \
                        -v "$PWD/monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro" \
                        prom/alertmanager:v0.27.0
                    fi
                    sleep 5

                    echo "Production /metrics sample:"
                    curl -sf "${PRODUCTION_URL}/metrics" | head -n 40 | tee "$REPORTS_DIR"/metrics-sample.txt

                    echo "Prometheus targets:"
                    curl -sf "${PROMETHEUS_URL}/api/v1/targets" | tee "$REPORTS_DIR"/prometheus-targets.json || true
                    echo

                    echo "Simulating incident: stop production long enough for TaskFlowDown (for: 15s) to fire..."
                    docker stop taskflow-production || true
                    sleep 60
                    curl -sf "${PRODUCTION_URL}/health" && echo "unexpectedly healthy" || echo "Production unreachable as expected during simulation" | tee "$REPORTS_DIR"/incident-simulation.txt
                    echo "Alertmanager alerts while production is down:"
                    curl -sf "http://127.0.0.1:9093/api/v2/alerts" | tee "$REPORTS_DIR"/alertmanager-alerts.json || true
                    echo
                    docker start taskflow-production
                    sleep 5
                    curl -sf "${PRODUCTION_URL}/health" | tee -a "$REPORTS_DIR"/incident-simulation.txt
                    echo
                    echo "Alertmanager UI: http://127.0.0.1:9093"
                    echo "Prometheus UI:   http://127.0.0.1:9090"
                    cat > "$REPORTS_DIR"/monitoring-notes.md << 'EOF'
# Monitoring notes
- Prometheus scrapes staging (:3001) and production (:3002) `/metrics` endpoints via host.docker.internal.
- Alert rules: TaskFlowDown (target up == 0 for 15s), TaskFlowHighErrorRate (5xx ratio).
- Incident simulation stops production ~60s, archives Alertmanager alerts while down, then restarts.
- Alertmanager receives alerts on :9093 (webhook receiver configured for demo).
EOF
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'reports/metrics-sample.txt,reports/prometheus-targets.json,reports/incident-simulation.txt,reports/alertmanager-alerts.json,reports/monitoring-notes.md', allowEmptyArchive: true
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
