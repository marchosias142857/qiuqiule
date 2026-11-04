import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, campaignUpgradeChoices, levelConfig} from '../dist/campaign.js';
import {poolParams, poolLayout, poolAimTargets} from '../dist/classes/pool.js';

const fresh = (k = 0, width = 390, height = 844, upgradeId = null) => new CampaignWorld(width, height, 10 * k + 4, () => .51, {upgradeId});
const advance = (world, seconds) => { for (let i = 0; i < Math.ceil(seconds * 120); i++) world.step(1 / 120); };
const targetAtPocket = (world, ball, pocket, speed = 8) => {
  const cx = (world.arenaBounds.left + world.arenaBounds.right) / 2, cy = (world.arenaBounds.top + world.arenaBounds.bottom) / 2;
  const dx = cx - pocket.x, dy = cy - pocket.y, d = Math.hypot(dx, dy), nx = dx / d, ny = dy / d;
  Object.assign(ball, {x: pocket.x + nx * (pocket.r + 1), y: pocket.y + ny * (pocket.r + 1),
    vx: -nx * speed * world.unit, vy: -ny * speed * world.unit});
};

test('pool uses all ten exact PDF parameter tiers and class-filtered pre-level choices', () => {
  for (let k = 0; k < 10; k++) {
    const c = levelConfig(k * 10 + 4), p = poolParams(k);
    assert.equal(c.type, 'pool'); assert.equal(c.k, k); assert.equal(c.r, 4); assert.equal(c.legacy, false);
    assert.equal(p.targetBalls, 7 + Math.floor(k / 2));
    assert.equal(p.budget, p.targetBalls + 4 - Math.floor(k / 3));
    assert.equal(p.scratchPenalty, k >= 5 ? 2 : 1);
    assert.equal(p.ballRadius, .95); assert.equal(p.pocketRadius, 1.35); assert.equal(p.pocketSpeedLimit, 30);
    assert.equal(p.drag, .3); assert.equal(p.restitution, .95);
    const choices = campaignUpgradeChoices(k * 10 + 4, () => .5);
    assert.equal(choices.length, 2); assert.notEqual(choices[0].id, choices[1].id);
    assert.ok(choices.every(choice => ['density', 'rubber', 'bank', 'steady'].includes(choice.id)));
  }
});

test('six pockets, finite balls and nonoverlapping deterministic racks fit all ten tiers on mobile and desktop', () => {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [568, 320], [1440, 900]]) for (let k = 0; k < 10; k++) {
    const w = fresh(k, width, height), p = poolParams(k), bounds = w.arenaBounds;
    assert.equal(w.zones.length, 6); assert.equal(w.enemies.length, p.targetBalls);
    assert.equal(w.player.r, w.unit); assert.ok(bounds.top >= (height > 520 ? 128 : 86));
    for (const zone of w.zones) {
      assert.equal(zone.kind, 'pocket'); assert.equal(zone.r, w.unit * 1.35);
      assert.ok(zone.x - zone.r >= bounds.left - 1e-8 && zone.x + zone.r <= bounds.right + 1e-8);
      assert.ok(zone.y - zone.r >= bounds.top - 1e-8 && zone.y + zone.r <= bounds.bottom + 1e-8);
    }
    for (let i = 0; i < w.enemies.length; i++) {
      const ball = w.enemies[i]; assert.equal(ball.r, w.unit * .95); assert.equal(ball.mass, w.player.mass);
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
    advance(w, 4.1);
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

test('rating preserves the exact PDF ordering including the empty two-point band at k9', () => {
  for (let k = 0; k < 10; k++) {
    const w = fresh(k), p = poolParams(k); w.enemies = [];
    w.shotsUsed = p.targetBalls; assert.equal(w.rules.rating(), 3);
    w.shotsUsed = p.budget; assert.equal(w.rules.rating(), 1);
    w.shotsUsed = p.budget - 1; assert.equal(w.rules.rating(), p.budget - 1 <= p.targetBalls ? 3 : 2);
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
  assert.ok(w.enemies.every(body => Math.abs(body.r - w.unit * .95) < 1e-8));
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
      for (let i = 0; i < 125 && w.shotActive; i++) w.step(1 / 30);
    }
    advance(w, 1);
    assert.equal(w.completed, false); assert.equal(w.remaining, 0); assert.equal(w.phase, 'over');
    assert.equal(w.events.filter(event => event.type === 'over').length, 1);
    assert.equal(w.resultRating, 0);
  }
});

// Exact-double routes found with a one-shot lookahead bot and then independently
// replayed from a new world. No target deletion, direct damage or pocket calls
// occur in these reachability checks. Each run chooses a real offered upgrade.
const POOL_ROUTES = [
  {"k":0,"width":390,"height":844,"upgrade":"steady","moves":[[-1.57287989520032,1],[-2.290770976283442,0.65],[5.759586531581288,1],[0.5462966000003179,0.65]]},
  {"k":1,"width":390,"height":844,"upgrade":"steady","moves":[[-1.57287989520032,1],[-2.290770976283442,0.65],[5.759586531581288,1],[0.5462966000003179,0.65]]},
  {"k":2,"width":390,"height":844,"upgrade":"steady","moves":[[-1.5683408972535906,1],[-0.7351680411316363,1],[1.0471975511965976,1],[4.537856055185257,0.65]]},
  {"k":3,"width":390,"height":844,"upgrade":"steady","moves":[[-1.5732517563362027,1],[-1.3825766634558634,1],[2.772276019252103,1],[-0.7567617689374116,0.35]]},
  {"k":4,"width":390,"height":844,"upgrade":"steady","moves":[[-1.57287989520032,1],[3.6651914291880923,1],[0.8567567196769079,0.65],[3.8397243543875246,0.65],[1.0259370439649598,0.65]]},
  {"k":5,"width":390,"height":844,"upgrade":"steady","moves":[[-1.57287989520032,1],[3.6651914291880923,1],[0.8567567196769079,0.65],[3.8397243543875246,0.65],[1.0259370439649598,0.65]]},
  {"k":6,"width":390,"height":844,"upgrade":"steady","moves":[[-1.4929892256779493,1],[2.32184154495324,1],[-1.817614276577552,1],[-0.29510253575431655,0.65],[-1.7025771007144075,0.35],[4.886921905584122,0.65],[1.458357338936814,0.35]]},
  {"k":7,"width":390,"height":844,"upgrade":"steady","moves":[[-1.4929892256779493,1],[2.32184154495324,1],[-1.817614276577552,1],[-0.29510253575431655,0.65],[-1.7025771007144075,0.35],[4.886921905584122,0.65],[1.458357338936814,0.35]]},
  {"k":8,"width":390,"height":844,"upgrade":"steady","moves":[[5.585053606381854,1],[-2.250577872601308,1],[-1.2073225256429754,1],[3.316125578789226,1],[-1.4975456808675929,0.65],[1.1879172362449564,0.65]]},
  {"k":9,"width":390,"height":844,"upgrade":"steady","moves":[[3.490658503988659,1],[-1.7328804758039211,1],[2.4777064192716285,1],[0.8726646259971648,1],[3.6651914291880923,0.65],[2.0093777411111855,0.65]]},
  {"k":0,"width":844,"height":390,"upgrade":"steady","moves":[[0.3490658503988659,1],[2.566154409424916,1],[2.0620366652696314,1]]},
  {"k":1,"width":844,"height":390,"upgrade":"steady","moves":[[0.3490658503988659,1],[2.566154409424916,1],[2.0620366652696314,1]]},
  {"k":2,"width":844,"height":390,"upgrade":"steady","moves":[[-0.015212900240844113,1],[0.5235987755982988,0.65],[6.1086523819801535,1],[-3.0801359567578963,0.65]]},
  {"k":3,"width":844,"height":390,"upgrade":"steady","moves":[[-0.015212900240844113,1],[1.2934544611380163,1],[-3.0067919919995187,0.65]]},
  {"k":4,"width":844,"height":390,"upgrade":"steady","moves":[[-0.015541040325343744,1],[1.3962634015954636,1],[6.529353414804817e-06,0.65],[-3.040516590340471,0.35],[2.9670597283903604,0.65],[2.8113393903764163,0.35]]},
  {"k":5,"width":844,"height":390,"upgrade":"steady","moves":[[-0.015541040325343744,1],[1.3962634015954636,1],[6.529353414804817e-06,0.65],[-3.040516590340471,0.35],[2.9670597283903604,0.65],[2.8113393903764163,0.35]]},
  {"k":6,"width":844,"height":390,"upgrade":"steady","moves":[[0.07229105859178823,1],[-2.57182342721119,1],[0,1],[3.1339094130750036,0.65],[-0.35507462068488255,0.65]]},
  {"k":7,"width":844,"height":390,"upgrade":"steady","moves":[[0.07229105859178823,1],[-2.57182342721119,1],[0,1],[3.1339094130750036,0.65],[-0.35507462068488255,0.65]]},
  {"k":8,"width":844,"height":390,"upgrade":"steady","moves":[[0.07229105859178823,1],[-2.0423859288992587,1],[4.886921905584122,0.65],[0,1],[5.585053606381854,1],[-1.3512141776613604,0.35]]},
  {"k":9,"width":844,"height":390,"upgrade":"steady","moves":[[-0.12217543241872852,1],[4.537856055185257,1],[0.15536984846821167,1],[0.5636286902367506,1],[-3.077589160700142,0.65],[-0.20635505042178864,0.65]]},
  {"k":0,"width":390,"height":844,"upgrade":"density","moves":[[-1.6222417958464304,1],[5.934119456780721,1],[1.5489177265238125,1]]},
  {"k":0,"width":390,"height":844,"upgrade":"rubber","moves":[[-1.57287989520032,1],[4.363323129985824,1],[1.6539975178273367,0.35],[0.6238721957025941,0.35]]},
  {"k":0,"width":390,"height":844,"upgrade":"bank","moves":[[-1.57287989520032,1],[-2.2907709762834427,0.65],[0.5235987755982988,1]]}
];

test('all ten pool tiers clear through real launches in portrait and landscape, plus each teaching upgrade', () => {
  for (const route of POOL_ROUTES) {
    const w = fresh(route.k, route.width, route.height, route.upgrade);
    assert.equal(w.upgradeId, route.upgrade);
    for (const [angle, power] of route.moves) {
      assert.equal(w.shoot(-Math.cos(angle) * w.maxPull * power, -Math.sin(angle) * w.maxPull * power), true);
      for (let i = 0; i < 125 && w.shotActive; i++) w.step(1 / 30);
    }
    advance(w, 3);
    assert.equal(w.completed, true, `tier ${route.k}, ${route.width}×${route.height}, ${route.upgrade}`);
    assert.equal(w.phase, 'over'); assert.equal(w.enemies.length, 0);
    assert.equal(w.poolPotted, poolParams(route.k).targetBalls);
    assert.ok(w.shotsUsed + w.poolScratches * poolParams(route.k).scratchPenalty <= w.budget);
    assert.equal(w.events.filter(event => event.type === 'campaignPeak').length, 1);
    assert.equal(w.events.filter(event => event.type === 'over').length, 1);
    const captures = w.events.filter(event => event.type === 'campaignPocket' && !event.player);
    assert.equal(captures.length, poolParams(route.k).targetBalls);
    assert.equal(new Set(captures.map(event => event.bodyId)).size, captures.length);
  }
});

// Separate routes account for launch/impact feedback holds and the production
// real-time 120 Hz scheduler. A route tuned with feedback disabled is not a
// reliable fixed-angle replay with those holds enabled; both paths stay tested.
const POOL_FEEDBACK_ROUTES = [
  {"k":0,"width":390,"height":844,"upgrade":"steady","moves":[[-1.6222417958464304,1],[1.0895699381041235,0.65],[3.316125578789226,1],[-1.8592140091782088,0.65]]},
  {"k":1,"width":390,"height":844,"upgrade":"steady","moves":[[-1.6222417958464304,1],[1.0895699381041235,0.65],[3.316125578789226,1],[-1.8592140091782088,0.65]]},
  {"k":2,"width":390,"height":844,"upgrade":"steady","moves":[[-1.586078264741572,1],[5.759586531581288,0.65],[3.490658503988659,1],[0.833010001232158,0.65],[1.635421746725162,1]]},
  {"k":3,"width":390,"height":844,"upgrade":"steady","moves":[[-1.6222417958464304,1],[1.3109862361629978,1],[1.4096652556810871,1],[-1.671647114661865,0.65]]},
  {"k":4,"width":390,"height":844,"upgrade":"steady","moves":[[-1.6222417958464304,1],[2.9670597283903604,1],[5.759586531581288,1],[0.6981317007977318,1]]},
  {"k":5,"width":390,"height":844,"upgrade":"steady","moves":[[-1.6222417958464304,1],[2.9670597283903604,1],[5.759586531581288,1],[0.6981317007977318,1]]},
  {"k":6,"width":390,"height":844,"upgrade":"steady","moves":[[5.585053606381854,1],[4.537856055185257,1],[5.410520681182422,1],[0.9395139429206489,0.65],[-1.3429898332954862,0.65],[-2.1990098388433093,0.35],[0.4427801330015414,0.35]]},
  {"k":7,"width":390,"height":844,"upgrade":"steady","moves":[[5.585053606381854,1],[4.537856055185257,1],[5.410520681182422,1],[0.9395139429206489,0.65],[-1.3429898332954862,0.65],[-2.1990098388433093,0.35],[0.4427801330015414,0.35]]},
  {"k":8,"width":390,"height":844,"upgrade":"steady","moves":[[5.585053606381854,1],[-1.8184552743119164,1],[0.3905365160204202,1],[4.537856055185257,0.65],[-2.0060468107133316,0.35],[1.9452132193165994,0.35]]},
  {"k":9,"width":390,"height":844,"upgrade":"steady","moves":[[-2.2911321183431403,1],[-2.3406772577866732,1],[4.537856055185257,1],[1.242593179865393,0.65],[0.41579161416058424,1]]},
  {"k":0,"width":844,"height":390,"upgrade":"steady","moves":[[-0.015541040325343744,1],[1.0471975511965976,1],[0.8081117319979384,0.35],[3.057558952177651,1]]},
  {"k":1,"width":844,"height":390,"upgrade":"steady","moves":[[-0.015541040325343744,1],[1.0471975511965976,1],[0.8081117319979384,0.35],[3.057558952177651,1]]},
  {"k":2,"width":844,"height":390,"upgrade":"steady","moves":[[-0.015212900240844113,1],[1.9606774064693018,1],[5.410520681182422,1],[-0.10181977574269666,0.65]]},
  {"k":3,"width":844,"height":390,"upgrade":"steady","moves":[[3.490658503988659,1],[0.169534443877876,1],[-2.881098934036431,1],[-3.0726455740853247,0.65]]},
  {"k":4,"width":844,"height":390,"upgrade":"steady","moves":[[-0.015541040325343744,1],[1.0471975511965976,1],[0.7812943751388046,0.35],[2.7986401342094362,1]]},
  {"k":5,"width":844,"height":390,"upgrade":"steady","moves":[[-0.015541040325343744,1],[1.0471975511965976,1],[0.7812943751388046,0.35],[2.7986401342094362,1]]},
  {"k":6,"width":844,"height":390,"upgrade":"steady","moves":[[-0.07229105859178823,1],[2.3529665998474707,1],[1.3962634015954636,1],[0.8726646259971648,1],[2.95462506568872,0.35]]},
  {"k":7,"width":844,"height":390,"upgrade":"steady","moves":[[-0.07229105859178823,1],[2.3529665998474707,1],[1.3962634015954636,1],[0.8726646259971648,1],[2.95462506568872,0.35]]},
  {"k":8,"width":844,"height":390,"upgrade":"steady","moves":[[0.045344572737694384,1],[-0.9239052442892483,1],[1.0471975511965976,1],[-2.9043125562461776,0.65],[1.6530156984635882,1]]},
  {"k":9,"width":844,"height":390,"upgrade":"steady","moves":[[-0.04581767917505704,1],[0.01791851695725953,1],[1.9686468633478995,1],[-0.04137187095961499,1],[5.759586531581288,1]]},
  {"k":0,"width":390,"height":844,"upgrade":"density","moves":[[-1.670774423745264,1],[3.8397243543875246,1],[5.410520681182422,0.35],[1.1300937494766832,0.35]]},
  {"k":0,"width":390,"height":844,"upgrade":"rubber","moves":[[-1.6222417958464304,1],[3.6651914291880923,1],[1.5707963267948966,0.65]]},
  {"k":0,"width":390,"height":844,"upgrade":"bank","moves":[[-1.6222417958464304,1],[3.490658503988659,1],[1.7782669714228343,1]]}
];

test('all pool tiers and teaching upgrades clear with normal feedback and real 120Hz scaled scheduling', () => {
  let slowSteps = 0;
  const realStep = world => {
    const scale = world.presentationTimeScale;
    if (scale < 1) slowSteps++;
    world.step(scale / 120, false, {timeScale: scale});
  };
  for (const route of POOL_FEEDBACK_ROUTES) {
    const w = fresh(route.k, route.width, route.height, route.upgrade);
    w.setFeedbackOptions({strength: .6, reducedMotion: false});
    for (const [angle, power] of route.moves) {
      assert.equal(w.shoot(-Math.cos(angle) * w.maxPull * power, -Math.sin(angle) * w.maxPull * power), true);
      assert.ok(w.player.feedbackFreeze > 0, 'production launch feedback is active');
      for (let i = 0; i < 1200 && w.shotActive; i++) realStep(w);
    }
    for (let i = 0; i < 300 && w.phase !== 'over'; i++) realStep(w);
    assert.equal(w.completed, true, `normal feedback tier ${route.k}, ${route.width}×${route.height}, ${route.upgrade}`);
    assert.equal(w.phase, 'over'); assert.equal(w.enemies.length, 0);
    assert.equal(w.poolPotted, poolParams(route.k).targetBalls);
    assert.ok(w.shotsUsed + w.poolScratches * poolParams(route.k).scratchPenalty <= w.budget);
    assert.equal(w.events.filter(event => event.type === 'campaignPeak').length, 1);
    assert.equal(w.events.filter(event => event.type === 'over').length, 1);
    const captures = w.events.filter(event => event.type === 'campaignPocket' && !event.player);
    assert.equal(captures.length, poolParams(route.k).targetBalls);
    assert.equal(new Set(captures.map(event => event.bodyId)).size, captures.length);
    assert.ok(w.feedbackTime >= w.time);
  }
  assert.ok(slowSteps > 0, 'double pockets and the final pocket exercise real-time slow motion');
});
