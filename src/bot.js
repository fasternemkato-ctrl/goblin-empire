import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from './config.js';

// Секрет вебхука выводится из JWT_SECRET — отдельная переменная не нужна.
const webhookSecret = crypto.createHash('sha256').update(`webhook:${config.jwtSecret}`).digest('hex');

const tgApi = async (method, payload) => {
  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`${method}: ${data.description || res.status}`);
  return data.result;
};

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function botRouter() {
  const r = Router();
  r.post('/webhook', (req, res) => {
    if (!safeEqual(req.get('x-telegram-bot-api-secret-token') || '', webhookSecret)) {
      return res.sendStatus(403);
    }
    res.sendStatus(200); // отвечаем сразу, дальше — в фоне
    const msg = req.body?.message;
    if (msg?.chat?.type === 'private' && /^\/start(@\w+)?(\s|$)/.test(msg.text || '')) {
      tgApi('sendMessage', {
        chat_id: msg.chat.id,
        text: '👺 Добро пожаловать в Goblin Empire!\nТапай, копи золото и строй империю гоблинов.',
        reply_markup: { inline_keyboard: [[{ text: '⚔️ Играть', web_app: { url: config.publicUrl } }]] },
      }).catch((e) => console.error('bot /start error:', e.message));
    }
  });
  return r;
}

/** Регистрирует вебхук в Telegram при старте (нужен публичный https-адрес). */
export async function registerWebhook() {
  if (!config.publicUrl?.startsWith('https://')) {
    console.warn('PUBLIC_URL не https — вебхук бота не зарегистрирован (игра в Mini App работает).');
    return;
  }
  try {
    await tgApi('setWebhook', {
      url: `${config.publicUrl}/bot/webhook`,
      secret_token: webhookSecret,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });
    console.log('Telegram webhook registered');
  } catch (e) {
    console.error('setWebhook failed:', e.message);
  }
}
