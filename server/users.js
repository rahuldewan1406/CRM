const express = require('express');
const bcrypt  = require('bcryptjs');
const { randomUUID } = require('crypto');
const { query, findOne, findById, insert, remove } = require('./db');
const { authenticate, authorize } = require('./middleware');

const router   = express.Router();
router.use(authenticate);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['admin','manager','sales_rep','viewer'];

router.get('/', authorize('users.read'), async (req, res) => {
  const { rows } = await query(`
    SELECT u.id, u.name, u.email, u.is_active, u.created_at,
           COALESCE(json_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '[]') AS roles
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    GROUP BY u.id ORDER BY u.created_at DESC
  `);
  res.json(rows);
});

router.post('/', authorize('users.create'), async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || name.trim().length < 2 || name.length > 100)
    return res.status(400).json({ message: 'Name must be 2–100 characters.' });
  if (!email || !EMAIL_RE.test(email) || email.length > 254)
    return res.status(400).json({ message: 'Valid email required.' });
  if (!password || password.length < 6 || password.length > 128)
    return res.status(400).json({ message: 'Password must be 6–128 characters.' });
  if (role && !VALID_ROLES.includes(role))
    return res.status(400).json({ message: 'Invalid role.' });
  const existing = await findOne('users', { email: email.toLowerCase() });
  if (existing) return res.status(409).json({ message: 'Email already in use.' });
  const id = randomUUID();
  await query(
    `INSERT INTO users(id,name,email,password_hash,is_active,created_at) VALUES($1,$2,$3,$4,1,NOW())`,
    [id, name.trim(), email.toLowerCase(), bcrypt.hashSync(password, 12)]
  );
  const roleRow = await findOne('roles', { name: role || 'viewer' });
  if (roleRow) await query(`INSERT INTO user_roles(user_id,role_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [id, roleRow.id]);
  res.status(201).json({ id, name: name.trim(), email: email.toLowerCase(), role: role || 'viewer' });
});

router.put('/:id/roles', authorize('users.update'), async (req, res) => {
  const { roles } = req.body || {};
  if (!Array.isArray(roles)) return res.status(400).json({ message: 'roles must be array.' });
  const user = await findById('users', req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  // Protect last admin
  const isAdmin = (await query(`SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.name='admin'`, [req.params.id])).rows.length > 0;
  const adminCount = (await query(`SELECT COUNT(*) FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.name='admin'`)).rows[0].count;
  if (isAdmin && !roles.includes('admin') && parseInt(adminCount) <= 1)
    return res.status(400).json({ message: 'Cannot remove the last admin.' });
  await query(`DELETE FROM user_roles WHERE user_id=$1`, [req.params.id]);
  for (const name of roles) {
    const r = await findOne('roles', { name });
    if (r) await query(`INSERT INTO user_roles(user_id,role_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, r.id]);
  }
  res.json({ message: 'Roles updated.' });
});

router.put('/:id/status', authorize('users.update'), async (req, res) => {
  const { is_active } = req.body || {};
  if (req.params.id === req.user.id) return res.status(400).json({ message: 'Cannot suspend yourself.' });
  await query(`UPDATE users SET is_active=$1 WHERE id=$2`, [is_active ? 1 : 0, req.params.id]);
  res.json({ message: 'Status updated.' });
});

router.delete('/:id', authorize('users.delete'), async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ message: 'Cannot delete yourself.' });
  await query(`DELETE FROM users WHERE id=$1`, [req.params.id]);
  res.json({ message: 'User deleted.' });
});

router.get('/roles', authorize('users.read'), async (req, res) => {
  const { rows } = await query(`
    SELECT r.id, r.name, COALESCE(json_agg(p.key) FILTER (WHERE p.key IS NOT NULL), '[]') AS permissions
    FROM roles r
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    GROUP BY r.id ORDER BY r.name
  `);
  res.json(rows);
});

module.exports = router;
