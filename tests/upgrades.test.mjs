import test from 'node:test';
import assert from 'node:assert/strict';
import {UPGRADES, UPGRADE_DEFINITIONS, HARD_ENEMY_SHARE, canAcquireUpgrade, eligibleUpgrades, upgradeWeight, rollUpgrades} from '../dist/upgrades.js';

const capped = () => Object.fromEntries(UPGRADE_DEFINITIONS.map(entry => [entry.id, entry.maxStacks]));
const ids = entries => entries.map(entry => entry.id);
function sequence(...values) {
  let index = 0;
  return () => { assert.ok(index < values.length, 'unexpected random draw'); return values[index++]; };
}
function seeded(seed = 640) {
  let state = seed;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}
function assertLegal(choices, counts, size) {
  assert.equal(choices.length, Math.min(size, eligibleUpgrades({counts}).length));
  assert.equal(new Set(ids(choices)).size, choices.length);
  for (const entry of choices) {
    assert.ok(canAcquireUpgrade(entry, counts), `${entry.id} is not eligible`);
    assert.equal(entry.rings, {regular: 0, special: 1, risk: 2}[entry.kind]);
  }
}

test('the eighteen definitions have six regular, nine special and three risk upgrades with fixed rings and acquired-layer caps', () => {
  assert.equal(UPGRADE_DEFINITIONS.length, 18);
  assert.equal(new Set(ids(UPGRADE_DEFINITIONS)).size, 18);
  assert.deepEqual(Object.fromEntries(UPGRADE_DEFINITIONS.map(entry => [entry.id, entry.maxStacks])), {
    energy: 4, overspeed: 2, density: 5, rubber: 4, growth: 2, magnet: 2,
    pierce: 1, pulse: 1, bank: 1, gravity: 1, breath: 1, split: 1, penetration: 1, boomerang: 1, shockwave: 1,
    risk: 2, gambler: 2, frenzy: 1,
  });
  for (const [kind, count, rings] of [['regular', 6, 0], ['special', 9, 1], ['risk', 3, 2]]) {
    const entries = UPGRADE_DEFINITIONS.filter(entry => entry.kind === kind);
    assert.equal(entries.length, count);
    for (const entry of entries) {
      assert.equal(entry.pool, kind); assert.equal(entry.rings, rings);
      if (kind === 'special') assert.equal([...entry.name].length, 4, `${entry.id} needs a four-character name`);
      assert.equal(entry.maxOffers, undefined); assert.equal(entry.color, undefined); assert.equal(entry.rarity, undefined);
    }
  }
});

test('core tuning is fixed across stages and all documented effect constants are available to physics', () => {
  assert.deepEqual(UPGRADES.energy.effect, {energyMultiplier: 1.3});
  assert.deepEqual(UPGRADES.overspeed.effect, {speedCapBonus: 8});
  assert.deepEqual(UPGRADES.density.effect, {densityMultiplier: 1.35});
  assert.deepEqual(UPGRADES.rubber.effect, {retentionBonus: .06});
  assert.deepEqual(UPGRADES.growth.effect.radiusScales, [1.2, 1.4]);
  assert.deepEqual(UPGRADES.magnet.effect, {pullDuration: .4, pullDistance: 1.5});
  assert.deepEqual(UPGRADES.pierce.effect, {retention: .92});
  assert.deepEqual(UPGRADES.pulse.effect, {radius: 4, damageRatio: .3});
  assert.deepEqual(UPGRADES.bank.effect, {damageBonus: .6, maxCharges: 2});
  assert.deepEqual(UPGRADES.gravity.effect, {radius: 5, acceleration: 2.4});
  assert.deepEqual(UPGRADES.breath.effect, {duration: 1.5, intervalMultiplier: 1.5});
  assert.deepEqual(UPGRADES.split.effect, {count: 2, radius: .7, speedRatio: .6, damageRatio: .6});
  assert.deepEqual(UPGRADES.penetration.effect, {firstKillRetention: 1});
  assert.deepEqual(UPGRADES.boomerang.effect, {duration: .5, speedMultiplier: 1.2});
  assert.deepEqual(UPGRADES.shockwave.effect, {everyWalls: 3, radius: 3, fullPullDamageRatio: .5});
  assert.deepEqual(UPGRADES.risk.effect, {spawnRateMultiplier: 1.2, scoreMultiplier: 1.5});
  assert.deepEqual(UPGRADES.gambler.effect, {nextTargetMultiplier: 1.5, nextChoiceCount: 5});
  assert.deepEqual(UPGRADES.frenzy.effect, {waveSizeBonus: 2, restMultiplier: .7, comboCap: 12});
});

test('eligibility uses acquired layers and unlocks overspeed only after the fourth energy layer', () => {
  for (const entry of UPGRADE_DEFINITIONS) {
    const counts = {energy: 4, [entry.id]: entry.maxStacks - 1};
    assert.ok(canAcquireUpgrade(entry.id, counts));
    counts[entry.id]++;
    assert.equal(canAcquireUpgrade(entry, counts), false);
    assert.ok(!ids(eligibleUpgrades({counts})).includes(entry.id));
  }
  for (const energy of [0, 1, 2, 3]) assert.equal(canAcquireUpgrade('overspeed', {energy}), false);
  assert.ok(canAcquireUpgrade('overspeed', {energy: 4}));
  assert.equal(canAcquireUpgrade('overspeed', {energy: 4, overspeed: 2}), false);
  for (const unknown of ['missing', 'toString', '__proto__']) assert.equal(canAcquireUpgrade(unknown, {}), false);
  assert.equal(canAcquireUpgrade({id: 'energy', maxStacks: 999}, {energy: 4}), false);
  assert.equal(canAcquireUpgrade('energy', {energy: Infinity}), false);
  assert.ok(eligibleUpgrades({pool: 'special'}).every(entry => entry.kind === 'special'));
  assert.ok(!ids(eligibleUpgrades({exclude: new Set(['growth', 'pulse'])})).some(id => ['growth', 'pulse'].includes(id)));
});

test('three and five choices preserve slot categories, use distinct IDs, and always respect caps', () => {
  const risk = rollUpgrades({random: sequence(0, 0, .59, 0), count: 3});
  assert.deepEqual(risk.map(entry => entry.kind), ['regular', 'special', 'risk']);
  const regular = rollUpgrades({random: sequence(0, 0, .6, 0), count: 3});
  assert.deepEqual(regular.map(entry => entry.kind), ['regular', 'special', 'regular']);
  assert.notEqual(regular[0].id, regular[2].id);
  const five = rollUpgrades({random: sequence(0, 0, 0, 0, 0, 0), count: 5});
  assert.deepEqual(five.map(entry => entry.kind), ['regular', 'special', 'risk', 'regular', 'special']);
  assertLegal(five, {}, 5);
  const random = seeded();
  for (let i = 0; i < 3000; i++) {
    const counts = Object.fromEntries(UPGRADE_DEFINITIONS.map(entry => [entry.id, Math.floor(random() * (entry.maxStacks + 1))]));
    for (const count of [3, 5]) assertLegal(rollUpgrades({counts, count, random}), counts, count);
  }
});

test('the third slot chooses risk exactly sixty percent before contextual item weighting', () => {
  let risk = 0;
  for (let i = 0; i < 10000; i++) {
    const choices = rollUpgrades({random: sequence(.4, .3, (i + .5) / 10000, .7)});
    risk += Number(choices[2].kind === 'risk');
  }
  assert.equal(risk, 6000);
});

test('context weighting has exact thresholds, requires a completed shot sample and compounds independent conditions', () => {
  assert.equal(HARD_ENEMY_SHARE, .3);
  for (const id of ['rubber', 'penetration', 'bank']) {
    assert.equal(upgradeWeight(id, {hardEnemyShare: .299999}), 1);
    assert.equal(upgradeWeight(id, {hardEnemyShare: .3}), 2);
  }
  for (const id of ['energy', 'density', 'split']) assert.equal(upgradeWeight(id, {nextBoss: true}), 2);
  for (const id of ['split', 'pulse', 'gravity']) {
    assert.equal(upgradeWeight(id, {completedShots: 0, averageKillsPerShot: 0}), 1);
    assert.equal(upgradeWeight(id, {completedShots: 1, averageKillsPerShot: 1.2}), 1);
    assert.equal(upgradeWeight(id, {completedShots: 1, averageKillsPerShot: NaN}), 1);
    assert.equal(upgradeWeight(id, {completedShots: 1, averageKillsPerShot: 1.1999}), 2);
  }
  assert.equal(upgradeWeight('split', {nextBoss: true, completedShots: 3, averageKillsPerShot: 1}), 4);
  assert.equal(upgradeWeight('frenzy', {hardEnemyShare: 1, nextBoss: true, completedShots: 3, averageKillsPerShot: 0}), 1);
  assert.equal(upgradeWeight('toString'), 0);
});

test('real weighted first-slot frequencies match the snapshot and exclude maxed items', () => {
  for (const [context, units, samples] of [
    [{}, {energy: 1, density: 1, rubber: 1, growth: 1, magnet: 1}, 5000],
    [{hardEnemyShare: .3}, {energy: 1, density: 1, rubber: 2, growth: 1, magnet: 1}, 6000],
    [{nextBoss: true}, {energy: 2, density: 2, rubber: 1, growth: 1, magnet: 1}, 7000],
  ]) {
    const counts = Object.fromEntries(Object.keys(units).map(id => [id, 0]));
    for (let i = 0; i < samples; i++) {
      const choices = rollUpgrades({context, count: 1, random: sequence((i + .5) / samples)});
      counts[choices[0].id]++;
    }
    assert.deepEqual(counts, Object.fromEntries(Object.entries(units).map(([id, weight]) => [id, weight * 1000])));
  }
  const observed = {overspeed: 0, density: 0, rubber: 0, growth: 0, magnet: 0};
  for (let i = 0; i < 5000; i++) observed[rollUpgrades({counts: {energy: 4}, count: 1, random: sequence((i + .5) / 5000)})[0].id]++;
  assert.deepEqual(observed, {overspeed: 1000, density: 1000, rubber: 1000, growth: 1000, magnet: 1000});
});

test('real special-slot frequencies reflect both boss and low-efficiency weighting', () => {
  const context = {nextBoss: true, completedShots: 4, averageKillsPerShot: 1};
  const expected = {pierce: 1000, pulse: 2000, bank: 1000, gravity: 2000, breath: 1000, split: 4000, penetration: 1000, boomerang: 1000, shockwave: 1000};
  const observed = Object.fromEntries(Object.keys(expected).map(id => [id, 0]));
  for (let i = 0; i < 14000; i++) {
    const choices = rollUpgrades({context, count: 2, random: sequence(0, (i + .5) / 14000)});
    observed[choices[1].id]++;
  }
  assert.deepEqual(observed, expected);
});

test('special exhaustion replaces its slot with a distinct regular layer', () => {
  const counts = Object.fromEntries(UPGRADE_DEFINITIONS.filter(entry => entry.kind === 'special').map(entry => [entry.id, 1]));
  const choices = rollUpgrades({counts, random: () => 0});
  assert.deepEqual(choices.map(entry => entry.kind), ['regular', 'regular', 'risk']);
  assertLegal(choices, counts, 3);
});

test('regular exhaustion still fills legal unique choices from the remaining pools', () => {
  const counts = Object.fromEntries(UPGRADE_DEFINITIONS.filter(entry => entry.kind === 'regular').map(entry => [entry.id, entry.maxStacks]));
  const choices = rollUpgrades({counts, random: () => .99, count: 5});
  assert.equal(choices.length, 5); assert.ok(choices.every(entry => entry.kind === 'special'));
  assertLegal(choices, counts, 5);
  for (const entry of UPGRADE_DEFINITIONS.filter(entry => entry.kind === 'special')) counts[entry.id] = 1;
  const risks = rollUpgrades({counts, random: () => .99, count: 5});
  assert.deepEqual(new Set(ids(risks)), new Set(['risk', 'gambler', 'frenzy']));
  assertLegal(risks, counts, 5);
});

test('near exhaustion returns only one or two genuine choices, and a locked upgrade is not borrowed early', () => {
  const one = capped(); one.growth--;
  assert.deepEqual(ids(rollUpgrades({counts: one, count: 5, random: () => 0})), ['growth']);
  const two = {...one, bank: 0};
  assert.deepEqual(ids(rollUpgrades({counts: two, count: 5, random: () => 0})), ['growth', 'bank']);
  const unlock = {...capped(), energy: 3, overspeed: 0};
  assert.deepEqual(ids(rollUpgrades({counts: unlock, count: 5, random: () => 0})), ['energy']);
  unlock.energy++;
  assert.deepEqual(ids(rollUpgrades({counts: unlock, count: 5, random: () => 0})), ['overspeed']);
});

test('complete exhaustion returns an empty offer without randomness or a synthetic nineteenth upgrade', () => {
  const fail = () => { throw new Error('an exhausted pool must not sample'); };
  assert.deepEqual(rollUpgrades({counts: capped(), random: fail}), []);
  assert.deepEqual(rollUpgrades({counts: capped(), count: 5, random: fail}), []);
  assert.deepEqual(rollUpgrades({count: 0, random: fail}), []);
});

test('repeated offers do not consume layers and a full acquisition run terminates after exactly thirty-three grants', () => {
  const counts = {}, random = seeded(641);
  for (let i = 0; i < 200; i++) assertLegal(rollUpgrades({counts, random}), counts, 3);
  assert.deepEqual(counts, {});
  let granted = 0;
  while (eligibleUpgrades({counts}).length) {
    const choices = rollUpgrades({counts, random, count: granted % 2 ? 5 : 3});
    assert.ok(choices.length); assertLegal(choices, counts, granted % 2 ? 5 : 3);
    const choice = choices[Math.floor(random() * choices.length)];
    counts[choice.id] = (counts[choice.id] || 0) + 1;
    assert.ok(counts[choice.id] <= choice.maxStacks); granted++;
    assert.ok(granted <= 33, 'the pool never exhausts');
  }
  assert.equal(granted, 33); assert.deepEqual(counts, capped());
  assert.deepEqual(rollUpgrades({counts, random}), []);
});

test('injected randomness replays the offer without mutating snapshots, acquired counts or definitions', () => {
  const counts = Object.freeze({energy: 4, density: 2, growth: 1, split: 1});
  const context = Object.freeze({hardEnemyShare: .4, nextBoss: true, completedShots: 4, averageKillsPerShot: .75});
  const a = seeded(642), b = seeded(642), originalRandom = Math.random;
  Math.random = () => { throw new Error('un-injected randomness'); };
  try {
    for (let i = 0; i < 100; i++) assert.deepEqual(rollUpgrades({counts, context, random: a, count: 5}), rollUpgrades({counts, context, random: b, count: 5}));
  } finally { Math.random = originalRandom; }
  const choice = rollUpgrades({random: () => 0})[0]; choice.name = 'changed';
  assert.equal(UPGRADES.energy.name, '弹性十足');
  assert.ok(Object.isFrozen(UPGRADES)); assert.ok(Object.isFrozen(UPGRADE_DEFINITIONS));
  for (const entry of UPGRADE_DEFINITIONS) {
    assert.ok(Object.isFrozen(entry)); assert.ok(Object.isFrozen(entry.effect)); assert.ok(Object.isFrozen(entry.requires));
  }
});
