// ═══════════════════════════════════════════════════
//  Неопсихея Ядро — Railway Server
//  v2: three access tiers (free 24h / mid 15d / full 30d)
// ═══════════════════════════════════════════════════

const express   = require('express');
const cors      = require('cors');
const crypto    = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(cors());
app.use(express.json());

// ── CONFIG ──────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_KEY         = process.env.ADMIN_KEY || 'change-me';
const PORT              = process.env.PORT || 3000;

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ── TIER DEFINITIONS ────────────────────────────────
const TIERS = {
  free: { label: 'Пробный',  durationDays: 1,  price: 0    },
  mid:  { label: 'Базовый',  durationDays: 15, price: 3990 },
  full: { label: 'Полный',   durationDays: 30, price: 4990 },
};

// ── TOKEN STORE (in-memory) ──────────────────────────
// Для продакшена с >50 клиентами — переключись на Railway PostgreSQL
const tokens = new Map();

// ── HELPERS ──────────────────────────────────────────
function makeCode() {
  const h = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${h()}-${h()}-${h()}`;
}

function isExpired(entry) {
  return new Date() > new Date(entry.expiresAt);
}

// ── HEALTH ───────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'Неопсихея Ядро', version: '2.0' });
});

// ════════════════════════════════════════════════════
//  POST /validate-token
//  Body: { token, deviceId }
// ════════════════════════════════════════════════════
app.post('/validate-token', (req, res) => {
  const { token, deviceId } = req.body || {};
  if (!token || !deviceId) {
    return res.json({ valid: false, message: 'Отсутствует токен' });
  }

  const code  = token.trim().toUpperCase();
  const entry = tokens.get(code);

  if (!entry) {
    return res.json({ valid: false, message: 'Токен не найден' });
  }

  if (isExpired(entry)) {
    entry.status = 'expired';
    return res.json({ valid: false, message: 'Срок токена истёк' });
  }

  // Токен уже привязан к другому устройству
  if (entry.status === 'used' && entry.deviceId !== deviceId) {
    return res.json({ valid: false, message: 'Токен уже используется на другом устройстве' });
  }

  // Первый вход — привязываем устройство
  if (entry.status === 'active') {
    entry.status      = 'used';
    entry.deviceId    = deviceId;
    entry.firstUsedAt = new Date().toISOString();
  }

  res.json({ valid: true, tier: entry.tier });
});

// ════════════════════════════════════════════════════
//  POST /chat
//  Body: { token, deviceId, system, messages }
// ════════════════════════════════════════════════════
app.post('/chat', async (req, res) => {
  const { token, deviceId, system, messages } = req.body || {};

  const code  = (token || '').trim().toUpperCase();
  const entry = tokens.get(code);

  if (!entry) {
    return res.status(403).json({ error: 'Недействительный токен' });
  }
  if (isExpired(entry)) {
    return res.status(403).json({ error: 'Токен истёк' });
  }
  if (entry.status === 'used' && entry.deviceId !== deviceId) {
    return res.status(403).json({ error: 'Токен привязан к другому устройству' });
  }

  try {
    const response = await client.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system:     system || '',
      messages:   (messages || []).slice(-20),
    });

    const replyText = response.content[0]?.text || '';
    res.json({ reply: replyText, response: replyText, content: [{ text: replyText }] });
  } catch (err) {
    console.error('Anthropic error:', err.message);
    res.status(500).json({ error: 'Ошибка AI-сервиса' });
  }
});

// ════════════════════════════════════════════════════
//  ADMIN middleware
// ════════════════════════════════════════════════════
function requireAdmin(req, res, next) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  next();
}

// ════════════════════════════════════════════════════
//  GET /admin/tokens
// ════════════════════════════════════════════════════
app.get('/admin/tokens', requireAdmin, (req, res) => {
  const list = Array.from(tokens.values()).map(t => ({
    token:       t.token,
    label:       t.label,
    tier:        t.tier,
    price:       t.price,
    status:      isExpired(t) ? 'expired' : t.status,
    createdAt:   t.createdAt,
    expiresAt:   t.expiresAt,
    firstUsedAt: t.firstUsedAt,
  }));
  res.json({ tokens: list });
});

// ════════════════════════════════════════════════════
//  POST /admin/generate
//  Body: { label, tier, durationDays?, price? }
// ════════════════════════════════════════════════════
app.post('/admin/generate', requireAdmin, (req, res) => {
  const { label = '', tier = 'free', durationDays, price } = req.body || {};

  // Берём дефолты из TIERS, но позволяем переопределить
  const tierConfig  = TIERS[tier] || TIERS.free;
  const days        = durationDays ?? tierConfig.durationDays;
  const tokenPrice  = price        ?? tierConfig.price;

  const code      = makeCode();
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();

  tokens.set(code, {
    token:       code,
    label:       label || 'без имени',
    tier,
    price:       tokenPrice,
    status:      'active',
    deviceId:    null,
    createdAt:   new Date().toISOString(),
    expiresAt,
    firstUsedAt: null,
  });

  res.json({ token: code, tier, price: tokenPrice, expiresAt });
});

// ════════════════════════════════════════════════════
//  POST /admin/revoke
//  Body: { token }
// ════════════════════════════════════════════════════
app.post('/admin/revoke', requireAdmin, (req, res) => {
  const code = (req.body?.token || '').trim().toUpperCase();
  tokens.delete(code);
  res.json({ ok: true });
});


// ── /api/ алиасы для совместимости с клиентом ──
app.post('/api/validate-token', (req, res, next) => {
  req.url = '/validate-token';
  app.handle(req, res, next);
});

app.post('/api/chat', (req, res, next) => {
  req.url = '/chat';
  app.handle(req, res, next);
});

// ── START ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✦ Неопсихея Ядро · порт ${PORT}`);
  console.log(`  Тиры: Пробный 24ч · Базовый 15д · Полный 30д`);
});
