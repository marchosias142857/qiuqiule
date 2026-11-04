import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, levelConfig} from '../dist/campaign.js';
import {wallParams, wallCells} from '../dist/classes/wall.js';

const advance = (world, seconds) => {
  for (let i = 0; i < Math.ceil(seconds * 120); i++) world.step(1 / 120);
};
const create = (k = 0, width = 390, height = 844, upgrade = null) =>
  new CampaignWorld(width, height, k * 10 + 1, () => .51, {upgradeId: upgrade});
const liveBricks = world => world.statics.filter(body => body.kind === 'brick' && body.hp > 0);

test('all ten wall tiers retain the PDF anchor dimensions, wandering counts and three reachable rating bands', () => {
  const budgets = [14, 16, 18, 20, 24, 27, 30, 33, 36, 38];
  let previousHP = 0;
  for (let k = 0; k < 10; k++) {
    const config = levelConfig(k * 10 + 1), params = wallParams(k), cells = wallCells(k);
    assert.equal(config.r, 1); assert.equal(config.k, k);
    assert.equal(params.rows, 4 + Math.floor(k / 2));
    assert.equal(params.columns, 5 + Math.floor(k / 3));
    assert.equal(params.wanderers, 2 + Math.floor(k / 3));
    assert.equal(params.budget, budgets[k]);
    assert.ok(params.totalHP > previousHP); previousHP = params.totalHP;
    assert.ok(params.threePointShots < params.twoPointShots);
    assert.ok(params.twoPointShots < params.budget, 'one-point budget band is not erased');
    assert.equal(cells.reduce((sum, cell) => sum + cell.hp, 0), params.totalHP);
    if (k === 0) assert.ok(cells.every(cell => cell.hp === 1));
    if (k === 3) assert.ok(cells.filter(cell => cell.row === 0).every(cell => cell.hp === 2));
    assert.deepEqual(wallCells(k), cells, 'retry does not change the pattern');
  }
});

test('every wall tier fits portrait and landscape with unchanged player radius and safe opening positions', () => {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [568, 320], [1440, 900]]) for (let k = 0; k < 10; k++) {
    const world = create(k, width, height), bounds = world.arenaBounds;
    assert.equal(world.player.r, world.unit);
    assert.equal(liveBricks(world).length, wallParams(k).brickCount);
    assert.equal(world.enemies.length, wallParams(k).wanderers);
    for (const brick of liveBricks(world)) {
      assert.ok(brick.x - brick.width / 2 >= bounds.left);
      assert.ok(brick.x + brick.width / 2 <= bounds.right);
      assert.ok(brick.y - brick.height / 2 >= bounds.top);
      assert.ok(brick.y + brick.height / 2 <= height * .52);
      assert.ok(brick.width > 0 && brick.height > 0 && brick.cornerRadius > 0);
    }
    for (const enemy of world.enemies) assert.ok(Math.hypot(enemy.x - world.player.x, enemy.y - world.player.y) > enemy.r + world.player.r);
  }
});

test('real high-speed brick contact removes one HP, rebounds and does not damage the same contact twice', () => {
  const world = create(9), brick = liveBricks(world).find(body => body.maxHp === 3);
  world.statics = [brick]; world.enemies = [];
  Object.assign(world.player, {x: brick.x, y: brick.y + brick.height / 2 + world.player.r + 4, vx: 0, vy: 0});
  assert.equal(world.shoot(0, world.maxPull), true);
  advance(world, .025);
  assert.equal(brick.hp, 2);
  assert.ok(world.player.vy > 0, 'normal brick contact reflects the incoming upward launch');
  const hp = brick.hp;
  advance(world, .025);
  assert.equal(brick.hp, hp, 'continuous overlap never counts as another hit');
});

test('wandering enemies are optional targets and cannot complete or block the wall objective', () => {
  const world = create(), bricks = liveBricks(world);
  world.shoot(0, world.maxPull);
  for (const enemy of [...world.enemies]) world.damage(enemy, enemy.hp + 1);
  assert.ok(world.enemies.every(enemy => enemy.hp <= 0));
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
  assert.equal(liveBricks(retry).length, 20);
});

test('rotation preserves brick damage, budget and actual collision geometry', () => {
  const world = create(9), brick = liveBricks(world).find(body => body.maxHp === 3);
  world.enemies = [];
  Object.assign(world.player, {x: brick.x, y: brick.y + brick.height / 2 + world.player.r + 3, vx: 0, vy: 0});
  world.shoot(0, world.maxPull); advance(world, .025);
  const hp = brick.hp, remaining = world.remaining, shots = world.shotsUsed;
  world.resize(844, 390);
  assert.equal(brick.hp, hp); assert.equal(world.remaining, remaining); assert.equal(world.shotsUsed, shots);
  assert.equal(world.player.r, world.unit);
  for (const body of liveBricks(world)) assert.ok(body.y + body.height / 2 <= 390 * .52);
});

// Recorded from a deterministic one-shot lookahead bot. Replays use only real
// launches and production step(), with no damage calls or target removal. The
// exact doubles matter because later wall ricochets are sensitive to angle.
const WINNING_ROUTES = [[5.061454830783556,1.9198621771937623,0.3490658503988659,4.71238898038469,2.0943951023931953,0],[5.061454830783556,1.1662075608971998,0.8751228790159737,2.2689280275926285,4.537856055185257,2.0943951023931953,0.17453292519943295],[5.759586531581288,0.5739245709533913,4.71238898038469,-0.8810767612399064,-0.09034621497277288,1.2217304763960306,0.17453292519943295],[5.235987755982988,1.5815437368972878,2.619626512075443,0.22570848641969765,0.11647004440228509,0.17453292519943295],[0.8726646259971648,4.1887902047863905,1.5825265912751212,1.0695076018201326,4.537856055185257,3.141592653589793,2.792526803190927,3.316125578789226],[0.8726646259971648,4.1887902047863905,1.5825265912751212,1.0695076018201326,4.886921905584122,2.9670597283903604,1.7453292519943295,2.18417028465905],[-1.8468804901540405,3.490658503988659,2.792526803190927,-0.8401650234630424,-1.1738680111949744,0.17453292519943295,1.2217304763960306,4.014257279586958],[-1.8468804901540405,5.061454830783556,4.1887902047863905,-2.465442459160392,-2.652339216096808,-2.798487970225169,5.235987755982988,1.2217304763960306,6.1086523819801535,0.6981317007977318],[-1.334580151687664,-0.8317591028230179,-2.3479533469793843,-1.921821311949526,4.014257279586958,5.061454830783556,0.6981317007977318,4.537856055185257,4.71238898038469,1.3962634015954636],[-1.7790576923654795,-1.752959071439047,4.886921905584122,-1.1334666644205817,3.490658503988659,5.585053606381854,5.410520681182422,1.5707963267948966,-0.8428964156230909,4.014257279586958,2.2689280275926285,3.316125578789226,4.363323129985824,-1.78430687829889,-1.8354364097798779,-0.8374979150763092,3.6651914291880923,6.1086523819801535,5.410520681182422,5.061454830783556,4.886921905584122,3.6651914291880923,5.061454830783556,3.316125578789226]];

test('all ten wall tiers have reproducible budget-valid full-clear routes using actual shots', () => {
  for (let k = 0; k < 10; k++) {
    const world = create(k);
    for (const angle of WINNING_ROUTES[k]) {
      assert.equal(world.shoot(-Math.cos(angle) * world.maxPull, -Math.sin(angle) * world.maxPull), true);
      for (let i = 0; i < 125 && world.shotActive; i++) world.step(1 / 30);
    }
    advance(world, 3);
    assert.equal(world.completed, true, `tier ${k} clears through physical contact`);
    assert.equal(world.phase, 'over');
    assert.equal(liveBricks(world).length, 0);
    assert.ok(world.shotsUsed <= world.budget);
    assert.equal(world.events.filter(event => event.type === 'over').length, 1);
    assert.equal(world.events.filter(event => event.type === 'campaignPeak').length, 1);
  }
});

test('all ten wall tiers consume real missed launches and settle a single budget loss', () => {
  for (let k = 0; k < 10; k++) {
    const world = create(k);
    while (world.phase === 'battle' && world.remaining > 0) {
      assert.equal(world.shoot(8, 0), true);
      for (let i = 0; i < 125 && world.shotActive; i++) world.step(1 / 30);
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
