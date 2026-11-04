import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, campaignUpgradePool, levelConfig} from '../dist/campaign.js';
import {dynamicContact, resolveDynamic, resolveStatic, staticContact} from '../dist/campaign-collision.js';

const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const fresh = (level = 5, options = {}) => new CampaignWorld(390, 844, level, () => .5, options);
const tick = (world, seconds, scale = 1) => {
  for (let t = 0; t < seconds - 1e-10; t += 1 / 120) world.step(Math.min(1 / 120, seconds - t) * scale, false, {timeScale: scale});
};

test('nonlethal contacts expose the untouched centre of mass and momentum before restitution', () => {
  const a = {id: 1, x: 100, y: 400, r: 10, mass: 2, vx: 120, vy: 30, hp: Infinity};
  const b = {id: 2, x: 118, y: 400, r: 10, mass: 3, vx: -60, vy: 10, hp: Infinity};
  const contact = resolveDynamic(a, b);
  near(contact.normalSpeed, 180); near(contact.centerOfMass.x, 110.8); near(contact.centerOfMass.y, 400);
  assert.deepEqual(contact.momentum, {x: 60, y: 90});
  assert.deepEqual(contact.preA, {x: 100, y: 400, vx: 120, vy: 30, mass: 2, r: 10});
  assert.deepEqual(contact.preB, {x: 118, y: 400, vx: -60, vy: 10, mass: 3, r: 10});
  assert.notEqual(a.x, contact.preA.x); assert.notEqual(a.vx, contact.preA.vx);
  near(a.vx * a.mass + b.vx * b.mass, 60); near(a.vy * a.mass + b.vy * b.mass, 90);
});

test('touch contacts include stationary tangent pairs without creating a normal collision impulse', () => {
  const a = {id: 1, x: 100, y: 400, r: 10, mass: 2, vx: 0, vy: 0, hp: Infinity};
  const b = {...a, id: 2, x: 120};
  const contact = dynamicContact(a, b); assert.ok(contact); assert.equal(contact.normalSpeed, 0);
  near(contact.centerOfMass.x, 110); assert.deepEqual(contact.momentum, {x: 0, y: 0});
  assert.equal(resolveDynamic(a, b), null); near(a.x, 100); near(b.x, 120);
  b.x += .001; assert.equal(dynamicContact(a, b), null);
});

test('the 300-degree arc is hollow, reflects from its inner face and leaves the real gap open', () => {
  const arc = {shape: 'arc', x: 200, y: 200, r: 100, width: 2, startAngle: 2 * Math.PI / 3, sweepAngle: 5 * Math.PI / 3};
  assert.equal(staticContact({x: 200, y: 200, r: 10}, arc), null);
  assert.equal(staticContact({x: 200, y: 300, r: 10}, arc), null, 'the absent sixty-degree segment is not a hidden wall');
  const actor = {x: 290, y: 200, r: 10, vx: 100, vy: 25};
  const contact = resolveStatic(actor, arc); assert.ok(contact);
  near(actor.vx, -95); near(actor.vy, 25); near(contact.contactX, 299);
  assert.ok(actor.x < 289.000001);
  const endpoint = {x: 200 + Math.cos(arc.startAngle) * 100, y: 200 + Math.sin(arc.startAngle) * 100};
  assert.ok(staticContact({...endpoint, x: endpoint.x + 5, r: 5}, arc), 'endpoint cap participates in collision');
  const reversed = {...arc, startAngle: arc.startAngle + arc.sweepAngle, sweepAngle: -arc.sweepAngle};
  assert.ok(staticContact({x: 290, y: 200, r: 10}, reversed));
  assert.equal(staticContact({x: 200, y: 300, r: 10}, reversed), null);
});

test('all one hundred slots use their actual rules and task11 offers exactly the documented pool', () => {
  for (let n = 1; n <= 100; n++) assert.equal(levelConfig(n).implemented, true);
  for (let k = 0; k < 10; k++) for (const r of [5, 6]) {
    const world = fresh(k * 10 + r);
    assert.equal(world.legacy, false); assert.equal(world.config.k, k);
    assert.deepEqual(campaignUpgradePool(world.level).map(offer => offer.id), ['gravity', 'density', 'growth', 'pulse']);
    assert.equal(world.config.budgetKind, 'pressure');
    assert.equal(fresh(world.level, {upgradeId: 'energy'}).upgradeId, null);
  }
});

test('pressure and time are live resources rather than finite launch counts, including initial coverage', () => {
  for (const level of [5, 6]) {
    const world = fresh(level), before = world.remaining;
    if (true) { assert.ok(before < 42); near(before, 42 - world.mergeState.coverage * 100); }
    for (let shot = 0; shot < 80; shot++) {
      assert.equal(world.shoot(0, 80), true); assert.equal(world.remaining, before); world.endLaunch();
    }
    assert.equal(world.shotsUsed, 80); assert.equal(world.ready, true); assert.equal(world.phase, 'battle');
  }
});

test('growth increases the real collision radius without mass, while density changes mass alone', () => {
  for (const level of [5, 6]) {
    const normal = fresh(level), growth = fresh(level, {upgradeId: 'growth'}), density = fresh(level, {upgradeId: 'density'});
    near(growth.player.r, normal.player.r * 1.2); near(growth.player.mass, normal.player.mass);
    near(density.player.r, normal.player.r); near(density.player.mass, normal.player.mass * 1.35);
    growth.resize(568, 320); near(growth.player.r, growth.unit * growth.config.playerRadius * 1.2);
    near(growth.player.mass, normal.player.mass); assert.equal(fresh(level).buffs.growth || 0, 0);
  }
});

function mergePair(world, level = 1) {
  const radii = [.55, .75, 1, 1.3, 1.65], balls = world.enemies.slice(0, 2);
  const bounds = world.arenaBounds, cx = (bounds.left + bounds.right) / 2, cy = (bounds.top + bounds.bottom) / 2;
  const radius = radii[level - 1] * world.unit, mass = .55 ** 2 * 2 ** (level - 1);
  balls.forEach((body, index) => Object.assign(body, {mergeLevel: level, r: radius, mass,
    x: cx + (index ? 1 : -1) * (radius - .1), y: cy, vx: index ? 0 : 2 * world.unit, vy: 0,
    hp: Infinity, active: true, drag: 0}));
  world.enemies = balls; world.rules.onTick = () => {};
  return balls;
}

test('idle enemy collisions run real merge hooks with the pre-contact centre and half momentum', () => {
  const world = fresh(), [a, b] = mergePair(world), original = world.rules.onDynamicHit;
  let observed;
  world.rules.onDynamicHit = (left, right, contact) => { observed = contact; return original(left, right, contact); };
  const player = {x: world.player.x, y: world.player.y};
  world.step(1 / 120);
  assert.ok(observed); assert.equal(world.enemies.length, 1); const child = world.enemies[0];
  assert.equal(child.mergeLevel, 2); near(child.mass, a.mass + b.mass);
  near(child.x, observed.centerOfMass.x); near(child.y, observed.centerOfMass.y);
  near(child.vx, observed.momentum.x / child.mass * .5); near(child.vy, observed.momentum.y / child.mass * .5);
  assert.equal(world.shotsUsed, 0); assert.equal(world.mergeCount, 1);
  near(world.player.x, player.x); near(world.player.y, player.y);
  assert.equal(world.events.filter(event => event.type === 'campaignMerge').length, 1);
});

test('stationary maximum-level touching balls clear once while idle, with no launch or invented next level', () => {
  const world = fresh(), [a, b] = mergePair(world, 5);
  a.vx = b.vx = 0; b.x = a.x + a.r + b.r;
  world.step(1 / 120);
  assert.equal(world.enemies.length, 0); assert.equal(world.score, 500); assert.equal(world.mergeClears, 1);
  assert.equal(world.mergeMade, 0); assert.equal(world.shotsUsed, 0);
  tick(world, .1); assert.equal(world.score, 500);
  assert.equal(world.events.filter(event => event.type === 'campaignMergeClear').length, 1);
});

test('a removed merge parent cannot participate again in another pair from the same physics slice', () => {
  const world = fresh(), third = world.enemies[2], [a, b] = mergePair(world);
  Object.assign(third, {mergeLevel: 1, r: a.r, mass: a.mass, x: b.x, y: b.y + .1,
    vx: -2 * world.unit, vy: 0, hp: Infinity, active: true, drag: 0});
  world.enemies.push(third); world.step(1 / 120);
  const merges = world.events.filter(event => event.type === 'campaignMerge');
  assert.equal(merges.length, 1); assert.equal(world.mergeCount, 1); assert.equal(world.enemies.length, 2);
  assert.equal(new Set(merges.flatMap(event => event.origins.map(body => body.id))).size, 2);
});

test('rotation-created dynamic contact cannot merge until the pair genuinely separates and re-enters', () => {
  const world = fresh(), [a, b] = mergePair(world, 5); a.vx = b.vx = 0;
  b.x = a.x + a.r + b.r; world.resize(844, 390);
  const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
  assert.equal(world.blockedDynamicPairs.has(key), true); world.resize(844, 390);
  world.step(1 / 120); assert.equal(world.mergeClears, 0); assert.equal(world.enemies.length, 2);
  a.vx = -2 * world.unit; b.vx = 2 * world.unit; tick(world, .04);
  assert.equal(world.blockedDynamicPairs.has(key), false);
  a.vx = 2 * world.unit; b.vx = -2 * world.unit; tick(world, .08);
  assert.equal(world.mergeClears, 1); assert.equal(world.enemies.length, 0);
});

test('the final real maximum-ball creation wins before a simultaneous pressure failure', () => {
  const world = fresh(); mergePair(world, 4); world.mergeMade = world.config.targetMax - 1;
  world.rules.isLost = () => true;
  world.step(1 / 120); assert.equal(world.mergeMade, world.config.targetMax);
  assert.equal(world.completed, true); assert.equal(world.phase, 'campaign-celebrate');
  assert.equal(world.events.filter(event => event.type === 'campaignPeak').length, 1);
});





test('task11 clocks follow world time without changing real-time elapsed tracking', () => {
  for (const level of [5, 6]) {
    const world = fresh(level), before = world.elapsed;
    world.step(.25 / 120, false, {timeScale: .25});
    near(world.mergeState.elapsed, .25 / 120);
    near(world.elapsed - before, 1 / 120);
    const clock = world.mergeState.elapsed;
    world.step(0); world.step(-1);
    near(world.mergeState.elapsed, clock);
  }
});
