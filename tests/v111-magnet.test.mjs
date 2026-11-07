import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../dist/physics.js';
import {UPGRADES} from '../dist/upgrades.js';
import {createEndlessRun} from '../dist/endless-progress.js';
import {createRunSnapshot, restoreRunSnapshot} from '../dist/run-save.js';

const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function fresh(layers = 1, speed = 0) {
  const runDay = createEndlessRun('2026-11-07', 1110);
  const world = new World(10000, 10000, runDay.random, {spawnInitial: false});
  world.spawnTimer = world.floorTimer = world.introTimer = Infinity;
  Object.assign(world.player, {x: 4000, y: 4000, vx: speed * world.unit, vy: 0});
  for (let i = 0; i < layers; i++) assert.equal(world.applyUpgrade('magnet'), true);
  return {world, runDay};
}
function enemy(w, x, y, values = {}) {
  const body = w.makeBody(w.player.x + x * w.unit, w.player.y + y * w.unit, w.unit, 1.5);
  Object.assign(body, {enemyType: 'normal', hp: 100000, maxHp: 100000, born: 1, solid: true}, values);
  w.enemies.push(body); return body;
}
function kill(w, contact = {}) { return w.damage(enemy(w, 40, 40, {hp: 1}), 1, contact); }
function advance(w, seconds, scale = 1) {
  while (seconds > 1e-9) { const dt = Math.min(seconds, 1 / 240); w.step(dt, false, {timeScale: scale}); seconds -= dt; }
}
const pulls = w => [w.magnetPull, w.magnetPullSecond].filter(Boolean);
const snapshot = state => JSON.parse(JSON.stringify(createRunSnapshot(state)));

test('magnet keeps two layers and moves at most 3u or 6u over a quarter second without direct damage', () => {
  assert.deepEqual(UPGRADES.magnet.effect, {pullDuration: .25, pullDistance: 3});
  for (const layers of [1, 2]) {
    const {world: w} = fresh(layers), target = enemy(w, 10, 0), x = target.x, hp = target.hp;
    kill(w); const before = {...w.player};
    advance(w, .25);
    near(x - target.x, w.unit * layers * 3);
    near(target.hp, hp); near(target.vx, 0); near(target.vy, 0);
    near(w.player.x, before.x); near(w.player.y, before.y); near(w.player.vx, before.vx); near(w.player.vy, before.vy);
    assert.equal(pulls(w).length, 0); assert.equal(w.applyUpgrade('magnet'), layers === 1);
  }
});

test('a reachable forward near-miss outranks both a nearer rear enemy and an already guaranteed forward hit', () => {
  const {world: w} = fresh(1, 40);
  enemy(w, -2.5, 0); enemy(w, 3, 0); const target = enemy(w, 5, 3);
  kill(w); assert.equal(w.magnetPull.bodyId, target.id);
  const p = {...w.player}, before = {...target}; w.advanceMagnetPull(.05);
  near(target.x, before.x); assert.ok(target.y < before.y);
  near(w.player.x, p.x); near(w.player.y, p.y); near(w.player.vx, p.vx); near(w.player.vy, p.vy);
});

test('low speed and unreachable forward candidates fall back to the nearest enemy', () => {
  for (const speed of [0, 7, 40]) {
    const {world: w} = fresh(1, speed), nearest = enemy(w, -3, 0);
    enemy(w, 2, 6); kill(w); assert.equal(w.magnetPull.bodyId, nearest.id);
  }
});

test('successive kills keep two independent pulls without refresh, replacement, duplicates or a queued third pull', () => {
  const {world: w} = fresh(), first = enemy(w, -9, 0), second = enemy(w, 10, 0), third = enemy(w, 0, 12);
  kill(w); assert.equal(w.magnetPull.bodyId, first.id); w.advanceMagnetPull(.05);
  const original = w.magnetPull, before = {...original}; kill(w);
  assert.equal(w.magnetPull, original); assert.deepEqual(original, before); assert.equal(w.magnetPullSecond.bodyId, second.id);
  const other = w.magnetPullSecond, otherBefore = {...other}; kill(w);
  assert.equal(w.magnetPull, original); assert.equal(w.magnetPullSecond, other);
  assert.deepEqual(original, before); assert.deepEqual(other, otherBefore);
  w.advanceMagnetPull(.2);
  assert.equal(w.magnetPull, other); assert.equal(w.magnetPullSecond, null); near(other.remainingTime, .05);
  w.advanceMagnetPull(.05); assert.equal(pulls(w).length, 0, 'the third kill did not queue another effect');
  near(third.x, w.player.x); near(third.y, w.player.y + w.unit * 12);
});

test('each target honors its own local hit-stop while the other pull continues', () => {
  const {world: w} = fresh(), held = enemy(w, -9, 0), moving = enemy(w, 10, 0);
  kill(w); kill(w); held.feedbackFreeze = .04;
  const x = held.x, y = moving.x; advance(w, .02);
  near(held.x, x); near(w.magnetPull.remainingTime, .25);
  assert.ok(moving.x < y); near(w.magnetPullSecond.remainingTime, .23);
  advance(w, .03); assert.ok(held.x > x);
});

test('dead and non-solid targets free their own slots and the surviving second pull becomes the primary', () => {
  const {world: w} = fresh(), first = enemy(w, -9, 0), second = enemy(w, 10, 0);
  kill(w); kill(w); const surviving = w.magnetPullSecond; first.hp = 0;
  w.advanceMagnetPull(0); assert.equal(w.magnetPull, surviving); assert.equal(w.magnetPullSecond, null);
  second.solid = false; w.advanceMagnetPull(0); assert.equal(pulls(w).length, 0);
});

test('magnet cannot sweep a target through the player or accumulate blocked motion into a later burst', () => {
  const {world: w} = fresh(2, 40), target = enemy(w, .5, 5);
  kill(w); const pull = w.magnetPull, speed = pull.speed;
  w.advanceMagnetPull(.2);
  assert.ok(Math.hypot(target.x - w.player.x, target.y - w.player.y) >= w.player.r + target.r);
  Object.assign(w.player, {vx: -w.player.vx, vy: 0});
  const before = {...target}; w.advanceMagnetPull(.01);
  assert.ok(Math.hypot(target.x - before.x, target.y - before.y) <= speed * .01 + 1e-7);
  near(pull.speed, speed);
});

test('future route stops at the first wall and retargets safely after the actual bounce', () => {
  const {world: w} = fresh(2, 40), p = w.player, bounds = w.arenaBounds;
  p.x = bounds.right - p.r - w.unit;
  const target = enemy(w, 0, 5); kill(w);
  const lane = w.magnetLane(); near(lane.distance, w.unit);
  let aim = w.magnetAimPoint(target, lane);
  assert.ok(aim.x <= bounds.right - target.r && aim.x >= bounds.left + target.r);
  p.x = bounds.right - p.r + 1; w.wall(p); assert.ok(p.vx < 0);
  assert.ok(w.magnetLane().nx < 0);
  const before = {...target}; w.advanceMagnetPull(.01);
  assert.ok(Math.hypot(target.x - before.x, target.y - before.y) <= w.unit * 24 * .01 + 1e-7);
  assert.ok(target.x <= bounds.right - target.r && target.x >= bounds.left + target.r);
});

test('both distances and speeds scale on resize, while cleanup removes both pulls', () => {
  const {world: w} = fresh(2); enemy(w, -9, 0); enemy(w, 10, 0); kill(w); kill(w);
  w.advanceMagnetPull(.05); const before = pulls(w).map(p => ({...p})), oldUnit = w.unit;
  w.resize(300, 600); const scale = w.unit / oldUnit;
  for (const [i, pull] of pulls(w).entries()) {
    near(pull.remainingDistance, before[i].remainingDistance * scale);
    near(pull.speed, before[i].speed * scale); near(pull.remainingTime, before[i].remainingTime);
  }
  w.clearEnemies(); assert.equal(pulls(w).length, 0);
  enemy(w, -9, 0); enemy(w, 10, 0); kill(w); kill(w); assert.equal(pulls(w).length, 2);
  w.beginClearing(); assert.equal(pulls(w).length, 0);
});

test('two active pulls survive save/resume with identical future positions, timing, budget and random state', () => {
  const state = fresh(2), w = state.world; enemy(w, -9, 0); enemy(w, 10, 0); kill(w); kill(w); advance(w, .07);
  const saved = snapshot(state), resumed = restoreRunSnapshot(saved); assert.ok(resumed);
  assert.deepEqual(snapshot(resumed), saved); assert.equal(pulls(resumed.world).length, 2);
  advance(w, .3); advance(resumed.world, .3);
  assert.deepEqual(snapshot(resumed), snapshot(state));
});

test('legacy single-pull saves preserve their remaining budget and time and derive their old speed', () => {
  const state = fresh(), w = state.world; enemy(w, 10, 0); kill(w);
  w.magnetPull.remainingTime = .4; w.magnetPull.remainingDistance = w.unit * 2;
  const saved = snapshot(state), node = saved.data.nodes.find(node => node.t === 'world');
  node.v = node.v.filter(([key]) => key !== 'magnetPullSecond');
  const pullNode = saved.data.nodes[node.v.find(([key]) => key === 'magnetPull')[1].r];
  pullNode.v = pullNode.v.filter(([key]) => key !== 'speed');
  const restored = restoreRunSnapshot(saved); assert.ok(restored);
  assert.equal(restored.world.magnetPullSecond, null);
  near(restored.world.magnetPull.remainingTime, .4); near(restored.world.magnetPull.remainingDistance, w.unit * 2);
  near(restored.world.magnetPull.speed, w.unit * 5);
});

test('slow motion uses simulation time for both pulls and area/auxiliary kills still use the main player route', () => {
  const normal = fresh(), slow = fresh();
  for (const state of [normal, slow]) { enemy(state.world, -9, 0); enemy(state.world, 10, 0); kill(state.world); kill(state.world); }
  advance(normal.world, .1); advance(slow.world, .1, .3);
  for (let i = 0; i < 2; i++) {
    near(normal.world.enemies[i].x, slow.world.enemies[i].x);
    near(pulls(normal.world)[i].remainingTime, pulls(slow.world)[i].remainingTime);
  }
  for (const source of ['pulse', 'shockwave', 'collision']) {
    const {world: w} = fresh(1, 40), target = enemy(w, 5, 3); enemy(w, -3, 0);
    kill(w, {source, attacker: {isAuxiliary: true, x: w.player.x - w.unit * 20, y: w.player.y}});
    assert.equal(w.magnetPull.bodyId, target.id);
  }
});

test('actual high-speed physics gains side hits without altering damage or the pre-contact player path', () => {
  for (const speed of [40, 60]) {
    const base = fresh(0, speed), assisted = fresh(1, speed);
    const a = enemy(base.world, 6, 3), b = enemy(assisted.world, 6, 3);
    kill(base.world); kill(assisted.world);
    advance(base.world, .03); advance(assisted.world, .03);
    near(assisted.world.player.x, base.world.player.x); near(assisted.world.player.y, base.world.player.y);
    near(assisted.world.player.vx, base.world.player.vx); near(assisted.world.player.vy, base.world.player.vy);
    advance(base.world, .27); advance(assisted.world, .27);
    assert.equal(a.hp, 100000); assert.ok(b.hp < 100000, `${speed}u/s has a real contact`);
  }
});
