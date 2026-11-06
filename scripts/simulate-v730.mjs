// Round 2 / task 4 paired opening-grant comparison, with original ring spawning intact.
// This is a new deterministic proxy, not a reproduction of the absent PDF scripts.
// One experimental buff is granted before the first floor. Subsequent play uses
// public pulls, shots and real step/collision/reward transitions only.
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
  const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=') || true];
}));
if (args.help) {
  console.log('node scripts/simulate-v730.mjs --seeds=8 --max-seconds=600 --buffs=shockwave --baseline-ref=bd8f29a --baseline-label=v8.2.1 --current-label=v8.3.0 --out=/tmp/shockwave-comparison.json\nOptional: --baseline-dir=/absolute/baseline --sigma=10 --cadence=26 --buffs=none,frenzy,rubber,growth,magnet,shockwave,breath,boomerang');
  process.exit(0);
}
const seedCount = Number(args.seeds || 8), maxSeconds = Number(args['max-seconds'] || 600);
const sigma = Number(args.sigma ?? 10), cadence = Number(args.cadence || 26);
const buffs = String(args.buffs || 'none,frenzy,rubber,growth,magnet,shockwave,breath,boomerang').split(',');
assert.ok(Number.isInteger(seedCount) && seedCount >= 1 && seedCount <= 32);
assert.ok(maxSeconds >= 60 && maxSeconds <= 1800 && sigma >= 0 && sigma <= 30 && cadence >= 10 && cadence <= 60);
assert.ok(buffs.every(id => ['none', 'frenzy', 'rubber', 'growth', 'magnet', 'shockwave', 'breath', 'boomerang'].includes(id)));
const baselineRef = String(args['baseline-ref'] || 'bd8f29a');
const baselineLabel = String(args['baseline-label'] || 'baseline'), currentLabel = String(args['current-label'] || 'current');
assert.notEqual(baselineLabel, currentLabel);
let temporary = null;
const baselineDir = args['baseline-dir'] ? path.resolve(String(args['baseline-dir'])) : (() => {
  temporary = mkdtempSync(path.join(tmpdir(), 'qiuqiule-baseline-'));
  mkdirSync(path.join(temporary, 'dist'));
  // Only the mechanics modules are needed; do not copy music or Site assets.
  for (const file of ['physics.js', 'enemies.js', 'upgrades.js', 'feedback.js'])
    writeFileSync(path.join(temporary, 'dist', file), execFileSync('git', ['show', `${baselineRef}:dist/${file}`], {cwd: root}));
  writeFileSync(path.join(temporary, 'package.json'), '{"type":"module"}\n'); return temporary;
})();
const baseline = await import(pathToFileURL(path.join(baselineDir, 'dist/physics.js')));
const current = await import(pathToFileURL(path.join(root, 'dist/physics.js')));
const baselineUpgrades = await import(pathToFileURL(path.join(baselineDir, 'dist/upgrades.js')));
const currentUpgrades = await import(pathToFileURL(path.join(root, 'dist/upgrades.js')));
const {clearingTimeScale} = await import(pathToFileURL(path.join(root, 'dist/rhythm-feedback.js')));
const hash = filename => createHash('sha256').update(readFileSync(filename)).digest('hex');
const rng = initial => { let seed = initial >>> 0; return () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32); };
const normal = random => Math.sqrt(-2 * Math.log(Math.max(Number.EPSILON, random()))) * Math.cos(2 * Math.PI * random());
const speed = body => Math.hypot(body.vx, body.vy);
const priorities = ['split', 'pierce', 'rubber', 'energy', 'density', 'penetration', 'pulse', 'gravity', 'bank', 'boomerang', 'magnet', 'growth', 'shockwave', 'breath', 'overspeed', 'frenzy', 'gambler'];

function aimAngle(w) {
  if (w.boss && w.phase === 'boss') return Math.atan2(w.boss.y - w.player.y, w.boss.x - w.player.x);
  const living = w.enemies.filter(b => b.hp > 0 && b.solid);
  if (!living.length) return null;
  const p = w.player, bounds = w.arenaBounds;
  const left = bounds.left + p.r, right = bounds.right - p.r, top = bounds.top + p.r, bottom = bounds.bottom - p.r;
  let best = null, bestScore = -Infinity;
  for (let candidate = 0; candidate < 90; candidate++) {
    const angle = candidate * Math.PI * 2 / 90, dx = Math.cos(angle), dy = Math.sin(angle);
    const wallX = Math.abs(dx) < 1e-12 ? Infinity : ((dx > 0 ? right : left) - p.x) / dx;
    const wallY = Math.abs(dy) < 1e-12 ? Infinity : ((dy > 0 ? bottom : top) - p.y) / dy;
    const firstLength = Math.max(0, Math.min(wallX, wallY));
    const segments = [[p.x, p.y, dx, dy, firstLength, 0]];
    const bx = p.x + dx * firstLength, by = p.y + dy * firstLength;
    const rx = wallX <= wallY ? -dx : dx, ry = wallY <= wallX ? -dy : dy;
    const secondX = Math.abs(rx) < 1e-12 ? Infinity : ((rx > 0 ? right : left) - bx) / rx;
    const secondY = Math.abs(ry) < 1e-12 ? Infinity : ((ry > 0 ? bottom : top) - by) / ry;
    segments.push([bx, by, rx, ry, Math.max(0, Math.min(secondX, secondY)), firstLength]);
    let score = 0, nearest = Infinity;
    for (const b of living) {
      let travel = Infinity;
      for (const [x, y, sx, sy, distance, offset] of segments) {
        const along = (b.x - x) * sx + (b.y - y) * sy;
        const across = Math.abs((b.x - x) * sy - (b.y - y) * sx);
        if (along >= 0 && along <= distance && across <= p.r + b.r) travel = Math.min(travel, offset + along);
      }
      if (Number.isFinite(travel)) { score += 1; nearest = Math.min(nearest, travel); }
    }
    score -= Math.min(100, nearest / w.unit) * .001;
    if (score > bestScore) { bestScore = score; best = angle; }
  }
  return best;
}

function run(WorldClass, seed, buff) {
  const w = new WorldClass(390, 844, rng(seed), {spawnInitial: false});
  w.setFeedbackOptions({strength: .6, reducedMotion: false});
  if (buff !== 'none') assert.ok(w.applyUpgrade(buff), `opening grant ${buff}`);
  w.fillFloor();
  const noise = rng(seed ^ 0x6c8e9cf5), shots = [], upgrades = [], bosses = [], stages = {}, rewardCarryByStage = {};
  let clock = 0, lastShot = -Infinity, lastKill = 0, aimUntil = null, activeShot = null, nextRewardShot = 0;
  let maxPopulation = 0, bossStart = null, scoreLedger = 0, rewardShots = 0, nonlethal = 0, rewardCarryKills = 0, rewardCarryHits = 0;
  const emit = w.emit;
  w.emit = function(type, event = {}) {
    if (['kill', 'clearKill', 'bossScore', 'bossDefeated'].includes(type)) scoreLedger += event.value;
    if (type === 'kill') {
      lastKill = clock;
      if (activeShot) activeShot.kills++;
      else {
        rewardCarryKills++;
        (rewardCarryByStage[w.stage] ??= {kills: 0, hits: 0}).kills++;
      }
    }
    if (type === 'hit' || type === 'shieldBreak') {
      if (activeShot) activeShot.hits++;
      else {
        rewardCarryHits++;
        (rewardCarryByStage[w.stage] ??= {kills: 0, hits: 0}).hits++;
      }
      if (type === 'hit' && !event.lethal) nonlethal++;
    }
    if (type === 'buff') upgrades.push({stage: w.stage, id: event.buff.id});
    if (type === 'bossEntry') bossStart = clock;
    if (type === 'bossDefeated') { bosses.push({stage: w.stage, seconds: clock - bossStart, result: 'win'}); bossStart = null; }
    if (type === 'over' && w.boss && !w.boss.defeated) bosses.push({stage: w.stage, seconds: clock - bossStart, result: 'loss'});
    return emit.call(this, type, event);
  };
  const firstFiveComplete = () => w.stage > 5 || w.stage === 5 && ['boss-entry', 'boss', 'boss-celebrate'].includes(w.phase);
  for (let tick = 0; tick < maxSeconds * 120 && w.phase !== 'over' && !firstFiveComplete(); tick++) {
    clock = tick / 120;
    if (aimUntil !== null && !w.continuousControl) { w.cancelPull(); aimUntil = null; }
    if (w.phase === 'choose' && w.ready && clock >= nextRewardShot) {
      const rank = id => { const index = priorities.indexOf(id); return index < 0 ? priorities.length : index; };
      const ordered = [...w.choices].sort((a, b) => rank(a.id) - rank(b.id));
      const c = ordered[0], distance = Math.hypot(c.x - w.player.x, c.y - w.player.y);
      if (distance > 0 && w.shoot((w.player.x - c.x) / distance * w.maxPull, (w.player.y - c.y) / distance * w.maxPull)) {
        // Residual reward-shot motion is real gameplay, but is not the previous
        // combat shot. Track its subsequent combat impacts separately.
        rewardShots++; activeShot = null;
      }
      nextRewardShot = clock + .8;
    }
    if (['battle', 'boss'].includes(w.phase)) {
      if (aimUntil === null && clock - lastShot >= 60 / cadence - .6 &&
          (speed(w.player) < w.unit * 12 || clock - lastKill >= 1) && aimAngle(w) !== null && w.beginPull()) aimUntil = clock + .6;
      if (aimUntil !== null && clock + 1e-10 >= aimUntil) {
        const intended = aimAngle(w);
        if (intended !== null) {
          const angle = intended + normal(noise) * sigma * Math.PI / 180;
          const shot = {stage: w.stage, boss: w.phase === 'boss', kills: 0, hits: 0};
          if (w.shoot(-Math.cos(angle) * w.maxPull, -Math.sin(angle) * w.maxPull)) { shots.push(shot); activeShot = shot; lastShot = clock; }
        } else w.cancelPull();
        aimUntil = null;
      }
    }
    let scale = aimUntil !== null ? .3 : 1;
    if (w.phase === 'clearing') scale = clearingTimeScale(w.clearing?.elapsed || 0, {juice: .6});
    if (w.bossVictorySlowTime > 0) scale = .25;
    if (w.phase === 'battle') stages[w.stage] = (stages[w.stage] || 0) + 1 / 120;
    w.step(scale / 120, aimUntil !== null, {timeScale: scale});
    maxPopulation = Math.max(maxPopulation, w.liveCount);
    assert.ok(w.liveCount <= 28 && w.score === scoreLedger, 'population or score ledger invariant');
    if (tick % 120 === 0) for (const b of [w.player, ...w.auxiliaries, ...w.enemies, ...(w.boss ? [w.boss] : [])]) {
      for (const key of ['x', 'y', 'vx', 'vy', 'r']) assert.ok(Number.isFinite(b[key]), `nonfinite ${key}`);
    }
    w.events.length = 0;
  }
  const ordinary = shots.filter(s => !s.boss), early = ordinary.filter(s => s.stage <= 5);
  const kills = list => list.reduce((sum, s) => sum + s.kills, 0);
  const withHits = list => list.filter(s => s.hits > 0 || s.kills > 0);
  const totals = list => ({shots: list.length, kills: kills(list), multiKillShots: list.filter(s => s.kills >= 2).length,
    hitShots: withHits(list).length, killsPerShot: kills(list) / Math.max(1, list.length),
    multiKillShareAllShots: list.filter(s => s.kills >= 2).length / Math.max(1, list.length),
    multiKillShareAmongHitShots: list.filter(s => s.kills >= 2).length / Math.max(1, withHits(list).length)});
  return {seed, openingBuff: buff, stage: w.stage, phase: w.phase, score: w.score,
    reason: w.deathReason || (firstFiveComplete() ? 'first-five-complete' : 'time-limit'),
    firstFiveComplete: firstFiveComplete(), censored: w.phase !== 'over' && !firstFiveComplete(),
    realSeconds: Math.min(maxSeconds, clock + 1 / 120), activeCombatSeconds: w.elapsed, worldSeconds: w.time,
    combatShots: shots.length, actualShotsPerCombatMinute: shots.length / Math.max(1, w.elapsed) * 60,
    early: totals(early), ordinary: totals(ordinary), stage2: totals(ordinary.filter(s => s.stage === 2)),
    stage10: totals(ordinary.filter(s => s.stage === 10)), maxCombo: w.maxCombo, maxPopulation,
    nonlethalHits: nonlethal, bosses, rewardShots, rewardCarryKills, rewardCarryHits, rewardCarryByStage,
    upgrades, battleRealSecondsByStage: stages};
}

const mean = values => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
function aggregate(runs) {
  const sum = (section, key) => runs.reduce((n, run) => n + run[section][key], 0);
  const result = {runs: runs.length, meanStage: mean(runs.map(r => r.stage)), stageRange: [Math.min(...runs.map(r => r.stage)), Math.max(...runs.map(r => r.stage))],
    meanRealMinutes: mean(runs.map(r => r.realSeconds / 60)), meanScore: mean(runs.map(r => r.score)),
    meanActualShotsPerCombatMinute: mean(runs.map(r => r.actualShotsPerCombatMinute)),
    censored: runs.filter(r => r.censored).length, firstFiveComplete: runs.filter(r => r.firstFiveComplete).length,
    maxPopulation: Math.max(...runs.map(r => r.maxPopulation)), bossWins: runs.flatMap(r => r.bosses).filter(b => b.result === 'win').length,
    bossLosses: runs.flatMap(r => r.bosses).filter(b => b.result === 'loss').length,
    rewardCarryKills: runs.reduce((sum, r) => sum + r.rewardCarryKills, 0),
    rewardCarryHits: runs.reduce((sum, r) => sum + r.rewardCarryHits, 0)};
  for (const section of ['early', 'ordinary', 'stage2', 'stage10']) result[section] = {
    shots: sum(section, 'shots'), kills: sum(section, 'kills'), killsPerShot: sum(section, 'kills') / Math.max(1, sum(section, 'shots')),
    multiKillShareAllShots: sum(section, 'multiKillShots') / Math.max(1, sum(section, 'shots')),
    multiKillShareAmongHitShots: sum(section, 'multiKillShots') / Math.max(1, sum(section, 'hitShots'))};
  return result;
}
const report = {method: 'New deterministic automated proxy; not the absent PDF simulator or human performance.',
  config: {seedCount, maxSeconds, openingBuffs: buffs, sigmaDegrees: sigma, maxCadencePerMinute: cadence, width: 390, height: 844,
    realTicksPerSecond: 120, aimRealSeconds: .6, aimTimeScale: .3, feedback: .6,
    openingSetup: 'No random starting choice. Grant exactly one stack of the named buff (or none), then call the unchanged fillFloor. All later rewards are real ball selections. Stop after stage five combat clears, on death, or at the stated time limit.',
    decision: '90 uniform directions ranked by distinct circle intersections along direct + one reflected segment; fixed upgrade priorities; actual reward-ball shots.',
    multiKillDenominators: {multiKillShareAllShots: 'all combat shots', multiKillShareAmongHitShots: 'combat shots with at least one hit, shield break, or collateral kill'},
    rewardCarryAttribution: 'reward shots clear the combat shot attribution; hits/kills before the next combat shot are reported separately by their actual stage', priorities},
  source: {baselineRef: args['baseline-dir'] ? null : baselineRef,
    baselinePhysicsSha256: hash(path.join(baselineDir, 'dist/physics.js')),
    currentPhysicsSha256: hash(path.join(root, 'dist/physics.js')),
    baselineUpgradesSha256: hash(path.join(baselineDir, 'dist/upgrades.js')),
    currentUpgradesSha256: hash(path.join(root, 'dist/upgrades.js')),
    baselineShockwaveRadius: baselineUpgrades.UPGRADES.shockwave.effect.radius,
    currentShockwaveRadius: currentUpgrades.UPGRADES.shockwave.effect.radius},
  limitations: [
    'Small paired deterministic proxy, not the absent PDF scripts or a human study.',
    'Starting grants are an experiment; the shipped starting-choice pool is not changed.',
    'Fixed aiming/choice policy is insensitive to some buff-specific tactics and can favor or disadvantage individual buffs.',
    'Subsequent random offers depend on acquired buffs and can diverge; totals therefore measure whole-run effects, not isolated causal damage.',
    'First-five kills per shot excludes reward-shot carryover (reported separately), Boss attacks and automatic clear kills.',
    'No statistical claim of reproducing a PDF improvement target; direct parameter and regression tests establish implementation, human testing establishes feel.'
  ], variants: {}, comparisons: {}};
const started = performance.now();
const variants = [{name: baselineLabel, World: baseline.World}, {name: currentLabel, World: current.World}];
try {
  for (const variant of variants) {
    report.variants[variant.name] = {};
    for (const buff of buffs) {
      const runs = [];
      for (let seed = 1; seed <= seedCount; seed++) {
        const result = run(variant.World, seed, buff); runs.push(result);
        process.stderr.write(`${variant.name}/${buff} seed ${seed}: stage ${result.stage}, ${(result.realSeconds / 60).toFixed(2)} min, ${result.reason}\n`);
      }
      report.variants[variant.name][buff] = {summary: aggregate(runs), runs};
    }
  }
  for (const buff of buffs) {
    const old = report.variants[baselineLabel][buff].summary, next = report.variants[currentLabel][buff].summary;
    report.comparisons[buff] = {oldKillsPerShot: old.early.killsPerShot, newKillsPerShot: next.early.killsPerShot,
      deltaKillsPerShot: next.early.killsPerShot - old.early.killsPerShot,
      oldMultiKillShareAllShots: old.early.multiKillShareAllShots, newMultiKillShareAllShots: next.early.multiKillShareAllShots,
      oldMultiKillShareAmongHitShots: old.early.multiKillShareAmongHitShots, newMultiKillShareAmongHitShots: next.early.multiKillShareAmongHitShots,
      oldCompleted: old.firstFiveComplete, newCompleted: next.firstFiveComplete,
      oldMeanScore: old.meanScore, newMeanScore: next.meanScore, oldCensored: old.censored, newCensored: next.censored};
    for (const variant of variants) {
      const data = report.variants[variant.name];
      if (data.none) data[buff].summary.deltaKillsPerShotVersusNoOpeningBuff = data[buff].summary.early.killsPerShot - data.none.summary.early.killsPerShot;
    }
  }
  assert.equal(hash(path.join(root, 'dist/physics.js')), report.source.currentPhysicsSha256, 'physics changed during simulation; rerun the batch');
  assert.equal(hash(path.join(root, 'dist/upgrades.js')), report.source.currentUpgradesSha256, 'upgrades changed during simulation; rerun the batch');
  report.hostElapsedSeconds = (performance.now() - started) / 1000;
  if (args.out) writeFileSync(path.resolve(root, String(args.out)), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({hostElapsedSeconds: report.hostElapsedSeconds, comparisons: report.comparisons}, null, 2));
} finally { if (temporary) rmSync(temporary, {recursive: true, force: true}); }
