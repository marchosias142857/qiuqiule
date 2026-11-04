import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CampaignWorld, levelConfig} from '../dist/campaign.js';
import {wallParams, wallCells} from '../dist/classes/wall.js';

const advance = (world, seconds) => {
  for (let i = 0; i < Math.ceil(seconds * 120); i++) world.step(1 / 120);
};
const create = (k = 0, width = 390, height = 844, upgrade = null) =>
  new CampaignWorld(width, height, k * 10 + 1, () => .51, {upgradeId: upgrade});
const liveBricks = world => world.statics.filter(body => body.kind === 'brick' && body.hp > 0);

test('all twenty authored wall levels retain monotonic durability, deterministic cells and three rating bands', () => {
  let previousHP = 0;
  for (let rank = 0; rank < 20; rank++) {
    const k = Math.floor(rank / 2), variant = rank % 2;
    const config = levelConfig(k * 10 + 1 + variant), params = wallParams(k, variant), cells = wallCells(k, variant);
    assert.equal(config.r, 1); assert.equal(config.k, k); assert.equal(config.rank20, rank);
    assert.equal(params.columns, 7); assert.equal(params.wanderers, 0);
    assert.equal(params.playerRadius, .45); assert.ok(params.layoutId && params.layoutName);
    assert.ok(params.totalHP > previousHP); previousHP = params.totalHP;
    assert.ok(params.threePointShots < params.twoPointShots);
    assert.ok(params.twoPointShots < params.budget, 'one-point budget band is not erased');
    assert.equal(cells.reduce((sum, cell) => sum + cell.hp, 0), params.totalHP);
    if (rank === 0) assert.ok(cells.every(cell => cell.hp === 1));
    if (rank >= 12) assert.ok(cells.some(cell => cell.hp === 3));
    assert.deepEqual(wallCells(k, variant), cells, 'retry does not change the authored pattern');
  }
});

test('every wall tier fits portrait and landscape with the campaign ball and safe opening positions', () => {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [568, 320], [1440, 900]]) for (let k = 0; k < 10; k++) {
    const world = create(k, width, height), bounds = world.arenaBounds;
    assert.equal(world.player.r, world.unit * .45);
    assert.equal(liveBricks(world).length, wallParams(k).brickCount);
    assert.equal(world.enemies.length, 0);
    for (const brick of liveBricks(world)) {
      assert.ok(brick.x - brick.width / 2 >= bounds.left);
      assert.ok(brick.x + brick.width / 2 <= bounds.right);
      assert.ok(brick.y - brick.height / 2 >= bounds.top);
      assert.ok(brick.y + brick.height / 2 <= bounds.bottom);
      assert.ok(brick.width > 0 && brick.height > 0 && brick.cornerRadius > 0);
      assert.ok(brick.y + brick.height / 2 < world.player.y - world.player.r);
    }
  }
});

test('real high-speed brick contact removes two HP, rebounds and does not damage the same contact twice', () => {
  const world = create(9), brick = liveBricks(world).find(body => body.maxHp === 3);
  world.statics = [brick]; world.enemies = [];
  Object.assign(world.player, {x: brick.x, y: brick.y + brick.height / 2 + world.player.r + 4, vx: 0, vy: 0});
  assert.equal(world.shoot(0, world.maxPull), true);
  advance(world, .025);
  assert.equal(brick.hp, 1);
  assert.ok(world.player.vy > 0, 'normal brick contact reflects the incoming upward launch');
  const hp = brick.hp;
  advance(world, .025);
  assert.equal(brick.hp, hp, 'continuous overlap never counts as another hit');
});

test('wall has no moving balls at setup, idle or after launch and its objective remains brick-only', () => {
  const world = create(), bricks = liveBricks(world);
  assert.equal(world.enemies.length, 0); advance(world, 1);
  assert.equal(world.enemies.length, 0);
  world.shoot(8, 0); advance(world, 1);
  assert.equal(world.enemies.length, 0);
  assert.equal(world.rules.isWon(), false);
  assert.equal(liveBricks(world).length, bricks.length);
  for (const brick of bricks) { brick.hp = 0; brick.dead = true; }
  assert.equal(world.rules.isWon(), true);
});

test('wall rating follows actual launch totals and the final budget shot still wins', () => {
  for (let k = 0; k < 10; k++) {
    const world = create(k), params = wallParams(k);
    for (const brick of world.statics) { brick.hp = 0; brick.dead = true; }
    for (const [shots, rating] of [[params.threePointShots, 3], [params.threePointShots + 1, 2], [params.twoPointShots, 2], [params.twoPointShots + 1, 1], [params.budget, 1]]) {
      world.shotsUsed = shots; assert.equal(world.rules.rating(), rating);
    }
  }
  const world = create(), brick = liveBricks(world).at(-1);
  world.statics = [brick]; world.enemies = [];
  world.remaining = 1; world.shotsUsed = world.budget - 1;
  Object.assign(world.player, {x: brick.x, y: brick.y + brick.height / 2 + world.player.r + 3, vx: 0, vy: 0});
  assert.equal(world.shoot(0, world.maxPull), true);
  advance(world, 6);
  assert.equal(world.completed, true);
  assert.equal(world.phase, 'over');
  assert.equal(world.events.filter(event => event.type === 'over').length, 1);
});

test('a stationary low-speed final shot expires, loses once and can be restarted cleanly', () => {
  const world = create(); world.enemies = [];
  world.remaining = 1; world.shotsUsed = world.budget - 1;
  Object.assign(world.player, {x: world.width / 2, y: world.height * .83, vx: 0, vy: 0});
  assert.equal(world.shoot(8, 0), true);
  advance(world, 5);
  assert.equal(world.completed, false); assert.equal(world.phase, 'over');
  assert.equal(world.events.filter(event => event.type === 'over').length, 1);
  advance(world, 5);
  assert.equal(world.events.filter(event => event.type === 'over').length, 1);
  const retry = create();
  assert.equal(retry.shotsUsed, 0); assert.equal(retry.remaining, retry.budget);
  assert.equal(liveBricks(retry).length, wallParams(0).brickCount);
});

test('rotation preserves brick damage, budget and actual collision geometry', () => {
  const world = create(9), brick = liveBricks(world).find(body => body.maxHp === 3);
  world.enemies = [];
  Object.assign(world.player, {x: brick.x, y: brick.y + brick.height / 2 + world.player.r + 3, vx: 0, vy: 0});
  world.shoot(0, world.maxPull); advance(world, .025);
  const hp = brick.hp, remaining = world.remaining, shots = world.shotsUsed;
  world.resize(844, 390);
  assert.equal(brick.hp, hp); assert.equal(world.remaining, remaining); assert.equal(world.shotsUsed, shots);
  assert.equal(world.player.r, world.unit * .45);
  for (const body of liveBricks(world)) assert.ok(body.y + body.height / 2 <= world.arenaBounds.bottom);
});

// Recorded through a deterministic one-shot lookahead search. Replay never
// edits positions, target HP or goals: every win uses public shoot()/step().
const WINNING_ROUTES = JSON.parse(readFileSync(new URL('./fixtures/v771-wall-routes.json', import.meta.url), 'utf8'));

test('all twenty walls have real three-point clear routes in portrait and landscape at zero and default feedback', () => {
  assert.equal(WINNING_ROUTES.length, 80);
  assert.equal(new Set(WINNING_ROUTES.map(r => `${r.rank}:${r.width}:${r.strength}`)).size, 80);
  for (const route of WINNING_ROUTES) {
    const world = new CampaignWorld(route.width, route.height, route.level, () => .5, {upgradeId: route.upgradeId})
      .setFeedbackOptions({strength: route.strength});
    const step = () => {
      const scale = route.strength ? world.presentationTimeScale : 1;
      world.step(scale / (route.strength ? 120 : 30), false, {timeScale: scale});
    };
    for (const [angle, power] of route.shots) {
      assert.equal(world.shoot(-Math.cos(angle) * world.maxPull * power, -Math.sin(angle) * world.maxPull * power), true);
      for (let i = 0; i < 850 && world.shotActive && world.phase === 'battle'; i++) step();
    }
    for (let i = 0; i < 400 && world.phase !== 'over'; i++) step();
    const label = `rank ${route.rank}, ${route.width}×${route.height}, feedback ${route.strength}`;
    assert.equal(world.completed, true, `${label} clears through physical contact`);
    assert.equal(world.phase, 'over');
    assert.equal(liveBricks(world).length, 0);
    assert.ok(world.shotsUsed <= world.budget);
    assert.equal(world.resultRating, 3, `${label} has an attainable three-point route`);
    assert.equal(world.events.filter(event => event.type === 'over').length, 1);
    assert.equal(world.events.filter(event => event.type === 'campaignPeak').length, 1);
  }
});

test('all ten wall tiers consume real missed launches and settle a single budget loss', () => {
  for (let k = 0; k < 10; k++) {
    const world = create(k);
    while (world.phase === 'battle' && world.remaining > 0) {
      assert.equal(world.shoot(8, 0), true);
      for (let i = 0; i < 240 && world.shotActive; i++) world.step(1 / 30);
    }
    advance(world, 1);
    assert.equal(world.completed, false, `tier ${k} cannot be won by weak horizontal misses`);
    assert.equal(world.phase, 'over');
    assert.equal(world.remaining, 0);
    assert.equal(world.shotsUsed, world.budget);
    assert.equal(world.resultRating, 0);
    assert.equal(world.events.filter(event => event.type === 'over').length, 1);
  }
});
