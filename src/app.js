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

  const tasksCreated = new client.Counter({
    name: 'taskflow_tasks_created_total',
    help: 'Total number of tasks created',
    registers: [register],
  });

  app.locals.store = store;
  app.locals.metrics = { tasksCreated, register };

  app.use(cors());
  app.use(express.json({ limit: '32kb' }));

  app.use((req, res, next) => {
    const end = httpRequestDuration.startTimer();
    res.on('finish', () => {
      const route = req.route ? req.route.path : req.path;
      end({ method: req.method, route, status_code: res.statusCode });
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

  app.use('/auth', createAuthRouter(store));
  app.use('/api/tasks', requireApiKey(store), createTaskRouter(store, app.locals.metrics));

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
