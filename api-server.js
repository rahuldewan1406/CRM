/**
 * api-server.js — Main RBAC API server.
 *
 * Runs on port 3002 (separate from the SMTP server on 3001).
 *
 * Routes:
 *   POST   /auth/login
 *   POST   /auth/refresh
 *   POST   /auth/logout
 *   GET    /auth/me
 *   GET    /users              (admin)
 *   POST   /users              (admin)
 *   PUT    /users/:id/roles    (admin)
 *   GET    /users/roles        (admin)
 *   GET/POST/PUT/DELETE /contacts
 *   GET/POST/PUT/DELETE /leads
 *   GET/POST/PUT/DELETE /tickets
 *   GET    /health
 */
const express = require('express');
const cors    = require('cors');
require('dotenv').config();

// Initialise DB (creates tables + seeds) on startup
require('./server/db');

const authRouter      = require('./server/auth');
const usersRouter     = require('./server/users');
const resourcesRouter = require('./server/resources');

const app = express();

// ── CORS — tighten ALLOWED_ORIGIN in .env for production ─────────────────────
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:8000';
app.use(cors({
  origin: ALLOWED_ORIGIN,
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',  authRouter);
app.use('/users', usersRouter);
app.use('/',      resourcesRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error.' });
});

process.on('unhandledRejection', (r) => console.error('Unhandled rejection:', r));
process.on('uncaughtException',  (e) => { console.error('Uncaught exception:', e); process.exit(1); });

const PORT = process.env.API_PORT || 3002;
app.listen(PORT, () => console.log(`CRM API running on http://localhost:${PORT}`));
