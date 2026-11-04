import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, levelConfig} from '../dist/campaign.js';
import {golfParams, GOLF_LEVELS} from '../dist/classes/golf.js';
import {staticContact} from '../dist/campaign-collision.js';

const fresh = (k = 0, width = 390, height = 844, upgradeId = 'rubber', variant = 0) => new CampaignWorld(width, height, 7 + variant + k * 10, () => .5, {upgradeId});
function step(world, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 120); i++) {
    const scale = world.presentationTimeScale;
    world.step(scale / 120, false, {timeScale: scale});
  }
}
function shot(world, angle, power) {
  assert.equal(world.shoot(-Math.cos(angle) * world.maxPull * power, -Math.sin(angle) * world.maxPull * power), true);
  for (let frame = 0; frame < 900 && world.shotActive && world.phase === 'battle'; frame++) {
    const scale = world.presentationTimeScale;
    world.step(scale / 120, false, {timeScale: scale});
  }
  assert.equal(world.shotActive, false);
}
function precisionShot(world, arrivalSpeed = 6) {
  const hole = world.zones[0], p = world.player, dx = hole.x - p.x, dy = hole.y - p.y;
  const distance = Math.hypot(dx, dy) / world.unit;
  const power = Math.min(1, (.6 * distance + arrivalSpeed) / 40 * Math.sqrt(world.density / world.energy));
  shot(world, Math.atan2(dy, dx), power);
}

test('all twenty golf configurations use independent courses, course par and the shared rating contract', () => {
  for (let rank=0;rank<20;rank++) {
    const k=rank>>1,variant=rank%2,config=levelConfig(7+variant+10*k),expected=golfParams(k,variant),world=fresh(k,390,844,'rubber',variant);
    assert.equal(config.classId,'golf');assert.equal(config.rank20,rank);assert.equal(config.implemented,true);
    assert.equal(expected.layoutId,GOLF_LEVELS[rank].id);assert.equal(expected.par,GOLF_LEVELS[rank].par);
    assert.equal(world.statics.length,GOLF_LEVELS[rank].walls.length);assert.equal(world.enemies.length,0);
    assert.equal(world.player.r,world.unit*.46);assert.equal(world.zones[0].r,world.unit*.78);
    assert.equal(world.zones[0].moving,!!GOLF_LEVELS[rank].moving);
    assert.equal(world.remaining,expected.par+(rank>=6?3:2));
    assert.equal(world.rules.rating(),0);assert.equal(world.percent,0);
  }
});

test('golf layouts keep goals, starts and physical obstacles clear of HUD and each other', () => {
  for (const [width, height] of [[390, 844], [844, 390], [320, 568], [568, 320], [1280, 720]]) for (let rank=0;rank<20;rank++) {
    const k=rank>>1,world = fresh(k, width, height,'rubber',rank%2), hole = world.zones[0], b = world.arenaBounds;
    assert.ok(hole.y - hole.r >= (height > 520 ? 112 : 76));
    assert.ok(hole.x - hole.r >= b.left && hole.x + hole.r <= b.right);
    for (const obstacle of world.statics) {
      assert.ok(obstacle.y - obstacle.height / 2 >= (height > 520 ? 112 : 76));
      assert.ok(obstacle.x - obstacle.width / 2 > b.left && obstacle.x + obstacle.width / 2 < b.right);
      assert.equal(staticContact(world.player, obstacle), null, 'player starts outside solid obstacles');
      assert.equal(staticContact({...hole, r: hole.r}, obstacle), null, 'hole opening is not covered by a brick');
      assert.equal(obstacle.hp, Infinity);
      for (const walker of world.enemies) assert.equal(staticContact(walker, obstacle), null, 'walkers begin outside solid obstacles');
    }
    for (const [i, walker] of world.enemies.entries()) for (const other of [world.player, ...world.enemies.slice(0, i)])
      assert.ok(Math.hypot(walker.x - other.x, walker.y - other.y) >= walker.r + other.r);
    if (rank < 2) {
      const start = world.player;
      for (let t = 0; t <= 1; t += .02) for (const obstacle of world.statics)
        assert.equal(staticContact({...start, x: start.x + (hole.x - start.x) * t, y: start.y + (hole.y - start.y) * t}, obstacle), null);
    }
  }
});

test('hole eligibility uses strict radius and strict speed boundaries, not ball-surface overlap', () => {
  for (const [distance, speed, capture] of [[.78, 11, false], [.78001, 1, false], [.77999, 12, false], [.6, 12.0001, false], [.6, 11.9999, true], [0, 0, true]]) {
    const world = fresh(), hole = world.zones[0], p = world.player;
    world.shoot(world.maxPull * .3, 0);
    Object.assign(p, {x: hole.x - distance * world.unit, y: hole.y, vx: speed * world.unit, vy: 0});
    world.rules.onZone(p, hole, {previous: {x: p.x, y: p.y}, impactVx: p.vx, impactVy: p.vy});
    assert.equal(world.rules.isWon(), capture, `distance ${distance}, speed ${speed}`);
    assert.equal(p.captured === true, capture);
    assert.equal(world.score, capture ? 100 : 0);
  }
});

test('a fast rim crossing bounces out and emits one ding/squint without scoring or extra budget loss', () => {
  const world = fresh(), hole = world.zones[0], p = world.player;
  world.shoot(-world.maxPull, 0);
  const remaining = world.remaining;
  const previous = {x: hole.x - hole.r - world.unit * .1, y: hole.y};
  Object.assign(p, {x: hole.x - hole.r + world.unit * .1, y: hole.y, vx: 30 * world.unit, vy: 0});
  world.rules.onZone(p, hole, {previous, impactVx: p.vx, impactVy: 0});
  assert.ok(p.vx < 0); assert.ok(Math.hypot(p.x - hole.x, p.y - hole.y) > hole.r);
  assert.equal(p.campaignSquintUntil, world.feedbackTime + .3);
  world.rules.onZone(p, hole, {previous: {x: p.x, y: p.y}});
  assert.equal(world.events.filter(e => e.type === 'campaignRim').length, 1);
  assert.equal(world.score, 0); assert.equal(world.remaining, remaining); assert.equal(world.rules.isWon(), false);
});

test('capture is once-only, sets the logical hole pose, and preserves rating thresholds independently of score', () => {
  for (let k = 0; k < 10; k++) {
    const par = golfParams(k).par;
    for (const used of [par - 1, par, par + 1, par + 2]) {
      const world = fresh(k), p = world.player, hole = world.zones[0];
      world.shoot(-world.maxPull * .25, 0);
      world.shotsUsed = used; world.remaining = world.budget - used;
      Object.assign(p, {x: hole.x, y: hole.y, vx: 0, vy: 0});
      world.rules.onZone(p, hole, {previous: {x: p.x, y: p.y}});
      world.rules.onZone(p, hole, {previous: {x: p.x, y: p.y}});
      assert.equal(world.rules.rating(), used <= par - 1 ? 3 : used <= par ? 2 : 1);
      assert.equal(world.score, 100);
      assert.equal(world.events.filter(e => e.type === 'campaignGolfCapture').length, 1);
      assert.equal(world.golfHoleInOne, used === 1);
      assert.equal(world.targetsRemaining, 0);
      assert.equal(p.x, hole.x); assert.equal(p.y, hole.y);
      assert.ok(world.golfCapture.bodySnapshot);
      world.checkOutcome();
      assert.equal(world.phase, 'campaign-celebrate'); assert.equal(world.completed, true);
      step(world, 2);
      assert.equal(world.phase, 'over');
      assert.equal(world.events.filter(e => e.type === 'over').length, 1);
    }
  }
});

test('fixed course rails are invulnerable and deflect a real shot without scoring', () => {
  const world=fresh(2), rail=world.statics[0], startY=world.player.y;
  shot(world,-Math.PI/2,.65);
  assert.equal(rail.hp,Infinity);assert.equal(world.enemies.length,0);assert.equal(world.score,0);
  assert.ok(world.events.some(e=>e.type==='hit'));assert.ok(world.player.y>rail.y);
  assert.notEqual(world.player.y,startY);
  for(const key of ['x','y','vx','vy'])assert.ok(Number.isFinite(world.player[key]));
});

test('late moving holes follow bounded short tracks in both orientations', () => {
  for(const rank of [16,17,19]) for(const [width,height] of [[390,844],[844,390],[320,568],[568,320]]) {
    const world=fresh(rank>>1,width,height,'rubber',rank%2),hole=world.zones[0],axis=world.golfLayout.vertical?'x':'y',start=hole[axis];
    world.rules.onTick(.1);
    assert.ok(Math.abs(hole[axis]-start-world.config.holeSpeed*world.unit*.1)<1e-8);
    for(let frame=0;frame<1000;frame++) {
      world.rules.onTick(1/120);
      assert.ok(Math.abs(hole[axis]-world.golfLayout.hole[axis])<=world.golfLayout.excursion+1e-8);
      const b=world.arenaBounds;
      assert.ok(hole.x-hole.r>b.left && hole.x+hole.r<b.right && hole.y-hole.r>b.top && hole.y+hole.r<b.bottom);
      for(const obstacle of world.statics)assert.equal(staticContact(hole,obstacle),null);
    }
  }
});

test('a captured moving hole freezes through frenzy and resizing preserves capture age and final pose', () => {
  const world = fresh(9,390,844,'rubber',1), hole = world.zones[0], p = world.player;
  world.shoot(-world.maxPull * .3, 0); step(world, .2);
  Object.assign(p, {x: hole.x, y: hole.y, vx: 0, vy: 0});
  world.rules.onZone(p, hole, {previous: {x: p.x, y: p.y}}); world.checkOutcome();
  const captureAt = world.golfCapture.at, x = hole.x;
  step(world, .1); assert.equal(hole.x, x);
  const oldSnapshot = {...world.golfCapture.bodySnapshot};
  world.resize(844, 390);
  assert.equal(world.golfCapture.at, captureAt); assert.equal(world.golfCapture.duration, .22);
  assert.equal(world.golfCapture.pocketX, hole.x); assert.equal(world.golfCapture.pocketY, hole.y);
  assert.equal(p.x, hole.x); assert.equal(p.y, hole.y);
  assert.ok(Math.abs(world.golfCapture.bodySnapshot.x - oldSnapshot.x * 844 / 390) < 1e-8);
  const resizedX = hole.x;
  step(world, 2); assert.equal(hole.x, resizedX);
  assert.equal(world.completed, true); assert.equal(world.phase, 'over'); assert.equal(world.score, 100);
});

test('every offer permits the teaching precision putt and the full-pull steady assist stays bounded', () => {
  for (const [width, height] of [[390, 844], [844, 390], [320, 568], [568, 320]]) for (const upgradeId of ['density', 'rubber', 'bank', 'steady']) {
    const world = fresh(0, width, height, upgradeId);
    assert.equal(world.tutorialVisible, true);
    precisionShot(world);
    assert.equal(world.completed, true, `${width}×${height} ${upgradeId}`);
    assert.equal(world.shotsUsed, 1); assert.equal(world.resultRating, 3); assert.equal(world.golfHoleInOne, true);
    assert.equal(world.tutorialVisible, false);
    assert.equal(world.lastAimAdjustment, 0, 'a partial precision pull gets no hidden correction');
  }
  const world = fresh(0, 390, 844, 'steady'), hole = world.zones[0];
  const aim = Math.atan2(hole.y - world.player.y, hole.x - world.player.x) + Math.PI / 180;
  world.shoot(-Math.cos(aim) * world.maxPull, -Math.sin(aim) * world.maxPull);
  assert.ok(Math.abs(world.lastAimAdjustment + Math.PI / 180) < 1e-8);
  assert.ok(Math.abs(world.lastAimAdjustment) <= Math.PI / 90);
});

test('ten real weak-shot routes exhaust their budget, and a last-budget putt still wins', () => {
  for (let k = 0; k < 10; k++) {
    const world = fresh(k);
    while (world.ready) shot(world, Math.PI / 2, 7 / world.maxPull);
    assert.equal(world.phase, 'over'); assert.equal(world.completed, false);
    assert.equal(world.remaining, 0); assert.equal(world.shotsUsed, world.budget);
    assert.equal(world.resultRating, 0); assert.equal(world.events.filter(e => e.type === 'over').length, 1);
  }
  const world = fresh();
  for (let i = 0; i < world.budget - 1; i++) shot(world, i % 2 ? 0 : Math.PI, 7 / world.maxPull);
  precisionShot(world);
  assert.equal(world.completed, true); assert.equal(world.remaining, 0);
  assert.equal(world.shotsUsed, world.budget); assert.equal(world.resultRating, 1);
  assert.equal(world.events.some(e => e.type === 'over' && !e.completed), false);
});
