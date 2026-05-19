/**
 * db.js — SQLite database setup using Node 22 built-in sqlite module.
 * Creates all tables, seeds roles/permissions, and seeds the default admin user.
 *
 * To migrate to PostgreSQL later, replace this file with a pg-based equivalent
 * and keep the same exported `db` interface.
 */
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'crm.db');
const db = new DatabaseSync(DB_PATH);

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;

  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS roles (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS permissions (
    id  TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
  );

  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id       TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id              TEXT PRIMARY KEY,
    owner_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL,
    secondary_email TEXT,
    phone           TEXT,
    company         TEXT,
    gender          TEXT,
    age             INTEGER,
    location        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leads (
    id            TEXT PRIMARY KEY,
    owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    contact_id    TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    title         TEXT NOT NULL,
    stage         TEXT NOT NULL DEFAULT 'New',
    value         REAL NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id            TEXT PRIMARY KEY,
    owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    contact_id    TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    title         TEXT NOT NULL,
    priority      TEXT NOT NULL DEFAULT 'Medium',
    status        TEXT NOT NULL DEFAULT 'Open',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Seed roles ────────────────────────────────────────────────────────────────
const ROLES = [
  { id: 'role_admin',    name: 'admin' },
  { id: 'role_manager',  name: 'manager' },
  { id: 'role_sales',    name: 'sales_rep' },
  { id: 'role_viewer',   name: 'viewer' },
];

const RESOURCES = ['contacts', 'leads', 'tickets', 'users'];
const ACTIONS   = ['read', 'create', 'update', 'delete'];

const PERMISSIONS = RESOURCES.flatMap((r) =>
  ACTIONS.map((a) => ({ id: `perm_${r}_${a}`, key: `${r}.${a}` }))
);

const insertRole = db.prepare(
  'INSERT OR IGNORE INTO roles (id, name) VALUES (?, ?)'
);
const insertPerm = db.prepare(
  'INSERT OR IGNORE INTO permissions (id, key) VALUES (?, ?)'
);
ROLES.forEach((r) => insertRole.run(r.id, r.name));
PERMISSIONS.forEach((p) => insertPerm.run(p.id, p.key));

// ── Role → permission matrix ──────────────────────────────────────────────────
const ROLE_PERMS = {
  role_admin:   PERMISSIONS.map((p) => p.id),   // everything
  role_manager: PERMISSIONS.filter((p) =>
    !p.key.startsWith('users.')                  // no user management
  ).map((p) => p.id),
  role_sales:   PERMISSIONS.filter((p) =>
    (p.key.startsWith('contacts.') || p.key.startsWith('leads.') || p.key.startsWith('tickets.')) &&
    !p.key.endsWith('.delete')                   // no delete
  ).map((p) => p.id),
  role_viewer:  PERMISSIONS.filter((p) =>
    p.key.endsWith('.read')                      // read-only
  ).map((p) => p.id),
};

const insertRolePerm = db.prepare(
  'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
);
Object.entries(ROLE_PERMS).forEach(([roleId, permIds]) => {
  permIds.forEach((pid) => insertRolePerm.run(roleId, pid));
});

// ── Seed default admin user ───────────────────────────────────────────────────
const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@crm.local');
if (!existingAdmin) {
  const { randomUUID } = require('crypto');
  const adminId = randomUUID();
  const hash = bcrypt.hashSync('admin123', 12);
  db.prepare(
    'INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)'
  ).run(adminId, 'CRM Admin', 'admin@crm.local', hash);
  db.prepare(
    'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)'
  ).run(adminId, 'role_admin');
  console.log('Seeded default admin user: admin@crm.local / admin123');
}

// ── Helper: get all permission keys for a user ────────────────────────────────
function getUserPermissions(userId) {
  const rows = db.prepare(`
    SELECT DISTINCT p.key
    FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = ?
  `).all(userId);
  return new Set(rows.map((r) => r.key));
}

module.exports = { db, getUserPermissions };
