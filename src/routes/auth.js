const express = require('express');

function createAuthRouter(store) {
  const router = express.Router();

  router.post('/register', (req, res, next) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password || String(password).length < 6) {
        return res.status(400).json({ error: 'Username and password (min 6 chars) required' });
      }
      const user = store.createUser(String(username).trim(), String(password));
      return res.status(201).json(user);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    const user = store.authenticate(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    return res.json(user);
  });

  return router;
}

function requireApiKey(store) {
  return (req, res, next) => {
    const header = req.headers['x-api-key'] || req.headers.authorization;
    let key = header;
    if (header && String(header).toLowerCase().startsWith('bearer ')) {
      key = header.slice(7).trim();
    }
    const userId = store.userIdFromApiKey(key);
    if (!userId) {
      return res.status(401).json({ error: 'Missing or invalid API key' });
    }
    req.userId = userId;
    return next();
  };
}

module.exports = { createAuthRouter, requireApiKey };
