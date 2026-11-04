import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, levelConfig, campaignUpgradePool} from '../dist/campaign.js';
import {chainParams, chainSpacing, chainMatches} from '../dist/classes/chain.js';
import {trackPath} from '../dist/levels.js';

function random(seed = 733) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
const fresh = (k = 0, width = 390, height = 844, upgradeId = 'growth', rng = random(733 + k)) =>
  new CampaignWorld(width, height, 9 + 10 * k, rng, {upgradeId}).setFeedbackOptions({strength: .6});
const visible = w => w.chainBeads.filter(b => b.active !== false && !b.dead);
const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, `${a} ≈ ${b}`);
const tick = w => { const scale = w.presentationTimeScale; w.step(scale / 120, false, {timeScale: scale}); };
const seconds = (w, duration) => { for (let i = 0; i < Math.ceil(duration * 120); i++) tick(w); };
function hit(w, bead, {tangent = 0, actor = w.player, speed = 20 * w.unit} = {}) {
  const tx = -Math.sin(bead.angle), ty = Math.cos(bead.angle);
  const vx = tangent ? tangent * tx * speed : Math.cos(bead.angle) * speed;
  const vy = tangent ? tangent * ty * speed : Math.sin(bead.angle) * speed;
  w.rules.onStaticHit(bead, {attacker: actor, impactVx: vx, impactVy: vy, impactSpeed: speed,
    normalSpeed: speed, nx: Math.cos(bead.angle), ny: Math.sin(bead.angle), contactX: bead.x, contactY: bead.y}, actor);
}

test('all ten chain tiers use exact PDF sizes, speed, initial logical count, target and sixty-second time budget', () => {
  for (let k = 0; k < 10; k++) {
    const p = chainParams(k), w = fresh(k), config = levelConfig(9 + 10 * k);
    assert.equal(config.classId, 'chain'); assert.equal(config.implemented, true); assert.equal(config.k, k);
    assert.deepEqual(p.sizes, [.6, .85, 1.1]); assert.equal(p.advanceSpeed, .6 + .089 * k);
    assert.equal(p.initialCount, 12 + k); assert.equal(p.goal, 20 + 5 * k);
    assert.equal(p.duration, 60); assert.equal(p.budget, 60); assert.equal(p.budgetKind, 'time');
    assert.equal(w.chainBeads.length, p.initialCount); assert.equal(w.chainState.spawned, p.initialCount);
    assert.equal(w.remaining, 60); assert.equal(w.chainState.remainingTime, 60);
    assert.equal(w.chainState.queued + w.chainState.visibleCount, p.initialCount);
    assert.equal(chainMatches(w.chainBeads).length, 0, 'random birth does not award an existing free triple');
    assert.deepEqual(campaignUpgradePool(w.level).map(u => u.id), ['gravity', 'density', 'growth', 'pulse']);
    assert.equal(w.resultRating, 0); assert.equal(w.percent, 0);
  }
});

test('the real 300-degree rail reuses trackPath, closes with a visible chord, and packs unequal balls by chord tangency', () => {
  for (const [width, height] of [[390, 844], [844, 390], [320, 568], [568, 320], [1280, 720]]) for (let k = 0; k < 10; k++) {
    const w = fresh(k, width, height), t = w.chainTrack;
    near(t.sweepAngle, Math.PI * 5 / 3); near(t.startAngle, Math.PI * 2 / 3);
    assert.equal(t.path, trackPath(t)); near(t.width, .08 * w.unit);
    const rail = w.statics.find(b => b.kind === 'chain-rail'), chord = w.statics.find(b => b.kind === 'chain-chord');
    assert.equal(rail.shape, 'arc'); near(rail.r, t.radius); near(chord.y, t.start.y);
    near(chord.width, t.end.x - t.start.x); near(chord.height, t.width);
    assert.equal(w.zones[0].kind, 'chain-hole'); near(w.zones[0].x, t.end.x); near(w.zones[0].y, t.end.y);
    const balls = visible(w);
    for (const b of balls) {
      near(Math.hypot(b.x - t.cx, b.y - t.cy), t.radius);
      near(b.r, w.config.sizes[b.sizeIndex] * w.unit); near(b.mass, w.config.sizes[b.sizeIndex] ** 2);
      assert.ok(b.y - b.r >= (height > 520 ? 112 : 76) - 1e-6);
      assert.ok(b.x - b.r >= w.arenaBounds.left && b.x + b.r <= w.arenaBounds.right);
    }
    for (let i = 1; i < balls.length; i++) {
      near(Math.hypot(balls[i].x - balls[i - 1].x, balls[i].y - balls[i - 1].y), balls[i].r + balls[i - 1].r);
      near(balls[i].chainS - balls[i - 1].chainS, chainSpacing(t.radius, balls[i - 1].r, balls[i].r));
    }
    for (let i = 0; i < balls.length; i++) for (let j = i + 2; j < balls.length; j++)
      assert.ok(Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y) >= balls[i].r + balls[j].r - 1e-6);
    const packed = w.chainBeads.slice(1).reduce((sum, b, i) => sum + chainSpacing(t.radius, w.chainBeads[i].r, b.r), 0);
    near(w.chainState.headDistance, Math.min(packed, .48 * t.length));
  }
});

test('hidden entry-queue beads cannot be hit, pulse-damaged, remotely matched or credited', () => {
  const w = fresh(9, 568, 320, 'pulse', () => .1);
  assert.ok(w.chainState.queued >= 3);
  const hidden = w.chainBeads.slice(0, 3);
  // A deliberately malformed queued triple is an isolated eligibility fixture.
  for (const b of hidden) { b.sizeIndex = 2; b.r = 1.1 * w.unit; b.mass = 1.21; }
  w.rules.resize(); assert.ok(hidden.every(b => b.active === false));
  w.shoot(0, w.maxPull); for (const b of hidden) hit(w, b);
  assert.equal(w.score, 0); assert.equal(w.chainState.cleared, 0);
  hit(w, visible(w).at(-1)); w.rules.onAfterTick();
  assert.equal(w.chainState.cleared, 1); assert.equal(w.score, 10); assert.equal(w.chainState.maxChain, 0);
  for (const b of hidden) { assert.equal(b.hp, 1); assert.equal(b.dead, undefined); }
});

test('tail-anchored three-stage closing scores each group once, rather than thirty points per matched bead', () => {
  const w = fresh(0, 390, 844, 'growth', () => .1);
  const pattern = [0, 0, 1, 1, 2, 2, 0, 2, 1, 0, 1, 2];
  for (const [i, b] of w.chainBeads.entries()) { b.sizeIndex = pattern[i]; b.r = w.config.sizes[pattern[i]] * w.unit; b.mass = w.config.sizes[pattern[i]] ** 2; }
  w.rules.resize(); const tail = w.chainBeads[0].chainS, head = w.chainState.headDistance;
  w.shoot(0, w.maxPull); const removed = w.chainBeads[6]; hit(w, removed); hit(w, removed);
  w.rules.onAfterTick();
  assert.equal(w.chainState.cleared, 10); assert.equal(w.chainState.maxChain, 3);
  assert.equal(w.score, 10 + 30 + 60 + 90); assert.equal(w.kills, 10);
  assert.deepEqual(w.chainBeads.map(b => b.sizeIndex), [1, 2]); near(w.chainBeads[0].chainS, tail);
  assert.ok(w.chainState.headDistance < head);
  assert.deepEqual(w.events.filter(e => e.type === 'campaignChainMatch').map(e => [e.level, e.count, e.value]), [[1, 3, 30], [2, 3, 60], [3, 3, 90]]);
  w.rules.onAfterTick(); assert.equal(w.score, 190);
  w.rules.onTick(60); w.rules.onAfterTick(); w.checkOutcome();
  assert.equal(w.completed, true); assert.equal(w.resultRating, 3);
});

test('natural tail space feeds more beads than the initial chain without an extra stacking timer', () => {
  const w = fresh(0, 390, 844, 'growth', () => .1), first = w.chainBeads[0], start = first.chainS;
  const initial = w.chainState.spawned;
  seconds(w, .5); assert.equal(w.chainState.spawned, initial);
  assert.ok(w.chainBeads[0].chainS > start);
  for (let frame = 0; frame < 700 && w.chainState.spawned === initial; frame++) tick(w);
  assert.equal(w.chainState.spawned, initial + 1);
  const [newTail, oldTail] = w.chainBeads;
  assert.equal(oldTail.id, first.id); assert.ok(newTail.chainS >= 0);
  near(Math.hypot(newTail.x - oldTail.x, newTail.y - oldTail.y), newTail.r + oldTail.r);
  assert.equal(chainMatches(w.chainBeads).length, 0);
});

test('clearing the complete logical chain emits one peak and admits the next bead after the documented .6 world seconds', () => {
  const w = fresh(0, 390, 844, 'growth', () => .1); w.shoot(0, w.maxPull);
  for (const b of [...visible(w)]) hit(w, b); w.rules.onAfterTick();
  assert.equal(w.chainBeads.length, 0); assert.equal(w.chainState.cleared, 12);
  assert.equal(w.events.filter(e => e.type === 'campaignChainClear').length, 1);
  w.rules.onAfterTick(); assert.equal(w.events.filter(e => e.type === 'campaignChainClear').length, 1);
  w.rules.onTick(.59); w.rules.onAfterTick(); assert.equal(w.chainBeads.length, 0);
  w.rules.onTick(.01); w.rules.onAfterTick(); assert.equal(w.chainBeads.length, 1); near(w.chainBeads[0].chainS, 0);
  assert.equal(w.chainState.spawned, 13);
});

test('positive and negative direct impulses use visible mass only, and density changes actual momentum by its mass gain', () => {
  for (const direction of [-1, 1]) {
    const values = [];
    for (const upgrade of ['growth', 'density']) {
      const w = fresh(9, 568, 320, upgrade, () => .1), bead = visible(w)[2];
      const totalMass = visible(w).reduce((sum, b) => sum + b.mass, 0);
      const logicalMass = w.chainBeads.reduce((sum, b) => sum + b.mass, 0);
      assert.ok(logicalMass > totalMass);
      w.shoot(0, w.maxPull * .1); const speed = w.baseSpeed * .1 / Math.sqrt(w.density);
      hit(w, bead, {tangent: direction, speed});
      const expected = Math.max(-4, Math.min(4, w.player.mass * direction * speed / totalMass / w.unit));
      near(w.chainState.inertia, expected); values.push(w.chainState.inertia);
    }
    assert.ok(Math.abs(values[1]) > Math.abs(values[0])); near(values[1] / values[0], Math.sqrt(1.35));
  }
});

test('gravity projects its 5u force onto the rail in both directions and keeps every live bead tangent', () => {
  for (const direction of [-1, 1]) {
    const w = fresh(3, 390, 844, 'gravity', () => .1), bead = direction > 0 ? visible(w).at(-1) : visible(w)[0];
    const tx = -Math.sin(bead.angle), ty = Math.cos(bead.angle);
    Object.assign(w.player, {x: bead.x - Math.cos(bead.angle) * 2.1 * w.unit + tx * direction * 1.5 * w.unit,
      y: bead.y - Math.sin(bead.angle) * 2.1 * w.unit + ty * direction * 1.5 * w.unit});
    const totalMass = visible(w).reduce((sum, b) => sum + b.mass, 0);
    let acceleration = 0;
    for (const b of visible(w)) {
      const dx = w.player.x - b.x, dy = w.player.y - b.y, distance = Math.hypot(dx, dy);
      if (distance < 1e-8 || distance > 5 * w.unit) continue;
      acceleration += 2.4 * w.unit * (-Math.sin(b.angle) * dx + Math.cos(b.angle) * dy) / distance * b.mass / totalMass;
    }
    w.rules.onTick(.2);
    near(w.chainState.inertia, acceleration * (1 - Math.exp(-1.2 * .2)) / 1.2 / w.unit);
    assert.ok(w.chainState.inertia * direction > 0);
    for (const b of visible(w)) near(Math.hypot(b.x - w.chainTrack.cx, b.y - w.chainTrack.cy), w.chainTrack.radius);
  }
});

test('pulse applies real fractional damage and a stable visible-mass tangent impulse without hitting queued beads', () => {
  const w = fresh(9, 568, 320, 'pulse', () => .1), origin = visible(w).at(-1);
  w.shoot(0, w.maxPull);
  const remaining = visible(w).filter(b => b !== origin), totalMass = remaining.reduce((sum, b) => sum + b.mass, 0);
  let expected = 0;
  const neighbors = remaining.filter(b => Math.hypot(b.x - origin.x, b.y - origin.y) < 4 * w.unit);
  for (const b of neighbors) {
    const distance = Math.hypot(b.x - origin.x, b.y - origin.y), nx = (b.x - origin.x) / distance, ny = (b.y - origin.y) / distance;
    expected += b.mass / totalMass * 4 * (-Math.sin(b.angle) * nx + Math.cos(b.angle) * ny);
  }
  hit(w, origin); near(w.chainState.inertia, expected); assert.ok(Math.abs(expected) > .01);
  for (const b of neighbors) near(b.hp, .7);
  for (const b of w.chainBeads.filter(b => b.active === false && !b.dead)) near(b.hp, 1);
  assert.equal(w.events.filter(e => e.type === 'pulse').length, 1);
  assert.equal(w.chainState.cleared, 1);
});

test('idle, active and late-time rotations preserve head progress, queue contents and the true closed central play area', () => {
  for (const [width, height] of [[390, 844], [844, 390], [320, 568], [568, 320]]) for (const upgrade of ['growth', 'density', 'gravity', 'pulse']) {
    const w = fresh(9, width, height, upgrade); w.shoot(w.maxPull, 0); seconds(w, .1);
    const clock = w.chainClock, progress = w.chainState.headProgress, removed = w.chainState.cleared;
    const saved = w.chainBeads.map(b => [b.id, b.hp, b.sizeIndex]), score = w.score;
    w.resize(height, width);
    near(w.chainClock, clock); near(w.chainState.headProgress, progress); assert.equal(w.chainState.cleared, removed);
    assert.equal(w.score, score); assert.deepEqual(w.chainBeads.map(b => [b.id, b.hp, b.sizeIndex]), saved);
    const track = w.chainTrack;
    assert.ok(Math.hypot(w.player.x - track.cx, w.player.y - track.cy) + w.player.r <= track.radius - track.width / 2 + 1e-5);
    assert.ok(w.player.y + w.player.r <= track.start.y - track.width / 2 + 1e-5);
    const balls = visible(w); for (let i = 1; i < balls.length; i++)
      near(Math.hypot(balls[i].x - balls[i - 1].x, balls[i].y - balls[i - 1].y), balls[i].r + balls[i - 1].r);
    w.endLaunch(); w.resize(width, height); near(w.chainClock, clock); near(w.chainState.headProgress, progress);
  }
});

test('high-speed real shots remain inside the arc and chord and genuinely knock out visible pearls', () => {
  for (const angle of [-Math.PI / 2, Math.PI / 2, 0, Math.PI]) {
    const w = fresh(9, 568, 320, 'growth');
    w.shoot(-Math.cos(angle) * w.maxPull, -Math.sin(angle) * w.maxPull);
    for (let frame = 0; frame < 240 && w.phase === 'battle'; frame++) {
      tick(w); const t = w.chainTrack;
      assert.ok(Math.hypot(w.player.x - t.cx, w.player.y - t.cy) + w.player.r <= t.radius - t.width / 2 + 1e-5);
      assert.ok(w.player.y + w.player.r <= t.start.y - t.width / 2 + 1e-5);
      assert.ok([w.player.x, w.player.y, w.player.vx, w.player.vy].every(Number.isFinite));
    }
    if (angle !== Math.PI / 2) assert.ok(w.chainState.cleared > 0);
  }
});

function play(w) {
  let maxLogical = 0, maxVisible = 0;
  for (let frame = 0; frame < 20000 && w.phase === 'battle'; frame++) {
    if (w.ready) {
      const target = visible(w).at(-1);
      if (target) {
        const distance = Math.hypot(target.x - w.player.x, target.y - w.player.y), arrival = distance / w.baseSpeed;
        const predicted = target.angle + w.config.advanceSpeed * w.unit * arrival / w.chainTrack.radius;
        const x = w.chainTrack.cx + Math.cos(predicted) * w.chainTrack.radius;
        const y = w.chainTrack.cy + Math.sin(predicted) * w.chainTrack.radius;
        const angle = Math.atan2(y - w.player.y, x - w.player.x);
        assert.equal(w.shoot(-Math.cos(angle) * w.maxPull, -Math.sin(angle) * w.maxPull), true);
      }
    }
    tick(w); maxLogical = Math.max(maxLogical, w.chainBeads.length); maxVisible = Math.max(maxVisible, visible(w).length);
    assert.ok(Number.isFinite(w.chainState.inertia));
  }
  return {maxLogical, maxVisible};
}

test('eighty complete normal-feedback shoot/120Hz routes win all tiers in both orientations with every legitimate upgrade', () => {
  for (const [width, height] of [[390, 844], [844, 390]]) for (const upgrade of ['gravity', 'density', 'growth', 'pulse']) for (let k = 0; k < 10; k++) {
    const w = fresh(k, width, height, upgrade), peak = play(w);
    assert.equal(w.completed, true, `${width}×${height} k${k} ${upgrade}`);
    assert.ok(w.chainState.cleared >= w.config.goal || Math.abs(w.chainClock - 60) < 1e-7);
    assert.ok(w.chainClock <= 60); assert.equal(w.remaining, 60 - w.chainClock);
    assert.ok(w.shotsUsed > 0); assert.ok(w.resultRating >= 1 && w.resultRating <= 3);
    assert.ok(peak.maxLogical <= 45); assert.ok(peak.maxVisible <= 45);
    assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
    seconds(w, 2); assert.equal(w.phase, 'over'); assert.equal(w.events.filter(e => e.type === 'over').length, 1);
  }
});

test('twenty compact-phone public trajectories also win without changing the physical pearl radii or queued count', () => {
  for (const [width, height] of [[320, 568], [568, 320]]) for (let k = 0; k < 10; k++) {
    const w = fresh(k, width, height, 'growth'); play(w);
    assert.equal(w.completed, true, `${width}×${height} k${k}`);
    for (const b of w.chainBeads) near(b.r, w.config.sizes[b.sizeIndex] * w.unit);
  }
});

test('a real target win freezes surviving pearls and their collision velocities throughout celebration and rotation', () => {
  const w = fresh(0, 390, 844, 'pulse', random(123)); play(w);
  assert.equal(w.completed, true); assert.ok(w.chainBeads.length > 0);
  const positions = w.chainBeads.map(b => [b.id, b.x, b.y]);
  for (const b of w.chainBeads) { near(b.vx, 0); near(b.vy, 0); }
  seconds(w, .1); assert.deepEqual(w.chainBeads.map(b => [b.id, b.x, b.y]), positions);
  w.resize(844, 390);
  for (const b of w.chainBeads) { near(b.vx, 0); near(b.vy, 0); }
  const rotated = w.chainBeads.map(b => [b.id, b.x, b.y]); seconds(w, .1);
  assert.deepEqual(w.chainBeads.map(b => [b.id, b.x, b.y]), rotated);
  assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
});

test('a real survivor reaches exactly sixty world seconds, and twenty idle runs genuinely reach the hole and fail', () => {
  const survivor = fresh(4, 390, 844, 'growth'); play(survivor);
  assert.equal(survivor.completed, true); near(survivor.chainClock, 60); assert.ok(survivor.chainState.cleared < survivor.config.goal);
  for (const [width, height] of [[390, 844], [844, 390]]) for (let k = 0; k < 10; k++) {
    const w = fresh(k, width, height);
    for (let frame = 0; frame < 7201 && w.phase === 'battle'; frame++) tick(w);
    assert.equal(w.phase, 'over'); assert.equal(w.completed, false); assert.equal(w.shotsUsed, 0);
    assert.ok(w.chainState.headDistance >= w.chainTrack.length - 1e-8);
    assert.equal(w.resultRating, 0); assert.equal(w.score, 0); assert.equal(w.events.filter(e => e.type === 'over').length, 1);
  }
});

test('pause, real-time slow stepping and the final fractional second never consume a launch or fabricate a result', () => {
  const w = fresh(0, 390, 844, 'growth', () => .1), state = structuredClone(w.chainState);
  w.step(0); w.step(-1); assert.deepEqual(w.chainState, state);
  w.step(.25, false, {timeScale: .25}); near(w.chainClock, .25); near(w.elapsed, 1);
  // A deadline fixture clears the actual initial chain before checking the
  // fractional-time resource; it is not counted as a playability replay.
  w.rules.onTick(59.999 - w.chainClock); w.shotActive = true;
  for (const b of [...visible(w)]) hit(w, b); w.rules.onAfterTick(); w.endLaunch();
  assert.equal(w.phase, 'battle'); assert.equal(w.ready, true); assert.ok(w.remaining > 0 && w.remaining < .01);
  assert.equal(w.shoot(0, w.maxPull), true); w.step(.1); near(w.chainClock, 60);
  assert.equal(w.completed, true); assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
});
