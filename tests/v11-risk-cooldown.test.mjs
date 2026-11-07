import test from 'node:test';
import assert from 'node:assert/strict';
import {World, BOSS_TIMING} from '../dist/physics.js';
import {UPGRADE_DEFINITIONS, rollUpgrades} from '../dist/upgrades.js';
import {createEndlessRun} from '../dist/endless-progress.js';
import {createRunSnapshot, restoreRunSnapshot} from '../dist/run-save.js';

const riskCount = choices => choices.filter(choice => choice.kind === 'risk').length;
const fullCounts = () => Object.fromEntries(UPGRADE_DEFINITIONS.map(entry => [entry.id,
  Number.isFinite(entry.maxStacks) ? entry.maxStacks : 20]));
function fresh(seed = 16) {
  const runDay = createEndlessRun('2026-11-07', seed);
  return {runDay, world: new World(390, 844, runDay.random, {spawnInitial: false})};
}
function choose(w, id = 'energy') {
  w.step(w.rewardTiming.transition + .001);
  assert.equal(w.phase, 'choose');
  const choice = w.choices.find(choice => choice.id === id);
  assert.ok(choice, `${id} is offered`);
  assert.equal(w.choose(choice), true);
}
function save(state) { return JSON.parse(JSON.stringify(createRunSnapshot(state))); }
function restore(state) {
  const copy = restoreRunSnapshot(save(state));
  assert.ok(copy); return copy;
}
function legacy(raw) {
  const world = raw.data.nodes.find(node => node.t === 'world');
  world.v = world.v.filter(([key]) => key !== 'riskOfferCooldown');
  return raw;
}
function doubleRiskState() {
  for (let seed = 0; seed < 50; seed++) {
    const state = fresh(seed), w = state.world;
    w.stage = w.maxStage = 21; w.buffs = fullCounts(); w.beginUpgrade();
    if (riskCount(w.choices) === 2) return state;
  }
  assert.fail('fixed seed set must contain a double-risk offer');
}

test('cooling keeps distinct real options and at least two non-risk choices even when specials are exhausted', () => {
  const counts = fullCounts();
  assert.equal(riskCount(rollUpgrades({counts, context: {stage: 20}, random: () => 0})), 2);
  for (const stage of [1, 12, 20, 45]) for (const pool of [{energy: 4}, counts, {...counts, energy: 0, overspeed: 0}]) {
    const random = createEndlessRun('2026-11-07', 1130).random;
    for (let i = 0; i < 500; i++) {
      const offers = rollUpgrades({counts: pool, context: {stage}, random, maxRisks: 1});
      assert.equal(offers.length, 3); assert.equal(new Set(offers.map(choice => choice.id)).size, 3);
      assert.ok(riskCount(offers) <= 1);
    }
  }
});

test('unrestricted offers retain the original category draws and random stream', () => {
  const first = createEndlessRun('2026-11-07', 836).random;
  const second = createEndlessRun('2026-11-07', 836).random;
  for (let i = 0; i < 400; i++) {
    const options = {counts: {energy: 4, frenzy: i % 9}, context: {stage: 1 + i % 45}};
    assert.deepEqual(rollUpgrades({...options, random: first}), rollUpgrades({...options, random: second, maxRisks: 2}));
    assert.equal(first.getState(), second.getState());
  }
});

test('a double-risk offer cools exactly the next ordinary offer and no new run inherits it', () => {
  const w = new World(390, 844, () => 0, {spawnInitial: false});
  w.stage = w.maxStage = 21; w.buffs = fullCounts();
  const risks = [];
  for (let round = 0; round < 4; round++) {
    w.beginUpgrade(); risks.push(riskCount(w.choices));
    const pending = w.riskOfferCooldown;
    choose(w); assert.equal(w.riskOfferCooldown, pending, 'selection does not consume protection');
    w.step(w.rewardTiming.rest + .001);
    assert.equal(w.phase, 'battle'); assert.equal(w.riskOfferCooldown, pending);
  }
  assert.deepEqual(risks, [2, 1, 2, 1]);
  const clean = fresh().world;
  assert.equal(clean.riskOfferCooldown, false);
  clean.beginStartingUpgrades(); assert.equal(riskCount(clean.choices), 0); assert.equal(clean.riskOfferCooldown, false);
});

for (const wager of [false, true]) test(`Boss reward cooldown advances per offer, including wager=${wager}`, () => {
  const w = new World(390, 844, () => 0, {spawnInitial: false});
  w.stage = w.maxStage = 20; w.buffs = fullCounts(); w.gamblerRewardPending = wager;
  w.beginBoss(); w.step(BOSS_TIMING.entry);
  Object.assign(w.boss, {stunned: true, r: w.boss.minRadius, hp: .5, maxHp: .5});
  w.damageBoss(w.unit * 30, {source: 'shockwave'});
  assert.equal(w.phase, 'boss-celebrate');
  w.step(.125, false, {timeScale: .25});
  w.step(BOSS_TIMING.brake + BOSS_TIMING.spin + BOSS_TIMING.hold + BOSS_TIMING.fade + .001);
  const rounds = wager ? 3 : 2, risks = [];
  assert.equal(w.upgradeRoundTotal, rounds);
  for (let round = 0; round < rounds; round++) {
    risks.push(riskCount(w.choices)); choose(w); w.step(w.rewardTiming.rest + .001);
  }
  assert.deepEqual(risks, wager ? [2, 1, 2] : [2, 1]);
  assert.equal(w.phase, 'battle'); assert.equal(w.stage, 21);
  w.beginUpgrade(); assert.equal(riskCount(w.choices), wager ? 1 : 2, 'last Boss offer controls the next ordinary offer');
});

test('a pending gambler does not prolong the one-off cooldown', () => {
  const w = new World(390, 844, () => 0, {spawnInitial: false});
  w.stage = w.maxStage = 21; w.gamblerRewardPending = true; w.beginUpgrade();
  assert.equal(riskCount(w.choices), 2); choose(w, 'gambler');
  w.step(w.rewardTiming.rest + .001);
  assert.equal(w.nextGambler, true); assert.equal(riskCount(w.choices), 1);
  assert.ok(w.choices.every(choice => choice.id !== 'gambler')); assert.equal(w.riskOfferCooldown, false);
  choose(w); w.step(w.rewardTiming.rest + .001);
  w.beginUpgrade(); assert.equal(riskCount(w.choices), 2);
});

for (const phase of ['transition', 'choose', 'reward', 'battle']) test(`cooldown survives repeated save/resume during ${phase} without rerolling or consuming it`, () => {
  const state = doubleRiskState(), w = state.world;
  if (phase !== 'transition') w.step(w.rewardTiming.transition + .001);
  if (phase === 'reward' || phase === 'battle') choose(w);
  if (phase === 'battle') w.step(w.rewardTiming.rest + .001);
  assert.equal(w.phase, phase); assert.equal(w.riskOfferCooldown, true);
  const first = restore(state), second = restore(first);
  assert.deepEqual(save(second), save(state));
  assert.equal(second.world.riskOfferCooldown, true);
  if (['transition', 'choose'].includes(second.world.phase)) choose(second.world);
  if (second.world.phase === 'reward') second.world.step(second.world.rewardTiming.rest + .001);
  assert.equal(second.world.phase, 'battle'); second.world.beginUpgrade();
  assert.ok(riskCount(second.world.choices) <= 1); assert.equal(second.world.riskOfferCooldown, false);
  const third = restore(second); assert.deepEqual(save(third), save(second));
  const expectedState = restore(third);
  const expected = rollUpgrades({counts: third.world.buffs, context: third.world.upgradeContext,
    random: expectedState.runDay.random});
  third.world.offerUpgradeRound();
  assert.deepEqual(third.world.choices.map(choice => choice.id), expected.map(choice => choice.id), 'normal weighting resumes after the protected offer');
});

test('v10.1 saves derive protection only from a still-visible double-risk offer', () => {
  for (const phase of ['transition', 'choose', 'reward', 'battle']) {
    const state = doubleRiskState(), w = state.world;
    if (phase !== 'transition') w.step(w.rewardTiming.transition + .001);
    if (phase === 'reward' || phase === 'battle') choose(w);
    if (phase === 'battle') w.step(w.rewardTiming.rest + .001);
    const restored = restoreRunSnapshot(legacy(save(state)));
    assert.ok(restored); assert.equal(restored.world.phase, phase);
    assert.equal(restored.world.riskOfferCooldown, ['transition', 'choose'].includes(phase));
    assert.deepEqual(restored.world.choices, w.choices);
    assert.equal(restored.runDay.random.getState(), state.runDay.random.getState());
  }
  const state = fresh(), restored = restoreRunSnapshot(legacy(save(state)));
  assert.ok(restored); assert.equal(restored.world.riskOfferCooldown, false);
});

test('malformed cooldown state is rejected rather than silently enabling or skipping protection', () => {
  for (const invalid of [null, 0, 1, 'false']) {
    const raw = save(doubleRiskState());
    raw.data.nodes.find(node => node.t === 'world').v.find(([key]) => key === 'riskOfferCooldown')[1] = invalid;
    assert.equal(restoreRunSnapshot(raw), null);
  }
});

test('long real-RNG reward sequences never contain consecutive double-risk offers and keep the expected rate', () => {
  const {world: w} = fresh(836); w.stage = w.maxStage = 30; w.buffs = fullCounts();
  w.upgradeContext = {stage: 30};
  let previous = false, doubles = 0;
  const count = 30000;
  for (let i = 0; i < count; i++) {
    w.offerUpgradeRound(); const double = riskCount(w.choices) === 2;
    assert.ok(!(previous && double)); doubles += Number(double); previous = double;
    w.events = [];
  }
  assert.ok(Math.abs(doubles / count - .4895 / 1.4895) < .012, `observed ${doubles / count}`);
});
