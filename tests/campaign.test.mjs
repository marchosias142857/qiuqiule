import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../dist/physics.js';
import {LegacyCampaignWorld as CampaignWorld, legacyLevelConfig as levelConfig, progressPercent, normalizeProgress as normalizeFullProgress} from '../dist/campaign.js';

const normalizeProgress = raw => { const p=normalizeFullProgress(raw); return {completed:p.completed,unlocked:p.unlocked}; };

const step = (world, seconds) => {for (let i = 0; i < Math.ceil(seconds * 120); i++) world.step(1 / 120);};
const fresh = (level = 1) => new CampaignWorld(900, 700, level, () => .51);
function killOne(world) {
  if (!world.enemies.some(body => body.hp > 0)) world.spawnEnemy();
  const body = world.enemies.find(body => body.hp > 0);
  assert.ok(body, 'a live enemy exists');
  world.damage(body, 1e9);
  world.enemies = world.enemies.filter(body => body.hp > 0);
  return body;
}

test('all 100 finite level configurations increase population and pressure', () => {
  const configs = Array.from({length: 100}, (_, i) => levelConfig(i + 1));
  for (const [i, config] of configs.entries()) {
    assert.equal(config.level, i + 1);
    assert.ok(Number.isInteger(config.totalEnemies) && config.totalEnemies >= 18);
    assert.ok(config.spawnInterval > 0 && config.enemyHp > 0);
    if (i) {
      const previous = configs[i - 1];
      assert.ok(config.totalEnemies > previous.totalEnemies);
      assert.ok(config.spawnInterval < previous.spawnInterval);
      assert.ok(config.enemyHp >= previous.enemyHp);
      assert.ok(config.enemyDensity > previous.enemyDensity);
    }
  }
  assert.equal(levelConfig(-12).level, 1);
  assert.equal(levelConfig(1000).level, 100);
  assert.equal(levelConfig(NaN).level, 1);
});

test('campaign opens with two configured enemies and no score/choice target', () => {
  for (const level of [1, 50, 100]) {
    const world = fresh(level), config = levelConfig(level);
    assert.equal(world.mode, 'campaign');
    assert.equal(world.level, level);
    assert.equal(world.enemies.length, 2);
    assert.equal(world.spawned, 2);
    assert.equal(world.enemies[0].hp, config.enemyHp);
    assert.equal(world.enemies[0].density, config.enemyDensity);
    assert.equal(world.spawnTimer, config.spawnInterval);
    assert.equal(world.energy, config.playerEnergy);
    assert.equal(world.score, 0);
    assert.equal(world.target, Infinity);
    assert.deepEqual(world.choices, []);
  }
});

test('finite spawn cap includes opening enemies and cannot be exceeded after clearing', () => {
  for (const level of [1, 100]) {
    const world = fresh(level);
    for (let i = 0; i < world.totalEnemies - 1; i++) killOne(world);
    while (world.spawned < world.totalEnemies) world.spawnEnemy();
    assert.equal(world.kills, world.totalEnemies - 1);
    assert.equal(world.spawned, world.totalEnemies);
    assert.equal(world.completed, false);
    assert.equal(world.phase, 'battle');
    const last = world.enemies[0];
    for (let i = 0; i < 100; i++) world.spawnEnemy();
    assert.equal(world.enemies.length, 1);
    assert.equal(world.enemies[0], last);
    world.damage(last, 1e9);
    assert.equal(world.completed, true);
    assert.equal(world.phase, 'over');
    assert.equal(world.kills, world.totalEnemies);
    assert.equal(world.percent, 100);
    assert.equal(world.events.filter(event => event.type === 'over').length, 1);
    assert.equal(world.events.at(-1).completed, true);
    world.spawnEnemy(); world.damage(last, 1e9); step(world, 5);
    assert.equal(world.spawned, world.totalEnemies);
    assert.equal(world.events.filter(event => event.type === 'over').length, 1);
  }
});

test('automatic upgrades occur once per kill threshold without stopping combat', () => {
  const world = fresh(), initialEnergy = world.energy;
  for (let i = 0; i < world.config.upgradeEvery; i++) killOne(world);
  assert.equal(world.kills, 5);
  assert.equal(world.upgrades, 1);
  assert.equal(world.energy, initialEnergy * 1.14);
  assert.equal(world.player.hit, 1);
  assert.equal(world.phase, 'battle');
  assert.deepEqual(world.choices, []);
  const event = world.events.find(event => event.type === 'campaignBuff');
  assert.equal(event.attribute, 'energy');
  assert.equal(event.x, world.player.x);
  assert.equal(event.y, world.player.y);
  assert.ok(event.label);
  for (let i = 0; i < world.config.upgradeEvery; i++) killOne(world);
  assert.equal(world.density, 1.12);
  assert.equal(world.player.mass, 1.5 * 1.12);
  assert.equal(world.events.filter(event => event.type === 'campaignBuff').length, 2);
  assert.equal(world.score, 0);
  assert.equal(world.stage, 1);
});

test('a dead enemy cannot credit kills, upgrades, or completion twice', () => {
  const world = fresh(), body = world.enemies[0];
  world.damage(body, body.hp);
  world.damage(body, 100);
  assert.equal(world.kills, 1);
  assert.equal(world.events.filter(event => event.type === 'kill').length, 1);
  assert.equal(world.score, 0);
});

test('idle campaign loses on a full field before exceeding the finite total', () => {
  for (const [width, height] of [[390, 844], [844, 390], [1440, 900]]) {
    const world = new CampaignWorld(width, height, 100, () => .63);
    step(world, 50);
    assert.equal(world.phase, 'over');
    assert.equal(world.completed, false);
    assert.equal(world.enemies.length, 18);
    assert.equal(world.spawned, 18);
    assert.equal(world.kills, 0);
    const events = world.events.filter(event => event.type === 'over');
    assert.equal(events.length, 1);
    assert.equal(events[0].completed, false);
    for (const body of [world.player, ...world.enemies]) {
      for (const property of ['x', 'y', 'vx', 'vy', 'mass']) assert.ok(Number.isFinite(body[property]));
    }
  }
});

test('the last kill wins even when a full-field check would run in the same frame', () => {
  const world = fresh();
  world.spawned = world.totalEnemies;
  world.kills = world.totalEnemies - 1;
  world.enemies = [world.enemies[0]];
  world.limit = 1;
  const body = world.enemies[0];
  Object.assign(world.player, {x: 300, y: 300, vx: world.unit * 35, vy: 0});
  Object.assign(body, {x: 300 + world.player.r + body.r - 1, y: 300, born: 1, solid: true, hp: 1});
  world.step(1 / 120);
  assert.equal(world.completed, true);
  assert.equal(world.phase, 'over');
  assert.equal(world.events.filter(event => event.type === 'over').length, 1);
  assert.equal(world.events.at(-2).completed, true);
});

test('campaign pacing and enemies do not become harder solely by waiting', () => {
  const world = fresh(40), config = levelConfig(40);
  world.time = 3600;
  world.enemies = [];
  world.spawnEnemy();
  assert.equal(world.enemies[0].hp, config.enemyHp);
  assert.equal(world.enemies[0].density, config.enemyDensity);
  world.spawnTimer = 0;
  world.step(1 / 120);
  assert.equal(world.spawnTimer, config.spawnInterval);
});

test('growth and earned attributes survive rotation while a new attempt resets them', () => {
  const world = fresh(100);
  for (let i = 0; i < 3; i++) world.gainAttribute();
  const mass = world.player.mass, energy = world.energy;
  assert.ok(Math.abs(world.player.r / world.unit - 1.06) < 1e-12);
  world.resize(390, 844);
  assert.ok(Math.abs(world.player.r / world.unit - 1.06) < 1e-12);
  assert.equal(world.player.mass, mass);
  assert.equal(world.energy, energy);
  const retry = fresh(100);
  assert.equal(retry.kills, 0);
  assert.equal(retry.spawned, 2);
  assert.equal(retry.upgrades, 0);
  assert.equal(retry.energy, levelConfig(100).playerEnergy);
});

test('progress is rounded, clamped and normalizes sequential unlocks through 100', () => {
  assert.equal(progressPercent(1, 3), 33);
  assert.equal(progressPercent(2, 3), 67);
  assert.equal(progressPercent(1, 8), 13);
  assert.equal(progressPercent(-1, 20), 0);
  assert.equal(progressPercent(30, 20), 100);
  assert.equal(progressPercent(0, 0), 0);
  assert.equal(progressPercent(NaN, 20), 0);
  assert.deepEqual(normalizeProgress(null), {completed: 0, unlocked: 1});
  assert.deepEqual(normalizeProgress(7), {completed: 6, unlocked: 7});
  assert.deepEqual(normalizeProgress({completed: 37, unlocked: 100}), {completed: 37, unlocked: 100});
  assert.deepEqual(normalizeProgress({completed: 100, unlocked: 101}), {completed: 100, unlocked: 100});
  assert.deepEqual(normalizeProgress({completed: -4}), {completed: 0, unlocked: 1});
});

test('campaign hooks stay separate from the new endless opening and escalation', () => {
  const world = new World(900, 700, () => .5);
  assert.equal(world.enemies.length, 6);
  assert.equal(world.enemies[0].hp, 19);
  assert.equal(world.enemies[0].density, .71);
  assert.equal(world.enemies[0].value, 10);
  assert.equal(world.limit, 28);
  assert.equal(world.killTarget, 14);
  assert.equal(world.spawnInterval, 2);
  world.stage = 8; world.time = 180; world.enemies = []; world.spawnEnemy();
  assert.equal(world.enemies[0].hp, 19 * 1.16 ** 7 + 8);
  assert.equal(world.enemies[0].density, .65 + .06 * 8 + .0004 * 180);
  assert.equal(world.enemies[0].value, 10);
  assert.equal(world.killTarget, 42);
  assert.equal(world.spawnInterval, (.65 + 1.35 * .86 ** 7) * 1.15);
  const campaign = fresh(8);
  assert.equal(campaign.limit, 18);
  assert.equal(campaign.enemies.length, 2);
  assert.equal(campaign.enemies[0].hp, levelConfig(8).enemyHp);
  assert.equal(campaign.spawnInterval, levelConfig(8).spawnInterval);
});
