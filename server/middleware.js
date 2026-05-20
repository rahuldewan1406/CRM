const jwt = require('jsonwebtoken');
const { findOne, getUserPermissions } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('FATAL: JWT_SECRET not set'); process.exit(1);
}
const EFFECTIVE_SECRET = JWT_SECRET || 'crm-dev-secret-change-in-production-32chars';

async function authenticate(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Authentication required.' });
  try {
    const decoded = jwt.verify(token, EFFECTIVE_SECRET);
    const user    = await findOne('users', { id: decoded.id });
    if (!user || user.is_active === 0)
      return res.status(401).json({ message: 'Account suspended.' });
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

function authorize(permission) {
  return async (req, res, next) => {
    try {
      const perms = await getUserPermissions(req.user.id);
      if (!perms.has(permission))
        return res.status(403).json({ message: `Forbidden: need '${permission}'.` });
      next();
    } catch(e) {
      res.status(500).json({ message: 'Server error.' });
    }
  };
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options',  'nosniff');
  res.setHeader('X-Frame-Options',          'SAMEORIGIN');
  res.setHeader('X-XSS-Protection',         '1; mode=block');
  res.setHeader('Referrer-Policy',          'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',       'camera=(), microphone=(), geolocation=()');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https')
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  next();
}

module.exports = { authenticate, authorize, JWT_SECRET: EFFECTIVE_SECRET, securityHeaders };
