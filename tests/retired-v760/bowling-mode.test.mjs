import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, campaignUpgradeChoices, levelConfig} from '../dist/campaign.js';
import {bowlingParams, bowlingLayout} from '../dist/classes/bowling.js';

const fresh = (k = 0, width = 390, height = 844, upgradeId = 'steady') => {
  const world = new CampaignWorld(width, height, k * 10 + 2, () => .51, {upgradeId});
  world.setFeedbackOptions({strength: .6, reducedMotion: false}); return world;
};
const tick = world => { const scale = world.presentationTimeScale; world.step(scale / 120, false, {timeScale: scale}); };
const waitReady = world => { for (let i = 0; i < 1600 && !world.ready && world.phase !== 'over'; i++) tick(world); };
const shoot = (world, angle, power = 1) => {
  assert.equal(world.shoot(-Math.cos(angle) * world.maxPull * power, -Math.sin(angle) * world.maxPull * power), true);
  waitReady(world);
};
// Boundary fixtures explicitly drive rule contacts. Actual reachability routes
// below only call shoot and real 120Hz ticks and never relocate/remove pins.
const fixtureContact = (world, pin, speed = 6) => world.rules.onDynamicHit(world.player, pin,
  {nx: 0, ny: -1, normalSpeed: speed * world.unit, impactVx: 0, impactVy: -speed * world.unit,
    contactX: pin.x, contactY: pin.y + pin.r});
const fixtureClear = world => {
  for (const pin of world.enemies) while (pin.pinHP > 0) {
    world.rules.onTick(); fixtureContact(world, pin);
  }
  tick(world);
};

test('bowling uses ten literal PDF tiers, exact percentage ceilings and precision upgrades', () => {
  const required = [21, 22, 23, 23, 24, 24, 33, 33, 34, 35];
  for (let k = 0; k < 10; k++) {
    const p = bowlingParams(k), c = levelConfig(k * 10 + 2);
    assert.equal(c.type, 'bowling'); assert.equal(c.implemented, true); assert.equal(c.k, k);
    assert.equal(p.rounds, k >= 6 ? 4 : 3); assert.equal(p.budget, p.rounds * 2);
    assert.equal(p.requiredPins, required[k]); assert.equal(p.passRatio, (70 + 1.7 * k) / 100);
    assert.equal(p.laneWidth, 10 - k / 3); assert.equal(p.gutterWidth, 1 + .07 * k);
    assert.equal(p.spacing, 1.6 + .045 * k); assert.equal(p.heavyPins, Math.floor(k / 3));
    assert.equal(p.pinRadius, .55); assert.equal(p.pinDensity, .35); assert.equal(p.restitution, .95);
    const choices = campaignUpgradeChoices(k * 10 + 2, () => .51);
    assert.equal(choices.length, 2); assert.notEqual(choices[0].id, choices[1].id);
    assert.ok(choices.every(c => ['density', 'rubber', 'bank', 'steady'].includes(c.id)));
  }
});

test('all ten triangular racks and reachable gutters fit five viewports without shrinking balls', () => {
  for (const [width, height] of [[320, 568], [390, 844], [568, 320], [844, 390], [1440, 900]]) for (let k = 0; k < 10; k++) {
    const w = fresh(k, width, height), p = bowlingParams(k), l = bowlingLayout(w, p);
    assert.equal(w.enemies.length, 10); assert.equal(w.zones.length, 2); assert.equal(w.statics.length, 2);
    assert.equal(w.enemies.filter(pin => pin.pinHP === 2).length, p.heavyPins);
    assert.equal(w.player.r, w.unit);
    for (const pin of w.enemies) {
      assert.equal(pin.r, w.unit * .55); assert.equal(pin.density, .35);
      assert.ok(Math.abs(pin.mass - .35 * .55 ** 2) < 1e-12);
      assert.ok(pin.pinHP < 2 || pin.row === 3);
      const across = l.vertical ? pin.x - l.center : pin.y - l.center;
      assert.ok(Math.abs(across) + pin.r < l.laneWidth / 2);
      for (const other of w.enemies) if (other !== pin) assert.ok(Math.hypot(pin.x - other.x, pin.y - other.y) > pin.r + other.r);
    }
    for (const shape of [...w.statics, ...w.zones]) {
      assert.ok(shape.x - shape.width / 2 >= l.left - 1e-8 && shape.x + shape.width / 2 <= l.right + 1e-8);
      assert.ok(shape.y - shape.height / 2 >= l.top - 1e-8 && shape.y + shape.height / 2 <= l.bottom + 1e-8);
    }
    for (let i = 0; i < 2; i++) {
      const gutter = w.zones[i], wall = w.statics[i];
      assert.equal(gutter.centerOnly, true); assert.equal(wall.bankSurface, true);
      const gutterAcross = Math.abs(l.vertical ? gutter.x - l.center : gutter.y - l.center);
      const wallAcross = Math.abs(l.vertical ? wall.x - l.center : wall.y - l.center);
      assert.ok(wallAcross > gutterAcross, 'the physical wall is outside the reachable gutter');
    }
    assert.ok(Math.abs(l.acrossSpacing / w.unit - (k === 9 ? 1.94 : p.spacing)) < 1e-10);
  }
});

test('pin damage has a strict closing-speed gate and HP2 loses at most one HP per contact episode', () => {
  const w = fresh(9), pin = w.enemies.find(pin => pin.pinHP === 2); w.shoot(0, w.maxPull);
  fixtureContact(w, pin, 5); assert.equal(pin.pinHP, 2);
  fixtureContact(w, pin, 8); assert.equal(pin.pinHP, 2, 'sustained contact cannot become a second damage episode');
  w.rules.onTick(); fixtureContact(w, pin, 5.01); assert.equal(pin.pinHP, 1);
  fixtureContact(w, pin, 50); assert.equal(pin.pinHP, 1);
  w.rules.onTick(); fixtureContact(w, pin, 8);
  assert.equal(pin.pinHP, 0); assert.equal(pin.hp, Infinity); assert.equal(pin.bowlingFallen, true);
  assert.equal(w.bowlingPinsDown, 1); assert.equal(w.score, 10);
  w.rules.onTick(); fixtureContact(w, pin, 20); assert.equal(w.score, 10);
});

test('fallen pins retain actual momentum for pin-to-pin collisions and score each pin only once', () => {
  const w = fresh(), [a, b] = w.enemies;
  w.shoot(0, w.maxPull * .5);
  Object.assign(w.player, {x: w.width / 2, y: 550, vx: 0, vy: -w.unit * 18, feedbackFreeze: 0});
  Object.assign(a, {x: w.player.x, y: 550 - w.player.r - a.r + .1, vx: 0, vy: 0});
  Object.assign(b, {x: a.x, y: a.y - a.r - b.r - w.unit * .5, vx: 0, vy: 0});
  w.collideCampaign(w.player, a);
  assert.equal(a.bowlingFallen, true); assert.ok(a.vy < 0); assert.equal(a.hp, Infinity);
  assert.equal(w.events.filter(e => e.type === 'hit' && e.bodyId === a.id && e.damage === 0).length, 0,
    'a module kill does not also emit a duplicate generic hit cue');
  // Only the fallen carrier is allowed to reach b in this collision fixture.
  w.player.captured = true;
  for (let i = 0; i < 120 && b.pinHP > 0; i++) tick(w);
  assert.equal(b.pinHP, 0);
  assert.ok(w.events.some(e => e.type === 'kill' && e.bodyId === b.id && e.attackerId === a.id));
  assert.equal(w.events.filter(e => e.type === 'campaignPinDown' && e.bodyId === a.id).length, 1);
});

test('strike fixture skips the unused slot, awards exactly once and waits for the real-time crown before next rack', () => {
  const w = fresh(); w.shoot(0, w.maxPull); fixtureClear(w);
  assert.equal(w.shotActive, false); assert.equal(w.remaining, 4); assert.equal(w.shotsUsed, 1);
  assert.equal(w.bowlingCompletedRounds, 1); assert.equal(w.bowlingStrikes, 1); assert.equal(w.score, 150);
  assert.equal(w.bowlingRound, 1); assert.equal(w.ready, false); assert.ok(w.bowlingCrown);
  const frozen = w.feedbackTime; assert.equal(w.shoot(0, w.maxPull), false); assert.equal(w.feedbackTime, frozen);
  for (let i = 0; i < 50; i++) tick(w);
  assert.equal(w.bowlingRound, 1);
  waitReady(w); assert.equal(w.bowlingRound, 2); assert.equal(w.enemies.length, 10);
  assert.equal(w.events.filter(e => e.type === 'campaignStrike').length, 1);
  assert.equal(w.events.filter(e => e.type === 'campaignSlow' && e.kind === 'bowling-strike').length, 1);
  assert.deepEqual({x: w.player.x, y: w.player.y}, w.bowlingLayout.spawn);
});

test('real strikes retain visible falling-pin motion during the crown and final slow motion without repeat rewards', () => {
  const w = fresh();
  for (let round = 1; round <= 3; round++) {
    assert.equal(w.shoot(0, w.maxPull), true);
    for (let i = 0; i < 1200 && w.shotActive; i++) tick(w);
    assert.equal(w.bowlingStrikes, round); assert.equal(w.enemies.length, 10);
    assert.ok(w.enemies.every(pin => pin.bowlingFallen && pin.pinHP === 0));
    const before = [w.player, ...w.enemies].map(body => ({id: body.id, x: body.x, y: body.y}));
    assert.ok([w.player, ...w.enemies].some(body => Math.hypot(body.vx, body.vy) > w.unit));
    const points = w.score, kills = w.bowlingPinsDown, real = w.feedbackTime, simulated = w.time;
    assert.ok(w.presentationTimeScale < 1);
    for (let i = 0; i < 36; i++) tick(w);
    assert.ok([w.player, ...w.enemies].some(body => {
      const old = before.find(p => p.id === body.id); return old && Math.hypot(old.x - body.x, old.y - body.y) > .1;
    }), 'the actual final impulse keeps moving, including the last scoring round');
    assert.ok(Math.abs(w.feedbackTime - real - .3) < 1e-8);
    assert.ok(w.time - simulated < .3);
    assert.equal(w.score, points); assert.equal(w.bowlingPinsDown, kills);
    assert.equal(w.events.filter(e => e.type === 'campaignStrike').length, round);
    const crownAt = w.bowlingCrown.at;
    if (round === 1) {
      w.resize(844, 390);
      assert.equal(w.bowlingCrown.at, crownAt); assert.equal(w.score, points);
      w.resize(390, 844);
    }
    waitReady(w);
    if (round < 3) {
      assert.equal(w.bowlingRound, round + 1); assert.ok(w.enemies.every(pin => !pin.bowlingFallen));
      assert.deepEqual({x: w.player.x, y: w.player.y}, w.bowlingLayout.spawn);
    }
  }
  assert.equal(w.phase, 'over'); assert.equal(w.completed, true); assert.equal(w.score, 450);
});

test('spare fixture uses two launches, preserves surviving pins and awards twenty bonus points', () => {
  const w = fresh(); w.shoot(0, w.maxPull * .2);
  for (const pin of w.enemies.slice(0, 5)) fixtureContact(w, pin);
  w.endLaunch(); assert.equal(w.bowlingShot, 1); assert.equal(w.enemies.length, 5); assert.equal(w.score, 50);
  w.shoot(0, w.maxPull); fixtureClear(w);
  assert.equal(w.shotsUsed, 2); assert.equal(w.remaining, 4); assert.equal(w.score, 120);
  assert.equal(w.bowlingSpares, 1); assert.equal(w.bowlingStrikes, 0);
  assert.equal(w.events.filter(e => e.type === 'campaignSpare').length, 1);
});

test('passing the aggregate target early never ends the remaining scoring rounds', () => {
  const w = fresh();
  for (let round = 1; round <= 2; round++) {
    assert.equal(w.shoot(0, w.maxPull), true); fixtureClear(w);
    assert.equal(w.completed, false); assert.equal(w.phase, 'battle'); waitReady(w);
  }
  assert.equal(w.shoot(0, w.maxPull), true); fixtureContact(w, w.enemies[0]); w.endLaunch();
  assert.equal(w.bowlingPinsDown, 21); assert.equal(w.completed, false); assert.equal(w.phase, 'battle');
  assert.equal(w.ready, true, 'the final spare attempt remains available after reaching the pass line');
  assert.equal(w.shoot(0, w.maxPull), true); fixtureClear(w);
  waitReady(w);
  assert.equal(w.completed, true); assert.equal(w.phase, 'over'); assert.equal(w.bowlingFrames.length, 3);
  assert.equal(w.bowlingPinsDown, 30); assert.equal(w.score, 420); assert.equal(w.resultRating, 3);
  assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
  assert.equal(w.events.filter(e => e.type === 'over').length, 1);
});

test('all ten tiers win via real head-pin launches at normal feedback in both orientations', () => {
  for (const [width, height] of [[390, 844], [844, 390], [320, 568], [568, 320]]) for (let k = 0; k < 10; k++) {
    const w = fresh(k, width, height), p = bowlingParams(k);
    let guard = 0;
    while (w.phase === 'battle' && guard++ <= p.budget) {
      waitReady(w); if (w.phase !== 'battle') break;
      const angle = w.bowlingLayout.vertical ? -Math.PI / 2 : 0;
      shoot(w, angle);
    }
    assert.equal(w.completed, true, `tier ${k}, ${width}×${height}`);
    assert.equal(w.phase, 'over'); assert.equal(w.bowlingCompletedRounds, p.rounds);
    assert.ok(w.bowlingPinsDown >= p.requiredPins); assert.ok(w.shotsUsed <= p.budget);
    assert.equal(w.score, w.bowlingPinsDown * 10 + w.bowlingStrikes * 50 + w.bowlingSpares * 20);
    assert.equal(w.events.filter(e => e.type === 'campaignPinDown').length, w.bowlingPinsDown);
    const pinIds = new Set(w.events.filter(e => e.type === 'campaignPinDown').map(e => e.bodyId));
    assert.equal(pinIds.size, w.bowlingPinsDown, 'new racks have distinct pin identities and each credits once');
    assert.ok(w.events.some(e => e.type === 'kill' && e.source === 'bowling' && e.attackerId !== w.player.id),
      'a genuine pin-to-pin impact participates in every full run');
    assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
    assert.equal(w.events.filter(e => e.type === 'over').length, 1);
  }
});

test('each teaching upgrade can earn three strikes with real full-pull head-pin shots', () => {
  for (const upgradeId of ['density', 'rubber', 'bank', 'steady']) for (const [width, height] of [[390, 844], [568, 320]]) {
    const w = fresh(0, width, height, upgradeId);
    for (let round = 0; round < 3; round++) shoot(w, w.bowlingLayout.vertical ? -Math.PI / 2 : 0);
    assert.equal(w.completed, true); assert.equal(w.shotsUsed, 3);
    assert.equal(w.bowlingStrikes, 3); assert.equal(w.resultRating, 3); assert.equal(w.score, 450);
  }
});

test('physical gutter entries immediately stop each launch and all ten tiers lose after every round', () => {
  for (let k = 0; k < 10; k++) {
    const w = fresh(k), p = bowlingParams(k);
    while (w.phase === 'battle') {
      waitReady(w); if (w.phase !== 'battle') break;
      const angle = w.bowlingLayout.vertical ? 0 : Math.PI / 2;
      shoot(w, angle);
    }
    assert.equal(w.completed, false); assert.equal(w.bowlingCompletedRounds, p.rounds);
    assert.equal(w.shotsUsed, p.budget); assert.equal(w.remaining, 0);
    assert.equal(w.bowlingGutters, p.budget); assert.equal(w.bowlingPinsDown, 0);
    assert.equal(w.events.filter(e => e.type === 'over').length, 1);
  }
});

test('last-budget final-round physical hit wins before exhaustion and rating follows strike count', () => {
  for (const strikes of [0, 1, 2]) {
    const w = fresh(9), p = bowlingParams(9), pin = w.enemies[0];
    w.enemies = [pin]; w.bowlingCompletedRounds = p.rounds - 1; w.bowlingRound = p.rounds;
    w.bowlingShot = 1; w.bowlingRoundPinsDown = 7; w.bowlingPinsDown = p.requiredPins - 1;
    w.bowlingStrikes = strikes; w.remaining = 1;
    Object.assign(pin, {x: w.player.x, y: w.player.y - w.player.r - pin.r - 1});
    shoot(w, -Math.PI / 2);
    assert.equal(w.completed, true); assert.equal(w.remaining, 0); assert.equal(w.resultRating, strikes + 1);
    assert.equal(w.events.filter(e => e.type === 'over').length, 1);
  }
});

test('rotation preserves rounds, contact health, budget and feedback clocks without inventing gutter entries', () => {
  for (let k = 0; k < 10; k++) {
    const w = fresh(k), before = w.enemies.map(p => p.pinHP), remaining = w.remaining;
    for (const [width, height] of [[844, 390], [568, 320], [320, 568], [390, 844]]) {
      w.resize(width, height);
      assert.deepEqual(w.enemies.map(p => p.pinHP), before);
      assert.equal(w.remaining, remaining); assert.equal(w.bowlingRound, 1);
      assert.equal(w.bowlingGutters, 0); assert.equal(w.bowlingPinsDown, 0);
      assert.ok(w.enemies.every(pin => Math.abs(pin.r - w.unit * .55) < 1e-10));
      tick(w); assert.equal(w.bowlingGutters, 0);
    }
  }
});
