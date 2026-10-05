# TaskFlow API — SIT753 7.3HD

Small Node.js task-management API used to demonstrate a full Jenkins DevOps pipeline:

Build → Test → Code Quality → Security → Deploy → Release → Monitoring

## Stack

- Node.js 20 + Express
- Jest + Supertest (tests)
- ESLint (code quality gate)
- npm audit + Trivy (security)
- Docker Compose (staging + production)
- Prometheus + Alertmanager + Grafana (monitoring / analytics)

## Quick start (local)

```bash
npm ci
npm test
npm run quality
npm start
# http://127.0.0.1:3000/health
```

Demo login: `demo` / `demopass` → use returned `apiKey` as `x-api-key`.

## Docker

```bash
colima start   # if Docker is not already running
docker build -t taskflow-api:staging .
docker compose up -d taskflow-staging
curl http://127.0.0.1:3001/health
```

## Jenkins

See `../SETUP.md` in the parent 7.3HD folder.
