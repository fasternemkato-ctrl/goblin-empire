// Чистая игровая логика без доступа к БД — легко тестируется.

export const LIMITS = {
  MAX_LEVEL: 30,
  MAX_TPS: 20,            // максимум тапов в секунду, который сервер примет в среднем
  TAP_BATCH_MAX: 100,     // максимум тапов в одном запросе
  TAP_SLACK: 5,           // допуск на сетевой джиттер
  TAP_ELAPSED_CAP_SEC: 5, // «накопить» разрешение на тапы можно максимум за 5 секунд
  OFFLINE_CAP_SEC: 3 * 3600, // пассивный доход копится максимум 3 часа
  REFERRER_BONUS: 5000,
  REFEREE_BONUS: 2500,
  MAX_REWARDED_REFERRALS: 200,
};

export const UPGRADES = {
  tap:    { col: 'tap_level',    baseCost: 100, growth: 1.7  },
  energy: { col: 'energy_level', baseCost: 150, growth: 1.6  },
  regen:  { col: 'regen_level',  baseCost: 200, growth: 1.8  },
  mine:   { col: 'mine_level',   baseCost: 500, growth: 1.65 },
};

/** Значение характеристики на заданном уровне улучшения. */
export const statAt = {
  tap:    (lvl) => 1 + lvl,        // монет за тап
  energy: (lvl) => 500 + 100 * lvl, // максимум энергии
  regen:  (lvl) => 1 + 0.5 * lvl,   // энергии в секунду
  mine:   (lvl) => 100 * lvl,       // монет в час
};

export const stats = (u) => ({
  tapPower: statAt.tap(u.tap_level),
  maxEnergy: statAt.energy(u.energy_level),
  regenPerSec: statAt.regen(u.regen_level),
  minePerHour: statAt.mine(u.mine_level),
});

export const upgradeCost = (type, level) =>
  Math.floor(UPGRADES[type].baseCost * UPGRADES[type].growth ** level);

/**
 * Досчитывает «ленивые» величины (регенерация энергии, пассивный доход) до момента nowMs.
 * Мутирует объект u (строка users). Возвращает число монет пассивного дохода.
 */
export function settle(u, nowMs) {
  const s = stats(u);

  const dtE = Math.max(0, (nowMs - u.energy_updated_at.getTime()) / 1000);
  u.energy = Math.min(s.maxEnergy, u.energy + dtE * s.regenPerSec);
  u.energy_updated_at = new Date(nowMs);

  let gain = 0;
  if (s.minePerHour === 0) {
    u.passive_updated_at = new Date(nowMs);
  } else {
    const dtP = Math.min(Math.max(0, (nowMs - u.passive_updated_at.getTime()) / 1000), LIMITS.OFFLINE_CAP_SEC);
    gain = Math.floor((dtP * s.minePerHour) / 3600);
    if (gain > 0) {
      u.coins += gain;
      u.total_earned += gain;
      u.passive_updated_at = new Date(nowMs); // двигаем метку только если что-то начислили (не теряем дроби)
    }
  }
  return gain;
}

/** Сколько тапов сервер реально засчитает из пачки. */
export function acceptedTaps({ count, energy, elapsedSec }) {
  const elapsed = Math.min(Math.max(elapsedSec, 0), LIMITS.TAP_ELAPSED_CAP_SEC);
  const byRate = Math.floor(elapsed * LIMITS.MAX_TPS) + LIMITS.TAP_SLACK;
  return Math.max(0, Math.min(count, LIMITS.TAP_BATCH_MAX, byRate, Math.floor(energy)));
}
