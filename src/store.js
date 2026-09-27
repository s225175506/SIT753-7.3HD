const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

function createStore() {
  const users = new Map();
  const tasks = new Map();
  const apiKeys = new Map();

  // Seed demo user for local and pipeline smoke tests
  const demoUserId = uuidv4();
  users.set('demo', {
    id: demoUserId,
    username: 'demo',
    // password: demopass (sha256 for demo only — not production auth)
    passwordHash: crypto.createHash('sha256').update('demopass').digest('hex'),
  });
  const demoKey = 'tf_demo_key_change_me';
  apiKeys.set(demoKey, demoUserId);

  return {
    users,
    tasks,
    apiKeys,

    createUser(username, password) {
      if (users.has(username)) {
        const err = new Error('Username already exists');
        err.status = 409;
        throw err;
      }
      const id = uuidv4();
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      users.set(username, { id, username, passwordHash });
      const apiKey = `tf_${crypto.randomBytes(16).toString('hex')}`;
      apiKeys.set(apiKey, id);
      return { id, username, apiKey };
    },

    authenticate(username, password) {
      const user = users.get(username);
      if (!user) return null;
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      if (hash !== user.passwordHash) return null;
      let apiKey = null;
      for (const [key, userId] of apiKeys.entries()) {
        if (userId === user.id) {
          apiKey = key;
          break;
        }
      }
      if (!apiKey) {
        apiKey = `tf_${crypto.randomBytes(16).toString('hex')}`;
        apiKeys.set(apiKey, user.id);
      }
      return { id: user.id, username: user.username, apiKey };
    },

    userIdFromApiKey(apiKey) {
      return apiKeys.get(apiKey) || null;
    },

    listTasks(userId) {
      return [...tasks.values()]
        .filter((t) => t.userId === userId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    getTask(userId, taskId) {
      const task = tasks.get(taskId);
      if (!task || task.userId !== userId) return null;
      return task;
    },

    createTask(userId, { title, description = '', status = 'todo' }) {
      if (!title || !String(title).trim()) {
        const err = new Error('Title is required');
        err.status = 400;
        throw err;
      }
      const allowed = new Set(['todo', 'in_progress', 'done']);
      if (!allowed.has(status)) {
        const err = new Error('Invalid status');
        err.status = 400;
        throw err;
      }
      const now = new Date().toISOString();
      const task = {
        id: uuidv4(),
        userId,
        title: String(title).trim(),
        description: String(description || ''),
        status,
        createdAt: now,
        updatedAt: now,
      };
      tasks.set(task.id, task);
      return task;
    },

    updateTask(userId, taskId, patch) {
      const task = this.getTask(userId, taskId);
      if (!task) return null;
      if (patch.title !== undefined) {
        if (!String(patch.title).trim()) {
          const err = new Error('Title cannot be empty');
          err.status = 400;
          throw err;
        }
        task.title = String(patch.title).trim();
      }
      if (patch.description !== undefined) {
        task.description = String(patch.description);
      }
      if (patch.status !== undefined) {
        const allowed = new Set(['todo', 'in_progress', 'done']);
        if (!allowed.has(patch.status)) {
          const err = new Error('Invalid status');
          err.status = 400;
          throw err;
        }
        task.status = patch.status;
      }
      task.updatedAt = new Date().toISOString();
      tasks.set(task.id, task);
      return task;
    },

    deleteTask(userId, taskId) {
      const task = this.getTask(userId, taskId);
      if (!task) return false;
      tasks.delete(taskId);
      return true;
    },
  };
}

module.exports = { createStore };
