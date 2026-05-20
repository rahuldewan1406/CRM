/**
 * db.js — PostgreSQL database layer
 * Replaces lowdb/JSON file store for production deployment
 */
const { Pool } = require('pg');
const bcrypt    = require('bcryptjs');
const { randomUUID } = require('crypto');

// ── Connection pool ────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => console.error('[DB] Unexpected pool error:', err.message));

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();
  }
}

// ── Schema migration (idempotent — safe to run on every start) ─────
async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      email        TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_active    INTEGER DEFAULT 1,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS roles (
      id   TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id  TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id       TEXT REFERENCES roles(id) ON DELETE CASCADE,
      permission_id TEXT REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token      TEXT PRIMARY KEY,
      user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id             TEXT PRIMARY KEY,
      owner_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
      name           TEXT NOT NULL,
      email          TEXT,
      secondary_email TEXT,
      phone          TEXT,
      company        TEXT,
      gender         TEXT,
      age            INTEGER,
      location       TEXT,
      qualification  TEXT,
      specialization TEXT,
      university     TEXT,
      designation    TEXT,
      tags           TEXT,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS leads (
      id            TEXT PRIMARY KEY,
      owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      contact_id    TEXT REFERENCES contacts(id) ON DELETE SET NULL,
      title         TEXT NOT NULL,
      stage         TEXT DEFAULT 'New',
      value         NUMERIC DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id            TEXT PRIMARY KEY,
      owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      contact_id    TEXT REFERENCES contacts(id) ON DELETE SET NULL,
      title         TEXT NOT NULL,
      priority      TEXT DEFAULT 'Medium',
      status        TEXT DEFAULT 'Open',
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_contacts_owner   ON contacts(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_email   ON contacts(email);
    CREATE INDEX IF NOT EXISTS idx_leads_owner      ON leads(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_owner    ON tickets(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_exp  ON refresh_tokens(expires_at);
  `);
  console.log('[DB] Schema migration complete');
}

// ── Seed roles, permissions, and default admin ─────────────────────
async function seed() {
  const ROLES = [
    { id: 'role_admin',   name: 'admin'    },
    { id: 'role_manager', name: 'manager'  },
    { id: 'role_sales',   name: 'sales_rep'},
    { id: 'role_viewer',  name: 'viewer'   },
  ];
  const RESOURCES = ['contacts','leads','tickets','users'];
  const ACTIONS   = ['read','create','update','delete'];
  const PERMS = RESOURCES.flatMap(r => ACTIONS.map(a => ({ id: `perm_${r}_${a}`, key: `${r}.${a}` })));

  for (const role of ROLES) {
    await query(`INSERT INTO roles(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING`, [role.id, role.name]);
  }
  for (const perm of PERMS) {
    await query(`INSERT INTO permissions(id,key) VALUES($1,$2) ON CONFLICT(id) DO NOTHING`, [perm.id, perm.key]);
  }

  // Role-permission matrix
  const ROLE_PERMS = {
    role_admin:   PERMS.map(p => p.id),
    role_manager: PERMS.filter(p => !p.key.startsWith('users.')).map(p => p.id),
    role_sales:   PERMS.filter(p => (p.key.startsWith('contacts.')||p.key.startsWith('leads.')||p.key.startsWith('tickets.')) && !p.key.endsWith('.delete')).map(p => p.id),
    role_viewer:  PERMS.filter(p => p.key.endsWith('.read')).map(p => p.id),
  };
  for (const [roleId, permIds] of Object.entries(ROLE_PERMS)) {
    for (const permId of permIds) {
      await query(`INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [roleId, permId]);
    }
  }

  // Default admin (only if no admin exists)
  const existing = await query(`SELECT id FROM users WHERE email=$1`, ['admin@crm.local']);
  if (existing.rows.length === 0) {
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    if (adminPass === 'admin123') {
      console.warn('[WARN] Using default admin password — set ADMIN_PASSWORD env var in production!');
    }
    const id = randomUUID();
    await query(
      `INSERT INTO users(id,name,email,password_hash,is_active,created_at) VALUES($1,$2,$3,$4,1,NOW())`,
      [id, 'CRM Admin', 'admin@crm.local', bcrypt.hashSync(adminPass, 12)]
    );
    await query(`INSERT INTO user_roles(user_id,role_id) VALUES($1,'role_admin') ON CONFLICT DO NOTHING`, [id]);
    console.log(`[DB] Seeded admin: admin@crm.local / ${adminPass}`);
  }
  console.log('[DB] Seed complete');
}

// ── Query helpers (matching old lowdb API shape) ───────────────────
async function findById(table, id) {
  const r = await query(`SELECT * FROM ${table} WHERE id=$1`, [id]);
  return r.rows[0] || null;
}

async function findOne(table, filter) {
  // filter is either { column: value } or a SQL string
  if (typeof filter === 'object') {
    const keys = Object.keys(filter);
    const vals = Object.values(filter);
    const where = keys.map((k,i) => `${k}=$${i+1}`).join(' AND ');
    const r = await query(`SELECT * FROM ${table} WHERE ${where} LIMIT 1`, vals);
    return r.rows[0] || null;
  }
  const r = await query(`SELECT * FROM ${table} WHERE ${filter} LIMIT 1`);
  return r.rows[0] || null;
}

async function findAll(table, filter) {
  if (!filter) {
    const r = await query(`SELECT * FROM ${table}`);
    return r.rows;
  }
  if (typeof filter === 'object') {
    const keys = Object.keys(filter);
    const vals = Object.values(filter);
    const where = keys.map((k,i) => `${k}=$${i+1}`).join(' AND ');
    const r = await query(`SELECT * FROM ${table} WHERE ${where}`, vals);
    return r.rows;
  }
  const r = await query(`SELECT * FROM ${table} WHERE ${filter}`);
  return r.rows;
}

async function insert(table, record) {
  const keys = Object.keys(record);
  const vals = Object.values(record);
  const cols  = keys.join(',');
  const plh   = keys.map((_,i) => `$${i+1}`).join(',');
  await query(`INSERT INTO ${table}(${cols}) VALUES(${plh}) ON CONFLICT(id) DO NOTHING`, vals);
  return record;
}

async function update(table, id, changes) {
  const keys = Object.keys(changes);
  if (!keys.length) return false;
  const set  = keys.map((k,i) => `${k}=$${i+1}`).join(',');
  const vals = [...Object.values(changes), id];
  await query(`UPDATE ${table} SET ${set},updated_at=NOW() WHERE id=$${keys.length+1}`, vals);
  return true;
}

async function remove(table, filter) {
  if (typeof filter === 'object') {
    const keys = Object.keys(filter);
    const vals = Object.values(filter);
    const where = keys.map((k,i) => `${k}=$${i+1}`).join(' AND ');
    await query(`DELETE FROM ${table} WHERE ${where}`, vals);
  } else if (typeof filter === 'string') {
    await query(`DELETE FROM ${table} WHERE ${filter}`);
  }
}

// ── getUserPermissions ─────────────────────────────────────────────
async function getUserPermissions(userId) {
  const r = await query(`
    SELECT p.key FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    JOIN user_roles ur ON ur.role_id = rp.role_id
    WHERE ur.user_id = $1
  `, [userId]);
  return new Set(r.rows.map(row => row.key));
}

// ── Initialise on first require ────────────────────────────────────
let _ready = false;
async function init() {
  if (_ready) return;
  await migrate();
  await seed();
  _ready = true;
}

module.exports = {
  query, pool, init,
  findById, findOne, findAll,
  insert, update, remove,
  getUserPermissions,
};
