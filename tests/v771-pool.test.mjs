import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld} from '../dist/campaign.js';
import {POOL_LEVELS, poolParams, poolAimTargets} from '../dist/classes/pool.js';

const viewports = [[320, 568], [390, 844], [844, 390], [568, 320]];
const worldAt = (rank, width = 390, height = 844, upgradeId = 'steady') =>
  new CampaignWorld(width, height, (rank >> 1) * 10 + 3 + rank % 2, () => .51, {upgradeId});
const tick = world => {
  const scale = world.presentationTimeScale;
  world.step(scale / 120, false, {timeScale: scale});
};
const pairSignature = positions => positions.flatMap((a, i) => positions.slice(i + 1)
  .map(b => Math.hypot(a[0] - b[0], a[1] - b[1]).toFixed(5))).sort().join(',');
const bodiesFit = (world, label) => {
  const bodies = [world.player, ...world.enemies], b = world.arenaBounds;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    assert.ok(Math.abs(body.r / world.unit - .62) < 1e-8, `${label}: true .62u collision radius`);
    assert.ok(body.x - body.r >= b.left - .001 && body.x + body.r <= b.right + .001 &&
      body.y - body.r >= b.top - .001 && body.y + body.r <= b.bottom + .001, `${label}: in bounds`);
    for (const other of bodies.slice(i + 1)) assert.ok(Math.hypot(body.x - other.x, body.y - other.y) >=
      body.r + other.r - .001, `${label}: no initial overlap`);
    for (const pocket of world.zones) assert.ok(Math.hypot(body.x - pocket.x, body.y - pocket.y) > pocket.r,
      `${label}: no automatic starting pot`);
  }
};

test('twenty authored pool puzzles have independent geometry, cue placements and increasing clearance work', () => {
  assert.equal(POOL_LEVELS.length, 20);
  assert.equal(new Set(POOL_LEVELS.map(level => level.id)).size, 20);
  assert.equal(new Set(POOL_LEVELS.map(level => level.name)).size, 20);
  // Pair distances ignore translation, rotation, mirroring and array order. This
  // rejects cosmetic flips of the same ball arrangement as separate puzzles.
  assert.equal(new Set(POOL_LEVELS.map(level => pairSignature(level.balls))).size, 20);
  for (let rank = 0; rank < 20; rank++) {
    const p = poolParams(rank >> 1, rank % 2), level = POOL_LEVELS[rank];
    assert.equal(p.layoutId, level.id); assert.equal(p.layoutName, level.name);
    assert.equal(p.targetBalls, level.balls.length); assert.equal(p.budget, level.balls.length + 3);
    assert.ok(level.lesson.length > 8);
    assert.ok(p.threePointShots < p.twoPointShots && p.twoPointShots < p.budget);
    if (rank) {
      assert.ok(p.targetBalls >= POOL_LEVELS[rank - 1].balls.length);
      assert.ok(p.pocketRadius < poolParams((rank - 1) >> 1, (rank - 1) % 2).pocketRadius);
    }
  }
});

test('all twenty authored layouts fit four viewports with equal cue/target radii and correct mass', () => {
  for (let rank = 0; rank < 20; rank++) for (const [width, height] of viewports) {
    const w = worldAt(rank, width, height), label = `${rank} at ${width}×${height}`;
    bodiesFit(w, label);
    assert.ok(w.enemies.every(ball => ball.mass === w.player.mass));
    assert.equal(w.enemies.length, POOL_LEVELS[rank].balls.length);
    assert.equal(w.zones.length, 6);
    assert.ok(w.zones.every(pocket => pocket.r > w.player.r * 1.7));
  }
});

test('pool ghost cue points contact the exact target surface and do not pass through another target', () => {
  for (let rank = 0; rank < 20; rank++) for (const [width, height] of viewports) {
    const w = worldAt(rank, width, height), before = w.enemies.map(ball => [ball.x, ball.y, ball.hp]);
    const points = poolAimTargets(w);
    if (rank < 4) assert.ok(points.length, `rank ${rank} has a readable introductory pot`);
    assert.ok(w.rules.tutorialTarget(), `rank ${rank} has an opening hint`);
    for (const point of points) {
      const target = w.enemies.find(ball => ball.id === point.ballId), pocket = w.zones[point.pocketIndex];
      assert.ok(Math.abs(Math.hypot(point.x - target.x, point.y - target.y) - target.r - w.player.r) < 1e-7);
      assert.ok(Math.abs((target.x - point.x) * (pocket.y - target.y) -
        (target.y - point.y) * (pocket.x - target.x)) < 1e-6);
      for (const [a, b, radius] of [[w.player, point, w.player.r], [target, pocket, target.r]]) {
        const dx = b.x - a.x, dy = b.y - a.y, lengthSq = dx * dx + dy * dy;
        for (const other of w.enemies.filter(ball => ball !== target)) {
          const t = Math.max(0, Math.min(1, ((other.x - a.x) * dx + (other.y - a.y) * dy) / lengthSq));
          assert.ok(Math.hypot(other.x - a.x - t * dx, other.y - a.y - t * dy) >= other.r + radius,
            `rank ${rank}: hint has an obstructed segment`);
        }
      }
    }
    assert.deepEqual(w.enemies.map(ball => [ball.x, ball.y, ball.hp]), before, 'aiming is read-only');
  }
});

test('all twenty tutorials produce a real target hit across four viewports and all pool offers', () => {
  for (let rank = 0; rank < 20; rank++) for (const [width, height] of viewports)
    for (const upgradeId of ['steady', 'density', 'rubber', 'bank']) {
      const w = worldAt(rank, width, height, upgradeId), hint = w.rules.tutorialTarget();
      assert.ok(hint); const ratio = w.rules.tutorialPullRatio();
      assert.ok(ratio >= .2 && ratio <= .9);
      const d = Math.hypot(hint.x - w.player.x, hint.y - w.player.y);
      const before = w.enemies.map(ball => ({id: ball.id, x: ball.x, y: ball.y}));
      assert.equal(w.shoot((w.player.x - hint.x) / d * w.maxPull * ratio,
        (w.player.y - hint.y) / d * w.maxPull * ratio), true);
      for (let frame = 0; frame < 1800 && w.shotActive && w.phase === 'battle'; frame++) tick(w);
      assert.ok(before.some(position => {
        const body = w.enemies.find(ball => ball.id === position.id);
        return !body || Math.hypot(body.x - position.x, body.y - position.y) > w.unit;
      }), `rank ${rank}, ${width}×${height}, ${upgradeId}: tutorial misses every target`);
      if (rank < 4) {
        assert.ok(w.poolPotted >= 1, 'introductory hint pots at least one ball');
        assert.equal(w.poolScratches, 0, 'introductory hint does not teach a scratch');
      }
    }
});

test('all twenty layouts survive repeated rotation without restoring the endless-mode ball radius', () => {
  for (let rank = 0; rank < 20; rank++) {
    const w = worldAt(rank), ids = w.enemies.map(ball => ball.id), budget = w.remaining;
    for (const [width, height] of [...viewports.slice().reverse(), [390, 844]]) {
      w.resize(width, height); bodiesFit(w, `rotated rank ${rank} ${width}×${height}`);
      assert.deepEqual(w.enemies.map(ball => ball.id), ids);
      assert.equal(w.remaining, budget); assert.equal(w.poolPotted, 0); assert.equal(w.poolScratches, 0);
    }
  }
});
