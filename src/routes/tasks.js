const express = require('express');

function createTaskRouter(store, metrics) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const status = req.query.status;
    let tasks = store.listTasks(req.userId);
    if (status) {
      tasks = tasks.filter((t) => t.status === status);
    }
    res.json({ count: tasks.length, tasks });
  });

  router.get('/:id', (req, res) => {
    const task = store.getTask(req.userId, req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    return res.json(task);
  });

  router.post('/', (req, res, next) => {
    try {
      const task = store.createTask(req.userId, req.body || {});
      if (metrics && metrics.tasksCreated) {
        metrics.tasksCreated.inc();
      }
      return res.status(201).json(task);
    } catch (err) {
      return next(err);
    }
  });

  router.patch('/:id', (req, res, next) => {
    try {
      const task = store.updateTask(req.userId, req.params.id, req.body || {});
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
      return res.json(task);
    } catch (err) {
      return next(err);
    }
  });

  router.delete('/:id', (req, res) => {
    const deleted = store.deleteTask(req.userId, req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Task not found' });
    }
    return res.status(204).send();
  });

  return router;
}

module.exports = { createTaskRouter };
