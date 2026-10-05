const express = require('express');
const cors = require('cors');
const client = require('prom-client');
const { createStore } = require('./store');
const { createTaskRouter } = require('./routes/tasks');
const { createAuthRouter, requireApiKey } = require('./routes/auth');

function createApp(options = {}) {
  const app = express();
  const store = options.store || createStore();
  const register = options.register || new client.Registry();

  client.collectDefaultMetrics({ register });

  const httpRequestDuration = new client.Histogram({
    name: 'taskflow_http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
  });

  const httpRequestsTotal = new client.Counter({
    name: 'taskflow_http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
  });

  const loginAttempts = new client.Counter({
    name: 'taskflow_login_attempts_total',
    help: 'Login attempts by result',
    labelNames: ['result'],
    registers: [register],
  });

  const apiKeyAuthFailures = new client.Counter({
    name: 'taskflow_api_key_auth_failures_total',
    help: 'Rejected API requests due to missing or invalid API key',
    registers: [register],
  });

  const tasksCreated = new client.Counter({
    name: 'taskflow_tasks_created_total',
    help: 'Total number of tasks created',
    registers: [register],
  });

  const tasksUpdated = new client.Counter({
    name: 'taskflow_tasks_updated_total',
    help: 'Total number of tasks updated',
    registers: [register],
  });

  const tasksDeleted = new client.Counter({
    name: 'taskflow_tasks_deleted_total',
    help: 'Total number of tasks deleted',
    registers: [register],
  });

  const metrics = {
    register,
    httpRequestDuration,
    httpRequestsTotal,
    loginAttempts,
    apiKeyAuthFailures,
    tasksCreated,
    tasksUpdated,
    tasksDeleted,
  };

  app.locals.store = store;
  app.locals.metrics = metrics;

  app.use(cors());
  app.use(express.json({ limit: '32kb' }));

  app.use((req, res, next) => {
    const end = httpRequestDuration.startTimer();
    res.on('finish', () => {
      const route = req.route ? req.route.path : req.path;
      const labels = { method: req.method, route, status_code: String(res.statusCode) };
      end(labels);
      httpRequestsTotal.inc(labels);
    });
    next();
  });

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'taskflow-api',
      environment: process.env.NODE_ENV || 'development',
      version: process.env.APP_VERSION || '1.0.0',
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  app.use('/auth', createAuthRouter(store, metrics));
  app.use('/api/tasks', requireApiKey(store, metrics), createTaskRouter(store, metrics));

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) {
      console.error(err);
    }
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
