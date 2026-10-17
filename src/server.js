import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { apiRouter } from './routes.js';
import { botRouter, registerWebhook } from './bot.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const app = express();
app.set('trust proxy', 1); // за прокси хостинга (Render и т.п.)
app.disable('x-powered-by');

app.use(helmet({
  frameguard: false, // вместо X-Frame-Options используем CSP frame-ancestors (нужно для Telegram Web)
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://telegram.org'],
      // 'unsafe-inline' только для стилей: скрипт Telegram может добавлять инлайновые стили. Для скриптов он запрещён.
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'self'", 'https://web.telegram.org', 'https://webk.telegram.org', 'https://webz.telegram.org'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
}));

app.use(express.json({ limit: '10kb' }));

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.use('/bot', botRouter());
app.use('/api', rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }), apiRouter());
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

app.use(express.static(publicDir, {
  maxAge: '1h',
  setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); },
}));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof ZodError || err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    return res.status(400).json({ error: 'invalid_request' });
  }
  if (err?.status && err?.code) return res.status(err.status).json({ error: err.code });
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'server_error' });
});

await migrate();
const server = app.listen(config.port, () => {
  console.log(`Goblin Empire listening on :${config.port}`);
  registerWebhook();
});

const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
