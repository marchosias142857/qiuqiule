import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../dist/physics.js';
import {CampaignWorld, LegacyCampaignWorld, levelConfig, campaignUpgradeChoices, campaignUpgradePool} from '../dist/campaign.js';
import {staticContact, resolveStatic, resolveDynamic, zoneContains, sweptZoneEntry} from '../dist/campaign-collision.js';

const near = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) < e, `${a} differs from ${b}`);
const tick = (w, seconds, scale = 1) => { for (let t = 0; t < seconds - 1e-9; t += 1 / 120) w.step(Math.min(1 / 120, seconds - t) * scale, false, {timeScale: scale}); };
const fresh = (level = 1, options = {}) => new CampaignWorld(390, 844, level, () => .5, options);
const noObstacles = w => { w.statics.forEach(s => s.active = false); w.enemies = []; w.rules.isWon = () => false; w.rules.isLost = () => false; };

test('all100 slots use five paired modes and twenty ordered ranks', () => {
  for (let n = 1; n <= 100; n++) {
    const c = levelConfig(n), w = fresh(n);
    const modes = ['wall', 'pool', 'merge', 'golf', 'peggle'];
    const oldIds = [1, 4, 5, 8, 0], group = Math.floor(((n - 1) % 10) / 2);
    assert.equal(c.r, oldIds[group]); assert.equal(c.digit, n % 10);
    assert.equal(c.type, modes[group]); assert.equal(c.k, Math.floor((n - 1) / 10));
    assert.equal(c.rank20, c.k * 2 + (n - 1) % 2); assert.equal(c.variant, (n - 1) % 2);
    assert.equal(c.implemented, true);
    assert.equal(c.type, c.classId); assert.equal(w.legacy, !c.implemented);
    assert.equal(w instanceof LegacyCampaignWorld, !c.implemented);
    if (c.implemented) assert.ok(w.statics.length + w.zones.length + w.enemies.length > 0);
  }
});

test('two offers are unique filtered choices; one per-level choice resets on a new attempt', () => {
  for (const seed of [0, .1, .5, .99]) for (const level of [1, 10, 91, 100]) {
    const choices = campaignUpgradeChoices(level, () => seed);
    assert.equal(choices.length, 2); assert.notEqual(choices[0].id, choices[1].id);
    assert.ok(choices.every(c => campaignUpgradePool(level).some(item => item.id === c.id)));
    if (levelConfig(level).type === 'wall') assert.equal(choices.some(c => c.id === 'pierce'), false);
  }
  assert.equal(campaignUpgradeChoices(5).length, 2);
  const w = fresh(1, {upgradeId: 'energy'}); assert.equal(w.energy, 1.3);
  assert.equal(w.applyCampaignUpgrade('pierce'), false); assert.equal(fresh().energy, 1);
  assert.equal(fresh(1, {upgradeId: 'growth'}).upgradeId, null);
});

test('tutorial appears before first success on every rank first shot and is suppressed by successful history', () => {
  const w = fresh(); assert.equal(w.tutorialVisible, true); assert.ok(Number.isFinite(w.teachingTarget.x));
  assert.equal(fresh(11).tutorialVisible, true); assert.equal(fresh(1, {showTutorial: false}).tutorialVisible, false);
  w.shoot(0, 80); assert.equal(w.tutorialVisible, false);
});

test('rounded rectangle corner geometry and static circle conserve tangential motion', () => {
  const rectangle = {shape: 'rect', x: 100, y: 100, width: 80, height: 40, cornerRadius: 10};
  assert.equal(staticContact({x: 150, y: 130, r: 5}, rectangle), null);
  const ball = {x: 150, y: 100, r: 12, vx: -100, vy: 25};
  const contact = resolveStatic(ball, rectangle, {restitution: .95});
  near(ball.vx, 95); near(ball.vy, 25); near(contact.impactVx, -100);
  near(contact.nx, -1); near(contact.contactX, 140); assert.ok(ball.x >= 152);
  const circleBall = {x: 128, y: 100, r: 10, vx: -100, vy: 15};
  resolveStatic(circleBall, {shape: 'circle', x: 100, y: 100, r: 20}, {restitution: .95});
  near(circleBall.vx, 95); near(circleBall.vy, 15); assert.ok(circleBall.x >= 130);
});

test('zones are nonblocking and catch fast crossings with entry and speed gates', () => {
  const circle = {shape: 'circle', x: 100, y: 100, r: 4};
  const ball = {x: 200, y: 100, r: 2, vx: 1000, vy: 0};
  assert.equal(zoneContains(ball, circle), false);
  assert.equal(sweptZoneEntry(ball, {x: 0, y: 100}, circle), true);
  assert.equal(sweptZoneEntry(ball, {x: 0, y: 100}, {...circle, maxSpeed: 500}), false);
  const rect = {shape: 'rect', x: 100, y: 100, width: 4, height: 10, centerOnly: true};
  assert.equal(sweptZoneEntry(ball, {x: 0, y: 100}, rect), true);
  assert.equal(sweptZoneEntry({...ball, y: 120}, {x: 0, y: 120}, rect), false);
  const w = fresh(); noObstacles(w); w.zones = [];
  let entries = 0; w.rules.onZone = () => { entries++; };
  w.addZone({shape: 'rect', x: 200, y: 500, width: 2, height: 100, oncePerShot: true});
  Object.assign(w.player, {x: 100, y: 500}); w.shoot(-w.maxPull, 0); tick(w, .4);
  assert.equal(entries, 1); assert.equal(w.shotActive, true); assert.ok(w.player.x > 100);
  Object.assign(w.player, {x: 150, y: 500, vx: 700, vy: 0}); tick(w, .2); assert.equal(entries, 1);
});

test('circle bodies do not trigger square-expanded false corners of rectangular zones', () => {
  const zone = {shape: 'rect', x: 100, y: 100, width: 20, height: 20};
  const nearMiss = {x: 119, y: 119, r: 10, vx: -1, vy: 0};
  assert.equal(zoneContains(nearMiss, zone), false);
  assert.equal(sweptZoneEntry(nearMiss, {x: 122, y: 119}, zone), false);
  assert.equal(zoneContains({...nearMiss, x: 117, y: 117}, zone), true);
  assert.equal(sweptZoneEntry({...nearMiss, x: 100}, {x: 122, y: 119}, zone), true);
});

test('rejected zone contact does not consume a later accepted trigger in the same launch', () => {
  const w = fresh(); noObstacles(w); w.zones = [];
  let accepted = false, fired = 0;
  w.rules.onZone = () => { if (!accepted) return false; fired++; return true; };
  const z = w.addZone({shape: 'rect', x: 200, y: 500, width: 20, height: 80, oncePerShot: true});
  Object.assign(w.player, {x: 150, y: 500}); w.shoot(-w.maxPull, 0); tick(w, .2);
  assert.equal(w.shotZones.has(`${w.player.id}:${z.id}`), false);
  accepted = true; Object.assign(w.player, {x: 130, y: 500, vx: 700, vy: 0}); tick(w, .2);
  assert.equal(fired, 1); assert.equal(w.shotZones.has(`${w.player.id}:${z.id}`), true);
});

test('fast collision cannot tunnel through a thin rounded brick or repeatedly damage one contact', () => {
  const w = fresh(); noObstacles(w); w.statics = [];
  const brick = w.addStatic({shape: 'rect', x: 200, y: 450, width: 2, height: 100, hp: 3, maxHp: 3});
  w.rules.onStaticHit = (s, c) => w.hitStatic(s, 1, c);
  Object.assign(w.player, {x: 100, y: 450}); w.shoot(-w.maxPull, 0);
  w.player.vx = 100000; w.step(.1);
  assert.equal(brick.hp, 2); assert.ok(w.player.vx < 0); assert.ok(w.player.x < brick.x);
  w.player.vx = w.player.vy = 0; tick(w, .1); assert.equal(brick.hp, 2);
});

test('budget only pays successful launches, active shot cannot relaunch, and last shot times out once', () => {
  const w = fresh(); noObstacles(w); w.remaining = 1;
  assert.equal(w.shoot(0, 2), false); assert.equal(w.remaining, 1);
  assert.equal(w.shoot(0, w.maxPull), true); assert.equal(w.remaining, 0); assert.equal(w.shotsUsed, 1);
  assert.equal(w.shoot(0, w.maxPull), false); assert.equal(w.shotsUsed, 1);
  w.player.vx = w.player.vy = 0; tick(w, .39); assert.equal(w.phase, 'battle');
  tick(w, .02); assert.equal(w.phase, 'over'); assert.equal(w.completed, false);
  tick(w, 2); assert.equal(w.events.filter(e => e.type === 'over').length, 1);
});

test('four-second deadline extends fast motion then brakes smoothly; pauses consume no time', () => {
  const w = fresh(); noObstacles(w); w.shoot(-w.maxPull, 0);
  for (let i = 0; i < 479; i++) { w.player.vx = 200; w.step(1 / 120); }
  assert.equal(w.shotActive, true); const time = w.shotTime, remaining = w.remaining;
  w.step(0); w.step(-1); w.step(Infinity); assert.equal(w.shotTime, time); assert.equal(w.remaining, remaining);
  w.player.vx = 200; w.step(1 / 120); assert.equal(w.shotActive, true);
  assert.equal(w.shotFinish.brakeAt, 5); tick(w, 1.2); assert.equal(w.shotActive, true);
  tick(w, .11); assert.equal(w.shotActive, false); assert.equal(w.phase, 'battle');
  assert.equal(w.events.filter(e => e.type === 'campaignLaunchEnd').at(-1).reason, 'timeout');
});

function finalPegWorld(remaining = 0) {
  const w = fresh(10), targets = w.statics.filter(s => s.target);
  w.shoot(0, w.maxPull); w.remaining = remaining;
  for (const s of targets.slice(0, -1)) w.rules.onStaticHit(s, {normalSpeed: 30 * w.unit});
  const last = targets.at(-1);
  // Open a clean physical approach to the final target; the collision itself
  // goes through the production solver and must win before exhausted-budget loss.
  w.statics.filter(s => s !== last).forEach(s => s.active = false);
  Object.assign(w.player, {x: last.x, y: last.y + last.r + w.player.r + 2, vx: 0, vy: -w.unit * 30});
  w.step(1 / 120); return w;
}

test('last-ball real target impact wins and emits exactly one frenzy before one result', () => {
  const w = finalPegWorld(0);
  assert.equal(w.phase, 'campaign-celebrate'); assert.equal(w.completed, true); assert.equal(w.resultRating, 1);
  assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
  assert.equal(w.events.filter(e => e.type === 'over').length, 0);
  tick(w, 1.25); assert.equal(w.phase, 'over'); assert.equal(w.events.filter(e => e.type === 'over').length, 1);
  tick(w, 2); assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
});

test('frenzy preserves rebound movement, real-time duration, original rating and sequential spare-ball score', () => {
  const w = finalPegWorld(3); w.setFeedbackOptions({strength: 1});
  const startY = w.player.y, startScore = w.score;
  assert.equal(w.presentationTimeScale, .25); assert.equal(w.resultRating, 3);
  tick(w, .5, .25); assert.ok(w.player.y !== startY); assert.equal(w.phase, 'campaign-celebrate');
  assert.equal(w.score, startScore); assert.equal(w.remaining, 3);
  tick(w, .7, .25); tick(w, .38);
  assert.equal(w.phase, 'over'); assert.equal(w.score, startScore + 30); assert.equal(w.resultRating, 3);
  assert.equal(w.events.filter(e => e.type === 'campaignBonus').length, 3);
  const reduced = finalPegWorld(0); reduced.setFeedbackOptions({strength: 1, reducedMotion: true});
  assert.equal(reduced.presentationTimeScale, 1);
});

test('bucket catch is a real downward crossing, returns exactly one ball and ends the shot', () => {
  const w = fresh(10); w.shoot(0, -w.maxPull);
  const z = w.zones[0], remaining = w.remaining;
  Object.assign(w.player, {x: z.x, y: z.y - z.height / 2 - 2, vx: 0, vy: w.unit * 20});
  w.step(1 / 120); assert.equal(w.freeBalls, 1); assert.equal(w.remaining, remaining + 1); assert.equal(w.shotActive, false);
  tick(w, .2); assert.equal(w.freeBalls, 1); assert.equal(w.events.filter(e => e.type === 'campaignFreeBall').length, 1);
});

test('rotation preserves budget and damaged geometry; campaign cannot mutate endless rules', () => {
  const w = fresh(91, {upgradeId: 'bank'}), brick = w.statics.find(s => s.hp > 1);
  w.hitStatic(brick, .5, {}); const hp = brick.hp, remaining = w.remaining;
  w.resize(844, 390); assert.equal(brick.hp, hp); assert.equal(w.remaining, remaining);
  for (const b of [w.player, ...w.statics]) for (const key of ['x', 'y', 'r']) assert.ok(Number.isFinite(b[key]));
  const e = new World(390, 844, () => .5); assert.equal(e.enemies.length, 6); assert.equal(e.limit, 28);
  e.beginStartingUpgrades(); assert.equal(e.upgradeRoundTotal, 1); assert.equal(e.statics, undefined);
});

test('pool and golf offers use only density, rubber, bank and the campaign-only steady assist', () => {
  for (const level of [4, 8, 94, 98]) {
    assert.deepEqual(campaignUpgradePool(level).map(c => c.id), ['density', 'rubber', 'bank', 'steady']);
    for (const seed of [0, .25, .5, .75, .999]) {
      const pair = campaignUpgradeChoices(level, () => seed); assert.equal(pair.length, 2);
      assert.notEqual(pair[0].id, pair[1].id); assert.ok(pair.every(c => c.short && c.name));
    }
  }
  assert.equal(fresh(4, {upgradeId: 'pierce'}).upgradeId, null);
  assert.equal(fresh(1, {upgradeId: 'steady'}).upgradeId, null);
});

test('nonlethal equal-mass cut collision transfers only normal momentum without damage or endless retention', () => {
  const a = {x: 0, y: 0, r: 1, mass: 1.5, hp: Infinity, vx: 100, vy: 40};
  const b = {x: 1.9, y: 0, r: 1, mass: 1.5, hp: Infinity, vx: 0, vy: 0};
  resolveDynamic(a, b, {restitution: .95}); near(a.vx, 2.5); near(a.vy, 40); near(b.vx, 97.5); near(b.vy, 0);
  near(a.mass * a.vx + b.mass * b.vx, 150); assert.equal(a.hp, Infinity); assert.equal(b.hp, Infinity);
  const w = fresh(4), target = w.enemies[0]; w.shoot(0, 40);
  Object.assign(w.player, {x: 100, y: 300, vx: 100, vy: 0});
  Object.assign(target, {x: 100 + w.player.r + target.r - .1, y: 300, vx: 0, vy: 0});
  w.collideCampaign(w.player, target); near(w.player.vx, 2.5); near(target.vx, 97.5);
  assert.equal(target.hp, Infinity); assert.equal(w.totalKills, 0); assert.equal(w.score, 0);
});

test('density, rubber and bank each change nonlethal collision mechanics for this attempt only', () => {
  const collide = id => {
    const w = fresh(4, {upgradeId: id}), target = w.enemies[0]; w.shoot(0, 40);
    Object.assign(w.player, {x: 100, y: 300, vx: 100, vy: 0});
    Object.assign(target, {x: 100 + w.player.r + target.r - .1, y: 300, vx: 0, vy: 0});
    if (id === 'bank') w.bank = 2;
    w.collideCampaign(w.player, target); return {w, target};
  };
  const plain = collide(null), dense = collide('density'), rubber = collide('rubber'), bank = collide('bank');
  near(dense.w.player.mass, plain.w.player.mass * 1.35); near(dense.target.mass, plain.target.mass);
  assert.ok(dense.target.vx > plain.target.vx); near(rubber.target.vx, 100); near(rubber.w.player.vx, 0);
  assert.ok(bank.target.vx > plain.target.vx); assert.equal(bank.w.bank, 0);
  near(fresh(4).player.mass, plain.w.player.mass);
});

test('steady adjusts only full-power headings within two degrees and never changes launch energy', () => {
  const shoot = (angle, pull = 1) => {
    const w = fresh(8, {upgradeId: 'steady'});
    w.rules.aimTargets = () => [{x: w.player.x + 100, y: w.player.y}];
    w.shoot(-Math.cos(angle) * w.maxPull * pull, -Math.sin(angle) * w.maxPull * pull); return w;
  };
  const assisted = shoot(.02); near(assisted.lastAimAdjustment, -.02); near(assisted.player.vy, 0);
  near(Math.hypot(assisted.player.vx, assisted.player.vy), assisted.baseSpeed);
  const partial = shoot(.02, .999); near(partial.lastAimAdjustment, 0); assert.ok(partial.player.vy > 0);
  const distant = shoot(.06); near(distant.lastAimAdjustment, 0); assert.ok(distant.player.vy > 0);
  const bounded = shoot(Math.PI / 90); assert.ok(Math.abs(bounded.lastAimAdjustment) <= Math.PI / 90 + 1e-12);
});

test('pool waits for moving target balls after cue stops, freezes between turns and stops all at deadline', () => {
  const w = fresh(4), target = w.enemies[0]; w.enemies = [target]; w.zones = [];
  w.shoot(0, 80); w.player.vx = w.player.vy = 0;
  Object.assign(target, {x: 100, y: 250, vx: w.unit * 6, vy: 0});
  tick(w, .5); assert.equal(w.shotActive, true); assert.ok(target.vx > w.unit * 3);
  tick(w, 3.51); assert.equal(w.shotActive, false); assert.equal(target.vx, 0); assert.equal(target.vy, 0);
  const before = {x: target.x, y: target.y}; tick(w, .8); near(target.x, before.x); near(target.y, before.y);
});

test('scratch pays a penalty without another shot and lets moving targets finish before resetting cue', () => {
  const w = fresh(54), target = w.enemies[0]; w.enemies = [target];
  w.zones = [{id: 900, kind: 'pocket', shape: 'circle', x: 100, y: 250, r: w.unit * 1.35, centerOnly: true}];
  w.shoot(0, 80); const before = w.remaining;
  Object.assign(w.player, {x: 100, y: 250, vx: 0, vy: 0});
  Object.assign(target, {x: 240, y: 450, vx: 0, vy: w.unit * 6});
  w.step(1 / 120); assert.equal(w.player.captured, true); assert.equal(w.remaining, before - 2);
  assert.equal(w.shotsUsed, 1); assert.equal(w.shotActive, true); assert.equal(w.poolScratches, 1);
  tick(w, .5); assert.equal(w.player.captured, true); assert.equal(w.poolScratches, 1);
  tick(w, 3.6); assert.equal(w.shotActive, false); assert.equal(w.player.captured, false);
});

test('same-frame final pocket capture beats a cue scratch and zero remaining budget', () => {
  const w = fresh(4), target = w.enemies[0]; w.enemies = [target];
  w.zones = [{id: 900, kind: 'pocket', shape: 'circle', x: 100, y: 250, r: w.unit * 1.35, centerOnly: true},
    {id: 901, kind: 'pocket', shape: 'circle', x: 260, y: 500, r: w.unit * 1.35, centerOnly: true}];
  w.shoot(0, 80); w.remaining = 0;
  Object.assign(w.player, {x: 100, y: 250, vx: 0, vy: 0}); Object.assign(target, {x: 260, y: 500, vx: 0, vy: 0});
  w.step(1 / 120); assert.equal(w.completed, true); assert.equal(w.phase, 'campaign-celebrate');
  assert.equal(w.poolScratches, 1); assert.equal(w.poolPotted, 1); assert.equal(w.shotsUsed, 1);
  tick(w, 1); assert.equal(w.phase, 'over'); assert.equal(w.events.filter(e => e.type === 'over').length, 1);
});

test('final-frame collision separation into a pocket is captured before the four-second budget loss', () => {
  const w = fresh(4), target = w.enemies[0]; w.enemies = [target];
  w.zones = [{id: 900, kind: 'pocket', shape: 'circle', x: 250, y: 400, r: w.unit * 1.35, centerOnly: true}];
  w.shoot(0, 80); w.remaining = 0; w.shotTime = 4 - 1 / 120;
  // A deliberate final-substep overlap: the target starts just outside the
  // trigger, then equal-mass separation moves it inside before budget loss.
  const pocket = w.zones[0], targetX = pocket.x - pocket.r - w.unit * .1;
  Object.assign(target, {x: targetX, y: pocket.y, vx: 0, vy: 0});
  Object.assign(w.player, {x: targetX - target.r - w.player.r + w.unit * .4, y: pocket.y, vx: 0, vy: 0});
  assert.ok(Math.hypot(target.x - w.player.x, target.y - w.player.y) < target.r + w.player.r);
  assert.equal(zoneContains(target, w.zones[0]), false);
  w.step(1 / 120); assert.equal(w.completed, true); assert.equal(w.phase, 'campaign-celebrate'); assert.equal(w.poolPotted, 1);
});

test('task8 transient slow and goal peak respect feedback strength and real-time expiry', () => {
  const w = fresh(4); w.setFeedbackOptions({strength: .6}); w.beginCampaignSlow({duration: .3, scale: .3});
  near(w.presentationTimeScale, .58); tick(w, .29, .58); assert.ok(w.presentationTimeScale < 1);
  tick(w, .02, .58); assert.equal(w.presentationTimeScale, 1);
  w.setFeedbackOptions({strength: 1, reducedMotion: true}); w.beginCampaignSlow({duration: .3, scale: .3});
  assert.equal(w.presentationTimeScale, 1);
  const golf = fresh(8); golf.rules.isWon = () => true; golf.shotsUsed = 1; golf.beginCampaignPeak();
  assert.equal(golf.celebration.kind, 'golf'); assert.equal(golf.celebration.crown, true);
  golf.setFeedbackOptions({strength: .6}); near(golf.presentationTimeScale, .55);
  golf.setFeedbackOptions({strength: 0}); assert.equal(golf.presentationTimeScale, 1);
});

test('last-substep pool collision cannot leave a frozen target protruding through the border', () => {
  const w = fresh(4), target = w.enemies[0]; w.enemies = [target]; w.zones = [];
  const left = w.arenaBounds.left;
  w.shoot(0, 80); w.shotTime = 4 - 1 / 120;
  Object.assign(target, {x: left + target.r, y: 400, vx: 0, vy: 0});
  Object.assign(w.player, {x: left + target.r + 2 * w.unit - .5, y: 400, vx: -100, vy: 0});
  w.step(1 / 120); assert.equal(w.shotActive, true); tick(w, .31);
  assert.equal(w.shotActive, false); assert.ok(target.x - target.r >= left - 1e-8);
  assert.ok(Math.hypot(target.x - w.player.x, target.y - w.player.y) >= target.r + w.player.r - 1e-5);
  const x = target.x; tick(w, .2); near(target.x, x);
});

test('synthetic idle obstacles bounce off the stationary cue without spending a stroke or entering the hole', () => {
  const w = fresh(8); w.statics = [];
  assert.equal(w.enemies.length, 0, 'authored golf courses do not spawn the retired walkers');
  // Exercise the shared idle-dynamics regression with an explicit obstacle,
  // without putting moving enemies back into any production course.
  const walker = w.makeBody(0, 0, w.unit * .6, .8);
  Object.assign(walker, {hp: Infinity, maxHp: Infinity, born: 1, solid: true, drag: 0, enemyType: 'walker'});
  w.enemies.push(walker);
  Object.assign(w.player, {x: 200, y: 500});
  Object.assign(walker, {x: 200 - w.player.r - walker.r + .1, y: 500, vx: w.unit * 1.5, vy: 0});
  const before = {x: w.player.x, y: w.player.y, remaining: w.remaining};
  w.step(1 / 120); assert.ok(walker.vx < 0);
  near(w.player.x, before.x); near(w.player.y, before.y); assert.equal(w.remaining, before.remaining);
  assert.equal(w.shotsUsed, 0); assert.equal(w.completed, false);
  assert.ok(Math.hypot(walker.x - w.player.x, walker.y - w.player.y) >= walker.r + w.player.r - 1e-5);
});

test('real golf stroke cannot win from a rotation-created hole overlap, including a repeated resize', () => {
  const w = new CampaignWorld(390, 844, 7, () => .5, {upgradeId: 'rubber'}).setFeedbackOptions({strength: 0});
  const angle = -1.095124441871195, power = .5156969479064442;
  w.shoot(-Math.cos(angle) * w.maxPull * power, -Math.sin(angle) * w.maxPull * power);
  for (let i = 0; i < 120; i++) w.step(1 / 120);
  const remaining = w.remaining, score = w.score;
  w.resize(844, 390); const hole = w.zones.find(z => z.kind === 'hole'), key = `${w.player.id}:${hole.id}`;
  assert.equal(zoneContains(w.player, hole), true); assert.equal(w.blockedZoneEntries.has(key), true);
  w.resize(844, 390); assert.equal(w.blockedZoneEntries.has(key), true);
  w.step(1 / 120); assert.equal(w.completed, false); assert.equal(w.remaining, remaining); assert.equal(w.score, score);
  // Continuing this actual stroke exits the resized hole. The next genuine
  // precision putt is a fresh physical entry and must still be capturable.
  for (let i = 0; i < 500; i++) w.step(1 / 120);
  assert.equal(w.blockedZoneEntries.has(key), false); assert.equal(w.ready, true);
  const dx = hole.x - w.player.x, dy = hole.y - w.player.y, distance = Math.hypot(dx, dy);
  const pull = Math.min(1, (.6 * distance + 6 * w.unit) / w.baseSpeed) * w.maxPull;
  assert.equal(w.shoot(-dx / distance * pull, -dy / distance * pull), true);
  tick(w, 5); assert.equal(w.completed, true); assert.equal(w.shotsUsed, 2);
});

test('rotation separates a pool target that would otherwise map inside a pocket without awarding a capture', () => {
  const w = new CampaignWorld(320, 568, 4, () => .5, {upgradeId: 'rubber'});
  const resized = new CampaignWorld(568, 320, 4, () => .5, {upgradeId: 'rubber'});
  const old = w.arenaBounds, next = resized.arenaBounds, pocket = resized.zones[0], target = w.enemies[0];
  // Explicit edge fixture: inverse-map a point inside the future corner pocket.
  // It lies outside every current pocket, so only rotation creates the overlap.
  const mapped = {x: pocket.x + pocket.r * .55, y: pocket.y + pocket.r * .55};
  Object.assign(target, {x: old.left + (mapped.y - next.top) / next.height * old.width,
    y: old.top + (1 - (mapped.x - next.left) / next.width) * old.height});
  assert.ok(w.zones.every(zone => !zoneContains(target, zone)));
  assert.equal(zoneContains({...target, ...mapped}, pocket), true);
  assert.equal(w.shoot(0, w.maxPull * .2), true);
  const before = {remaining: w.remaining, potted: w.poolPotted, scratches: w.poolScratches, count: w.enemies.length, score: w.score};
  w.resize(568, 320);
  assert.equal(zoneContains(target, w.zones[0]), false, 'rotation pushes the target safely out of the future pocket');
  w.resize(568, 320);
  assert.equal(zoneContains(target, w.zones[0]), false);
  w.step(1 / 120);
  assert.deepEqual({remaining: w.remaining, potted: w.poolPotted, scratches: w.poolScratches, count: w.enemies.length, score: w.score}, before);
  assert.equal(w.completed, false);
});

test('a new launch does not clear a resize-overlap exclusion before the ball physically leaves', () => {
  const w = new CampaignWorld(390, 844, 7, () => .5, {upgradeId: 'rubber'}).setFeedbackOptions({strength: 0});
  const angle = -1.095124441871195, power = .5156969479064442;
  w.shoot(-Math.cos(angle) * w.maxPull * power, -Math.sin(angle) * w.maxPull * power);
  for (let i = 0; i < 120; i++) w.step(1 / 120);
  w.resize(844, 390); const hole = w.zones.find(z => z.kind === 'hole'), key = `${w.player.id}:${hole.id}`;
  assert.equal(w.blockedZoneEntries.has(key), true);
  w.endLaunch();
  const dx = w.player.x - hole.x, dy = w.player.y - hole.y, distance = Math.hypot(dx, dy);
  assert.equal(w.shoot(-dx / distance * w.maxPull, -dy / distance * w.maxPull), true);
  assert.equal(w.blockedZoneEntries.has(key), true);
  tick(w, .15); assert.equal(w.blockedZoneEntries.has(key), false); assert.equal(w.completed, false);
});
