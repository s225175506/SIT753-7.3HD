const request = require('supertest');
const { createApp } = require('../src/app');
const { createStore } = require('../src/store');

describe('TaskFlow API', () => {
  let app;
  let apiKey;

  beforeEach(async () => {
    app = createApp({ store: createStore() });
    const login = await request(app)
      .post('/auth/login')
      .send({ username: 'demo', password: 'demopass' });
    apiKey = login.body.apiKey;
  });

  test('health endpoint reports ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('taskflow-api');
  });

  test('metrics endpoint exposes prometheus text', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/process_cpu|taskflow_/);
  });

  test('failed login increments failure metric', async () => {
    const bad = await request(app)
      .post('/auth/login')
      .send({ username: 'demo', password: 'wrong-password' });
    expect(bad.status).toBe(401);

    const metrics = await request(app).get('/metrics');
    expect(metrics.text).toMatch(/taskflow_login_attempts_total\{result="failure"\}/);
  });

  test('rejects task list without API key', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
  });

  test('register and login flow', async () => {
    const reg = await request(app)
      .post('/auth/register')
      .send({ username: 'alice', password: 'secret12' });
    expect(reg.status).toBe(201);
    expect(reg.body.apiKey).toBeTruthy();

    const login = await request(app)
      .post('/auth/login')
      .send({ username: 'alice', password: 'secret12' });
    expect(login.status).toBe(200);
    expect(login.body.username).toBe('alice');
  });

  test('CRUD tasks for authenticated user', async () => {
    const created = await request(app)
      .post('/api/tasks')
      .set('x-api-key', apiKey)
      .send({ title: 'Write Jenkinsfile', description: 'HD pipeline', status: 'todo' });
    expect(created.status).toBe(201);
    expect(created.body.id).toBeTruthy();

    const listed = await request(app)
      .get('/api/tasks')
      .set('x-api-key', apiKey);
    expect(listed.status).toBe(200);
    expect(listed.body.count).toBe(1);

    const updated = await request(app)
      .patch(`/api/tasks/${created.body.id}`)
      .set('x-api-key', apiKey)
      .send({ status: 'done' });
    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe('done');

    const deleted = await request(app)
      .delete(`/api/tasks/${created.body.id}`)
      .set('x-api-key', apiKey);
    expect(deleted.status).toBe(204);
  });

  test('validation rejects empty title', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('x-api-key', apiKey)
      .send({ title: '   ' });
    expect(res.status).toBe(400);
  });
});
