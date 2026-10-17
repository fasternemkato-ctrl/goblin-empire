import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from './config.js';
import { validateInitData, signToken, verifyToken, AuthError } from './auth.js';
import * as svc from './service.js';

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const limiter = (windowMs, max, byUser = false) => rateLimit({
  windowMs, max,
  standardHeaders: true,
  legacyHeaders: false,
  ...(byUser ? { keyGenerator: (req) => `u:${req.userId}` } : {}),
  message: { error: 'too_many_requests' },
});

function requireAuth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  if (!m) return res.status(401).json({ error: 'unauthorized' });
  try {
    req.userId = verifyToken(m[1], config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}

const authBody = z.object({ initData: z.string().min(20).max(4096) });
const tapBody = z.object({
  count: z.number().int().min(1).max(100),
  seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const upgradeBody = z.object({ type: z.enum(['tap', 'energy', 'regen', 'mine']) });

export function apiRouter() {
  const r = Router();

  r.post('/auth', limiter(60_000, 30), ah(async (req, res) => {
    const { initData } = authBody.parse(req.body);
    let parsed;
    try {
      parsed = validateInitData(initData, config.botToken);
    } catch (e) {
      if (e instanceof AuthError) return res.status(401).json({ error: 'unauthorized' });
      throw e;
    }
    await svc.loginUser(parsed.user, parsed.startParam);
    res.json({ token: signToken(parsed.user.id, config.jwtSecret) });
  }));

  r.use(requireAuth);

  r.get('/state', limiter(60_000, 60, true), ah(async (req, res) => {
    res.json(await svc.getState(req.userId));
  }));

  // клиент шлёт пачку раз в ~1 с; лимит с запасом
  r.post('/tap', limiter(10_000, 30, true), ah(async (req, res) => {
    const { count, seq } = tapBody.parse(req.body);
    res.json(await svc.tap(req.userId, count, seq));
  }));

  r.post('/upgrade', limiter(10_000, 10, true), ah(async (req, res) => {
    const { type } = upgradeBody.parse(req.body);
    res.json(await svc.upgrade(req.userId, type));
  }));

  r.get('/leaderboard', limiter(60_000, 20, true), ah(async (req, res) => {
    res.json(await svc.leaderboard(req.userId));
  }));

  return r;
}
