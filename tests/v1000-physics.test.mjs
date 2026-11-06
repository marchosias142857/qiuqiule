import test from 'node:test';
import assert from 'node:assert/strict';
import {World, length} from '../dist/physics.js';
import {ENEMY_TYPES, enemyMix, planEnemyCluster} from '../dist/enemies.js';

const near = (actual, expected, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

function world(stage = 26, width = 1600, height = 1000, random = () => .7) {
  const w = new World(width, height, random, {spawnInitial: false});
  w.stage = stage;
  w.spawnTimer = w.floorTimer = w.introTimer = Infinity;
  for (const type of Object.keys(ENEMY_TYPES)) w.typeIntroductions[type] = 3;
  return w;
}

function mother(w, x = 400, y = 300) {
  const b = w.spawnEnemy(null, 'split');
  assert.ok(b, 'a legal split mother can spawn');
  Object.assign(b, {x, y, born: 1, solid: true, vx: 0, vy: 0});
  return b;
}

function field(w, count, motherCount = 0) {
  for (let i = 0; i < motherCount; i++) mother(w, 180 + i * 140, 250);
  for (let i = 0; i < count - motherCount; i++) {
    const b = w.spawnEnemy(null, 'normal'); assert.ok(b);
    Object.assign(b, {x: 100 + i % 9 * 150, y: 550 + Math.floor(i / 9) * 120});
  }
  assert.equal(w.liveCount, count);
}

function pendingCluster(w, types = ['split'], index = 0) {
  return {id: ++w.clusterId, x: 800, y: 250, angle: 0, timer: 0,
    size: types.length, types: [...types], index};
}

function children(w) { return w.enemies.filter(b => b.hp > 0 && b.enemyType === 'fragment'); }
function kill(w, body) { w.damage(body, body.hp + 1); }
function contact(w, body, speed = w.unit * 60) {
  Object.assign(w.player, {x: body.x - w.player.r - body.r + .1, y: body.y, vx: speed, vy: 0});
  w.collide(w.player, body);
}
function assertSeparated(a, b, message) {
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) + 1e-7 >= a.r + b.r, message);
}

test('v10 HP preserves stages 1–20 and smoothly reaches a continuing ten-percent late growth rate', () => {
  const w = world();
  for (let stage = 1; stage <= 20; stage++) {
    w.stage = stage;
    assert.equal(w.enemyProfile().hp, 19 * 1.2 ** (stage - 1));
  }
  for (const [stage, hp] of [[21, 722.3442785769779], [26, 1516.6060607934933],
    [30, 2343.6077058896394], [31, 2577.9684764786034], [40, 6078.714816583514]]) {
    w.stage = stage; near(w.enemyProfile().hp, hp);
  }
  let previous = 19, previousRate = 1.2;
  for (let stage = 2; stage <= 100; stage++) {
    w.stage = stage;
    const hp = w.enemyProfile().hp, rate = hp / previous;
    assert.ok(hp > previous, 'later stages still gain health');
    assert.ok(rate <= previousRate + 1e-12, 'no upward growth-rate jump');
    assert.ok(rate >= 1.1 - 1e-12, 'the late curve remains challenging');
    previous = hp; previousRate = rate;
  }
});

test('v10 health time increments remain independent of the new stage curve', () => {
  const w = world(26), base = w.enemyProfile().hp;
  for (const [time, extra] of [[44.999, 0], [45, 2], [89.999, 2], [90, 4], [900, 40]]) {
    w.time = time; near(w.enemyProfile().hp, base + extra);
  }
});

test('restored mother admission uses the same capacity gate as ordinary enemies at every unlocked stage', () => {
  for (const stage of [8, 20, 21, 26, 50]) {
    const w = world(stage); field(w, 27);
    const last = w.spawnEnemy(null, 'split');
    assert.ok(last, 'a mother can use the 28th pressure slot without reserving three bodies');
    assert.equal(last.enemyType, 'split');
    assert.equal(w.pressureCount, 28);
    assert.equal(w.liveCount, 28);
    assert.equal(w.spawnEnemy(null, 'split'), undefined);
    assert.equal(w.spawnEnemy(null, 'normal'), undefined);
  }
});

test('restored mother admission has no nine-mother or per-cluster cap', () => {
  const w = world(26, 4000, 2400);
  for (let i = 0; i < 12; i++) mother(w, 200 + i * 250, 350);
  assert.equal(w.liveCount, 12);
  assert.equal(w.pressureCount, 12);
  const cluster = pendingCluster(w, Array(5).fill('split'));
  for (let i = 0; i < 5; i++) assert.equal(w.spawnEnemy(cluster)?.enemyType, 'split');
  assert.equal(w.enemies.filter(b => b.hp > 0 && b.enemyType === 'split').length, 17);
  assert.equal(w.pressureCount, 17);
  assert.deepEqual(cluster.types, Array(5).fill('split'));
});

test('restored planned mother slots are born unchanged instead of being re-rolled as another type', () => {
  const w = world(26); field(w, 20, 2);
  const cluster = pendingCluster(w, ['split', 'split', 'split']);
  w.wave = cluster;
  const born = Array.from({length: 3}, () => w.spawnEnemy(cluster));
  assert.deepEqual(born.map(b => b?.enemyType), ['split', 'split', 'split']);
  assert.deepEqual(cluster.types, ['split', 'split', 'split']);
  assert.equal(cluster.index, 3);
  assert.equal(w.liveCount, 23);
  assert.equal(w.pressureCount, 23);
  assert.equal(w.enemies.filter(b => b.hp > 0 && b.enemyType === 'split').length, 5);
});

test('restored spawn planner keeps the established stage mix including the ten-percent mother weight', () => {
  assert.deepEqual(enemyMix(8), {normal: .65, ring: .15, heavy: .10, split: .10});
  assert.deepEqual(enemyMix(26), {normal: .42, ring: .12, heavy: .10, split: .10, walker: .10, magnet: .08, shield: .08});
  const counts = {};
  // Isolate the existing main-type draw; leader is its own independent roll.
  for (let i = 0; i < 100; i++) {
    const [type] = planEnemyCluster({stage: 26, size: 1, random: () => (i + .5) / 100, excludedTypes: ['leader']});
    counts[type] = (counts[type] || 0) + 1;
  }
  assert.deepEqual(counts, {normal: 42, ring: 12, heavy: 10, split: 10, walker: 10, magnet: 8, shield: 8});
});

test('v10 a free-space split creates three fully vulnerable, outward-moving children around the old outline', () => {
  const w = world(8), a = mother(w, 500, 400);
  w.player.x = 1300; w.player.y = 800;
  const hp = a.maxHp;
  kill(w, a); w.flushFragments();
  const family = children(w);
  assert.equal(family.length, 3);
  assert.equal(w.fragmentQueue.length, 0);
  const angles = family.map(child => {
    assert.equal(child.born, 1);
    assert.equal(child.solid, true);
    assert.equal(child.fragmentReveal, 0);
    near(child.hp, hp * .3); near(child.r, w.unit * .6);
    const dx = child.x - a.x, dy = child.y - a.y, distance = Math.hypot(dx, dy);
    assert.ok(distance >= a.r + child.r, 'children emerge around rather than inside the old outline');
    assert.ok(distance <= w.unit * 2.5 + 1e-7);
    near(length(child), w.unit * 6);
    near(child.vx / length(child), dx / distance); near(child.vy / length(child), dy / distance);
    return (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
  }).sort((a, b) => a - b);
  for (let i = 0; i < 3; i++) near((angles[(i + 1) % 3] - angles[i] + Math.PI * 2) % (Math.PI * 2), Math.PI * 2 / 3);
});

test('v10 children avoid full collision radii of the main player, auxiliaries and existing enemies', () => {
  const w = world(8), a = mother(w, 500, 400), u = w.unit;
  Object.assign(w.player, {x: a.x - a.r - w.player.r, y: a.y});
  const auxiliary = w.makeBody(a.x, a.y - 1.9 * u, .7 * u, w.player.density);
  Object.assign(auxiliary, {isPlayer: true, isAuxiliary: true, hp: Infinity, born: 1, solid: true});
  w.auxiliaries.push(auxiliary);
  const blocker = w.spawnEnemy(null, 'normal');
  Object.assign(blocker, {x: a.x + 2 * u, y: a.y, born: 1, solid: true});
  kill(w, a); w.flushFragments();
  const family = children(w);
  assert.equal(family.length + w.fragmentQueue.length, 3, 'no offspring silently disappear');
  assert.ok(family.length > 0, 'legal nearby space remains available');
  for (const child of family) {
    assertSeparated(child, w.player, 'player overlap');
    assertSeparated(child, auxiliary, 'auxiliary overlap');
    assertSeparated(child, blocker, 'existing enemy overlap');
    for (const other of family) if (child !== other) assertSeparated(child, other, 'sibling overlap');
    assert.ok(Math.hypot(child.x - a.x, child.y - a.y) <= 2.5 * u + 1e-7, 'no distant relocation');
  }
});

test('v10 corner splits remain inside the arena and keep blocked children local until space opens', () => {
  for (const [width, height] of [[390, 844], [844, 390]]) for (const right of [false, true]) {
    const w = world(8, width, height), bounds = w.arenaBounds, a = mother(w);
    a.x = right ? bounds.right - a.r : bounds.left + a.r;
    a.y = bounds.top + a.r;
    Object.assign(w.player, {x: width / 2, y: height * .75});
    kill(w, a); w.flushFragments();
    const family = children(w);
    assert.equal(family.length + w.fragmentQueue.length, 3);
    for (const child of family) {
      assert.ok(child.x - child.r >= bounds.left - 1e-7);
      assert.ok(child.x + child.r <= bounds.right + 1e-7);
      assert.ok(child.y - child.r >= bounds.top - 1e-7);
      assert.ok(child.y + child.r <= bounds.bottom + 1e-7);
      assert.ok(Math.hypot(child.x - a.x, child.y - a.y) <= 2.5 * w.unit + 1e-7);
      assert.equal(child.solid, true);
      assertSeparated(child, w.player, 'corner spawn overlaps player');
    }
  }
});

test('v10 an already resolved shockwave does not strike newborns, while the next shockwave can hit immediately', () => {
  const w = world(8), a = mother(w, 600, 400);
  a.hp = 1;
  Object.assign(w.player, {x: a.x - 1.5 * w.unit, y: a.y});
  w.releaseShockwave();
  const family = children(w);
  assert.equal(family.length, 3);
  assert.equal(w.totalKills, 1, 'only the mother belonged to the first shockwave');
  for (const child of family) { assert.equal(child.hp, child.maxHp); assert.equal(child.solid, true); }
  const hp = family.map(child => child.hp);
  w.releaseShockwave();
  assert.ok(family.some((child, i) => child.hp < hp[i]), 'a new area attack is effective without waiting for birth animation');
});

test('v10 the same launched shot can immediately kill a mother then collide with its newborn child', () => {
  const w = world(8), a = mother(w, 500, 400);
  a.hp = 1;
  w.shoot(-w.maxPull, 0);
  contact(w, a);
  assert.equal(w.shotKills, 1);
  const child = children(w)[0]; assert.ok(child);
  assert.equal(child.solid, true);
  child.vx = child.vy = 0;
  contact(w, child);
  assert.ok(child.hp <= 0);
  assert.equal(w.totalShots, 1, 'no second launch or invulnerability timer was required');
  assert.equal(w.shotKills, 2);
});

test('v10 birth appearance has no effect on child vulnerability, while ordinary birth protection stays at 0.8 seconds', () => {
  const w = world(8), a = mother(w, 400, 300);
  kill(w, a); w.flushFragments();
  const child = children(w)[0];
  const hp = child.hp; w.damage(child, 1);
  near(child.hp, hp - 1);
  assert.equal(child.fragmentReveal, 0);
  const ordinary = w.spawnEnemy(null, 'normal');
  assert.equal(ordinary.solid, false);
  assert.equal(ordinary.born, 0);
  w.advanceBodies(.13, false, 1);
  assert.equal(child.solid, true); assert.equal(child.born, 1); assert.equal(child.fragmentReveal, 1);
  assert.equal(ordinary.solid, false);
  w.advanceBodies(.66, false, 1);
  assert.equal(ordinary.solid, false);
  w.advanceBodies(.011, false, 1);
  assert.equal(ordinary.solid, true);
});

test('a full logical field admits all existing-family children and they remain immediately attackable', () => {
  const w = world(26), a = mother(w, 600, 300);
  for (let i = 0; i < 27; i++) {
    const b = w.spawnEnemy(null, 'normal'); assert.ok(b);
    Object.assign(b, {x: 100 + i % 9 * 150, y: 550 + Math.floor(i / 9) * 120, born: 1, solid: true});
  }
  kill(w, a); w.flushFragments();
  assert.equal(w.liveCount, 30);
  assert.equal(w.pressureCount, 28);
  assert.equal(w.fragmentQueue.length, 0);
  assert.equal(children(w).length, 3);
  const child = children(w)[0]; assert.ok(child);
  assert.equal(child.solid, true);
  const hp = child.hp; w.damage(child, 1);
  near(child.hp, hp - 1);
  assert.equal(w.pressureCount, 28);
});

test('v10 a locally blocked family cannot hold up safe children from another family', () => {
  const w = world(), blocked = mother(w, 350, 300), free = mother(w, 1100, 300);
  const blocker = w.spawnEnemy(null, 'normal');
  Object.assign(blocker, {x: blocked.x, y: blocked.y, r: 3.2 * w.unit, born: 1, solid: true});
  kill(w, blocked); kill(w, free);
  assert.equal(w.fragmentQueue.length, 6);
  w.flushFragments();
  assert.equal(children(w).length, 3, 'the unobstructed family can be born in the same flush');
  assert.equal(w.fragmentQueue.length, 3);
  assert.equal(children(w).length + w.fragmentQueue.length, 6);
  for (const child of children(w)) assert.ok(Math.hypot(child.x - free.x, child.y - free.y) <= 2.5 * w.unit + 1e-7);
  Object.assign(blocker, {x: 1200, y: 800});
  w.flushFragments();
  assert.equal(children(w).length, 6);
  assert.equal(w.fragmentQueue.length, 0);
  assert.equal(children(w).length + w.fragmentQueue.length, 6, 'deferred birth conserves rather than duplicates offspring');
});

test('v10 reward transition clears pending offspring before the next stage fills its starting floor', () => {
  const w = world(21), a = mother(w, 350, 300);
  kill(w, a);
  w.wave = w.makePlannedCluster(8);
  assert.ok(w.fragmentQueue.length > 0 && w.wave.types.includes('split'));
  w.beginUpgrade();
  assert.equal(w.phase, 'transition');
  assert.equal(w.fragmentQueue.length, 0);
  assert.equal(w.pressureCount, 0);
  assert.equal(w.wave, null);
  assert.equal(w.floorCluster, null);
  w.finishRewardRound();
  assert.equal(w.stage, 22);
  assert.equal(w.phase, 'battle');
  assert.equal(w.liveCount, w.floorCount);
  assert.equal(w.pressureCount, w.floorCount);
  assert.ok(w.enemies.some(b => b.enemyType === 'split'));
  for (const b of w.enemies) if (b.enemyType === 'split') assert.equal(b.splitFamilyId, b.id);
  for (const b of w.enemies) if (b.enemyType === 'split') near(b.maxHp, w.enemyProfile().hp * 1.5);
});

test('v10 a lethal body pass cannot let the dead mother propel newborn children through a corner wall', () => {
  for (const [width, height] of [[390, 844], [844, 390]]) {
    for (const sx of [1, -1]) for (const sy of [1, -1]) {
      const w = world(8, width, height, () => .5), a = mother(w), bounds = w.arenaBounds;
      Object.assign(a, {x: sx > 0 ? bounds.left + a.r : bounds.right - a.r,
        y: sy > 0 ? bounds.top + a.r : bounds.bottom - a.r, hp: 1});
      const distance = a.r + w.player.r - .1;
      Object.assign(w.player, {x: a.x + sx * distance / Math.SQRT2,
        y: a.y + sy * distance / Math.SQRT2,
        vx: -sx * w.baseSpeed / Math.SQRT2, vy: -sy * w.baseSpeed / Math.SQRT2});
      // Exercise the actual outer enemy loop: it retains the mother entry while
      // a lethal player collision appends three solid children to that array.
      w.advanceBodies(.0001, false);
      assert.ok(a.hp <= 0);
      const family = children(w);
      assert.equal(family.length, 3);
      assert.equal(w.fragmentQueue.length, 0);
      for (const child of family) {
        assert.ok(child.x - child.r >= bounds.left - 1e-7);
        assert.ok(child.x + child.r <= bounds.right + 1e-7);
        assert.ok(child.y - child.r >= bounds.top - 1e-7);
        assert.ok(child.y + child.r <= bounds.bottom + 1e-7);
        near(length(child), w.unit * 6, 1e-6);
        assert.equal(child.hp, child.maxHp);
      }
    }
  }
});

test('v10 collision ignores a corpse in either argument without moving or accelerating the living body', () => {
  for (const reversed of [false, true]) {
    const w = world(8);
    const corpse = w.makeBody(300, 300, w.unit * 1.2, 1.5);
    Object.assign(corpse, {hp: 0, born: 1, solid: true, vx: w.unit * 40, vy: 0});
    const child = w.makeBody(corpse.x + corpse.r + w.unit * .6 - 1, corpse.y, w.unit * .6, 1.5);
    Object.assign(child, {enemyType: 'fragment', hp: 20, born: 1, solid: true, vx: w.unit * 6, vy: 0});
    const before = structuredClone({corpse, child});
    if (reversed) w.collide(child, corpse); else w.collide(corpse, child);
    assert.deepEqual({corpse, child}, before);
    assert.equal(w.events.length, 0);
  }
});

test('v10 newborns are included in final arena correction after a legitimate live-enemy birth-frame collision', () => {
  for (const [width, height] of [[390, 844], [844, 390]]) {
    for (const sx of [1, -1]) for (const sy of [1, -1]) {
      const w = world(8, width, height, () => .5), a = mother(w), bounds = w.arenaBounds;
      Object.assign(a, {x: sx > 0 ? bounds.left + a.r : bounds.right - a.r,
        y: sy > 0 ? bounds.top + a.r : bounds.bottom - a.r, hp: 1});
      const blocker = w.spawnEnemy(null, 'normal');
      Object.assign(blocker, {x: sx > 0 ? 51 : width - 51, y: sy > 0 ? 73 : height - 73,
        born: 1, solid: true, vx: 0, vy: 0, hp: 1e7});
      assertSeparated(a, blocker, 'the two preexisting enemies start separated');
      const distance = a.r + w.player.r - .1;
      Object.assign(w.player, {x: a.x + sx * distance / Math.SQRT2,
        y: a.y + sy * distance / Math.SQRT2,
        vx: -sx * w.baseSpeed / Math.SQRT2, vy: -sy * w.baseSpeed / Math.SQRT2});
      // The player kills the mother, then its contact with the surviving enemy
      // can displace newborns. They were not in the pass's initial bodies array.
      w.advanceBodies(.0001, false);
      assert.ok(a.hp <= 0 && blocker.hp > 0);
      const family = children(w);
      assert.equal(family.length, 3);
      for (const child of family) {
        assert.ok(child.x - child.r >= bounds.left - 1e-7);
        assert.ok(child.x + child.r <= bounds.right + 1e-7);
        assert.ok(child.y - child.r >= bounds.top - 1e-7);
        assert.ok(child.y + child.r <= bounds.bottom + 1e-7);
        assert.ok(Number.isFinite(child.vx) && Number.isFinite(child.vy));
      }
    }
  }
});
