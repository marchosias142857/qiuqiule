import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld} from '../dist/campaign.js';
import {staticContact} from '../dist/campaign-collision.js';
import {MERGE_LEVELS, MERGE_RADII, mergeCoverage, mergeLayout, mergeLevelFor} from '../dist/classes/merge.js';

const fresh = (rank, width = 390, height = 844, upgradeId = 'density') =>
  new CampaignWorld(width, height, Math.floor(rank / 2) * 10 + 5 + rank % 2, () => .51, {upgradeId});
const tick = world => {
  const scale = world.presentationTimeScale;
  world.step(scale / 120, false, {timeScale: scale});
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('twenty named merge openings have genuinely different level-labelled spatial topology', () => {
  assert.equal(MERGE_LEVELS.length, 20);
  assert.equal(new Set(MERGE_LEVELS.map(l => l.id)).size, 20);
  assert.equal(new Set(MERGE_LEVELS.map(l => l.name)).size, 20);
  // Pair distances are invariant under translation, rotation and reflection:
  // renaming, mirroring or rotating one opening cannot satisfy this check.
  const signatures = MERGE_LEVELS.map(layout => layout.balls.flatMap((a, i) =>
    layout.balls.slice(i + 1).map(b => [Math.min(a[2], b[2]), Math.max(a[2], b[2]),
      Math.hypot(a[0] - b[0], a[1] - b[1]).toFixed(4)].join(':'))).sort().join('|'));
  assert.equal(new Set(signatures).size, 20);
  for (const [rank, layout] of MERGE_LEVELS.entries()) {
    const w = fresh(rank), actual = mergeLayout(w);
    assert.equal(w.config.layoutId, layout.id); assert.equal(w.config.layoutName, layout.name);
    assert.equal(w.enemies.length, layout.balls.length);
    assert.equal(w.statics.length, layout.baffles.length);
    near(w.player.x, actual.start.x); near(w.player.y, actual.start.y);
    for (const [i, body] of w.enemies.entries()) {
      near(body.x, actual.balls[i].x); near(body.y, actual.balls[i].y);
      assert.equal(body.mergeLevel, layout.balls[i][2]);
    }
    assert.deepEqual(w.enemies.map(b => [b.x,b.y,b.mergeLevel]),
      fresh(rank).enemies.map(b => [b.x,b.y,b.mergeLevel]), 'retry preserves the authored opening');
    for (let i = 0; i < layout.sequence.length * 3; i++)
      assert.equal(mergeLevelFor(Math.floor(rank / 2), i, rank % 2), layout.sequence[i % layout.sequence.length]);
  }
});

test('all twenty openings fit four phone orientations, including the growth upgrade and baffles', () => {
  for (const [width,height] of [[320,568],[568,320],[390,844],[844,390]]) for (let rank = 0; rank < 20; rank++) {
    const w = fresh(rank,width,height,'growth'), before = mergeCoverage(w), mass = w.player.mass;
    const check = () => {
      const b = w.arenaBounds, bodies = [w.player,...w.enemies];
      near(w.player.r, w.unit * .72 * 1.2); near(w.player.mass, mass);
      for (const [i, body] of bodies.entries()) {
        assert.ok(body.x - body.r >= b.left - 1e-7 && body.x + body.r <= b.right + 1e-7, `rank ${rank}, x`);
        assert.ok(body.y - body.r >= b.top - 1e-7 && body.y + body.r <= b.bottom + 1e-7, `rank ${rank}, y`);
        if (body !== w.player) near(body.r, MERGE_RADII[body.mergeLevel - 1] * w.unit);
        for (const other of bodies.slice(i + 1))
          assert.ok(Math.hypot(body.x - other.x, body.y - other.y) >= body.r + other.r - 1e-7, `rank ${rank}, bodies`);
        for (const shape of w.statics)
          assert.ok((staticContact(body,shape)?.depth || 0) < 1e-7, `rank ${rank}, baffle ${shape.mergeBaffle}`);
      }
      const shapeArea = w.statics.reduce((sum, s) => sum + s.width * s.height, 0);
      assert.ok(shapeArea < b.width * b.height * .04, 'small baffles preserve free rearrangement space');
      for (const shape of w.statics) {
        assert.equal(shape.kind,'obstacle'); assert.equal(shape.hp,Infinity);
        assert.equal(shape.active,true); assert.equal(shape.pierceable,false);
      }
      const next = mergeLayout(w);
      assert.deepEqual(w.mergePorts,next.ports);
      for (const [i,s] of w.statics.entries()) {
        near(s.x,next.baffles[i].x); near(s.y,next.baffles[i].y);
        near(s.width,next.baffles[i].width); near(s.height,next.baffles[i].height);
      }
    };
    check(); w.resize(height,width); check(); near(mergeCoverage(w),before);
    assert.equal(w.score,0); assert.equal(w.mergeCount,0); assert.equal(w.mergeMade,0);
  }
});

test('authored source ports produce their own ordered balls without overlaps or automatic merge credit', () => {
  for (let rank = 0; rank < 20; rank++) {
    const w = fresh(rank), layout = MERGE_LEVELS[rank];
    // Isolate each source draw from the dynamic merging tested elsewhere.
    // Existing balls are removed only in this geometry fixture, never in win replays.
    for (let i = 0; i < layout.sequence.length * 2; i++) {
      w.enemies = []; w.rules.onTick(w.config.spawnInterval);
      assert.equal(w.enemies.length,1); assert.equal(w.mergeSpawnIndex,i+1);
      const ball = w.enemies[0], b = w.arenaBounds;
      assert.equal(ball.mergeLevel,layout.sequence[i % layout.sequence.length]);
      assert.ok(Math.min(ball.x-b.left,b.right-ball.x,ball.y-b.top,b.bottom-ball.y) <= ball.r+w.unit*.081);
      for (const shape of w.statics) assert.equal(staticContact(ball,shape),null);
    }
    assert.equal(w.mergeMade,0); assert.equal(w.mergeCount,0); assert.equal(w.score,0);
  }
});

test('fixed merge baffles physically reflect a real launch and never act as destructible targets', () => {
  for (let rank = 0; rank < 20; rank++) {
    const w = fresh(rank), shape = w.statics[0];
    if (!shape) continue;
    w.enemies = [];
    Object.assign(w.player,{x:shape.x-shape.width/2-w.player.r-w.unit*.15,y:shape.y,vx:0,vy:0});
    assert.equal(w.shoot(-w.maxPull,0),true);
    for (let i = 0; i < 60 && !(w.player.vx < -w.unit); i++) tick(w);
    assert.ok(w.player.vx < -w.unit, `rank ${rank} reflects`);
    assert.equal(shape.hp,Infinity); assert.equal(shape.active,true);
    assert.equal(w.score,0); assert.equal(w.mergeMade,0);
  }
});
