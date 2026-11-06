import test from 'node:test';
import assert from 'node:assert/strict';
import {UPGRADES, UPGRADE_DEFINITIONS, HARD_ENEMY_SHARE, canAcquireUpgrade, eligibleUpgrades, upgradeWeight, upgradeStat, upgradeOffer, rollUpgrades} from '../dist/upgrades.js';

const fullyBuilt = () => Object.fromEntries(UPGRADE_DEFINITIONS.map(entry => [entry.id, Number.isFinite(entry.maxStacks) ? entry.maxStacks : 20]));
const allIds = UPGRADE_DEFINITIONS.map(entry => entry.id);
const ids = entries => entries.map(entry => entry.id);
function sequence(...values) {
  let index = 0;
  return () => { assert.ok(index < values.length, 'unexpected random draw'); return values[index++]; };
}
function seeded(seed = 640) {
  let state = seed;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}
function assertLegal(choices, counts, size, exclude = []) {
  assert.equal(choices.length, Math.min(size, eligibleUpgrades({counts, exclude}).length));
  assert.equal(new Set(ids(choices)).size, choices.length);
  for (const entry of choices) {
    assert.ok(canAcquireUpgrade(entry, counts), `${entry.id} is not eligible`);
    assert.ok(!exclude.includes(entry.id), `${entry.id} was explicitly excluded`);
    assert.equal(entry.rings, {regular: 0, special: 1, risk: 2}[entry.kind]);
  }
}

test('the seventeen upgrades keep their categories, remove adventure and allow five unlimited acquisitions', () => {
  assert.equal(UPGRADE_DEFINITIONS.length, 17);
  assert.equal(new Set(ids(UPGRADE_DEFINITIONS)).size, 17);
  assert.equal(UPGRADES.risk, undefined);
  assert.equal(canAcquireUpgrade('risk', {}), false);
  assert.deepEqual(Object.fromEntries(UPGRADE_DEFINITIONS.map(entry => [entry.id, entry.maxStacks])), {
    energy: Infinity, overspeed: Infinity, density: Infinity, rubber: 4, growth: 2, magnet: 2,
    pierce: 1, pulse: 1, bank: 1, gravity: 1, breath: 1, split: 1, penetration: 1, boomerang: 1, shockwave: 1,
    gambler: Infinity, frenzy: Infinity,
  });
  for (const [kind, count, rings] of [['regular', 6, 0], ['special', 9, 1], ['risk', 2, 2]]) {
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
  assert.deepEqual(UPGRADES.rubber.effect, {retentionBonus: .08, lethalRetentionBonus: .04});
  assert.deepEqual(UPGRADES.growth.effect, {radiusScales: [1.2, 1.4], damageBonus: .1});
  assert.deepEqual(UPGRADES.magnet.effect, {pullDuration: .6, pullDistance: 2.5});
  assert.deepEqual(UPGRADES.pierce.effect, {retention: .92});
  assert.deepEqual(UPGRADES.pulse.effect, {radius: 4, damageRatio: .3});
  assert.deepEqual(UPGRADES.bank.effect, {damageBonus: .6, maxCharges: 2});
  assert.deepEqual(UPGRADES.gravity.effect, {radius: 5, acceleration: 2.4});
  assert.deepEqual(UPGRADES.breath.effect, {duration: 2.5, intervalMultiplier: 1.5});
  assert.deepEqual(UPGRADES.split.effect, {count: 2, radius: .7, speedRatio: .6, damageRatio: .6});
  assert.deepEqual(UPGRADES.penetration.effect, {restoreShotSpeed: true});
  assert.deepEqual(UPGRADES.boomerang.effect, {duration: .8, speedMultiplier: 1.3});
  assert.deepEqual(UPGRADES.shockwave.effect, {everyWalls: 2, radius: 4, fullPullDamageRatio: .75});
  assert.deepEqual(UPGRADES.gambler.effect, {nextTargetMultiplier: 1.5, extraRewardRounds: 1});
  assert.deepEqual(UPGRADES.frenzy.effect, {waveSizeBonus: 2, extraWaveSizeBonus: 1, restMultiplier: .7, extraRestMultiplier: .9, comboCap: 12,
    comboDamageThreshold: 6, comboDamagePerKill: .15, comboDamageCap: .6});
});

test('eligibility uses acquired layers and unlocks overspeed only after the fourth energy layer', () => {
  for (const entry of UPGRADE_DEFINITIONS.filter(entry => Number.isFinite(entry.maxStacks))) {
    const counts = {energy: 4, [entry.id]: entry.maxStacks - 1};
    assert.ok(canAcquireUpgrade(entry.id, counts));
    counts[entry.id]++;
    assert.equal(canAcquireUpgrade(entry, counts), false);
    assert.ok(!ids(eligibleUpgrades({counts})).includes(entry.id));
  }
  for (const energy of [0, 1, 2, 3]) assert.equal(canAcquireUpgrade('overspeed', {energy}), false);
  assert.ok(canAcquireUpgrade('overspeed', {energy: 4}));
  for (const layer of [2, 20, 1000000]) for (const id of ['energy', 'density', 'overspeed', 'gambler', 'frenzy'])
    assert.equal(canAcquireUpgrade(id, {energy: 4, [id]: layer}), true);
  for (const unknown of ['missing', 'toString', '__proto__']) assert.equal(canAcquireUpgrade(unknown, {}), false);
  assert.equal(canAcquireUpgrade({id: 'rubber', maxStacks: 999}, {rubber: 4}), false);
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
    const counts = Object.fromEntries(UPGRADE_DEFINITIONS.map(entry => [entry.id, Math.floor(random() * (Number.isFinite(entry.maxStacks) ? entry.maxStacks + 1 : 51))]));
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
    assert.equal(upgradeWeight(id, {averageKillsPerShot: 1.3}), 1);
    for (const averageKillsPerShot of [1.5, 1.500001, NaN, Infinity, undefined])
      assert.equal(upgradeWeight(id, {completedShots: 1, averageKillsPerShot}), 1);
    for (const averageKillsPerShot of [1.1999, 1.2, 1.35, 1.499999])
      assert.equal(upgradeWeight(id, {completedShots: 1, averageKillsPerShot}), 2);
  }
  assert.equal(upgradeWeight('split', {nextBoss: true, completedShots: 3, averageKillsPerShot: 1.35}), 4);
  assert.equal(upgradeWeight('split', {nextBoss: true, completedShots: 0, averageKillsPerShot: 0}), 2);
  assert.equal(upgradeWeight('split', {nextBoss: true, completedShots: 3, averageKillsPerShot: 1.5}), 2);
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
  const observed = {energy: 0, overspeed: 0, density: 0, rubber: 0, growth: 0, magnet: 0};
  for (let i = 0; i < 6000; i++) observed[rollUpgrades({counts: {energy: 4}, count: 1, random: sequence((i + .5) / 6000)})[0].id]++;
  assert.deepEqual(observed, {energy: 1000, overspeed: 1000, density: 1000, rubber: 1000, growth: 1000, magnet: 1000});
});

test('real special-slot frequencies cover the widened efficiency window, boundary and independent Boss multiplier', () => {
  for (const [completedShots, averageKillsPerShot, nextBoss, pulseUnits, splitUnits] of [
    [4, 1.2, false, 2, 2],
    [4, 1.35, true, 2, 4],
    [4, 1.499999, false, 2, 2],
    [4, 1.5, false, 1, 1],
    [4, 1.5, true, 1, 2],
    [0, 1.35, false, 1, 1],
  ]) {
    const context = {completedShots, averageKillsPerShot, nextBoss};
    const expected = {pierce: 100, pulse: pulseUnits * 100, bank: 100, gravity: pulseUnits * 100,
      breath: 100, split: splitUnits * 100, penetration: 100, boomerang: 100, shockwave: 100};
    const observed = Object.fromEntries(Object.keys(expected).map(id => [id, 0]));
    const samples = Object.values(expected).reduce((total, count) => total + count, 0);
    for (let i = 0; i < samples; i++) {
      const choices = rollUpgrades({context, count: 2, random: sequence(0, (i + .5) / samples)});
      observed[choices[1].id]++;
    }
    assert.deepEqual(observed, expected, JSON.stringify(context));
  }
});

test('special exhaustion replaces its slot with a distinct regular layer', () => {
  const counts = Object.fromEntries(UPGRADE_DEFINITIONS.filter(entry => entry.kind === 'special').map(entry => [entry.id, 1]));
  const choices = rollUpgrades({counts, random: () => 0});
  assert.deepEqual(choices.map(entry => entry.kind), ['regular', 'regular', 'risk']);
  assertLegal(choices, counts, 3);
});

test('explicit exclusions fill remaining legal categories and never copy an excluded pending gambler', () => {
  const exclude = UPGRADE_DEFINITIONS.filter(entry => entry.kind === 'regular').map(entry => entry.id);
  const counts = {};
  const choices = rollUpgrades({counts, exclude, random: () => .99, count: 5});
  assert.equal(choices.length, 5); assert.ok(choices.every(entry => entry.kind === 'special'));
  assertLegal(choices, counts, 5, exclude);
  for (const entry of UPGRADE_DEFINITIONS.filter(entry => entry.kind === 'special')) counts[entry.id] = 1;
  const risks = rollUpgrades({counts, exclude, random: () => .99, count: 5});
  assert.deepEqual(new Set(ids(risks)), new Set(['gambler', 'frenzy']));
  assertLegal(risks, counts, 5, exclude);
  const pending = rollUpgrades({counts: fullyBuilt(), exclude: ['gambler'], context: {stage: 100}, count: 5, random: () => 0});
  assert.deepEqual(new Set(ids(pending)), new Set(['energy', 'density', 'overspeed', 'frenzy']));
});

test('small eligible pools return every real option once and keep the energy prerequisite', () => {
  const exclude = allIds.filter(id => !['growth', 'bank'].includes(id));
  const one = {growth: 1, bank: 1};
  assert.deepEqual(ids(rollUpgrades({counts: one, exclude, count: 5, random: () => 0})), ['growth']);
  assert.deepEqual(ids(rollUpgrades({counts: {...one, bank: 0}, exclude, count: 5, random: () => 0})), ['growth', 'bank']);
  const locked = allIds.filter(id => !['energy', 'overspeed'].includes(id));
  assert.deepEqual(ids(rollUpgrades({counts: {energy: 3}, exclude: locked, count: 5, random: () => 0})), ['energy']);
  assert.deepEqual(ids(rollUpgrades({counts: {energy: 4}, exclude: locked, count: 5, random: () => 0})), ['energy', 'overspeed']);
});

test('an explicitly empty pool and a zero-sized offer do not sample or synthesize an upgrade', () => {
  const fail = () => { throw new Error('an empty pool must not sample'); };
  assert.deepEqual(rollUpgrades({exclude: allIds, random: fail}), []);
  assert.deepEqual(rollUpgrades({exclude: allIds, count: 5, random: fail}), []);
  assert.deepEqual(rollUpgrades({count: 0, random: fail}), []);
});

test('repeated offers consume no layers and long acquisition runs keep real alternatives', () => {
  const counts = {}, random = seeded(641);
  for (let i = 0; i < 200; i++) assertLegal(rollUpgrades({counts, random}), counts, 3);
  assert.deepEqual(counts, {});
  for (let granted = 0; granted < 300; granted++) {
    const count = granted % 2 ? 5 : 3;
    const choices = rollUpgrades({counts, random, count, context: {stage: granted + 1}});
    assertLegal(choices, counts, count);
    assert.ok(choices.every(choice => ['regular', 'special', 'risk'].includes(choice.kind)));
    const choice = choices[Math.floor(random() * choices.length)];
    counts[choice.id] = (counts[choice.id] || 0) + 1;
    assert.ok(counts[choice.id] <= choice.maxStacks);
  }
  for (const id of ['energy', 'density', 'overspeed', 'gambler', 'frenzy']) assert.ok(counts[id] > 5, id);
  const tail = rollUpgrades({counts: fullyBuilt(), random, count: 5, context: {stage: 100}});
  assert.equal(tail.length, 5);
  assert.deepEqual(new Set(ids(tail)), new Set(['energy', 'density', 'overspeed', 'gambler', 'frenzy']));
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

test('uncapped curves preserve the original layers and grow with diminishing relative gains afterward', () => {
  for (let n = 0; n <= 4; n++) assert.equal(upgradeStat('energy', n), 1.3 ** n);
  for (let n = 0; n <= 5; n++) assert.equal(upgradeStat('density', n), 1.35 ** n);
  for (let n = 0; n <= 2; n++) assert.equal(upgradeStat('overspeed', n), 8 * n);
  assert.equal(upgradeStat('energy', 5), 1.3 ** 4 * 1.12);
  assert.equal(upgradeStat('density', 6), 1.35 ** 5 * 1.15);
  assert.equal(upgradeStat('overspeed', 3), 20);
  for (const [id, threshold] of [['energy', 4], ['density', 5], ['overspeed', 2]]) {
    let lastGain = Infinity;
    for (let n = threshold; n < 100; n++) {
      const previous = upgradeStat(id, n), next = upgradeStat(id, n + 1);
      const gain = id === 'overspeed' ? next - previous : next / previous - 1;
      assert.ok(gain > 0 && gain <= lastGain, id + ' keeps a positive, decreasing gain');
      lastGain = gain;
    }
    for (const n of [1000, 1000000, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE])
      assert.ok(Number.isFinite(upgradeStat(id, n)), id + ' stays finite');
    for (const invalid of [NaN, Infinity, -Infinity, -4, undefined, 'bad'])
      assert.equal(upgradeStat(id, invalid), upgradeStat(id, 0));
    assert.equal(upgradeStat(id, '7.8'), upgradeStat(id, 7));
  }
});

test('offers describe the next layer, extra gambler round and stacking frenzy damage', () => {
  assert.equal(upgradeOffer('energy', {}).short, '弹射能量 ×1.3');
  assert.equal(upgradeOffer('density', {density: 4}).short, '质量 ×1.35，无尽弹射不减速');
  assert.equal(upgradeOffer('overspeed', {overspeed: 1}).short, '速度上限 +8 u/s');
  assert.equal(upgradeOffer('energy', {energy: 4}).short, '弹射能量 +12%');
  assert.equal(upgradeOffer('density', {density: 5}).short, '质量 +15%，无尽弹射不减速');
  assert.equal(upgradeOffer('overspeed', {overspeed: 2}).short, '速度上限 +4 u/s');
  assert.equal(upgradeOffer('overspeed', {overspeed: 3}).short, '速度上限 +1.66 u/s');
  assert.match(upgradeOffer('gambler', {gambler: 100}).short, /多选一轮/);
  assert.match(UPGRADES.gambler.detail, /普通阶段共 2 轮，Boss 阶段共 3 轮/);
  assert.doesNotMatch(UPGRADES.gambler.detail, /五选一/);
  assert.match(UPGRADES.frenzy.detail, /多层加算/);
  assert.match(UPGRADES.frenzy.detail, /从第 2 层起，每层每波再增加 1 颗、波间休止再乘 0.9/);
  assert.equal(upgradeOffer('frenzy', {frenzy: 1}).short, '每波再 +1，休止再 ×0.9；连击增伤上限共 +120%');
  assert.equal(upgradeOffer('frenzy', {frenzy: 9}).short, '每波再 +1，休止再 ×0.9；连击增伤上限共 +600%');
  assert.doesNotMatch(upgradeOffer('frenzy', {frenzy: 1}).short, /波次更密/);
  const choices = rollUpgrades({counts: fullyBuilt(), count: 5, random: () => 0});
  assert.equal(choices.length, 5);
  for (const choice of choices) assert.equal(choice.short, upgradeOffer(choice, fullyBuilt()).short);
});

test('late weighting favors uncollected frenzy and discounts high basic layers without removing them', () => {
  for (const stage of [1, 11]) {
    assert.equal(upgradeWeight('frenzy', {stage}), 1);
    assert.equal(upgradeWeight('frenzy', {stage}, {frenzy: 100}), 1);
    assert.equal(upgradeWeight('energy', {stage}, {energy: 99}), 1);
  }
  assert.ok(upgradeWeight('frenzy', {stage: 12}) > 1);
  assert.equal(upgradeWeight('frenzy', {stage: 50}, {frenzy: 1}), 1);
  assert.equal(upgradeWeight('frenzy', {stage: 20}), 2.5);
  assert.equal(upgradeWeight('frenzy', {stage: 20}, {frenzy: 3}), 1 / 1.5);
  assert.equal(upgradeWeight('frenzy', {stage: 20}, {frenzy: 5}), .5);
  assert.equal(upgradeWeight('frenzy', {stage: 20}, {frenzy: 100}), .4);
  assert.equal(upgradeWeight('frenzy', {stage: 15}, {frenzy: 3}), 1 / (1 + .25 * 2 * 4 / 9));
  assert.equal(upgradeWeight('gambler', {stage: 20}, {gambler: 100}), 1);
  assert.equal(upgradeWeight('energy', {stage: 20}, {energy: 4}), 1);
  assert.equal(upgradeWeight('energy', {stage: 20}, {energy: 5}), 1 / 1.22);
  assert.equal(upgradeWeight('density', {stage: 20, nextBoss: true}, {density: 100}), .4);
});

test('late offers use both risk choices without duplication or an added regular guarantee', () => {
  const counts = {energy: 6, density: 7, overspeed: 4};
  const riskPreferred = rollUpgrades({counts, context: {stage: 20}, random: () => 0});
  assert.deepEqual(ids(riskPreferred), ['gambler', 'frenzy', 'energy']);
  const noRegular = rollUpgrades({counts, context: {stage: 20}, random: sequence(0, 0, .99, 0, 0, 0)});
  assert.deepEqual(noRegular.map(entry => entry.kind), ['risk', 'special', 'risk']);
  const regular = rollUpgrades({counts, context: {stage: 20}, random: () => .99});
  assert.deepEqual(regular.map(entry => entry.kind), ['regular', 'special', 'regular']);
  assert.equal(canAcquireUpgrade('energy', counts), true);
  assert.equal(canAcquireUpgrade('density', counts), true);
  assert.equal(canAcquireUpgrade('overspeed', counts), true);
  const a = seeded(645), b = seeded(645);
  for (let n = 0; n < 100; n++) {
    assert.deepEqual(rollUpgrades({counts, random: a}), rollUpgrades({counts, random: b, context: {stage: 11}}));
  }
});

test('seeded late offer frequencies rise gradually to the specified risk probabilities', () => {
  const statistics = [];
  for (const stage of [11, 12, 16, 20]) {
    const random = seeded(820), samples = 20000, slots = [0, 0, 0];
    let bothRisks = 0;
    for (let n = 0; n < samples; n++) {
      const choices = rollUpgrades({counts: {energy: 4}, context: {stage}, random});
      for (let i = 0; i < 3; i++) slots[i] += Number(choices[i].kind === 'risk');
      const risks = choices.filter(choice => choice.kind === 'risk').length;
      bothRisks += Number(risks === 2);
      assert.ok(risks <= 2);
      assert.equal(new Set(ids(choices)).size, 3);
    }
    const t = Math.max(0, Math.min(1, (stage - 11) / 9));
    const first = .2 * t, second = .45 * t, third = .6 + .25 * t;
    for (const [i, probability] of [first, second, third * (1 - first * second)].entries())
      assert.ok(Math.abs(slots[i] / samples - probability) < .015, `stage ${stage}, slot ${i}`);
    const expectedBoth = first * second + first * third + second * third - 2 * first * second * third;
    assert.ok(Math.abs(bothRisks / samples - expectedBoth) < .015);
    statistics.push(slots.reduce((sum, count) => sum + count, 0));
  }
  for (let n = 1; n < statistics.length; n++) assert.ok(statistics[n] > statistics[n - 1]);
});

test('repeated frenzy is less common in real late offers while gambler history does not reduce its weight', () => {
  const both = .2 * .45 + .2 * .85 + .45 * .85 - 2 * .2 * .45 * .85;
  const one = 1 - (1 - .2) * (1 - .45) * (1 - .85) - both;
  let lastFrenzy = Infinity;
  for (const frenzy of [0, 1, 3, 5, 100]) {
    const random = seeded(830), samples = 15000, counts = {energy: 4, frenzy, gambler: 100};
    let seenFrenzy = 0, seenGambler = 0;
    for (let n = 0; n < samples; n++) {
      const choices = ids(rollUpgrades({counts, context: {stage: 20}, random}));
      seenFrenzy += Number(choices.includes('frenzy'));
      seenGambler += Number(choices.includes('gambler'));
    }
    const weight = upgradeWeight('frenzy', {stage: 20}, counts);
    assert.ok(Math.abs(seenFrenzy / samples - (both + one * weight / (weight + 1))) < .015);
    assert.ok(Math.abs(seenGambler / samples - (both + one / (weight + 1))) < .015);
    assert.ok(seenFrenzy < lastFrenzy);
    lastFrenzy = seenFrenzy;
  }
  const fresh = seeded(831), repeated = seeded(831);
  for (let n = 0; n < 100; n++) {
    assert.deepEqual(rollUpgrades({counts: {gambler: 0}, context: {stage: 20}, random: fresh}),
      rollUpgrades({counts: {gambler: 100}, context: {stage: 20}, random: repeated}));
  }
});
