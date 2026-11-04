import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../dist/physics.js';

function run() {
  const w = new World(4000, 4000, () => .5, {spawnInitial: false});
  w.stage = 20; w.spawnTimer = w.floorTimer = w.introTimer = Infinity;
  w.setFeedbackOptions({strength: 0}); return w;
}
function enemy(w, options = {}) {
  const b = w.makeBody(2000, 2000, w.unit * .8, .8);
  Object.assign(b, {enemyType: 'normal', born: 1, solid: true, hp: 1, maxHp: 1}, options);
  w.enemies.push(b); return b;
}
const awards = w => w.events.filter(e => e.type === 'kill').map(e => e.value);

test('v7.4 third-kill bonus persists beyond the ordinary and frenzy caps and only real new shots reset it', () => {
  for (const frenzy of [false, true]) {
    const w = run(); if (frenzy) w.applyUpgrade('frenzy');
    assert.equal(w.shoot(-w.maxPull, 0), true);
    for (let i = 0; i < 13; i++) w.damage(enemy(w), 1);
    const expected = frenzy ? [10,20,45,60,75,90,105,120,135,150,165,180,180]
      : [10,20,45,60,75,90,105,120,120,120,120,120,120];
    assert.deepEqual(awards(w), expected);
    assert.equal(w.score, expected.reduce((a,b) => a+b, 0));
    assert.equal(w.shotKills, 13); assert.equal(w.totalKills, 13); assert.equal(w.stageKills, 13);
    assert.equal(w.shoot(1, 0), false); assert.equal(w.shotKills, 13);
    w.damage(enemy(w), 1); assert.equal(awards(w).at(-1), frenzy ? 180 : 120);
    assert.equal(w.shoot(-w.maxPull, 0), true); w.damage(enemy(w), 1);
    assert.equal(awards(w).at(-1), 10); assert.equal(w.shotKills, 1); assert.equal(w.stageKills, 15);
  }
});

test('v7.4 variant base, bank, third-kill and risk bonuses multiply before a single rounding step', () => {
  const w = run(); w.applyUpgrade('risk'); w.applyUpgrade('risk'); w.shoot(-w.maxPull, 0);
  Object.assign(w.player, {x: 0, vx: -w.baseSpeed, vy: 0}); w.wall(w.player);
  assert.equal(w.shotBanked, true);
  w.damage(enemy(w), 1); w.damage(enemy(w), 1); w.damage(enemy(w, {enemyType: 'fragment'}), 1);
  // Third fragment: 5 * 3 * 1.5(chain) * 1.5(bank) * 2.25(risk) = 75.9375.
  assert.deepEqual(awards(w), [34, 68, 76]); assert.equal(w.score, 178);
  const ring = run(); ring.shoot(-ring.maxPull, 0);
  ring.damage(enemy(ring), 1); ring.damage(enemy(ring), 1); ring.damage(enemy(ring, {enemyType: 'ring'}), 1);
  assert.deepEqual(awards(ring), [10, 20, 68]);
});

test('v7.4 a real impact and its two collateral pulse kills share the third-kill reward', () => {
  const w = run(); w.applyUpgrade('pulse'); w.shoot(-w.maxPull, 0);
  const first = enemy(w), second = enemy(w, {y: 2000 + w.unit * 2}), third = enemy(w, {y: 2000 - w.unit * 2});
  Object.assign(w.player, {x: first.x - first.r - w.player.r + .01, y: first.y, vx: w.baseSpeed, vy: 0});
  w.collide(w.player, first);
  assert.deepEqual(awards(w), [10, 20, 45]); assert.equal(w.score, 75);
  assert.ok(first.hp <= 0 && second.hp <= 0 && third.hp <= 0);
  assert.deepEqual(w.events.filter(e => e.type === 'kill').map(e => e.combo), [1, 2, 3]);
});

test('v7.4 split-ball impact and auxiliary shockwave share their parent shot counter', () => {
  const w = run(); w.applyUpgrade('split'); w.applyUpgrade('shockwave'); w.shoot(-w.maxPull, 0);
  w.damage(enemy(w), 1, {attacker: w.player}); const child = w.auxiliaries[0]; assert.ok(child);
  const second = enemy(w, {x: 2500, y: 2500});
  Object.assign(child, {x: second.x - second.r - child.r + .01, y: second.y, vx: w.baseSpeed * .6, vy: 0});
  w.collide(child, second); assert.ok(second.hp <= 0);
  const third = enemy(w, {x: child.x, y: child.y + w.unit * 2}); w.releaseShockwave(child);
  assert.ok(third.hp <= 0); assert.deepEqual(awards(w), [10, 20, 45]); assert.equal(w.shotKills, 3);
});

test('v7.4 shield breaks, surviving hits and repeated dead-body damage do not advance the reward counter', () => {
  const w = run(); w.shoot(-w.maxPull, 0);
  const first = enemy(w); w.damage(first, 1); w.damage(first, 999);
  const shield = enemy(w, {shield: true, hp: 2, maxHp: 2}); w.damage(shield, 999); w.damage(shield, 1);
  assert.equal(w.shotKills, 1); assert.deepEqual(awards(w), [10]);
  w.damage(shield, 1); w.damage(enemy(w), 1); assert.deepEqual(awards(w), [10, 20, 45]);
});

test('v7.4 quota-ending third kill earns its bonus while automatic clear awards stay flat', () => {
  const w = run(); w.stage = 1; w.stageKills = w.killTarget - 3; w.shoot(-w.maxPull, 0);
  w.damage(enemy(w), 1); w.damage(enemy(w), 1); w.damage(enemy(w), 1);
  const survivor = enemy(w, {x: 2010, hp: 999, maxHp: 999});
  for (let i = 0; i < 120 && w.phase !== 'transition'; i++) w.step(1 / 120);
  assert.equal(w.phase, 'transition'); assert.ok(survivor.hp <= 0);
  assert.deepEqual(awards(w), [10, 20, 45]);
  assert.deepEqual(w.events.filter(e => e.type === 'clearKill').map(e => e.value), [10]);
  assert.equal(w.score, 85); assert.equal(w.shotKills, 3); assert.equal(w.totalKills, 3);
});

test('v7.4 shared World scoring preserves campaign kill values', () => {
  const w = run(); w.mode = 'campaign';
  for (let i = 0; i < 4; i++) w.damage(enemy(w), 1);
  assert.deepEqual(awards(w), [10, 20, 30, 40]); assert.equal(w.score, 100);
});
