import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, levelConfig, campaignUpgradePool} from '../dist/campaign.js';
import {pinballParams, pinballLayout} from '../dist/classes/pinball.js';
import {staticContact} from '../dist/campaign-collision.js';

const fresh = (k = 0, width = 390, height = 844, upgradeId = 'rubber') =>
  new CampaignWorld(width, height, 6 + 10 * k, () => .5, {upgradeId});
const shape = (w, kind) => w.statics.find(s => s.kind === kind);
const targets = w => w.statics.filter(s => s.kind === 'pinball-target');
function tick(w) { const scale = w.presentationTimeScale; w.step(scale / 120, false, {timeScale: scale}); }
function seconds(w, duration) { for (let i = 0; i < Math.ceil(duration * 120); i++) tick(w); }
function shoot(w, angle, power = 1) {
  assert.equal(w.shoot(-Math.cos(angle) * w.maxPull * power, -Math.sin(angle) * w.maxPull * power), true);
  for (let i = 0; i < 1600 && w.shotActive && w.phase === 'battle'; i++) tick(w);
  assert.equal(w.shotActive, false, 'the real shot returns control or wins');
}
function hit(w, s, attacker = w.player) {
  w.rules.onStaticHit(s, {attacker, nx: 0, ny: -1, contactX: s.x, contactY: s.y + s.r,
    normalSpeed: 10 * w.unit, impactSpeed: 10 * w.unit, impactVx: 0, impactVy: -10 * w.unit}, attacker);
}
function clearGroup(w) { for (const t of targets(w)) if (!t.dead) hit(w, t); }
function clearJackpot(w) { const j = shape(w, 'jackpot'); for (let i = 0; i < 3; i++) hit(w, j); }
function drainFixture(w, body = w.player) {
  const zone = w.zones[0]; Object.assign(body, {x: zone.x, y: zone.y, vy: 10 * w.unit, vx: 0});
  return w.rules.onZone(body, zone, {previous: {x: zone.x, y: zone.y - zone.height / 2 - 1}});
}

test('pinball ten tiers retain explicit PDF radii, goals, lives and the documented target-count reconciliation', () => {
  for (let k = 0; k < 10; k++) {
    const p = pinballParams(k), w = fresh(k), c = levelConfig(6 + k * 10);
    assert.equal(c.classId, 'pinball'); assert.equal(c.implemented, true); assert.equal(c.k, k);
    assert.equal(p.bumperCount, Math.min(5, 3 + Math.floor(k / 3)));
    assert.equal(p.targetCount, 3 + Math.round(2 * k / 9));
    assert.equal(p.jackpotGoal, 3 + Math.floor(k / 3)); assert.equal(p.budget, 5 - Math.floor(k / 4));
    assert.equal(p.budgetKind, 'lives'); assert.equal(w.remaining, p.budget);
    assert.equal(w.statics.filter(s => s.kind === 'bumper').length, p.bumperCount);
    assert.equal(targets(w).length, p.targetCount); assert.ok(targets(w).every(t => t.hp === 1));
    assert.equal(shape(w, 'bumper').r, .9 * w.unit); assert.equal(shape(w, 'bumper').impulse, 8 * w.unit);
    assert.equal(shape(w, 'bumper').restitution, 1); assert.equal(shape(w, 'bumper').pierceable, false);
    assert.equal(shape(w, 'jackpot').r, 1.8 * w.unit); assert.equal(shape(w, 'jackpot').hp, 3);
    assert.equal(shape(w, 'jackpot').active, false); assert.equal(w.zones[0].width, 4 * w.unit);
    assert.deepEqual(campaignUpgradePool(w.level).map(u => u.id), ['rubber', 'energy', 'bank', 'pierce']);
    assert.equal(w.rules.rating(), 0); assert.equal(w.percent, 0);
  }
});

test('all three fixed target rows and jackpot fit five viewports without static overlap or obscuring the HUD', () => {
  for (const [width, height] of [[390, 844], [844, 390], [320, 568], [568, 320], [1280, 720]]) for (let k = 0; k < 10; k++) {
    const w = fresh(k), b = w.arenaBounds;
    w.resize(width, height);
    for (let group = 0; group < 3; group++) {
      const layout = pinballLayout(w, w.config, group), solids = [
        ...layout.bumpers.map(s => ({...s, shape: 'circle', r: .9 * w.unit})),
        {...layout.jackpot, shape: 'circle', r: 1.8 * w.unit},
      ];
      for (const [index, circle] of solids.entries()) {
        assert.ok(circle.y - circle.r >= (height > 520 ? 112 : 76));
        assert.ok(circle.x - circle.r >= w.arenaBounds.left && circle.x + circle.r <= w.arenaBounds.right);
        assert.ok(circle.y + circle.r <= w.arenaBounds.bottom);
        for (const other of solids.slice(index + 1)) assert.equal(staticContact(circle, other), null);
        for (const target of layout.targets) assert.equal(staticContact(circle, {...target, shape: 'rect'}), null);
      }
      for (const t of layout.targets) {
        assert.ok(t.y - t.height / 2 >= (height > 520 ? 112 : 76));
        assert.ok(t.x - t.width / 2 >= w.arenaBounds.left && t.x + t.width / 2 <= w.arenaBounds.right);
        assert.ok(t.y + t.height / 2 <= w.arenaBounds.bottom);
      }
      assert.equal(w.zones[0].visualY, w.arenaBounds.bottom);
    }
    assert.equal(w.remaining, w.config.budget); assert.equal(w.shotsUsed, 0); assert.ok(b.width > 0);
  }
});

test('public launches and four-second return never consume lives; ball save starts on the first launch and excludes idle time', () => {
  const w = fresh(), budget = w.remaining;
  seconds(w, 20); assert.equal(w.pinballState.saveRemaining, 8);
  shoot(w, 0, .2); assert.equal(w.remaining, budget); assert.equal(w.shotsUsed, 1);
  const saved = w.pinballState.saveRemaining; assert.ok(saved < 8 && saved > 4);
  seconds(w, 20); assert.equal(w.pinballState.saveRemaining, saved);
  w.shoot(w.maxPull, 0); assert.equal(drainFixture(w), true);
  assert.equal(w.remaining, budget); assert.equal(w.events.filter(e => e.type === 'campaignBallSave').length, 1);
  assert.equal(drainFixture(w), false); tick(w);
  assert.equal(w.shotActive, false); assert.equal(w.player.captured, false);
  assert.equal(w.player.x, w.pinballBoard.start.x); assert.equal(w.player.y, w.pinballBoard.start.y);
  assert.equal(w.remaining, budget);
});

test('expired protection loses exactly one life per main drain and never for an auxiliary drain', () => {
  const w = fresh(); w.shotActive = true; w.rules.onLaunch(); w.rules.onTick(8.001);
  assert.equal(w.pinballState.saveRemaining, 0);
  const before = w.remaining; assert.equal(drainFixture(w), true); assert.equal(w.remaining, before - 1);
  assert.equal(drainFixture(w), false); assert.equal(w.remaining, before - 1); tick(w);
  w.shoot(w.maxPull, 0);
  const child = w.makeBody(0, 0, w.unit * .7, 1);
  Object.assign(child, {isPlayer: true, isAuxiliary: true, hp: Infinity, active: true}); w.auxiliaries.push(child);
  const lives = w.remaining; assert.equal(drainFixture(w, child), true);
  assert.equal(child.active, false); assert.equal(w.remaining, lives); assert.equal(drainFixture(w, child), false);
  assert.equal(w.player.captured, false);
});

test('five cumulative bumper contacts prepare exactly one next-launch auxiliary and a single four-hit run per shot', () => {
  const w = fresh(); w.shoot(0, w.maxPull); const bumper = shape(w, 'bumper');
  for (let i = 0; i < 12; i++) hit(w, bumper);
  assert.equal(w.pinballState.multiballReady, true); assert.equal(w.pinballState.charge, 5);
  assert.equal(w.events.filter(e => e.type === 'campaignBumperHit').length, 12);
  assert.equal(w.events.filter(e => e.type === 'campaignBumperRun').length, 1);
  assert.equal(w.auxiliaries.length, 0, 'the reward belongs to the following launch');
  w.endLaunch(); w.shoot(0, w.maxPull);
  assert.equal(w.auxiliaries.length, 1); assert.equal(w.pinballState.multiballReady, false);
  const child = w.auxiliaries[0]; assert.ok(child.isPlayer && child.isAuxiliary && child.pinballAuxiliary);
  assert.equal(child.r, .7 * w.unit); assert.equal(child.hp, Infinity);
  assert.ok(Math.abs(Math.hypot(child.vx, child.vy) - Math.hypot(w.player.vx, w.player.vy)) < 1e-8);
  const delta = Math.atan2(child.vy, child.vx) - Math.atan2(w.player.vy, w.player.vx);
  assert.ok(Math.abs(delta - Math.PI / 12) < 1e-8);
  w.endLaunch(); assert.equal(w.auxiliaries.length, 0); w.shoot(0, w.maxPull); assert.equal(w.auxiliaries.length, 0);
});

test('clearing a target group creates one HP3 jackpot; the three-second respawn cannot swallow a live jackpot', () => {
  const w = fresh(); w.shoot(0, w.maxPull); const before = targets(w).map(t => ({x: t.x, y: t.y}));
  clearGroup(w); const j = shape(w, 'jackpot');
  assert.equal(j.active, true); assert.equal(j.hp, 3); assert.equal(w.pinballState.targetsRemaining, 0);
  assert.equal(w.score, w.config.targetCount * 10);
  w.endLaunch(); seconds(w, 4);
  assert.equal(j.hp, 3); assert.equal(j.active, true); assert.ok(targets(w).every(t => t.dead));
  assert.equal(w.pinballState.respawnRemaining, 0);
  w.shoot(0, w.maxPull); hit(w, j); assert.equal(j.hp, 2); hit(w, j); assert.equal(j.hp, 1);
  assert.equal(w.pinballJackpots, 0); hit(w, j); assert.equal(w.pinballJackpots, 1);
  assert.equal(w.score, 300 + w.config.targetCount * 10);
  assert.equal(j.active, false); assert.equal(w.pinballState.group, 1);
  assert.ok(targets(w).every(t => !t.dead && t.hp === 1));
  assert.ok(targets(w).every((t, index) => t.x !== before[index].x || t.y !== before[index].y));
  assert.equal(w.events.filter(e => e.type === 'campaignJackpot').length, 1);
  hit(w, j); assert.equal(w.pinballJackpots, 1); assert.equal(w.pinballCrown.duration, .8);
});

test('all ten goals and remaining-life rating boundaries win exactly once, including the zero-life final jackpot', () => {
  for (let k = 0; k < 10; k++) for (const remaining of [0, 1, 2]) {
    const w = fresh(k); w.shotActive = true; w.rules.onLaunch();
    for (let group = 0; group < w.config.jackpotGoal; group++) {
      clearGroup(w); w.rules.onTick(3.01);
      if (group === w.config.jackpotGoal - 1) w.remaining = remaining;
      clearJackpot(w);
    }
    w.checkOutcome(); assert.equal(w.completed, true); assert.equal(w.phase, 'campaign-celebrate');
    assert.equal(w.resultRating, remaining >= 2 ? 3 : remaining >= 1 ? 2 : 1);
    assert.equal(w.pinballJackpots, w.config.jackpotGoal); assert.equal(w.percent, 100);
    assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
    seconds(w, 2); assert.equal(w.phase, 'over'); assert.equal(w.events.filter(e => e.type === 'over').length, 1);
  }
});

test('normal and piercing high-speed trajectories cannot pass through bumpers, and one continuous contact cannot clear jackpot HP3', () => {
  for (const upgrade of ['rubber', 'pierce']) {
    const w = fresh(9, 390, 844, upgrade), bumper = shape(w, 'bumper');
    Object.assign(w.player, {x: bumper.x, y: bumper.y - bumper.r - w.player.r - 3 * w.unit, vx: 0, vy: 0});
    w.shoot(0, -w.maxPull); w.step(.09);
    assert.ok(w.player.vy < 0); assert.equal(bumper.hp, Infinity);
    assert.equal(w.events.filter(e => e.type === 'campaignBumperHit').length, 1);
    assert.ok(w.player.y < bumper.y);
    const j = shape(w, 'jackpot'); clearGroup(w);
    Object.assign(w.player, {x: j.x, y: j.y + j.r + w.player.r + .1, vx: 0, vy: -w.unit});
    w.contacts.clear(); w.step(.02); const hp = j.hp;
    assert.equal(hp, 2); w.step(.04); assert.equal(j.hp, hp);
  }
});

test('pause and rotation preserve lives, active protection, group timing, charged multiball and an active auxiliary', () => {
  const w = fresh(9); w.shoot(0, w.maxPull);
  for (let i = 0; i < 5; i++) hit(w, shape(w, 'bumper'));
  w.endLaunch(); w.shoot(0, w.maxPull); clearGroup(w); seconds(w, .2);
  const state = structuredClone(w.pinballState), lives = w.remaining, shot = w.shotsUsed, auxiliary = w.auxiliaries[0];
  w.step(0); w.step(-1); assert.deepEqual(w.pinballState, state);
  w.resize(844, 390); assert.deepEqual(w.pinballState, state);
  assert.equal(w.remaining, lives); assert.equal(w.shotsUsed, shot); assert.equal(w.auxiliaries.length, 1);
  assert.equal(w.auxiliaries[0].id, auxiliary.id); assert.equal(w.auxiliaries[0].r, .7 * w.unit);
  assert.equal(w.shotActive, true); assert.equal(w.zones[0].visualY, w.arenaBounds.bottom);
  assert.equal(shape(w, 'jackpot').hp, 3);
});

test('sixteen real teaching launches hit targets with each legitimate upgrade in four phone orientations', () => {
  for (const [width, height] of [[390, 844], [844, 390], [320, 568], [568, 320]]) for (const upgrade of ['rubber', 'energy', 'bank', 'pierce']) {
    const w = fresh(0, width, height, upgrade).setFeedbackOptions({strength: .6});
    const target = w.teachingTarget, angle = Math.atan2(target.y - w.player.y, target.x - w.player.x);
    assert.equal(w.tutorialVisible, true); shoot(w, angle, 1);
    assert.ok(w.score >= 10, `${width}×${height} ${upgrade} teaching line really hits a target`);
    assert.equal(w.remaining, w.config.budget); assert.equal(w.tutorialVisible, false);
  }
});

test('twenty real repeated drain trajectories exhaust lives after the eight active-second protection, with no phantom launches or points', () => {
  for (const [width, height] of [[390, 844], [844, 390]]) for (let k = 0; k < 10; k++) {
    const w = fresh(k, width, height).setFeedbackOptions({strength: .6});
    while (w.phase === 'battle' && w.shotsUsed < 70) {
      const d = w.zones[0], angle = Math.atan2(d.y - d.height / 2 + .01 * w.unit - w.player.y, d.x - w.player.x);
      shoot(w, angle, .5);
    }
    assert.equal(w.phase, 'over'); assert.equal(w.completed, false); assert.equal(w.remaining, 0);
    assert.equal(w.score, 0); assert.equal(w.pinballJackpots, 0); assert.equal(w.resultRating, 0);
    const saves = w.events.filter(e => e.type === 'campaignBallSave'), drains = w.events.filter(e => e.type === 'campaignDrain');
    assert.ok(saves.length > 0); assert.equal(drains.length, w.config.budget);
    assert.equal(w.shotsUsed, saves.length + drains.length);
    assert.equal(w.events.filter(e => e.type === 'over').length, 1);
  }
});

// These are public input replays, found by finite angle/power search. No test
// moves a ball, damages a target, skips an active shot or replenishes lives.
// Their precision proves routes exist, not human success rates or balance.
const routes = {
  portrait: {
    0: [[-1.6443635, 1], [1.5707963, .68], [1.6929935, .68], [1.9676261, 1], [.7853982, 1], [1.7996299, 1]],
    3: [[-1.7366829, 1], [1.6687178, .68], [-1.667562, 1], [1.9375457, .68], [1.1383789, 1], [-.6432432, 1], [-.403695, .68]],
    6: [[-2.142738, 1], [1.2136802, .68], [1.4926532, 1], [2.7488936, 1], [-1.2925126, 1], [.4551995, 1], [-1.4916182, 1], [-2.0835518, 1]],
    9: [[-2.192683, 1], [2.7341757, .68], [3.1104259, .68], [2.1343713, .68], [1.840258, .68], [5.1050881, 1], [.4772364, 1], [2.6931787, .68], [-2.0461016, .68], [.7184503, .42]],
  },
  landscape: {
    0: [[-3.3757433, .68], [.0325309, 1], [.2531823, 1], [.6168234, .42]],
    3: [[-2.7046923, 1], [.4635481, 1], [.710065, .68], [2.7281235, 1], [-1.0711163, .42], [3.9269908, 1], [2.3561945, 1]],
    6: [[-2.7230051, .68], [-.4499205, 1], [3.1640443, 1], [-1.0894771, .42], [.0015303, .68], [.5115369, .68], [1.5707963, .42]],
    9: [[-2.6742469, .68], [.618605, 1], [-.2516029, .68], [4.712389, 1], [5.1050881, 1], [.910603, .68], [-.684557, .42], [3.5342917, 1], [-1.0393287, .42], [1.075207, 1]],
  },
};
function waitForTargets(w) {
  if (w.phase === 'battle' && !w.statics.some(s => s.active !== false && !s.dead && ['jackpot', 'pinball-target'].includes(s.kind)))
    seconds(w, 365 / 120);
}
test('twenty real winning replays cover all ten tiers and both phone orientations with a legal upgrade and default feedback', () => {
  for (const [orientation, width, height] of [['portrait', 390, 844], ['landscape', 844, 390]]) for (let k = 0; k < 10; k++) {
    const w = fresh(k, width, height, 'pierce').setFeedbackOptions({strength: .6});
    const category = k < 3 ? 0 : k < 6 ? 3 : k === 6 ? 6 : 9;
    for (const [angle, power] of routes[orientation][category]) {
      if (w.phase !== 'battle') break;
      shoot(w, angle, power); waitForTargets(w);
    }
    assert.equal(w.completed, true, `${orientation} k${k}`);
    assert.equal(w.pinballJackpots, w.config.jackpotGoal);
    assert.equal(w.remaining, w.config.budget, 'these routes do not spend a protected or unprotected life');
    assert.equal(w.resultRating, 3); assert.equal(w.percent, 100); assert.ok(w.shotsUsed <= 10);
    assert.ok(w.elapsed < 45, 'flight/idle simulation excludes human aiming time');
    assert.equal(w.score, w.config.jackpotGoal * (300 + w.config.targetCount * 10));
    assert.equal(w.events.filter(e => e.type === 'campaignJackpot').length, w.config.jackpotGoal);
    assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
    assert.ok(w.events.some(e => e.type === 'playerSplit'), 'real bumper contacts earn a subsequent double-ball launch');
    seconds(w, 2); assert.equal(w.phase, 'over'); assert.equal(w.events.filter(e => e.type === 'over').length, 1);
  }
});

test('all four legitimate upgrades have real complete teaching-tier routes in both orientations', () => {
  for (const [width, height] of [[390, 844], [844, 390]]) for (const upgrade of ['rubber', 'energy', 'bank', 'pierce']) {
    const w = fresh(0, width, height, upgrade).setFeedbackOptions({strength: .6});
    for (let attempt = 0; attempt < 45 && w.phase === 'battle'; attempt++) {
      waitForTargets(w);
      const live = w.statics.filter(s => s.active !== false && !s.dead && ['jackpot', 'pinball-target'].includes(s.kind));
      live.sort((a, b) => Math.hypot(a.x - w.player.x, a.y - w.player.y) - Math.hypot(b.x - w.player.x, b.y - w.player.y));
      const target = live[0]; assert.ok(target);
      const angle = Math.atan2(target.y - w.player.y, target.x - w.player.x);
      const distance = Math.hypot(target.x - w.player.x, target.y - w.player.y) / w.unit;
      const power = Math.min(1, (.6 * distance + 9) / 40 * Math.sqrt(w.density / w.energy));
      shoot(w, angle, power);
    }
    assert.equal(w.completed, true, `${width}×${height} ${upgrade}`);
    assert.equal(w.pinballJackpots, 3); assert.equal(w.remaining, 5);
  }
});
