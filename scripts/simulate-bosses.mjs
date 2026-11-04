// v6.5.2: the fixed inflation Boss in its square arena.
// Usage: node scripts/simulate-bosses.mjs [seed-count=1] [seconds-per-run=90] [--quick]
// Growth fixtures respect the number of prior rewards and every prerequisite
// and cap. They are possible builds, not a simulation of the preceding stages
// or of the probability of receiving those offers. Zero is a stage-5 diagnostic
// baseline, not a claimed acquisition history. At stage 50 all routes have
// exhausted the same 33-layer pool. No starting milestone upgrades are assumed.
// After entry: real pulls, shots, wall/Boss contacts, steps, resize, and rewards
// only; never reposition a moving ball, inject damage, or force a victory.
// Single-shot runs never fire again. Refill runs obey ready and hold for .12s;
// Boss readiness remains continuous, so .37s refill is an automated extreme.
// Additional paced trials use 1.1s between shots. Automated success is not evidence of
// fun, human difficulty, mobile FPS, audio quality, or touch-input quality.

import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {World, length} from '../dist/physics.js';
import {UPGRADE_DEFINITIONS, canAcquireUpgrade} from '../dist/upgrades.js';

const rawArgs = process.argv.slice(2), quick = rawArgs.includes('--quick');
const args = rawArgs.filter(arg => arg !== '--quick');
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/simulate-bosses.mjs [seed-count=1] [seconds-per-run=90] [--quick]\n'
    + 'Default: stages 5/10/15/25/50; 4 viewports; legal growth paths; single-shot, ready-refill, oblique and resize trials.\n'
    + 'Calibration: node scripts/simulate-bosses.mjs 1 60 --quick\n'
    + 'Extended: node scripts/simulate-bosses.mjs 2 90\n'
    + 'seed-count: integer 1..20; duration: number 10..300 seconds. JSON includes individual runs and source hashes.');
  process.exit(0);
}
const seedCount = Number(args[0] ?? 1), duration = Number(args[1] ?? 90);
if (args.length > 2 || !Number.isInteger(seedCount) || seedCount < 1 || seedCount > 20
  || !Number.isFinite(duration) || duration < 10 || duration > 300) {
  console.error('Invalid arguments; run with --help.'); process.exit(1);
}
const rng = seed => () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
const near = (a, b, label, epsilon = 1e-7) => assert.ok(Math.abs(a - b) <= epsilon, `${label}: ${a} != ${b}`);
const sourceHash = file => createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex');
const priorities = {
  typical: ['energy','density','energy','density','bank','rubber','energy','density','rubber','boomerang','energy','overspeed','pulse','growth','split','rubber','risk','gambler','risk','gambler'],
  elastic: ['energy','rubber','rubber','rubber','rubber','energy','boomerang','pierce','energy','density','energy','overspeed','growth','shockwave','density','bank','risk','gambler'],
  split: ['energy','density','split','rubber','energy','density','energy','shockwave','boomerang','pulse','gravity','magnet','growth','energy','overspeed','bank','frenzy','risk','gambler','gambler'],
  energy: ['energy','energy','energy','energy','overspeed','overspeed','boomerang','bank','shockwave','rubber','rubber','rubber','density','growth','split','rubber','risk','risk','frenzy'],
};
const allLayers = UPGRADE_DEFINITIONS.flatMap(entry => Array(entry.maxStacks).fill(entry.id));
function buildPath(stage, theme) {
  if (theme === 'zero') { assert.equal(stage, 5); return []; }
  const budget = Math.min(allLayers.length, stage - 1 + Math.floor((stage - 1) / 5));
  const counts = {}, path = [];
  for (const id of [...priorities[theme], ...allLayers]) {
    if (path.length === budget) break;
    if (!canAcquireUpgrade(id, counts)) continue;
    counts[id] = (counts[id] || 0) + 1; path.push(id);
  }
  assert.equal(path.length, budget); return path;
}

function checkGeometry(w, label) {
  for (const body of [w.player, ...w.auxiliaries, ...(w.boss ? [w.boss] : [])])
    for (const key of ['x','y','vx','vy','r']) assert.ok(Number.isFinite(body[key]), `${label}: nonfinite ${key}`);
  if (w.phase !== 'boss') return;
  const g = w.arenaGeometry, c = w.arenaGeometry;
  assert.equal(g.shape, 'square'); near(c.x, w.width / 2, 'square center x'); near(c.y, w.height / 2, 'square center y');
  near(c.r, (Math.min(w.width, w.height) - 2 * w.inset) / 2, 'square half-side');
  assert.ok(w.boss.minRadius < w.boss.initialRadius && w.boss.initialRadius < w.boss.maxRadius);
  for (const body of [w.player, ...w.auxiliaries]) {
    assert.ok(body.x - body.r >= g.left - 1e-6 && body.x + body.r <= g.right + 1e-6
      && body.y - body.r >= g.top - 1e-6 && body.y + body.r <= g.bottom + 1e-6, `${label}: outside square`);
    assert.ok(Math.hypot(body.x - w.boss.x, body.y - w.boss.y) >= w.bossRadius + body.r - 1e-6, `${label}: inside Boss`);
  }
  assert.equal(w.liveCount, 0); assert.equal(w.fragmentQueue.length, 0); assert.equal(w.wave, null);
}

function encounter(spec) {
  const {stage, theme, width, height, angle, mode, seed, resize = false, kind = 'core', shotInterval = .37} = spec;
  const label = `${kind}/${mode}/stage${stage}/${theme}/${width}x${height}/${angle}/${seed}`;
  const w = new World(width, height, rng(seed), {spawnInitial: false}), path = buildPath(stage, theme);
  for (const id of path) {
    if (id === 'gambler' && w.nextGambler) {
      w.rewardSelectionsRemaining = 1; w.finishRewardRound(); assert.equal(w.nextGambler, false);
    }
    assert.equal(w.applyUpgrade(id), true, `${label}: illegal upgrade ${id}`);
  }
  w.stage = stage; w.maxStage = stage; w.nextGambler = false; w.gamblerRewardPending = false;
  w.gamblerTargetMultiplier = 1; w.setFeedbackOptions({strength: .6});
  w.fillFloor(); const buffs = {...w.buffs}, initialScore = w.score;
  w.beginBoss(); assert.equal(w.boss.bossType, 'inflation'); assert.equal(w.liveCount, 0); assert.equal(w.auxiliaries.length, 0);
  assert.equal(w.score, initialScore);
  let entrySteps = 0;
  while (w.phase === 'boss-entry' && entrySteps++ < 240) w.step(1 / 120);
  assert.equal(w.phase, 'boss', `${label}: entry stuck`); checkGeometry(w, label); w.events.length = 0;
  const result = {...spec, kind, resize, shotInterval, rewardBudget: stage - 1 + Math.floor((stage - 1) / 5),
    acquiredLayers: path.length, buffs, shots: 0, steps: 0, bossHits: 0, walls: 0, auxiliaryHits: 0,
    shellHits: 0, finishingHits: 0, maxDamageFraction: 0, maxSpeed: 0, firstLaunchSpeed: null,
    firstBelow8: null, firstBelow2_4: null, lastBossHit: null, lastWallHit: null, stunnedAt: null,
    victoryAt: null, maxWallDwell: 0, resizeCount: 0, maxResizeSpeedChange: 0, rewardSelections: 0, skippedRewards: 0,
    geometry: {arenaHalfSide: w.arenaGeometry.r / w.unit, playerRadius: w.player.r / w.unit,
      initialRadius: w.boss.initialRadius / w.unit, minRadius: w.boss.minRadius / w.unit, maxRadius: w.boss.maxRadius / w.unit}, curve: []};
  let firstShot = null, pullUntil = null, nextPull = 0, ledger = initialScore, elapsed = 0, wallDwell = 0;
  let trace = [], resized = 0, afterWallChecks = 0, shotDamage = 0, largestShotDamage = 0, stunHp = null;
  const emit = w.emit;
  const time = () => firstShot === null ? 0 : w.feedbackTime - firstShot;
  w.emit = function(name, data = {}) {
    if (['kill','clearKill','bossScore','bossDefeated'].includes(name)) { assert.ok(Number.isInteger(data.value)); ledger += data.value; }
    if (name === 'wall') { result.walls++; result.lastWallHit = time(); }
    if (name === 'bossHit') {
      result.bossHits++; result.lastBossHit = time();
      if (data.auxiliary) result.auxiliaryHits++;
      if (data.damage > 0) {
        result.finishingHits++; shotDamage += data.damage;
        assert.ok(stunHp > 0); result.maxDamageFraction = Math.max(result.maxDamageFraction, data.damage / stunHp);
      } else result.shellHits++;
    }
    if (name === 'bossStunned') { result.stunnedAt = time(); stunHp = data.maxHp; result.stunHp = stunHp; }
    if (name === 'bossDefeated') result.victoryAt = time();
    if (name === 'upgradeSkipped') result.skippedRewards++;
    return emit.call(this, name, data);
  };
  // Inspect actual reflected velocity after each contact, without changing it.
  const wall = w.wall;
  w.wall = function(body) {
    const before = result.walls; wall.call(this, body);
    if (this.phase === 'boss' && result.walls > before) {
      const contact = this.events.filter(event => event.type === 'wall').at(-1);
      if (contact.nx) assert.ok(body.vx * contact.nx <= 1e-6, `${label}: horizontal reflection points outward`);
      if (contact.ny) assert.ok(body.vy * contact.ny <= 1e-6, `${label}: vertical reflection points outward`);
      afterWallChecks++;
    }
  };
  for (let frame = 0; frame < duration * 120; frame++) {
    if (w.phase === 'over' || w.stage > stage || mode === 'single' && w.boss?.defeated) break;
    if (w.phase === 'boss') {
      const resizeTimes = mode === 'single' ? [2, 9, 18] : [.6, 1.2, 2];
      if (resize && resized < 3 && time() >= resizeTimes[resized]) {
        const speed = length(w.player) / w.unit, hp = w.boss.hp, maxHp = w.boss.maxHp, stunned = w.boss.stunned;
        const target = [[height,width],[320,568],[width,height]][resized++]; w.resize(...target);
        result.resizeCount++; result.maxResizeSpeedChange = Math.max(result.maxResizeSpeedChange, Math.abs(length(w.player) / w.unit - speed));
        if (stunned) { assert.equal(w.boss.hp, hp); assert.equal(w.boss.maxHp, maxHp); }
        checkGeometry(w, label);
      }
      if (pullUntil === null && elapsed >= nextPull && (result.shots === 0 || mode === 'refill') && w.ready) {
        assert.equal(w.beginPull(), true); pullUntil = elapsed + .12;
      }
      if (pullUntil !== null && elapsed + 1e-10 >= pullUntil) {
        const error = angle + (seed === 1 ? 0 : (rng(seed + result.shots + 73)() - .5) * 2);
        const direction = Math.atan2(w.boss.y - w.player.y, w.boss.x - w.player.x) + error * Math.PI / 180;
        assert.equal(w.shoot(-Math.cos(direction) * w.maxPull, -Math.sin(direction) * w.maxPull), true);
        if (firstShot === null) firstShot = w.feedbackTime;
        largestShotDamage = Math.max(largestShotDamage, shotDamage); shotDamage = 0;
        result.shots++; result.firstLaunchSpeed ??= length(w.player) / w.unit;
        pullUntil = null; nextPull = elapsed + Math.max(0, shotInterval - .12);
      }
    }
    if (w.phase === 'choose') {
      assert.equal(w.stage, stage); assert.equal(w.upgradeRound, result.rewardSelections + 1);
      assert.equal(w.choose(w.choices[0]), true); result.rewardSelections++;
    }
    const scale = w.bossVictorySlowTime > 1e-10 ? .3 : 1;
    w.step(scale / 120, pullUntil !== null, {timeScale: scale}); elapsed += 1 / 120; result.steps++;
    checkGeometry(w, label); assert.equal(w.score, ledger); assert.equal(w.totalShots, result.shots);
    if (w.phase === 'boss' && firstShot !== null) {
      const speed = length(w.player) / w.unit;
      result.maxSpeed = Math.max(result.maxSpeed, speed);
      if (speed < 8) result.firstBelow8 ??= time();
      if (speed < 2.4) result.firstBelow2_4 ??= time();
      const c = w.arenaGeometry, gap = Math.min(w.player.x - c.left, c.right - w.player.x, w.player.y - c.top, c.bottom - w.player.y) - w.player.r;
      wallDwell = gap < w.unit * .05 && speed > 2.4 && !(w.player.feedbackFreeze > 1e-10) ? wallDwell + 1 / 120 : 0;
      result.maxWallDwell = Math.max(result.maxWallDwell, wallDwell);
    }
    if (frame % 120 === 0) trace.push([w.phase,w.boss?.r,w.boss?.hp,w.player.x,w.player.y,w.player.vx,w.player.vy,w.score]);
    if (frame % 240 === 0 && firstShot !== null) result.curve.push([time(),length(w.player)/w.unit,
      w.boss ? w.boss.r/w.unit : null,w.boss?.stunned ? w.boss.hp/w.boss.maxHp : null,result.bossHits,result.walls,result.shots]);
    w.events.length = 0;
  }
  assert.ok(result.shots >= 1); if (mode === 'single') assert.equal(result.shots, 1);
  if (w.stage > stage) { assert.equal(w.stage, stage + 1); assert.equal(result.rewardSelections + result.skippedRewards, 2); }
  result.phase = w.phase; result.nextStage = w.stage > stage; result.reason = w.deathReason;
  result.secondsObserved = firstShot === null ? 0 : time(); result.finalSpeed = length(w.player) / w.unit;
  result.remainingHpFraction = Number.isFinite(w.boss?.maxHp) ? w.boss.hp / w.boss.maxHp : null;
  result.maxShotDamageFraction = stunHp ? Math.max(largestShotDamage, shotDamage) / stunHp : null;
  result.afterWallChecks = afterWallChecks;
  // A victory ends the observation: it is a lower bound on possible flight,
  // not evidence that the ball would have stopped then.
  result.flightCensoredByVictory = result.victoryAt !== null;
  return {result, trace};
}

const stages = quick ? [5,15,50] : [5,10,15,25,50];
const viewports = quick ? [[390,844]] : [[390,844],[844,390],[320,568],[568,320]];
const angles = quick ? [0,8] : [-8,0,8];
const specs = [];
for (const stage of stages) for (const theme of [...(stage === 5 ? ['zero'] : []), ...Object.keys(priorities)])
  for (const [width,height] of viewports) for (const angle of angles) for (const mode of ['single','refill'])
    specs.push({stage,theme,width,height,angle,mode});
for (const [width,height] of viewports) for (const stage of [5,50]) for (const angle of [-80,-60,60,80])
  specs.push({stage,theme:'energy',width,height,angle,mode:'single',kind:'oblique'});
for (const stage of stages) for (const theme of Object.keys(priorities)) for (const [width,height] of viewports)
  specs.push({stage,theme,width,height,angle:8,mode:'refill',resize:true,kind:'resize'});
for (const stage of stages) for (const [width,height] of viewports)
  specs.push({stage,theme:'typical',width,height,angle:8,mode:'single',resize:true,kind:'resize'});
for (const stage of [5,15,50]) for (const theme of stage === 5 ? ['zero','typical','energy'] : stage === 15 ? Object.keys(priorities) : ['energy'])
  for (const [width,height] of quick ? [[390,844]] : [[390,844],[844,390]])
    specs.push({stage,theme,width,height,angle:8,mode:'refill',kind:'paced',shotInterval:1.1});
const started = performance.now(), report = {audit:'v6.5.2 square inflation Boss', seedCount, secondsPerRun:duration, quick,
  physicsSha256:sourceHash('../dist/physics.js'), upgradesSha256:sourceHash('../dist/upgrades.js'),
  curveColumns:['secondsSinceFirstShot','speedUnits','bossRadiusUnits','stunnedHpFraction','bossHits','wallHits','shots'],
  runs:0, steps:0, victories:0, completedRewardRoutes:0, summary:{}, cases:[]};
for (const spec of specs) for (let seed = 1; seed <= seedCount; seed++) {
  const out = encounter({...spec,seed}), r = out.result;
  report.runs++; report.steps += r.steps; report.victories += Number(r.victoryAt !== null);
  report.completedRewardRoutes += Number(r.nextStage); report.cases.push(r);
  const key = `${r.kind}/${r.mode}/stage${r.stage}/${r.theme}`;
  const s = report.summary[key] ||= {runs:0,victories:0,completed:0,shots:[Infinity,0],bossHits:[Infinity,0],walls:[Infinity,0],
    lastBossHit:[Infinity,0],victorySeconds:[Infinity,0],finishingHits:[Infinity,0],maxDamageFraction:0,maxWallDwell:0,auxiliaryHits:0,endings:{}};
  s.runs++; s.victories += Number(r.victoryAt !== null); s.completed += Number(r.nextStage);
  for (const [field,value] of Object.entries({shots:r.shots,bossHits:r.bossHits,walls:r.walls,lastBossHit:r.lastBossHit,
    victorySeconds:r.victoryAt,finishingHits:r.finishingHits})) if (value !== null) { s[field][0]=Math.min(s[field][0],value);s[field][1]=Math.max(s[field][1],value); }
  s.maxDamageFraction=Math.max(s.maxDamageFraction,r.maxDamageFraction);s.maxWallDwell=Math.max(s.maxWallDwell,r.maxWallDwell);s.auxiliaryHits+=r.auxiliaryHits;
  const ending=r.nextStage?'next-stage':r.reason||r.phase;s.endings[ending]=(s.endings[ending]||0)+1;
  if (seed === 1 && spec.width === 390 && spec.angle === 0 && [5,50].includes(spec.stage) && spec.theme === 'energy')
    assert.deepEqual(out, encounter({...spec,seed}), `${key}: deterministic replay`);
}
assert.equal(report.physicsSha256,sourceHash('../dist/physics.js'),'physics changed during audit; rerun stable source');
assert.equal(report.upgradesSha256,sourceHash('../dist/upgrades.js'),'upgrades changed during audit; rerun stable source');
for (const row of Object.values(report.summary)) for (const [key,value] of Object.entries(row))
  if (Array.isArray(value) && value[0] === Infinity) row[key] = null;
console.log(JSON.stringify({...report,elapsedSeconds:(performance.now()-started)/1000},null,2));
