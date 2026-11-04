import test from 'node:test';
import assert from 'node:assert/strict';
import {World, bossConfig, BOSS_TIMING} from '../dist/physics.js';
import {UPGRADES} from '../dist/upgrades.js';

const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
function encounter(stage = 5, width = 390, height = 844, upgrades = []) {
  const w = new World(width, height, () => .4, {spawnInitial: false});
  w.stage = stage; w.setFeedbackOptions({strength: 0});
  for (const id of upgrades) assert.ok(w.applyUpgrade(id));
  w.beginBoss(); w.step(BOSS_TIMING.entry);
  assert.equal(w.phase, 'boss');
  return w;
}
function corner(w) {
  Object.assign(w.player, {x: w.arenaBounds.left + w.player.r, y: w.arenaBounds.top + w.player.r, vx: 0, vy: 0});
}
function enterStun(w) {
  w.boss.r = w.boss.minRadius + .001;
  assert.ok(w.damageBoss(w.baseSpeed));
  assert.equal(w.boss.stunned, true);
  assert.equal(w.phase, 'boss');
}
function fullBankedImpact(w) {
  const speed = (Math.min(w.launchCap, w.baseSpeed * w.launchEnergyScale) + w.readySpeed)
    * (w.buffs.boomerang ? UPGRADES.boomerang.effect.speedMultiplier : 1);
  w.shotBanked = true; w.bank = w.buffs.bank ? 2 : 0;
  const before = w.boss.hp;
  assert.ok(w.damageBoss(speed));
  return before - w.boss.hp;
}

test('v7.6 first Boss retains its established dimensions, growth, shrink resistance and score schedule', () => {
  const config = bossConfig(5, 20, 400);
  assert.equal(config.index, 1);
  near(config.initialRadius, 96); near(config.minRadius, 40); near(config.maxRadius, 150);
  near(config.inflationRate, .64); near(config.stunHealthScale, 100); near(config.shrinkDivisor, 1);
  assert.equal(config.segmentValue, 100); assert.equal(config.killValue, 500);
  [84.8, 73.6, 62.4, 51.2, 40].forEach((radius, i) => near(config.thresholds[i], radius));
});

test('v7.6 later encounters use the requested growth curve without changing shrink resistance or score rewards', () => {
  for (const [stage, inflation, health] of [[10, 1.12, 125], [15, 1.24, 150], [20, 1.36, 175], [50, 2.08, 325]]) {
    const config = bossConfig(stage, 20, 400), index = stage / 5;
    near(config.inflationRate / .64, inflation); near(config.stunHealthScale, health);
    near(config.shrinkDivisor, 1 + .05 * Math.log2(index));
    assert.equal(config.segmentValue, 90 + 10 * index);
    assert.equal(config.killValue, 450 + 50 * index);
    near(config.initialRadius, 96); near(config.minRadius, 40); near(config.maxRadius, 150);
  }
});

test('v7.6 real Boss entry and resize keep the same linear rate on fitted narrow and grown-player arenas', () => {
  for (const stage of [5, 10, 15, 50]) for (const growth of [0, 2]) {
    const w = encounter(stage, 200, 400, Array(growth).fill('growth'));
    const b = w.boss, inflation = 1 + .12 * (stage / 5 - 1);
    for (const [width, height] of [[200, 400], [390, 844], [844, 390], [1440, 900]]) {
      w.resize(width, height); corner(w);
      near(b.inflationRate / b.initialRadius * 150, inflation);
      assert.ok(b.initialRadius < b.maxRadius);
      assert.ok(w.arenaGeometry.r - b.maxRadius - 2 * w.player.r > 0);
      const radius = b.r;
      w.step(.3);
      assert.equal(w.phase, 'boss'); near(b.r - radius, b.inflationRate * .3);
      assert.equal(w.events.filter(e => e.type === 'bossHit').length, 0);
      assert.equal(w.boss.index, stage / 5);
    }
  }
});

test('v7.6 stun health uses actual strongest-hit damage, preserving the first margin and increasing only later margins', () => {
  const builds = [[], ['density', 'density'], ['growth', 'growth'], ['bank'],
    ['energy', 'energy', 'energy', 'energy', 'density', 'density', 'growth', 'bank', 'boomerang', 'overspeed']];
  for (const stage of [5, 10, 15, 50]) for (const size of [[320, 568], [844, 390]]) for (const upgrades of builds) {
    const w = encounter(stage, ...size, upgrades);
    enterStun(w); const maximum = w.boss.maxHp, damage = fullBankedImpact(w);
    const margin = stage === 5 ? 1.05 : 1.25, health = 1 + .25 * (stage / 5 - 1);
    assert.equal(maximum, Math.ceil(damage * margin * health));
    assert.ok(w.boss.hp > 0, 'the strongest legal contact still leaves a distinct finishing hit');
    assert.equal(w.events.filter(e => e.type === 'bossStunned').length, 1);
    assert.equal(w.events.filter(e => e.type === 'bossDefeated').length, 0);
    near(w.boss.r, w.boss.minRadius);
  }
});

test('v7.6 later stunned health remains a one-time build snapshot across upgrades, resize and further hits', () => {
  for (const stage of [10, 25]) {
    const w = encounter(stage, 390, 844, ['density', 'energy']); enterStun(w);
    const hp = w.boss.hp, maximum = w.boss.maxHp;
    assert.ok(w.applyUpgrade('density')); assert.ok(w.applyUpgrade('energy')); assert.ok(w.applyUpgrade('growth'));
    for (const [width, height] of [[320, 568], [844, 390], [1440, 900]]) {
      w.resize(width, height); corner(w); w.step(.1);
      assert.equal(w.boss.hp, hp); assert.equal(w.boss.maxHp, maximum);
      near(w.boss.r, w.boss.minRadius);
    }
    assert.ok(w.damageBoss(w.unit * 10));
    assert.ok(w.boss.hp < hp); assert.equal(w.boss.maxHp, maximum);
    assert.equal(w.events.filter(e => e.type === 'bossStunned').length, 1);
  }
});

test('v7.6 later idle Bosses still fail exactly at their fitted inflation limit and emit failure once', () => {
  for (const stage of [10, 50]) {
    const w = encounter(stage, 390, 844, ['growth', 'growth']); corner(w);
    const b = w.boss, seconds = (b.maxRadius - b.r) / b.inflationRate;
    w.step(seconds - .02); assert.equal(w.phase, 'boss'); assert.ok(b.r < b.maxRadius);
    w.step(.03); assert.equal(w.phase, 'over'); near(b.r, b.maxRadius);
    assert.equal(w.events.filter(e => e.type === 'over').length, 1);
    assert.equal(w.events.filter(e => e.type === 'bossHit').length, 0);
    w.step(1); assert.equal(w.events.filter(e => e.type === 'over').length, 1);
  }
});
