import test from 'node:test';
import assert from 'node:assert/strict';
import {World, length, BOSS_TIMING} from '../dist/physics.js';
import {CampaignWorld} from '../dist/campaign.js';
import {UPGRADES} from '../dist/upgrades.js';

const near = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
function run() {
  const w = new World(10000, 10000, () => .5, {spawnInitial: false});
  w.spawnTimer = w.floorTimer = w.introTimer = Infinity;
  Object.assign(w.player, {x: 4000, y: 4000, vx: 0, vy: 0});
  return w;
}
function enemy(w, values = {}) {
  const b = w.makeBody(6000, 6000, w.unit, 1.5);
  Object.assign(b, {enemyType: 'normal', born: 1, solid: true, hp: 10000, maxHp: 10000}, values);
  w.enemies.push(b); return b;
}
function gain(w, id, count = 1) {
  for (let i = 0; i < count; i++) assert.equal(w.applyUpgrade(id), true, `${id} layer ${i + 1}`);
}
function advance(w, seconds) {
  while (seconds > 1e-10) { const dt = Math.min(seconds, 1 / 120); w.step(dt); seconds -= dt; }
}
function headOn(w, body, speed = w.unit * 30, actor = w.player) {
  Object.assign(actor, {x: body.x - body.r - actor.r + .01, y: body.y, vx: speed, vy: 0});
  w.collide(actor, body);
}
function bounce(w, speed = w.unit * 30) {
  Object.assign(w.player, {x: 0, y: 4000, vx: -speed, vy: 0}); w.wall(w.player);
}
function splitShot(w) {
  gain(w, 'split'); w.shoot(-w.maxPull, 0);
  const speed = w.unit * 30; w.player.vx = speed; w.player.vy = 0;
  w.damage(enemy(w, {hp: 1}), 1, {impactVx: speed, impactVy: 0, impactSpeed: speed});
  return w.auxiliaries;
}

test('acquired caps and prerequisites control real energy, mass, radius and launch limits', () => {
  const w = run(), mass = w.player.mass;
  assert.equal(w.applyUpgrade('overspeed'), false); assert.equal(w.applyUpgrade('missing'), false);
  gain(w, 'energy', 4); near(w.energy, 1.3 ** 4); assert.equal(w.applyUpgrade('energy'), false);
  gain(w, 'overspeed', 2); assert.equal(w.applyUpgrade('overspeed'), false);
  w.energy = 100; w.shoot(-w.maxPull, 0); near(length(w.player), w.unit * 76);
  gain(w, 'density', 5); near(w.density, 1.35 ** 5); near(w.player.mass, mass * 1.35 ** 5);
  assert.equal(w.applyUpgrade('density'), false);
  const grownMass = w.player.mass; gain(w, 'growth'); near(w.player.r, w.unit * 1.2);
  gain(w, 'growth'); near(w.player.r, w.unit * 1.4); near(w.player.mass, grownMass);
  assert.equal(w.applyUpgrade('growth'), false);
  const campaign = new CampaignWorld(900, 700, 1, () => .5), oldEnergy = campaign.energy;
  assert.equal(campaign.applyUpgrade('energy'), false); near(campaign.energy, oldEnergy);
});

test('normal offers contain three distinct unacquired upgrades and skipped offers do not consume layers', () => {
  const w = run();
  for (let i = 0; i < 4; i++) {
    w.phase = 'battle'; w.beginUpgrade();
    assert.equal(w.choices.length, 3); assert.equal(new Set(w.choices.map(c => c.id)).size, 3);
    assert.deepEqual(w.buffs, {});
  }
  const chosen = w.choices[0]; w.phase = 'choose';
  assert.equal(w.choose(chosen), true); assert.equal(w.buffs[chosen.id], 1);
  assert.equal(w.phase, 'reward'); assert.equal(w.choices.length, 0);
  advance(w, .99); assert.equal(w.phase, 'reward'); advance(w, .011); assert.equal(w.phase, 'battle');
});

test('selection feedback boost survives tiny and reward shots and is consumed by exactly one combat shot', () => {
  const w = run(); w.phase = 'choose'; w.choose(UPGRADES.energy);
  assert.equal(w.pendingUpgradeBoost, true);
  w.phase = 'choose'; w.player.vx = w.player.vy = 0;
  assert.equal(w.shoot(-w.maxPull, 0), true); assert.equal(w.pendingUpgradeBoost, true);
  w.phase = 'battle'; assert.equal(w.shoot(1, 0), false); assert.equal(w.pendingUpgradeBoost, true);
  assert.equal(w.shoot(-w.maxPull, 0), true); assert.equal(w.pendingUpgradeBoost, false); assert.equal(w.shotUpgradeBoost, true);
  w.damage(enemy(w, {hp: 1}), 1); assert.equal(w.events.find(e => e.type === 'kill').upgradeBoost, true);
  w.shoot(-w.maxPull, 0); assert.equal(w.shotUpgradeBoost, false);
  w.damage(enemy(w, {hp: 1}), 1); assert.equal(w.events.filter(e => e.type === 'kill').at(-1).upgradeBoost, false);
  w.phase = 'choose'; w.choose(UPGRADES.density); w.phase = 'battle'; w.shoot(-w.maxPull, 0);
  w.stageKills = w.killTarget - 1; w.damage(enemy(w, {hp: 1}), 1);
  assert.equal(w.events.filter(e => e.type === 'kill').at(-1).upgradeBoost, true);
  w.step(1 / 120); assert.equal(w.shotUpgradeBoost, false, 'the old combat boost cannot leak through clearing into reward travel');
  w.pendingUpgradeBoost = true; w.phase = 'battle'; w.beginUpgrade();
  assert.equal(w.pendingUpgradeBoost, true, 'a future unspent selection boost survives cleanup');
  const boss = run(); boss.pendingUpgradeBoost = true; boss.stage = 5; boss.beginBoss(); advance(boss, BOSS_TIMING.entry);
  assert.equal(boss.shoot(-boss.maxPull, 0), true); assert.equal(boss.pendingUpgradeBoost, false); assert.equal(boss.shotUpgradeBoost, true);
});

test('gambler raises only the next stage quota and grants only its following reward five choices', () => {
  const w = run(); w.phase = 'choose'; w.choose(UPGRADES.gambler); advance(w, 1.001);
  assert.equal(w.stage, 2); assert.equal(w.killTarget, 27); assert.equal(w.buffs.gambler, 1);
  w.beginUpgrade(); assert.equal(w.choices.length, 5); assert.equal(new Set(w.choices.map(c => c.id)).size, 5);
  const next = w.choices.find(c => c.id !== 'gambler'); w.phase = 'choose'; w.choose(next); advance(w, 1.001);
  assert.equal(w.stage, 3); assert.equal(w.killTarget, 22);
  w.beginUpgrade(); assert.equal(w.choices.length, 3);
  w.phase = 'choose'; w.choose(UPGRADES.gambler); advance(w, 1.001);
  assert.equal(w.stage, 4); assert.equal(w.killTarget, 39); assert.equal(w.buffs.gambler, 2);
  assert.equal(w.applyUpgrade('gambler'), false);
});

test('rubber raises the solved-direction retention floor while pierce keeps the incoming direction', () => {
  for (let layers = 0; layers <= 4; layers++) {
    const w = run(); gain(w, 'rubber', layers);
    const b = enemy(w); headOn(w, b); near(length(w.player), w.unit * 30 * (.7 + .06 * layers));
    assert.ok(w.player.vx > 0); near(w.player.vy, 0);
  }
  const w = run(); gain(w, 'pierce');
  const b = enemy(w, {x: 4060, y: 4020}); Object.assign(w.player, {vx: 600, vy: 0}); w.collide(w.player, b);
  near(w.player.vy, 0); assert.ok(w.player.vx >= 600 * .92); assert.equal(w.applyUpgrade('pierce'), false);
});

test('penetration restores speed only for the first direct kill and resets with a successful shot', () => {
  const w = run(); gain(w, 'penetration'); w.shoot(-w.maxPull, 0);
  const speed = w.unit * 30; headOn(w, enemy(w, {hp: 1}), speed); near(length(w.player), speed);
  headOn(w, enemy(w, {hp: 1}), speed); near(length(w.player), speed * .7);
  w.shoot(-w.maxPull, 0); headOn(w, enemy(w, {hp: 1}), speed); near(length(w.player), speed);
});

test('a pulse first kill spends penetration without restoring a nonlethal direct impact', () => {
  const w = run(); gain(w, 'penetration'); gain(w, 'pulse');
  const direct = enemy(w, {x: 5000, y: 4000}), nearby = enemy(w, {x: 5000 + w.unit * 2.5, y: 4000, hp: 1});
  const speed = w.unit * 30; headOn(w, direct, speed);
  assert.ok(direct.hp > 0); assert.ok(nearby.hp <= 0); assert.equal(w.shotKills, 1); near(length(w.player), speed * .7);
  w.buffs.pulse = 0; headOn(w, enemy(w, {hp: 1}), speed); near(length(w.player), speed * .7);
});

test('boomerang refreshes its half-second window without multiplying again on another wall', () => {
  const w = run(); gain(w, 'boomerang'); bounce(w);
  near(length(w.player), w.unit * 30 * .95 * 1.2);
  w.player.x = 4000; advance(w, .25); const before = length(w.player);
  bounce(w, before); near(length(w.player), before * .95);
  w.player.x = 4000; const refreshed = length(w.player);
  advance(w, .49); near(length(w.player), refreshed * Math.exp(-.35 * .49));
  advance(w, .01); near(length(w.player), refreshed / 1.2 * Math.exp(-.35 * .5));
});

test('shooting during boomerang computes from unboosted current speed and expiry preserves the new shot', () => {
  const w = run(); gain(w, 'boomerang'); bounce(w); w.player.x = 4000;
  const baseCurrent = length(w.player) / 1.2;
  const redirected = Math.max(.9 * baseCurrent, w.baseSpeed * (1 - .5 * Math.min(1, baseCurrent / w.baseSpeed)));
  w.shoot(0, -w.maxPull); near(w.player.vx, 0); near(w.player.vy, redirected * 1.2);
  advance(w, .5); near(w.player.vy, redirected * Math.exp(-.35 * .5));
  w.shoot(-w.maxPull, 0); const afterExpiryShot = length(w.player);
  advance(w, .2); near(length(w.player), afterExpiryShot * Math.exp(-.35 * .2));
});

test('first kill spawns exactly two physical auxiliaries at sixty-percent speed and twenty-degree angles', () => {
  const w = run(), children = splitShot(w), speed = w.unit * 30;
  assert.equal(children.length, 2);
  for (const [i, child] of children.entries()) {
    assert.equal(child.isAuxiliary, true); assert.equal(child.solid, true);
    near(child.r, w.unit * .7); near(length(child), speed * .6);
    near(Math.atan2(child.vy, child.vx), (i ? 1 : -1) * Math.PI / 9);
  }
  const ids = children.map(b => b.id); w.damage(enemy(w, {hp: 1}), 1);
  assert.deepEqual(w.auxiliaries.map(b => b.id), ids);
  w.shoot(-w.maxPull, 0); assert.equal(w.auxiliaries.length, 0);
  w.damage(enemy(w, {hp: 1}), 1); assert.equal(w.auxiliaries.length, 2);
  assert.ok(w.auxiliaries.every(b => !ids.includes(b.id)));
});

test('auxiliary damage is sixty percent of the captured main-ball reference, not its reduced mass or squared speed', () => {
  const w = run(); gain(w, 'density', 2); const sourceMass = w.player.mass;
  const [child] = splitShot(w); near(child.sourceMass, sourceMass);
  const target = enemy(w, {mass: .8}), referenceSpeed = w.unit * 30;
  w.player.mass *= 5;
  headOn(w, target, referenceSpeed * .6, child);
  const reducedMass = 1 / (1 / sourceMass + 1 / target.mass);
  const expected = Math.round(.5 * reducedMass * 30 ** 2 * .31 * .6);
  assert.equal(10000 - target.hp, expected);
  const hit = w.events.filter(e => e.type === 'hit').at(-1);
  assert.equal(hit.auxiliary, true); near(hit.impactSpeed, referenceSpeed * .6);
});

test('auxiliary contacts freeze their own pair and each player ball is attracted from its own position', () => {
  const w = run(), [child, sibling] = splitShot(w); w.setFeedbackOptions({strength: 1});
  const target = enemy(w, {hp: 100, maxHp: 100, mass: .8}); headOn(w, target, w.unit * 18, child);
  near(child.feedbackFreeze, .025); near(target.feedbackFreeze, .025); near(w.player.feedbackFreeze || 0, 0);
  const childX = child.x, targetX = target.x, playerX = w.player.x, siblingX = sibling.x;
  w.step(.01); near(child.x, childX); near(target.x, targetX);
  assert.ok(w.player.x > playerX); assert.ok(sibling.x > siblingX);

  const magnetic = run(), [left, right] = splitShot(magnetic);
  magnetic.enemies = [];
  enemy(magnetic, {enemyType: 'magnet', x: 4000, y: 4000, vx: 0, vy: 0});
  Object.assign(magnetic.player, {x: 4000, y: 4000 + magnetic.unit * 3, vx: 0, vy: 0});
  Object.assign(left, {x: 4000 - magnetic.unit * 3, y: 4000, vx: 0, vy: 0});
  Object.assign(right, {x: 4000 + magnetic.unit * 3, y: 4000, vx: 0, vy: 0});
  magnetic.step(.01);
  assert.ok(left.vx > 0); near(left.vy, 0); assert.ok(right.vx < 0); near(right.vy, 0);
  near(magnetic.player.vx, 0); assert.ok(magnetic.player.vy < 0);
});

test('auxiliaries expire after continuous low speed and leave with a new shot or clearing or Boss entry', () => {
  const w = run(); splitShot(w);
  for (const child of w.auxiliaries) { child.vx = w.unit * 2; child.vy = 0; }
  advance(w, .399); assert.equal(w.auxiliaries.length, 2);
  advance(w, .001); assert.equal(w.auxiliaries.length, 0);
  for (const finish of [world => world.shoot(-world.maxPull, 0), world => world.beginClearing(), world => world.beginUpgrade()]) {
    const current = run(); splitShot(current); assert.equal(current.auxiliaries.length, 2);
    finish(current); assert.equal(current.auxiliaries.length, 0);
  }
  const retained = run(); splitShot(retained);const children=retained.auxiliaries.slice();
  retained.stage=5;retained.beginBoss();assert.deepEqual(retained.auxiliaries,[]);
  const before=children.map(b=>({x:b.x,y:b.y}));retained.step(.01);
  assert.equal(retained.auxiliaries.length,0);assert.ok(children.every((b,i)=>b.x===before[i].x&&b.y===before[i].y));
});

test('magnet pulls the nearest solid enemy by the layered distance and never crosses the player boundary', () => {
  for (const layers of [1, 2]) {
    const w = run(); gain(w, 'magnet', layers); const x = w.player.x;
    const target = enemy(w, {x: x + w.unit * 8, y: w.player.y});
    const other = enemy(w, {x: x - w.unit * 10, y: w.player.y});
    enemy(w, {x: x + w.unit, y: w.player.y, born: 0, solid: false});
    w.damage(enemy(w, {hp: 1}), 1); const otherX = other.x;
    advance(w, .4); near(target.x, x + w.unit * (8 - 1.5 * layers)); near(other.x, otherX);
    const close = enemy(w, {x: x + w.player.r + w.unit + 1, y: w.player.y});
    w.damage(enemy(w, {hp: 1}), 1); advance(w, .4);
    assert.ok(Math.hypot(close.x - w.player.x, close.y - w.player.y) >= close.r + w.player.r);
  }
});

test('magnet does not move its selected target through a local hit hold', () => {
  const w = run(); gain(w, 'magnet');
  const target = enemy(w, {x: w.player.x + w.unit * 8, y: w.player.y, feedbackFreeze: .025});
  w.damage(enemy(w, {hp: 1}), 1); const x = target.x;
  w.step(.02); near(target.x, x); w.step(.005); near(target.x, x);
  w.step(.01); assert.ok(target.x < x);
});

test('shockwave happens on every third actual wall and deals half full-pull damage to each in-range target', () => {
  const w = run(); gain(w, 'shockwave'); const anchor = w.inset + w.player.r;
  const first = enemy(w, {x: anchor + w.unit * 2, y: 4000, mass: .8});
  const second = enemy(w, {x: anchor, y: 4000 + w.unit * 2, mass: 2.5});
  const outside = enemy(w, {x: anchor + w.unit * 3.1, y: 4000});
  bounce(w); bounce(w); assert.equal(first.hp, 10000); assert.equal(second.hp, 10000);
  bounce(w);
  for (const body of [first, second]) {
    const mass = 1 / (1 / w.player.mass + 1 / body.mass);
    assert.equal(10000 - body.hp, Math.round(.5 * mass * 40 ** 2 * .31 * .5));
  }
  assert.equal(outside.hp, 10000); assert.equal(w.events.filter(e => e.type === 'shockwave').length, 1);
  w.shoot(-w.maxPull, 0); bounce(w); bounce(w); assert.equal(w.events.filter(e => e.type === 'shockwave').length, 1);
  bounce(w); assert.equal(w.events.filter(e => e.type === 'shockwave').length, 2);
});

test('the shared third wall releases shockwave at the actual auxiliary and freezes only that impact pair', () => {
  const w = run(), [child] = splitShot(w); gain(w, 'shockwave');
  w.setFeedbackOptions({strength: 1});
  bounce(w); bounce(w); assert.equal(w.shotWallCount, 2);
  const nearMain = enemy(w, {x: w.player.x + w.unit * 2, y: w.player.y, hp: 300, maxHp: 300});
  const childX = w.inset + child.r;
  const nearChild = enemy(w, {x: childX + w.unit * 2, y: 2000, hp: 300, maxHp: 300});
  Object.assign(child, {x: 0, y: 2000, vx: -w.unit * 30, vy: 0}); w.wall(child);
  assert.equal(w.shotWallCount, 3);
  const shock = w.events.find(e => e.type === 'shockwave'); near(shock.x, child.x); near(shock.y, child.y);
  const reducedMass = 1 / (1 / w.player.mass + 1 / nearChild.mass);
  assert.equal(300 - nearChild.hp, Math.round(.5 * reducedMass * 40 ** 2 * .31 * .5));
  assert.equal(nearMain.hp, 300, 'the primary player position is outside this auxiliary shockwave');
  near(child.feedbackFreeze, .025); near(nearChild.feedbackFreeze, .025); near(w.player.feedbackFreeze || 0, 0);
  const mainX = w.player.x, frozenX = child.x, frozenTargetX = nearChild.x;
  w.step(.01); assert.ok(w.player.x > mainX); near(child.x, frozenX); near(nearChild.x, frozenTargetX);
});

test('effective area damage counts as a hit for missed-shot attribution while zero damage does not', () => {
  const w = run(); gain(w, 'shockwave'); w.shoot(-w.maxPull, 0);
  const target = enemy(w, {x: w.inset + w.player.r + w.unit * 2, y: 4000});
  assert.equal(w.resultMisses, 1); bounce(w); bounce(w); assert.equal(w.activeShot.hits, 0);
  bounce(w); assert.ok(target.hp < target.maxHp); assert.equal(w.activeShot.hits, 1); assert.equal(w.resultMisses, 0);

  const pulse = run(); pulse.shoot(-pulse.maxPull, 0); const pulseTarget = enemy(pulse);
  pulse.damage(pulseTarget, 0, {source: 'pulse'}); assert.equal(pulse.activeShot.hits, 0); assert.equal(pulse.resultMisses, 1);
  pulse.damage(pulseTarget, 1, {source: 'pulse'}); assert.equal(pulse.activeShot.hits, 1); assert.equal(pulse.resultMisses, 0);
});

test('risk scales and rounds each ordinary and clear award, including combo and bank bonuses', () => {
  const w = run(); gain(w, 'risk', 2); bounce(w);
  w.damage(enemy(w, {hp: 1}), 1); w.damage(enemy(w, {hp: 1}), 1);
  assert.deepEqual(w.events.filter(e => e.type === 'kill').map(e => e.value), [34, 68]); assert.equal(w.score, 102);
  const clear = run(); gain(clear, 'risk', 2); clear.stageKills = clear.killTarget - 1;
  clear.damage(enemy(clear, {x: 4000, y: 3000, hp: 1}), 1);
  enemy(clear, {x: 4100, y: 3000}); enemy(clear, {x: 4200, y: 3000});
  while (clear.phase === 'battle' || clear.phase === 'clearing') clear.step(1 / 120);
  assert.deepEqual(clear.events.filter(e => e.type === 'clearKill').map(e => e.value), [23, 23]);
  assert.equal(clear.score, 69); assert.equal(clear.stageKills, 14);
});

test('risk scales each boss segment and final bonus independently while preserving the encounter', () => {
  const w = run(); gain(w, 'risk', 2); w.stage = 10; w.beginBoss({type:'inflation'}); advance(w, BOSS_TIMING.entry);
  w.boss.r = w.boss.minRadius + .001; w.damageBoss(w.baseSpeed);
  assert.equal(w.boss.stunned, true); assert.deepEqual(w.events.filter(e => e.type === 'bossScore').map(e => e.value), Array(5).fill(248));
  w.damageBoss(w.baseSpeed * 20); assert.equal(w.phase, 'boss-celebrate');
  assert.equal(w.events.find(e => e.type === 'bossDefeated').value, 1238); assert.equal(w.score, 2478);
});

test('breath slows only the wave start clock for 1.5 seconds and leaves in-wave spacing unchanged', () => {
  const w = run(); gain(w, 'breath'); w.spawnTimer = 0; w.advanceSpawning(.001);
  assert.equal(w.enemies.length, 1); const firstTimer = w.wave.timer;
  w.damage(enemy(w, {hp: 1}), 1); near(w.breathTime, 1.5);
  const startTimer = w.spawnTimer; w.advanceSpawning(.3);
  near(w.spawnTimer, startTimer - .2); near(w.wave.timer, firstTimer); near(w.breathTime, 1.2);
  assert.equal(w.events.filter(e => e.type === 'spawn').length, 2);
  w.advanceSpawning(1.3); near(w.breathTime, 0); near(w.spawnTimer, startTimer - .2 - .8 - .1);
});

test('risk accelerates scheduled waves and frenzy adds two slots with a twelve-kill combo cap', () => {
  const w = run(), interval = w.spawnInterval; gain(w, 'risk', 2); near(w.spawnInterval, interval / 1.2 ** 2);
  gain(w, 'frenzy'); assert.equal(w.waveSize, 6); assert.equal(w.comboCap, 12);
  w.spawnTimer = 0; w.advanceSpawning(.001); near(w.spawnTimer, w.waveSize * w.spawnInterval * .7 - .001);
  w.enemies = []; w.wave = null; w.spawnTimer = Infinity;
  for (let i = 0; i < 13; i++) w.damage(enemy(w, {hp: 1}), 1);
  assert.deepEqual(w.events.filter(e => e.type === 'kill').slice(-3).map(e => e.value), [248, 270, 270]);
  assert.equal(w.stageKills, 13); assert.equal(w.phase, 'battle');
});

test('offer context snapshots living enemies before the sweep and persists until the reward is offered', () => {
  const w = run(); w.stage = 4;
  for (let i = 0; i < 10; i++) w.shoot(-w.maxPull, 0);
  w.stageRealKills = 10; w.stageKills = w.killTarget - 1;
  enemy(w, {x: 4100, y: 3000, enemyType: 'ring'}); enemy(w, {x: 4200, y: 3000, enemyType: 'heavy'});
  enemy(w, {x: 4300, y: 3000}); enemy(w, {x: 4400, y: 3000});
  w.damage(enemy(w, {x: 4000, y: 3000, hp: 1}), 1); w.step(1 / 120);
  assert.equal(w.phase, 'clearing');
  const expected = {hardEnemyShare: .5, nextBoss: true, completedShots: 10, averageKillsPerShot: 1.1};
  assert.deepEqual(w.upgradeContext, expected);
  while (w.phase === 'clearing') w.step(1 / 120);
  assert.equal(w.enemies.length, 0); assert.equal(w.choices.length, 3); assert.deepEqual(w.upgradeContext, expected);
  w.phase = 'choose'; w.choose(w.choices[0]); advance(w, 1.001); assert.equal(w.upgradeContext, null);
});

test('an exhausted upgrade pool skips selection through the usual reward rest without awarding a fake layer', () => {
  const w = run();
  for (const upgrade of Object.values(UPGRADES)) {
    if (upgrade.id === 'gambler') {
      gain(w, 'gambler');
      // The next-stage wager must be consumed before another can be acquired.
      w.rewardSelectionsRemaining = 1; w.finishRewardRound();
      assert.equal(w.nextGambler, false); assert.equal(w.gamblerTargetMultiplier, 1.5);
      gain(w, 'gambler');
    } else gain(w, upgrade.id, upgrade.maxStacks);
  }
  const acquired = {...w.buffs}, stage = w.stage; w.beginUpgrade();
  assert.equal(w.phase, 'reward'); assert.deepEqual(w.choices, []); assert.deepEqual(w.buffs, acquired);
  assert.equal(w.events.filter(e => e.type === 'upgradeSkipped').length, 1);
  assert.equal(w.events.filter(e => e.type === 'buff').length, 0); assert.equal(w.pendingUpgradeBoost, false);
  advance(w, .99); assert.equal(w.phase, 'reward'); advance(w, .011);
  assert.equal(w.phase, 'battle'); assert.equal(w.stage, stage + 1); assert.deepEqual(w.buffs, acquired); assert.equal(w.score, 0);
});

test('five-choice layouts fit narrow and landscape viewports with separate hit areas and player space', () => {
  for (const [width, height] of [[320, 568], [844, 390]]) {
    const w = new World(width, height, () => .5, {spawnInitial: false});
    w.gamblerRewardPending = true; w.beginUpgrade(); assert.equal(w.choices.length, 5);
    const bounds = w.arenaBounds;
    for (const choice of w.choices) {
      assert.ok(choice.x - choice.r >= bounds.left); assert.ok(choice.x + choice.r <= bounds.right);
      assert.ok(choice.y - choice.r >= bounds.top); assert.ok(choice.y + choice.r + 24 < bounds.bottom);
      assert.ok(choice.labelWidth > 0);
      assert.ok(Math.hypot(choice.x - width / 2, choice.y - w.choicePlayerY) > choice.r + w.player.r);
    }
    for (let i = 0; i < w.choices.length; i++) for (let j = i + 1; j < w.choices.length; j++) {
      const a = w.choices[i], b = w.choices[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > (a.r + b.r) * 1.2, `${width}x${height}: ${a.id}/${b.id}`);
    }
    advance(w, 1.86); assert.equal(w.phase, 'choose');
    near(w.player.x, width / 2); near(w.player.y, w.choicePlayerY);
    for (const choice of w.choices) assert.ok(Math.hypot(choice.x - w.player.x, choice.y - w.player.y) > choice.r + w.player.r);
  }
});


test('gambler places three offers above the player and two below across growth, short screens and rotations', () => {
  for (const [width,height] of [[200,400],[320,568],[390,844],[844,390],[568,320],[600,240],[1364,936]]) for (const grown of [false,true]) {
    const w=new World(width,height,()=>.5,{spawnInitial:false});
    if(grown){w.applyUpgrade('growth');w.applyUpgrade('growth');}
    w.gamblerRewardPending=true;w.beginUpgrade();advance(w,1.86);
    const inspect=()=>{
      const p=w.player,b=w.arenaBounds;near(p.x,w.width/2);near(p.y,w.choicePlayerY);
      assert.equal(w.choices.filter(c=>c.y<p.y).length,3);assert.equal(w.choices.filter(c=>c.y>p.y).length,2);
      for(const [index,c] of w.choices.entries()){
        assert.ok(c.r>=1&&c.x-c.r*1.28>=b.left&&c.x+c.r*1.28<=b.right);
        const font=Math.max(9,Math.min(17,Math.floor(c.labelWidth/c.name.length*.9))),outer=c.r*(1+.14*(c.rings||0));
        assert.ok(c.y-outer>=b.top&&c.y+outer+14+font<b.bottom);
        assert.ok(c.x-c.labelWidth/2>=b.left&&c.x+c.labelWidth/2<=b.right);
        if(index<3)assert.ok(c.y+outer+14+font<=p.y-p.r+1e-7,`${width}x${height} upper label touches player`);
        else assert.ok(c.y-outer>=p.y+p.r-1e-7,`${width}x${height} lower offer touches player`);
      }
      for(let i=0;i<5;i++)for(let j=i+1;j<5;j++){const a=w.choices[i],c=w.choices[j];assert.ok(Math.hypot(a.x-c.x,a.y-c.y)>1.2*(a.r+c.r));}
    };
    inspect();w.player.vx=w.unit*10;w.resize(height,width);inspect();near(length(w.player),0);
    assert.equal(w.events.filter(e=>e.type==='buff').length,0);
  }
});

test('each upper or lower gambler offer can be struck once and emits the common kill-fragment contact data',()=>{
  for(const [width,height] of [[390,844],[844,390]])for(let index=0;index<5;index++){
    const w=new World(width,height,()=>.5,{spawnInitial:false});w.gamblerRewardPending=true;w.beginUpgrade();advance(w,1.86);
    const c={...w.choices[index]},p=w.player,score=w.score,kills=w.totalKills,stageKills=w.stageKills;
    const dx=c.x-p.x,dy=c.y-p.y,distance=Math.hypot(dx,dy);
    assert.ok(w.beginPull());assert.ok(w.shoot(-dx/distance*w.maxPull,-dy/distance*w.maxPull));
    for(let i=0;i<360&&w.phase==='choose';i++)w.step(1/120);
    const events=w.events.filter(e=>e.type==='buff');assert.equal(events.length,1);const e=events[0];
    assert.equal(e.buff.id,c.id);assert.equal(e.bodySnapshot.id,c.id);assert.equal(e.bodySnapshot.hp,0);
    near(e.x,c.x);near(e.y,c.y);near(e.r,c.r);near(Math.hypot(e.nx,e.ny),1);
    near(e.contactX,e.x-e.nx*e.r);near(e.contactY,e.y-e.ny*e.r);
    assert.ok(e.impactSpeed>0&&e.power>0);near(e.impactSpeed,Math.hypot(e.impactVx,e.impactVy));assert.equal(e.feedbackLevel,1);
    assert.equal(w.score,score);assert.equal(w.totalKills,kills);assert.equal(w.stageKills,stageKills);
    assert.equal(w.choose(c),false);assert.equal(w.events.filter(e=>e.type==='buff').length,1);
  }
});

test('normal three-choice rewards retain one upper row and produce the same contact feedback',()=>{
  const w=new World(390,844,()=>.5,{spawnInitial:false});w.beginUpgrade();advance(w,1.86);
  assert.equal(w.choices.length,3);assert.ok(w.choices.every(c=>c.y<w.player.y));near(w.choices[0].y,w.choices[2].y);
  const c=w.choices[1];Object.assign(w.player,{x:c.x,y:c.y+c.r+w.player.r-.1,vx:0,vy:-w.unit*20});w.step(1/120);
  const e=w.events.find(e=>e.type==='buff');assert.ok(e);assert.equal(e.buff.id,c.id);assert.equal(e.ny,-1);assert.ok(e.impactSpeed>0);
  assert.equal(w.events.filter(e=>e.type==='kill').length,0);
});


test('five-choice explicit preview limits contain rarity rings and complete names without expanding behind controls',()=>{
  for(const [width,height,panelHeight] of [[390,844,40],[844,390,40],[320,568,40],[568,320,40],[600,240,40],[400,200,40]]){
    const w=new World(width,height,()=>.5,{spawnInitial:false});w.gamblerRewardPending=true;w.beginUpgrade();
    const top=w.arenaBounds.top+8,bottom=height-20-panelHeight-8;
    w.layoutChoices({top,bottom});const py=w.choicePlayerY;
    for(const [index,c] of w.choices.entries()){
      const font=Math.max(9,Math.min(17,Math.floor(c.labelWidth/c.name.length*.9)));
      // Exercise the maximum legal outer-ring count even if this draw is plain.
      const outer=c.r*1.28;
      assert.ok(c.y-outer>=top-1e-7,`${width}x${height}: outer ring above region`);
      assert.ok(c.y+outer+14+font<=bottom+1e-7,`${width}x${height}: name behind controls`);
      if(index<3)assert.ok(c.y+outer+14+font<=py-w.player.r+1e-7);
      else assert.ok(c.y-outer>=py+w.player.r-1e-7);
    }
    near(py,(top+bottom)/2);
  }
});
