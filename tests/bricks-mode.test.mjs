import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, levelConfig, campaignUpgradeChoices} from '../dist/campaign.js';
import {bricksParams, bricksCell, bricksLayout} from '../dist/classes/bricks.js';

const fresh = (k = 0, width = 390, height = 844, upgradeId = 'energy') => {
  const w = new CampaignWorld(width, height, k * 10 + 3, () => .51, {upgradeId});
  w.setFeedbackOptions({strength: .6, reducedMotion: false}); return w;
};
const tick = w => { const scale = w.presentationTimeScale; w.step(scale / 120, false, {timeScale: scale}); };
const until = (w, predicate, limit = 1800) => { for (let i = 0; i < limit && !predicate(); i++) tick(w); assert.ok(predicate(), 'phase reaches its deadline'); };
const fire = (w, angle, power = 1) => {
  assert.equal(w.shoot(-Math.cos(angle) * w.maxPull * power, -Math.sin(angle) * w.maxPull * power), true);
  until(w, () => w.ready || w.phase === 'over');
};
const live = w => w.statics.filter(b => b.kind === 'number-brick' && !b.dead && b.hp > 0);

// These fixture helpers test boundary rules only. The final route checks use
// only public shoot/step, normal feedback and fresh deterministic layouts.
const fixtureKill = (w, brick) => w.hitStatic(brick, brick.hp,
  {attacker: w.auxiliaries[0] || w.player, nx: 0, ny: -1, impactVx: 0, impactVy: -w.unit * 20,
    normalSpeed: w.unit * 20, source: 'bricks'});

test('bricks ten tiers preserve literal cap, HP, target and turn formulas and the approved upgrade pool', () => {
  for (let k = 0; k < 10; k++) {
    const p = bricksParams(k), c = levelConfig(k * 10 + 3);
    assert.equal(c.implemented, true); assert.equal(c.type, 'bricks'); assert.equal(c.k, k);
    assert.equal(p.goal, 30 + 10 * k); assert.equal(p.roundLimit, 25 + 5 * k);
    assert.equal(p.ballCap, 12 + Math.floor(.9 * k)); assert.equal(p.hpScale, 1 + .15 * k);
    assert.equal(p.initialBalls, 4); assert.equal(p.initialRows, 3); assert.equal(p.shotDuration, 3.5);
    assert.equal(p.brickRadius, .8); assert.equal(p.ballRadius, .5); assert.equal(p.launchInterval, .12);
    assert.equal(bricksParams(3).ballCap, 14, 'literal formula wins over the early table example 15');
    const choices = campaignUpgradeChoices(k * 10 + 3, () => .51);
    assert.equal(choices.length, 2); assert.notEqual(choices[0].id, choices[1].id);
    assert.ok(choices.every(c => ['split', 'energy', 'breath', 'pulse'].includes(c.id)));
  }
});

test('fixed hash is independent of retry, random source, upgrade and screen; cell probabilities are disjoint', () => {
  let brick = 0, plus = 0, empty = 0;
  for (let k = 0; k < 10; k++) for (let row = 0; row < 1000; row++) for (let col = 0; col < 6; col++) {
    const cell = bricksCell(k, row, col); if (cell === 'brick') brick++; else if (cell === 'plus') plus++; else empty++;
  }
  assert.equal(brick + plus + empty, 60000); assert.ok(Math.abs(brick / 60000 - .55) < .01); assert.ok(Math.abs(plus / 60000 - .1) < .01);
  const signature = w => [...w.statics, ...w.zones].map(b => [b.kind, b.gridRow, b.gridColumn, b.hp]);
  for (let k = 0; k < 10; k++) {
    const a = fresh(k), b = new CampaignWorld(568, 320, k * 10 + 3, () => .99, {upgradeId: 'pulse'});
    assert.deepEqual(signature(a), signature(b)); assert.deepEqual(signature(a), signature(fresh(k)));
  }
});

test('six cells and three starting rows fit five layouts with exact brick and player collision radii', () => {
  for (const [width, height] of [[320, 568], [390, 844], [568, 320], [844, 390], [1440, 900]]) for (let k = 0; k < 10; k++) {
    const w = fresh(k, width, height), l = bricksLayout(w), p = bricksParams(k);
    assert.equal(w.player.r, w.unit); assert.ok(l.pitch >= 2.4 * w.unit - 1e-9);
    assert.ok(Math.abs(l.first + l.pitch * l.capacity - l.launchAlong) < 1e-8);
    assert.ok(l.capacity >= 4);
    for (const b of [...w.statics, ...w.zones]) {
      assert.ok(b.x - b.r >= l.left && b.x + b.r <= l.right && b.y - b.r >= l.top && b.y + b.r <= l.bottom);
      if (b.kind === 'number-brick') { assert.equal(b.r, w.unit * .8); assert.equal(b.hp, Math.round(p.hpScale)); }
    }
    assert.ok(w.teachingTarget || k > 0);
  }
});

test('volley releases real half-radius balls every .12s, then ends at 3.5s and returns before shifting', () => {
  const w = fresh(); assert.equal(w.shoot(0, w.maxPull), true);
  assert.equal(w.player.captured, true); assert.equal(w.auxiliaries.length, 1);
  until(w, () => !w.shotActive);
  const releases = w.events.filter(e => e.type === 'campaignBrickBall');
  assert.equal(releases.length, 4);
  releases.forEach((e, i) => assert.ok(Math.abs(e.time - i * .12) < 1e-8));
  assert.ok(Math.abs(w.shotTime - 3.5) < 1e-8);
  assert.equal(w.ready, false); assert.equal(w.auxiliaries.length, 0); assert.equal(w.bricksReturns.length, 4);
  assert.ok(w.bricksReturns.every(r => r.bodySnapshot.r === w.unit * .5 && r.bodySnapshot.isAuxiliary));
  const clock = w.feedbackTime, round = w.bricksRound;
  assert.equal(w.shoot(0, w.maxPull), false); assert.equal(w.feedbackTime, clock); assert.equal(w.bricksRound, round);
  until(w, () => w.ready);
  assert.equal(w.bricksRound, 2); assert.equal(w.player.captured, false); assert.equal(w.remaining, 24);
  assert.deepEqual({x: w.player.x, y: w.player.y}, w.bricksLayout.spawn);
  assert.ok(live(w).filter(b => b.spawnedRound === 2).every(b => b.hp === 2));
});

test('pickup counts once, applies to next volley and all ten ball caps include first-kill split children', () => {
  for (let k = 0; k < 10; k++) {
    const w = fresh(k, 390, 844, 'split'), cap = w.config.ballCap;
    w.bricksBallCount = cap - 1; w.shoot(0, w.maxPull);
    const plus = w.addZone({kind: 'brick-plus', shape: 'circle', x: w.player.x, y: w.player.y, r: w.unit * .45});
    w.rules.onZone(w.auxiliaries[0], plus); w.rules.onZone(w.auxiliaries[0], plus);
    assert.equal(w.bricksBallCount, cap); assert.equal(w.bricksVolleyCount, cap - 1);
    assert.equal(w.events.filter(e => e.type === 'campaignBrickPlus').length, 1);
    fixtureKill(w, live(w)[0]);
    assert.equal(w.auxiliaries.filter(b => b.campaignSplit).length, 1, 'one remaining total-volley slot');
    let peak = w.auxiliaries.length;
    while (w.shotActive) { tick(w); peak = Math.max(peak, w.auxiliaries.length); }
    assert.ok(peak <= cap);
  }
});

test('energy, split, pulse and approved breath each have their own real effect', () => {
  const base = fresh(0, 390, 844, 'breath'), energy = fresh();
  base.shoot(0, base.maxPull); energy.shoot(0, energy.maxPull);
  assert.ok(Math.abs(Math.hypot(energy.auxiliaries[0].vx, energy.auxiliaries[0].vy) /
    Math.hypot(base.auxiliaries[0].vx, base.auxiliaries[0].vy) - Math.sqrt(1.3)) < 1e-10);
  const split = fresh(0, 390, 844, 'split'); split.shoot(0, split.maxPull); fixtureKill(split, live(split)[0]);
  const children = split.auxiliaries.filter(b => b.campaignSplit);
  assert.equal(children.length, 2); assert.ok(children.every(b => b.r === split.unit * .5 && b.damageScale === .6));
  fixtureKill(split, live(split)[0]); assert.equal(split.auxiliaries.filter(b => b.campaignSplit).length, 2);
  const pulse = fresh(0, 390, 844, 'pulse'); pulse.shoot(0, pulse.maxPull);
  const [a, b] = live(pulse); Object.assign(a, {hp: 10, maxHp: 10}); Object.assign(b, {hp: 10, maxHp: 10, x: a.x + pulse.unit * 2, y: a.y});
  pulse.rules.onStaticHit(a, {attacker: pulse.auxiliaries[0], normalSpeed: pulse.unit * 20, impactVx: 0, impactVy: -pulse.unit * 20});
  assert.equal(a.hp, 9); assert.equal(b.hp, 9.7); assert.equal(pulse.events.filter(e => e.type === 'pulse').length, 1);
  fixtureKill(base, live(base)[0]); base.endLaunch(); until(base, () => base.ready);
  assert.equal(base.events.filter(e => e.type === 'campaignBrickRow').at(-1).generated, false);
  assert.ok(Math.abs(base.bricksSpawnClock - 2 / 3) < 1e-10);
  assert.ok(live(base).every(b => b.gridRow >= 1), 'breath delays a new row, while all old rows still descend');
});

test('three genuine row identities cleared in one volley produce one slow cue and notes saturate at sixteen', () => {
  const w = fresh(); w.shoot(0, w.maxPull);
  for (const brick of [...live(w)]) fixtureKill(w, brick);
  assert.equal(w.bricksRoundRows, 3); assert.equal(w.bricksRowsCleared, 3);
  assert.equal(w.events.filter(e => e.type === 'campaignBrickRows').length, 1);
  assert.equal(w.events.filter(e => e.type === 'campaignSlow' && e.kind === 'bricks-rows').length, 1);
  const high = w.addStatic({kind: 'number-brick', shape: 'circle', x: 100, y: 200, r: w.unit * .8, hp: 30, maxHp: 30});
  for (let i = 0; i < 20; i++) w.rules.onStaticHit(high, {attacker: w.auxiliaries[0], normalSpeed: w.unit * 20});
  assert.equal(w.events.filter(e => e.type === 'campaignBrickHit').at(-1).note, 16);
});

test('last legal turn real ball hit wins before exhaustion, cancels queued balls and restores the main player', () => {
  const w = fresh(9), brick = live(w)[0];
  w.statics = [brick]; w.zones = []; w.bricksBroken = w.config.goal - 1; w.remaining = 1;
  Object.assign(brick, {x: w.player.x, y: w.player.y - w.unit * 3, hp: 1, maxHp: 1});
  fire(w, -Math.PI / 2);
  assert.equal(w.completed, true); assert.equal(w.remaining, 0); assert.equal(w.resultRating, 1);
  assert.equal(w.bricksBroken, w.config.goal); assert.equal(w.player.captured, false); assert.equal(w.bricksQueue, 0);
  assert.equal(w.events.filter(e => e.type === 'over').length, 1);
  assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
});

test('all ten tiers lose from real weak volleys advancing bricks to the player row', () => {
  for (let k = 0; k < 10; k++) {
    const w = fresh(k);
    while (w.phase === 'battle') { w.shoot(6, 0); until(w, () => w.ready || w.phase === 'over'); }
    assert.equal(w.completed, false); assert.equal(w.bricksOverflow, true); assert.equal(w.bricksBroken, 0);
    assert.equal(w.events.filter(e => e.type === 'over').length, 1);
  }
});

test('rotation preserves volley queues, score, launch speed, row allowance and return clocks', () => {
  const w = fresh(); w.shoot(0, w.maxPull); for (let i = 0; i < 16; i++) tick(w);
  const queue = w.bricksQueue, remaining = w.remaining, capacity = w.bricksLayout.capacity;
  const speed = Math.hypot(w.bricksLaunchVelocity.vx, w.bricksLaunchVelocity.vy) / w.unit;
  w.resize(568, 320);
  assert.equal(w.bricksQueue, queue); assert.equal(w.remaining, remaining); assert.equal(w.bricksLayout.capacity, capacity);
  assert.ok(Math.abs(Math.hypot(w.bricksLaunchVelocity.vx, w.bricksLaunchVelocity.vy) / w.unit - speed) < 1e-9);
  until(w, () => !w.shotActive); const at = w.bricksReturns[0].at;
  w.resize(390, 844); assert.equal(w.bricksReturns[0].at, at);
  assert.ok(w.bricksReturns.every(r => r.toX === w.bricksLayout.spawn.x && r.toY === w.bricksLayout.spawn.y));
  until(w, () => w.ready); assert.equal(w.player.captured, false);
  assert.equal(w.bricksLayout.capacity, capacity);
});

test('extreme shrinking buffers upper rows without overlap, lost HP or mistaken pickup collection', () => {
  const w = fresh(0, 844, 390), capacity = w.bricksLayout.capacity;
  const original = [...w.statics, ...w.zones].map(b => ({id: b.id, hp: b.hp, kind: b.kind}));
  const verifySpacing = () => {
    const bs = live(w);
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++)
      assert.ok(Math.hypot(bs[i].x - bs[j].x, bs[i].y - bs[j].y) >= bs[i].r + bs[j].r);
  };
  w.resize(320, 568); verifySpacing();
  assert.equal(w.bricksLayout.capacity, capacity); assert.ok(w.bricksLayout.pitch >= w.unit * 1.68 - 1e-9);
  assert.ok([...w.statics, ...w.zones].some(b => b.buffered));
  assert.ok([...w.statics, ...w.zones].filter(b => b.buffered).every(b => b.active === false && !b.collected));
  assert.ok(!w.teachingTarget?.buffered); assert.equal(w.bricksBroken, 0);
  w.resize(844, 390); verifySpacing();
  assert.ok([...w.statics, ...w.zones].every(b => !b.buffered && b.active !== false));
  assert.equal(w.remaining, w.config.roundLimit);
  w.resize(320, 568);
  for (let round = 0; round < 5; round++) { w.shoot(6, 0); until(w, () => w.ready); }
  for (const old of original) {
    const body = [...w.statics, ...w.zones].find(b => b.id === old.id);
    assert.ok(body, 'buffering keeps both bricks and +1 pickups'); assert.equal(body.hp, old.hp);
    assert.equal(body.buffered, false); assert.equal(body.active, true); assert.ok(!body.collected);
  }
  verifySpacing(); assert.equal(w.bricksBroken, 0); assert.equal(w.bricksBallCount, 4);
});

test('reduced motion snaps the row geometry but preserves turn timing and rating thresholds', () => {
  const w = fresh(); w.setFeedbackOptions({strength: .6, reducedMotion: true}); w.shoot(6, 0);
  until(w, () => !!w.bricksShift); const shift = w.bricksShift; tick(w);
  assert.equal(w.bricksShift, shift); assert.equal(w.ready, false);
  for (const b of live(w)) {
    const expected = w.bricksLayout.top + w.bricksLayout.first + b.gridRow * w.bricksLayout.pitch;
    assert.ok(Math.abs(b.y - expected) < 1e-8);
  }
  until(w, () => w.ready);
  for (const [left, rating] of [[8, 3], [7, 2], [3, 2], [2, 1]]) { w.remaining = left; assert.equal(w.rules.rating(), rating); }
});

// Fixed routes were found with one-shot candidate evaluation, then independently
// replayed from fresh worlds. These tests never search, edit HP/positions, call
// damage, grant balls, change the seed, or alter the turn budget.
const BRICKS_ROUTES = [
  {"k":0,"width":390,"height":844,"upgrade":"energy","moves":[[-1.846594433884,1],[-1.759985828622,1],[-1.706765708243,1],[-1.759985828622,1],[-1.381606824968,1],[-1.65136926512,1],[-1.412515695984,1]]},
  {"k":1,"width":390,"height":844,"upgrade":"energy","moves":[[-1.588951474421,1],[-1.61636926512,1],[-0.870796326795,1],[-1.399826945347,1],[-1.270796326795,1],[-1.65136926512,1],[-1.49022338847,1],[-1.654869450823,1],[-1.794985828622,1],[-1.759985828622,1],[-1.759985828622,1],[-1.377515695984,1],[-1.776594433884,1],[-1.584869450823,1]]},
  {"k":2,"width":390,"height":844,"upgrade":"energy","moves":[[-1.377515695984,1],[-1.759985828622,1],[-1.65136926512,1],[-1.58136926512,1],[-1.65136926512,1],[-1.38951114365,1],[-1.49022338847,1],[-1.65136926512,1],[-1.45951114365,1],[-1.68208150994,1],[-1.75208150994,1],[-1.68208150994,1],[-2.270796326795,1],[-1.261790560371,1],[-1.346606824968,1]]},
  {"k":3,"width":390,"height":844,"upgrade":"energy","moves":[[-1.870796326795,1],[-1.381606824968,1],[-1.399826945347,1],[-1.399826945347,1],[-1.49022338847,1],[-1.65136926512,1],[-1.759985828622,1],[-1.865800803387,1],[-1.381606824968,1],[-1.49022338847,1],[-1.776594433884,1],[-2.270796326795,1],[-1.75208150994,1],[-1.671765708243,1],[-1.345791850203,1],[-1.58136926512,1],[-1.694076957606,1],[-1.75208150994,1],[-1.556723202767,1]]},
  {"k":4,"width":390,"height":844,"upgrade":"energy","moves":[[-1.588951474421,1],[-1.434826945347,1],[-1.65136926512,1],[-1.399826945347,1],[-1.741765708243,1],[-1.364998219706,1],[-1.65136926512,1],[-1.38951114365,1],[-1.584869450823,1],[-1.68208150994,1],[-1.68208150994,1],[-1.58136926512,1],[-1.65136926512,1],[-1.364998219706,1],[-1.776594433884,1],[-1.556723202767,1],[-1.377515695984,1],[-1.794985828622,1],[-1.346606824968,1],[-1.377515695984,1],[-1.588951474421,1],[-1.486723202767,1]]},
  {"k":5,"width":390,"height":844,"upgrade":"energy","moves":[[-1.346606824968,1],[-1.888247951843,1],[-1.49022338847,1],[-1.654869450823,1],[-1.364998219706,1],[-1.399826945347,1],[-1.486723202767,1],[-1.556723202767,1],[-1.381606824968,1],[-1.75208150994,1],[-1.377515695984,1],[-1.776594433884,1],[-1.584869450823,1],[-1.58136926512,1],[-1.38951114365,1],[-1.708194157249,1],[-1.776594433884,1],[-2.270796326795,1],[-1.552641179169,1],[-1.45951114365,1],[-1.377515695984,1],[-1.68208150994,1],[-1.588951474421,1],[-1.346606824968,1],[-1.811594433884,1],[-1.776594433884,1]]},
  {"k":6,"width":390,"height":844,"upgrade":"energy","moves":[[-1.795800803387,1],[-1.671765708243,1],[-1.58136926512,1],[-1.399826945347,1],[-1.486723202767,1],[-1.399826945347,1],[-1.706765708243,1],[-1.759985828622,1],[-1.346606824968,1],[-1.654869450823,1],[-1.75208150994,1],[-1.776594433884,1],[-1.323344701747,1],[-1.399826945347,1],[-1.552641179169,1],[-1.486723202767,1],[-1.584869450823,1],[-1.818247951843,1],[-1.323344701747,1],[-1.45951114365,1],[-1.654869450823,1],[-1.486723202767,1],[-1.778194157249,1],[-1.818247951843,1],[-1.346606824968,1],[-1.776594433884,1],[-1.694076957606,1],[-1.447515695984,1],[-1.870796326795,1],[-1.818247951843,1],[-0.870796326795,1]]},
  {"k":7,"width":390,"height":844,"upgrade":"energy","moves":[[-1.294998219706,1],[-1.818247951843,1],[-1.759985828622,1],[-1.381606824968,1],[-1.65136926512,1],[-1.741765708243,1],[-1.584869450823,1],[-1.56022338847,1],[-0.870796326795,1],[-1.364998219706,1],[-1.68208150994,1],[-1.486723202767,1],[-2.270796326795,1],[-0.870796326795,1],[-1.482641179169,1],[-1.776594433884,1],[-1.694076957606,1],[-1.45951114365,1],[-1.694076957606,1],[-1.364998219706,1],[-1.75208150994,1],[-1.75208150994,1],[-1.477819264974,1],[-1.584869450823,1],[-1.323344701747,1],[-1.811594433884,1],[-1.345791850203,1],[-1.818247951843,1],[-1.694076957606,1],[-1.795800803387,1],[-1.326103757638,1],[-1.776594433884,1]]},
  {"k":8,"width":390,"height":844,"upgrade":"energy","moves":[[-1.588951474421,1],[-1.270796326795,1],[-1.49022338847,1],[-1.741765708243,1],[-1.364998219706,1],[-1.776594433884,1],[-1.38951114365,1],[-1.75208150994,1],[-1.364998219706,1],[-1.75208150994,1],[-1.671765708243,1],[-1.556723202767,1],[-1.447515695984,1],[-1.486723202767,1],[-0.870796326795,1],[-1.447515695984,1],[-1.694076957606,1],[-1.844802093219,1],[-1.345791850203,1],[-1.323344701747,1],[-1.706765708243,1],[-1.844802093219,1],[-1.764076957606,1],[-1.381606824968,1],[-1.296790560371,1],[-1.795800803387,1],[-1.725043193646,1],[-1.329998219706,1],[-1.795800803387,1],[-1.593773388616,1],[-1.49997461597,1],[-1.619869450823,1],[-1.346549459944,1],[-0.870796326795,1],[-1.296790560371,1],[-1.963666012411,1]]},
  {"k":9,"width":390,"height":844,"upgrade":"energy","moves":[[-1.584869450823,1],[-1.759985828622,1],[-1.486723202767,1],[-1.49022338847,1],[-1.741765708243,1],[-0.870796326795,1],[-1.345791850203,1],[-0.870796326795,1],[-1.588951474421,1],[-1.377515695984,1],[-1.694076957606,1],[-1.778194157249,1],[-1.447515695984,1],[-1.381549459944,1],[-1.552641179169,1],[-1.345791850203,1],[-1.588951474421,1],[-1.706765708243,1],[-1.671765708243,1],[-1.911653658347,1],[-1.811594433884,1],[-1.53497461597,1],[-1.998666012411,1],[-1.708194157249,1],[-1.71708150994,1],[-1.464784721922,1],[-1.708194157249,1],[-2.270796326795,1],[-2.05975606686,1],[-2.270796326795,1],[-1.469826945347,1],[-0.870796326795,1],[-1.370796328782,1],[-1.58136926512,1],[-0.897227820883,1],[-0.524680392128,1],[-1.270796326795,1],[-1.507036548171,1],[-1.303706949145,1],[-2.05975606686,1],[-1.338706949145,1],[-2.279364832706,1],[-1.396103757638,1]]},
  {"k":0,"width":844,"height":390,"upgrade":"energy","moves":[[-0.7,1],[-0.128698139954,1],[0.058698139954,1],[-0.7,1],[0.7,1],[-0.033269932788,1],[-0.7,1]]},
  {"k":1,"width":844,"height":390,"upgrade":"energy","moves":[[0.140675327167,1],[-0.03131419696,1],[-0.129899976485,1],[-0.7,1],[0.7,1],[-0.7,1],[0.3,1],[-0.134516809375,1],[0.7,1],[-0.120360032987,1],[-0.7,1],[-0.175675327167,1],[0.058698139954,1],[0.7,1]]},
  {"k":2,"width":844,"height":390,"upgrade":"energy","moves":[[0.3,1],[0.00368580304,1],[-0.06631419696,1],[-0.00368580304,1],[0.7,1],[0.058698139954,1],[0.3,1],[-0.3,1],[-0.058698139954,1],[-0.06631419696,1],[0.7,1],[-0.134516809375,1],[0.134516809375,1],[0.001730067212,1]]},
  {"k":3,"width":844,"height":390,"upgrade":"energy","moves":[[0.210675327167,1],[0.7,1],[-0.7,1],[0.128698139954,1],[0.128698139954,1],[-0.128698139954,1],[0.070486124847,1],[-0.164899976485,1],[0.134516809375,1],[0.7,1],[-0.134516809375,1],[-0.06631419696,1],[0.06631419696,1],[-0.06631419696,1],[0.129899976485,1],[0.06631419696,1],[-0.141103117209,1],[0.3,1]]},
  {"k":4,"width":844,"height":390,"upgrade":"energy","moves":[[-0.141103117209,1],[0.140675327167,1],[-0.7,1],[-0.7,1],[0.058698139954,1],[0.128698139954,1],[-0.058698139954,1],[0.3,1],[0.128698139954,1],[-0.06631419696,1],[-0.128698139954,1],[0.120360032987,1],[0.001730067212,1],[0.7,1],[-0.140675327167,1],[-0.001730067212,1],[-0.140675327167,1],[0.7,1],[0.134516809375,1],[0.140675327167,1],[0.068269932788,1],[-0.129899976485,1]]},
  {"k":5,"width":844,"height":390,"upgrade":"energy","moves":[[0.141103117209,1],[-0.7,1],[0.064516809375,1],[0.7,1],[-0.199899976485,1],[0.06631419696,1],[0.128698139954,1],[-0.7,1],[0.128698139954,1],[-0.129899976485,1],[0.06631419696,1],[-0.128698139954,1],[0.3,1],[0.7,1],[-0.068269932788,1],[-0.128698139954,1],[0.064516809375,1],[-0.068269932788,1],[-0.129899976485,1],[-0.129899976485,1],[0.134516809375,1],[-0.001730067212,1],[-0.071103117209,1],[-0.7,1],[-0.3,1],[0.3,1]]},
  {"k":6,"width":844,"height":390,"upgrade":"energy","moves":[[0.071103117209,1],[0.7,1],[-0.00368580304,1],[0.128698139954,1],[-0.001730067212,1],[0.128698139954,1],[-0.128698139954,1],[-0.128698139954,1],[0.134516809375,1],[-0.068269932788,1],[-0.134516809375,1],[0.141103117209,1],[-0.129899976485,1],[-0.06631419696,1],[0.28763767038,1],[0.064516809375,1],[-0.3,1],[-0.7,1],[-0.00368580304,1],[0.068269932788,1],[-0.272484754179,1],[-0.070486124847,1],[0.140675327167,1],[0.140675327167,1],[-0.199899976485,1],[0.129899976485,1],[-0.129899976485,1],[-0.175675327167,1],[0.3,1],[0.3,1]]},
  {"k":7,"width":844,"height":390,"upgrade":"energy","moves":[[0.070486124847,1],[0.128698139954,1],[-0.7,1],[0.134516809375,1],[-0.06631419696,1],[-0.06631419696,1],[-0.7,1],[0.06631419696,1],[-0.064516809375,1],[-0.058698139954,1],[0.7,1],[-0.152939604521,1],[0.064516809375,1],[0.058698139954,1],[-0.064516809375,1],[-0.134516809375,1],[0.06631419696,1],[-0.068269932788,1],[0.140675327167,1],[0.000486124847,1],[0.134516809375,1],[-0.058698139954,1],[0.140675327167,1],[0.140675327167,1],[-0.140675327167,1],[0.134516809375,1],[-0.3,1],[-0.134516809375,1],[0.140675327167,1],[-0.053201291613,1]]},
  {"k":8,"width":844,"height":390,"upgrade":"energy","moves":[[-0.068269932788,1],[0.210675327167,1],[0.128698139954,1],[0.03131419696,1],[0.128698139954,1],[0.128698139954,1],[0.003018487563,1],[0.128698139954,1],[-0.128698139954,1],[0.129899976485,1],[-0.064516809375,1],[0.064516809375,1],[0.00368580304,1],[0.129899976485,1],[0.001730067212,1],[-0.134516809375,1],[0.141103117209,1],[0.001730067212,1],[-0.260220545703,1],[0.120360032987,1],[-0.222939604521,1],[0.164899976485,1],[0.073018487563,1],[0.001730067212,1],[0.141103117209,1],[-0.155360032987,1],[-0.140675327167,1],[-0.167019729084,1],[-0.167019729084,1],[-0.417655017388,1],[-0.000486124847,1],[0.164899976485,1],[-0.097350619643,1],[-0.141103117209,1]]},
  {"k":9,"width":844,"height":390,"upgrade":"energy","moves":[[-0.058698139954,1],[-0.7,1],[0.128698139954,1],[0.06631419696,1],[0.06631419696,1],[-0.134516809375,1],[0.134516809375,1],[0.129899976485,1],[-0.3,1],[0.071103117209,1],[0.078618995741,1],[0.129899976485,1],[-0.093698139954,1],[-0.134516809375,1],[0.134516809375,1],[-0.064516809375,1],[0.00368580304,1],[0.071103117209,1],[-0.064516809375,1],[-0.272484754179,1],[0.070486124847,1],[0.164899976485,1],[-0.140675327167,1],[-0.183344161746,1],[0.000486124847,1],[0.175675327167,1],[0.183344161746,1],[0.187939604521,1],[-0.078618995741,1],[-0.097350619643,1],[0.079347189759,1],[-0.3,1],[-0.179223125155,1],[0.260220545703,1],[0.009347189759,1],[0.106103117209,1],[0.053201291613,1],[-0.167350619643,1],[-0.144223125155,1],[0.202019729084,1],[-0.00368580304,1],[-0.295220545703,1]]},
  {"k":0,"width":390,"height":844,"upgrade":"split","moves":[[-1.584869450823,1],[-1.741765708243,1],[-1.364998219706,1],[-1.741765708243,1],[-1.45951114365,1],[-1.671765708243,1],[-1.776594433884,1]]},
  {"k":0,"width":390,"height":844,"upgrade":"breath","moves":[[-1.584869450823,1],[-1.570796326795,1],[-1.741765708243,1],[-1.45951114365,1],[-1.399826945347,1],[-1.865800803387,1],[-1.706765708243,1],[-1.776594433884,1],[-1.45951114365,1],[-1.706765708243,1]]},
  {"k":0,"width":390,"height":844,"upgrade":"pulse","moves":[[-1.584869450823,1],[-1.741765708243,1],[-1.364998219706,1],[-1.49022338847,1],[-1.399826945347,1],[-1.764076957606,1],[-1.65136926512,1]]}
];

test('all ten tiers win by fixed real volleys in both orientations, plus each teaching upgrade', () => {
  for (const route of BRICKS_ROUTES) {
    const w = fresh(route.k, route.width, route.height, route.upgrade);
    let maxBalls = 0;
    for (const [angle, power] of route.moves) {
      assert.equal(w.shoot(-Math.cos(angle) * w.maxPull * power, -Math.sin(angle) * w.maxPull * power), true);
      assert.ok(w.bricksLaunchFreeze > 0, 'the production launch feedback hold is included');
      for (let i = 0; i < 1800 && !w.ready && w.phase !== 'over'; i++) {
        tick(w); maxBalls = Math.max(maxBalls, w.auxiliaries.length);
      }
    }
    assert.equal(w.completed, true, `tier ${route.k}, ${route.width}×${route.height}, ${route.upgrade}`);
    assert.equal(w.phase, 'over'); assert.ok(w.bricksBroken >= w.config.goal);
    assert.ok(w.shotsUsed <= w.config.roundLimit); assert.ok(maxBalls <= w.config.ballCap);
    assert.equal(w.score, w.bricksBroken * 10); assert.ok(w.resultRating >= 1 && w.resultRating <= 3);
    assert.equal(w.bricksQueue, 0); assert.equal(w.auxiliaries.length, 0); assert.equal(w.player.captured, false);
    assert.equal(w.events.filter(e => e.type === 'over').length, 1);
    assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
    const kills = w.events.filter(e => e.type === 'kill');
    assert.equal(kills.length, w.bricksBroken); assert.equal(new Set(kills.map(e => e.bodyId)).size, kills.length);
  }
});
