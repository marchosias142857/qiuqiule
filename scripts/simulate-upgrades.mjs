// Task 5 audit: real reward transitions plus seeded combat with upgrade builds.
// Usage: node scripts/simulate-upgrades.mjs [seed-count=3] [seconds-per-run=18]
// The reward audit deliberately enters each reward phase without playing its
// preceding stage. The combat audit uses real shots, collisions and spawning;
// it never injects damage, kills or stage progression during a run.
// Builds are controlled starting fixtures, not human acquisition histories.
// Results establish mechanics and integration, not fun, balance, retention,
// phone rendering performance, audio quality, or touch-input quality.

import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {World, length} from '../dist/physics.js';
import {ENEMY_TYPES} from '../dist/enemies.js';
import {UPGRADE_DEFINITIONS, eligibleUpgrades} from '../dist/upgrades.js';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/simulate-upgrades.mjs [seed-count=3] [seconds-per-run=18]\n'
    + 'Default: 6 complete reward-pool lifecycles and 30 real combat runs.\n'
    + 'Extended: node scripts/simulate-upgrades.mjs 10 35\n'
    + 'seed-count: integer 1..100; duration: number 5..300 seconds.');
  process.exit(0);
}
const seedCount = Number(args[0] ?? 3), duration = Number(args[1] ?? 18);
if (args.length > 2 || !Number.isInteger(seedCount) || seedCount < 1 || seedCount > 100
  || !Number.isFinite(duration) || duration < 5 || duration > 300) {
  console.error('Invalid arguments; run with --help.'); process.exit(1);
}
const rng = seed => () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-7, `${message}: ${a} != ${b}`);
const expectedLayers = 33, viewports = [[390, 844], [844, 390]];
const maxed = Object.fromEntries(UPGRADE_DEFINITIONS.map(entry => [entry.id, entry.maxStacks]));
const totalLayers = w => Object.values(w.buffs).reduce((sum, count) => sum + count, 0);

function advanceUntil(w, predicate, seconds = 4) {
  let frames = 0;
  while (!predicate() && frames < seconds * 120) { w.step(1 / 120); frames++; }
  assert.ok(predicate(), `transition stuck in ${w.phase} at stage ${w.stage}`);
}

function rewardLifecycle(seed, width, height) {
  const w = new World(width, height, rng(seed), {spawnInitial: false}), decision = rng(seed + 9001);
  let previousGambler = false, fiveChoiceOffers = 0, acquired = 0;
  const offers = [];
  for (let round = 0; round <= expectedLayers; round++) {
    w.phase = 'battle'; w.enemies = []; w.spawnTimer = w.floorTimer = w.introTimer = Infinity;
    const beforeStage = w.stage, beforeCount = totalLayers(w), available = eligibleUpgrades({counts: w.buffs});
    w.upgradeContext = w.captureUpgradeContext();
    w.rewardSelectionsRemaining = w.upgradeRoundTotal = 1; w.upgradeRound = 0; w.startingUpgrades = false;
    w.offerUpgradeRound();
    if (!available.length) {
      assert.equal(acquired, expectedLayers); assert.deepEqual(w.buffs, maxed);
      assert.equal(w.phase, 'reward'); assert.equal(w.choices.length, 0);
      advanceUntil(w, () => w.phase === 'battle');
      assert.equal(w.stage, beforeStage + 1); assert.equal(totalLayers(w), beforeCount);
      return {acquired, fiveChoiceOffers, emptyPoolContinues: true, offers};
    }
    const expected = Math.min(previousGambler ? 5 : 3, available.length);
    assert.equal(w.choices.length, expected);
    if (w.choices.length === 5) fiveChoiceOffers++;
    const offered = w.choices.map(c => c.id); offers.push(offered);
    assert.equal(new Set(offered).size, offered.length);
    assert.ok(offered.every(id => available.some(c => c.id === id)));
    advanceUntil(w, () => w.phase === 'choose');
    for (const c of w.choices) assert.ok(Math.hypot(c.x - w.player.x, c.y - w.player.y) > c.r + w.player.r,
      `reward overlaps player at ${width}x${height}`);
    const choice = w.choices[Math.floor(decision() * w.choices.length)];
    assert.equal(w.choose(choice), true); acquired++; assert.equal(totalLayers(w), beforeCount + 1);
    previousGambler = choice.id === 'gambler';
    advanceUntil(w, () => w.phase === 'battle');
    assert.equal(w.stage, beforeStage + 1);
    assert.equal(w.killTarget, (14 + 4 * (w.stage - 1)) * (previousGambler ? 1.5 : 1));
    near(w.energy, 1.3 ** (w.buffs.energy || 0), 'fixed energy layers');
    near(w.density, 1.35 ** (w.buffs.density || 0), 'fixed density layers');
    w.events.length = 0;
  }
  assert.fail('upgrade pool did not exhaust after all 33 legitimate acquisitions');
}

const builds = {
  baseline: {},
  mobility: {energy: 4, overspeed: 2, rubber: 4, pierce: 1, penetration: 1, boomerang: 1},
  area: {energy: 4, density: 2, growth: 2, magnet: 2, pulse: 1, gravity: 1, split: 1, shockwave: 1},
  pressure: {energy: 4, rubber: 4, bank: 1, breath: 1, risk: 2, frenzy: 1, gambler: 1},
  all: maxed,
};
const typeCap = stage => stage >= 16 ? 5 : stage >= 10 ? 4 : stage >= 6 ? 3 : stage >= 3 ? 2 : 1;

function combat(seed, width, height, build) {
  const w = new World(width, height, rng(seed), {spawnInitial: false}), setup = builds[build];
  for (const entry of UPGRADE_DEFINITIONS) for (let n = 0; n < (setup[entry.id] || 0); n++) {
    if (entry.id === 'gambler' && w.nextGambler) {
      // Build setup spans the stage boundary required between two wagers.
      w.rewardSelectionsRemaining = 1; w.finishRewardRound();
      assert.equal(w.nextGambler, false); assert.equal(w.gamblerTargetMultiplier, 1.5);
    }
    assert.equal(w.applyUpgrade(entry.id), true, `cannot acquire ${entry.id}`);
  }
  w.enemies = []; // Begin each measured fixture with its own stage's floor.
  w.stage = build === 'all' ? 1 : 8;
  for (const type of Object.keys(ENEMY_TYPES)) w.typeIntroductions[type] = 3;
  w.setFeedbackOptions({strength: .6});
  const events = {}, killSources = {}, spawnKinds = {}, checkpoints = [];
  let ledger = 0, steps = 0, peakPopulation = 0, peakAuxiliaries = 0, peakQueue = 0, peakSpeed = 0, nextShot = .85;
  const emit = w.emit;
  w.emit = function(type, data = {}) {
    events[type] = (events[type] || 0) + 1;
    if (['kill', 'clearKill', 'bossScore', 'bossDefeated'].includes(type)) {
      assert.ok(Number.isInteger(data.value)); ledger += data.value;
    }
    if (type === 'kill') {
      const source = data.auxiliary ? 'auxiliary' : data.source || 'impact';
      killSources[source] = (killSources[source] || 0) + 1;
    }
    if (type === 'spawn') spawnKinds[data.enemyType] = (spawnKinds[data.enemyType] || 0) + 1;
    return emit.call(this, type, data);
  };
  w.fillFloor(); w.spawnTimer = 2 * w.spawnInterval;
  for (let frame = 0; frame < duration * 120 && w.phase !== 'over'; frame++) {
    if (w.phase === 'choose') w.choose(w.choices.find(c => c.id === 'energy') || w.choices[0]);
    if (['battle', 'boss'].includes(w.phase) && frame / 120 >= nextShot) {
      const target = w.phase === 'boss' ? w.boss : w.enemies.filter(b => b.hp > 0 && b.solid)
        .sort((a, b) => Math.hypot(a.x - w.player.x, a.y - w.player.y) - Math.hypot(b.x - w.player.x, b.y - w.player.y))[0];
      if (target) {
        const dx = target.x - w.player.x, dy = target.y - w.player.y, distance = Math.hypot(dx, dy) || 1;
        if (w.shoot(-dx / distance * w.maxPull, -dy / distance * w.maxPull)) nextShot = frame / 120 + .85;
      }
    }
    w.step(1 / 120); steps++;
    peakPopulation = Math.max(peakPopulation, w.liveCount); peakAuxiliaries = Math.max(peakAuxiliaries, w.auxiliaries.length);
    peakQueue = Math.max(peakQueue, w.fragmentQueue.length); peakSpeed = Math.max(peakSpeed, length(w.player) / w.unit);
    assert.ok(w.liveCount <= 28); assert.ok(w.auxiliaries.length <= 2); assert.equal(w.score, ledger);
    const types = new Set([...w.enemies.filter(b => b.hp > 0).map(b => b.enemyType || 'normal'),
      ...(w.wave?.types?.slice(w.wave.index) || []), ...(w.floorCluster?.types?.slice(w.floorCluster.index) || []),
      ...w.fragmentQueue.map(() => 'normal')].map(t => t === 'fragment' ? 'normal' : t));
    if (types.has('split')) types.add('normal'); assert.ok(types.size <= typeCap(w.stage));
    for (const body of [w.player, ...w.auxiliaries, ...w.enemies]) for (const property of ['x', 'y', 'vx', 'vy', 'r', 'mass'])
      assert.ok(Number.isFinite(body[property]), `${build} seed ${seed}: nonfinite ${property}`);
    for (const entry of UPGRADE_DEFINITIONS) assert.ok((w.buffs[entry.id] || 0) <= entry.maxStacks);
    if (frame % 120 === 0) checkpoints.push([w.stage, w.phase, w.score, w.liveCount, w.auxiliaries.length, w.fragmentQueue.length]);
    w.events.length = 0;
  }
  return {steps, stage: w.stage, phase: w.phase, score: w.score, peakPopulation, peakAuxiliaries, peakQueue,
    peakSpeed, events, killSources, spawnKinds, checkpoints,
    bodies: [w.player, ...w.auxiliaries, ...w.enemies].map(b => [b.id, b.x, b.y, b.vx, b.vy, b.hp])};
}

const started = performance.now(), report = {seedCount, secondsPerRun: duration, rewardRuns: 0, acquisitions: 0,
  fiveChoiceOffers: 0, emptyPoolContinuations: 0, combatRuns: 0, steps: 0, builds: {}};
for (const [width, height] of viewports) for (let seed = 1; seed <= seedCount; seed++) {
  const result = rewardLifecycle(seed, width, height);
  report.rewardRuns++; report.acquisitions += result.acquired; report.fiveChoiceOffers += result.fiveChoiceOffers;
  report.emptyPoolContinuations += Number(result.emptyPoolContinues);
  if (seed === 1) assert.deepEqual(result, rewardLifecycle(seed, width, height), 'reward replay');
  for (const build of Object.keys(builds)) {
    const out = combat(seed, width, height, build);
    report.combatRuns++; report.steps += out.steps;
    const sum = report.builds[build] ||= {runs: 0, kills: 0, auxiliaryKills: 0, shockwaveKills: 0, splits: 0,
      shockwaves: 0, skippedRewards: 0, highestStage: 0, peakPopulation: 0, peakAuxiliaries: 0, peakQueue: 0, peakSpeed: 0, endings: {}};
    sum.runs++; sum.kills += out.events.kill || 0; sum.auxiliaryKills += out.killSources.auxiliary || 0;
    sum.shockwaveKills += out.killSources.shockwave || 0; sum.splits += out.events.playerSplit || 0;
    sum.shockwaves += out.events.shockwave || 0;
    sum.skippedRewards += out.events.upgradeSkipped || 0; sum.highestStage = Math.max(sum.highestStage, out.stage);
    for (const key of ['peakPopulation', 'peakAuxiliaries', 'peakQueue', 'peakSpeed']) sum[key] = Math.max(sum[key], out[key]);
    sum.endings[out.phase] = (sum.endings[out.phase] || 0) + 1;
    if (seed === 1 && build === 'all') assert.deepEqual(out, combat(seed, width, height, build), 'combat replay');
  }
}
console.log(JSON.stringify({...report, elapsedSeconds: (performance.now() - started) / 1000}, null, 2));
