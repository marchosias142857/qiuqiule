import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {World, length, BOSS_TIMING} from '../dist/physics.js';

const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function run() {
  const w = new World(10000, 10000, () => .5, {spawnInitial: false});
  w.spawnTimer = w.floorTimer = w.introTimer = Infinity;
  return w;
}
function target(w, values = {}) {
  const b = w.makeBody(5000, 5000, w.unit, 1.5);
  Object.assign(b, {hp: 1, maxHp: 10000, born: 1, solid: true, enemyType: 'normal'}, values);
  w.enemies.push(b); return b;
}
function contact(w, b, {speed = w.unit * 30, offset = 0, actor = w.player} = {}) {
  Object.assign(actor, {x: b.x - b.r - actor.r + 1, y: b.y - offset, vx: speed, vy: 0});
  w.collide(actor, b); return speed;
}
function upgrade(w, id, layers) {
  for (let i = 0; i < layers; i++) assert.equal(w.applyUpgrade(id), true);
}

test('v7 lethal contacts retain more speed without changing solved direction or incoming hit damage', () => {
  for (const offset of [0, 8]) {
    const killed = run(), surviving = run(), a = target(killed), b = target(surviving, {hp: 10000});
    const speed = contact(killed, a, {offset}); contact(surviving, b, {offset});
    assert.ok(a.hp <= 0); assert.ok(b.hp > 0);
    near(length(killed.player), speed * .85);
    near(length(surviving.player), speed * .70);
    near(killed.player.vx / length(killed.player), surviving.player.vx / length(surviving.player));
    near(killed.player.vy / length(killed.player), surviving.player.vy / length(surviving.player));
    near(a.vx, b.vx); near(a.vy, b.vy);
    const lethalHit = killed.events.find(e => e.type === 'hit');
    const ordinaryHit = surviving.events.find(e => e.type === 'hit');
    assert.equal(lethalHit.damage, ordinaryHit.damage);
    near(lethalHit.impactSpeed, speed); assert.equal(lethalHit.lethal, true);
  }
});

test('v7 lethal rubber floor preserves four-point layers and cannot manufacture energy', () => {
  for (const [layers, lethalFloor] of [[0, .85], [1, .89], [2, .93], [3, .97], [4, 1]]) {
    const w = run(); upgrade(w, 'rubber', layers);
    const speed = contact(w, target(w)); near(length(w.player), speed * lethalFloor);
    const other = run(); upgrade(other, 'rubber', layers);
    contact(other, target(other, {hp: 10000})); near(length(other.player), speed * Math.min(1, .70 + .08 * layers));
  }
});

test('v7 quota-ending direct hit receives lethal retention before entering clearing', () => {
  const w = run(); w.stageKills = w.killTarget - 1;
  const b = target(w), speed = contact(w, b);
  assert.equal(w.phase, 'clearing'); assert.equal(w.stageKills, w.killTarget);
  near(length(w.player), speed * .85);
  const hit = w.events.find(e => e.type === 'hit');
  assert.equal(hit.lethal, true); near(hit.impactSpeed, speed);
  assert.equal(w.events.filter(e => e.type === 'clearingStart').length, 1);
});

test('v7 lethal floor preserves stronger ring and pierce contracts and existing physical impulse', () => {
  const ring = run(), ringSpeed = contact(ring, target(ring, {enemyType: 'ring'}));
  near(length(ring.player), ringSpeed * .98);
  const pierce = run(); upgrade(pierce, 'pierce', 1);
  const pierceSpeed = contact(pierce, target(pierce), {offset: 8});
  near(length(pierce.player), pierceSpeed * .92); near(pierce.player.vy, 0);
  const killed = run(), surviving = run();
  contact(killed, target(killed, {vx: -3000}));
  contact(surviving, target(surviving, {vx: -3000, hp: 10000}));
  assert.ok(length(killed.player) > killed.unit * 30);
  near(killed.player.vx, surviving.player.vx); near(killed.player.vy, surviving.player.vy);
});

test('v7 shield absorption never receives lethal retention, even when blocked damage exceeds HP', () => {
  const w = run(), b = target(w, {shield: true, enemyType: 'shield'});
  const speed = contact(w, b);
  assert.equal(b.hp, 1); assert.equal(b.shield, false); assert.equal(w.totalKills, 0);
  near(length(w.player), speed * .70);
  assert.equal(w.events.filter(e => e.type === 'shieldBreak').length, 1);
  assert.equal(w.events.filter(e => e.type === 'kill').length, 0);
});

test('v7 direct kill retention applies to auxiliaries without changing their damage reference', () => {
  const w = run(), b = target(w), a = w.makeBody(0, 0, .7 * w.unit, w.player.density);
  Object.assign(a, {isPlayer: true, isAuxiliary: true, sourceMass: w.player.mass, hp: Infinity, born: 1, solid: true});
  w.auxiliaries.push(a);
  const speed = contact(w, b, {speed: w.unit * 18, actor: a});
  near(length(a), speed * .85); assert.ok(b.hp <= 0);
  const hit = w.events.find(e => e.type === 'hit');
  assert.equal(hit.auxiliary, true); near(hit.impactSpeed, speed);
});

test('v7 density layers increase impact mass without slowing any endless release phase', () => {
  for (const phase of ['battle', 'boss-entry', 'boss', 'choose']) for (const layers of [1, 2, 5]) {
    const plain = run(), heavy = run();
    upgrade(heavy, 'density', layers);
    for (const w of [plain, heavy]) { w.phase = phase; w.player.vx = w.player.vy = 0; assert.ok(w.shoot(-w.maxPull * .6, 0)); }
    near(length(heavy.player), length(plain.player));
    near(heavy.player.mass / plain.player.mass, 1.35 ** layers);
  }
  const plain = run(), heavy = run(); upgrade(heavy, 'density', 2);
  const a = target(plain, {hp: 10000}), b = target(heavy, {hp: 10000});
  plain.shoot(-plain.maxPull, 0); heavy.shoot(-heavy.maxPull, 0);
  contact(plain, a, {speed: length(plain.player)}); contact(heavy, b, {speed: length(heavy.player)});
  assert.ok(10000 - b.hp > 10000 - a.hp);
});

test('v7 full-pull reference and shockwave agree with actual density-enhanced kinetic damage', () => {
  for (const layers of [0, 2, 5]) {
    const w = run(); upgrade(w, 'density', layers); upgrade(w, 'energy', 2);
    const direct = target(w, {hp: 10000});
    assert.ok(w.shoot(-w.maxPull, 0));
    const reference = w.fullPullDamage(direct), speed = length(w.player);
    contact(w, direct, {speed});
    assert.equal(10000 - direct.hp, Math.max(1, Math.round(reference)));
    const nearby = target(w, {x: w.player.x, y: w.player.y + w.unit, hp: 10000});
    const expected = Math.max(1, Math.round(w.fullPullDamage(nearby) * .75));
    w.releaseShockwave(); assert.equal(10000 - nearby.hp, expected);
  }
});

test('v7 Boss shell shockwave uses the same density-independent launch as a direct reference hit', () => {
  const make = () => {
    const w = new World(390, 844, () => .5, {spawnInitial: false});
    upgrade(w, 'density', 2); w.stage = 5; w.beginBoss(); w.step(BOSS_TIMING.entry);
    return w;
  };
  const wave = make(), direct = make();
  Object.assign(wave.player, {x: wave.boss.x, y: wave.boss.y + wave.boss.r + wave.player.r});
  const before = wave.boss.r;
  direct.damageBoss(direct.baseSpeed * Math.sqrt(.75), {source: 'shockwave', preserveBank: true});
  wave.releaseShockwave();
  assert.ok(wave.boss.r < before); near(wave.boss.r, direct.boss.r);
});

test('v7 endless redirection keeps speed over repeated turns without repeated acceleration', () => {
  for (const boomerang of [false, true]) {
    const w = run(); w.player.vx = w.baseSpeed * 2 * (boomerang ? 1.3 : 1);
    if (boomerang) w.player.boomerangTime = .8;
    const speed = length(w.player);
    for (let i = 0; i < 50; i++) {
      const angle = i * .23;
      assert.ok(w.shoot(Math.cos(angle) * w.maxPull * .3, Math.sin(angle) * w.maxPull * .3));
      near(length(w.player), speed);
    }
  }
});

test('v7 preserves v6.9 seeded opening and stage-refill geometry and random consumption', () => {
  // Golden trace taken from the unmodified v6.9.0 checkout. HP is deliberately
  // excluded: only its curve is in scope, while spawn positions and RNG are not.
  let state, draws;
  const random = () => { draws++; state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const captures = [];
  for (const size of [[390, 844], [844, 390], [320, 568]]) for (const seed of [1, 17, 845]) {
    state = seed; draws = 0; const w = new World(...size, random);
    for (const stage of [1, 2, 8, 16]) {
      if (stage !== 1) { w.enemies = []; w.floorCluster = null; w.stage = stage; w.fillFloor(); }
      captures.push({size, seed, stage, draws, state, spawnTimer: w.spawnTimer, floorTimer: w.floorTimer,
        bodies: w.enemies.map(b => ({id: b.id, x: b.x, y: b.y, r: b.r, clusterId: b.clusterId,
          clusterX: b.clusterX, clusterY: b.clusterY, type: b.enemyType, born: b.born, solid: b.solid}))});
    }
  }
  assert.equal(createHash('sha256').update(JSON.stringify(captures)).digest('hex'),
    '12b7f0bd0f3ba2481c6f4921734659ae87a2b9cfc9fea156e2c2103713c86c29');
});
