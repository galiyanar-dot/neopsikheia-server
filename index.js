const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
 
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
 
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY || 'neopsikheya-admin-2026';
 
const tokens = {};
 
app.get('/api/healthz', (req, res) => {
  res.json({ status: 'ok' });
});
 
app.post('/api/admin/generate-token', (req, res) => {
  const { adminKey, days = 30 } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + (days * 24 * 60 * 60 * 1000);
  tokens[token] = { createdAt: Date.now(), expiresAt, active: true };
  res.json({ token, expiresAt: new Date(expiresAt).toLocaleDateString('ru-RU'), link: `https://yadro-neopsikheia.netlify.app?token=${token}` });
});
 
app.post('/api/admin/list-tokens', (req, res) => {
  const { adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  const list = Object.entries(tokens).map(([token, data]) => ({
    token: token.substring(0, 8) + '...', expiresAt: new Date(data.expiresAt).toLocaleDateString('ru-RU'), active: data.active, expired: Date.now() > data.expiresAt
  }));
  res.json({ tokens: list });
});
 
app.post('/api/admin/revoke-token', (req, res) => {
  const { adminKey, token } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  if (tokens[token]) { tokens[token].active = false; res.json({ success: true }); }
  else res.status(404).json({ error: 'Token not found' });
});
 
app.post('/api/validate-token', (req, res) => {
  const { token } = req.body;
  if (!token || !tokens[token]) return res.json({ valid: false, reason: 'Токен не найден' });
  const t = tokens[token];
  if (!t.active) return res.json({ valid: false, reason: 'Токен отозван' });
  if (Date.now() > t.expiresAt) return res.json({ valid: false, reason: 'Срок действия истёк' });
  res.json({ valid: true, expiresAt: new Date(t.expiresAt).toLocaleDateString('ru-RU') });
});
 
app.post('/api/chat', async (req, res) => {
  const { messages, system, token } = req.body;
  if (!token || !tokens[token]) return res.status(403).json({ error: 'Недействительный токен' });
  const t = tokens[token];
  if (!t.active || Date.now() > t.expiresAt) return res.status(403).json({ error: 'Токен истёк' });
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1000, system, messages })
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
 
