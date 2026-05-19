/**
 * middleware.js — JWT authentication and RBAC authorization middleware.
 */
const jwt = require('jsonwebtoken');
const { getUserPermissions } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'crm-dev-secret-change-in-production';

/**
 * authenticate — verifies the Bearer token and attaches req.user.
 * Returns 401 if missing or invalid.
 */
function authenticate(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Authentication required.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, email, name }
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

/**
 * authorize(permission) — checks the user has the required permission key.
 * Must be used after authenticate().
 * Returns 403 if the user lacks the permission.
 */
function authorize(permission) {
  return (req, res, next) => {
    const perms = getUserPermissions(req.user.id);
    if (!perms.has(permission)) {
      return res.status(403).json({
        message: `Forbidden: you need the '${permission}' permission.`
      });
    }
    next();
  };
}

/**
 * isAdmin — returns true if the user has users.delete (only admin has this).
 */
function isAdmin(userId) {
  const perms = getUserPermissions(userId);
  return perms.has('users.delete');
}

module.exports = { authenticate, authorize, isAdmin, JWT_SECRET };
