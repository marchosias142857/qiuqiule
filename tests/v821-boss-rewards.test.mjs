import test from 'node:test';
import assert from 'node:assert/strict';
import {World, BOSS_TIMING} from '../dist/physics.js';
import {UPGRADE_DEFINITIONS, rollUpgrades, canAcquireUpgrade} from '../dist/upgrades.js';

function world() { return new World(390, 844, () => .4, {spawnInitial: false}); }
function defeatBoss(w, stage = 20, random = () => 0) {
  w.stage = stage; w.beginBoss(); w.step(BOSS_TIMING.entry); w.random = random;
  Object.assign(w.boss, {stunned: true, r: w.boss.minRadius, hp: .5, maxHp: .5});
  w.damageBoss(w.unit * 30, {source: 'shockwave'});
  assert.equal(w.phase, 'boss-celebrate');
  w.step(.125, false, {timeScale: .25});
  w.step(BOSS_TIMING.brake + BOSS_TIMING.spin + BOSS_TIMING.hold + BOSS_TIMING.fade + .001);
  assert.equal(w.phase, 'transition');
}
function pick(w, id) {
  w.step(w.rewardTiming.transition); assert.equal(w.phase, 'choose');
  const choice = w.choices.find(c => c.id === id);
  assert.ok(choice, `${id} must be a displayed option`);
  Object.assign(w.player, {x: choice.x, y: choice.y, vx: 0, vy: 0});
  w.step(1 / 120); assert.equal(w.phase, 'reward'); w.step(w.rewardTiming.rest);
}
function legal(w) {
  assert.equal(w.choices.length, 3);
  assert.equal(new Set(w.choices.map(c => c.id)).size, 3);
  assert.ok(w.choices.every(c => c.id !== 'risk' && canAcquireUpgrade(c, w.buffs)));
  assert.ok(w.choices.some(c => c.kind !== 'risk'), 'two distinct risk types cannot fill three slots');
  if (w.nextGambler) assert.ok(w.choices.every(c => c.id !== 'gambler'));
}

for (const wager of [false, true]) {
  test(`Boss rewards preserve separate real selections and advance once with wager=${wager}`, () => {
    const w = world(); w.gamblerRewardPending = wager; defeatBoss(w);
    const rounds = wager ? 3 : 2;
    assert.equal(w.upgradeRoundTotal, rounds); assert.equal(w.gamblerRewardPending, false);
    for (let round = 0; round < rounds; round++) {
      legal(w); assert.equal(w.upgradeRound, round + 1); assert.equal(w.rewardSelectionsRemaining, rounds - round);
      pick(w, 'energy'); assert.equal(w.buffs.energy, round + 1);
      assert.equal(w.stage, round === rounds - 1 ? 21 : 20);
    }
    assert.equal(w.phase, 'battle'); assert.equal(w.events.filter(e => e.type === 'buff').length, rounds);
    assert.equal(w.events.filter(e => e.type === 'stage').length, 1);
    assert.equal(w.events.filter(e => e.type === 'upgradeSkipped').length, 0);
  });
}

for (const inheritedWager of [false, true]) for (const chooseLast of [false, true]) {
  test(`a Boss wager is only for the next sequence: inherited=${inheritedWager}, chosenLast=${chooseLast}`, () => {
    const w = world(); w.gamblerRewardPending = inheritedWager; defeatBoss(w);
    const rounds = inheritedWager ? 3 : 2, wagerRound = chooseLast ? rounds - 1 : 0;
    for (let round = 0; round < rounds; round++) {
      legal(w); assert.equal(w.upgradeRoundTotal, rounds);
      pick(w, round === wagerRound ? 'gambler' : 'energy');
      if (round >= wagerRound && round < rounds - 1) {
        assert.equal(w.nextGambler, true); assert.equal(w.applyUpgrade('gambler'), false);
        assert.ok(w.choices.every(c => c.id !== 'gambler'));
      }
    }
    assert.equal(w.stage, 21); assert.equal(w.buffs.gambler, 1); assert.equal(w.nextGambler, false);
    assert.equal(w.gamblerTargetMultiplier, 1.5); assert.equal(w.gamblerRewardPending, true);
    w.beginUpgrade(); assert.equal(w.upgradeRoundTotal, 2); legal(w);
    pick(w, 'gambler'); assert.equal(w.buffs.gambler, 2); assert.equal(w.upgradeRoundTotal, 2); legal(w);
    pick(w, 'energy'); assert.equal(w.stage, 22); assert.equal(w.gamblerRewardPending, true);
    w.beginUpgrade(); assert.equal(w.upgradeRoundTotal, 2); legal(w);
    pick(w, 'energy'); legal(w); pick(w, 'energy');
    assert.equal(w.stage, 23); assert.equal(w.gamblerTargetMultiplier, 1); assert.equal(w.gamblerRewardPending, false);
    w.beginUpgrade(); assert.equal(w.upgradeRoundTotal, 1); legal(w);
  });
}

test('ordinary rewards and consecutive Bosses retain legal alternatives while frenzy repeats without a cap', () => {
  const w = world(), offer = w.offerUpgradeRound.bind(w);
  // Keep this stacking regression focused on frenzy while the new cooldown
  // legitimately removes the other risk from every second offer.
  w.offerUpgradeRound = () => {
    let draw = 0; w.random = () => draw++ % 2 === 0 ? 0 : .999;
    return offer();
  };
  w.gamblerRewardPending = true; defeatBoss(w);
  for (let round = 0; round < 3; round++) { legal(w); pick(w, 'frenzy'); }
  w.beginUpgrade(); assert.equal(w.upgradeRoundTotal, 1); legal(w); pick(w, 'frenzy');
  defeatBoss(w, 25); assert.equal(w.upgradeRoundTotal, 2);
  for (let round = 0; round < 2; round++) { legal(w); pick(w, 'frenzy'); }
  assert.equal(w.stage, 26); assert.equal(w.buffs.frenzy, 6);
  assert.equal(w.comboCap, 12); assert.equal(w.waveSize, 15);
  assert.equal(w.events.filter(e => e.type === 'upgradeSkipped').length, 0);
});

test('three distinct offers naturally include a non-risk alternative without a Boss-only repair', () => {
  const counts = Object.fromEntries(UPGRADE_DEFINITIONS.map(d => [d.id, Number.isFinite(d.maxStacks) ? d.maxStacks : 40]));
  let seed = 830; const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
  for (const stage of [1, 11, 20, 100]) for (const exclude of [[], ['gambler']]) for (let sample = 0; sample < 250; sample++) {
    const choices = rollUpgrades({counts, context: {stage}, random, exclude});
    assert.equal(choices.length, 3); assert.equal(new Set(choices.map(c => c.id)).size, 3);
    assert.ok(choices.some(c => c.kind !== 'risk'));
    assert.ok(choices.every(c => c.id !== 'risk' && !exclude.includes(c.id) && canAcquireUpgrade(c, counts)));
  }
});
