import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { validateInitData, signToken, verifyToken } from '../src/auth.js';

const TOKEN = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678';

function sign(fields, botToken = TOKEN) {
  const params = new URLSearchParams(fields);
  const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

const now = Date.now();
const base = () => ({
  auth_date: String(Math.floor(now / 1000) - 10),
  query_id: 'AAH',
  start_param: 'ref_42',
  user: JSON.stringify({ id: 777, first_name: 'Грок', username: 'grok' }),
});

test('валидный initData проходит', () => {
  const r = validateInitData(sign(base()), TOKEN, { now });
  assert.equal(r.user.id, 777);
  assert.equal(r.user.firstName, 'Грок');
  assert.equal(r.startParam, 'ref_42');
});

test('подмена данных ломает подпись', () => {
  const s = sign(base()).replace('777', '778');
  assert.throws(() => validateInitData(s, TOKEN, { now }), /bad_signature|bad_user/);
});

test('подпись чужим токеном отклоняется', () => {
  const s = sign(base(), '999999:ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ');
  assert.throws(() => validateInitData(s, TOKEN, { now }), /bad_signature/);
});

test('просроченный initData отклоняется', () => {
  const f = { ...base(), auth_date: String(Math.floor(now / 1000) - 7200) };
  assert.throws(() => validateInitData(sign(f), TOKEN, { now }), /expired/);
});

test('JWT: подпись и алгоритм', () => {
  const secret = 'x'.repeat(40);
  assert.equal(verifyToken(signToken(5, secret), secret), 5);
  assert.throws(() => verifyToken(signToken(5, secret), 'y'.repeat(40)));
});
