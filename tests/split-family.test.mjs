import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../dist/physics.js';
import {ENEMY_TYPES} from '../dist/enemies.js';

const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

function world() {
  const w = new World(8000, 5000, () => .7, {spawnInitial: false});
  w.stage = 26;
  w.spawnTimer = w.floorTimer = w.introTimer = Infinity;
  for (const type of Object.keys(ENEMY_TYPES)) w.typeIntroductions[type] = 3;
  Object.assign(w.player, {x: 7600, y: 4600, vx: 0, vy: 0});
  return w;
}

function spawn(w, type = 'normal') {
  const body = w.spawnEnemy(null, type);
  assert.ok(body, `${type} should have a free logical slot`);
  const index = body.id - 2;
  Object.assign(body, {x: 250 + index % 10 * 500,
    y: (type === 'split' ? 300 : 2100) + Math.floor(index / 10) * 350,
    born: 1, solid: true, vx: 0, vy: 0});
  return body;
}
function normals(w, count) { return Array.from({length: count}, () => spawn(w)); }
function kill(w, body) { w.damage(body, body.hp + 1); }
function children(w, familyId) {
  return w.enemies.filter(b => b.hp > 0 && b.enemyType === 'fragment'
    && (familyId === undefined || b.splitFamilyId === familyId));
}
function split(w, mother) { kill(w, mother); w.flushFragments(); return children(w, mother.id); }
function still(w) { for (const body of w.enemies) body.vx = body.vy = 0; }
function advanceReal(w, seconds, scale = 1) {
  let remaining = seconds;
  while (remaining > 1e-10) {
    const dt = Math.min(remaining, 1 / 120);
    w.step(dt * scale, false, {timeScale: scale});
    remaining -= dt;
  }
}

test('mother and three offspring share the mother body ID and one pressure slot throughout partial kills', () => {
  const w = world(), mother = spawn(w, 'split');
  assert.equal(mother.splitFamilyId, mother.id);
  assert.equal(w.liveCount, 1); assert.equal(w.pressureCount, 1);
  kill(w, mother);
  assert.equal(w.liveCount, 0); assert.equal(w.pressureCount, 1);
  assert.equal(w.fragmentQueue.length, 3);
  assert.ok(w.fragmentQueue.every(child => child.splitFamilyId === mother.id));
  w.flushFragments();
  const family = children(w, mother.id);
  assert.equal(family.length, 3);
  assert.equal(w.liveCount, 3); assert.equal(w.pressureCount, 1);
  kill(w, family[0]); assert.equal(w.liveCount, 2); assert.equal(w.pressureCount, 1);
  kill(w, family[1]); assert.equal(w.liveCount, 1); assert.equal(w.pressureCount, 1);
  kill(w, family[2]); assert.equal(w.liveCount, 0); assert.equal(w.pressureCount, 0);
});

test('pressure includes not-yet-solid mothers and queued families but excludes corpses, player and auxiliaries', () => {
  const w = world(), mother = spawn(w, 'split'), ordinary = spawn(w);
  mother.born = ordinary.born = 0; mother.solid = ordinary.solid = false;
  assert.equal(w.pressureCount, 2);
  const auxiliary = w.makeBody(7000, 4500, w.unit * .7, 1);
  Object.assign(auxiliary, {hp: Infinity, isPlayer: true, isAuxiliary: true});
  w.auxiliaries.push(auxiliary);
  kill(w, mother);
  assert.equal(w.pressureCount, 2, 'three queued children retain one family slot');
  kill(w, ordinary);
  assert.equal(w.liveCount, 0); assert.equal(w.pressureCount, 1);
});

test('separate families do not merge and killing one entire family releases only its slot', () => {
  const w = world(), a = spawn(w, 'split'), b = spawn(w, 'split');
  const first = split(w, a), second = split(w, b);
  assert.notEqual(a.splitFamilyId, b.splitFamilyId);
  assert.equal(first.length, 3); assert.equal(second.length, 3);
  assert.equal(w.liveCount, 6); assert.equal(w.pressureCount, 2);
  for (const child of first) kill(w, child);
  assert.equal(w.liveCount, 3); assert.equal(w.pressureCount, 1);
  assert.ok(second.every(child => child.hp > 0));
});

test('all 28 existing families may fully split into 84 real bodies without adding pressure slots', () => {
  const w = world(), mothers = Array.from({length: 28}, () => spawn(w, 'split'));
  assert.equal(w.pressureCount, 28);
  for (const mother of mothers) split(w, mother);
  assert.equal(w.fragmentQueue.length, 0);
  assert.equal(w.liveCount, 84);
  assert.equal(w.pressureCount, 28);
  assert.equal(new Set(children(w).map(b => b.splitFamilyId)).size, 28);
  for (const mother of mothers) assert.equal(children(w, mother.id).length, 3);
  assert.equal(w.spawnEnemy(null, 'normal'), undefined, 'a new pressure slot remains unavailable');
  assert.equal(w.spawnEnemy(null, 'split'), undefined);
});

test('a real population of 28 below logical capacity still admits planned waves and introductions', () => {
  const w = world(), mothers = Array.from({length: 10}, () => spawn(w, 'split'));
  for (const mother of mothers.slice(0, 9)) split(w, mother);
  assert.equal(w.liveCount, 28); assert.equal(w.pressureCount, 10);
  w.wave = {...w.makeCluster(1), types: ['normal'], timer: 0};
  w.advanceSpawning(.001);
  assert.equal(w.liveCount, 29); assert.equal(w.pressureCount, 11);
  w.typeIntroductions.ring = 0; w.introTimer = 0;
  w.advanceIntroduction(.001);
  assert.equal(w.liveCount, 30); assert.equal(w.pressureCount, 12);
  assert.ok(w.enemies.some(b => b.hp > 0 && b.enemyType === 'ring'));
});

test('floor refill uses actual bodies and fills only their real deficit', () => {
  const w = world(), mothers = Array.from({length: 6}, () => spawn(w, 'split'));
  for (const mother of mothers) split(w, mother);
  assert.equal(w.liveCount, 18); assert.equal(w.pressureCount, 6);
  assert.equal(w.floorCount, 14);
  w.floorTimer = 0;
  w.advanceSpawning(.3);
  assert.equal(w.liveCount, 18, 'low logical pressure must not overfill the physical floor');
  for (const body of children(w).slice(0, 5)) kill(w, body);
  assert.equal(w.liveCount, 13);
  w.floorTimer = 0;
  w.advanceSpawning(.001);
  assert.equal(w.liveCount, 14, 'one missing body produces one refill body');
});

test('a family with only its last queued child still admits that birth at pressure 28', () => {
  const w = world(), mother = spawn(w, 'split');
  normals(w, 27); kill(w, mother);
  const safe = w.safeSpawnPosition;
  let attempts = 0;
  w.safeSpawnPosition = function(...args) {
    if (args[3]?.localOnly && ++attempts > 2) return null;
    return safe.apply(this, args);
  };
  w.flushFragments();
  assert.equal(children(w, mother.id).length, 2);
  assert.equal(w.fragmentQueue.length, 1);
  for (const child of children(w, mother.id)) kill(w, child);
  assert.equal(w.liveCount, 27); assert.equal(w.pressureCount, 28);
  w.advancePressure(.4);
  // A failed local placement must not discard the last queued reservation.
  w.flushFragments();
  assert.equal(w.fragmentQueue.length, 1); assert.equal(w.pressureCount, 28);
  w.advancePressure(.1); near(w.overTimer, .5);
  w.safeSpawnPosition = safe;
  w.flushFragments();
  assert.equal(w.fragmentQueue.length, 0);
  assert.equal(children(w, mother.id).length, 1);
  assert.equal(w.liveCount, 28); assert.equal(w.pressureCount, 28);
  near(w.overTimer, .5, 1e-8);
});

test('partial child kills keep full-field pressure running and the last family death resets it', () => {
  const w = world(), mother = spawn(w, 'split');
  normals(w, 27);
  const family = split(w, mother);
  w.advancePressure(.3); near(w.overTimer, .3);
  kill(w, family[0]); w.advancePressure(.2);
  assert.equal(w.pressureCount, 28); near(w.overTimer, .5);
  kill(w, family[1]); w.advancePressure(.2);
  assert.equal(w.pressureCount, 28); near(w.overTimer, .7);
  kill(w, family[2]); w.advancePressure(.01);
  assert.equal(w.pressureCount, 27); near(w.overTimer, 0);
  assert.equal(w.saveUsed, false);
});

test('pressure grace and the spent-rescue loss remain exactly 0.8 real seconds at normal and aiming speeds', () => {
  for (const scale of [1, .3]) {
    const w = world(); normals(w, 28); still(w);
    advanceReal(w, .799, scale);
    assert.equal(w.phase, 'battle'); assert.equal(w.saveUsed, false); near(w.overTimer, .799);
    advanceReal(w, .001, scale);
    assert.equal(w.phase, 'battle'); assert.equal(w.saveUsed, true);
    assert.equal(w.pressureCount, 25); near(w.overTimer, 0);
    normals(w, 3); still(w);
    advanceReal(w, .799, scale);
    assert.equal(w.phase, 'battle'); near(w.overTimer, .799);
    advanceReal(w, .001, scale);
    assert.equal(w.phase, 'over'); assert.equal(w.deathReason, 'capacity');
    assert.equal(w.events.filter(e => e.type === 'rescue').length, 1);
  }
});

test('real bodies above 28 cannot trigger rescue or failure while logical pressure is below capacity', () => {
  const w = world(), mothers = Array.from({length: 10}, () => spawn(w, 'split'));
  for (const mother of mothers) split(w, mother);
  still(w);
  assert.equal(w.liveCount, 30); assert.equal(w.pressureCount, 10);
  advanceReal(w, 1, .3);
  assert.equal(w.phase, 'battle'); assert.equal(w.saveUsed, false); near(w.overTimer, 0);
});

test('rescue removes the oldest family by mother age plus two oldest ordinary bodies without scoring', () => {
  const w = world(), mother = spawn(w, 'split'), ordinary = normals(w, 27);
  const family = split(w, mother);
  assert.ok(family.every(child => child.id > ordinary[26].id), 'children have newer body IDs');
  const before = {score: w.score, kills: w.totalKills, stageKills: w.stageKills, shotKills: w.shotKills, breath: w.breathTime};
  w.events.length = 0;
  w.advancePressure(.8);
  assert.equal(w.saveUsed, true); assert.equal(w.pressureCount, 25);
  assert.equal(children(w, mother.id).length, 0);
  assert.ok(ordinary.slice(0, 2).every(body => body.hp <= 0));
  assert.ok(ordinary.slice(2).every(body => body.hp > 0));
  assert.equal(w.fragmentQueue.length, 0);
  assert.deepEqual({score: w.score, kills: w.totalKills, stageKills: w.stageKills, shotKills: w.shotKills, breath: w.breathTime}, before);
  assert.equal(w.events.filter(e => e.type === 'kill').length, 0);
  w.flushFragments();
  assert.equal(w.pressureCount, 25, 'a rescued family cannot return from a queue');
});

test('rescue removes queued-only old families and all pending siblings of a partially born family', () => {
  const w = world(), queued = spawn(w, 'split'), partial = spawn(w, 'split'), ordinary = normals(w, 26);
  kill(w, queued); kill(w, partial);
  const safe = w.safeSpawnPosition;
  let partialBirths = 0;
  w.safeSpawnPosition = function(...args) {
    if (args[3]?.localOnly) {
      const point = args[0];
      if (Math.hypot(point.x - queued.x, point.y - queued.y) < w.unit * 3) return null;
      if (++partialBirths > 1) return null;
    }
    return safe.apply(this, args);
  };
  w.flushFragments();
  assert.equal(children(w, queued.id).length, 0);
  assert.equal(children(w, partial.id).length, 1);
  assert.equal(w.fragmentQueue.length, 5);
  assert.equal(w.pressureCount, 28);
  w.advancePressure(.8);
  assert.equal(w.pressureCount, 25);
  assert.equal(w.fragmentQueue.length, 0);
  assert.equal(children(w).length, 0);
  assert.equal(ordinary[0].hp, 0);
  assert.ok(ordinary.slice(1).every(body => body.hp > 0));
  w.safeSpawnPosition = safe; w.flushFragments();
  assert.equal(w.liveCount, 25); assert.equal(w.pressureCount, 25);
});

test('clearing, reward and starting-upgrade transitions leave no family reservation behind', () => {
  for (const transition of ['clearEnemies', 'beginUpgrade', 'beginStartingUpgrades', 'beginClearing']) {
    const w = world(), a = spawn(w, 'split'), b = spawn(w, 'split');
    split(w, a); kill(w, b);
    assert.equal(w.pressureCount, 2); assert.equal(w.fragmentQueue.length, 3);
    if (transition === 'beginClearing') {
      w.pendingClearing = {x: a.x, y: a.y}; w.beginClearing();
      for (let tick = 0; tick < 600 && w.phase === 'clearing'; tick++) w.step(1 / 120);
    } else w[transition]();
    assert.equal(w.fragmentQueue.length, 0, transition);
    assert.equal(w.liveCount, 0, transition);
    assert.equal(w.pressureCount, 0, transition);
  }
});

test('mother and child kills still count and score as four individual bodies', () => {
  const w = world(), mother = spawn(w, 'split');
  w.shoot(-w.maxPull, 0);
  const family = split(w, mother);
  for (const child of family) kill(w, child);
  const kills = w.events.filter(e => e.type === 'kill');
  assert.equal(kills.length, 4);
  assert.deepEqual(kills.map(e => e.combo), [1, 2, 3, 4]);
  assert.equal(w.totalKills, 4); assert.equal(w.stageKills, 4); assert.equal(w.shotKills, 4);
  assert.equal(w.score, kills.reduce((total, event) => total + event.value, 0));
  assert.ok(w.score > ENEMY_TYPES.split.value);
  assert.equal(w.liveCount, 0); assert.equal(w.pressureCount, 0);
});
