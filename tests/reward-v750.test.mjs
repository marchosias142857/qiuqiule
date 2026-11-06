import test from 'node:test';
import assert from 'node:assert/strict';
import {World, REWARD_TIMING, BOSS_TIMING} from '../dist/physics.js';
import {UPGRADES, UPGRADE_DEFINITIONS} from '../dist/upgrades.js';

const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
function world(width = 900, height = 700) {
  const w = new World(width, height, () => .4, {spawnInitial: false});
  w.spawnTimer = w.floorTimer = w.introTimer = Infinity;
  Object.assign(w.player, {x: width * .3, y: height * .3});
  return w;
}
function bossReward({lateBuild = false, gambler = false} = {}) {
  const w = world(390, 844); w.stage = 5; w.gamblerRewardPending = gambler;
  if (lateBuild) for (const definition of UPGRADE_DEFINITIONS) {
    w.buffs[definition.id] = Number.isFinite(definition.maxStacks) ? definition.maxStacks : 20;
  }
  w.beginBoss(); w.step(BOSS_TIMING.entry); w.defeatBoss();
  w.step(.5); assert.equal(w.bossVictorySlowTime, 0);
  return w;
}
const celebrationDuration = BOSS_TIMING.brake + BOSS_TIMING.spin + BOSS_TIMING.hold + BOSS_TIMING.fade;

test('v7.5 reward timing shortens only the approved waits and keeps the legacy campaign schedule', () => {
  assert.deepEqual(REWARD_TIMING, {move: 1, transition: 1.2, bornDelay: .15, bornDuration: .8, rest: .6});
  assert.ok(Object.isFrozen(REWARD_TIMING));
  assert.deepEqual(BOSS_TIMING, {entry: .85, brake: .8, spin: .85, hold: .6, fade: .22});
  const w = world(); w.mode = 'campaign'; w.beginUpgrade();
  assert.deepEqual(w.rewardTiming, {move: 1.45, transition: 1.85, bornDelay: .25, bornDuration: 1.5, rest: 1});
  w.step(1.2); assert.equal(w.phase, 'transition');
  w.step(.65); assert.equal(w.phase, 'choose');
});

test('v7.5 placement preserves the incoming pose after the last local hold for all feedback settings', () => {
  for (const [strength, reducedMotion] of [[0, false], [.6, false], [1, false], [.6, true]]) {
    const w = world(); w.setFeedbackOptions({strength, reducedMotion});
    Object.assign(w.player, {angle: -1.3, squash: .24});
    w.freezeFeedback(null, .05);
    const before = {...w.player}, held = w.player.feedbackFreeze || 0;
    w.beginUpgrade();
    near(w.player.x, before.x); near(w.player.y, before.y);
    near(w.player.angle, before.angle); near(w.player.squash, before.squash);
    w.step(held); near(w.phaseTime, 0);
    w.step(1e-6);
    near(w.player.x, before.x); near(w.player.y, before.y);
    near(w.player.angle, before.angle); near(w.player.squash, before.squash);
    w.step(w.rewardTransitionEnd - w.phaseTime);
    assert.equal(w.phase, 'choose'); near(w.player.squash, 0);
  }
});

test('v7.5 reward balls finish growing and the player settles before control returns', () => {
  const w = world(); w.beginUpgrade();
  assert.ok(w.choices.every(c => c.born === 0));
  w.step(.15); assert.ok(w.choices.every(c => c.born === 0));
  w.step(.4); assert.ok(w.choices.every(c => Math.abs(c.born - .5) < 1e-9));
  w.step(.4); assert.ok(w.choices.every(c => c.born === 1));
  w.step(.05); near(w.player.x, w.width / 2); near(w.player.y, w.choicePlayerY); near(w.rewardMoveProgress, 1);
  const settled = {...w.player};
  w.step(.2); assert.equal(w.phase, 'choose');
  near(w.player.x, settled.x); near(w.player.y, settled.y); near(w.player.squash, 0);
  assert.equal(w.events.filter(e => e.type === 'choiceReady').length, 1);
  assert.equal(w.totalShots, 0); assert.deepEqual(w.buffs, {});
});

test('v7.5 transition carries a long frame into choose without repeating its ready event', () => {
  const a = world(), b = world(); a.beginUpgrade(); b.beginUpgrade();
  a.step(1.23); b.step(1.2); b.step(.03);
  for (const w of [a, b]) {
    assert.equal(w.phase, 'choose'); near(w.phaseTime, .03);
    near(w.player.x, w.width / 2); near(w.player.y, w.choicePlayerY);
    assert.equal(w.events.filter(e => e.type === 'choiceReady').length, 1);
  }
  near(a.feedbackTime, b.feedbackTime); near(a.player.spin, b.player.spin);
});

test('v7.5 repeated resize during movement or settling does not replay old placement progress', () => {
  for (const age of [.1, .5, .95, 1.05, 1.199]) {
    const w = world(390, 844); w.gamblerRewardPending = true; w.beginUpgrade(); w.step(age);
    for (const [width, height] of [[844, 390], [320, 568]]) {
      const roll = w.rewardMoveProgress; w.resize(width, height);
      const mapped = {...w.player}; near(w.rewardMoveProgress, roll);
      w.step(1e-7);
      near(w.player.x, mapped.x, .001); near(w.player.y, mapped.y, .001);
      near(w.player.squash, mapped.squash, .001);
    }
    w.step(w.rewardTransitionEnd - w.phaseTime);
    assert.equal(w.phase, 'choose'); assert.equal(w.choices.length, 3); assert.equal(w.upgradeRoundTotal, 2);
    near(w.player.x, w.width / 2); near(w.player.y, w.choicePlayerY);
  }
});

test('v7.5 a last-frame resize gets a full settling interval at 30 and 60 fps without rewinding the roll', () => {
  for (const fps of [30, 60]) {
    const w = world(390, 844); w.gamblerRewardPending = true; w.beginUpgrade(); w.step(1.199);
    w.resize(844, 390); const start = {...w.player};
    const distance = Math.hypot(w.width / 2 - start.x, w.choicePlayerY - start.y);
    near(w.rewardTransitionEnd - w.phaseTime, .2);
    near(w.rewardMoveProgress, 1);
    const frames = Math.round(.2 * fps);
    for (let frame = 0; frame < frames; frame++) {
      const previous = {...w.player}; w.step(1 / fps);
      assert.ok(Math.hypot(w.player.x - previous.x, w.player.y - previous.y) <= distance * 2 / (.2 * fps) + 1e-7);
      if (frame < frames - 1) { assert.equal(w.phase, 'transition'); near(w.rewardMoveProgress, 1); }
    }
    assert.equal(w.phase, 'choose'); near(w.player.x, w.width / 2); near(w.player.y, w.choicePlayerY);
    assert.equal(w.events.filter(e => e.type === 'choiceReady').length, 1);
  }
});

test('v7.5 reward boundary spends the rest in reward and advances only the remaining battle time', () => {
  const w = world(); w.beginUpgrade(); w.step(w.rewardTiming.transition);
  w.choose(w.choices[0]); const start = w.feedbackTime;
  w.step(.63);
  assert.equal(w.phase, 'battle'); assert.equal(w.stage, 2);
  near(w.phaseTime, .03); near(w.elapsed, .03);
  near(w.events.find(e => e.type === 'stage').feedbackTime - start, .6);
  near(w.spawnTimer, 2 * w.spawnInterval - .03);
  assert.equal(w.events.filter(e => e.type === 'stage').length, 1);
});

test('v7.5 an opening reward still applies once, resets battle age and spawns the original floor', () => {
  const w = world(); w.beginStartingUpgrades(); w.step(20);
  assert.equal(w.phase, 'choose'); assert.equal(w.choices.length, 3);
  assert.ok(w.choices.every(c => c.pool === 'regular'));
  const selected = w.choices[0]; assert.ok(w.choose(selected)); assert.equal(w.choose(selected), false);
  w.step(.6); assert.equal(w.phase, 'battle'); assert.equal(w.stage, 1);
  near(w.time, 0); near(w.elapsed, 0); near(w.spawnTimer, 4);
  assert.equal(w.liveCount, 6); assert.equal(w.buffs[selected.id], 1);
  assert.equal(w.events.filter(e => e.type === 'buff').length, 1);
  assert.equal(w.rewardSelectionsRemaining, 0);
});

test('v7.5 the shortened Boss hold retains the full fade before three separate wagered Boss rewards', () => {
  const w = bossReward({gambler: true});
  w.step(celebrationDuration - .001); assert.equal(w.phase, 'boss-celebrate');
  assert.equal(w.choices.length, 0); near(w.player.roll, Math.PI * 2);
  const stopped = {...w.player}; w.step(.001);
  assert.equal(w.phase, 'transition'); near(w.phaseTime, 0);
  near(w.player.x, stopped.x); near(w.player.y, stopped.y);
  assert.equal(w.rewardSelectionsRemaining, 3); assert.equal(w.choices.length, 3);
  w.step(1.2); w.choose(w.choices[0]); assert.equal(w.arenaBlend, 0);
  w.step(.6); assert.equal(w.stage, 5); assert.equal(w.phase, 'transition'); near(w.phaseTime, 0);
  assert.equal(w.choices.length, 3); near(w.arenaBlend, 0);
  w.step(1.2); w.choose(w.choices[0]); w.step(.6);
  assert.equal(w.phase, 'transition'); assert.equal(w.stage, 5); assert.equal(w.rewardSelectionsRemaining, 1);
  assert.equal(w.choices.length, 3); near(w.arenaBlend, 0);
  w.step(1.2); w.choose(w.choices[0]); w.step(.6);
  assert.equal(w.phase, 'battle'); assert.equal(w.stage, 6);
  assert.equal(w.events.filter(e => e.type === 'buff').length, 3);
  assert.equal(w.events.filter(e => e.type === 'stage').length, 1);
});

test('late Boss rewards restore the arena continuously and still offer two real upgrades', () => {
  const w = bossReward({lateBuild: true}); w.step(celebrationDuration);
  assert.equal(w.phase, 'transition'); near(w.arenaBlend, 1); const before = w.arenaBounds;
  w.step(1e-6); near(w.arenaBounds.top, before.top, .001);
  w.step(.3 - 1e-6); assert.ok(w.arenaBlend > 0 && w.arenaBlend < 1);
  w.step(.9); assert.equal(w.phase, 'choose'); assert.equal(w.stage, 5); near(w.arenaBlend, 0);
  assert.equal(w.choices.length, 3); assert.ok(w.choices.some(c => c.kind === 'regular'));
  assert.ok(w.choose(w.choices[0])); w.step(.6);
  assert.equal(w.phase, 'transition'); assert.equal(w.stage, 5); near(w.arenaBlend, 0);
  w.step(1.2); assert.ok(w.choose(w.choices[0])); w.step(.6);
  assert.equal(w.phase, 'battle'); assert.equal(w.stage, 6); near(w.arenaBlend, 0);
  assert.equal(w.events.filter(e => e.type === 'upgradeSkipped').length, 0);
  assert.equal(w.events.filter(e => e.type === 'buff').length, 2);
  assert.equal(w.events.filter(e => e.type === 'stage').length, 1);
});

test('v7.5 growth feedback preserves the pre-upgrade radius for the visual join', () => {
  const w = world(); w.phase = 'choose'; const radius = w.player.r;
  w.choose(UPGRADES.growth);
  near(w.events.find(e => e.type === 'buff').playerRadiusBefore, radius);
  near(w.player.r, radius * 1.2);
});

test('v7.5 growth at the wall reports only its geometric correction for a smooth visual carry', () => {
  const w = world(); w.phase = 'choose'; const radius = w.player.r;
  Object.assign(w.player, {x: w.inset + radius, y: w.inset + radius, vx: 50, vy: 70});
  const before = {...w.player}; w.choose(UPGRADES.growth);
  const event = w.events.find(e => e.type === 'buff');
  near(w.player.x, w.inset + w.player.r); near(w.player.y, w.inset + w.player.r);
  near(w.player.x + event.playerGrowthOffset.x, before.x);
  near(w.player.y + event.playerGrowthOffset.y, before.y);
  near(w.player.vx, before.vx); near(w.player.vy, before.vy);
  assert.equal(w.events.filter(e => e.type === 'wall').length, 0);
});
