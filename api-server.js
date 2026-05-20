'use strict';
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { init } = require('./server/db');
const { securityHeaders } = require('./server/middleware');

const PORT           = process.env.PORT || 3002;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:8000';
const app            = express();

app.set('trust proxy', 1); // Trust Nginx proxy for req.ip

app.use(securityHeaders);
app.use(cors({
  origin: (origin, cb) => (!origin || origin === ALLOWED_ORIGIN) ? cb(null, true) : cb(new Error('CORS blocked')),
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Authorization','Content-Type'],
}));
app.use(express.json({ limit: '512kb', strict: true }));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/auth',  require('./server/auth'));
app.use('/users', require('./server/users'));
app.use('/',      require('./server/resources'));

app.use((req, res)          => res.status(404).json({ message: 'Not found.' }));
app.use((err, req, res, next) => {
  if (err.status >= 500 || !err.status) console.error('[API ERROR]', err.message);
  res.status(err.status || 500).json({ message: err.status < 500 ? err.message : 'Internal server error.' });
});

process.on('uncaughtException',  e => console.error('[UNCAUGHT]',  e));
process.on('unhandledRejection', e => console.error('[UNHANDLED]', e));

// Connect DB then start server
init().then(() => {
  app.listen(PORT, '127.0.0.1', () => console.log(`[API] Listening on 127.0.0.1:${PORT}`));
}).catch(err => { console.error('[FATAL] DB init failed:', err.message); process.exit(1); });
