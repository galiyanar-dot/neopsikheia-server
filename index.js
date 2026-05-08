const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY || 'neopsikheya-admin-2026';

const tokens = {};

app.get('/api/healthz', (req, res) => res.json({ status: 'ok' }));

app.post('/api/admin/generate-token', (req, res) => {
  const { adminKey, days = 30 } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + (days * 24 * 60 * 60 * 1000);
  tokens[token] = { createdAt: Date.now(), expiresAt, active: true, activatedBy: null, activatedAt: null };
  res.json({ token, expiresAt: new Date(expiresAt).toLocaleDateString('ru-RU'), link: `https://yadro-neopsikheia.netlify.app?token=${token}` });
});

app.post('/api/admin/list-tokens', (req, res) => {
  const { adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  const list = Object.entries(tokens).map(([token, d]) => ({
    token: token.substring(0, 8) + '...',
    expiresAt: new Date(d.expiresAt).toLocaleDateString('ru-RU'),
    active: d.active,
    expired: Date.now() > d.expiresAt,
    activated: !!d.activatedBy,
    activatedAt: d.activatedAt ? new Date(d.activatedAt).toLocaleDateString('ru-RU') : null
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
  const { token, deviceId } = req.body;
  if (!token || !tokens[token]) return res.json({ valid: false, reason: 'Токен не найден' });
  const t = tokens[token];
  if (!t.active) return res.json({ valid: false, reason: 'Токен отозван' });
  if (Date.now() > t.expiresAt) return res.json({ valid: false, reason: 'Срок действия токена истёк' });
  if (!t.activatedBy) {
    t.activatedBy = deviceId || 'unknown';
    t.activatedAt = Date.now();
    return res.json({ valid: true, expiresAt: new Date(t.expiresAt).toLocaleDateString('ru-RU') });
  }
  if (t.activatedBy === deviceId) return res.json({ valid: true, expiresAt: new Date(t.expiresAt).toLocaleDateString('ru-RU') });
  return res.json({ valid: false, reason: 'Этот токен уже используется на другом устройстве' });
});

app.post('/api/chat', async (req, res) => {
  const { messages, system, token, deviceId } = req.body;
  if (!token || !tokens[token]) return res.status(403).json({ error: 'Недействительный токен' });
  const t = tokens[token];
  if (!t.active || Date.now() > t.expiresAt) return res.status(403).json({ error: 'Токен истёк' });
  if (t.activatedBy && t.activatedBy !== deviceId) return res.status(403).json({ error: 'Токен используется на другом устройстве' });
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
