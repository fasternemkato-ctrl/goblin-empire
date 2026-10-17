import test from 'node:test';
import assert from 'node:assert/strict';
import { settle, acceptedTaps, upgradeCost, stats, LIMITS } from '../src/game.js';

const mkUser = (over = {}) => {
  const t = new Date(1_000_000);
  return {
    coins: 0, total_earned: 0, energy: 0,
    energy_updated_at: t, passive_updated_at: t,
    tap_level: 0, energy_level: 0, regen_level: 0, mine_level: 0,
    ...over,
  };
};

test('энергия восстанавливается и не превышает максимум', () => {
  const u = mkUser({ energy: 0 });
  settle(u, 1_000_000 + 10_000); // 10 с * 1/с
  assert.equal(u.energy, 10);
  settle(u, 1_000_000 + 10_000_000);
  assert.equal(u.energy, stats(u).maxEnergy);
});

test('пассивный доход ограничен 3 часами', () => {
  const u = mkUser({ mine_level: 1 }); // 100/ч
  const gain = settle(u, 1_000_000 + 10 * 3600 * 1000);
  assert.equal(gain, 300);
  assert.equal(u.coins, 300);
});

test('частые вызовы не «съедают» дробный пассивный доход', () => {
  const u = mkUser({ mine_level: 1 });
  let t = 1_000_000;
  for (let i = 0; i < 3600; i++) { t += 1000; settle(u, t); }
  assert.equal(u.coins, 100);
});

test('лимиты тапов: частота, энергия, размер пачки', () => {
  assert.equal(acceptedTaps({ count: 100, energy: 1000, elapsedSec: 1 }), 25);
  assert.equal(acceptedTaps({ count: 100, energy: 3, elapsedSec: 5 }), 3);
  assert.equal(acceptedTaps({ count: 500, energy: 1e6, elapsedSec: 999 }), LIMITS.TAP_BATCH_MAX);
  assert.equal(acceptedTaps({ count: 10, energy: 100, elapsedSec: -5 }), LIMITS.TAP_SLACK);
});

test('стоимость улучшений растёт и не выходит за безопасные пределы', () => {
  assert.equal(upgradeCost('tap', 0), 100);
  assert.ok(upgradeCost('tap', 5) > upgradeCost('tap', 4));
  for (const t of ['tap', 'energy', 'regen', 'mine']) {
    assert.ok(Number.isSafeInteger(upgradeCost(t, LIMITS.MAX_LEVEL)));
  }
});
