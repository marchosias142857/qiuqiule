import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, campaignUpgradeChoices, levelConfig} from '../dist/campaign.js';
import {MERGE_RADII, MERGE_LEVELS, mergeParams, mergeBounds, mergeCoverage, mergeLevelFor} from '../dist/classes/merge.js';

const fresh = (k = 0, width = 390, height = 844, upgradeId = 'density') => {
  const w = new CampaignWorld(width, height, k * 10 + 5, () => .51, {upgradeId});
  w.setFeedbackOptions({strength: .6, reducedMotion: false}); return w;
};
const tick = w => { const scale = w.presentationTimeScale; w.step(scale / 120, false, {timeScale: scale}); };
const finish = w => { for (let i = 0; i < 400 && w.phase !== 'over'; i++) tick(w); };
const alive = w => w.enemies.filter(b => b.active !== false && b.hp > 0);
// Geometry fixtures exercise individual collision boundaries. Complete routes
// later only use public shoot/step and never create/relocate bodies or goals.
const ball = (w, level, x, y, extra = {}) => {
  const r = MERGE_RADII[level - 1] * w.unit, mass = .55 ** 2 * 2 ** (level - 1);
  const body = w.makeBody(x, y, r, mass / MERGE_RADII[level - 1] ** 2);
  Object.assign(body, {kind: 'merge-ball', mergeLevel: level, hp: Infinity, maxHp: Infinity,
    active: true, solid: true, born: 1, drag: 1.2, mass, mergeAt: -Infinity, mergeChain: 0, ...extra});
  w.enemies.push(body); return body;
};
const centre = w => ({x: (w.arenaBounds.left + w.arenaBounds.right) / 2, y: (w.arenaBounds.top + w.arenaBounds.bottom) / 2});

test('ten merge tiers retain approved radii, intervals, goals and pressure budget with authored size orders', () => {
  assert.deepEqual(MERGE_RADII, [.55, .75, 1, 1.3, 1.65]);
  for (let k = 0; k < 10; k++) {
    const p = mergeParams(k), c = levelConfig(k * 10 + 5);
    assert.equal(c.type, 'merge'); assert.equal(c.implemented, true); assert.equal(c.k, k);
    assert.equal(p.spawnInterval, 2.2 - .11 * k); assert.equal(p.goal, 2 + Math.floor(k / 3)); assert.equal(p.targetMax, p.goal);
    assert.equal(p.budget, 42); assert.equal(p.budgetKind, 'pressure'); assert.equal(p.coverageLimit, .42);
    assert.equal(p.centreGravity, .6); assert.equal(p.mergeSpeed, 1); assert.equal(p.momentumRetention, .5);
    assert.deepEqual(p.incomingLevels, MERGE_LEVELS[k * 2].sequence);
    const choices = campaignUpgradeChoices(k * 10 + 5, () => .51);
    assert.equal(choices.length, 2); assert.notEqual(choices[0].id, choices[1].id);
    assert.ok(choices.every(c => ['gravity', 'density', 'growth', 'pulse'].includes(c.id)));
  }
});

test('authored openings fit the actual square, feeds repeat, and both orientations share the same physical area', () => {
  for (const [width, height] of [[320, 568], [390, 844], [568, 320], [844, 390], [1440, 900]]) for (let k = 0; k < 10; k++) {
    const w = fresh(k, width, height), b = mergeBounds(w);
    assert.equal(b.width, b.height); assert.equal(w.enemies.length, MERGE_LEVELS[k * 2].balls.length); assert.equal(w.player.r, w.unit * .72);
    assert.deepEqual(w.enemies.map(e => e.mergeLevel), MERGE_LEVELS[k * 2].balls.map(b => b[2]));
    for (const body of [w.player, ...w.enemies]) {
      assert.ok(body.x - body.r >= b.left - 1e-9 && body.x + body.r <= b.right + 1e-9);
      assert.ok(body.y - body.r >= b.top - 1e-9 && body.y + body.r <= b.bottom + 1e-9);
      if (body !== w.player) { assert.equal(body.hp, Infinity); assert.equal(body.r, MERGE_RADII[body.mergeLevel - 1] * w.unit); }
      for (const other of w.enemies) if (body !== other) assert.ok(Math.hypot(body.x - other.x, body.y - other.y) > body.r + other.r);
    }
    const coverage = w.mergeCoverage; w.resize(height, width); assert.ok(Math.abs(w.mergeCoverage - coverage) < 1e-12);
    assert.deepEqual(Array.from({length: 20}, (_, i) => mergeLevelFor(k, i)), Array.from({length: 20}, (_, i) => mergeLevelFor(k, i)));
  }
  assert.equal(fresh(0, 320, 568).arenaBounds.width, 218); assert.equal(fresh(0, 568, 320).arenaBounds.width, 218);
});

test('same-level collision requires strictly greater than 1u/s and preserves pre-contact centre/momentum then halves velocity', () => {
  const w = fresh(), c = centre(w); w.enemies = []; w.statics = [];
  let a = ball(w, 1, c.x - w.unit * .54, c.y, {vx: w.unit, vy: 0});
  let b = ball(w, 1, c.x + w.unit * .54, c.y, {vx: 0, vy: 0});
  w.collideCampaign(a, b); assert.equal(w.mergeCount, 0);
  w.enemies = []; w.statics = []; a = ball(w, 2, c.x - w.unit * .74, c.y, {vx: w.unit * 6, vy: w.unit * 2});
  b = ball(w, 2, c.x + w.unit * .74, c.y, {vx: -w.unit * 2, vy: 0});
  const mass = a.mass + b.mass, x = (a.x * a.mass + b.x * b.mass) / mass;
  const vx = (a.vx * a.mass + b.vx * b.mass) / mass * .5, vy = (a.vy * a.mass + b.vy * b.mass) / mass * .5;
  w.collideCampaign(a, b);
  const child = alive(w)[0]; assert.equal(child.mergeLevel, 3); assert.equal(child.mass, mass);
  assert.ok(Math.abs(child.x - x) < 1e-9); assert.ok(Math.abs(child.vx - vx) < 1e-9); assert.ok(Math.abs(child.vy - vy) < 1e-9);
  assert.equal(w.mergeCaptures.length, 2); assert.equal(w.mergeCount, 1); assert.equal(w.score, 30);
  w.collideCampaign(a, b); assert.equal(w.mergeCount, 1);
  assert.equal(w.events.filter(e => e.type === 'kill').length, 0, 'only inward merge feedback is emitted');
});

test('idle physical contacts also merge, while different levels only exchange momentum', () => {
  const w = fresh(), c = centre(w); w.enemies = []; w.statics = [];
  ball(w, 1, c.x - w.unit * .56, c.y, {vx: w.unit * 2});
  ball(w, 1, c.x + w.unit * .56, c.y, {vx: -w.unit * 2});
  assert.equal(w.shotActive, false); for (let i = 0; i < 10 && !w.mergeCount; i++) tick(w);
  assert.equal(w.mergeCount, 1); assert.equal(alive(w).length, 1);
  w.enemies = []; w.statics = []; const a = ball(w, 1, c.x - w.unit * .6, c.y, {vx: w.unit * 5});
  const b = ball(w, 2, c.x + w.unit * .6, c.y); w.collideCampaign(a, b);
  assert.equal(w.mergeCount, 1); assert.equal(alive(w).length, 2); assert.ok(b.vx > 0);
});

test('two maximum balls clear on zero-speed tangency for 500 points, without adding a produced-L5 goal', () => {
  const w = fresh(9), c = centre(w); w.enemies = []; w.statics = [];
  const a = ball(w, 5, c.x - w.unit * 1.65, c.y), b = ball(w, 5, c.x + w.unit * 1.65, c.y);
  w.collideCampaign(a, b);
  assert.equal(alive(w).length, 0); assert.equal(w.mergeClears, 1); assert.equal(w.mergeMade, 0); assert.equal(w.score, 500);
  assert.equal(w.events.filter(e => e.type === 'campaignMergeClear').length, 1);
  assert.equal(w.events.filter(e => e.type === 'campaignSlow' && e.kind === 'merge-clear').length, 1);
  w.collideCampaign(a, b); assert.equal(w.score, 500);
});

test('chain ancestry continues only within .75 world seconds and its third merge gives one peak', () => {
  const w = fresh(9), c = centre(w); w.enemies = []; w.statics = [];
  let child = ball(w, 1, c.x, c.y);
  for (let level = 1; level <= 3; level++) {
    const other = ball(w, level, c.x + child.r + MERGE_RADII[level - 1] * w.unit - .1, c.y);
    Object.assign(child, {x: c.x, y: c.y, vx: w.unit * 3, vy: 0});
    w.collideCampaign(child, other); child = alive(w).find(b => b !== child && b.mergeLevel === level + 1);
    assert.equal(child.mergeChain, level);
  }
  assert.equal(w.events.filter(e => e.type === 'campaignMergeChain').length, 1); assert.equal(w.mergeMaxChain, 3);
  w.time += .76;
  const other = ball(w, 4, child.x + child.r + w.unit * 1.3 - .1, child.y);
  child.vx = w.unit * 3; w.collideCampaign(child, other);
  assert.equal(alive(w).find(b => b.mergeLevel === 5).mergeChain, 1);
  assert.equal(w.mergeMade, 1);
});

test('pressure is actual enemy area only, firing does not consume it, and 60/90 seconds are rating thresholds only', () => {
  const w = fresh(), expected = w.enemies.reduce((s, b) => s + Math.PI * b.r ** 2, 0) / (w.arenaBounds.width * w.arenaBounds.height);
  assert.ok(Math.abs(mergeCoverage(w) - expected) < 1e-14); const left = w.remaining;
  assert.equal(w.shoot(6, 0), true); assert.equal(w.remaining, left);
  for (const [elapsed, rating] of [[60, 3], [60.001, 2], [90, 2], [90.001, 1], [10000, 1]]) {
    w.mergeElapsed = elapsed; assert.equal(w.rules.rating(), rating); assert.equal(w.rules.isLost(), false);
  }
  const area = w.arenaBounds.width * w.arenaBounds.height;
  w.enemies = []; w.statics = []; ball(w, 1, centre(w).x, centre(w).y, {r: Math.sqrt(area * .42 / Math.PI)});
  assert.equal(w.rules.isLost(), true);
});

test('final real L4 contact wins in the same active step as over-42-percent coverage', () => {
  const w = fresh(), u = w.unit, bounds = w.arenaBounds;
  w.enemies = []; w.statics = []; w.mergeMade = w.config.targetMax - 1;
  Object.assign(w.player, {x: bounds.left + u, y: bounds.top + u * 4.8});
  w.shoot(6, 0);
  ball(w, 4, bounds.left + u * 5.7, bounds.top + u * 3, {vx: u * 2});
  ball(w, 4, bounds.left + u * 8.31, bounds.top + u * 3, {vx: -u * 2});
  for (let row = 0; row < 5; row++) for (let col = 0; col < 9; col++)
    ball(w, 2, bounds.left + u * (.85 + col * 1.52), bounds.top + u * (7.1 + row * 1.52));
  assert.ok(mergeCoverage(w) > .42); tick(w); finish(w);
  assert.equal(w.completed, true); assert.equal(w.mergeMade, w.config.targetMax);
  assert.equal(w.events.filter(e => e.type === 'over').length, 1); assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
});

test('all four offered upgrades affect real mass/radius/forces with no direct pulse damage or target credit', () => {
  const base = fresh(0, 390, 844, 'pulse'), dense = fresh(), grown = fresh(0, 390, 844, 'growth');
  assert.ok(Math.abs(dense.player.mass / base.player.mass - 1.35) < 1e-10);
  assert.ok(Math.abs(grown.player.r / base.player.r - 1.2) < 1e-10); assert.equal(grown.player.mass, base.player.mass);
  const gravity = fresh(0, 390, 844, 'gravity'); const before = gravity.enemies.map(b => ({vx: b.vx, vy: b.vy}));
  gravity.rules.onTick(.01); base.rules.onTick(.01);
  assert.ok(gravity.enemies.some((b, i) => Math.hypot(b.vx - base.enemies[i].vx, b.vy - base.enemies[i].vy) > .1));
  assert.ok(before.every(b => b.vx === 0 && b.vy === 0));
  base.enemies = []; const c = centre(base), a = ball(base, 1, c.x, c.y), b = ball(base, 2, c.x + base.unit * 2, c.y);
  base.shoot(6, 0); base.rules.onDynamicHit(base.player, a, {normalSpeed: base.unit * 10});
  assert.ok(Math.abs(b.vx - base.unit * 4) < 1e-9); assert.equal(b.hp, Infinity); assert.equal(base.mergeMade, 0);
  base.rules.onDynamicHit(base.player, a, {normalSpeed: base.unit * 20}); assert.equal(base.events.filter(e => e.type === 'pulse').length, 1);
});

test('blocked edge keeps one pending deterministic spawn instead of accumulating a release burst', () => {
  const w = fresh(), first = mergeLevelFor(0, 0), interval = w.config.spawnInterval;
  w.enemies = []; w.statics = []; const c = centre(w), blocker = ball(w, 1, c.x, c.y, {r: w.arenaBounds.width});
  w.rules.onTick(interval * 5); assert.equal(w.mergeSpawnIndex, 0); assert.equal(w.mergeSpawnClock, interval);
  blocker.active = false; blocker.hp = 0;
  w.rules.onTick(.001); assert.equal(w.mergeSpawnIndex, 1); assert.equal(alive(w)[0].mergeLevel, first);
  assert.ok(w.mergeSpawnClock < .01);
});

test('pause-sized zero steps keep all clocks; resize preserves capture age and cannot itself merge or settle', () => {
  const w = fresh(), c = centre(w); w.enemies = []; w.statics = [];
  const a = ball(w, 1, c.x - w.unit * .54, c.y, {vx: w.unit * 3}), b = ball(w, 1, c.x + w.unit * .54, c.y);
  w.collideCampaign(a, b); const at = w.mergeCaptures[0].at, coverage = mergeCoverage(w), score = w.score;
  const clocks = [w.time, w.feedbackTime, w.mergeElapsed, w.mergeSpawnClock]; w.step(0);
  assert.deepEqual([w.time, w.feedbackTime, w.mergeElapsed, w.mergeSpawnClock], clocks);
  w.resize(844, 390); assert.equal(w.mergeCaptures[0].at, at); assert.equal(w.score, score);
  assert.ok(Math.abs(mergeCoverage(w) - coverage) < 1e-12); assert.equal(w.phase, 'battle');
  w.resize(320, 568); assert.equal(w.score, score); assert.equal(w.phase, 'battle');
  assert.ok(mergeCoverage(w) > coverage, 'cross-device shrinking uses its actual smaller physical area');
});

test('resize-created maximum-ball contact cannot clear until a real separation and later touch', () => {
  const w = fresh(9), c = centre(w); w.enemies = []; w.statics = [];
  const a = ball(w, 5, c.x - w.unit * 1.7, c.y), b = ball(w, 5, c.x + w.unit * 1.7, c.y);
  w.resize(320, 568); tick(w);
  assert.equal(w.mergeClears, 0); assert.equal(w.score, 0);
  const next = centre(w); a.x = next.x - w.unit * 3; b.x = next.x + w.unit * 3;
  w.collideCampaign(a, b);
  a.x = next.x - a.r; b.x = next.x + b.r; a.y = b.y = next.y; a.vx = a.vy = b.vx = b.vy = 0;
  w.collideCampaign(a, b); assert.equal(w.mergeClears, 1); assert.equal(w.score, 500);
});

test('a below-pressure-limit dense L1 fixture keeps over 28 finite bodies through two real 120Hz seconds', () => {
  const w = fresh(), b = w.arenaBounds; w.enemies = []; w.statics = [];
  const count = Math.floor(b.width * b.height * .4 / (Math.PI * (w.unit * .55) ** 2));
  for (let i = 0; i < count; i++) ball(w, 1, b.left + w.unit * (.9 + i % 10 * 1.2), b.top + w.unit * (.9 + Math.floor(i / 10) * 1.2));
  assert.ok(count > 28); assert.ok(mergeCoverage(w) < .42);
  for (let i = 0; i < 240; i++) tick(w);
  assert.equal(w.phase, 'battle'); assert.equal(alive(w).length, count);
  assert.ok(alive(w).every(body => [body.x, body.y, body.vx, body.vy, body.r, body.mass].every(Number.isFinite)));
});

test('all ten tiers genuinely lose by weak public launches filling the arena, with no shot or time deadline', () => {
  for (let k = 0; k < 10; k++) {
    const w = fresh(k); let peak = 8;
    while (w.phase !== 'over' && w.mergeElapsed < 240) {
      if (w.ready) assert.equal(w.shoot(6, 0), true);
      tick(w); peak = Math.max(peak, alive(w).length);
    }
    assert.equal(w.phase, 'over', `tier ${k}`); assert.equal(w.completed, false);
    assert.ok(w.mergeCoverage >= .42); assert.ok(w.shotsUsed > 10, 'weak real launches continue until actual area fills');
    assert.ok(peak > w.config.initialBalls, 'incoming balls continue to fill space');
    assert.equal(w.events.filter(e => e.type === 'over').length, 1); assert.equal(w.resultRating, 0);
  }
});

// Public-input replay for every offered upgrade at the opening and final tier.
// All twenty layouts and four orientations are covered by v770-merge.test.mjs.
const MERGE_ROUTES = [0,9].flatMap(k => ['density','growth','gravity','pulse'].map(upgrade => ({k,upgrade,width:390,height:844})));

test('opening and final tiers win via real normal-feedback launches with every teaching upgrade', () => {
  for (const route of MERGE_ROUTES) {
    const w = fresh(route.k, route.width, route.height, route.upgrade);
    for (let frame = 0; frame < 50000 && w.phase !== 'over'; frame++) {
      if (w.ready) {
        const target = alive(w).sort((a, b) => b.mergeLevel - a.mergeLevel ||
          Math.hypot(a.x - w.player.x, a.y - w.player.y) - Math.hypot(b.x - w.player.x, b.y - w.player.y))[0];
        const angle = Math.atan2(target.y - w.player.y, target.x - w.player.x);
        assert.equal(w.shoot(-Math.cos(angle) * w.maxPull, -Math.sin(angle) * w.maxPull), true);
        assert.ok(w.player.feedbackFreeze > 0, 'the normal launch feedback hold remains active');
      }
      tick(w);
    }
    assert.equal(w.completed, true, `tier ${route.k}, ${route.width}×${route.height}, ${route.upgrade}`);
    assert.equal(w.phase, 'over'); assert.ok(w.mergeMade >= w.config.targetMax);
    assert.equal(w.events.filter(e => e.type === 'over').length, 1);
    assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
    const merges = w.events.filter(e => e.type === 'campaignMerge');
    const clears = w.events.filter(e => e.type === 'campaignMergeClear');
    assert.equal(merges.filter(e => e.level === 5).length, w.mergeMade);
    assert.equal(clears.length, w.mergeClears);
    assert.equal(w.score, merges.reduce((sum, e) => sum + e.value, 0) + clears.length * 500);
    assert.equal(w.resultRating, w.mergeElapsed <= w.config.threePointTime + 1e-9 ? 3 : w.mergeElapsed <= w.config.twoPointTime + 1e-9 ? 2 : 1);
    assert.equal(w.events.filter(e => e.type === 'kill').length, 0, 'ordinary deaths cannot fake a merge objective');
    assert.ok(alive(w).every(b => [b.x, b.y, b.vx, b.vy, b.r, b.mass].every(Number.isFinite)));
  }
});
