import { tx, query } from './db.js';
import { config } from './config.js';
import { LIMITS, UPGRADES, stats, statAt, upgradeCost, settle, acceptedTaps } from './game.js';

export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function lockUser(c, id) {
  const { rows } = await c.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw new HttpError(404, 'user_not_found');
  return rows[0];
}

async function saveUser(c, u) {
  await c.query(
    `UPDATE users SET coins=$2, total_earned=$3, energy=$4, energy_updated_at=$5,
       tap_level=$6, energy_level=$7, regen_level=$8, mine_level=$9,
       passive_updated_at=$10, last_tap_at=$11, last_seq=$12
     WHERE id=$1`,
    [u.id, u.coins, u.total_earned, u.energy, u.energy_updated_at,
      u.tap_level, u.energy_level, u.regen_level, u.mine_level,
      u.passive_updated_at, u.last_tap_at, u.last_seq],
  );
}

const ledger = (c, userId, kind, amount, meta = null) =>
  c.query('INSERT INTO ledger (user_id, kind, amount, meta) VALUES ($1,$2,$3,$4)', [userId, kind, amount, meta]);

function view(u, friends) {
  const s = stats(u);
  return {
    user: { id: u.id, name: u.first_name || u.username || 'Гоблин' },
    coins: u.coins,
    totalEarned: u.total_earned,
    energy: u.energy,
    maxEnergy: s.maxEnergy,
    regenPerSec: s.regenPerSec,
    tapPower: s.tapPower,
    minePerHour: s.minePerHour,
    upgrades: Object.entries(UPGRADES).map(([type, def]) => {
      const level = u[def.col];
      const maxed = level >= LIMITS.MAX_LEVEL;
      return {
        type, level, maxed,
        cost: maxed ? null : upgradeCost(type, level),
        now: statAt[type](level),
        next: maxed ? null : statAt[type](level + 1),
      };
    }),
    friends,
    refLink: `https://t.me/${config.botUsername}/${config.appShortName}?startapp=ref_${u.id}`,
    refBonus: { you: LIMITS.REFERRER_BONUS, friend: LIMITS.REFEREE_BONUS },
    wallet: { address: u.ton_wallet, verified: u.ton_wallet_verified },
  };
}

async function friendsCount(c, id) {
  const { rows } = await c.query('SELECT count(*)::int AS n FROM referrals WHERE referrer_id = $1', [id]);
  return rows[0].n;
}

/** Создаёт пользователя при первом входе (и применяет реферальный бонус) либо обновляет профиль. */
export async function loginUser(profile, startParam) {
  await tx(async (c) => {
    const ins = await c.query(
      `INSERT INTO users (id, username, first_name, energy) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [profile.id, profile.username, profile.firstName, statAt.energy(0)],
    );
    if (ins.rowCount === 0) {
      await c.query('UPDATE users SET username=$2, first_name=$3 WHERE id=$1', [profile.id, profile.username, profile.firstName]);
      return;
    }
    const m = /^ref_(\d{1,15})$/.exec(startParam || '');
    const referrerId = m ? Number(m[1]) : null;
    if (!referrerId || referrerId === profile.id) return;

    const ref = await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [referrerId]);
    if (!ref.rowCount) return;
    const cnt = await friendsCount(c, referrerId);
    if (cnt >= LIMITS.MAX_REWARDED_REFERRALS) return;

    await c.query('INSERT INTO referrals (referee_id, referrer_id) VALUES ($1,$2)', [profile.id, referrerId]);
    const give = (id, amount) => c.query(
      'UPDATE users SET coins = coins + $2, total_earned = total_earned + $2 WHERE id = $1', [id, amount]);
    await give(referrerId, LIMITS.REFERRER_BONUS);
    await give(profile.id, LIMITS.REFEREE_BONUS);
    await ledger(c, referrerId, 'referral_bonus', LIMITS.REFERRER_BONUS, { referee: profile.id });
    await ledger(c, profile.id, 'welcome_bonus', LIMITS.REFEREE_BONUS, { referrer: referrerId });
  });
}

export async function getState(id) {
  return tx(async (c) => {
    const u = await lockUser(c, id);
    settle(u, Date.now());
    await saveUser(c, u);
    return view(u, await friendsCount(c, id));
  });
}

export async function tap(id, count, seq) {
  return tx(async (c) => {
    const u = await lockUser(c, id);
    const now = Date.now();
    settle(u, now);
    if (seq <= u.last_seq) throw new HttpError(409, 'stale_seq');

    const n = acceptedTaps({
      count,
      energy: u.energy,
      elapsedSec: (now - u.last_tap_at.getTime()) / 1000,
    });
    const gain = n * stats(u).tapPower;
    u.energy -= n;
    u.coins += gain;
    u.total_earned += gain;
    u.last_tap_at = new Date(now);
    u.last_seq = seq;
    await saveUser(c, u);
    return { ...view(u, await friendsCount(c, id)), accepted: n };
  });
}

export async function upgrade(id, type) {
  const def = UPGRADES[type]; // type уже провалидирован zod-enum; колонка берётся только из белого списка
  if (!def) throw new HttpError(400, 'bad_upgrade');
  return tx(async (c) => {
    const u = await lockUser(c, id);
    settle(u, Date.now());
    const level = u[def.col];
    if (level >= LIMITS.MAX_LEVEL) throw new HttpError(400, 'max_level');
    const cost = upgradeCost(type, level);
    if (u.coins < cost) throw new HttpError(400, 'not_enough_coins');
    u.coins -= cost;
    u[def.col] = level + 1;
    await saveUser(c, u);
    await ledger(c, id, 'upgrade', -cost, { type, level: level + 1 });
    return view(u, await friendsCount(c, id));
  });
}

let lbCache = { at: 0, rows: [] };

export async function leaderboard(id) {
  if (Date.now() - lbCache.at > 15_000) {
    const { rows } = await query(
      'SELECT id, first_name, username, total_earned FROM users ORDER BY total_earned DESC, id ASC LIMIT 20');
    lbCache = { at: Date.now(), rows };
  }
  const me = await query(
    `SELECT total_earned, (SELECT count(*) + 1 FROM users x WHERE x.total_earned > u.total_earned)::int AS rank
     FROM users u WHERE id = $1`, [id]);
  return {
    top: lbCache.rows.map((r, i) => ({
      rank: i + 1,
      name: r.first_name || r.username || 'Гоблин',
      score: r.total_earned,
      isMe: r.id === id,
    })),
    me: me.rows[0] ? { rank: me.rows[0].rank, score: me.rows[0].total_earned } : null,
  };
}
