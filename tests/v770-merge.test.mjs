import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, levelConfig} from '../dist/campaign.js';
import {campaignAimContact} from '../dist/campaign-aim.js';
import {mergeParams, mergeBounds, mergeCoverage, MERGE_RADII} from '../dist/classes/merge.js';

const levelFor = rank => Math.floor(rank / 2) * 10 + 5 + rank % 2;
const fresh = (rank = 0, width = 390, height = 844) => new CampaignWorld(width, height, levelFor(rank), () => .51, {upgradeId: 'density'});
const tick = world => {
  const scale = world.presentationTimeScale;
  world.step(scale / 120, false, {timeScale: scale});
};
const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);

test('all twenty merge levels increase actual arrival pressure, including each paired second level', () => {
  let interval = Infinity, target = 0;
  for (let rank = 0; rank < 20; rank++) {
    const c = levelConfig(levelFor(rank)), p = mergeParams(Math.floor(rank / 2), rank % 2), w = fresh(rank);
    assert.equal(c.type, 'merge'); assert.equal(c.rank20, rank);
    assert.ok(p.spawnInterval < interval); assert.ok(p.targetMax >= target);
    near(c.spawnInterval, p.spawnInterval);
    near(p.threePointTime, 60 + rank * 2); near(p.twoPointTime, 90 + rank * 3);
    w.rules.onTick(p.spawnInterval - .001); assert.equal(w.mergeSpawnIndex, 0);
    w.rules.onTick(.002); assert.equal(w.mergeSpawnIndex, 1);
    interval = p.spawnInterval; target = p.targetMax;
  }
});

test('all twenty merge rating bands have inclusive boundaries and never become a time loss', () => {
  for (let rank = 0; rank < 20; rank++) {
    const w = fresh(rank), c = w.config;
    for (const [elapsed, rating] of [[c.threePointTime, 3], [c.threePointTime + .01, 2],
      [c.twoPointTime, 2], [c.twoPointTime + .01, 1], [10000, 1]]) {
      w.mergeElapsed = elapsed;
      assert.equal(w.rules.rating(), rating); assert.equal(w.rules.ratingStatus().rating, rating);
      assert.equal(w.rules.isLost(), false);
    }
    const status = w.rules.ratingStatus();
    assert.ok(status.three.includes(String(c.threePointTime)));
    assert.ok(status.two.includes(String(c.twoPointTime)));
    assert.ok(status.summary.includes('空间'));
  }
});

test('merge pressure warning begins before 42%, fades continuously and cannot spam crossing events', () => {
  const w = fresh(), bounds = w.arenaBounds, area = bounds.width * bounds.height;
  const body = w.enemies[0]; w.enemies = [body];
  const setCoverage = amount => { body.r = Math.sqrt(area * amount / Math.PI); };
  const warningEvents = () => w.events.filter(event => event.type === 'campaignPressureWarning');
  setCoverage(.369); w.rules.onTick(.01); assert.equal(w.mergeWarning, 0);
  assert.equal(w.rules.isLost(), false); assert.equal(warningEvents().length, 0);
  setCoverage(.37); w.rules.onTick(.01);
  assert.ok(w.mergeWarning > 0 && w.mergeWarning < .25); assert.equal(warningEvents().length, 1);
  const before = w.mergeWarning;
  w.rules.onTick(.01); assert.ok(w.mergeWarning > before); assert.equal(warningEvents().length, 1);
  setCoverage(.41); w.rules.onTick(.01); assert.equal(w.rules.isLost(), false);
  setCoverage(.35); const peak = w.mergeWarning; w.rules.onTick(.01);
  assert.ok(w.mergeWarning > 0 && w.mergeWarning < peak, 'warning fades instead of switching off');
  assert.equal(w.mergeWarningActive, false);
  setCoverage(.38); w.rules.onTick(.01); assert.equal(warningEvents().length, 2);
  setCoverage(.42); near(mergeCoverage(w), .42); assert.equal(w.rules.isLost(), true);
  assert.equal(w.rules.failureReason(), 'pressure');
});

test('all twenty merge layouts preserve physical radii, square area and finite simulation through rotations', () => {
  for (let rank = 0; rank < 20; rank++) for (const [width, height] of [[320,568], [568,320], [390,844], [844,390]]) {
    const w = fresh(rank, width, height), before = mergeCoverage(w);
    const check = () => {
      const b = mergeBounds(w); near(b.width, b.height);
      for (const body of [w.player, ...w.enemies]) {
        assert.ok([body.x, body.y, body.r, body.vx, body.vy].every(Number.isFinite));
        assert.ok(body.x - body.r >= b.left - 1e-5 && body.x + body.r <= b.right + 1e-5);
        assert.ok(body.y - body.r >= b.top - 1e-5 && body.y + body.r <= b.bottom + 1e-5);
        if (!body.isPlayer) near(body.r, MERGE_RADII[body.mergeLevel - 1] * w.unit);
      }
    };
    check(); w.resize(height, width); near(mergeCoverage(w), before); check();
    const target = w.teachingTarget, dx = target.x - w.player.x, dy = target.y - w.player.y, length = Math.hypot(dx, dy);
    assert.equal(w.shoot(-dx / length * w.maxPull * .8, -dy / length * w.maxPull * .8), true);
    for (let i = 0; i < 360; i++) tick(w);
    check(); assert.ok(w.mergeElapsed > 0); assert.equal(w.completed, false);
  }
});

// A fixed, readable aiming policy verifies complete games with public input.
// It selects the nearest ball among the highest sizes with an unobstructed
// line of approach; it never
// edits positions, velocities, spawns, pressure, goals, clocks, or score.
test('all twenty merge levels can finish through real input on four phone layouts', () => {
  for (const [width, height] of [[320,568], [568,320], [390,844], [844,390]]) for (let rank = 0; rank < 20; rank++) {
    const w = fresh(rank, width, height);
    w.setFeedbackOptions({strength: .6, reducedMotion: false});
    for (let frame = 0; frame < 50000 && w.phase !== 'over'; frame++) {
      if (w.ready) {
        const targets = w.enemies.filter(body => body.active !== false && body.hp > 0)
          .sort((a, b) => b.mergeLevel - a.mergeLevel ||
            Math.hypot(a.x - w.player.x, a.y - w.player.y) - Math.hypot(b.x - w.player.x, b.y - w.player.y));
        const target = targets.find(body => {
          const dx = body.x - w.player.x, dy = body.y - w.player.y, d = Math.hypot(dx, dy);
          return campaignAimContact(w, w.player, {x: dx / d, y: dy / d}, d).kind !== 'static';
        }) || targets[0];
        const angle = Math.atan2(target.y - w.player.y, target.x - w.player.x);
        assert.equal(w.shoot(-Math.cos(angle) * w.maxPull, -Math.sin(angle) * w.maxPull), true);
      }
      tick(w);
    }
    const description = `rank ${rank}, ${width}×${height}`;
    assert.equal(w.completed, true, description); assert.equal(w.phase, 'over', description);
    assert.ok(w.mergeMade >= w.config.targetMax, description);
    const merges = w.events.filter(event => event.type === 'campaignMerge');
    const clears = w.events.filter(event => event.type === 'campaignMergeClear');
    assert.equal(merges.filter(event => event.level === 5).length, w.mergeMade, description);
    assert.equal(w.score, merges.reduce((sum, event) => sum + event.value, 0) + clears.length * 500, description);
    assert.equal(w.events.filter(event => event.type === 'over').length, 1, description);
    assert.equal(w.resultRating, w.rules.rating(), description);
    assert.ok(w.rules.ratingStatus().summary.includes(`${Math.ceil(w.mergeElapsed)}秒`));
  }
});
