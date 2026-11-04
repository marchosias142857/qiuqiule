import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, campaignUpgradePool} from '../dist/campaign.js';
import {staticContact, zoneContains} from '../dist/campaign-collision.js';

const fresh = (level = 6, options = {}) => new CampaignWorld(390, 844, level, () => .5, options);
const tick = (w, seconds) => { for (let t = 0; t < seconds - 1e-9; t += 1 / 120) w.step(Math.min(1 / 120, seconds - t)); };
const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const auxiliary = (w, spec = {}) => {
  const ball = w.makeBody(w.player.x, w.player.y, .7 * w.unit, w.player.density);
  Object.assign(ball, {hp: Infinity, maxHp: Infinity, isPlayer: true, isAuxiliary: true,
    born: 1, solid: true, active: true, bank: 0}, spec);
  w.auxiliaries.push(ball); return ball;
};
const isolate = w => {
  w.statics = []; w.zones = []; w.enemies = [];
  w.rules.isWon = () => false; w.rules.isLost = () => false;
  w.rules.onTick = () => {}; w.rules.onLaunchEnd = () => {};
};

test('task9 preserves the PDF upgrade groups and rejects out-of-class effects', () => {
  for (let k = 0; k < 10; k++) {
    assert.deepEqual(campaignUpgradePool(2 + 10 * k).map(x => x.id), ['density', 'rubber', 'bank', 'steady']);
    assert.deepEqual(campaignUpgradePool(6 + 10 * k).map(x => x.id), ['rubber', 'energy', 'bank', 'pierce']);
  }
  assert.equal(fresh(2, {upgradeId: 'energy'}).upgradeId, null);
  assert.equal(fresh(6, {upgradeId: 'steady'}).upgradeId, null);
});

test('round-owned exhaustion and between-round launch locks are checked independently', () => {
  const w = fresh(2); w.rules.isWon = () => false; w.rules.isLost = () => false;
  w.remaining = 0; w.checkOutcome(); assert.equal(w.phase, 'battle');
  w.remaining = 2; w.rules.canLaunch = () => false;
  assert.equal(w.ready, false); assert.equal(w.shoot(0, 80), false); assert.equal(w.remaining, 2);
  w.rules.canLaunch = () => true; assert.equal(w.shoot(0, 80), true); assert.equal(w.remaining, 1);
  w.rules.isLost = () => true; w.checkOutcome(); assert.equal(w.phase, 'over');
});

test('pinball pays lives only on an eligible drain, not on four-second or settled returns', () => {
  const w = fresh(), budget = w.remaining;
  assert.equal(w.config.budgetKind, 'lives'); assert.equal(w.shoot(0, w.maxPull), true);
  assert.equal(w.remaining, budget); w.endLaunch();
  assert.equal(w.shoot(0, w.maxPull), true); w.shotTime = 4 - 1 / 120;
  Object.assign(w.player, {x: 70, y: 400, vx: 0, vy: -100}); w.step(1 / 120);
  assert.equal(w.shotActive, false); assert.equal(w.remaining, budget); assert.equal(w.shotsUsed, 2);
  assert.equal(w.shoot(0, 10), true); Object.assign(w.player, {vx: 0, vy: 0}); tick(w, .41);
  assert.equal(w.shotActive, false); assert.equal(w.remaining, budget); assert.equal(w.shotsUsed, 3);
});

test('a fast auxiliary receives exact static collision, contact de-duplication and its own hook actor', () => {
  const w = fresh(); isolate(w); w.shoot(0, 80); w.player.captured = true;
  const shape = w.addStatic({shape: 'rect', x: 220, y: 450, width: 2, height: 100, hp: 3, maxHp: 3});
  const aux = auxiliary(w, {x: 100, y: 450, vx: 100000, vy: 0});
  const seen = []; w.rules.onStaticHit = (body, contact, actor) => { seen.push(actor.id); w.hitStatic(body, 1, contact); };
  w.step(.12);
  assert.deepEqual(seen, [aux.id]); assert.equal(shape.hp, 2); assert.ok(aux.vx < 0); assert.ok(aux.x < shape.x);
  assert.equal(w.shotActive, true); assert.equal(w.remaining, w.budget);
});

test('main and auxiliary balls do not resolve against each other, but both remain in the shot', () => {
  const w = fresh(); isolate(w); w.shoot(0, 80);
  Object.assign(w.player, {x: 150, y: 500, vx: 100, vy: 0});
  const aux = auxiliary(w, {x: 150, y: 500, vx: 100, vy: 0});
  w.step(1 / 120);
  near(aux.x, w.player.x); near(aux.y, w.player.y); near(aux.vx, w.player.vx);
  w.player.captured = true; Object.assign(aux, {vx: 100, vy: 0}); tick(w, .45);
  assert.equal(w.shotActive, true); assert.ok(aux.x > 150);
});

test('pierce preserves bumper reflection and impulse while permitting destructible static targets', () => {
  const w = fresh(6, {upgradeId: 'pierce'}); isolate(w); w.shoot(0, 80);
  const bumper = w.addStatic({shape: 'circle', kind: 'bumper', x: 220, y: 400,
    r: .9 * w.unit, hp: Infinity, restitution: 1, impulse: 8 * w.unit, pierceable: false});
  Object.assign(w.player, {x: bumper.x - bumper.r - w.player.r - .1, y: bumper.y, vx: 100, vy: 0});
  let hit = 0; w.rules.onStaticHit = () => hit++;
  w.step(1 / 120); assert.equal(hit, 1); assert.ok(w.player.vx < -200); assert.ok(w.player.x < bumper.x);
  bumper.active = false;
  const target = w.addStatic({shape: 'rect', x: 220, y: 500, width: 4, height: 60, hp: 1});
  Object.assign(w.player, {x: target.x - target.width / 2 - w.player.r - .1, y: target.y, vx: 100, vy: 0});
  w.rules.onStaticHit = (shape, contact) => w.hitStatic(shape, 1, contact);
  w.step(1 / 120); assert.equal(target.hp, 0); assert.ok(w.player.vx > 0);
});

test('static bank surfaces store charge and auxiliaries consume only their own bank', () => {
  const w = fresh(6, {upgradeId: 'bank'}); isolate(w); w.shoot(0, 80); w.player.captured = true;
  const aux = auxiliary(w, {x: 160, y: 400, vx: 100, vy: 0});
  const wall = w.addStatic({shape: 'rect', x: aux.x + aux.r + 1.1, y: 400,
    width: 2, height: 100, bankSurface: true, pierceable: false});
  w.rules.onStaticHit = () => {}; w.step(1 / 120);
  assert.equal(aux.bank, 1); assert.equal(w.bank, 0); assert.ok(aux.vx < 0);
  wall.active = false; w.bank = 2;
  const target = w.addStatic({shape: 'circle', x: 240, y: 500, r: 10});
  Object.assign(aux, {x: target.x - target.r - aux.r - .1, y: target.y, vx: 100, vy: 0});
  w.contacts.clear(); w.step(1 / 120);
  assert.equal(aux.bank, 0); assert.equal(w.bank, 2); assert.ok(aux.vx < -115);
});

test('last-life main drain does not preempt a simultaneous auxiliary final jackpot impact', () => {
  const w = fresh(); w.shoot(0, 80);
  const contact = {normalSpeed: w.unit * 12, impactVx: 0, impactVy: -w.unit * 12,
    nx: 0, ny: -1, contactX: 195, contactY: 400, attacker: w.player};
  // Prepare earlier groups through the class lifecycle; the final winning hit
  // below is an actual auxiliary collision in the drain's same physics step.
  for (let group = 0; group < w.config.jackpotGoal; group++) {
    for (const target of w.statics.filter(s => s.kind === 'pinball-target')) w.rules.onStaticHit(target, contact, w.player);
    const jackpot = w.statics.find(s => s.kind === 'jackpot');
    for (let hit = 0; hit < (group === w.config.jackpotGoal - 1 ? 2 : 3); hit++) w.rules.onStaticHit(jackpot, contact, w.player);
    if (group < w.config.jackpotGoal - 1) w.rules.onTick(3.01);
  }
  w.rules.onTick(8.01); w.remaining = 1;
  const drain = w.zones.find(z => z.kind === 'drain'), jackpot = w.statics.find(s => s.kind === 'jackpot');
  Object.assign(w.player, {x: drain.x, y: drain.y - drain.height / 2 - .1, vx: 0, vy: 100});
  const aux = auxiliary(w, {x: jackpot.x - jackpot.r - .7 * w.unit - .1, y: jackpot.y, vx: 100, vy: 0});
  w.step(1 / 120);
  assert.equal(w.remaining, 0); assert.equal(w.completed, true); assert.equal(w.phase, 'campaign-celebrate');
  assert.equal(w.resultRating, 1); assert.equal(w.pinballJackpots, w.config.jackpotGoal);
  assert.equal(w.events.filter(e => e.type === 'campaignDrain' && !e.auxiliary).length, 1);
  assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
  assert.ok(aux.id > w.player.id); tick(w, 2);
  assert.equal(w.events.filter(e => e.type === 'over').length, 1); assert.equal(w.completed, true);
});

test('an immediate region end is deferred until every actor has processed its current substep', () => {
  const w = fresh(); isolate(w); w.shoot(0, 80);
  Object.assign(w.player, {x: 120, y: 450, vx: 100, vy: 0});
  const aux = auxiliary(w, {x: 220, y: 450, vx: 100, vy: 0});
  w.addZone({shape: 'rect', x: 120, y: 450, width: 10, height: 20, centerOnly: true});
  w.addStatic({shape: 'rect', x: aux.x + aux.r + 1.1, y: 450, width: 2, height: 50});
  const order = [];
  w.rules.onZone = body => { if (body !== w.player) return false; order.push('drain'); body.captured = true; w.requestLaunchEnd({reason: 'drain', immediate: true}); return true; };
  w.rules.onStaticHit = (_shape, _contact, actor) => { assert.equal(actor, aux); order.push('aux-hit'); };
  w.rules.onLaunchEnd = () => order.push('end');
  w.step(1 / 120); assert.deepEqual(order, ['drain', 'aux-hit', 'end']); assert.equal(w.shotActive, false);
});

test('task9 resize exclusions cover auxiliaries, survive repeated resize, and release after physical exit', () => {
  const w = fresh(); isolate(w); w.shoot(0, 80); w.player.captured = true;
  const aux = auxiliary(w, {x: 195, y: 450, vx: 0, vy: 0});
  const zone = w.addZone({shape: 'rect', x: aux.x, y: aux.y, width: 30, height: 30, centerOnly: true, continuous: true});
  let fired = 0; w.rules.resize = () => {}; w.rules.onZone = () => { fired++; return true; };
  w.resize(w.width, w.height); const key = `${aux.id}:${zone.id}`;
  assert.equal(zoneContains(aux, zone), true); assert.equal(w.blockedZoneEntries.has(key), true);
  w.resize(w.width, w.height); w.step(1 / 120); assert.equal(fired, 0); assert.equal(w.blockedZoneEntries.has(key), true);
  aux.vx = 300; tick(w, .1); assert.equal(w.blockedZoneEntries.has(key), false); assert.equal(fired, 0);
  aux.vx = -300; tick(w, .1); assert.ok(fired > 0); assert.equal(w.remaining, w.budget);
});

test('task9 slow depth follows feedback strength and reduced-motion bypasses world slowing', () => {
  for (const level of [2, 6]) {
    const w = fresh(level); w.setFeedbackOptions({strength: .6}); w.beginCampaignSlow({duration: .4, scale: .3});
    near(w.presentationTimeScale, .58);
    w.setFeedbackOptions({strength: 1, reducedMotion: true}); assert.equal(w.presentationTimeScale, 1);
    w.setFeedbackOptions({strength: 0}); assert.equal(w.presentationTimeScale, 1);
  }
});

function chargeThroughRealBumperShots(w) {
  for (let shot = 0; shot < 15 && !w.pinballState.multiballReady && w.ready; shot++) {
    const bumper = w.statics.filter(s => s.kind === 'bumper').sort((a, b) =>
      Math.hypot(a.x - w.player.x, a.y - w.player.y) - Math.hypot(b.x - w.player.x, b.y - w.player.y))[0];
    const angle = Math.atan2(bumper.y - w.player.y, bumper.x - w.player.x);
    assert.equal(w.shoot(-Math.cos(angle) * w.maxPull, -Math.sin(angle) * w.maxPull), true);
    for (let frame = 0; frame < 600 && w.shotActive; frame++) w.step(1 / 120);
  }
  assert.equal(w.pinballState.multiballReady, true); assert.equal(w.ready, true);
}

test('real multiball rotations separate every actor and never invent a target hit, charge or life loss', () => {
  let activeCases = 0, excludedCases = 0;
  for (const [width, height, nextW, nextH] of [[390, 844, 568, 320], [568, 320, 390, 844]])
    for (const k of [0, 3, 9]) for (let direction = 0; direction < 8; direction++) for (const frames of [15, 45, 120]) {
      const w = new CampaignWorld(width, height, 6 + 10 * k, () => .5, {upgradeId: 'rubber'});
      chargeThroughRealBumperShots(w);
      const angle = -Math.PI + direction * Math.PI / 4;
      w.shoot(-Math.cos(angle) * w.maxPull, -Math.sin(angle) * w.maxPull);
      assert.equal(w.auxiliaries.length, 1);
      for (let frame = 0; frame < frames && w.shotActive; frame++) w.step(1 / 120);
      if (!w.shotActive || !w.auxiliaries.length) continue;
      activeCases++;
      const before = [w.score, w.remaining, w.pinballState.charge, w.pinballJackpots, w.shotsUsed];
      w.resize(nextW, nextH); w.resize(nextW, nextH);
      assert.deepEqual([w.score, w.remaining, w.pinballState.charge, w.pinballJackpots, w.shotsUsed], before);
      for (const actor of w.campaignActors) if (!actor.captured) for (const shape of w.statics)
        assert.ok((staticContact(actor, shape)?.depth || 0) < 1e-5, `rotation overlap ${k}:${actor.id}:${shape.id}`);
      if (w.blockedStaticEntries.size) {
        excludedCases++;
        const excluded = new Set(w.blockedStaticEntries), hp = w.statics.map(s => s.hp), events = w.events.length;
        w.step(1e-6);
        for (const shape of w.statics) if ([...excluded].some(key => key.endsWith(`:${shape.id}`)))
          assert.equal(shape.hp, hp[w.statics.indexOf(shape)]);
        for (const event of w.events.slice(events).filter(e => e.type === 'campaignBumperHit'))
          assert.equal(excluded.has(`${event.attackerId}:${event.bodyId}`), false);
        assert.equal(w.remaining, before[1]);
      }
    }
  assert.ok(activeCases >= 130); assert.ok(excludedCases >= 5);
});

test('a rotation-created static contact remains excluded only until the actor physically leaves', () => {
  const w = fresh(); isolate(w); w.shoot(0, 80); w.player.captured = true;
  const target = w.addStatic({shape: 'circle', x: 200, y: 500, r: 20, hp: 3});
  const aux = auxiliary(w, {x: target.x + target.r + .7 * w.unit - 3, y: target.y, vx: -100, vy: 0});
  let hits = 0; w.rules.resize = () => {}; w.rules.onStaticHit = () => hits++;
  w.resize(w.width, w.height); const key = `${aux.id}:${target.id}`;
  assert.equal(w.blockedStaticEntries.has(key), true); assert.equal(staticContact(aux, target), null);
  w.resize(w.width, w.height); w.step(1 / 120);
  assert.equal(hits, 0); assert.ok(aux.vx > 0, 'physical rebound still happens without invented credit');
  tick(w, .2); assert.equal(w.blockedStaticEntries.has(key), false);
  aux.vx = -200; tick(w, .2); assert.equal(hits, 1);
});
