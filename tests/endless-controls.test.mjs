import test from 'node:test';
import assert from 'node:assert/strict';
import {World, length, BOSS_TIMING} from '../dist/physics.js';
import {LegacyCampaignWorld as CampaignWorld} from '../dist/campaign.js';

const near = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
function world(campaign = false) {
  const w = campaign ? new CampaignWorld(10000, 10000, 1, () => .5) : new World(10000, 10000, () => .5, {spawnInitial: false});
  w.enemies = []; w.spawnTimer = 999; w.floorTimer = Infinity; w.introTimer = Infinity; w.target = Infinity; w.events = []; w.energy = 1;
  Object.assign(w.player, {x: 2000, y: 2000, vx: 0, vy: 0});
  return w;
}
function enemy(w, values = {}) {
  const body = w.makeBody(3000, 3000, w.unit, .8);
  Object.assign(body, {born: 1, solid: true, hp: 10000, maxHp: 10000}, values);
  w.enemies.push(body);
  return body;
}

test('endless battle, Boss entry and Boss permit capture at every speed', () => {
  const w = world(); w.player.vx = w.unit * 150;
  for (const phase of ['battle', 'boss-entry', 'boss']) {
    w.phase = phase;
    assert.equal(w.continuousControl, true); assert.equal(w.ready, true);
    assert.equal(w.beginPull(), true); near(w.player.vx, w.unit * 150); w.cancelPull();
  }
  for (const phase of ['choose', 'reward', 'clearing', 'transition', 'boss-celebrate', 'over']) {
    w.phase = phase;
    assert.equal(w.continuousControl, false); assert.equal(w.ready, false); assert.equal(w.beginPull(), false);
  }
  const campaign = world(true); campaign.player.vx = campaign.unit * 9;
  assert.equal(campaign.continuousControl, false); assert.equal(campaign.beginPull(), false);
  campaign.player.vx = campaign.unit * 7;
  assert.equal(campaign.beginPull(), true);
});

test('ordinary endless release redirects current speed while Boss release restores bounded captured-speed addition', () => {
  for (const phase of ['battle', 'boss-entry', 'boss']) for (const [current, power, energy, density] of [
    [0, 1, 1, 1], [.5, 1, 1, 1], [2, 1, 1, 1], [.5, .25, 1, 1], [.25, 1, 2, 1.5], [0, 1, 100, 1],
  ]) {
    const w = world(); w.phase = phase; w.energy = energy; w.density = density;
    w.player.vx = w.baseSpeed * 3; assert.equal(w.beginPull(), true);
    w.player.vx = current * w.baseSpeed * .6; w.player.vy = current * w.baseSpeed * .8;
    const speed = length(w.player), launch = Math.min(w.unit * 60, w.baseSpeed * power * Math.sqrt(energy));
    const expected = phase==='battle'?Math.max(speed, launch * (1 - .5 * Math.min(1, speed / w.baseSpeed))):launch+Math.min(w.baseSpeed*3,w.readySpeed);
    assert.equal(w.shoot(w.maxPull * power * .6, -w.maxPull * power * .8), true);
    near(w.player.vx, -expected * .6); near(w.player.vy, expected * .8);
    assert.equal(w.pullStartSpeed, null);
  }
});

test('holding an endless aim leaves ordinary drag unchanged while campaign and choose retain braking', () => {
  for (const startSpeed of [5, 30]) {
    const held = world(), free = world();
    for (const w of [held, free]) w.player.vx = w.unit * startSpeed;
    assert.equal(held.beginPull(), true); held.step(.2, true); free.step(.2, false);
    near(held.player.vx, free.player.vx); near(held.player.x, free.player.x);
    near(held.player.vx, held.unit * startSpeed * Math.exp(-(startSpeed > 8 ? .35 : 1.2) * .2));
  }
  for (const w of [world(true), Object.assign(world(), {phase: 'choose'})]) {
    w.player.vx = w.unit * 5; w.beginPull(); w.step(.2, true);
    near(w.player.vx, w.unit * 5 * Math.exp(-10 * .2));
    w.shoot(0, -w.maxPull); near(w.player.vy, w.baseSpeed + w.unit * 5);
  }
});

test('normal collision retains solved direction and seventy percent speed without changing incoming damage', () => {
  for (const offset of [0, 12]) {
    const endless = world(), campaign = world(true);
    for (const w of [endless, campaign]) {
      Object.assign(w.player, {x: 2000, y: 2000, vx: 600, vy: 0});
      w.collide(w.player, enemy(w, {x: 2000 + w.unit * 1.9, y: 2000 + offset}));
    }
    const p = endless.player, old = campaign.player, solved = length(old);
    near(length(p), Math.max(600 * .7, solved));
    near(p.vx / length(p), old.vx / solved); near(p.vy / length(p), old.vy / solved);
    near(endless.enemies[0].vx, campaign.enemies[0].vx);
    near(endless.enemies[0].vy, campaign.enemies[0].vy);
    assert.equal(endless.enemies[0].hp, campaign.enemies[0].hp);
  }
});

test('pierce keeps the incoming direction and a ninety-two-percent floor only in endless play', () => {
  const endless = world(), campaign = world(true);
  for (const w of [endless, campaign]) {
    w.buffs.pierce = 1;
    Object.assign(w.player, {x: 2000, y: 2000, vx: 480, vy: 360});
    const b = enemy(w, {x: 2000 + w.unit * 1.9 * .8, y: 2000 + w.unit * 1.9 * .6});
    w.collide(w.player, b);
    near(w.player.vx / length(w.player), .8); near(w.player.vy / length(w.player), .6);
  }
  near(length(endless.player), 600 * .92); near(length(campaign.player), 600 * .52);
});

test('player walls retain ninety-five percent in ordinary endless combat and 98.5 percent in Boss combat', () => {
  for (const [campaign, phase, retention] of [[false, 'battle', .95], [false, 'boss', .985], [false, 'choose', .92], [false, 'reward', .92], [true, 'battle', .92]]) {
    const w = world(campaign);if(phase==='boss'){w.stage=5;w.beginBoss();w.step(BOSS_TIMING.entry);}else w.phase=phase;
    Object.assign(w.player, {x: 0, y: phase==='boss'?w.arenaGeometry.y:2000, vx: -500, vy: 100}); w.wall(w.player);
    near(w.player.vx, 500 * retention); near(w.player.vy, 100);
    const b = enemy(w, {x: 0, y: phase==='boss'?w.arenaGeometry.y:3000, vx: -500}); w.wall(b); near(b.vx, 460);
  }
});

test('endless drag splits the eight-unit threshold consistently and leaves enemy and campaign drag unchanged', () => {
  const a = world(), b = world();
  for (const w of [a, b]) w.player.vx = w.unit * 8.1;
  const crossing = Math.log(8.1 / 8) / .35, dt = .2;
  a.step(dt); for (let i = 0; i < 20; i++) b.step(dt / 20);
  const expected = a.unit * 8 * Math.exp(-1.2 * (dt - crossing));
  near(length(a.player), expected); near(length(b.player), expected);
  for (const campaign of [false, true]) {
    const w = world(campaign), b = enemy(w, {vx: 200}); w.player.vx = 200;
    w.step(.1); near(b.vx, 200 * Math.exp(-1.2 * .1));
    near(w.player.vx, 200 * Math.exp(-(campaign ? .6 : 1.2) * .1));
  }
});

test('slow aiming consumes local contact holds and timestamps in real active seconds', () => {
  for (const timeScale of [.3, .6, 1]) {
    const w = world(); w.setFeedbackOptions({strength: .6}); w.player.vx = 100;
    const victim = enemy(w, {hp: 1}), other = enemy(w, {x: 4000, vx: 100});
    w.step(.02 * timeScale, true, {timeScale});
    near(w.feedbackTime, .02); near(w.time, .02 * timeScale);
    w.damage(victim, 1);
    const kill = w.events.find(e => e.type === 'kill'), x = w.player.x, otherX = other.x, spawnTimer = w.spawnTimer;
    near(kill.feedbackTime, .02); near(kill.freezeDuration, .048);
    w.step(.04 * timeScale, true, {timeScale});
    near(w.player.x, x); near(w.player.feedbackFreeze, .008);
    near(w.feedbackTime - kill.feedbackTime, .04);
    assert.ok(other.x > otherX); near(spawnTimer - w.spawnTimer, .04 * timeScale);
    w.step(.008 * timeScale, true, {timeScale});
    near(w.player.x, x); near(w.player.feedbackFreeze, 0);
    near(w.feedbackTime - kill.feedbackTime, kill.freezeDuration);
    w.step(.01 * timeScale, true, {timeScale}); assert.ok(w.player.x > x);
    const stoppedClock = w.feedbackTime; w.phase = 'over'; w.step(1, true, {timeScale}); near(w.feedbackTime, stoppedClock);
  }
});

test('slow anticipation and partial hold release move only the remaining world-time fraction', () => {
  for (const timeScale of [.3, .6, 1]) {
    const w = world(); w.setFeedbackOptions({strength: 1}); w.shoot(-w.maxPull, 0);
    const x = w.player.x, speed = length(w.player);
    w.step(.033 * timeScale, true, {timeScale}); near(w.player.x, x); near(w.player.feedbackFreeze, 0);
    near(w.feedbackFreezeUsed, .033); near(w.feedbackTime, .033);
    w.freezeFeedback(w.player, .017, {scaled: false});
    w.step(.03 * timeScale, true, {timeScale});
    near(length(w.player), speed * Math.exp(-.35 * .013 * timeScale));
    near(w.feedbackFreezeUsed, .05); near(w.feedbackTime, .063);
    assert.ok(w.player.x > x);
  }
});

test('boss local freeze releases on real time while inflation and stun advance on world time', () => {
  const w = world(); w.setFeedbackOptions({strength: 1}); w.stage = 5; w.beginBoss(); w.step(BOSS_TIMING.entry);
  const boss = w.boss; boss.r = boss.minRadius + .001;
  Object.assign(w.player, {x: boss.x, y: boss.y + boss.r + w.player.r - .01, vx: 0, vy: -w.baseSpeed});
  w.collideBoss(); assert.equal(boss.stunned, true);
  const hit = w.events.find(e => e.type === 'bossStunned'); near(hit.freezeDuration, .15);
  w.step(.15 * .3, true, {timeScale: .3});
  near(w.feedbackTime - hit.feedbackTime, .15); near(w.player.feedbackFreeze, 0); near(boss.feedbackFreeze, 0); near(boss.stunnedTime, 0);
  w.step(.1 * .3, true, {timeScale: .3}); near(boss.stunnedTime, .03);
});
