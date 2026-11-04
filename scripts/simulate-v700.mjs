// Round 2 / task 1 calibration, with the original ring spawning left intact.
// This is a new deterministic proxy, not a reproduction of the absent PDF scripts.
// Only public pulls, shots and real step/collision/reward/Boss transitions advance a run.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=') || true];
}));
if (args.help) {
  console.log('node scripts/simulate-v700.mjs --seeds=8 --max-seconds=1800 --growths=1.16,1.18,1.20 --out=docs/V7.0.0-SIMULATION.json\nOptional: --baseline-dir=/absolute/v690 --baseline-ref=a9ad79e4a32a48aaee691ad6d160cbd447c8ff1a --sigma=10 --cadence=26');
  process.exit(0);
}
const seedCount = Number(args.seeds || 8), maxSeconds = Number(args['max-seconds'] || 1800);
const sigma = Number(args.sigma ?? 10), cadence = Number(args.cadence || 26);
const growths = String(args.growths || '1.16,1.18,1.20').split(',').map(Number);
assert.ok(Number.isInteger(seedCount) && seedCount >= 1 && seedCount <= 32);
assert.ok(maxSeconds >= 60 && maxSeconds <= 1800 && sigma >= 0 && sigma <= 30 && cadence >= 10 && cadence <= 60);
assert.ok(growths.every(n => n >= 1.1 && n <= 1.3));
const baselineRef = String(args['baseline-ref'] || 'a9ad79e4a32a48aaee691ad6d160cbd447c8ff1a');
let temporary = null;
const baselineDir = args['baseline-dir'] ? path.resolve(String(args['baseline-dir'])) : (() => {
  temporary = mkdtempSync(path.join(tmpdir(), 'qiuqiule-v690-'));
  const archive = execFileSync('git', ['archive', baselineRef, 'dist'], {cwd: root, maxBuffer: 40 * 1024 * 1024});
  execFileSync('tar', ['-x', '-C', temporary], {input: archive});
  writeFileSync(path.join(temporary, 'package.json'), '{"type":"module"}\n'); return temporary;
})();
const baseline = await import(pathToFileURL(path.join(baselineDir, 'dist/physics.js')));
const current = await import(pathToFileURL(path.join(root, 'dist/physics.js')));
const {clearingTimeScale} = await import(pathToFileURL(path.join(root, 'dist/rhythm-feedback.js')));
const hash = filename => createHash('sha256').update(readFileSync(filename)).digest('hex');
const rng = initial => { let seed = initial >>> 0; return () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32); };
const normal = random => Math.sqrt(-2 * Math.log(Math.max(Number.EPSILON, random()))) * Math.cos(2 * Math.PI * random());
const speed = body => Math.hypot(body.vx, body.vy);
const priorities = ['split', 'pierce', 'rubber', 'energy', 'density', 'penetration', 'pulse', 'gravity', 'bank', 'boomerang', 'magnet', 'growth', 'shockwave', 'breath', 'overspeed', 'frenzy', 'risk', 'gambler'];

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

function run(WorldClass, seed) {
  const w = new WorldClass(390, 844, rng(seed), {spawnInitial: false});
  w.setFeedbackOptions({strength: .6, reducedMotion: false}); w.beginStartingUpgrades();
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
  for (let tick = 0; tick < maxSeconds * 120 && w.phase !== 'over'; tick++) {
    clock = tick / 120;
    if (aimUntil !== null && !w.continuousControl) { w.cancelPull(); aimUntil = null; }
    if (w.phase === 'choose' && w.ready && clock >= nextRewardShot) {
      const ordered = [...w.choices].sort((a, b) => priorities.indexOf(a.id) - priorities.indexOf(b.id));
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
    multiKillShareAmongHitShots: list.filter(s => s.kills >= 2).length / Math.max(1, withHits(list).length)});
  return {seed, stage: w.stage, score: w.score, reason: w.deathReason || 'time-limit', censored: w.phase !== 'over',
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
    censored: runs.filter(r => r.censored).length, bossWins: runs.flatMap(r => r.bosses).filter(b => b.result === 'win').length,
    bossLosses: runs.flatMap(r => r.bosses).filter(b => b.result === 'loss').length,
    rewardCarryKills: runs.reduce((sum, r) => sum + r.rewardCarryKills, 0),
    rewardCarryHits: runs.reduce((sum, r) => sum + r.rewardCarryHits, 0)};
  for (const section of ['early', 'ordinary', 'stage2', 'stage10']) result[section] = {
    shots: sum(section, 'shots'), kills: sum(section, 'kills'), killsPerShot: sum(section, 'kills') / Math.max(1, sum(section, 'shots')),
    multiKillShareAmongHitShots: sum(section, 'multiKillShots') / Math.max(1, sum(section, 'hitShots'))};
  return result;
}
const report = {method: 'New deterministic automated proxy; not the absent PDF simulator or human performance.',
  config: {seedCount, maxSeconds, sigmaDegrees: sigma, maxCadencePerMinute: cadence, width: 390, height: 844,
    realTicksPerSecond: 120, aimRealSeconds: .6, aimTimeScale: .3, feedback: .6,
    decision: '90 uniform directions ranked by distinct circle intersections along direct + one reflected segment; fixed upgrade priorities; actual reward-ball shots.',
    multiKillDenominator: 'combat shots with at least one hit, shield break, or collateral kill',
    rewardCarryAttribution: 'reward shots clear the combat shot attribution; hits/kills before the next combat shot are reported separately by their actual stage', priorities},
  source: {baselineRef: args['baseline-dir'] ? null : baselineRef,
    baselinePhysicsSha256: hash(path.join(baselineDir, 'dist/physics.js')),
    currentPhysicsSha256: hash(path.join(root, 'dist/physics.js'))}, variants: {}};
const started = performance.now();
const variants = [{name: 'v6.9.0', World: baseline.World}, ...growths.map(growth => ({name: `v7.0.0-hp-${growth.toFixed(2)}`,
  World: class extends current.World { enemyProfile() { const p = super.enemyProfile(); p.hp = 19 * growth ** (this.stage - 1) + Math.floor(this.time / 45) * 2; return p; } }}))];
try {
  for (const variant of variants) {
    const runs = [];
    for (let seed = 1; seed <= seedCount; seed++) {
      const result = run(variant.World, seed); runs.push(result);
      process.stderr.write(`${variant.name} seed ${seed}: stage ${result.stage}, ${(result.realSeconds / 60).toFixed(2)} min, ${result.reason}\n`);
    }
    report.variants[variant.name] = {summary: aggregate(runs), runs};
  }
  report.hostElapsedSeconds = (performance.now() - started) / 1000;
  if (args.out) writeFileSync(path.resolve(root, String(args.out)), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report.variants).map(([name, data]) => [name, data.summary])), null, 2));
} finally { if (temporary) rmSync(temporary, {recursive: true, force: true}); }
