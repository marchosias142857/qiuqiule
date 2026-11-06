import test from 'node:test';
import assert from 'node:assert/strict';
import {World, length} from '../dist/physics.js';
import {ENEMY_TYPES, enemyTypeLimit} from '../dist/enemies.js';

const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function world(stage = 20) {
  const w = new World(1400, 1000, () => .5, {spawnInitial: false}); w.stage = stage;
  w.spawnTimer = w.floorTimer = w.introTimer = Infinity;
  return w;
}
function spawn(w, type = 'normal', values = {}) {
  const b = w.spawnEnemy(null, type); assert.ok(b, `spawn ${type}`);
  Object.assign(b, {born: 1, solid: true, vx: 0, vy: 0}, values); return b;
}
function advance(w, seconds) {
  while (seconds > 1e-10) { const dt = Math.min(seconds, 1 / 120); w.step(dt); seconds -= dt; }
}
function hit(w, b, speed = w.baseSpeed) {
  Object.assign(w.player, {x: b.x - b.r - w.player.r + .1, y: b.y, vx: speed, vy: 0});
  w.collide(w.player, b);
}
const typeCount = w => new Set(w.enemies.filter(b => b.hp > 0).map(b => b.enemyType === 'fragment' ? 'normal' : b.enemyType || 'normal')).size;

test('variant profiles apply independent health, geometry, mass and movement while no-arg spawning stays normal', () => {
  for (const type of Object.keys(ENEMY_TYPES)) {
    const w = world(), base = w.enemyProfile(), b = w.spawnEnemy(null, type), definition = ENEMY_TYPES[type];
    near(b.r / w.unit, definition.radius ?? base.radiusScale * definition.radiusMultiplier);
    near(b.hp, base.hp * definition.hpMultiplier); near(b.maxHp, b.hp);
    near(b.density, base.density * definition.densityMultiplier);
    near(b.mass, b.density * (b.r / w.unit) ** 2 * definition.massScale);
    near(length(b), w.unit * (definition.moveSpeed || definition.driftSpeed));
    assert.equal(b.enemyType, type); assert.equal(b.shield, definition.shield);
  }
  const w = world(); assert.equal(w.spawnEnemy().enemyType, 'normal');
});

test('rings return almost all player speed while their half-mass body follows the elastic solve', () => {
  const w = world(3), b = spawn(w, 'ring', {x: 500, y: 300, hp: 10000});
  const p = w.player, incoming = 700, playerMass = p.mass;
  hit(w, b, incoming);
  near(length(p), incoming * .98); assert.ok(p.vx > 0);
  near(b.vx, 2 * incoming / (1 / playerMass + 1 / b.mass) / b.mass);
  assert.equal(w.shotBanked, false);
});

test('heavy collisions bank this shot and charge only the next damage hit; heavy drag stays three per second', () => {
  const w = world(6), heavy = spawn(w, 'heavy', {x: 500, y: 300, hp: 10000}); w.buffs.bank = 1;
  const incoming = 700, reduced = 1 / (1 / w.player.mass + 1 / heavy.mass);
  hit(w, heavy, incoming); assert.equal(w.shotBanked, true); assert.equal(w.bank, 1);
  const first = w.events.find(e => e.type === 'hit');
  assert.equal(first.damage, Math.max(1, Math.round(.5 * reduced * (incoming / w.unit) ** 2 * .31)));
  const normal = spawn(w, 'normal', {x: 700, y: 300, hp: 10000});
  const normalReduced = 1 / (1 / w.player.mass + 1 / normal.mass); hit(w, normal, incoming);
  assert.equal(w.events.filter(e => e.type === 'hit').at(-1).damage, Math.round(.5 * normalReduced * (incoming / w.unit) ** 2 * .31 * 1.6));
  assert.equal(w.bank, 0);
  const isolated = world(6), b = spawn(isolated, 'heavy', {x: 100, y: 100, vx: 100});
  advance(isolated, .1); near(b.vx, 100 * Math.exp(-3 * .1));
});

test('split children use mother maximum health, outward speed, one queue and the hard capacity', () => {
  const w = world(8), mother = spawn(w, 'split', {x: 500, y: 300});
  for (let i = 0; i < 27; i++) spawn(w, 'normal', {x: 80 + i % 7 * 170, y: 80 + Math.floor(i / 7) * 190});
  const hp = mother.maxHp; w.damage(mother, 1e9); assert.equal(w.fragmentQueue.length, 3);
  w.flushFragments(); assert.equal(w.liveCount, 28); assert.equal(w.fragmentQueue.length, 2);
  let children = w.enemies.filter(b => b.enemyType === 'fragment'); assert.equal(children.length, 1);
  near(children[0].maxHp, hp * .3); near(children[0].r, w.unit * .6); near(length(children[0]), w.unit * 6);
  const victims = w.enemies.filter(b => b.hp > 0 && b.enemyType === 'normal').slice(0, 2);
  victims.forEach(b => w.damage(b, 1e9)); w.flushFragments();
  children = w.enemies.filter(b => b.enemyType === 'fragment'); assert.equal(children.length, 3); assert.equal(w.fragmentQueue.length, 0); assert.equal(w.liveCount, 28);
  children.forEach(b => { near(b.hp, hp * .3); near(length(b), w.unit * 6); });
  w.damage(children[0], 1e9); assert.equal(w.fragmentQueue.length, 0, 'fragments cannot recursively split');
  assert.equal(w.events.filter(e => e.type === 'firstTypeKill' && e.enemyType === 'split').length, 1);
  assert.equal(w.events.filter(e => e.type === 'firstTypeKill' && e.enemyType === 'fragment').length, 0);
});

test('a player touching the split victim never sends a child to a distant spawn cluster', () => {
  for (const [width, height] of [[390, 844], [1364, 936]]) for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const w = new World(width, height, () => .5, {spawnInitial: false}); w.stage = 8;
    w.spawnTimer = w.floorTimer = w.introTimer = Infinity;
    const mother = spawn(w, 'split', {x: width * .6, y: height * .45});
    const nx = Math.cos(angle), ny = Math.sin(angle), distance = mother.r + w.player.r - .1;
    Object.assign(w.player, {x: mother.x - nx * distance, y: mother.y - ny * distance, vx: nx * w.baseSpeed, vy: ny * w.baseSpeed});
    const hp = mother.maxHp, density = mother.density;
    w.collide(w.player, mother); const event = w.events.find(e => e.type === 'kill'); assert.ok(event);
    const children = w.enemies.filter(b => b.enemyType === 'fragment'); assert.equal(children.length, 3); assert.equal(w.fragmentQueue.length, 0);
    for (const child of children) {
      const dx = child.x - event.x, dy = child.y - event.y, radius = Math.hypot(dx, dy);
      assert.ok(radius <= 2.5 * w.unit + 1e-7); assert.ok(radius > 0);
      near(child.vx, dx / radius * w.unit * 6); near(child.vy, dy / radius * w.unit * 6);
      near(child.maxHp, hp * .3); near(child.density, density);
      assert.ok(Math.hypot(child.x - w.player.x, child.y - w.player.y) >= child.r + w.player.r);
    }
  }
});

test('a crowded split point queues children locally until space clears', () => {
  const w = world(8), mother = spawn(w, 'split', {x: 500, y: 400});
  const blocker = spawn(w, 'normal', {x: mother.x, y: mother.y, r: w.unit * 3.2, hp: 10000});
  const hp = mother.maxHp; w.damage(mother, 1e9); w.flushFragments();
  assert.equal(w.fragmentQueue.length, 3); assert.equal(w.enemies.filter(b => b.enemyType === 'fragment').length, 0);
  const captured = w.fragmentQueue.map(child => ({x: child.x, y: child.y, maxHp: child.maxHp, density: child.density}));
  w.stage = 10; w.time = 200; w.flushFragments();
  assert.deepEqual(w.fragmentQueue.map(child => ({x: child.x, y: child.y, maxHp: child.maxHp, density: child.density})), captured);
  blocker.x = 1100; blocker.y = 800; w.flushFragments();
  const children = w.enemies.filter(b => b.enemyType === 'fragment'); assert.equal(children.length, 3); assert.equal(w.fragmentQueue.length, 0);
  for (const child of children) { assert.ok(Math.hypot(child.x - mother.x, child.y - mother.y) <= w.unit * 2.5); near(child.maxHp, hp * .3); }
});

test('clearing wins over queued children, and clear or rescue never triggers special death effects', () => {
  const w = world(8); w.stageKills = w.killTarget - 2;
  const mother = spawn(w, 'split', {x: 300, y: 300}), final = spawn(w, 'normal', {x: 400, y: 300});
  w.damage(mother, 1e9); assert.equal(w.fragmentQueue.length, 3); w.damage(final, 1e9);
  w.step(.001); assert.equal(w.fragmentQueue.length, 0); assert.equal(w.enemies.filter(b => b.enemyType === 'fragment').length, 0);
  const clear = world(16); clear.stageKills = clear.killTarget;
  const special = ['split', 'magnet', 'leader'].map((type, i) => spawn(clear, type, {x: 300 + i * 30, y: 300}));
  clear.pendingClearing = {x: 300, y: 300}; advance(clear, .3);
  assert.equal(clear.fragmentQueue.length, 0); assert.equal(clear.seenEnemyKills.size, 0);
  assert.equal(clear.events.filter(e => e.type === 'clearKill').length, 3); assert.equal(clear.events.filter(e => e.type === 'firstTypeKill').length, 0);
  const rescue = world(); ['split', 'magnet', 'leader'].forEach(type => spawn(rescue, type));
  for (let i = 0; i < 25; i++) spawn(rescue, 'normal');
  rescue.advancePressure(.8); assert.equal(rescue.fragmentQueue.length, 0); assert.equal(rescue.seenEnemyKills.size, 0);
  assert.equal(rescue.events.filter(e => e.type === 'shatter').length, 3);
  assert.deepEqual(rescue.events.filter(e => e.type === 'shatter').map(e => e.enemyType), special.map(b => b.enemyType));
});

test('walkers spawn at an edge, retain two-unit speed and adopt rebound and collision direction', () => {
  const w = world(10), b = w.spawnEnemy(null, 'walker'), bounds = w.arenaBounds;
  assert.ok([Math.abs(b.x - bounds.left - b.r), Math.abs(b.x - bounds.right + b.r), Math.abs(b.y - bounds.top - b.r), Math.abs(b.y - bounds.bottom + b.r)].some(d => d < 1e-7));
  near(length(b), w.unit * 2); Object.assign(b, {born: 1, solid: true, x: bounds.left + b.r + .1, y: 300, vx: -w.unit * 2, vy: 0});
  advance(w, .05); near(length(b), w.unit * 2); assert.ok(b.vx > 0);
  Object.assign(w.player, {x: 500, y: 500, vx: 0, vy: 0}); Object.assign(b, {x: 500 + w.player.r + b.r - .1, y: 500, vx: -w.unit * 2, vy: 0});
  w.collide(w.player, b); near(length(b), w.unit * 2); assert.ok(b.vx > 0);
});

test('magnet force is constant within four units and ignores birth protection, dead bodies and other phases', () => {
  const w = world(13), magnet = spawn(w, 'magnet', {x: 500, y: 500});
  for (const distance of [2, 3.9]) {
    Object.assign(w.player, {x: magnet.x - distance * w.unit, y: magnet.y, vx: 0, vy: 0});
    near(w.magnetAcceleration().x, w.unit * 1.5); near(w.magnetAcceleration().y, 0);
  }
  w.player.x = magnet.x - w.unit * 4.01; assert.equal(w.magnetAcceleration(), null);
  w.player.x = magnet.x - w.unit * 3; magnet.solid = false; assert.equal(w.magnetAcceleration(), null);
  magnet.solid = true; advance(w, .1); assert.ok(w.player.vx > 0);
  for (const phase of ['clearing', 'boss-celebrate', 'choose']) { w.phase = phase; assert.equal(w.magnetAcceleration(), null); }
  for (const phase of ['boss-entry','boss']) { w.phase=phase;assert.ok(w.magnetAcceleration()); }
  w.phase = 'battle'; magnet.hp = 0; assert.equal(w.magnetAcceleration(), null);
});

test('magnet death pushes within three units and preserves the impulse through a target hit-stop', () => {
  const w = world(13), magnet = spawn(w, 'magnet', {x: 400, y: 400});
  const held = spawn(w, 'normal', {x: 400 + w.unit * 2.2, y: 400, feedbackFreeze: .05});
  const outside = spawn(w, 'normal', {x: 400, y: 400 + w.unit * 3.1});
  w.damage(magnet, 1e9); near(held.vx, 0); near(held.pendingVx, w.unit * 4); near(outside.vy, 0);
  const x = held.x; advance(w, .04); near(held.vx, 0); near(held.x, x);
  advance(w, .011); assert.ok(held.vx > w.unit * 3.9); assert.ok(held.x > x); near(held.pendingVx, 0);
});

test('a shield consumes exactly one hit, rejects that step pulse and takes damage on a later independent hit', () => {
  const w = world(16), shield = spawn(w, 'shield', {x: 500, y: 300}); const hp = shield.hp;
  hit(w, shield); assert.equal(shield.shield, false); near(shield.hp, hp);
  assert.equal(w.events.filter(e => e.type === 'shieldBreak').length, 1); assert.equal(w.events.filter(e => e.type === 'hit').length, 0);
  w.damage(shield, hp * 2, {source: 'pulse'}); near(shield.hp, hp); assert.equal(w.stageKills, 0);
  shield.vx = shield.vy = 0; w.player.vx = w.player.vy = 0; w.step(.001);
  w.damage(shield, hp * .25); near(shield.hp, hp * .75); near(shield.hitAlpha, .25);
  w.damage(shield, hp); assert.equal(w.stageKills, 1); assert.equal(w.events.filter(e => e.type === 'kill').length, 1);
  const kill = w.events.find(e => e.type === 'kill'); assert.equal(kill.enemyType, 'shield'); assert.equal(kill.shield, false);
});

test('leaders draw only live solid cluster members inward and scatter the same members on a real kill', () => {
  const w = world(12), leader = spawn(w, 'leader', {x: 500, y: 500, clusterId: 123});
  const member = spawn(w, 'normal', {x: 500 + w.unit * 3, y: 500, clusterId: 123});
  const stranger = spawn(w, 'normal', {x: 500, y: 500 + w.unit * 3, clusterId: 456});
  const x = member.x, y = stranger.y; advance(w, .1);
  near(member.x, x - w.unit * .5 * .1); near(stranger.y, y); near(member.vx, 0);
  w.damage(leader, 1e9); near(member.vx, w.unit * 2); near(stranger.vy, 0);
  assert.equal(w.leaderDrift(member), null);
});

test('variant kill scores use their base value, cap at combo eight and round half points once per kill', () => {
  for (const [type, expected] of [['ring', 23], ['magnet', 38], ['heavy', 45], ['fragment', 8]]) {
    const w = world(); w.shotBanked = true;
    const b = spawn(w, type); w.damage(b, 1e9);
    assert.equal(w.score, expected); assert.equal(w.events.find(e => e.type === 'kill').value, expected);
  }
  const w = world(); w.shotKills = 20; w.damage(spawn(w, 'ring'), 1e9); assert.equal(w.score, 180);
});

test('first-type feedback occurs once per run for real kills and snapshots retain typed appearance', () => {
  const w = world(); w.setFeedbackOptions({strength: .6});
  for (let i = 0; i < 2; i++) w.damage(spawn(w, 'ring'), 1e9);
  assert.equal(w.events.filter(e => e.type === 'firstTypeKill').length, 1);
  const event = w.events.find(e => e.type === 'kill'); assert.equal(event.enemyType, 'ring'); assert.equal(event.bodySnapshot.enemyType, 'ring');
  const fresh = world(); fresh.damage(spawn(fresh, 'ring'), 1e9); assert.equal(fresh.events.filter(e => e.type === 'firstTypeKill').length, 1);
});

test('new types receive three isolated teaching births at 300 ms spacing and progress survives a stage change', () => {
  const w = world(3); w.introTimer = 0;
  advance(w, 37 / 120); assert.equal(w.typeIntroductions.ring, 2);
  w.stage = 4; advance(w, 37 / 120); assert.equal(w.typeIntroductions.ring, 3);
  const rings = w.enemies.filter(b => b.enemyType === 'ring'); assert.equal(rings.length, 3);
  assert.equal(new Set(rings.map(b => b.clusterId)).size, 3); assert.ok(rings.every(b => b.teaching));
  const events = w.events.filter(e => e.type === 'spawn'); near(events[1].feedbackTime - events[0].feedbackTime, .3); near(events[2].feedbackTime - events[1].feedbackTime, .3);
  advance(w, 1); assert.equal(w.liveCount, 3);
  w.stage = 6; advance(w, .3); assert.ok(w.typeIntroductions.heavy > 0); assert.equal(w.typeIntroductions.ring, 3);
});

test('floor is filled before independent teaching and plans reserve live, child and future wave types', () => {
  const w = world(3); w.floorTimer = 0; w.introTimer = 0;
  advance(w, .001); assert.equal(w.liveCount, 2); assert.equal(w.enemies[0].enemyType, 'normal'); assert.equal(w.enemies[1].enemyType, 'ring');
  assert.notEqual(w.enemies[0].clusterId, w.enemies[1].clusterId);
  const cap = world(8); spawn(cap, 'split'); spawn(cap, 'ring');
  assert.deepEqual(new Set(cap.reservedEnemyTypes()), new Set(['split', 'normal', 'ring']));
  assert.equal(cap.spawnEnemy(null, 'heavy'), undefined);
  cap.fragmentQueue.push({x: 100, y: 100, maxHp: 100, density: 1, angle: 0});
  cap.typeIntroductions = Object.fromEntries(Object.keys(ENEMY_TYPES).map(type => [type, 3]));
  const plan = cap.makePlannedCluster(6); assert.ok(plan.types.every(type => ['split', 'normal', 'ring'].includes(type)));
});

test('natural clustered plans never exceed population or visible type caps across unlock stages', () => {
  for (const stage of [3, 6, 8, 10, 12, 13, 16, 20]) {
    let state = stage; const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
    const w = new World(900, 700, random, {spawnInitial: false}); w.stage = stage; w.spawnTimer = 0;
    for (let i = 0; i < 2400 && w.phase === 'battle'; i++) {
      w.step(1 / 120); assert.ok(w.liveCount <= 28); assert.ok(typeCount(w) <= enemyTypeLimit(stage));
      assert.ok(w.reservedEnemyTypes().length <= enemyTypeLimit(stage));
    }
    for (const id of new Set(w.enemies.map(b => b.clusterId))) {
      const group = w.enemies.filter(b => b.clusterId === id);
      for (const type of ['heavy', 'magnet', 'walker']) assert.ok(group.filter(b => b.enemyType === type).length <= 1);
      if (group.some(b => b.enemyType === 'walker')) assert.equal(group.length, 1);
    }
  }
});

test('pending children resize with the world and are discarded by clearing/rewards and Boss entry', () => {
  const w = world(8), mother = spawn(w, 'split', {x: 300, y: 300}); w.damage(mother, 1e9);
  const child = {...w.fragmentQueue[0]}; w.resize(390, 844);
  near(w.fragmentQueue[0].x, child.x * 390 / 1400); near(w.fragmentQueue[0].y, child.y * 844 / 1000);
  w.beginClearing(); assert.equal(w.fragmentQueue.length, 0);
  const boss = world(5); boss.fragmentQueue.push(child); boss.beginBoss(); assert.deepEqual(boss.fragmentQueue,[]);
  boss.step(.001);assert.equal(boss.fragmentQueue.length,0);assert.equal(boss.enemies.filter(b=>b.enemyType==='fragment').length,0);
  const reward = world(4); reward.fragmentQueue.push(child); reward.beginUpgrade(); assert.equal(reward.fragmentQueue.length, 0);
});
