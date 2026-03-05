// ============================================================
// UTOPIA — Backend Server
// ============================================================
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json({ limit: '10kb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/users',       require('./routes/users'));
app.use('/api/communities', require('./routes/communities'));
app.use('/api/raids',       require('./routes/raids'));
app.use('/api/quests',      require('./routes/quests'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/rewards',     require('./routes/rewards'));
app.use('/api/bot',         require('./routes/bot'));

// ── Health Check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Error Handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`🚀 UTOPIA Backend running on port ${PORT}`);

  // Setup Telegram webhook automaticamente all'avvio
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const { setupWebhook } = require('./services/telegramBot');
    const backendUrl =
      process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : process.env.BACKEND_URL || `http://localhost:${PORT}`;
    await setupWebhook(backendUrl);
  }
});

module.exports = app;
