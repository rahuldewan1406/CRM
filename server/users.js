/**
 * users.js — User and role management routes (admin only).
 *
 * GET  /users              — list all users (requires users.read)
 * POST /users              — create user  (requires users.create)
 * PUT  /users/:id/roles    — set roles    (requires users.update)
 * GET  /roles              — list roles + permissions (requires users.read)
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const { db } = require('./db');
const { authenticate, authorize } = require('./middleware');

const router = express.Router();
router.use(authenticate);

// GET /users
router.get('/', authorize('users.read'), (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.is_active, u.created_at,
           GROUP_CONCAT(r.name) AS roles
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();
  res.json(users.map((u) => ({ ...u, roles: u.roles ? u.roles.split(',') : [] })));
});

// POST /users
router.post('/', authorize('users.create'), (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'name, email, and password are required.' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ message: 'Email already in use.' });

  const id   = randomUUID();
  const hash = bcrypt.hashSync(password, 12);
  db.prepare(
    'INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)'
  ).run(id, name.trim(), email.trim().toLowerCase(), hash);

  // Assign role (default: viewer)
  const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get(role || 'viewer');
  if (roleRow) {
    db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(id, roleRow.id);
  }

  res.status(201).json({ id, name, email, role: role || 'viewer' });
});

// PUT /users/:id/roles
router.put('/:id/roles', authorize('users.update'), (req, res) => {
  const { roles } = req.body || {};
  if (!Array.isArray(roles)) return res.status(400).json({ message: 'roles must be an array.' });

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });

  db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(req.params.id);
  const insertUR = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)');
  roles.forEach((roleName) => {
    const r = db.prepare('SELECT id FROM roles WHERE name = ?').get(roleName);
    if (r) insertUR.run(req.params.id, r.id);
  });

  res.json({ message: 'Roles updated.' });
});

// GET /roles
router.get('/roles', authorize('users.read'), (req, res) => {
  const roles = db.prepare('SELECT r.id, r.name, GROUP_CONCAT(p.key) AS permissions FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id GROUP BY r.id').all();
  res.json(roles.map((r) => ({ ...r, permissions: r.permissions ? r.permissions.split(',') : [] })));
});

module.exports = router;
