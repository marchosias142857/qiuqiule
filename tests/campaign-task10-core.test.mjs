import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, campaignUpgradePool, levelConfig} from '../dist/campaign.js';
import {staticContact} from '../dist/campaign-collision.js';

const fresh = (level = 3, options = {}) => new CampaignWorld(390, 844, level, () => .5, options);
const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const tick = (w, seconds, scale = 1) => {
  for (let t = 0; t < seconds - 1e-10; t += 1 / 120) w.step(Math.min(1 / 120, seconds - t) * scale, false, {timeScale: scale});
};
const hit = (w, target, actor = w.player, damage = 1, extra = {}) => w.hitStatic(target, damage, {
  attacker: actor, normalSpeed: 12 * w.unit, impactVx: 12 * w.unit, impactVy: 0,
  impactSpeed: 12 * w.unit, nx: 1, ny: 0, contactX: target.x - target.r, contactY: target.y, ...extra,
});
const isolate = w => {
  w.statics = []; w.zones = []; w.enemies = [];
  w.rules.onTick = () => {}; w.rules.onAfterTick = () => {}; w.rules.timeUntilBoundary = () => Infinity;
  w.rules.onKill = () => {}; w.rules.isWon = () => false; w.rules.isLost = () => false;
  w.rules.onLaunchEnd = () => {}; w.rules.isSettled = () => false;
};

test('task10 activates its exact twenty slots and offers only the four documented upgrades', () => {
  assert.equal(Array.from({length: 100}, (_, i) => levelConfig(i + 1)).filter(c => c.implemented).length, 100);
  for (let k = 0; k < 10; k++) for (const r of [3, 7]) {
    const level = k * 10 + r, w = fresh(level), config = levelConfig(level);
    assert.equal(config.type, r === 3 ? 'bricks' : 'glass'); assert.equal(config.k, k);
    assert.equal(w.legacy, false); assert.equal(config.task, 10);
    assert.deepEqual(campaignUpgradePool(level).map(offer => offer.id), ['split', 'energy', 'breath', 'pulse']);
    assert.equal(fresh(level, {upgradeId: 'pierce'}).upgradeId, null);
  }
});

test('launch hooks receive unfrozen velocity and the brick volley keeps exact simulated launch spacing', () => {
  const w = fresh(3, {upgradeId: 'energy'}); w.setFeedbackOptions({strength: .6});
  const radius = w.player.r, expected = Math.min(w.launchCap, w.baseSpeed * Math.sqrt(1.3 / w.density));
  assert.equal(w.shoot(0, w.maxPull), true); assert.equal(w.player.captured, true);
  assert.equal(w.player.r, radius); assert.equal(w.auxiliaries.length, 1);
  near(-w.bricksLaunchVelocity.vy, expected); near(-w.auxiliaries[0].vy, expected);
  assert.ok(w.auxiliaries[0].feedbackFreeze > 0); w.step(0); assert.equal(w.bricksQueue, w.bricksVolleyCount - 1);
  tick(w, .4); const launches = w.events.filter(e => e.type === 'campaignBrickBall');
  assert.equal(launches.length, w.bricksVolleyCount);
  launches.forEach((event, index) => near(event.time, index * .12));
  assert.ok(w.auxiliaries.every(body => body.isAuxiliary && body.r === .5 * w.unit));
});

test('a queued ball cannot move before its exact release boundary', () => {
  const w = fresh(); w.shoot(0, w.maxPull); w.step(.12);
  assert.equal(w.auxiliaries.length, 2);
  const later = w.auxiliaries[1]; near(later.campaignReleasedAt, .12);
  near(later.x, w.bricksLayout.spawn.x); near(later.y, w.bricksLayout.spawn.y);
  assert.ok(w.auxiliaries[0].y < later.y);
  w.step(.001); assert.ok(later.y < w.bricksLayout.spawn.y);
});

test('a queued ball also cannot earn a static hit in its birth substep', () => {
  const w = fresh(); w.statics = []; w.zones = [];
  const origin = w.bricksLayout.spawn;
  w.addStatic({shape: 'circle', x: origin.x, y: origin.y - 1.3 * w.unit + .01,
    r: .8 * w.unit, hp: 10, restitution: 1});
  const contacts = []; w.rules.onStaticHit = (_shape, _contact, actor) => contacts.push(actor.id);
  w.shoot(0, w.maxPull); w.step(.12);
  const child = w.auxiliaries[1]; assert.ok(child);
  assert.equal(contacts.includes(child.id), false); near(child.y, origin.y);
  w.step(.001); assert.equal(contacts.filter(id => id === child.id).length, 1);
  assert.equal(new Set(w.campaignActors.map(actor => actor.id)).size, w.campaignActors.length);
});

test('brick actors retain their separate radius, zero drag and documented wall restitution', () => {
  const w = fresh(); isolate(w); w.shoot(0, w.maxPull); const actor = w.auxiliaries[0];
  w.auxiliaries = [actor]; const originalRadius = w.player.r;
  Object.assign(actor, {x: w.arenaBounds.right - actor.r - .1, y: 450, vx: 1000, vy: 0});
  w.step(.001); near(actor.vx, -980); near(actor.vy, 0);
  assert.equal(w.player.r, originalRadius); assert.equal(actor.r, .5 * w.unit);
  const target = w.addStatic({shape: 'circle', x: 220, y: 500, r: .8 * w.unit, hp: 3, restitution: 1});
  Object.assign(actor, {x: target.x - target.r - actor.r - .1, y: target.y, vx: 1000, vy: 0});
  w.rules.onStaticHit = (shape, contact, ball) => w.hitStatic(shape, ball.damageScale, contact);
  w.step(.001); near(actor.vx, -1000); assert.equal(target.hp, 2);
});

test('a zero settle delay never ends a moving volley, and the configurable deadline ends at exactly 3.5 seconds', () => {
  const w = fresh(); isolate(w); w.shoot(0, w.maxPull);
  w.step(.1); assert.equal(w.shotActive, true);
  w.shotTime = 3.499; w.step(.02);
  assert.equal(w.shotActive, false); near(w.shotTime, 3.5);
  assert.equal(w.events.filter(e => e.type === 'campaignLaunchEnd').length, 1);
  const settled = fresh(); isolate(settled); settled.shoot(0, 60);
  settled.rules.isSettled = () => settled.bricksQueue === 0 && settled.auxiliaries.every(ball => Math.hypot(ball.vx, ball.vy) < 3 * settled.unit);
  settled.auxiliaries.forEach(ball => ball.vx = ball.vy = 0);
  settled.step(1 / 120); assert.equal(settled.shotActive, true, 'pending queue prevents an empty-field premature end');
  settled.bricksQueue = 0; settled.step(1 / 120); assert.equal(settled.shotActive, false);
});

test('split uses the first killing actor, sixty-percent velocity and damage, and reserves all queued slots', () => {
  const w = fresh(3, {upgradeId: 'split'}); w.shoot(0, w.maxPull);
  const actor = w.auxiliaries[0], target = w.statics.find(s => s.kind === 'number-brick');
  const velocity = {impactVx: 300, impactVy: -400};
  hit(w, target, actor, target.hp, velocity);
  const children = w.auxiliaries.filter(ball => ball.campaignSplit);
  assert.equal(children.length, 2); assert.equal(w.shotSplitUsed, true);
  for (const child of children) { near(Math.hypot(child.vx, child.vy), 300); assert.equal(child.damageScale, .6); assert.equal(child.r, .5 * w.unit); }
  hit(w, w.statics.find(s => s.kind === 'number-brick' && !s.dead), actor, 100, velocity);
  assert.equal(w.auxiliaries.filter(ball => ball.campaignSplit).length, 2);
  const capped = fresh(3, {upgradeId: 'split'}); capped.bricksBallCount = capped.config.ballCap;
  capped.shoot(0, capped.maxPull); const cappedTarget = capped.statics.find(s => s.kind === 'number-brick');
  hit(capped, cappedTarget, capped.auxiliaries[0], cappedTarget.hp);
  assert.equal(capped.auxiliaries.filter(ball => ball.campaignSplit).length, 0);
  assert.equal(capped.auxiliaries.length + capped.bricksQueue, capped.config.ballCap);
});

test('pulse keeps fractional damage, a strict four-unit radius, the heavy-hit gate and a shared cooldown', () => {
  const w = fresh(7, {upgradeId: 'pulse'}); isolate(w); w.shoot(0, 80);
  const origin = w.addStatic({shape: 'circle', x: 140, y: 400, r: 10, hp: 20});
  const nearTarget = w.addStatic({shape: 'circle', x: 140 + 2 * w.unit, y: 400, r: 10, hp: 1});
  const edgeTarget = w.addStatic({shape: 'circle', x: 140 + 4 * w.unit, y: 400, r: 10, hp: 1});
  hit(w, origin, w.player, 1, {normalSpeed: 9 * w.unit}); near(nearTarget.hp, 1);
  hit(w, origin); near(nearTarget.hp, .7); near(edgeTarget.hp, 1); near(w.pulseCooldown, .65);
  hit(w, origin); near(nearTarget.hp, .7); assert.equal(w.events.filter(e => e.type === 'pulse').length, 1);
  // The cooldown clock follows world simulation, independently of real-time slow motion.
  w.statics.forEach(body => body.active = false); tick(w, .64); near(w.pulseCooldown, .01);
  tick(w, .02); assert.equal(w.pulseCooldown, 0);
  w.statics.forEach(body => body.active = true); hit(w, origin); near(nearTarget.hp, .4);
  assert.equal(w.events.filter(e => e.type === 'pulse').length, 2);
});

test('pulse damage cannot recursively launch another pulse and can finish a weakened target only once', () => {
  const w = fresh(3, {upgradeId: 'pulse'}); isolate(w); w.shoot(0, 80);
  const origin = w.addStatic({shape: 'circle', x: 140, y: 400, r: 10, hp: 3});
  const nearby = w.addStatic({shape: 'circle', x: 180, y: 400, r: 10, hp: .2, maxHp: 1});
  hit(w, origin, w.auxiliaries[0]); assert.equal(nearby.hp, 0);
  assert.equal(w.events.filter(e => e.type === 'pulse').length, 1);
  assert.equal(w.events.filter(e => e.type === 'kill' && e.bodyId === nearby.id).length, 1);
  assert.equal(w.totalKills, 1); hit(w, nearby, w.auxiliaries[0]); assert.equal(w.totalKills, 1);
});

test('fractional task10 damage reaches zero at its mathematical total without an extra floating-point hit', () => {
  const w = fresh(); isolate(w); w.shoot(0, 80);
  const target = w.addStatic({shape: 'circle', x: 200, y: 400, r: 10, hp: 3});
  for (let index = 0; index < 9; index++) hit(w, target, w.auxiliaries[0], .3, {source: 'pulse'});
  near(target.hp, .3); assert.equal(target.dead, undefined);
  hit(w, target, w.auxiliaries[0], .3, {source: 'pulse'});
  assert.equal(target.hp, 0); assert.equal(target.dead, true); assert.equal(w.totalKills, 1);
});

test('miss budgets do not pay for shots and zero remaining allowance can still launch', () => {
  const w = fresh(7), budget = w.remaining;
  assert.equal(w.shoot(0, 80), true); assert.equal(w.remaining, budget);
  w.endLaunch(); assert.equal(w.ready, false); tick(w, .41); assert.equal(w.ready, true);
  w.rules.onTick(10);
  w.statics.filter(s => s.kind === 'glass').slice(0, budget).forEach(pane => pane.y = w.glassBoard.bottom);
  w.rules.onAfterTick(); assert.equal(w.remaining, 0);
  assert.equal(w.shoot(0, 80), true); assert.equal(w.remaining, 0);
});

function finalGlassFixture(rescue) {
  const w = fresh(7); w.rules.onTick(59.999);
  const panes = w.statics.filter(s => s.kind === 'glass'), target = panes[w.config.budget];
  panes.forEach((pane, index) => {
    if (index < w.config.budget) pane.y = w.glassBoard.bottom;
    else if (pane !== target) { pane.dead = true; pane.active = false; }
  });
  Object.assign(target, {x: 195, y: w.glassBoard.bottom - target.r - .01});
  w.rules.onAfterTick(); assert.equal(w.glassMisses, w.config.budget); assert.equal(w.remaining, 0);
  assert.equal(w.shoot(-w.maxPull, 0), true);
  Object.assign(w.player, {x: rescue ? target.x - target.r - w.player.r - .01 : 70, y: target.y, vx: rescue ? 100 : 0, vy: 0});
  return {w, target};
}

test('the last timed substep resolves a real hit before its miss and ends exactly at sixty world seconds', () => {
  const {w, target} = finalGlassFixture(true); w.step(.02);
  assert.equal(target.hp, 0); assert.equal(w.glassClock, 60); assert.equal(w.completed, true);
  assert.equal(w.glassMisses, w.config.budget); assert.equal(w.phase, 'campaign-celebrate');
  assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
  const missed = finalGlassFixture(false).w; missed.step(.02);
  assert.equal(missed.glassClock, 60); assert.equal(missed.glassMisses, missed.config.budget + 1);
  assert.equal(missed.completed, false); assert.equal(missed.phase, 'over');
});

test('glass world clock uses simulated dt while hooks also receive the unchanged real interval', () => {
  const w = fresh(7), before = w.elapsed; let received;
  const onAfterTick = w.rules.onAfterTick;
  w.rules.onAfterTick = (dt, context) => { received = {dt, ...context}; onAfterTick(dt, context); };
  w.step(.25 / 120, false, {timeScale: .25});
  near(w.glassClock, .25 / 120); near(w.elapsed - before, 1 / 120);
  near(received.dt, .25 / 120); near(received.realDt, 1 / 120); assert.equal(received.timeScale, .25);
  const clock = w.glassClock; w.step(0); w.step(-1); assert.equal(w.glassClock, clock);
});

test('task10 inherits actor rotation exclusion without creating damage or collectible pickup', () => {
  const w = fresh(); w.shoot(0, w.maxPull); tick(w, .25);
  const before = {score: w.score, remaining: w.remaining, balls: w.bricksBallCount, broken: w.bricksBroken};
  const ids = w.auxiliaries.map(ball => ball.id); w.resize(568, 320); w.resize(568, 320);
  assert.deepEqual({score: w.score, remaining: w.remaining, balls: w.bricksBallCount, broken: w.bricksBroken}, before);
  assert.deepEqual(w.auxiliaries.map(ball => ball.id), ids);
  for (const actor of w.auxiliaries) for (const shape of w.statics)
    assert.ok((staticContact(actor, shape)?.depth || 0) < 1e-5);
  assert.equal(w.player.captured, true); assert.equal(w.player.r, w.unit);
});
