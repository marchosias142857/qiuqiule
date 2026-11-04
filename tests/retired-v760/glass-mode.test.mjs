import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, levelConfig, campaignUpgradePool} from '../dist/campaign.js';
import {glassParams} from '../dist/classes/glass.js';

const fresh = (k = 0, width = 390, height = 844, upgradeId = 'split') =>
  new CampaignWorld(width, height, 7 + k * 10, () => .5, {upgradeId}).setFeedbackOptions({strength: .6});
const live = w => w.statics.filter(s => s.kind === 'glass' && s.active !== false && !s.dead);
const tick = w => { const scale = w.presentationTimeScale; w.step(scale / 120, false, {timeScale: scale}); };
const seconds = (w, value) => { for (let i = 0; i < Math.ceil(value * 120); i++) tick(w); };
const near = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);
function shoot(w, angle, power = 1) {
  assert.equal(w.shoot(-Math.cos(angle) * w.maxPull * power, -Math.sin(angle) * w.maxPull * power), true);
}
function contact(w, glass, actor = w.player, extra = {}) {
  return {attacker: actor, impactVx: 0, impactVy: -20 * w.unit, impactSpeed: 20 * w.unit,
    normalSpeed: 20 * w.unit, nx: 0, ny: -1, contactX: glass.x, contactY: glass.y + glass.r, ...extra};
}
// Isolated rule fixtures below exercise exact thresholds. Complete playability
// replays at the end use only public shoot/step calls and unmodified bodies.
function fixtureKills(w, count) {
  for (let i = 0; i < count; i++) {
    const glass = w.addStatic({kind: 'glass', shape: 'circle', x: w.glassBoard.centre, y: w.glassBoard.top,
      r: .8 * w.unit, hp: 1, maxHp: 1, restitution: .95});
    w.hitStatic(glass, 1, contact(w, glass));
  }
}
function fixtureMisses(w, count) {
  for (let i = 0; i < count; i++) {
    if (!live(w).length) w.rules.onTick(w.config.rowGap / w.config.fallSpeed + 1e-6);
    const glass = live(w)[0]; glass.y = w.glassBoard.bottom - glass.r + .01;
    w.rules.onAfterTick();
  }
}

test('all ten glass tiers use the PDF speed, row gap, 60-second deadline and reconciled miss budget', () => {
  for (let k = 0; k < 10; k++) {
    const p = glassParams(k), w = fresh(k), config = levelConfig(7 + k * 10);
    assert.equal(config.classId, 'glass'); assert.equal(config.implemented, true); assert.equal(config.k, k);
    assert.equal(p.duration, 60); assert.equal(p.fallSpeed, .9 + .1 * k); assert.equal(p.rowGap, 3 - .067 * k);
    assert.equal(p.budget, 5 - Math.floor(k / 4)); assert.equal(p.budgetKind, 'misses');
    assert.equal(p.glassRadius, .8); assert.equal(p.glassHp, 1); assert.equal(p.finalSpeed, 1.4);
    assert.equal(w.remaining, p.budget); assert.equal(w.glassState.remainingTime, 60);
    assert.equal(live(w).length, k < 6 ? 2 : 3); assert.ok(live(w).every(g => g.hp === 1 && g.r === .8 * w.unit));
    assert.deepEqual(campaignUpgradePool(w.level).map(u => u.id), ['split', 'energy', 'breath', 'pulse']);
    assert.equal(w.rules.rating(), 0); assert.equal(w.percent, 0);
  }
  assert.equal(glassParams(3).budget, 5, 'the formula, not the inconsistent printed k3 example');
});

test('initial and repeated rows keep exact counts, safe physical spacing and a visible bottom line in five layouts', () => {
  for (const [width, height] of [[390, 844], [844, 390], [320, 568], [568, 320], [1280, 720]]) for (let k = 0; k < 10; k++) {
    const w = fresh(k, width, height), first = live(w), b = w.arenaBounds;
    assert.equal(w.zones[0].kind, 'glass-bottom'); assert.equal(w.zones[0].visualY, w.glassBoard.bottom);
    near(w.player.x, w.glassBoard.start.x); near(w.player.y, w.glassBoard.start.y);
    for (let row = 0; row < 5; row++) {
      if (row) w.rules.onTick(w.config.rowGap / w.config.fallSpeed + 1e-8);
      const current = live(w).filter(g => g.row === row);
      assert.equal(current.length, k < 3 ? 2 : k < 6 ? 2 + row % 2 : 3);
      for (let i = 0; i < current.length; i++) {
        const g = current[i]; assert.ok(g.x - g.r >= b.left && g.x + g.r <= b.right);
        assert.ok(g.y - g.r >= (height > 520 ? 112 : 76));
        for (const other of current.slice(i + 1)) assert.ok(Math.hypot(g.x - other.x, g.y - other.y) > g.r + other.r);
      }
    }
    assert.equal(w.glassState.spawnedRows, 5); assert.ok(first.every(g => g.vy > 0));
  }
});

test('world-time speed and spacing accelerate exactly once at 45 seconds without using presentation real time', () => {
  const w = fresh(9), glass = live(w)[0], start = glass.y;
  w.rules.onTick(44.99); const before = glass.y;
  near(before - start, 44.99 * w.config.fallSpeed * w.unit);
  w.rules.onTick(.02);
  near(glass.y - before, .01 * w.config.fallSpeed * w.unit * 2.4);
  near(glass.vy, w.config.fallSpeed * w.unit * 1.4);
  assert.equal(w.events.filter(e => e.type === 'campaignGlassRush').length, 1);
  w.rules.onTick(.1); assert.equal(w.events.filter(e => e.type === 'campaignGlassRush').length, 1);
  const paused = structuredClone(w.glassState); w.step(0); w.step(-1); assert.deepEqual(w.glassState, paused);
  const slow = fresh(0), initial = slow.glassClock;
  slow.step(.25, false, {timeScale: .25}); near(slow.glassClock - initial, .25); near(slow.elapsed, 1);
});

test('breath changes only generation during its 1.5-second window, never conveyor speed', () => {
  const w = fresh(0, 390, 844, 'breath'); shoot(w, -Math.PI / 2);
  const hit = live(w)[0], remaining = live(w)[1]; w.rules.onStaticHit(hit, contact(w, hit));
  near(w.glassState.breathRemaining, 1.5);
  const y = remaining.y, distance = w.glassState.spawnDistance;
  w.rules.onTick(1.5);
  near(remaining.y - y, 1.5 * w.config.fallSpeed * w.unit);
  near(w.glassState.spawnDistance - distance, 1.5 * w.config.fallSpeed * 2 / 3);
  near(w.glassState.breathRemaining, 0); const after = w.glassState.spawnDistance;
  w.rules.onTick(.2); near(w.glassState.spawnDistance - after, .2 * w.config.fallSpeed);
});

test('a destroyed glass retains incoming trajectory, while fractional auxiliary and pulse damage leave surviving glass reflective', () => {
  const w = fresh(0, 390, 844, 'pulse'); shoot(w, -Math.PI / 2);
  const [first, second] = live(w); Object.assign(w.player, {vx: 7, vy: 12});
  w.rules.onStaticHit(first, contact(w, first, w.player, {impactVx: 3 * w.unit, impactVy: -20 * w.unit}));
  assert.equal(first.dead, true); near(w.player.vx, 3 * w.unit); near(w.player.vy, -20 * w.unit);
  near(second.hp, .7); assert.equal(second.dead, undefined);
  assert.equal(w.events.filter(e => e.type === 'pulse').length, 1);
  const auxiliary = w.makeBody(0, 0, .7 * w.unit, 1); Object.assign(auxiliary, {isPlayer: true, isAuxiliary: true, damageScale: .6, vx: 4, vy: 5});
  w.rules.onStaticHit(second, contact(w, second, auxiliary)); near(second.hp, .1);
  near(auxiliary.vx, 4); near(auxiliary.vy, 5, 1e-8);
  w.rules.onStaticHit(second, contact(w, second, auxiliary)); assert.equal(second.hp, 0);
  near(auxiliary.vy, -20 * w.unit); assert.equal(w.glassState.kills, 2);
});

test('five and ten consecutive kills grant next-launch full-power extra balls, while a miss resets the next launch to one', () => {
  const w = fresh(); shoot(w, -Math.PI / 2); fixtureKills(w, 5);
  assert.equal(w.glassState.nextBalls, 2); assert.equal(w.auxiliaries.filter(b => b.glassAuxiliary).length, 0);
  w.endLaunch(); assert.equal(w.ready, false); seconds(w, .4); shoot(w, -Math.PI / 2);
  let earned = w.auxiliaries.filter(b => b.glassAuxiliary);
  assert.equal(earned.length, 1); assert.equal(earned[0].damageScale, 1); assert.equal(earned[0].r, .7 * w.unit);
  near(Math.hypot(earned[0].vx, earned[0].vy), Math.hypot(w.player.vx, w.player.vy));
  assert.ok(Math.hypot(earned[0].vx, earned[0].vy) > 0, 'default-feedback launch freeze retains real launch speed');
  assert.equal(earned[0].feedbackFreeze, w.player.feedbackFreeze);
  fixtureKills(w, 5); assert.equal(w.glassState.nextBalls, 3);
  assert.ok(w.auxiliaries.length <= 4, 'at most three earned balls plus two split children');
  w.endLaunch(); seconds(w, .4); shoot(w, -Math.PI / 2);
  earned = w.auxiliaries.filter(b => b.glassAuxiliary); assert.equal(earned.length, 2);
  fixtureMisses(w, 1); assert.equal(w.glassState.streak, 0); assert.equal(w.glassState.nextBalls, 1);
  assert.equal(earned.length, 2, 'an already fired fan is not deleted when a miss happens');
  w.endLaunch(); seconds(w, .4); shoot(w, -Math.PI / 2); assert.equal(w.auxiliaries.length, 0);
});

test('split first kills add exactly two .6-speed .6-damage auxiliaries within the five-ball cap', () => {
  const w = fresh(), start = w.player; shoot(w, -Math.PI / 2); const g = live(w)[0], impact = contact(w, g);
  w.rules.onStaticHit(g, impact);
  const children = w.auxiliaries.filter(b => b.campaignSplit); assert.equal(children.length, 2);
  for (const child of children) { assert.equal(child.damageScale, .6); assert.equal(child.r, .7 * w.unit); near(Math.hypot(child.vx, child.vy), impact.impactSpeed * .6); }
  fixtureKills(w, 10); assert.equal(w.auxiliaries.filter(b => b.campaignSplit).length, 2);
  w.endLaunch(); seconds(w, .4); shoot(w, -Math.PI / 2); fixtureKills(w, 1);
  assert.equal(w.auxiliaries.length, 4); assert.equal(w.player, start);
});

test('the .4-second return locks launches, preserves conveyor time, and keeps the same deadline when reduced motion is enabled', () => {
  for (const reducedMotion of [false, true]) {
    const w = fresh().setFeedbackOptions({strength: .6, reducedMotion}); shoot(w, -Math.PI / 2);
    seconds(w, .4); const from = {x: w.player.x, y: w.player.y}, before = w.glassClock;
    w.endLaunch(); assert.equal(w.ready, false); assert.equal(w.shoot(0, w.maxPull), false);
    const returning = w.glassReturn; assert.equal(returning.duration, .4);
    if (reducedMotion) near(w.player.y, w.glassBoard.start.y); else near(w.player.y, from.y);
    seconds(w, .2); assert.equal(w.ready, false); assert.ok(w.glassReturn);
    const paused = {...w.glassReturn}; w.step(0); assert.deepEqual(w.glassReturn, paused);
    seconds(w, .2); assert.equal(w.glassReturn, null); assert.equal(w.ready, true);
    near(w.glassClock - before, .4); near(w.player.x, w.glassBoard.start.x); near(w.player.y, w.glassBoard.start.y);
  }
});

test('idle, mid-flight and mid-return rotations retain clock, resources and exact glass progress toward its own bottom edge', () => {
  for (const [width, height] of [[390, 844], [844, 390], [320, 568], [568, 320]]) {
    const w = fresh(9, width, height); w.resize(height, width);
    near(w.player.x, w.glassBoard.start.x); near(w.player.y, w.glassBoard.start.y);
    shoot(w, -Math.PI / 2); seconds(w, .3);
    const clock = w.glassClock, misses = w.glassMisses, shots = w.shotsUsed;
    const glass = live(w)[0], progress = (glass.y - w.glassBoard.top) / (w.glassBoard.bottom - glass.r - w.glassBoard.top);
    w.resize(width, height); near(w.glassClock, clock); assert.equal(w.glassMisses, misses); assert.equal(w.shotsUsed, shots);
    near((glass.y - w.glassBoard.top) / (w.glassBoard.bottom - glass.r - w.glassBoard.top), progress);
    w.endLaunch(); seconds(w, .15); const returnElapsed = w.glassReturn.elapsed;
    w.resize(height, width); near(w.glassReturn.elapsed, returnElapsed); seconds(w, .25);
    assert.equal(w.glassReturn, null); near(w.player.x, w.glassBoard.start.x); near(w.player.y, w.glassBoard.start.y);
    w.resize(width, height); near(w.player.x, w.glassBoard.start.x); near(w.player.y, w.glassBoard.start.y);
  }
});

test('congested conveyor rotations separate whole rows horizontally and keep subsequent generated rows disjoint', () => {
  let checked = 0, generatedAfterRotation = 0;
  const disjoint = w => {
    const glasses = live(w);
    for (let i = 0; i < glasses.length; i++) for (let j = i + 1; j < glasses.length; j++) {
      const a = glasses[i], b = glasses[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - 1e-6,
        `${w.width}×${w.height} k${w.config.k} rows ${a.row}/${b.row}`);
    }
    for (const glass of glasses) {
      assert.ok(glass.x - glass.r >= w.arenaBounds.left && glass.x + glass.r <= w.arenaBounds.right);
      for (const other of glasses.filter(g => g.row === glass.row)) near(glass.y, other.y);
    }
  };
  for (const [width, height] of [[390, 844], [320, 568], [844, 390], [568, 320]]) for (let k = 0; k < 10; k++) for (const idle of [5, 12, 15]) {
    const w = fresh(k, width, height); seconds(w, idle); if (w.phase !== 'battle') continue;
    const clock = w.glassClock, misses = w.glassMisses, hp = live(w).map(g => [g.id, g.hp]);
    const progress = new Map(live(w).map(g => [g.id, (g.y - w.glassBoard.top) / (w.glassBoard.bottom - g.r - w.glassBoard.top)]));
    w.resize(height, width); checked++;
    near(w.glassClock, clock); assert.equal(w.glassMisses, misses); assert.deepEqual(live(w).map(g => [g.id, g.hp]), hp);
    for (const glass of live(w)) near((glass.y - w.glassBoard.top) / (w.glassBoard.bottom - glass.r - w.glassBoard.top), progress.get(glass.id));
    disjoint(w); const rows = w.glassState.spawnedRows;
    for (let frame = 0; frame < 420 && w.phase === 'battle'; frame++) { tick(w); disjoint(w); }
    if (w.glassState.spawnedRows > rows) generatedAfterRotation++;
  }
  assert.ok(checked >= 75); assert.ok(generatedAfterRotation >= 60);
  const parked = fresh(9), glass = live(parked)[1];
  glass.y = parked.glassBoard.bottom - 1.2 * parked.unit;
  parked.resize(844, 390); near(parked.player.x, parked.glassBoard.start.x); near(parked.player.y, parked.glassBoard.start.y);
  assert.equal(parked.glassMisses, 0, 'the resize itself never counts a bottom entry');
});

test('exactly the miss budget still allows firing and wins at sixty seconds; a same-deadline excess miss loses first', () => {
  for (const excess of [false, true]) {
    const w = fresh(9); fixtureMisses(w, w.config.budget - (excess ? 0 : 1));
    w.checkOutcome(); assert.equal(w.phase, 'battle'); assert.equal(w.ready, true);
    if (excess) { assert.equal(w.remaining, 0); shoot(w, -Math.PI / 2); w.endLaunch(); seconds(w, .4); }
    w.rules.onTick(59.999 - w.glassClock);
    const last = live(w).at(-1); for (const glass of live(w)) glass.active = false;
    last.active = true; last.y = w.glassBoard.bottom - last.r - w.config.fallSpeed * w.unit * 1.4 * .0005;
    w.step(.1); near(w.glassClock, 60); assert.equal(w.glassMisses, w.config.budget + (excess ? 1 : 0));
    assert.equal(w.completed, !excess); assert.equal(w.phase, excess ? 'over' : 'campaign-celebrate');
    assert.equal(w.events.filter(e => e.type === 'campaignGlassMiss').length, w.glassMisses);
    seconds(w, 2); assert.equal(w.phase, 'over'); assert.equal(w.events.filter(e => e.type === 'over').length, 1);
  }
});

test('all ten difficulty tiers award 3/2/1 points for zero/one/two misses without manufacturing old scores', () => {
  for (let k = 0; k < 10; k++) for (const misses of [0, 1, 2]) {
    const w = fresh(k); fixtureMisses(w, misses);
    w.rules.onTick(60 - w.glassClock); for (const glass of live(w)) glass.active = false;
    w.rules.onAfterTick(); w.checkOutcome(); assert.equal(w.completed, true);
    assert.equal(w.resultRating, misses === 0 ? 3 : misses === 1 ? 2 : 1);
    assert.equal(w.resultSummary, `漏 ${misses} 颗`); assert.equal(w.percent, 100);
  }
});

function play(w) {
  let maximumBodies = 0, maximumTargets = 0;
  for (let frame = 0; frame < 20000 && w.phase === 'battle'; frame++) {
    if (w.ready) {
      let angle = -Math.PI / 2 - Math.PI / 72, power = 1;
      if (w.width < w.height) {
        const target = live(w).sort((a, b) => b.y - a.y)[0];
        if (target) {
          const distance = Math.hypot(target.x - w.player.x, target.y - w.player.y);
          const arrival = distance / (w.baseSpeed * Math.sqrt(w.energy / w.density) + target.vy);
          angle = Math.atan2(target.y + target.vy * arrival - w.player.y, target.x - w.player.x);
        }
      } else if (w.height <= 320) { angle = -Math.PI / 2 - Math.PI / 90; power = .75; }
      shoot(w, angle, power);
    }
    tick(w); maximumBodies = Math.max(maximumBodies, 1 + w.auxiliaries.length);
    maximumTargets = Math.max(maximumTargets, live(w).length);
    for (const body of [w.player, ...w.auxiliaries, ...w.statics]) assert.ok([body.x, body.y, body.vx, body.vy].every(Number.isFinite));
  }
  return {maximumBodies, maximumTargets};
}
test('forty complete public shoot/120Hz replays survive every tier and four phone layouts at default feedback', () => {
  for (const [width, height] of [[390, 844], [844, 390], [320, 568], [568, 320]]) for (let k = 0; k < 10; k++) {
    const w = fresh(k, width, height), performance = play(w);
    assert.equal(w.completed, true, `${width}×${height} tier ${k}`); near(w.glassClock, 60);
    assert.ok(w.glassMisses <= w.config.budget); assert.ok(w.shotsUsed > 5 && w.shotsUsed <= 20);
    assert.ok(w.glassState.kills > 0); assert.equal(w.score, w.glassState.kills * 10);
    assert.ok(performance.maximumBodies <= 5); assert.ok(performance.maximumTargets <= 60);
    assert.equal(w.events.filter(e => e.type === 'campaignGlassRush').length, 1);
    assert.ok(w.events.some(e => e.type === 'campaignGlassMulti' && e.count === 3));
    assert.equal(w.events.filter(e => e.type === 'campaignPeak').length, 1);
    seconds(w, 2); assert.equal(w.phase, 'over'); assert.equal(w.events.filter(e => e.type === 'over').length, 1);
  }
});

test('all four real upgrade choices can finish the first glass level in portrait and landscape', () => {
  for (const [width, height] of [[390, 844], [844, 390]]) for (const upgrade of ['split', 'energy', 'breath', 'pulse']) {
    const w = fresh(0, width, height, upgrade); play(w);
    assert.equal(w.completed, true, `${width}×${height} ${upgrade}`); near(w.glassClock, 60);
    assert.equal(w.remaining, w.config.budget - w.glassMisses);
  }
});

test('twenty ordinary idle runs really lose only after budget-plus-one glass entries, with every miss counted once', () => {
  for (const [width, height] of [[390, 844], [844, 390]]) for (let k = 0; k < 10; k++) {
    const w = fresh(k, width, height);
    for (let frame = 0; frame < 7201 && w.phase === 'battle'; frame++) tick(w);
    assert.equal(w.phase, 'over'); assert.equal(w.completed, false); assert.ok(w.glassMisses > w.config.budget);
    assert.equal(w.shotsUsed, 0); assert.equal(w.score, 0); assert.equal(w.resultRating, 0);
    const misses = w.events.filter(e => e.type === 'campaignGlassMiss');
    assert.equal(misses.length, w.glassMisses); assert.equal(new Set(misses.map(e => e.bodyId)).size, misses.length);
    assert.equal(w.events.filter(e => e.type === 'over').length, 1);
  }
});
