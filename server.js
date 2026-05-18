const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false') === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

app.post('/api/send-email', async (req, res) => {
  const { recipients, subject, body } = req.body;
  if (!Array.isArray(recipients) || !recipients.length || !subject || !body) return res.status(400).json({ message: 'Invalid payload.' });
  try {
    await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: recipients.join(','), subject, text: body });
    res.json({ message: `Email sent to ${recipients.length} recipient(s).` });
  } catch (error) {
    res.status(500).json({ message: `SMTP send failed: ${error.message}` });
  }
});

app.listen(3001, () => console.log('SMTP API running on http://localhost:3001'));
