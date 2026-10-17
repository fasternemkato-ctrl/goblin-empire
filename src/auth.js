import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export class AuthError extends Error {}

/**
 * Проверка Telegram WebApp initData по официальному алгоритму:
 * secret = HMAC_SHA256(key="WebAppData", msg=bot_token)
 * hash   = HMAC_SHA256(key=secret, msg=data_check_string)
 */
export function validateInitData(initData, botToken, { maxAgeSec = 3600, now = Date.now() } = {}) {
  if (typeof initData !== 'string' || initData.length < 20 || initData.length > 4096) {
    throw new AuthError('bad_init_data');
  }
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) throw new AuthError('bad_hash');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new AuthError('bad_signature');
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) throw new AuthError('bad_auth_date');
  const ageSec = now / 1000 - authDate;
  if (ageSec > maxAgeSec || ageSec < -60) throw new AuthError('expired');

  let user;
  try { user = JSON.parse(params.get('user') || ''); } catch { throw new AuthError('bad_user'); }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || user.is_bot) throw new AuthError('bad_user');

  return {
    user: {
      id: user.id,
      username: typeof user.username === 'string' ? user.username.slice(0, 64) : null,
      firstName: String(user.first_name || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64),
    },
    startParam: params.get('start_param'),
  };
}

const JWT_TTL = '2h';

export const signToken = (userId, secret) =>
  jwt.sign({ sub: String(userId) }, secret, { algorithm: 'HS256', expiresIn: JWT_TTL });

export function verifyToken(token, secret) {
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }); // алгоритм зафиксирован
  const id = Number(payload.sub);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AuthError('bad_token');
  return id;
}
