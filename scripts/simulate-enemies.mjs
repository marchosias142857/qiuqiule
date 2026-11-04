// Independent Task 4 integration probe using the real World.step and scheduler.
// Run from any directory; no dependencies beyond Node and the checked-in game.
//
//   node scripts/simulate-enemies.mjs         # 70 cases, 5 seeds, 12 s per case
//   node scripts/simulate-enemies.mjs 10 35   # 140 cases, 10 seeds, 35 s per case
//
// Starts at stages 3/6/8/10/12/13/16 in 390x844 and 844x390 viewports. Earlier
// enemy types have completed teaching; the new type has not. Every fifth seed
// remains idle; others redirect at the nearest solid enemy every 0.85 seconds.
// No damage, deaths, or progression are injected during simulation.
//
// Checks population/type reservations, first-three isolated teaching, per-cluster
// limits, edge spawning, finite physics state, and deterministic replay. The
// report includes real child births, queue peaks, rescues, and pure-physics time.
//
// Limits: these are controlled new-stage snapshots, not complete human runs.
// They do not carry hypothetical prior upgrades, measure balance/retention, or
// test rendering, audio, input latency, or phone FPS. Node timing is diagnostic.
// Assertions fail the process; a very short custom run may need more coverage.

import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {World} from '../dist/physics.js';
import {ENEMY_TYPES} from '../dist/enemies.js';

const rng = seed => () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
const counted = type => type === 'fragment' ? 'normal' : type;
const capAt = stage => stage >= 16 ? 5 : stage >= 10 ? 4 : stage >= 6 ? 3 : stage >= 3 ? 2 : 1;
const stages = [3, 6, 8, 10, 12, 13, 16];
const views = [[390, 844], [844, 390]];
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/simulate-enemies.mjs [seed-count=5] [seconds-per-case=12]\n'
    + 'Default: 70 cases across seven introduction stages and portrait/landscape.\n'
    + 'Extended: node scripts/simulate-enemies.mjs 10 35  (140 cases).\n'
    + 'seed-count: integer 1..100; seconds-per-case: number 5..300.');
  process.exit(0);
}
const seeds = Number(args[0] ?? 5), seconds = Number(args[1] ?? 12);
if (args.length > 2 || !Number.isInteger(seeds) || seeds < 1 || seeds > 100
  || !Number.isFinite(seconds) || seconds < 5 || seconds > 300) {
  console.error('Invalid arguments. Run node scripts/simulate-enemies.mjs --help for usage.');
  process.exit(1);
}
const total = {cases: 0, steps: 0, spawns: 0, kills: 0, teaching: 0, fragments: 0, rescues: 0,
  peakPopulation: 0, peakFragmentQueue: 0, stepMilliseconds: 0, maxStepMilliseconds: 0, types: {}, endings: {}};

function run(seed, startStage, width, height, idle = false) {
  const context = {seed, startStage, width, height, idle};
  const w = new World(width, height, rng(seed), {spawnInitial: false});
  w.stage = startStage;
  // A legitimate new-stage snapshot: earlier types have completed teaching;
  // the new type still has all three teaching encounters outstanding.
  for (const entry of Object.values(ENEMY_TYPES)) if (entry.stage < startStage) w.typeIntroductions[entry.id] = 3;
  const wasTaught = {...w.typeIntroductions}, births = [], counts = {}, kills = {}, eventCounts = {};
  const emit = w.emit;
  w.emit = function (type, data = {}) {
    eventCounts[type] = (eventCounts[type] || 0) + 1;
    if (type === 'spawn') {
      const body = this.enemies.find(b => b.id === data.bodyId), enemyType = body.enemyType || 'normal';
      counts[enemyType] = (counts[enemyType] || 0) + 1;
      births.push({body, enemyType, clusterId: body.clusterId, x: body.x, y: body.y, radius: body.r, stage: this.stage, at: this.time});
      if (enemyType === 'walker') {
        const b = this.arenaBounds;
        const edgeGap = Math.min(Math.abs(body.x - b.left - body.r), Math.abs(body.x - b.right + body.r),
          Math.abs(body.y - b.top - body.r), Math.abs(body.y - b.bottom + body.r));
        assert.ok(edgeGap < 1e-7, JSON.stringify({...context, problem: 'walker not at edge', edgeGap}));
      }
    }
    if (type === 'kill') kills[data.enemyType || 'normal'] = (kills[data.enemyType || 'normal'] || 0) + 1;
    return emit.call(this, type, data);
  };
  w.fillFloor(); w.spawnTimer = 2 * w.spawnInterval;
  let nextShot = .85, peak = w.liveCount, peakQueue = 0, steps = 0, stepMs = 0, maxStepMs = 0;
  for (let frame = 0; frame < seconds * 120 && w.phase !== 'over'; frame++) {
    if (w.phase === 'choose') w.choose(w.choices.find(c => c.id === 'energy') || w.choices[0]);
    if (!idle && w.phase === 'battle' && frame / 120 >= nextShot) {
      const target = w.enemies.filter(b => b.hp > 0 && b.solid)
        .sort((a, b) => Math.hypot(a.x - w.player.x, a.y - w.player.y) - Math.hypot(b.x - w.player.x, b.y - w.player.y))[0];
      if (target) {
        const dx = target.x - w.player.x, dy = target.y - w.player.y, distance = Math.hypot(dx, dy) || 1;
        w.shoot(-dx / distance * w.maxPull, -dy / distance * w.maxPull); nextShot = frame / 120 + .85;
      }
    }
    const begin = performance.now(); w.step(1 / 120); const elapsed = performance.now() - begin;
    steps++; stepMs += elapsed; maxStepMs = Math.max(maxStepMs, elapsed);
    peak = Math.max(peak, w.liveCount); peakQueue = Math.max(peakQueue, w.fragmentQueue.length);
    assert.ok(w.liveCount <= 28, JSON.stringify({...context, problem: 'population', count: w.liveCount}));
    const pending = [...w.enemies.filter(b => b.hp > 0).map(b => b.enemyType || 'normal'),
      ...(w.wave?.types?.slice(w.wave.index) || []), ...(w.floorCluster?.types?.slice(w.floorCluster.index) || []),
      ...w.fragmentQueue.map(() => 'normal')];
    const types = new Set(pending.map(counted)); if (types.has('split')) types.add('normal');
    assert.ok(types.size <= capAt(w.stage), JSON.stringify({...context, problem: 'reserved cap', stage: w.stage, types: [...types]}));
    for (const b of [w.player, ...w.enemies]) for (const field of ['x', 'y', 'vx', 'vy', 'r', 'mass', 'hp'])
      if (!(b.isPlayer && field === 'hp')) assert.ok(Number.isFinite(b[field]), JSON.stringify({...context, problem: 'nonfinite', id: b.id, field, value: b[field]}));
    w.events.length = 0;
  }
  const clusters = new Map();
  for (const birth of births) {
    const cluster = clusters.get(birth.clusterId) || [];
    cluster.push(birth); clusters.set(birth.clusterId, cluster);
  }
  for (const [clusterId, cluster] of clusters) for (const type of ['heavy', 'magnet', 'leader'])
    assert.ok(cluster.filter(b => b.enemyType === type).length <= 1, JSON.stringify({...context, problem: 'cluster limit', clusterId, type}));
  for (const entry of Object.values(ENEMY_TYPES)) {
    if (!entry.spawnable || entry.id === 'normal' || wasTaught[entry.id] >= 3) continue;
    const first = births.filter(b => b.enemyType === entry.id).slice(0, 3);
    for (const birth of first) {
      assert.equal(birth.body.teaching, true, JSON.stringify({...context, problem: 'first three not teaching', type: entry.id, at: birth.at}));
      assert.equal(clusters.get(birth.clusterId).length, 1, JSON.stringify({...context, problem: 'teaching mixed cluster', type: entry.id}));
    }
  }
  const teaching = births.filter(b => b.body.teaching).length;
  return {context, stats: {steps, stepMs, maxStepMs, peak, peakQueue, teaching},
    replay: {counts, kills, eventCounts, phase: w.phase, stage: w.stage, score: w.score, stageKills: w.stageKills,
      introductions: w.typeIntroductions, fragmentQueue: w.fragmentQueue,
      bodies: [w.player, ...w.enemies].map(b => [b.id, b.enemyType, b.x, b.y, b.vx, b.vy, b.hp])}};
}

const started = performance.now();
for (const [width, height] of views) for (const stage of stages) for (let seed = 1; seed <= seeds; seed++) {
  const out = run(seed, stage, width, height, seed % 5 === 0), {stats, replay} = out;
  total.cases++; total.steps += stats.steps; total.teaching += stats.teaching;
  total.stepMilliseconds += stats.stepMs; total.maxStepMilliseconds = Math.max(total.maxStepMilliseconds, stats.maxStepMs);
  total.peakPopulation = Math.max(total.peakPopulation, stats.peak); total.peakFragmentQueue = Math.max(total.peakFragmentQueue, stats.peakQueue);
  total.spawns += replay.eventCounts.spawn || 0; total.kills += replay.eventCounts.kill || 0; total.rescues += replay.eventCounts.rescue || 0;
  total.fragments += replay.counts.fragment || 0;
  for (const [type, count] of Object.entries(replay.counts)) total.types[type] = (total.types[type] || 0) + count;
  total.endings[replay.phase] = (total.endings[replay.phase] || 0) + 1;
  if (seed === 1 && stage === 16) assert.deepEqual(replay, run(seed, stage, width, height).replay, 'seeded replay');
}
for (const entry of Object.values(ENEMY_TYPES)) assert.ok(total.types[entry.id] > 0, `never spawned ${entry.id}; increase the seed count or duration to establish coverage`);
console.log(JSON.stringify({seedCount: seeds, secondsPerCase: seconds, ...total, averageStepMilliseconds: total.stepMilliseconds / total.steps,
  elapsedSeconds: (performance.now() - started) / 1000}, null, 2));
