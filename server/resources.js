/**
 * resources.js — CRM resource CRUD routes with RBAC + ownership enforcement.
 *
 * Contacts:  GET/POST /contacts,  GET/PUT/DELETE /contacts/:id
 * Leads:     GET/POST /leads,     GET/PUT/DELETE /leads/:id
 * Tickets:   GET/POST /tickets,   GET/PUT/DELETE /tickets/:id
 *
 * Ownership rule:
 *   - admin/manager: see and edit ALL records
 *   - sales_rep:     see and edit only records where owner_user_id = req.user.id
 *   - viewer:        read-only, sees all records
 */
const express = require('express');
const { randomUUID } = require('crypto');
const { db, getUserPermissions } = require('./db');
const { authenticate, authorize } = require('./middleware');

const router = express.Router();
router.use(authenticate);

// ── Ownership helper ──────────────────────────────────────────────────────────
function canEditAll(userId) {
  const perms = getUserPermissions(userId);
  return perms.has('users.read'); // admin + manager have users.read
}

function ownerFilter(userId) {
  return canEditAll(userId) ? '' : 'AND owner_user_id = @userId';
}

// ── Generic resource factory ──────────────────────────────────────────────────
function makeResourceRouter(table, readPerm, createPerm, updatePerm, deletePerm, fields) {
  const r = express.Router();

  // LIST
  r.get('/', authorize(readPerm), (req, res) => {
    const filter = ownerFilter(req.user.id);
    const rows = db.prepare(`SELECT * FROM ${table} WHERE 1=1 ${filter} ORDER BY created_at DESC`).all(
      filter ? { userId: req.user.id } : {}
    );
    res.json(rows);
  });

  // GET by id
  r.get('/:id', authorize(readPerm), (req, res) => {
    const filter = ownerFilter(req.user.id);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = @id ${filter}`).get(
      filter ? { id: req.params.id, userId: req.user.id } : { id: req.params.id }
    );
    if (!row) return res.status(404).json({ message: 'Not found.' });
    res.json(row);
  });

  // CREATE
  r.post('/', authorize(createPerm), (req, res) => {
    const id = randomUUID();
    const now = new Date().toISOString();
    const cols = ['id', 'owner_user_id', ...fields.map((f) => f.col), 'created_at', 'updated_at'];
    const vals = [id, req.user.id, ...fields.map((f) => req.body[f.key] ?? f.default ?? null), now, now];
    const placeholders = cols.map(() => '?').join(', ');
    db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
    res.status(201).json({ id, owner_user_id: req.user.id, ...Object.fromEntries(fields.map((f) => [f.col, req.body[f.key] ?? f.default ?? null])) });
  });

  // UPDATE
  r.put('/:id', authorize(updatePerm), (req, res) => {
    const filter = ownerFilter(req.user.id);
    const existing = db.prepare(`SELECT * FROM ${table} WHERE id = @id ${filter}`).get(
      filter ? { id: req.params.id, userId: req.user.id } : { id: req.params.id }
    );
    if (!existing) return res.status(404).json({ message: 'Not found or forbidden.' });

    const sets = fields.map((f) => `${f.col} = ?`).join(', ') + ', updated_at = ?';
    const vals = [...fields.map((f) => req.body[f.key] ?? existing[f.col]), new Date().toISOString(), req.params.id];
    db.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...vals);
    res.json({ message: 'Updated.' });
  });

  // DELETE
  r.delete('/:id', authorize(deletePerm), (req, res) => {
    const filter = ownerFilter(req.user.id);
    const existing = db.prepare(`SELECT id FROM ${table} WHERE id = @id ${filter}`).get(
      filter ? { id: req.params.id, userId: req.user.id } : { id: req.params.id }
    );
    if (!existing) return res.status(404).json({ message: 'Not found or forbidden.' });
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
    res.json({ message: 'Deleted.' });
  });

  return r;
}

// ── Contacts ──────────────────────────────────────────────────────────────────
router.use('/contacts', makeResourceRouter(
  'contacts',
  'contacts.read', 'contacts.create', 'contacts.update', 'contacts.delete',
  [
    { col: 'name',            key: 'name' },
    { col: 'email',           key: 'email' },
    { col: 'secondary_email', key: 'secondaryEmail' },
    { col: 'phone',           key: 'phone' },
    { col: 'company',         key: 'company' },
    { col: 'gender',          key: 'gender' },
    { col: 'age',             key: 'age' },
    { col: 'location',        key: 'location' },
  ]
));

// ── Leads ─────────────────────────────────────────────────────────────────────
router.use('/leads', makeResourceRouter(
  'leads',
  'leads.read', 'leads.create', 'leads.update', 'leads.delete',
  [
    { col: 'contact_id', key: 'contactId' },
    { col: 'title',      key: 'title' },
    { col: 'stage',      key: 'stage',  default: 'New' },
    { col: 'value',      key: 'value',  default: 0 },
  ]
));

// ── Tickets ───────────────────────────────────────────────────────────────────
router.use('/tickets', makeResourceRouter(
  'tickets',
  'tickets.read', 'tickets.create', 'tickets.update', 'tickets.delete',
  [
    { col: 'contact_id', key: 'contactId' },
    { col: 'title',      key: 'title' },
    { col: 'priority',   key: 'priority', default: 'Medium' },
    { col: 'status',     key: 'status',   default: 'Open' },
  ]
));

module.exports = router;
