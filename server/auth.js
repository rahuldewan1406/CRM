/**
 * auth.js — Authentication routes.
 *
 * POST /auth/login    — email + password → access token + refresh token
 * POST /auth/refresh  — refresh token → new access token
 * POST /auth/logout   — invalidate refresh token
 * GET  /auth/me       — return current user profile + permissions
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { db, getUserPermissions } = require('./db');
const { authenticate, JWT_SECRET } = require('./middleware');

const router = express.Router();

const ACCESS_TOKEN_TTL  = '15m';
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

function makeAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(
    String(email).trim().toLowerCase()
  );
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }

  const accessToken  = makeAccessToken(user);
  const refreshToken = randomUUID();
  const expiresAt    = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000).toISOString();

  db.prepare(
    'INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)'
  ).run(refreshToken, user.id, expiresAt);

  const permissions = [...getUserPermissions(user.id)];

  res.json({
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email },
    permissions,
  });
});

// ── POST /auth/refresh ────────────────────────────────────────────────────────
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ message: 'Refresh token required.' });

  const row = db.prepare(
    'SELECT * FROM refresh_tokens WHERE token = ?'
  ).get(refreshToken);

  if (!row || new Date(row.expires_at) < new Date()) {
    return res.status(401).json({ message: 'Invalid or expired refresh token.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(row.user_id);
  if (!user) return res.status(401).json({ message: 'User not found or inactive.' });

  // Rotate refresh token
  db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
  const newRefresh  = randomUUID();
  const expiresAt   = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000).toISOString();
  db.prepare(
    'INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)'
  ).run(newRefresh, user.id, expiresAt);

  res.json({
    accessToken:  makeAccessToken(user),
    refreshToken: newRefresh,
  });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
  }
  res.json({ message: 'Logged out.' });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id, name, email, is_active, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  const permissions = [...getUserPermissions(user.id)];
  res.json({ user, permissions });
});

module.exports = router;
