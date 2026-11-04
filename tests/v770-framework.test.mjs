import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, campaignBounds, levelConfig} from '../dist/campaign.js';
import {normalizeProgress, levelRecord, recordAttempt, recordResult, recordOffers,
  recordCheckpoint, recoverInterruptedAttempts, canSkip} from '../dist/campaign-progress.js';
import {normalizeSkins} from '../dist/skins.js';

const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const tick = (world, seconds) => { for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 1 / 120) world.step(Math.min(1 / 120, seconds - elapsed)); };
const openBoard = (level = 1) => {
  const world = new CampaignWorld(390, 844, level, () => .5);
  world.statics = []; world.zones = []; world.enemies = [];
  world.rules.isWon = () => false; world.rules.isLost = () => false;
  world.rules.onTick = () => {};
  world.rules.physics = {...world.rules.physics, actorDrag: 0, playerDrag: 0, settleSpeed: 0};
  world.shoot(0, world.maxPull); world.player.pendingVx = world.player.pendingVy = 0;
  Object.assign(world.player, {x: 190, y: 400, vx: 0, vy: 0, feedbackFreeze: 0});
  world.shotTime = 3.99;
  return world;
};
const finish = (state, outcome) => {
  state = recordAttempt(state, 1, {tutorialKey: 'wall'});
  return recordResult(state, 1, {outcome, attemptId: levelRecord(state, 1).activeAttempt});
};

test('all five retained classes have twenty successive ranks and no retired slot remains', () => {
  for (const type of ['wall', 'pool', 'merge', 'golf', 'peggle']) {
    const configs = Array.from({length: 100}, (_, i) => levelConfig(i + 1)).filter(config => config.type === type);
    assert.equal(configs.length, 20);
    assert.deepEqual(configs.map(config => config.rank20), Array.from({length: 20}, (_, i) => i));
  }
});

test('fast ordinary launch keeps its velocity at four seconds then brakes over the final 300ms', () => {
  const world = openBoard(); world.player.vy = world.unit * 8;
  world.step(.01); near(world.shotTime, 4); assert.equal(world.shotActive, true);
  near(world.player.vy, world.unit * 8); assert.equal(world.shotFinish.brakeAt, 5);
  tick(world, 1); near(world.player.vy, world.unit * 8);
  tick(world, .15); near(world.player.vy, world.unit * 4); assert.equal(world.shotActive, true);
  tick(world, .15); assert.equal(world.shotActive, false); near(world.player.vy, 0);
  const endings = world.events.filter(event => event.type === 'campaignLaunchEnd');
  assert.equal(endings.length, 1); assert.equal(endings[0].reason, 'timeout');
});

test('ordinary slower launch gets a brake rather than an unnecessary full second of waiting', () => {
  const world = openBoard(); world.player.vy = world.unit * 4;
  world.step(.01); assert.equal(world.shotFinish.brakeAt, 4); near(world.player.vy, world.unit * 4);
  tick(world, .15); near(world.player.vy, world.unit * 2);
  tick(world, .15); assert.equal(world.shotActive, false); near(world.shotTime, 4.3);
});

test('a fast pool target earns the extension even when the cue has stopped, and both settle together', () => {
  const world = openBoard(3), target = world.makeBody(100, 240, world.unit * .95, 1);
  Object.assign(target, {kind: 'pool-ball', hp: Infinity, active: true, born: 1, solid: true, drag: 0, vx: 0, vy: world.unit * 8});
  world.enemies = [target]; world.step(.01);
  assert.equal(world.shotFinish.brakeAt, 5); tick(world, 1.15);
  assert.equal(world.shotActive, true); near(Math.hypot(target.vx, target.vy), world.unit * 4);
  tick(world, .15); assert.equal(world.shotActive, false); near(target.vy, 0); near(world.player.vy, 0);
});

test('an explicit special round duration keeps its own ending contract', () => {
  const world = openBoard(); world.rules.physics.shotDuration = .2; world.shotTime = .19;
  world.player.vy = world.unit * 20; world.step(.01);
  assert.equal(world.shotActive, false); near(world.shotTime, .2); assert.equal(world.shotFinish, null);
});

test('ordinary modes share HUD clearance while merge keeps a centered square inside that frame', () => {
  for (const [width, height] of [[390, 844], [320, 568], [844, 390], [568, 320]]) {
    for (const level of [1, 3, 7, 9]) {
      const world = new CampaignWorld(width, height, level, () => .5);
      assert.deepEqual(world.arenaBounds, campaignBounds(world));
      const bounds = world.arenaBounds;
      assert.ok(world.player.y - world.player.r >= bounds.top - 1e-7);
    }
    const merge = new CampaignWorld(width, height, 5, () => .5), base = campaignBounds(merge), square = merge.arenaBounds;
    near(square.width, square.height); assert.ok(square.top >= base.top); assert.ok(square.bottom <= base.bottom);
  }
});

test('presentation slow motion follows the same strength contract for every retained mode', () => {
  for (const level of [1, 3, 5, 7, 9]) {
    const world = new CampaignWorld(390, 844, level, () => .5);
    world.setFeedbackOptions({strength: .6}); world.beginCampaignSlow({duration: .3, scale: .25});
    near(world.presentationTimeScale, .55);
    world.setFeedbackOptions({strength: .6, reducedMotion: true}); near(world.presentationTimeScale, 1);
  }
});

test('v2 migration archives old scores without inferring skipped wins, withdrawing unlocks or changing skins', () => {
  const previous = {version: 2, legacyCompleted: 10, completed: 10, unlocked: 31,
    levels: {'11': {attempts: 3, losses: 3, failStreak: 3, skipped: true},
      '20': {cleared: true, attempts: 2, wins: 1, rating: 3, bestScore: 700, firstClearTime: 37}}, tutorials: {peggle: true}};
  const skinsBefore = normalizeSkins({enabled: true, sides: 7, owned: [6, 7]}, previous.completed);
  const state = normalizeProgress(previous);
  assert.equal(state.version, 3); assert.equal(state.completed, 10); assert.equal(state.unlocked, 31);
  assert.equal(levelRecord(state, 11).cleared, false); assert.equal(levelRecord(state, 11).skipped, true);
  assert.equal(levelRecord(state, 11).failStreak, 3);
  assert.equal(levelRecord(state, 20).cleared, true); assert.equal(levelRecord(state, 20).historicalClear, true);
  assert.equal(levelRecord(state, 20).rating, 0); assert.equal(levelRecord(state, 20).bestScore, 0);
  assert.equal(state.legacyRecords[20].rating, 3); assert.equal(state.legacyRecords[20].bestScore, 700);
  assert.deepEqual(state.tutorials, {}); assert.deepEqual(normalizeProgress(state), state);
  assert.deepEqual(normalizeSkins(skinsBefore, state.completed), skinsBefore);
});

test('restart, leave and interruption preserve the exact offers; only genuine failure releases them', () => {
  let state = recordOffers(null, 1, ['rubber', 'energy']);
  state = finish(state, 'abandon');
  state = recordOffers(state, 1, ['bank', 'density']);
  assert.deepEqual(levelRecord(state, 1).offerChoices, ['rubber', 'energy']);
  state = recordAttempt(state, 1, {upgradeId: 'rubber'});
  state = recordCheckpoint(state, 1, {elapsed: 12.5, progress: .3, summary: '还差14砖'});
  state = recoverInterruptedAttempts(JSON.parse(JSON.stringify(state)));
  const record = levelRecord(state, 1);
  assert.equal(record.abandoned, 1); assert.equal(record.interrupted, 1); assert.equal(record.losses, 0);
  assert.equal(record.lastInterruptTime, 12.5); assert.equal(record.activeAttempt, null);
  assert.deepEqual(record.offerChoices, ['rubber', 'energy']);
  assert.deepEqual(recoverInterruptedAttempts(state), state);
  state = finish(state, 'loss'); assert.deepEqual(levelRecord(state, 1).offerChoices, []);
  state = recordOffers(state, 1, ['bank', 'density']);
  assert.deepEqual(levelRecord(state, 1).offerChoices, ['bank', 'density']);
});

test('retries retain tutorial and accumulated failures until a real first clear', () => {
  let state = finish(finish(null, 'loss'), 'loss');
  state = finish(state, 'abandon'); state = recordAttempt(state, 1);
  state = recoverInterruptedAttempts(state);
  assert.equal(levelRecord(state, 1).failStreak, 2); assert.equal(state.tutorials.wall, undefined);
  state = finish(state, 'loss'); assert.equal(canSkip(state, 1), true);
  state = finish(state, 'win'); assert.equal(state.tutorials.wall, true); assert.equal(levelRecord(state, 1).failStreak, 0);
});
