import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CampaignWorld, campaignUpgradeChoices, levelConfig} from '../dist/campaign.js';
import {POOL_LEVELS, poolParams, poolLayout, poolAimTargets} from '../dist/classes/pool.js';

const fresh = (k = 0, width = 390, height = 844, upgradeId = null, variant = 0) => new CampaignWorld(width, height, 10 * k + 3 + variant, () => .51, {upgradeId});
const advance = (world, seconds) => { for (let i = 0; i < Math.ceil(seconds * 120); i++) world.step(1 / 120); };
const targetAtPocket = (world, ball, pocket, speed = 8) => {
  const cx = (world.arenaBounds.left + world.arenaBounds.right) / 2, cy = (world.arenaBounds.top + world.arenaBounds.bottom) / 2;
  const dx = cx - pocket.x, dy = cy - pocket.y, d = Math.hypot(dx, dy), nx = dx / d, ny = dy / d;
  Object.assign(ball, {x: pocket.x + nx * (pocket.r + 1), y: pocket.y + ny * (pocket.r + 1),
    vx: -nx * speed * world.unit, vy: -ny * speed * world.unit});
};

test('pool uses all ten revised chapter parameter tiers and class-filtered pre-level choices', () => {
  for (let k = 0; k < 10; k++) {
    const c = levelConfig(k * 10 + 3), p = poolParams(k);
    assert.equal(c.type, 'pool'); assert.equal(c.k, k); assert.equal(c.r, 4); assert.equal(c.legacy, false);
    assert.equal(p.targetBalls, POOL_LEVELS[k * 2].balls.length);
    assert.equal(p.budget, p.targetBalls + 3);
    assert.equal(p.scratchPenalty, k >= 5 ? 2 : 1);
    assert.equal(p.ballRadius, .62); assert.equal(p.pocketRadius, 1.16 - .10 * k * 2 / 19); assert.equal(p.pocketSpeedLimit, 30);
    assert.equal(p.drag, .3); assert.equal(p.restitution, .95);
    const choices = campaignUpgradeChoices(k * 10 + 3, () => .5);
    assert.equal(choices.length, 2); assert.notEqual(choices[0].id, choices[1].id);
    assert.ok(choices.every(choice => ['density', 'rubber', 'bank', 'steady'].includes(choice.id)));
  }
});

test('six pockets, finite balls and nonoverlapping deterministic racks fit all ten tiers on mobile and desktop', () => {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [568, 320], [1440, 900]]) for (let k = 0; k < 10; k++) {
    const w = fresh(k, width, height), p = poolParams(k), bounds = w.arenaBounds;
    assert.equal(w.zones.length, 6); assert.equal(w.enemies.length, p.targetBalls);
    assert.equal(w.player.r, w.unit * .62); assert.ok(bounds.top >= (height > 520 ? 128 : 86));
    for (const zone of w.zones) {
      assert.equal(zone.kind, 'pocket'); assert.equal(zone.r, w.unit * p.pocketRadius);
      assert.ok(zone.x - zone.r >= bounds.left - 1e-8 && zone.x + zone.r <= bounds.right + 1e-8);
      assert.ok(zone.y - zone.r >= bounds.top - 1e-8 && zone.y + zone.r <= bounds.bottom + 1e-8);
    }
    for (let i = 0; i < w.enemies.length; i++) {
      const ball = w.enemies[i]; assert.equal(ball.r, w.unit * .62); assert.equal(ball.mass, w.player.mass);
      assert.equal(ball.hp, Infinity); assert.equal(ball.drag, .3);
      assert.ok(Math.hypot(ball.x - w.player.x, ball.y - w.player.y) > ball.r + w.player.r);
      for (let j = i + 1; j < w.enemies.length; j++) assert.ok(Math.hypot(ball.x - w.enemies[j].x, ball.y - w.enemies[j].y) >= ball.r * 2 - 1e-7);
      for (const zone of w.zones) assert.ok(Math.hypot(ball.x - zone.x, ball.y - zone.y) > zone.r);
    }
    assert.deepEqual(poolLayout(w).positions, poolLayout(w).positions);
  }
});

test('pool target impacts transfer momentum without lethal damage and idle aiming freezes all balls', () => {
  const w = fresh(), ball = w.enemies[0]; w.enemies = [ball];
  Object.assign(ball, {x: w.width / 2, y: 400, vx: 0, vy: 0});
  Object.assign(w.player, {x: ball.x, y: ball.y + ball.r + w.player.r + 2, vx: 0, vy: 0});
  w.shoot(0, w.maxPull * .7); advance(w, .04);
  assert.equal(ball.hp, Infinity); assert.ok(ball.vy < -w.unit * 15);
  assert.equal(w.poolPotted, 0); assert.equal(w.kills, 0);
  w.endLaunch(); const position = {x: ball.x, y: ball.y}; advance(w, 5);
  assert.deepEqual({x: ball.x, y: ball.y}, position);
});

test('only sub-threshold pocket entries capture; fast shots bounce and a pocket cannot count twice', () => {
  const w = fresh(), ball = w.enemies[0], pocket = w.zones[0];
  w.shoot(w.maxPull * .2, 0); targetAtPocket(w, ball, pocket, 40); advance(w, .02);
  assert.equal(w.poolPotted, 0); assert.equal(ball.hp, Infinity);
  assert.ok(w.events.some(event => event.type === 'campaignPocketReject' && event.bodyId === ball.id));
  targetAtPocket(w, ball, pocket, 8); w.zoneContacts.clear(); advance(w, .04);
  assert.equal(w.poolPotted, 1); assert.equal(ball.hp, 0);
  assert.equal(w.events.filter(event => event.type === 'campaignPocket' && event.bodyId === ball.id).length, 1);
  w.rules.onZone(ball, pocket); assert.equal(w.poolPotted, 1);
  const exact = fresh(), exactBall = exact.enemies[0]; exact.shoot(8, 0);
  Object.assign(exactBall, {x: exact.zones[0].x, y: exact.zones[0].y, vx: exact.unit * 30, vy: 0});
  exact.rules.onZone(exactBall, exact.zones[0], {impactVx: exactBall.vx, impactVy: 0});
  assert.equal(exact.poolPotted, 0, 'the speed gate is strictly less than 30u/s');
});

test('one-shot double pocket triggers one slow cue with ascending capture notes', () => {
  const w = fresh(); w.shoot(8, 0);
  targetAtPocket(w, w.enemies[0], w.zones[0]); targetAtPocket(w, w.enemies[1], w.zones[1]);
  advance(w, .05);
  assert.equal(w.poolPotted, 2); assert.equal(w.poolShotPockets, 2);
  assert.deepEqual(w.events.filter(event => event.type === 'campaignPocket' && !event.player).map(event => event.combo), [1, 2]);
  const cues = w.events.filter(event => event.type === 'campaignSlow'); assert.equal(cues.length, 1);
  assert.equal(cues[0].duration, .3); assert.equal(cues[0].kind, 'pool-double');
});

test('scratch charges one or two additional balls, waits for rolling targets, and safely returns once', () => {
  for (const k of [0, 4, 5, 9]) {
    const w = fresh(k), initial = w.remaining, pocket = w.zones[2];
    w.shoot(8, 0); targetAtPocket(w, w.player, pocket, 8);
    const target = w.enemies[0]; target.vx = w.unit * 10;
    advance(w, .04);
    assert.equal(w.poolScratches, 1); assert.equal(w.remaining, initial - 1 - poolParams(k).scratchPenalty);
    assert.equal(w.player.captured, true); assert.equal(w.shotActive, true);
    advance(w, 5.5);
    assert.equal(w.shotActive, false); assert.equal(w.player.captured, false);
    assert.equal(w.events.filter(event => event.type === 'campaignScratch').length, 1);
    for (const ball of w.enemies) assert.ok(Math.hypot(ball.x - w.player.x, ball.y - w.player.y) >= ball.r + w.player.r);
  }
});

test('final target wins with zero remaining budget even when cue scratches in the same step', () => {
  const w = fresh(9), ball = w.enemies[0]; w.enemies = [ball];
  w.remaining = 1; w.shotsUsed = w.budget - 1; w.shoot(8, 0);
  targetAtPocket(w, w.player, w.zones[2], 8); targetAtPocket(w, ball, w.zones[0], 8);
  advance(w, 2);
  assert.equal(w.completed, true); assert.equal(w.phase, 'over'); assert.equal(w.remaining, 0);
  assert.equal(w.resultRating, 1); assert.equal(w.events.filter(event => event.type === 'over').length, 1);
  assert.equal(w.events.filter(event => event.type === 'campaignPeak').length, 1);
});

test('rating uses nonempty three, two and one point bands in every chapter', () => {
  for (let k = 0; k < 10; k++) {
    const w = fresh(k), p = poolParams(k); w.enemies = [];
    w.shotsUsed = p.targetBalls; assert.equal(w.rules.rating(), 3);
    w.shotsUsed = p.budget; assert.equal(w.rules.rating(), 1);
    w.shotsUsed = p.budget - 1; assert.equal(w.rules.rating(), 2);
  }
});

test('rotation preserves captures, remaining targets, budget, body radii and capture clock', () => {
  const w = fresh(9), ball = w.enemies[0]; w.shoot(8, 0); targetAtPocket(w, ball, w.zones[0]); advance(w, .03);
  assert.equal(w.poolCaptures.length, 1);
  const at = w.poolCaptures[0].at, remaining = w.remaining, count = w.enemies.length;
  w.resize(844, 390);
  assert.equal(w.poolCaptures.length, 1); assert.equal(w.poolCaptures[0].at, at);
  assert.equal(w.remaining, remaining); assert.equal(w.enemies.length, count);
  assert.equal(w.poolCaptures[0].pocketX, w.zones[w.poolCaptures[0].pocketIndex].x);
  assert.ok(w.enemies.every(body => Math.abs(body.r - w.unit * .62) < 1e-8));
  advance(w, .25); assert.equal(w.poolCaptures.length, 0);
  assert.ok(poolAimTargets(w).every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test('all ten stationary pool racks remain separated through portrait-landscape rotation without automatic pockets', () => {
  for (let k = 0; k < 10; k++) {
    const w = fresh(k), remaining = w.remaining;
    for (const [width, height] of [[844, 390], [568, 320], [320, 568], [390, 844]]) {
      w.resize(width, height);
      const bodies = [w.player, ...w.enemies];
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - .001, `tier ${k} has no frozen overlapping pair at ${width}×${height}`);
      }
      assert.equal(w.enemies.length, poolParams(k).targetBalls);
      assert.equal(w.remaining, remaining); assert.equal(w.poolPotted, 0); assert.equal(w.poolScratches, 0);
      assert.ok(bodies.every(body => body.vx === 0 && body.vy === 0));
    }
  }
});

test('every pool tier loses once after real weak missed shots exhaust its budget', () => {
  for (let k = 0; k < 10; k++) {
    const w = fresh(k);
    while (w.phase === 'battle' && w.remaining > 0) {
      assert.equal(w.shoot(8, 0), true);
      for (let i = 0; i < 200 && w.shotActive; i++) w.step(1 / 30);
    }
    advance(w, 1);
    assert.equal(w.completed, false); assert.equal(w.remaining, 0); assert.equal(w.phase, 'over');
    assert.equal(w.events.filter(event => event.type === 'over').length, 1);
    assert.equal(w.resultRating, 0);
  }
});

// Frozen real-launch routes found with one-shot lookahead, independently replayed
// from a fresh world below. Every rank is covered in portrait and landscape,
// with feedback disabled and at the production default. No test route mutates
// positions, hit points, targets or budgets; only player input advances play.
const POOL_ROUTES = JSON.parse(readFileSync(new URL('./fixtures/v771-pool-routes.json', import.meta.url), 'utf8'));

test('89 real pool routes cover all twenty ranks, both orientations, both feedback settings and teaching offers', () => {
  assert.equal(POOL_ROUTES.length, 89);
  for (const width of [390, 844]) for (const strength of [0, .6])
    assert.equal(new Set(POOL_ROUTES.filter(route => route.width === width && route.strength === strength && route.upgrade === 'steady')
      .map(route => route.rank20)).size, 20);
  assert.deepEqual([...new Set(POOL_ROUTES.map(route => route.upgrade))].sort(), ['bank', 'density', 'rubber', 'steady']);
  for (const route of POOL_ROUTES) {
    const w = fresh(route.rank20 >> 1, route.width, route.height, route.upgrade, route.rank20 % 2)
      .setFeedbackOptions({strength: route.strength, reducedMotion: false});
    const realStep = () => {
      const scale = w.presentationTimeScale;
      w.step(scale / 120, false, {timeScale: scale});
    };
    for (const [angle, power] of route.moves) {
      assert.equal(w.shoot(-Math.cos(angle) * w.maxPull * power, -Math.sin(angle) * w.maxPull * power), true);
      for (let i = 0; i < 1800 && w.shotActive && w.phase === 'battle'; i++) realStep();
    }
    for (let i = 0; i < 300 && w.phase !== 'over'; i++) realStep();
    const label = `rank ${route.rank20}, ${route.width}×${route.height}, ${route.upgrade}, feedback ${route.strength}`;
    assert.equal(w.completed, true, label); assert.equal(w.phase, 'over', label);
    assert.equal(w.enemies.length, 0); assert.equal(w.poolPotted, w.config.targetBalls);
    assert.ok(w.shotsUsed + w.poolScratches * w.config.scratchPenalty <= w.budget);
    const cost = w.shotsUsed + w.poolScratches;
    assert.equal(w.resultRating, cost <= w.config.threePointShots ? 3 : cost <= w.config.twoPointShots ? 2 : 1);
    assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
    assert.equal(w.events.filter(e => e.type === 'over').length, 1);
    const captures = w.events.filter(e => e.type === 'campaignPocket' && !e.player);
    assert.equal(captures.length, w.config.targetBalls);
    assert.equal(new Set(captures.map(e => e.bodyId)).size, captures.length);
  }
});
