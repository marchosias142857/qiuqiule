import test from 'node:test';
import assert from 'node:assert/strict';
import {World, BREATH_DURATION} from '../dist/physics.js';

const near = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
function run(width = 1400, height = 1000) {
  const w = new World(width, height, () => .5, {spawnInitial: false});
  w.spawnTimer = w.floorTimer = Infinity; w.introTimer = Infinity; w.events = [];
  return w;
}
function enemy(w, x = 100, y = 100, values = {}) {
  const b = w.makeBody(x, y, w.unit * .8, .8);
  Object.assign(b, {born: 1, solid: true, hp: 10000, maxHp: 10000}, values);
  w.enemies.push(b); return b;
}
function field(w, count = 28) {
  for (let i = 0; i < count; i++) enemy(w, 80 + i % 7 * 160, 80 + Math.floor(i / 7) * 170);
}
function advance(w, seconds, timeScale = 1) {
  while (seconds > 1e-10) { const dt = Math.min(seconds, 1 / 120); w.step(dt * timeScale, false, {timeScale}); seconds -= dt; }
}
function finishClearing(w) {
  while (w.phase === 'battle' && w.pendingClearing || w.phase === 'clearing') w.step(1 / 120);
}

test('six opening enemies share a bounded safe cluster on mobile and desktop', () => {
  for (const [width, height] of [[390, 844], [844, 390], [1364, 936]]) {
    const w = new World(width, height, () => .5);
    assert.equal(w.enemies.length, 6); assert.equal(w.limit, 28); assert.equal(w.killTarget, 14);
    assert.equal(new Set(w.enemies.map(b => b.clusterId)).size, 1);
    for (const b of w.enemies) {
      assert.ok(Math.hypot(b.x - b.clusterX, b.y - b.clusterY) <= w.unit * 2.5);
      assert.ok(Math.hypot(b.x - w.player.x, b.y - w.player.y) > b.r + w.player.r);
      assert.ok(b.x >= w.inset + b.r && b.x <= width - w.inset - b.r);
      assert.ok(b.y >= w.inset + b.r && b.y <= height - w.inset - b.r);
      assert.equal(b.born, 0); assert.equal(b.solid, false); near(b.r / w.unit, .8);
    }
    near(w.spawnTimer, 4); near(w.score, 0); near(w.stageKills, 0);
  }
});

test('opening clusters never overlap across random radii and four viewport shapes', () => {
  for (const [width, height] of [[390, 844], [844, 390], [1364, 936], [320, 568]]) for (let seed = 1; seed <= 100; seed++) {
    let state = seed;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
    const w = new World(width, height, random);
    for (let i = 0; i < w.enemies.length; i++) for (let j = i + 1; j < w.enemies.length; j++) {
      const a = w.enemies[i], b = w.enemies[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r, `${width}x${height} seed ${seed}`);
    }
  }
});

test('stage formulas use rounded-up floors, bounded wave size and exponential health', () => {
  const w = run();
  for (const stage of [1, 2, 5, 10, 15, 20, 40]) {
    w.stage = stage; w.time = 91;
    assert.equal(w.floorCount, Math.ceil(Math.min(14, 6 + .5 * (stage - 1))));
    assert.equal(w.waveSize, Math.min(8, 4 + Math.floor((stage - 1) / 3)));
    near(w.spawnInterval, (.65 + 1.35 * .86 ** (stage - 1)) * ([3, 6, 8, 10, 12, 13, 16].includes(stage) ? 1.15 : 1));
    assert.equal(w.killTarget, 14 + 4 * (stage - 1));
    const profile = w.enemyProfile(); near(profile.hp, 19 * 1.20 ** (stage - 1) + 4);
    near(profile.density, .65 + .06 * stage + .0004 * 91); near(profile.radiusScale, .8);
  }
});

test('floor refill stays immediate but its 150 ms clock runs at two-thirds speed during breath', () => {
  for (const breath of [0, BREATH_DURATION]) {
    const w = run(); w.floorTimer = 0; w.breathTime = breath;
    const interval = breath ? .225 : .15;
    advance(w, .001); assert.equal(w.liveCount, 1);
    advance(w, interval - .002); assert.equal(w.liveCount, 1);
    advance(w, .001); assert.equal(w.liveCount, 2);
    advance(w, interval * 4); assert.equal(w.liveCount, 6);
    assert.equal(new Set(w.enemies.slice(0, 4).map(b => b.clusterId)).size, 1);
    near(w.stageKills, 0); near(w.score, 0);
  }
});

test('waves start size-times-interval apart, contain 300 ms slots, and preserve birth protection', () => {
  const w = run(); w.spawnTimer = 0; w.floorTimer = Infinity; w.introTimer = Infinity;
  const times = [], ids = []; const emit = w.emit;
  w.emit = function(type, data) { if (type === 'spawn') { times.push(this.time); ids.push(data.clusterId); } emit.call(this, type, data); };
  advance(w, .91); assert.equal(times.length, 4);
  times.slice(0, 4).forEach((time, i) => near(time, i * .3 + (i === 0 ? 1 / 120 : 0), 1 / 120 + 1e-8));
  assert.equal(new Set(ids).size, 1);
  assert.ok(w.enemies.at(-1).born < .03); assert.equal(w.enemies.at(-1).solid, false);
  advance(w, 7.1); assert.equal(times.length, 5); near(times[4], 8, 1 / 120 + 1e-8);
  assert.notEqual(ids[4], ids[0]);
});

test('full-field wave slots are discarded without a catch-up burst after making room', () => {
  const w = run(); field(w); w.spawnTimer = 0;
  // Exercise the actual scheduler without spending the separate real-time
  // pressure allowance. At capacity all four scheduled wave slots are consumed.
  for (let i = 0; i < 120; i++) w.advanceSpawning(1 / 120);
  assert.equal(w.wave, null); assert.equal(w.liveCount, 28); near(w.spawnTimer, 7);
  w.enemies.splice(0, 4); const before = w.liveCount;
  advance(w, .5); assert.equal(w.liveCount, before); assert.equal(w.events.filter(e => e.type === 'spawn').length, 0);
  near(w.spawnTimer, 6.5); near(w.overTimer, 0);
});

test('successful shots reset only their own combo and every actual player rebound banks the shot', () => {
  const w = run(); w.shoot(-w.maxPull, 0);
  for (let i = 0; i < 10; i++) w.damage(enemy(w, 100 + i * 80, 100, {hp: 1, value: 999}), 1);
  const kills = w.events.filter(e => e.type === 'kill');
  assert.deepEqual(kills.map(e => e.value), [10, 20, 45, 60, 75, 90, 105, 120, 120, 120]);
  assert.deepEqual(kills.map(e => e.combo), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); assert.equal(w.score, 765);
  assert.equal(w.shotKills, 10); assert.equal(w.stageKills, 10);
  assert.equal(w.shoot(1, 0), false); assert.equal(w.shotKills, 10);
  Object.assign(w.player, {x: 0, y: 700, vx: -1, vy: 0}); w.wall(w.player);
  assert.equal(w.shotBanked, true); assert.equal(w.bank, 0);
  w.damage(enemy(w, 900, 100, {hp: 1}), 1); assert.equal(w.events.filter(e => e.type === 'kill').at(-1).value, 180);
  w.shoot(-w.maxPull, 0); assert.equal(w.shotKills, 0); assert.equal(w.shotBanked, false); assert.equal(w.stageKills, 11);
  w.damage(enemy(w, 1000, 100, {hp: 1}), 1); assert.equal(w.events.filter(e => e.type === 'kill').at(-1).value, 10);
});

test('enemy walls and positional corrections cannot bank a player shot', () => {
  const w = run(), b = enemy(w, 0, 100, {vx: -300}); w.wall(b); assert.equal(w.shotBanked, false);
  Object.assign(w.player, {x: 0, y: 500, vx: 300, vy: 0}); w.wall(w.player); assert.equal(w.shotBanked, false);
  w.phase = 'choose'; Object.assign(w.player, {x: 0, vx: -300}); w.wall(w.player); assert.equal(w.shotBanked, false);
});

test('score alone cannot advance a stage and deferred real kills preserve the first quota origin', () => {
  const w = run(); w.score = 1e9; w.step(.1); assert.equal(w.phase, 'battle');
  w.stageKills = w.killTarget - 1;
  const first = enemy(w, 100, 200, {hp: 1}), second = enemy(w, 500, 200, {hp: 1});
  w.damage(first, 1); w.damage(second, 1);
  assert.equal(w.phase, 'battle'); assert.deepEqual(w.pendingClearing, {x: first.x, y: first.y});
  w.step(1 / 120); assert.equal(w.phase, 'transition'); assert.equal(w.stageKillCarry, 1);
  assert.equal(w.events.filter(e => e.type === 'clearingStart').length, 1);
  const start = w.events.find(e => e.type === 'clearingStart'); near(start.x, first.x); near(start.y, first.y);
  advance(w, w.rewardTiming.transition); w.choose(w.choices[0]); advance(w, w.rewardTiming.rest + .01);
  assert.equal(w.stage, 2); assert.equal(w.stageKills, 1); assert.equal(w.stageKillCarry, 0);
  assert.equal(w.killTarget, 18); assert.equal(w.liveCount, 7);
  near(w.spawnTimer, 2 * w.spawnInterval - .01, .02);
});

test('clearing expands in simulation time, ages in real time and cannot damage, shoot or spawn normally', () => {
  const w = run(); w.stageKills = 13; w.setFeedbackOptions({strength: .6});
  const victim = enemy(w, 200, 200, {hp: 1}), nearBody = enemy(w, 300, 200), farBody = enemy(w, 700, 200);
  w.damage(victim, 1); const kill = w.events.find(e => e.type === 'kill');
  w.step(.01 * .3, false, {timeScale: .3}); assert.equal(w.phase, 'clearing');
  near(w.clearing.elapsed, .01); near(w.clearing.radius, .003 * w.unit * 20);
  near(w.player.feedbackFreeze, kill.freezeDuration - .01);
  const pose = {x: w.player.x, y: w.player.y, vx: w.player.vx, vy: w.player.vy};
  assert.equal(w.shoot(100, 0), false); w.spawnEnemy(); assert.equal(w.liveCount, 2);
  w.damage(farBody, 1e9); assert.equal(farBody.hp, 10000);
  advance(w, .39, .3); near(w.clearing.elapsed, .4); near(w.clearing.radius, .12 * w.unit * 20);
  assert.equal(nearBody.hp, 0); assert.equal(farBody.hp, 10000); assert.equal(w.stageKills, 14); assert.equal(w.shotKills, 1);
  assert.deepEqual({x: w.player.x, y: w.player.y, vx: w.player.vx, vy: w.player.vy}, pose);
  finishClearing(w); assert.equal(w.phase, 'transition'); assert.equal(w.clearing, null);
  const clears = w.events.filter(e => e.type === 'clearKill');
  assert.deepEqual(clears.map(e => e.bodyId), [nearBody.id, farBody.id]);
  assert.deepEqual(clears.map(e => e.feedbackLevel), [2, 3]); assert.ok(clears.every(e => e.value === 10 && e.source === 'clear'));
  assert.equal(w.score, 30); assert.equal(w.events.filter(e => e.type === 'kill').length, 1);
  assert.equal(w.events.find(e => e.type === 'clearingEnd').count, 2);
});

test('an empty clear waits for the last real-time hit hold, including reduced motion', () => {
  for (const reducedMotion of [false, true]) {
    const w = run(); w.setFeedbackOptions({strength: 1, reducedMotion}); w.stageKills = 13;
    w.damage(enemy(w, 100, 100, {hp: 1}), 1); const duration = reducedMotion ? .05 : .08;
    advance(w, duration - .001, .3); assert.equal(w.phase, 'clearing');
    advance(w, .001, .3); assert.equal(w.phase, 'transition'); near(w.player.feedbackFreeze, 0);
    assert.equal(w.events.filter(e => e.type === 'clearingEnd').length, 1);
  }
});

test('clearing releases each contact deformation after its own hold without moving bodies or changing the wave', () => {
  for (const timeScale of [.3, 1]) {
    const w = run(); w.stageKills = 13; w.setFeedbackOptions({strength: .6});
    const victim = enemy(w, 400, 300, {hp: 1});
    const survivor = enemy(w, 1200, 800, {squash: .22, hit: .9, feedbackFreeze: .025, vx: -100, vy: 30});
    Object.assign(w.player, {x: victim.x - victim.r - w.player.r + .1, y: victim.y, vx: w.baseSpeed, vy: 0, hit: .6});
    w.collide(w.player, victim); assert.equal(w.phase, 'clearing');
    const player = {...w.player}, other = {...survivor}; near(player.feedbackFreeze, .048);
    advance(w, .02, timeScale);
    near(w.player.squash, player.squash); near(w.player.hit, player.hit);
    near(survivor.squash, other.squash); near(survivor.hit, other.hit);
    advance(w, .04, timeScale);
    near(w.player.squash, player.squash * Math.exp(-13 * .012 * timeScale));
    near(w.player.hit, player.hit - 5 * .012 * timeScale);
    near(survivor.squash, other.squash * Math.exp(-13 * .035 * timeScale));
    near(survivor.hit, other.hit - 5 * .035 * timeScale);
    for (const key of ['x', 'y', 'vx', 'vy']) { near(w.player[key], player[key]); near(survivor[key], other[key]); }
    near(w.clearing.elapsed, .06); near(w.clearing.radius, .06 * timeScale * w.unit * 20);
    assert.equal(w.events.filter(e => e.type === 'kill').length, 1);
    assert.equal(w.events.filter(e => e.type === 'clearKill').length, 0);
  }
});

test('resizing an active clear preserves its real age and completes without stale origins or effects', () => {
  const w = run(900, 700); w.stageKills = 13;
  w.damage(enemy(w, 100, 100, {hp: 1}), 1); enemy(w, 750, 550);
  advance(w, .05, .3); const old = {...w.clearing}, unit = w.unit;
  w.resize(390, 844);
  near(w.clearing.x, old.x * 390 / 900); near(w.clearing.y, old.y * 844 / 700);
  near(w.clearing.radius, old.radius * w.unit / unit); near(w.clearing.elapsed, old.elapsed);
  finishClearing(w); assert.equal(w.phase, 'transition'); assert.equal(w.clearing, null); assert.equal(w.pendingClearing, null);
  assert.equal(w.events.filter(e => e.type === 'clearingEnd').length, 1); assert.equal(w.events.filter(e => e.type === 'clearKill').length, 1);
  const fresh = run(); assert.equal(fresh.clearing, null); assert.equal(fresh.overTimer, 0); assert.equal(fresh.saveUsed, false);
});

test('full-field grace is real time, resets below capacity and leaves the first rescue unused after self-save', () => {
  const w = run(); field(w); advance(w, .79, .3);
  assert.equal(w.phase, 'battle'); near(w.overTimer, .79); assert.equal(w.saveUsed, false);
  w.damage(w.enemies[0], 1e6); advance(w, .01, .3); near(w.overTimer, 0); assert.equal(w.saveUsed, false); assert.equal(w.liveCount, 27);
  enemy(w, 1200, 700); advance(w, .79, .6); assert.equal(w.saveUsed, false);
  advance(w, .01, .6); assert.equal(w.saveUsed, true); assert.equal(w.liveCount, 25); assert.equal(w.phase, 'battle');
});

test('rescue removes the oldest three without points, kills or breath and is spent for the rest of the run', () => {
  const w = run(); field(w); w.buffs.breath = 1;
  const oldest = w.enemies.slice(0, 3).map(b => b.id); w.enemies.reverse();
  advance(w, .8, .3);
  assert.equal(w.phase, 'battle'); assert.equal(w.liveCount, 25); assert.equal(w.saveUsed, true); near(w.overTimer, 0);
  assert.equal(w.score, 0); assert.equal(w.stageKills, 0); assert.equal(w.shotKills, 0); near(w.breathTime, 0);
  assert.deepEqual(w.events.find(e => e.type === 'rescue').bodyIds, oldest);
  assert.equal(w.events.filter(e => e.type === 'shatter').length, 3); assert.equal(w.events.filter(e => e.type === 'kill').length, 0);
  for (let i = 0; i < 3; i++) enemy(w, 80 + i * 160, 80);
  advance(w, .799, .3); assert.equal(w.phase, 'battle'); advance(w, .001, .3);
  assert.equal(w.phase, 'over'); assert.equal(w.deathReason, 'capacity'); assert.equal(w.events.filter(e => e.type === 'rescue').length, 1);
  assert.equal(w.events.filter(e => e.type === 'over').length, 1);
});

test('high-stage reward fills its full rounded floor in small clusters and waits two intervals with teaching isolated', () => {
  const w = run(); w.typeIntroductions={ring:3,heavy:3,split:3,walker:3,leader:3,magnet:3,shield:3}; w.stage = 18; w.phase = 'reward'; w.phaseTime = w.rewardTiming.rest - .001;
  w.step(.001); assert.equal(w.stage, 19); assert.equal(w.liveCount, 14);
  const sizes = new Map(); for (const b of w.enemies) sizes.set(b.clusterId, (sizes.get(b.clusterId) || 0) + 1);
  assert.deepEqual([...sizes.values()], [8, 6]); near(w.spawnTimer, 2 * w.spawnInterval);
  assert.equal(w.events.filter(e => e.type === 'stage').length, 1);
});

test('shot attribution counts only recent battle shots and distinguishes actual hits from clear and rescue', () => {
  const w = run(); w.shoot(100, 0); w.shoot(100, 0); w.shoot(100, 0);
  assert.equal(w.resultMisses, 3); assert.equal(w.shotHistory.length, 3);
  w.damage(enemy(w), 1); assert.equal(w.resultMisses, 2); assert.equal(w.shotHistory.at(-1).hits, 1);
  assert.equal(w.shoot(1, 0), false); assert.equal(w.shotHistory.length, 3);
  w.phase = 'choose'; w.player.vx = w.player.vy = 0; w.shoot(100, 0);
  assert.equal(w.shotHistory.length, 3); w.phase = 'battle'; w.damage(w.enemies[0], 1);
  assert.equal(w.shotHistory.at(-1).hits, 1, 'a reward shot cannot rewrite an earlier battle shot');
  w.player.vx = w.player.vy = 0; advance(w, 20.01, .3);
  assert.equal(w.resultMisses, 0); assert.equal(w.shotHistory.length, 0);
});
