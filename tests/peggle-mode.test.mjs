import test from 'node:test';
import assert from 'node:assert/strict';
import {peggleParams, peggleLayout, createPeggleRules} from '../dist/classes/peggle.js';
import {CampaignWorld} from '../dist/campaign.js';

function realShot(world, angle, power = 1) {
  assert.equal(world.shoot(-Math.cos(angle) * world.maxPull * power, -Math.sin(angle) * world.maxPull * power), true);
  for (let frame = 0; frame < 500 && world.shotActive && world.phase === 'battle'; frame++) world.step(1 / 120);
  assert.equal(world.shotActive, false);
}

function fixture(k = 0, width = 390, height = 844) {
  const unit = Math.max(18, Math.min(34, Math.min(width, height) * .047));
  const world = {width, height, unit, config: {k, ...peggleParams(k)}, statics: [], zones: [], events: [],
    arenaBounds: {left: 16, right: width - 16, top: 16, bottom: height - 16},
    player: {x: width / 2, y: height * .83, r: unit, vx: 0, vy: 0}, score: 0, shotActive: true,
    addStatic(spec) { const pin = {...spec, id: this.statics.length + 1}; this.statics.push(pin); return pin; },
    addZone(spec) { const zone = {...spec, id: this.zones.length + 100}; this.zones.push(zone); return zone; },
    emit(type, data = {}) { this.events.push({type, ...data}); },
    awardCampaignPoints(value, data) { this.score += value; this.emit('campaignPoints', {...data, value}); },
    grantFreeBall(zone) { if (zone.granted) return false; zone.granted = true; this.remaining++; this.emit('campaignFreeBall'); return true; },
    endLaunch() { this.shotActive = false; this.rules.onLaunchEnd(); },
  };
  world.rules = createPeggleRules(world); world.rules.setup(k); return world;
}

test('peggle has all ten PDF tiers with exact counts and integer-rounding examples', () => {
  const examples = [[0, 36, 18, 10], [3, 40, 20, 9], [6, 44, 23, 8], [9, 48, 26, 7]];
  for (const [k, total, target, budget] of examples) {
    const p = peggleParams(k);
    assert.equal(p.totalPegs, total); assert.equal(p.targetPegs, target); assert.equal(p.budget, budget);
  }
  for (let k = 0; k < 10; k++) {
    const world = fixture(k), p = world.config;
    assert.equal(world.statics.length, p.totalPegs);
    assert.equal(world.statics.filter(pin => pin.target).length, p.targetPegs);
    assert.equal(world.statics.filter(pin => pin.moving).length, k >= 8 ? 2 : 0);
    assert.equal(world.remaining, p.budget);
    assert.equal(world.rules.rating(), 0);
    assert.equal(world.rules.progress(), 0);
  }
});

test('every pattern fits portrait and short landscape with fixed radius and no overlapping pins', () => {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [568, 320], [1280, 720]]) {
    for (let k = 0; k < 10; k++) {
      const world = fixture(k, width, height), b = world.arenaBounds;
      for (const pin of world.statics) {
        assert.equal(pin.r, .45 * world.unit);
        assert.ok(pin.x - pin.r >= b.left && pin.x + pin.r <= b.right);
        assert.ok(pin.y - pin.r >= (height > 520 ? 112 : 76), 'pins clear the actual score/goal/budget HUD');
        assert.ok(pin.y - pin.r >= b.top && pin.y + pin.r < world.player.y - world.player.r);
      }
      for (let i = 0; i < world.statics.length; i++) for (let j = i + 1; j < world.statics.length; j++) {
        const a = world.statics[i], c = world.statics[j];
        assert.ok(Math.hypot(a.x - c.x, a.y - c.y) >= a.r + c.r, `${width}×${height} tier ${k}: ${i}/${j}`);
      }
      assert.equal(peggleLayout(world).positions.length, world.config.totalPegs);
    }
  }
});

test('target and normal pegs score once, remain solid for the shot, then clear at shot end', () => {
  const world = fixture(), target = world.statics.find(pin => pin.target), normal = world.statics.find(pin => !pin.target);
  world.rules.onLaunch();
  for (const pin of [target, normal]) {
    world.rules.onStaticHit(pin, {normalSpeed: 100, impactVx: 100, impactVy: 0});
    world.rules.onStaticHit(pin, {normalSpeed: 100, impactVx: -100, impactVy: 0});
    assert.equal(pin.active, true); assert.equal(pin.hp, 1); assert.equal(pin.hitThisShot, true);
  }
  assert.equal(world.targetsRemaining, 17); assert.equal(world.score, 20);
  assert.equal(world.events.filter(event => event.type === 'campaignPegHit').length, 2);
  world.rules.onLaunchEnd(); world.rules.onLaunchEnd();
  assert.equal(target.active, false); assert.equal(normal.active, false);
  assert.equal(world.events.filter(event => event.type === 'shatter').length, 2);
  world.rules.onStaticHit(target, {});
  assert.equal(world.score, 20);
});

test('the eighth distinct hit emits one run accent and a later launch resets its counter', () => {
  const world = fixture();
  world.rules.onLaunch();
  for (const pin of world.statics.slice(0, 9)) world.rules.onStaticHit(pin, {});
  assert.equal(world.events.filter(event => event.type === 'campaignPegRun').length, 1);
  world.rules.onLaunchEnd(); world.rules.onLaunch();
  for (const pin of world.statics.slice(9, 16)) world.rules.onStaticHit(pin, {});
  assert.equal(world.events.filter(event => event.type === 'campaignPegRun').length, 1);
});

test('the last target wins even on the last ball and rating uses spare balls', () => {
  for (const [remaining, rating] of [[0, 1], [1, 2], [2, 2], [3, 3], [10, 3]]) {
    const world = fixture(); world.remaining = remaining;
    const targets = world.statics.filter(pin => pin.target);
    for (const pin of targets) world.rules.onStaticHit(pin, {});
    assert.equal(world.rules.isWon(), true); assert.equal(world.rules.isLost(), false);
    assert.equal(world.rules.rating(), rating); assert.equal(world.targetsRemaining, 0);
    assert.deepEqual(world.peakOrigin, {x: targets.at(-1).x, y: targets.at(-1).y});
    world.shotActive = false;
    assert.equal(world.rules.isLost(), false);
    assert.equal(world.rules.progress(), 1);
  }
  const failed = fixture(); failed.remaining = 0;
  assert.equal(failed.rules.isLost(), false);
  failed.shotActive = false;
  assert.equal(failed.rules.isLost(), true);
  assert.equal(failed.rules.summary(), '差 18 钉');
});

test('bucket width and travel speed match PDF and free ball credit is per launch', () => {
  const world = fixture(), bucket = world.zones[0], x = bucket.x;
  assert.equal(bucket.width / world.unit, 2.2);
  world.rules.onTick(.25);
  assert.ok(Math.abs(bucket.x - x - 1.2 * world.unit * .25) < 1e-8);
  const remaining = world.remaining;
  world.player.vy = 100;
  const entry = {previous: {x: bucket.x, y: bucket.y - bucket.height}};
  world.rules.onZone(world.player, bucket, entry); world.rules.onZone(world.player, bucket, entry);
  assert.equal(world.remaining, remaining + 1);
  assert.equal(world.shotActive, false);
  assert.equal(world.player.y, world.arenaBounds.bottom - 3 * world.unit);
  world.rules.onZone({...world.player}, bucket);
  assert.equal(world.remaining, remaining + 1);
  for (let i = 0; i < 10000; i++) {
    world.rules.onTick(1 / 120);
    assert.ok(bucket.x - bucket.width / 2 >= world.arenaBounds.left - 1e-7);
    assert.ok(bucket.x + bucket.width / 2 <= world.arenaBounds.right + 1e-7);
  }
});

test('resting, upward and already-overlapping bucket entries do not grant free balls', () => {
  for (const [vy, fromY] of [[0, -100], [-100, -100], [100, 0]]) {
    const world = fixture(), bucket = world.zones[0], remaining = world.remaining;
    world.player.vy = vy;
    world.rules.onZone(world.player, bucket, {previous: {x: bucket.x, y: bucket.y + fromY}});
    assert.equal(world.remaining, remaining);
    assert.equal(world.shotActive, true);
  }
});

test('high-tier pins move on bounded tracks and resize preserves hits, goals and motion phase', () => {
  const world = fixture(9), moving = world.statics.filter(pin => pin.moving), target = world.statics.find(pin => pin.target);
  world.rules.onStaticHit(target, {});
  const remaining = world.targetsRemaining, score = world.score;
  for (let i = 0; i < 1000; i++) {
    world.rules.onTick(1 / 120);
    for (const pin of moving) assert.ok(Math.abs(pin.x - pin.baseX) <= world.unit * .45 + 1e-7);
  }
  world.width = 844; world.height = 390;
  world.arenaBounds = {left: 16, right: 828, top: 16, bottom: 374};
  world.rules.resize();
  assert.equal(world.targetsRemaining, remaining); assert.equal(world.score, score);
  assert.equal(target.hitThisShot, true);
  for (const pin of moving) assert.ok(Math.abs(pin.vx) < world.unit, 'resize must not create an impulsive pin velocity');
  world.rules.onTick(1 / 120);
  for (const pin of moving) assert.ok(Math.abs(pin.vx) < world.unit);
});

test('the first-shot guide physically reaches targets with every offer on phone layouts', () => {
  for (const [width, height] of [[390, 844], [844, 390], [320, 568], [568, 320]]) {
    for (const upgradeId of ['rubber', 'energy', 'bank', 'pierce']) {
      const world = new CampaignWorld(width, height, 10, () => .5, {upgradeId});
      const target = world.teachingTarget, angle = Math.atan2(target.y - world.player.y, target.x - world.player.x);
      assert.equal(world.tutorialVisible, true);
      realShot(world, angle);
      assert.ok(world.targetsRemaining < world.config.targetPegs, `${width}×${height}/${upgradeId}: hint must hit a real target`);
      assert.equal(world.tutorialVisible, false);
      assert.equal(world.shotsUsed, 1);
      assert.equal(world.remaining, world.budget - 1 + world.freeBalls);
      assert.equal(world.statics.filter(pin => pin.active !== false && pin.hitThisShot).length, 0);
    }
  }
});

// Fixed routes discovered by an offline angle search. Replaying these uses
// only public shoot/step calls: no target, HP, budget or player-position edits.
const WINNING_ROUTES = [
  {"width":390,"height":844,"tier":0,"upgradeId":"energy","shots":[[-1.0038233471551297,1],[5.235987755982989,1],[2.356194490192345,1],[2.8797932657906435,1],[5.759586531581287,1],[3.0106929596902186,1]]},
  {"width":390,"height":844,"tier":1,"upgradeId":"energy","shots":[[-2.069004349703086,1],[-2.6473958524678136,1],[1.151653141122713,1],[4.843288674284264,1]]},
  {"width":390,"height":844,"tier":2,"upgradeId":"energy","shots":[[-2.069004349703086,1],[-2.6473958524678136,1],[-0.8233887021533093,1],[-0.29511676812714394,1],[1.0471975511965976,1]]},
  {"width":390,"height":844,"tier":3,"upgradeId":"energy","shots":[[5.235987755982989,1],[-1.4871696590500092,1],[1.9847848003161617,1],[-2.0825321299924116,1],[3.272492347489368,1]]},
  {"width":390,"height":844,"tier":4,"upgradeId":"energy","shots":[[-1.1336335694962316,1],[0.39269908169872414,1],[-0.4973284718336549,1],[0.675057747945684,1],[0.39269908169872414,1]]},
  {"width":390,"height":844,"tier":5,"upgradeId":"energy","shots":[[4.057890510886816,1],[-1.0418767365764037,1],[-1.085961134637211,1],[0.5235987755982988,1],[1.5707963267948966,1],[1.7016960206944711,1]]},
  {"width":390,"height":844,"tier":6,"upgradeId":"energy","shots":[[-1.9738659884786722,1],[0.6544984694978736,1],[-2.8065244263294877,1],[-1.629394492572963,1],[4.1887902047863905,1],[-1.126779793832796,1],[5.366887449882563,1],[0.7603010188271052,1]]},
  {"width":390,"height":844,"tier":7,"upgradeId":"energy","shots":[[2.4870941840919194,1],[-1.597126888669368,1],[-2.2573651248312467,1],[0.2617993877991494,1],[3.118448547622328,1],[1.0471975511965976,1],[2.007128639793479,1],[1.7016960206944711,0.65]]},
  {"width":390,"height":844,"tier":8,"upgradeId":"energy","shots":[[-1.0675418788889948,1],[-0.6311182167626842,1],[5.890486225480862,1],[1.9634954084936207,1],[3.9269908169872414,1],[-3.02178973137813,1]]},
  {"width":390,"height":844,"tier":9,"upgradeId":"energy","shots":[[3.9269908169872414,1],[5.235987755982989,1],[3.272492347489368,1],[0.2617993877991494,1],[5.105088062083414,1],[-1.1543015233745995,1],[6.152285613280012,1]]},
  {"width":844,"height":390,"tier":0,"upgradeId":"energy","shots":[[-1.2439724097078448,1],[-0.8224509912783801,1],[5.759586531581287,1],[0.39269908169872414,1],[0.6544984694978736,1]]},
  {"width":844,"height":390,"tier":1,"upgradeId":"energy","shots":[[-2.0164722601777196,1],[2.4870941840919194,1],[0.7853981633974483,1],[0.2617993877991494,1],[4.71238898038469,1]]},
  {"width":844,"height":390,"tier":2,"upgradeId":"energy","shots":[[-2.0164722601777196,1],[2.632729131944715,1],[2.748893571891069,1],[5.497787143782138,1],[5.6286868376817125,1]]},
  {"width":844,"height":390,"tier":3,"upgradeId":"energy","shots":[[-1.8710931055001445,1],[2.4870941840919194,1],[-0.22975607527276531,1],[0.9865383287029387,1],[0.3544902310639373,1]]},
  {"width":844,"height":390,"tier":4,"upgradeId":"energy","shots":[[-0.7956012534957126,1],[5.235987755982989,1],[4.319689898685965,1],[-2.741108544427706,1],[2.2252947962927703,1]]},
  {"width":844,"height":390,"tier":5,"upgradeId":"energy","shots":[[-0.5952244454006339,1],[0.9162978572970231,1],[2.9164694816272636,1],[1.3089969389957472,1],[2.748893571891069,1]]},
  {"width":844,"height":390,"tier":6,"upgradeId":"energy","shots":[[-1.2537697614830265,1],[2.0763565336672016,1],[-3.1951229630622304,1],[2.4870941840919194,1],[-2.973191586039373,1],[0.7853981633974483,1]]},
  {"width":844,"height":390,"tier":7,"upgradeId":"energy","shots":[[5.890486225480862,1],[5.497787143782138,1],[1.2400206832871774,1],[-1.1050346800689397,1],[2.753507761446562,1],[-0.6207744462844305,1],[0.7853981633974483,1]]},
  {"width":844,"height":390,"tier":8,"upgradeId":"energy","shots":[[-2.751068752727349,1],[3.2078500270800747,1],[4.1887902047863905,1],[5.6286868376817125,1],[4.4505895925855405,1],[0.6568993444139303,1],[-0.024375967897693168,1]]},
  {"width":844,"height":390,"tier":9,"upgradeId":"energy","shots":[[-2.690088362677491,1],[0.17515097126616058,1],[-0.5548904077712216,1],[0.93067747423916,1],[2.6179938779914944,1],[3.5342917352885173,1]]}
];

test('real launch routes clear all ten tiers in portrait and landscape within budget', () => {
  for (const route of WINNING_ROUTES) {
    const world = new CampaignWorld(route.width, route.height, (route.tier + 1) * 10, () => .5, {upgradeId: route.upgradeId});
    for (const [angle, power] of route.shots) realShot(world, angle, power);
    assert.equal(world.completed, true, `${route.width}×${route.height} tier ${route.tier}`);
    assert.equal(world.targetsRemaining, 0);
    assert.equal(world.phase, 'campaign-celebrate');
    assert.equal(world.events.filter(event => event.type === 'campaignPeak').length, 1);
    assert.equal(world.shotsUsed, route.shots.length);
    assert.equal(world.remaining, world.budget - world.shotsUsed + world.freeBalls);
    const score = world.score, spare = world.remaining;
    for (let frame = 0; frame < 500 && world.phase !== 'over'; frame++) world.step(1 / 120);
    assert.equal(world.phase, 'over');
    assert.equal(world.score, score + spare * 10);
    assert.equal(world.events.filter(event => event.type === 'campaignBonus').length, spare);
    assert.equal(world.events.filter(event => event.type === 'over').length, 1);
    assert.equal(world.resultRating, spare >= 3 ? 3 : spare >= 1 ? 2 : 1);
    const final = world.score;
    world.step(10);
    assert.equal(world.score, final);
    assert.equal(world.events.filter(event => event.type === 'over').length, 1);
  }
});
