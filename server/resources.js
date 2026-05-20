const express = require('express');
const { randomUUID } = require('crypto');
const { query, findById, findOne, insert, update, remove, getUserPermissions } = require('./db');
const { authenticate, authorize } = require('./middleware');

const router = express.Router();
router.use(authenticate);

async function canEditAll(userId) {
  const p = await getUserPermissions(userId);
  return p.has('users.read');
}

function sanitize(val, maxLen = 500) {
  if (val === null || val === undefined) return null;
  return String(val).replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

function makeRouter(table, rP, cP, uP, dP, fields) {
  const r = express.Router();

  r.get('/', authorize(rP), async (req, res) => {
    try {
      const isAdmin = await canEditAll(req.user.id);
      const rows = isAdmin
        ? (await query(`SELECT * FROM ${table} ORDER BY created_at DESC`)).rows
        : (await query(`SELECT * FROM ${table} WHERE owner_user_id=$1 ORDER BY created_at DESC`, [req.user.id])).rows;
      res.json(rows);
    } catch(e) { console.error(e); res.status(500).json({ message: 'Server error.' }); }
  });

  r.get('/:id', authorize(rP), async (req, res) => {
    try {
      const row = await findById(table, req.params.id);
      const isAdmin = await canEditAll(req.user.id);
      if (!row || (!isAdmin && row.owner_user_id !== req.user.id))
        return res.status(404).json({ message: 'Not found.' });
      res.json(row);
    } catch(e) { res.status(500).json({ message: 'Server error.' }); }
  });

  r.post('/', authorize(cP), async (req, res) => {
    try {
      const now    = new Date().toISOString();
      const record = { id: randomUUID(), owner_user_id: req.user.id, created_at: now, updated_at: now };
      for (const f of fields) {
        const raw = req.body[f.key];
        record[f.col] = (raw !== undefined && raw !== null) ? sanitize(raw, f.maxLen || 500) : (f.default ?? null);
        if (f.required && !record[f.col])
          return res.status(400).json({ message: `${f.key} is required.` });
      }
      await insert(table, record);
      res.status(201).json(record);
    } catch(e) { console.error(e); res.status(500).json({ message: 'Server error.' }); }
  });

  r.put('/:id', authorize(uP), async (req, res) => {
    try {
      const row = await findById(table, req.params.id);
      const isAdmin = await canEditAll(req.user.id);
      if (!row || (!isAdmin && row.owner_user_id !== req.user.id))
        return res.status(404).json({ message: 'Not found or forbidden.' });
      const changes = {};
      for (const f of fields) {
        if (req.body[f.key] !== undefined)
          changes[f.col] = sanitize(req.body[f.key], f.maxLen || 500);
      }
      if (Object.keys(changes).length) await update(table, req.params.id, changes);
      res.json({ message: 'Updated.' });
    } catch(e) { res.status(500).json({ message: 'Server error.' }); }
  });

  r.delete('/:id', authorize(dP), async (req, res) => {
    try {
      const row = await findById(table, req.params.id);
      const isAdmin = await canEditAll(req.user.id);
      if (!row || (!isAdmin && row.owner_user_id !== req.user.id))
        return res.status(404).json({ message: 'Not found or forbidden.' });
      await remove(table, { id: req.params.id });
      res.json({ message: 'Deleted.' });
    } catch(e) { res.status(500).json({ message: 'Server error.' }); }
  });

  return r;
}

router.use('/contacts', makeRouter('contacts', 'contacts.read', 'contacts.create', 'contacts.update', 'contacts.delete', [
  { col:'name',           key:'name',           required:true, maxLen:100 },
  { col:'email',          key:'email',          required:true, maxLen:254 },
  { col:'secondary_email',key:'secondaryEmail', maxLen:254 },
  { col:'phone',          key:'phone',          maxLen:20  },
  { col:'company',        key:'company',        maxLen:200 },
  { col:'gender',         key:'gender',         maxLen:20  },
  { col:'age',            key:'age'  },
  { col:'location',       key:'location',       maxLen:200 },
  { col:'qualification',  key:'qualification',  maxLen:100 },
  { col:'specialization', key:'specialization', maxLen:200 },
  { col:'university',     key:'university',     maxLen:200 },
  { col:'designation',    key:'designation',    maxLen:200 },
]));

router.use('/leads', makeRouter('leads', 'leads.read', 'leads.create', 'leads.update', 'leads.delete', [
  { col:'contact_id', key:'contactId' },
  { col:'title',      key:'title',    required:true, maxLen:200 },
  { col:'stage',      key:'stage',    default:'New', maxLen:50  },
  { col:'value',      key:'value',    default:0 },
]));

router.use('/tickets', makeRouter('tickets', 'tickets.read', 'tickets.create', 'tickets.update', 'tickets.delete', [
  { col:'contact_id', key:'contactId' },
  { col:'title',      key:'title',    required:true, maxLen:200 },
  { col:'priority',   key:'priority', default:'Medium', maxLen:20 },
  { col:'status',     key:'status',   default:'Open',   maxLen:50 },
]));

module.exports = router;
