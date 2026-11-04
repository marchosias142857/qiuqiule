import test from 'node:test';
import assert from 'node:assert/strict';
import {World, length, BOSS_TIMING} from '../dist/physics.js';
import {LegacyCampaignWorld as CampaignWorld} from '../dist/campaign.js';

const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
function run(strength = .6, reducedMotion = false) {
  const w = new World(900, 700, () => .5, {spawnInitial: false});
  w.setFeedbackOptions({strength, reducedMotion});
  w.spawnTimer = 999; w.floorTimer = Infinity; w.introTimer = Infinity; w.target = 1e9;
  Object.assign(w.player, {x: 200, y: 300, born: 1, solid: true});
  return w;
}
function enemy(w, x, y, values = {}) {
  const b = w.makeBody(x, y, w.unit, .8);
  Object.assign(b, {born: 1, solid: true, hp: 100, maxHp: 100}, values);
  w.enemies.push(b);
  return b;
}
function pose(b) { return {x: b.x, y: b.y, vx: b.vx === 0 ? 0 : b.vx, vy: b.vy === 0 ? 0 : b.vy, squash: b.squash}; }
function strike(w, b, speed = w.baseSpeed * .75) {
  Object.assign(w.player, {x: b.x - b.r - w.player.r + .1, y: b.y, vx: speed, vy: 0});
  w.collide(w.player, b);
}

test('feedback is opt-in and zero strength keeps the original launch and collision cadence', () => {
  const w = new World(900, 700, () => .5, {spawnInitial: false});
  w.spawnTimer = 999; w.floorTimer = Infinity; w.introTimer = Infinity;
  assert.equal(w.feedbackOptions.strength, 0);
  assert.ok(w.shoot(-w.maxPull, 0));
  assert.equal(w.player.feedbackFreeze, 0);
  const start = w.player.x;
  w.step(.01);
  assert.ok(w.player.x > start);
  const b = enemy(w, 500, 300, {hp: 1});
  strike(w, b);
  assert.equal(w.events.find(e => e.type === 'kill').freezeDuration, 0);
});

test('a damaging nonlethal contact freezes only its pair while other bodies and spawning advance', () => {
  const w = run(), b = enemy(w, 300, 300, {hp: 150, maxHp: 150});
  const other = enemy(w, 650, 500, {vx: 40});
  strike(w, b);
  const hit = w.events.find(e => e.type === 'hit');
  assert.ok(hit.damage >= b.maxHp * .3 && hit.damage < b.maxHp);
  near(hit.freezeDuration, .025);
  const player = pose(w.player), victim = pose(b), startOther = other.x;
  w.spawnTimer = .005;
  w.step(.01);
  assert.deepEqual(pose(w.player), player);
  assert.deepEqual(pose(b), victim);
  assert.ok(other.x > startOther);
  near(w.time, .01);
  assert.equal(w.enemies.length, 3);
  const hp = b.hp;
  w.collide(w.player, b);
  assert.equal(b.hp, hp);
  assert.equal(w.events.filter(e => e.type === 'hit').length, 1);
});

test('small hits have no hold or flash while actual kills keep their established flash', () => {
  const w = run(), b = enemy(w, 300, 300, {hp: 1000, maxHp: 1000});
  strike(w, b, w.baseSpeed * .3);
  const hit = w.events.find(e => e.type === 'hit');
  assert.ok(hit.damage > 0 && hit.damage < 100);
  near(hit.freezeDuration, 0);
  assert.equal(hit.hitTier, 'light'); near(b.hitAlpha, 0);
  w.damage(b, 1000);
  near(b.hitAlpha, 1);
});

test('real contacts halve only light-hit squash without changing impulses and retain lethal squash', () => {
  const captures = [];
  for (const [maxHp, hp] of [[10000, 10000], [500, 500], [150, 150], [10000, 1]]) {
    const w = run(), b = enemy(w, 300, 300, {maxHp, hp});
    strike(w, b);
    const hit = w.events.find(e => e.type === 'hit');
    captures.push({w, b, hit});
  }
  const [light, medium, heavy, lethal] = captures;
  assert.deepEqual(captures.slice(0, 3).map(c => c.hit.hitTier), ['light', 'medium', 'heavy']);
  near(light.w.player.squash * 2, medium.w.player.squash);
  near(light.b.squash * 2, medium.b.squash);
  near(medium.w.player.squash, heavy.w.player.squash);
  near(lethal.w.player.squash, heavy.w.player.squash);
  near(lethal.b.squash, heavy.b.squash);
  for (const other of [medium, heavy]) {
    near(light.w.player.vx, other.w.player.vx); near(light.w.player.vy, other.w.player.vy);
    near(light.b.vx, other.b.vx); near(light.b.vy, other.b.vy);
  }
  near(light.b.hitAlpha, 0); near(medium.b.hitAlpha, medium.hit.damage / medium.b.maxHp);
  near(light.hit.freezeDuration, 0); near(medium.hit.freezeDuration, 0); near(heavy.hit.freezeDuration, .025);
  assert.equal(lethal.hit.lethal, true);
  near(lethal.w.events.find(e => e.type === 'kill').freezeDuration, .048);
});

test('ordinary damage boundaries do not change old campaign flashes or hold timings', () => {
  for (const [damage, tier, hold] of [[99, 'light', 0], [100, 'medium', 0], [299, 'medium', 0], [300, 'heavy', .025]]) {
    const w = run(), b = enemy(w, 300, 300, {hp: 1000, maxHp: 1000});
    const feedback = w.damage(b, damage);
    assert.equal(feedback.hitTier, tier); near(feedback.freezeDuration, hold);
    near(b.hitAlpha, tier === 'light' ? 0 : damage / 1000);
  }
  const campaign = new CampaignWorld(900, 700, 1, () => .5);
  campaign.setFeedbackOptions({strength: .6});
  const b = campaign.enemies[0]; Object.assign(b, {hp: 1000, maxHp: 1000, born: 1, solid: true});
  const feedback = campaign.damage(b, 1);
  near(b.hitAlpha, .15 + .35 / 1000);
  assert.notEqual(feedback.hitTier, 'light'); near(feedback.freezeDuration, 0);
});

test('v7.2 leaves default Boss hit and stun holds at sixty and ninety milliseconds', () => {
  for (const enteringStun of [false, true]) {
    const w = run(.6); w.stage = 5; w.beginBoss(); w.step(BOSS_TIMING.entry);
    const b = w.boss, p = w.player;
    if (enteringStun) b.r = b.minRadius + .01;
    Object.assign(p, {x: b.x, y: b.y + b.r + p.r - .1, vx: 0, vy: -w.baseSpeed});
    w.collideBoss();
    const hit = w.events.find(e => e.type === 'bossHit');
    near(hit.freezeDuration, enteringStun ? .09 : .06);
    assert.ok(b.squash > 0 && p.squash > 0, 'Boss collision deformation stays unchanged');
  }
});

test('kill event preserves incoming impact and a contact snapshot alongside combo credit', () => {
  const w = run(), b = enemy(w, 300, 300, {hp: 1, value: 23});
  const incoming = w.baseSpeed * .75;
  strike(w, b, incoming);
  const kill = w.events.find(e => e.type === 'kill');
  assert.equal(kill.bodyId, b.id);
  assert.equal(kill.feedbackLevel, 1);
  near(kill.freezeDuration, .08 * .6);
  near(kill.impactVx, incoming); near(kill.impactVy, 0); near(kill.impactSpeed, incoming);
  near(kill.nx, 1); near(kill.ny, 0);
  near(kill.contactX, b.x - b.r); near(kill.contactY, b.y);
  assert.equal(kill.bodySnapshot.id, b.id);
  assert.equal(kill.bodySnapshot.squash, b.squash);
  assert.equal(w.score, 10);
  w.step(.01);
  assert.equal(w.enemies.length, 0);
  assert.equal(w.score, 10);
});

test('freeze uses partial-step remainders and cannot round beyond the allocated hold', () => {
  const a = run(1), b = run(1);
  for (const w of [a, b]) {
    w.player.vx = 100;
    near(w.freezeFeedback(w.player, .017, {scaled: false}), .017);
  }
  a.step(.03);
  b.step(.017); b.step(.013);
  near(a.player.feedbackFreeze, 0); near(b.player.feedbackFreeze, 0);
  near(a.player.vx, b.player.vx); near(a.player.vx, 100 * Math.exp(-1.20 * .013));
  // The scheduler now subdivides battle into at most 1/120 s. The .017 hold
  // ends inside different substeps; each path must integrate its exact live
  // remainder rather than rounding the hold to a whole simulation step.
  near(a.player.x, 200 + 100 * Math.exp(-1.20 * .008) * .008 + a.player.vx * .005);
  near(b.player.x, 200 + 100 * Math.exp(-1.20 / 120) / 120 + b.player.vx * (.013 - 1 / 120));
});

test('single-shot holds share 250 ms including anticipation; only a successful shot resets it', () => {
  const w = run(1);
  w.shoot(-w.maxPull, 0);
  near(w.feedbackFreezeUsed, .033);
  const start = pose(w.player);
  w.step(.033);
  assert.deepEqual(pose(w.player), start);
  const values = [];
  for (let i = 0; i < 5; i++) {
    const b = enemy(w, 600, 500, {hp: 1, value: 10});
    const feedback = w.damage(b, 1);
    values.push(feedback.freezeDuration);
    w.step(feedback.freezeDuration);
  }
  assert.deepEqual(values.slice(0, 2), [.08, .1]);
  near(values[2], .037);
  near(values[3], 0); near(values[4], 0);
  near(w.feedbackFreezeUsed, .25);
  assert.equal(w.score, 210);
  w.player.vx = w.player.vy = 0;
  assert.equal(w.shoot(1, 0), false);
  assert.equal(w.feedbackKills, 5); near(w.feedbackFreezeUsed, .25);
  assert.equal(w.shoot(-w.maxPull, 0), true);
  assert.equal(w.feedbackKills, 0); near(w.feedbackFreezeUsed, .033);
});

test('simultaneous pulse kills share one hold and still carry distinct visual levels and radial contacts', () => {
  const w = run(1); w.buffs.pulse = 1;
  const hit = enemy(w, 300, 300, {hp: 1});
  const neighbor = enemy(w, 365, 330, {hp: 1});
  strike(w, hit);
  const kills = w.events.filter(e => e.type === 'kill');
  assert.equal(kills.length, 2);
  assert.deepEqual(kills.map(e => e.feedbackLevel), [1, 2]);
  assert.equal(kills[1].source, 'pulse');
  near(kills[1].nx, (neighbor.x - hit.x) / Math.hypot(neighbor.x - hit.x, neighbor.y - hit.y));
  near(w.feedbackFreezeUsed, .1);
  near(w.player.feedbackFreeze, .1);
  assert.equal(w.score, 30);
});

test('reduced motion caps each hold at 50 ms and switching feedback off releases held bodies', () => {
  const w = run(1, true), b = enemy(w, 300, 300, {hp: 1});
  strike(w, b);
  near(w.events.find(e => e.type === 'kill').freezeDuration, .05);
  assert.ok(w.player.feedbackFreeze <= .05);
  w.setFeedbackOptions({strength: 0, reducedMotion: true});
  near(w.player.feedbackFreeze, 0); near(b.feedbackFreeze, 0);
  const x = w.player.x;
  w.step(.01);
  assert.notEqual(w.player.x, x);
});

test('campaign shares feedback metadata and preserves its finite kills and upgrade rules', () => {
  const w = new CampaignWorld(900, 700, 1, () => .5);
  w.setFeedbackOptions({strength: .6}); w.spawnTimer = 999; w.floorTimer = Infinity; w.introTimer = Infinity;
  const b = w.enemies[0]; Object.assign(b, {born: 1, solid: true, x: 300, y: 300});
  strike(w, b);
  const kill = w.events.find(e => e.type === 'kill');
  assert.equal(kill.value, 0); assert.equal(kill.bodyId, b.id);
  near(kill.freezeDuration, .048);
  assert.equal(w.kills, 1); assert.equal(w.upgrades, 0); assert.equal(w.score, 0);
  w.damage(b, 1e6);
  assert.equal(w.kills, 1);
});

test('boss contact holds freeze player motion and inflation while the world clock keeps running', () => {
  const w = run(1); w.stage = 5; w.beginBoss();
  w.step(BOSS_TIMING.entry);
  const b = w.boss, p = w.player;
  Object.assign(p, {x: b.x, y: b.y + b.r + p.r - .1, vx: 0, vy: -w.baseSpeed});
  w.collideBoss();
  const hit = w.events.find(e => e.type === 'bossHit');
  near(hit.freezeDuration, .1);
  assert.equal(hit.bodyId, b.id); near(hit.impactVy, -w.baseSpeed);
  const radius = b.r, player = pose(p), time = w.time;
  w.step(.04);
  near(b.r, radius); assert.deepEqual(pose(p), player); near(w.time - time, .04);
  const score = w.score;
  w.collideBoss(); near(b.r, radius); assert.equal(w.score, score);
});

test('entering boss stun extends the same contact to 150 ms without double charging the shot', () => {
  const w = run(1); w.stage = 5; w.beginBoss(); w.step(BOSS_TIMING.entry);
  const b = w.boss, p = w.player;
  b.r = b.minRadius + .01;
  Object.assign(p, {x: b.x, y: b.y + b.r + p.r - .1, vx: 0, vy: -w.baseSpeed});
  w.collideBoss();
  const stunned = w.events.find(e => e.type === 'bossStunned');
  assert.ok(b.stunned); assert.ok(b.hp > 0);
  near(stunned.freezeDuration, .15); near(w.feedbackFreezeUsed, .15);
  near(w.events.find(e => e.type === 'bossHit').freezeDuration, .15);
  const hp = b.hp; w.step(.04); assert.equal(b.hp, hp); near(b.stunnedTime, 0);
});

test('winning contacts finish their hold before the established upgrade placement starts', () => {
  const w = run(1), b = enemy(w, 300, 300, {hp: 1});
  w.stageKills = w.killTarget - 1;
  strike(w, b);
  assert.equal(w.phase, 'clearing');
  const x = w.player.x, y = w.player.y;
  w.step(.04);
  near(w.player.x, x); near(w.player.y, y);
  w.step(.06);
  assert.ok(w.phaseTime > 0);
  assert.ok(w.player.x !== x || w.player.y !== y);
  assert.equal(w.enemies.length, 0);
});

test('wall metadata carries the contact side and earned bank stack', () => {
  const w = run(); w.buffs.bank = 1;
  Object.assign(w.player, {x: 1, y: 300, vx: -300, vy: 0});
  w.wall(w.player);
  const wall = w.events.find(e => e.type === 'wall');
  assert.equal(wall.bodyId, w.player.id); near(wall.nx, -1); near(wall.ny, 0);
  assert.equal(wall.bank, 1); near(wall.impactSpeed, 300);
  near(length(w.player), 285);
});
