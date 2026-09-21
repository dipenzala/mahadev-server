// Mahadev backend - Vercel serverless entry (STUB)
// Tera asli server file nahi mila. Ye basic skeleton hai.
// Apne routes yahan add kar ya ../server.js import kar.

const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/api/admin-auth/login-master', (req, res) => {
  const { password } = req.body;
  const MASTER_PASSWORD = process.env.MASTER_PASSWORD || 'change-me';
  if (password === MASTER_PASSWORD) {
    return res.json({ success: true, token: 'master-token' });
  }
  return res.status(401).json({ success: false, error: 'Wrong password' });
});

module.exports = app;
