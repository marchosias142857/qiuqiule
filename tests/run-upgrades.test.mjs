import test from 'node:test';
import assert from 'node:assert/strict';
import {runUpgradeEntries} from '../dist/run-upgrades.js';
import {UPGRADES, UPGRADE_DEFINITIONS} from '../dist/upgrades.js';
import {World} from '../dist/physics.js';

const byId = world => Object.fromEntries(runUpgradeEntries(world).map(entry => [entry.id, entry]));
const gambler = world => byId({buffs: {gambler: 3}, ...world}).gambler.summary;

test('the run snapshot contains only owned current definitions, in their definition order', () => {
  for (const world of [undefined, null, {}, {buffs: null}, {buffs: {}}]) assert.deepEqual(runUpgradeEntries(world), []);
  const buffs = Object.assign(Object.create({pulse: 1}), {
    frenzy: 3, gambler: 2, energy: 5, risk: 2, missing: 1, rubber: 0, density: NaN,
    overspeed: Infinity, growth: -1, magnet: .5, bank: '1', split: true,
  });
  const entries = runUpgradeEntries({buffs});
  assert.deepEqual(entries.map(entry => entry.id), ['energy', 'gambler', 'frenzy']);
  assert.deepEqual(entries.map(entry => entry.stacks), [5, 2, 3]);
  assert.deepEqual(entries.map(entry => entry.kind), ['regular', 'risk', 'risk']);
  assert.equal(entries[0].name, '弹性十足');
});

test('base upgrade summaries show acquired cumulative effects rather than a future layer', () => {
  const entries = byId({buffs: {energy: 5, density: 6, overspeed: 3, growth: 2, magnet: 2}});
  assert.equal(entries.energy.summary, '弹射能量约为初始的 3.2 倍。');
  assert.equal(entries.density.summary, '质量约为初始的 5.16 倍，同样拉伸不降低弹射速度。');
  assert.equal(entries.overspeed.summary, '弹射速度上限 80 u/s（基础 60 + 强化 20）。');
  assert.equal(entries.growth.summary, '直径为初始的 1.4 倍，伤害 +20%；质量不变。');
  assert.equal(entries.magnet.summary, '击杀后 0.25 秒内牵引敌球，优先前方路线；每颗最多移动 6u，同时最多 2 颗。');
  assert.doesNotMatch(entries.energy.summary, /12%|下一/);
  assert.doesNotMatch(entries.density.summary, /15%|下一/);
  assert.doesNotMatch(entries.overspeed.summary, /\+4 u/);
});

test('retention is the real minimum including its base value and never exceeds one hundred percent', () => {
  for (const [rubber, normal, lethal] of [[1, 78, 89], [3, 94, 97], [4, 100, 100]]) {
    assert.equal(byId({buffs: {rubber}}).rubber.summary,
      `撞击保速下限：未击杀 ${normal}%，直接击杀 ${lethal}%。`);
  }
  const malformed = byId({buffs: {rubber: 100, growth: 100, magnet: 100}});
  assert.equal(malformed.rubber.stacks, 4);
  assert.equal(malformed.growth.stacks, 2);
  assert.equal(malformed.magnet.stacks, 2);
  assert.match(malformed.rubber.summary, /未击杀 100%，直接击杀 100%/);
  assert.match(malformed.growth.summary, /1.4 倍，伤害 \+20%/);
});

test('single-acquisition special upgrades show their current effect details including the widened shockwave', () => {
  const definitions = UPGRADE_DEFINITIONS.filter(entry => entry.kind === 'special');
  const buffs = Object.fromEntries(definitions.map(entry => [entry.id, 1]));
  const entries = byId({buffs});
  for (const definition of definitions) assert.equal(entries[definition.id].summary, definition.detail);
  assert.match(entries.shockwave.summary, /半径 4u/);
  assert.match(entries.shockwave.summary, /75% 满拉伤害/);
});

test('frenzy snapshots include stacked damage, additive wave size and multiplicative rest', () => {
  for (const [frenzy, step, cap, wave, rest] of [[1, 15, 60, 2, '0.7'], [2, 30, 120, 3, '0.63'], [3, 45, 180, 4, '0.567'], [5, 75, 300, 6, '0.459']]) {
    const summary = byId({buffs: {frenzy}}).frenzy.summary;
    assert.match(summary, new RegExp(`超过 6 连击后，每击杀使后续伤害 \\+${step}%，最多 \\+${cap}%`));
    assert.ok(summary.includes(`每波 +${wave} 颗；波间休止 ×${rest}；连击倍率上限 12`));
    assert.doesNotMatch(summary, /不随层数增加/);
    assert.match(summary, /连击中断重置/);
  }
});

test('gambler distinguishes pending, active, reward redemption and completed wagers', () => {
  assert.equal(gambler({phase: 'reward', nextGambler: true}), '下阶段目标 +50%，完成后额外 1 轮三选一。');
  for (const phase of ['battle', 'clearing', 'boss-entry', 'boss', 'boss-celebrate']) {
    assert.equal(gambler({phase, gamblerTargetMultiplier: 1.5, gamblerRewardPending: true}),
      '本阶段目标 +50%，完成后额外 1 轮三选一。');
  }
  for (const phase of ['transition', 'choose', 'reward']) {
    assert.equal(gambler({phase, gamblerTargetMultiplier: 1.5, gamblerRewardPending: false}),
      '本轮奖励兑现中，额外 1 轮三选一已计入。');
  }
  assert.equal(gambler({phase: 'battle', gamblerTargetMultiplier: 1}), '已兑现，当前无待生效赌注。');
  assert.equal(gambler({phase: 'over', gamblerTargetMultiplier: 1.5, gamblerRewardPending: true}),
    '本局已结束，本阶段赌注尚未兑现。');
  const repeated = gambler({phase: 'choose', nextGambler: true, gamblerTargetMultiplier: 1.5, gamblerRewardPending: false});
  assert.match(repeated, /^下阶段目标 \+50%/);
  assert.match(repeated, /本轮赌注的额外奖励已计入/);
  assert.doesNotMatch(repeated, /150%|倍率|永久/);
});

test('gambler summaries follow a real reward sequence without mistaking cumulative acquisitions for permanent power', () => {
  const world = new World(900, 700, () => 0, {spawnInitial: false});
  world.phase = 'choose';
  assert.equal(world.choose(UPGRADES.gambler), true);
  assert.match(byId(world).gambler.summary, /^下阶段目标/);
  world.finishRewardRound();
  assert.match(byId(world).gambler.summary, /^本阶段目标/);
  world.beginUpgrade();
  assert.equal(world.upgradeRoundTotal, 2);
  assert.match(byId(world).gambler.summary, /^本轮奖励兑现中/);
  world.phase = 'choose'; world.choose(world.choices.find(entry => entry.id !== 'gambler'));
  world.finishRewardRound();
  assert.equal(world.upgradeRound, 2);
  assert.match(byId(world).gambler.summary, /^本轮奖励兑现中/);
  world.phase = 'choose'; world.choose(world.choices.find(entry => entry.id !== 'gambler'));
  world.finishRewardRound();
  assert.equal(byId(world).gambler.summary, '已兑现，当前无待生效赌注。');
  assert.equal(byId(world).gambler.stacks, 1);
});

test('run snapshots are pure and extreme valid layer counts keep finite readable summaries', () => {
  const buffs = Object.freeze({energy: 1000000, density: Number.MAX_VALUE, overspeed: 1000000, frenzy: Number.MAX_VALUE});
  const world = Object.freeze({buffs, phase: 'battle'});
  const a = runUpgradeEntries(world), b = runUpgradeEntries(world);
  assert.deepEqual(a, b);
  assert.ok(a.every(entry => Number.isFinite(entry.stacks) && !/NaN|Infinity|undefined/.test(entry.summary)));
  a[0].name = 'changed'; a[0].summary = 'changed';
  assert.deepEqual(runUpgradeEntries(world), b);
  assert.equal(UPGRADES.energy.name, '弹性十足');
});
