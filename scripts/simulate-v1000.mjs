// Paired bounded stage snapshots for v10.0.0. These use actual shots, enemy
// spawning, collisions, damage and failure; setup is not a natural reward run.
// Both mechanics versions are pinned: later checkout changes must not be
// interpreted as v10.0.0 or checked against its historical split-family caps.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...values] = arg.replace(/^--/, '').split('='); return [key, values.join('=') || true];
}));
if (args.help) {
  console.log('node scripts/simulate-v1000.mjs [--seeds=2] [--seconds=30] [--stages=20,21,24,26,30,35] [--builds=balanced,frenzy3,area] [--views=portrait,landscape] [--out=docs/V10.0.0-SIMULATION.json]');
  process.exit(0);
}
const seeds = Number(args.seeds || 2), seconds = Number(args.seconds || 30), hz = 60, cadence = 1;
const stages = String(args.stages || '20,21,24,26,30,35').split(',').map(Number);
const builds = String(args.builds || 'balanced,frenzy3,area').split(',');
const views = String(args.views || 'portrait,landscape').split(',');
const dimensions = {portrait: [390, 844], landscape: [844, 390]};
const baselineRef = String(args['baseline-ref'] || 'b5cac0574a5c6e1ba50e052859dc6645efbc91b7');
const currentRef = '288192bd545d86eaab161f59b0e086c110e9e7f8';
assert.ok(Number.isInteger(seeds) && seeds >= 1 && seeds <= 8);
assert.ok(Number.isFinite(seconds) && seconds >= 5 && seconds <= 45);
assert.ok(stages.every(s => Number.isInteger(s) && s >= 20 && s <= 100));
assert.ok(builds.every(b => ['balanced', 'frenzy3', 'area'].includes(b)));
assert.ok(views.every(v => dimensions[v]));
const sourceFiles = ['physics.js', 'enemies.js', 'upgrades.js', 'feedback.js'];
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const hashSources = directory => Object.fromEntries(sourceFiles.map(file => [file, hash(path.join(directory, 'dist', file))]));
const temporary = mkdtempSync(path.join(tmpdir(), 'qiuqiule-v1000-comparison-'));
const baselineDirectory = path.join(temporary, 'baseline'), currentDirectory = path.join(temporary, 'v10.0.0');
for (const [directory, ref] of [[baselineDirectory, baselineRef], [currentDirectory, currentRef]]) {
  mkdirSync(path.join(directory, 'dist'), {recursive: true});
  for (const file of sourceFiles) writeFileSync(path.join(directory, 'dist', file),
    execFileSync('git', ['show', `${ref}:dist/${file}`], {cwd: root}));
  writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}\n');
}
const baselineSource = hashSources(baselineDirectory), currentSource = hashSources(currentDirectory);
const scriptHash = hash(fileURLToPath(import.meta.url));
const rng = initial => { let state = initial >>> 0; return () => ((state = Math.imul(state, 1664525) + 1013904223 >>> 0) / 2 ** 32); };
const count = (items, id) => items.filter(item => item === id).length;
const mean = values => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

// Prefixes are attainable layer choices. Additional later-stage grants retain
// the same build identity and obey the overspeed prerequisite (energy >= 4).
const paths = {
  balanced: ['energy', 'density', 'rubber', 'pierce', 'energy', 'density', 'split', 'rubber',
    'penetration', 'energy', 'density', 'bank', 'boomerang', 'rubber', 'energy', 'density',
    'shockwave', 'breath', 'growth', 'magnet', 'pulse', 'gravity', 'density'],
  frenzy3: ['energy', 'density', 'rubber', 'frenzy', 'pierce', 'energy', 'density', 'split',
    'frenzy', 'rubber', 'penetration', 'energy', 'density', 'frenzy', 'boomerang', 'energy',
    'density', 'bank', 'growth', 'breath', 'rubber', 'shockwave', 'density'],
  area: ['energy', 'density', 'shockwave', 'pulse', 'gravity', 'rubber', 'energy', 'density',
    'split', 'magnet', 'energy', 'density', 'pierce', 'rubber', 'boomerang', 'energy',
    'density', 'breath', 'penetration', 'bank', 'growth', 'rubber', 'density'],
};
function grantPath(stage, build) {
  const budget = stage + Math.floor((stage - 1) / 5);
  const choices = paths[build].slice(0, budget), extra = ['overspeed', 'density', 'energy', 'density', 'energy', 'overspeed'];
  while (choices.length < budget) choices.push(extra[(choices.length - paths[build].length) % extra.length]);
  return {budget, choices};
}

function familyPressure(w) {
  let mothers = w.enemies.filter(b => b.hp > 0 && b.enemyType === 'split').length;
  const fragments = w.enemies.filter(b => b.hp > 0 && b.enemyType === 'fragment').length;
  for (const cluster of new Set([w.wave, w.floorCluster].filter(Boolean)))
    mothers += count(cluster.types?.slice(cluster.index) || [], 'split');
  return {mothers, descendants: fragments + w.fragmentQueue.length + mothers * 3};
}

// Rank 60 fixed directions by the number of distinct targets intersected along
// the direct path and one wall reflection. This is a fixed policy, not an oracle
// for future enemy positions or a human skill model.
function aimAngle(w) {
  const living = w.enemies.filter(b => b.hp > 0 && b.solid);
  if (!living.length) return null;
  const p = w.player, bounds = w.arenaBounds;
  const left = bounds.left + p.r, right = bounds.right - p.r;
  const top = bounds.top + p.r, bottom = bounds.bottom - p.r;
  let best = null, bestScore = -Infinity;
  for (let candidate = 0; candidate < 60; candidate++) {
    const angle = candidate * Math.PI * 2 / 60, dx = Math.cos(angle), dy = Math.sin(angle);
    const wallX = Math.abs(dx) < 1e-12 ? Infinity : ((dx > 0 ? right : left) - p.x) / dx;
    const wallY = Math.abs(dy) < 1e-12 ? Infinity : ((dy > 0 ? bottom : top) - p.y) / dy;
    const first = Math.max(0, Math.min(wallX, wallY));
    const bx = p.x + dx * first, by = p.y + dy * first;
    const rx = wallX <= wallY ? -dx : dx, ry = wallY <= wallX ? -dy : dy;
    const secondX = Math.abs(rx) < 1e-12 ? Infinity : ((rx > 0 ? right : left) - bx) / rx;
    const secondY = Math.abs(ry) < 1e-12 ? Infinity : ((ry > 0 ? bottom : top) - by) / ry;
    const segments = [[p.x, p.y, dx, dy, first, 0], [bx, by, rx, ry, Math.max(0, Math.min(secondX, secondY)), first]];
    let score = 0, nearest = Infinity;
    for (const b of living) {
      let travel = Infinity;
      for (const [x, y, sx, sy, distance, offset] of segments) {
        const along = (b.x - x) * sx + (b.y - y) * sy, across = Math.abs((b.x - x) * sy - (b.y - y) * sx);
        if (along >= 0 && along <= distance && across <= p.r + b.r) travel = Math.min(travel, offset + along);
      }
      if (Number.isFinite(travel)) { score++; nearest = Math.min(nearest, travel); }
    }
    score -= Math.min(100, nearest / w.unit) * .001;
    if (score > bestScore) { bestScore = score; best = angle; }
  }
  return best;
}

function run(variant, spec) {
  const {stage, build, view, seed} = spec, [width, height] = dimensions[view];
  const w = new variant.World(width, height, rng(seed), {spawnInitial: false});
  w.stage = w.maxStage = stage;
  w.time = (stage - 1) * 20;
  w.setFeedbackOptions({strength: .6, reducedMotion: false});
  for (const definition of Object.values(variant.types)) if (definition.stage <= stage) w.typeIntroductions[definition.id] = 3;
  const {budget, choices} = grantPath(stage, build);
  for (const id of choices) assert.ok(w.applyUpgrade(id), `illegal build ${build}/${stage}: ${id}`);
  assert.ok(choices.length <= budget);
  const stats = {kills: 0, shots: 0, damageContacts: 0, shieldBreaks: 0, damageRemoved: 0, rescues: 0,
    fragmentsBorn: 0, mothersBorn: 0, peakLive: 0, peakFragmentQueue: 0, peakMothers: 0, peakDescendantObligation: 0};
  const context = `${variant.name}/${stage}/${build}/${view}/${seed}`;
  const emit = w.emit, damage = w.damage;
  w.damage = function(body, amount, ...rest) {
    const beforeHp = body.hp, beforeShield = body.shield;
    const result = damage.call(this, body, amount, ...rest);
    if (beforeHp > body.hp) { stats.damageContacts++; stats.damageRemoved += Math.min(beforeHp, beforeHp - body.hp); }
    if (beforeShield && !body.shield) stats.shieldBreaks++;
    return result;
  };
  w.emit = function(type, event = {}) {
    if (type === 'kill') stats.kills++;
    if (type === 'rescue') stats.rescues++;
    if (type === 'spawn') {
      const body = this.enemies.find(b => b.id === event.bodyId);
      if (body.enemyType === 'split') stats.mothersBorn++;
      if (body.enemyType === 'fragment') {
        stats.fragmentsBorn++;
        if (variant.name === 'v10.0.0') {
          assert.equal(body.solid, true, `${context}: newborn child is invulnerable`);
          assert.equal(body.born, 1, `${context}: newborn collision radius is incomplete`);
          for (const other of [this.player, ...this.auxiliaries, ...this.enemies.filter(b => b !== body && b.hp > 0)]) {
            const gap = Math.hypot(body.x - other.x, body.y - other.y) - body.r - other.r;
            assert.ok(gap >= -1e-7, `${context}: newborn overlaps ${other.id} by ${-gap}`);
          }
          assert.ok(Math.hypot(body.x - body.clusterX, body.y - body.clusterY) <= this.unit * 2.5 + 1e-7,
            `${context}: child relocated outside its death neighborhood`);
        }
      }
    }
    return emit.call(this, type, event);
  };
  function audit() {
    const pressure = familyPressure(w);
    stats.peakLive = Math.max(stats.peakLive, w.liveCount);
    stats.peakFragmentQueue = Math.max(stats.peakFragmentQueue, w.fragmentQueue.length);
    stats.peakMothers = Math.max(stats.peakMothers, pressure.mothers);
    stats.peakDescendantObligation = Math.max(stats.peakDescendantObligation, pressure.descendants);
    assert.ok(w.liveCount <= 28, `${context}: population exceeds hard cap`);
    if (variant.name === 'v10.0.0' && stage >= 21) {
      assert.ok(pressure.mothers <= 3, `${context}: mother reservation overflow ${pressure.mothers}`);
      assert.ok(pressure.descendants <= 9, `${context}: descendant reservation overflow ${pressure.descendants}`);
    }
    for (const b of [w.player, ...w.auxiliaries, ...w.enemies]) for (const field of ['x', 'y', 'vx', 'vy', 'r', 'mass'])
      assert.ok(Number.isFinite(b[field]), `${context}: nonfinite ${field}`);
  }
  w.fillFloor(); w.spawnTimer = 2 * w.spawnInterval; audit();
  const noise = rng(seed ^ 0x5e7a1c83);
  let elapsed = 0, nextShot = .85;
  for (let tick = 0; tick < seconds * hz && w.phase === 'battle'; tick++) {
    const clock = tick / hz;
    if (clock + 1e-10 >= nextShot) {
      const intended = aimAngle(w);
      if (intended !== null) {
        const angle = intended + (noise() * 2 - 1) * 4 * Math.PI / 180;
        if (w.beginPull() && w.shoot(-Math.cos(angle) * w.maxPull, -Math.sin(angle) * w.maxPull)) stats.shots++;
        nextShot = clock + cadence;
      }
    }
    w.step(1 / hz); elapsed = (tick + 1) / hz; audit(); w.events.length = 0;
  }
  const outcome = w.phase === 'clearing' || w.stage > stage || w.stageKills >= w.killTarget ? 'stage-cleared'
    : w.phase === 'over' ? `failed-${w.deathReason}` : w.phase === 'battle' ? 'time-limit' : `stopped-${w.phase}`;
  return {...spec, grantBudget: budget, buffs: {...w.buffs}, initialWorldSeconds: (stage - 1) * 20,
    seconds: elapsed, outcome, ...stats, killsPerSecond: stats.kills / Math.max(1 / hz, elapsed),
    killsPerShot: stats.kills / Math.max(1, stats.shots), damageContactsPerKill: stats.kills ? stats.damageContacts / stats.kills : null};
}

function aggregate(runs) {
  const sum = key => runs.reduce((total, run) => total + run[key], 0), outcomes = {};
  for (const run of runs) outcomes[run.outcome] = (outcomes[run.outcome] || 0) + 1;
  return {runs: runs.length, outcomes, meanSeconds: mean(runs.map(r => r.seconds)), kills: sum('kills'), shots: sum('shots'),
    killsPerSecond: sum('kills') / Math.max(1, sum('seconds')), meanRunKillsPerSecond: mean(runs.map(r => r.killsPerSecond)),
    killsPerShot: sum('kills') / Math.max(1, sum('shots')),
    damageContactsPerKill: sum('kills') ? sum('damageContacts') / sum('kills') : null,
    fragmentsBorn: sum('fragmentsBorn'), mothersBorn: sum('mothersBorn'), rescues: sum('rescues'),
    peakLive: Math.max(...runs.map(r => r.peakLive)), peakFragmentQueue: Math.max(...runs.map(r => r.peakFragmentQueue)),
    peakMothers: Math.max(...runs.map(r => r.peakMothers)), peakDescendantObligation: Math.max(...runs.map(r => r.peakDescendantObligation))};
}

const started = performance.now();
try {
  const baseline = await import(pathToFileURL(path.join(baselineDirectory, 'dist/physics.js')));
  const baselineEnemies = await import(pathToFileURL(path.join(baselineDirectory, 'dist/enemies.js')));
  const current = await import(pathToFileURL(path.join(currentDirectory, 'dist/physics.js')));
  const currentEnemies = await import(pathToFileURL(path.join(currentDirectory, 'dist/enemies.js')));
  const report = {method: 'Paired bounded late-stage fixtures with actual World shots, collisions and spawning.',
    config: {seeds, secondsPerCase: seconds, stages, builds, views: Object.fromEntries(views.map(v => [v, dimensions[v]])),
      hz, shotCadenceSeconds: cadence, aimErrorUniformDegrees: [-4, 4], feedbackStrength: .6,
      startingGrantBudget: 'stage + floor((stage - 1)/5), including the opening choice; no gambler bonus assumed',
      startingWorldSeconds: '(stage - 1) * 20', decision: '60 directions; count distinct targets along direct path plus one wall reflection',
      stop: 'first stage clear, failure, any non-battle phase, or the per-case time limit'},
    source: {baselineRef, currentRef, baseline: baselineSource, current: currentSource, scriptSha256: scriptHash},
    limitations: ['Fixed acquired builds and stage snapshots, not natural random reward histories or complete player runs.',
      'Instant full pulls on a fixed cadence omit human aim time, bullet-time use, adaptation, mobile latency and rendering.',
      'Paired seeds do not keep encounters identical after mechanics alter RNG consumption, births or kills.',
      'Bounded cases can end at the time limit; outcomes do not establish a human survival-stage target or prove optimal balance.',
      'This historical comparison uses the pinned source refs and hashes; it does not describe a newer checkout.'], variants: {}, comparisonsByStage: {}};
  for (const variant of [{name: 'v9.0.2', World: baseline.World, types: baselineEnemies.ENEMY_TYPES},
    {name: 'v10.0.0', World: current.World, types: currentEnemies.ENEMY_TYPES}]) {
    const runs = [];
    for (const stage of stages) for (const build of builds) for (const view of views) for (let seed = 1; seed <= seeds; seed++)
      runs.push(run(variant, {stage, build, view, seed}));
    report.variants[variant.name] = {summary: aggregate(runs), runs};
    process.stderr.write(`${variant.name}: ${runs.length} cases; ${JSON.stringify(report.variants[variant.name].summary.outcomes)}\n`);
  }
  for (const stage of stages) {
    const old = aggregate(report.variants['v9.0.2'].runs.filter(r => r.stage === stage));
    const next = aggregate(report.variants['v10.0.0'].runs.filter(r => r.stage === stage));
    report.comparisonsByStage[stage] = {baseline: old, current: next, deltaKillsPerSecond: next.killsPerSecond - old.killsPerSecond,
      deltaKillsPerShot: next.killsPerShot - old.killsPerShot};
  }
  assert.deepEqual(hashSources(baselineDirectory), baselineSource, 'baseline snapshot changed during comparison');
  assert.deepEqual(hashSources(currentDirectory), currentSource, 'v10.0.0 snapshot changed during comparison');
  assert.equal(hash(fileURLToPath(import.meta.url)), scriptHash, 'simulation script changed during comparison');
  report.hostElapsedSeconds = (performance.now() - started) / 1000;
  const output = path.resolve(root, String(args.out || 'docs/V10.0.0-SIMULATION.json'));
  mkdirSync(path.dirname(output), {recursive: true}); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({output, casesPerVariant: report.variants['v10.0.0'].runs.length,
    hostElapsedSeconds: report.hostElapsedSeconds, sourceVerified: true,
    baseline: report.variants['v9.0.2'].summary, current: report.variants['v10.0.0'].summary}, null, 2));
} finally { rmSync(temporary, {recursive: true, force: true}); }
