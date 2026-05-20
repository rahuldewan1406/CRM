const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { findOne, insert, remove, query, getUserPermissions } = require('./db');
const { authenticate, JWT_SECRET } = require('./middleware');

const router      = express.Router();
const ACCESS_TTL  = '15m';
const REFRESH_SECS = 7 * 24 * 60 * 60;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 15 * 60 * 1000;

const loginAttempts = {};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkRL(ip) {
  const now = Date.now();
  const rec = loginAttempts[ip];
  if (!rec || now > rec.resetAt) {
    loginAttempts[ip] = { count: 0, resetAt: now + LOCKOUT_MS };
    return { locked: false };
  }
  if (rec.count >= MAX_ATTEMPTS) {
    return { locked: true, waitMins: Math.ceil((rec.resetAt - now) / 60000) };
  }
  return { locked: false };
}

async function purgeExpiredTokens() {
  await query(`DELETE FROM refresh_tokens WHERE expires_at < NOW()`);
}

function makeAccess(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: ACCESS_TTL });
}

router.post('/login', async (req, res) => {
  const ip = req.ip || 'unknown';
  const rl = checkRL(ip);
  if (rl.locked) return res.status(429).json({ message: `Too many attempts. Wait ${rl.waitMins} min.` });

  const { email, password } = req.body || {};
  if (!email || !EMAIL_RE.test(email.trim()) || email.length > 254)
    return res.status(400).json({ message: 'Invalid email.' });
  if (!password || password.length < 6 || password.length > 128)
    return res.status(400).json({ message: 'Password must be 6–128 chars.' });

  try {
    const user = await findOne('users', { email: email.trim().toLowerCase() });
    if (!user || user.is_active === 0 || !bcrypt.compareSync(password, user.password_hash)) {
      loginAttempts[ip] = loginAttempts[ip] || { count: 0, resetAt: Date.now() + LOCKOUT_MS };
      loginAttempts[ip].count++;
      return res.status(401).json({ message: 'Invalid credentials.' });
    }
    delete loginAttempts[ip];
    purgeExpiredTokens().catch(() => {});
    const refreshToken = randomUUID();
    await insert('refresh_tokens', {
      token: refreshToken, user_id: user.id,
      expires_at: new Date(Date.now() + REFRESH_SECS * 1000).toISOString(),
    });
    const perms = await getUserPermissions(user.id);
    res.json({
      accessToken: makeAccess(user), refreshToken,
      user: { id: user.id, name: user.name, email: user.email },
      permissions: [...perms],
    });
  } catch(e) {
    console.error('[auth/login]', e.message);
    res.status(500).json({ message: 'Server error.' });
  }
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken || typeof refreshToken !== 'string')
    return res.status(400).json({ message: 'Refresh token required.' });
  try {
    const row = await findOne('refresh_tokens', { token: refreshToken });
    if (!row || new Date(row.expires_at) < new Date())
      return res.status(401).json({ message: 'Invalid or expired token.' });
    const user = await findOne('users', { id: row.user_id });
    if (!user || user.is_active === 0)
      return res.status(401).json({ message: 'User not found or suspended.' });
    await remove('refresh_tokens', { token: refreshToken });
    const newToken = randomUUID();
    await insert('refresh_tokens', { token: newToken, user_id: user.id, expires_at: new Date(Date.now() + REFRESH_SECS * 1000).toISOString() });
    res.json({ accessToken: makeAccess(user), refreshToken: newToken });
  } catch(e) {
    console.error('[auth/refresh]', e.message);
    res.status(500).json({ message: 'Server error.' });
  }
});

router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) await remove('refresh_tokens', { token: refreshToken }).catch(() => {});
  res.json({ message: 'Logged out.' });
});

router.get('/me', authenticate, async (req, res) => {
  const user = await findOne('users', { id: req.user.id });
  if (!user) return res.status(404).json({ message: 'Not found.' });
  const { password_hash, ...safe } = user;
  const perms = await getUserPermissions(user.id);
  res.json({ user: safe, permissions: [...perms] });
});

module.exports = router;
